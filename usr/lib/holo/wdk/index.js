// index.js — the single entry Holo Wallet imports the vendored Tether WDK through.
// Re-exports the upstream orchestrator + base classes + protocol bases (vendored verbatim,
// see vendor.mjs / PROVENANCE.txt) and the byte-compatible secret manager.
export { default as WDK } from "./core/index.js";                         // the orchestrator (registerWallet/getAccount/…)
export { default as WalletManager, WalletAccountReadOnly, IWalletAccountReadOnly, IWalletAccount, NotImplementedError } from "./wallet/index.js";
export * as protocols from "./wallet/src/protocols/index.js";             // Swap/Bridge/Lending/Fiat/Swidge bases
export { default as WdkSecretManager } from "./wdk-secret-manager.js";
