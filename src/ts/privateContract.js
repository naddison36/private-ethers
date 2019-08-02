"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
var address_1 = require("@ethersproject/address");
var bytes_1 = require("@ethersproject/bytes");
var bignumber_1 = require("@ethersproject/bignumber");
var constants_1 = require("@ethersproject/constants");
var errors = __importStar(require("@ethersproject/errors"));
var keccak256_1 = require("@ethersproject/keccak256");
var properties_1 = require("@ethersproject/properties");
var rlp_1 = require("@ethersproject/rlp");
var contracts_1 = require("@ethersproject/contracts");
// FIXME a workaround until this Ethers issue has been solved https://github.com/ethers-io/ethers.js/issues/577
var contracts_2 = require("./contracts");
var privateTransaction_1 = require("./privateTransaction");
var privacyGroup_1 = require("./privacyGroup");
var PrivateContract = /** @class */ (function (_super) {
    __extends(PrivateContract, _super);
    function PrivateContract(addressOrName, contractInterface, signerOrProvider) {
        return _super.call(this, addressOrName, contractInterface, signerOrProvider, runPrivateMethod) || this;
    }
    return PrivateContract;
}(contracts_2.Contract));
exports.PrivateContract = PrivateContract;
function runPrivateMethod(contract, functionName, options) {
    var method = contract.interface.functions[functionName];
    return function () {
        var _this = this;
        var params = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            params[_i] = arguments[_i];
        }
        var tx = {};
        var blockTag = null;
        // If 1 extra parameter was passed in, it contains overrides
        if (params.length === method.inputs.length + 1 && typeof (params[params.length - 1]) === "object") {
            tx = properties_1.shallowCopy(params.pop());
            if (tx.blockTag != null) {
                blockTag = tx.blockTag;
            }
            delete tx.blockTag;
            // Check for unexpected keys (e.g. using "gas" instead of "gasLimit")
            for (var key in tx) {
                if (!privateTransaction_1.allowedTransactionKeys[key]) {
                    errors.throwError(("unknown transaction override - " + key), "overrides", tx);
                }
            }
        }
        errors.checkArgumentCount(params.length, method.inputs.length, "passed to contract");
        // Check overrides make sense
        ["data", "to", 'privateFrom', 'privateFor', 'restriction'].forEach(function (key) {
            if (tx[key] != null) {
                errors.throwError("cannot override " + key, errors.UNSUPPORTED_OPERATION, { operation: key });
            }
        });
        // FIXME until Pantheon supports priv_getCode, we can't check if the contract has been mined
        // So for now we'll just assume the contract has been mined
        tx.to = contract.addressPromise;
        // // If the contract was just deployed, wait until it is minded
        // if (contract.deployPrivateTransaction != null) {
        //     tx.to = contract._deployed(blockTag).then(() => {
        //         return contract.addressPromise;
        //     });
        // } else {
        //     tx.to = contract.addressPromise;
        // }
        return resolveAddresses(contract.signer || contract.provider, params, method.inputs).then(function (params) {
            tx.data = contract.interface.encodeFunctionData(method, params);
            if (method.constant || options.callStatic) {
                // Call (constant functions) always cost 0 ether
                if (options.estimate) {
                    return Promise.resolve(constants_1.Zero);
                }
                if (!contract.provider && !contract.signer) {
                    errors.throwError("call (constant functions) require a provider or signer", errors.UNSUPPORTED_OPERATION, { operation: "call" });
                }
                // Check overrides make sense
                ["gasLimit", "gasPrice", "value"].forEach(function (key) {
                    if (tx[key] != null) {
                        throw new Error("call cannot override " + key);
                    }
                });
                if (options.transaction) {
                    return properties_1.resolveProperties(tx);
                }
                // FIXME replace call with privateCall
                return (contract.signer || contract.provider).call(tx, blockTag).then(function (value) {
                    try {
                        var result = contract.interface.decodeFunctionResult(method, value);
                        if (method.outputs.length === 1) {
                            result = result[0];
                        }
                        return result;
                    }
                    catch (error) {
                        if (error.code === errors.CALL_EXCEPTION) {
                            error.address = contract.address;
                            error.args = params;
                            error.transaction = tx;
                        }
                        throw error;
                    }
                });
            }
            // Only computing the transaction estimate
            if (options.estimate) {
                if (!contract.provider && !contract.signer) {
                    errors.throwError("estimate require a provider or signer", errors.UNSUPPORTED_OPERATION, { operation: "estimateGas" });
                }
                return (contract.signer || contract.provider).estimateGas(tx);
            }
            if (tx.gasLimit == null && method.gas != null) {
                tx.gasLimit = bignumber_1.BigNumber.from(method.gas).add(21000);
            }
            if (tx.value != null && !method.payable) {
                errors.throwError("contract method is not payable", errors.INVALID_ARGUMENT, {
                    argument: "sendPrivateTransaction",
                    value: tx,
                    method: method.format()
                });
            }
            // Add private properties
            if (contract.deployPrivateTransaction) {
                if (contract.deployPrivateTransaction.privateFrom) {
                    tx.privateFrom = contract.deployPrivateTransaction.privateFrom;
                }
                tx.privateFor = contract.deployPrivateTransaction.privateFor;
                tx.restriction = contract.deployPrivateTransaction.restriction;
            }
            else {
                errors.throwError("private transaction not sent as contract not yet deployed", errors.UNSUPPORTED_OPERATION, {
                    transaction: tx,
                    deployPrivateTransaction: contract.deployPrivateTransaction,
                    operation: "runPrivateMethod"
                });
            }
            if (options.transaction) {
                return properties_1.resolveProperties(tx);
            }
            if (!contract.signer) {
                errors.throwError("sending a private transaction require a signer", errors.UNSUPPORTED_OPERATION, { operation: "sendPrivateTransaction" });
            }
            return contract.signer.sendPrivateTransaction(tx).then(function (tx) {
                var wait = tx.wait.bind(tx);
                tx.wait = function (confirmations) {
                    return wait(confirmations).then(function (receipt) {
                        receipt.events = receipt.logs.map(function (log) {
                            var event = properties_1.deepCopy(log);
                            var parsed = contract.interface.parseLog(log);
                            if (parsed) {
                                event.values = parsed.values;
                                event.decode = function (data, topics) {
                                    return _this.interface.decodeEventLog(parsed.eventFragment, data, topics);
                                };
                                event.event = parsed.name;
                                event.eventSignature = parsed.signature;
                            }
                            event.removeListener = function () { return contract.provider; };
                            event.getPrivateTransaction = function () {
                                return contract.provider.getPrivateTransaction(tx.publicHash);
                            };
                            event.getPrivateTransactionReceipt = function () {
                                return Promise.resolve(receipt);
                            };
                            return event;
                        });
                        return receipt;
                    });
                };
                return tx;
            });
        });
    };
}
// TODO Raise Ether.js issue to have this exported from @ethersproject/contracts
// Recursively replaces ENS names with promises to resolve the name and resolves all properties
function resolveAddresses(signerOrProvider, value, paramType) {
    if (Array.isArray(paramType)) {
        return Promise.all(paramType.map(function (paramType, index) {
            return resolveAddresses(signerOrProvider, ((Array.isArray(value)) ? value[index] : value[paramType.name]), paramType);
        }));
    }
    if (paramType.type === "address") {
        return signerOrProvider.resolveName(value);
    }
    if (paramType.type === "tuple") {
        return resolveAddresses(signerOrProvider, value, paramType.components);
    }
    if (paramType.baseType === "array") {
        if (!Array.isArray(value)) {
            throw new Error("invalid value for array");
        }
        return Promise.all(value.map(function (v) { return resolveAddresses(signerOrProvider, v, paramType.arrayChildren); }));
    }
    return Promise.resolve(value);
}
var PrivateContractFactory = /** @class */ (function (_super) {
    __extends(PrivateContractFactory, _super);
    function PrivateContractFactory(contractInterface, bytecode, signer) {
        return _super.call(this, contractInterface, bytecode, signer) || this;
    }
    PrivateContractFactory.prototype.privateDeploy = function (privacyGroupOptions) {
        var _this = this;
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        return resolveAddresses(this.signer, args, this.interface.deploy.inputs).then(function (args) {
            // Get the deployment transaction (with optional overrides)
            var tx = _this.getDeployTransaction.apply(_this, args);
            var privateTx = __assign({}, tx, privacyGroupOptions);
            // Send the deployment transaction
            return _this.signer.sendPrivateTransaction(privateTx).then(function (deployedTx) {
                var address = (_this.constructor).getPrivateContractAddress(deployedTx);
                var contract = (_this.constructor).getPrivateContract(address, _this.interface, _this.signer);
                properties_1.defineReadOnly(contract, "deployPrivateTransaction", deployedTx);
                return contract;
            });
        });
    };
    PrivateContractFactory.getPrivateContract = function (address, contractInterface, signer) {
        return new PrivateContract(address, contractInterface, signer);
    };
    PrivateContractFactory.getPrivateContractAddress = function (transaction) {
        var from = null;
        try {
            from = address_1.getAddress(transaction.from);
        }
        catch (error) {
            errors.throwArgumentError("missing from address", "transaction", transaction);
        }
        var nonce = bytes_1.stripZeros(bytes_1.arrayify(transaction.nonce));
        // convert from object with privateFrom and privateFor properties to base64 from
        var privacyGroupId = privacyGroup_1.generatePrivacyGroup(transaction);
        // convert from base64 to hex
        var privacyGroupIdHex = Buffer.from(privacyGroupId, 'base64');
        return address_1.getAddress(bytes_1.hexDataSlice(keccak256_1.keccak256(rlp_1.encode([from, nonce, privacyGroupIdHex])), 12));
    };
    return PrivateContractFactory;
}(contracts_1.ContractFactory));
exports.PrivateContractFactory = PrivateContractFactory;