// holo-wdk.js — the Holo Wallet engine: Tether's Wallet Development Kit, hologram-native.
//
// First principles: a wallet IS content addressing. One BIP-39 seed deterministically PROJECTS
// (BIP-44 / SLIP-0010 HD derivation) to keys/addresses on every chain — the seed κ re-derives the
// same identity on any peer, and every derivation is re-checkable. That is holospaces Law L5
// ("verify by re-derivation"). So WDK is not bridged here; it is native.
//
// This module wires the VENDORED Tether WDK (./wdk — orchestrator + base classes + secret manager,
// see ./wdk/PROVENANCE.txt) onto:
//   • the audited scure/noble crypto WDK itself is built on (./wdk-crypto — BIP-39/32, SLIP-0010,
//     secp256k1/ed25519, secretbox), and
//   • the chain engines already proven in this OS: holo-eth (keccak/RLP/EIP-1559 envelopes + JSON-RPC),
//     btc-wallet (real P2WPKH segwit send over Esplora), holo-solana (ed25519 + Solana JSON-RPC).
// Faithful to WDK's documented WalletManager / IWalletAccount contracts; lean; UOR-native.
//
// Pure (Node-testable): the chain table, HD derivation, address/signature derivation, the secret
// manager, the vault κ, and the identity projection. Browser-only: OPFS/localStorage persistence,
// the human-approval gate UI, and live network reads/sends. Isomorphic, like the other holo-* modules.

import { WDK, WalletManager, WdkSecretManager, protocols } from "./wdk/index.js";
import { HDKey, SlipHDKey, secp256k1, ed25519, base58, generateMnemonic as _genMnemonic, validateMnemonic as _validMnemonic, wordlist, mnemonicToSeedSync, mnemonicToEntropy, entropyToMnemonic, sha256 } from "./wdk-crypto/wdk-crypto.bundle.mjs";
import { keccak256, keccak256Hex, bytesToHex as ethHex, hexToBytes, concatBytes, bytesFromQuantity, rlpEncode, txRaw, toChecksumAddress, Rpc } from "./holo-eth.js";
import * as BTC from "./btc-wallet/wallet.js";
import { SolanaSource } from "./holo-solana.js";

export { WDK, WalletManager, WdkSecretManager, protocols };

// ── byte utils ────────────────────────────────────────────────────────────────────────
const utf8 = (s) => new TextEncoder().encode(s);
const HEXC = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0"));
const toHex = (u) => { let s = ""; for (let i = 0; i < u.length; i++) s += HEXC[u[i]]; return s; };
const sha256hex = (u) => toHex(sha256(u));

// ── BIP-39 surface (faithful to the WDK orchestrator's static helpers) ──────────────────
export const generateMnemonic = (words = 12) => _genMnemonic(wordlist, words === 24 ? 256 : 128);
export const validateMnemonic = (m) => _validMnemonic(m, wordlist);
export const seedFromMnemonic = (m, passphrase = "") => mnemonicToSeedSync(m, passphrase);

// ── CHAINS — the declarative multi-chain table. BIP-44 coin types (SLIP-0044) + brand + RPC. ──
// `kind` selects the WalletManager; one EVM manager serves every EVM network (so "all EVM chains"
// come from one module). New chains (TON, Tron, Spark…) slot in here + a kind, nothing else.
export const CHAINS = {
  ethereum: { kind: "evm", name: "Ethereum", symbol: "ETH", decimals: 18, coinType: 60, chainId: 1, rpc: "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io", accent: "#627eea", coingecko: "ethereum" },
  base:     { kind: "evm", name: "Base",     symbol: "ETH", decimals: 18, coinType: 60, chainId: 8453, rpc: "https://base-rpc.publicnode.com", explorer: "https://basescan.org", accent: "#0052ff", coingecko: "ethereum" },
  arbitrum: { kind: "evm", name: "Arbitrum", symbol: "ETH", decimals: 18, coinType: 60, chainId: 42161, rpc: "https://arbitrum-one-rpc.publicnode.com", explorer: "https://arbiscan.io", accent: "#28a0f0", coingecko: "ethereum" },
  optimism: { kind: "evm", name: "Optimism", symbol: "ETH", decimals: 18, coinType: 60, chainId: 10, rpc: "https://optimism-rpc.publicnode.com", explorer: "https://optimistic.etherscan.io", accent: "#ff0420", coingecko: "ethereum" },
  polygon:  { kind: "evm", name: "Polygon",  symbol: "POL", decimals: 18, coinType: 60, chainId: 137, rpc: "https://polygon-bor-rpc.publicnode.com", explorer: "https://polygonscan.com", accent: "#8247e5", coingecko: "matic-network" },
  bsc:      { kind: "evm", name: "BNB Chain", symbol: "BNB", decimals: 18, coinType: 60, chainId: 56, rpc: "https://bsc-rpc.publicnode.com", explorer: "https://bscscan.com", accent: "#f0b90b", coingecko: "binancecoin" },
  bitcoin:  { kind: "btc", name: "Bitcoin",  symbol: "BTC", decimals: 8, coinType: 0, network: "mainnet", explorer: "https://mempool.space", accent: "#f7931a", coingecko: "bitcoin" },
  solana:   { kind: "sol", name: "Solana",   symbol: "SOL", decimals: 9, coinType: 501, rpc: "https://api.mainnet-beta.solana.com", explorer: "https://solscan.io", accent: "#14f195", coingecko: "solana" },
};
// BIP-44 paths per kind. EVM/BTC use BIP-32 (secp256k1); Solana uses SLIP-0010 (ed25519, all hardened).
const PATH = {
  evm: (i) => `m/44'/60'/0'/0/${i}`,
  btc: (i) => `m/84'/0'/0'/0/${i}`,        // BIP-84 native segwit
  sol: (i) => `m/44'/501'/${i}'/0'`,        // Phantom / solana-keygen convention
};

// ── low-level signers (pure, witnessable) ───────────────────────────────────────────────
// EVM: noble v2 defaults to prehash:true — we MUST pass prehash:false to sign the keccak hash
// directly. The "recovered" format is [recovery(1) ‖ r(32) ‖ s(32)].
function evmAddress(priv) { const pub = secp256k1.getPublicKey(priv, false).subarray(1); return toChecksumAddress(ethHex(keccak256(pub)).slice(-40)); }
function secpSign(hash32, priv) { const sig = secp256k1.sign(hash32, priv, { format: "recovered", lowS: true, prehash: false }); return { yParity: sig[0], r: "0x" + toHex(sig.subarray(1, 33)), s: "0x" + toHex(sig.subarray(33, 65)) }; }
// EIP-191 personal_sign
export function signEvmMessage(message, priv) {
  const m = typeof message === "string" ? utf8(message) : message;
  const hash = keccak256(concatBytes(utf8("\x19Ethereum Signed Message:\n" + m.length), m));
  const { yParity, r, s } = secpSign(hash, priv);
  return "0x" + r.slice(2) + s.slice(2) + (27 + yParity).toString(16).padStart(2, "0");
}
// EIP-1559 (type 2) signing → { raw, hash }. Unsigned body is type ‖ rlp(9 fields, no sig).
export function signEvmTx(tx, priv) {
  const Q = bytesFromQuantity, to = tx.to ? hexToBytes(tx.to) : new Uint8Array(0), data = hexToBytes(tx.data || tx.input || "0x");
  const body = [Q(tx.chainId), Q(tx.nonce), Q(tx.maxPriorityFeePerGas), Q(tx.maxFeePerGas), Q(tx.gas), to, Q(tx.value), data, []];
  const sighash = keccak256(concatBytes(Uint8Array.of(2), rlpEncode(body)));
  const { yParity, r, s } = secpSign(sighash, priv);
  const raw = ethHex(txRaw({ type: 2, chainId: tx.chainId, nonce: tx.nonce, maxPriorityFeePerGas: tx.maxPriorityFeePerGas, maxFeePerGas: tx.maxFeePerGas, gas: tx.gas, to: tx.to, value: tx.value, data: tx.data || "0x", accessList: [], yParity, r, s }));
  return { raw, hash: keccak256Hex(hexToBytes(raw)) };
}
// Solana signing
function solAddress(priv) { return base58.encode(ed25519.getPublicKey(priv)); }
export const signSolMessage = (message, priv) => base58.encode(ed25519.sign(typeof message === "string" ? utf8(message) : message, priv));

// Solana compact-u16 (shortvec) + a real System-program transfer message builder.
function shortvec(n) { const out = []; for (;;) { let b = n & 0x7f; n >>>= 7; if (n) { out.push(b | 0x80); } else { out.push(b); break; } } return Uint8Array.from(out); }
function solTransferMessage({ fromPub, toPub, lamports, recentBlockhash }) {
  const SYS = new Uint8Array(32); // System program id = all-zero pubkey (11111111111111111111111111111111)
  const keys = [fromPub, toPub, SYS];               // [signer/writable, writable, readonly]
  const header = Uint8Array.of(1, 0, 1);            // 1 required sig, 0 readonly-signed, 1 readonly-unsigned
  const data = new Uint8Array(12); data[0] = 2;     // System instruction #2 = Transfer
  new DataView(data.buffer).setBigUint64(4, BigInt(lamports), true);
  const ix = concatBytes(Uint8Array.of(2), shortvec(2), Uint8Array.of(0, 1), shortvec(data.length), data); // programIdIndex=2, accounts=[0,1]
  return concatBytes(header, shortvec(keys.length), ...keys, base58.decode(recentBlockhash), shortvec(1), ix);
}

// ── HD derivation helpers ───────────────────────────────────────────────────────────────
const seedBytes = (seed) => (typeof seed === "string" ? mnemonicToSeedSync(seed) : seed);
function deriveKey(kind, seed, index) {
  const sb = seedBytes(seed);
  if (kind === "sol") { const k = SlipHDKey.fromMasterSeed(sb).derive(PATH.sol(index)); return { priv: k.privateKey, pub: ed25519.getPublicKey(k.privateKey) }; }
  const k = HDKey.fromMasterSeed(sb).derive((kind === "btc" ? PATH.btc : PATH.evm)(index));
  return { priv: k.privateKey, pub: k.publicKey };
}
export function deriveAddress(chainKey, seed, index = 0) {
  const c = CHAINS[chainKey]; if (!c) throw new Error("unknown chain " + chainKey);
  const { priv } = deriveKey(c.kind, seed, index);
  return c.kind === "evm" ? evmAddress(priv) : c.kind === "btc" ? BTC.deriveAddress(priv, c.network) : solAddress(priv);
}
// Human decimal amount → on-chain base units (wei hex for EVM, sats/lamports number otherwise).
function parseUnits(amount, decimals) {
  const s = String(amount).trim(); const neg = s.startsWith("-");
  const [i, f = ""] = (neg ? s.slice(1) : s).split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  const big = BigInt((i || "0") + frac); return neg ? -big : big;
}
export function baseUnits(chainKey, amount) {
  const c = CHAINS[chainKey]; const big = parseUnits(amount, c.decimals);
  return c.kind === "evm" ? "0x" + big.toString(16) : Number(big);
}

// ── WDK wallet modules — faithful WalletManager subclasses (one per chain kind) ──────────
// Each implements getAccount(index)/getAccountByPath; accounts implement the IWalletAccount surface
// (getAddress/getBalance/sign/signTransaction/sendTransaction/transfer/verify/keyPair/dispose).
function makeAccount(manager, kind, chainKey, index) {
  const c = CHAINS[chainKey]; const path = (kind === "btc" ? PATH.btc : kind === "sol" ? PATH.sol : PATH.evm)(index);
  let { priv, pub } = deriveKey(kind, manager.seed, index);
  const evmRpc = () => new Rpc(manager._config.rpcUrl || c.rpc);
  const sol = () => new SolanaSource(manager._config.rpcUrl || c.rpc);
  const acc = {
    index, path, _chain: chainKey, _kind: kind,
    get keyPair() { return { publicKey: pub, privateKey: priv }; },
    async getAddress() { return kind === "evm" ? evmAddress(priv) : kind === "btc" ? BTC.deriveAddress(priv, c.network) : solAddress(priv); },
    async sign(message) { return kind === "sol" ? signSolMessage(message, priv) : signEvmMessage(message, priv); },
    async verify(message, signature) {
      if (kind === "sol") return ed25519.verify(base58.decode(signature), utf8(message), pub);
      return signEvmMessage(message, priv).toLowerCase() === String(signature).toLowerCase();
    },
    // reads (network)
    async getBalance() {
      if (kind === "evm") return BigInt(await evmRpc().call("eth_getBalance", [await acc.getAddress(), "latest"]));
      if (kind === "btc") { const b = await BTC.getBalance(await acc.getAddress(), c.network); return BigInt(b.confirmed); }
      return BigInt(await sol().balance(await acc.getAddress()));
    },
    async getTokenBalance(tokenAddress) {
      if (kind !== "evm") throw new Error("getTokenBalance is EVM-only in v1");
      const { encodeCall, decodeWord } = await import("./holo-eth.js");
      const data = encodeCall("balanceOf(address)", [await acc.getAddress()]);
      return decodeWord(await evmRpc().call("eth_call", [{ to: tokenAddress, data: "0x" + data }, "latest"]), "uint256");
    },
    // signing (offline, witnessable)
    async signTransaction(tx) {
      if (kind === "evm") return signEvmTx({ chainId: c.chainId, ...tx }, priv);
      throw new Error("signTransaction(tx) building is EVM-only in v1; use sendTransaction for btc/sol");
    },
    // writes (network) — the seam/UI gates these BEFORE calling.
    async sendTransaction(tx) {
      if (kind === "evm") {
        const rpc = evmRpc(), from = await acc.getAddress();
        const nonce = tx.nonce ?? Number(BigInt(await rpc.call("eth_getTransactionCount", [from, "pending"])));
        const gas = tx.gas ?? "0x5208"; // 21000
        const maxFeePerGas = tx.maxFeePerGas ?? await rpc.call("eth_gasPrice", []);
        const maxPriorityFeePerGas = tx.maxPriorityFeePerGas ?? "0x59682f00"; // 1.5 gwei
        const signed = signEvmTx({ chainId: c.chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to: tx.to, value: tx.value || "0x0", data: tx.data || "0x" }, priv);
        const hash = await rpc.call("eth_sendRawTransaction", [signed.raw]);
        return { hash, fee: 0n };
      }
      if (kind === "btc") {
        const r = await BTC.send({ priv, toAddr: tx.to, amountSats: Number(tx.value), netKey: c.network, rate: tx.feeRate });
        return { hash: r.txid, fee: BigInt(r.fee) };
      }
      // solana: build + sign + submit a real System transfer
      const src = sol(), from = await acc.getAddress();
      const { value } = await src.call("getLatestBlockhash", [{ commitment: "finalized" }]);
      const msg = solTransferMessage({ fromPub: pub, toPub: base58.decode(tx.to), lamports: Number(tx.value), recentBlockhash: value.blockhash });
      const sig = ed25519.sign(msg, priv);
      const txBytes = concatBytes(shortvec(1), sig, msg);
      const b64 = btoa(String.fromCharCode(...txBytes));
      const hash = await src.call("sendTransaction", [b64, { encoding: "base64", skipPreflight: false }]);
      return { hash, fee: 5000n };
    },
    async transfer(options) { return acc.sendTransaction({ to: options.recipient, value: options.amount, data: options.token ? undefined : undefined }); },
    async quoteSendTransaction(tx) { return { fee: kind === "evm" ? 21000n : kind === "btc" ? 1000n : 5000n }; },
    async getTransactionReceipt(hash) { if (kind === "evm") return evmRpc().call("eth_getTransactionReceipt", [hash]); return null; },
    async toReadOnlyAccount() { return { getAddress: acc.getAddress, getBalance: acc.getBalance }; },
    dispose() { if (priv) priv.fill(0); priv = null; },
  };
  return acc;
}
function chainManager(kind) {
  return class extends WalletManager {
    async getAccount(index = 0) { const p = (kind === "btc" ? PATH.btc : kind === "sol" ? PATH.sol : PATH.evm)(index); this._accounts[p] ??= makeAccount(this, kind, this._chainKey, index); return this._accounts[p]; }
    async getAccountByPath(path) { const i = parseInt(String(path).match(/(\d+)'?\/?\d*'?$/)?.[1] ?? "0", 10); return this.getAccount(i); }
    async getFeeRates() { return { normal: 1n, fast: 2n }; }
  };
}
// Bind each manager to its CHAINS key (config carries rpcUrl/chainId at registration time).
class WalletManagerEVM extends chainManager("evm") { constructor(seed, config = {}) { super(seed, config); this._chainKey = config.chain || "ethereum"; } }
class WalletManagerBTC extends chainManager("btc") { constructor(seed, config = {}) { super(seed, config); this._chainKey = "bitcoin"; } }
class WalletManagerSolana extends chainManager("sol") { constructor(seed, config = {}) { super(seed, config); this._chainKey = "solana"; } }
export { WalletManagerEVM, WalletManagerBTC, WalletManagerSolana };

// ── makeWDK — a WDK orchestrator with every chain in CHAINS registered (faithful usage) ──
export function makeWDK(seed, { chains = Object.keys(CHAINS) } = {}) {
  const wdk = new WDK(seed);
  for (const key of chains) {
    const c = CHAINS[key]; if (!c) continue;
    if (c.kind === "evm") wdk.registerWallet(key, WalletManagerEVM, { chain: key, rpcUrl: c.rpc, chainId: c.chainId });
    else if (c.kind === "btc") wdk.registerWallet(key, WalletManagerBTC, { rpcUrl: c.rpc });
    else if (c.kind === "sol") wdk.registerWallet(key, WalletManagerSolana, { rpcUrl: c.rpc });
  }
  return wdk;
}

// ── UOR vault — the encrypted seed, content-addressed (Law L1/L5) ───────────────────────
// A vault is { v, salt, iterations, encryptedSeed, encryptedEntropy, createdAt } with the
// secret-manager wire format inside. Its κ = sha256(canonical bytes) is the one-link backup handle.
export async function createVault(mnemonic, passphrase) {
  const salt = WdkSecretManager.generateSalt();
  const sm = new WdkSecretManager(passphrase, salt);
  const entropy = mnemonicToEntropy(mnemonic, wordlist);
  const { encryptedSeed, encryptedEntropy } = await sm.generateAndEncrypt(entropy);
  sm.dispose();
  return { v: 2, salt: toHex(salt), iterations: 100000, encryptedSeed: toHex(encryptedSeed), encryptedEntropy: toHex(encryptedEntropy), createdAt: Date.now() };
}
export function openVault(vault, passphrase) {
  const sm = new WdkSecretManager(passphrase, hexToBytes(vault.salt), { iterations: vault.iterations });
  const seed = sm.decrypt(hexToBytes(vault.encryptedSeed));            // 64-byte BIP-39 seed
  const entropy = sm.decrypt(hexToBytes(vault.encryptedEntropy));     // 16-byte entropy
  sm.dispose();
  return { seed, mnemonic: entropyToMnemonic(entropy, wordlist) };
}
export const vaultKappa = (vault) => "sha256:" + sha256hex(utf8(JSON.stringify({ v: vault.v, salt: vault.salt, iterations: vault.iterations, encryptedSeed: vault.encryptedSeed, encryptedEntropy: vault.encryptedEntropy })));
export const vaultLink = (vault) => "holo://" + sha256hex(utf8(JSON.stringify({ v: vault.v, salt: vault.salt, iterations: vault.iterations, encryptedSeed: vault.encryptedSeed, encryptedEntropy: vault.encryptedEntropy })));

// ── identity unification — one seed projects to the OS first-party Ed25519 did:key ──────
// The same key Holo Terms / Holo Privacy use (did:key:z…, multicodec 0xed01 + base58btc). Derived
// SLIP-0010 at the reserved identity path so re-deriving the seed reproduces the OS identity.
const IDENTITY_PATH = "m/44'/0'/0'";
const PKCS8_ED25519_PREFIX = hexToBytes("302e020100300506032b657004220420");
export function identity(seed) {
  const k = SlipHDKey.fromMasterSeed(seedBytes(seed)).derive(IDENTITY_PATH);
  const pub = ed25519.getPublicKey(k.privateKey);
  const did = "did:key:z" + base58.encode(concatBytes(Uint8Array.of(0xed, 0x01), pub));
  const pkcs8 = concatBytes(PKCS8_ED25519_PREFIX, k.privateKey);     // DER for WebCrypto importKey("pkcs8")
  return { did, publicKeyRaw: pub, pkcs8 };
}

// ── HoloWallet — the app-facing controller: vault + WDK + the human-approval signing gate ──
// Storage + gate are injected so the engine stays pure for the witness. wallet.html installs an
// OPFS/localStorage store and a real consent-modal gate; the witness injects a Map + an auto policy.
const memStore = () => { const m = new Map(); return { async get(k) { return m.get(k) ?? null; }, async set(k, v) { m.set(k, v); }, async del(k) { m.delete(k); } }; };
const CUR = "holo-wallet:current";
export class HoloWallet {
  constructor({ store = memStore(), gate = async () => false, chains } = {}) { this._store = store; this._gate = gate; this._chains = chains; this._seed = null; this._wdk = null; this._vault = null; }
  static generateMnemonic = generateMnemonic;
  static validateMnemonic = validateMnemonic;
  get unlocked() { return !!this._seed; }
  get chains() { return this._chains || Object.keys(CHAINS); }
  setGate(fn) { this._gate = fn; }

  async create(passphrase, mnemonic = generateMnemonic(12)) {
    if (!validateMnemonic(mnemonic)) throw new Error("invalid mnemonic");
    const vault = await createVault(mnemonic, passphrase);
    await this._store.set(vaultKappa(vault), JSON.stringify(vault));
    await this._store.set(CUR, vaultKappa(vault));
    await this._boot(openVault(vault, passphrase).seed, vault);
    return { mnemonic, vaultLink: vaultLink(vault), did: this.did };
  }
  async hasVault() { return !!(await this._store.get(CUR)); }
  async unlock(passphrase) {
    const cur = await this._store.get(CUR); if (!cur) throw new Error("no vault");
    const vault = JSON.parse(await this._store.get(cur));
    await this._boot(openVault(vault, passphrase).seed, vault); // throws if wrong passphrase (auth)
    return { did: this.did, vaultLink: vaultLink(vault) };
  }
  async importVault(vault, passphrase) { await this._store.set(vaultKappa(vault), JSON.stringify(vault)); await this._store.set(CUR, vaultKappa(vault)); return this.unlock(passphrase); }
  async _boot(seed, vault) { this._seed = seed; this._vault = vault; this._wdk = makeWDK(seed, { chains: this._chains }); }
  lock() { if (this._seed) this._seed.fill(0); this._seed = null; this._wdk = null; }

  get did() { return this._seed ? identity(this._seed).did : null; }
  get vaultLinkValue() { return this._vault ? vaultLink(this._vault) : null; }
  identity() { if (!this._seed) throw new Error("locked"); return identity(this._seed); }

  async account(chain, index = 0) { if (!this._wdk) throw new Error("locked"); return this._wdk.getAccount(chain, index); }
  async address(chain, index = 0) { return deriveAddress(chain, this._seed, index); }
  async addresses(index = 0) { const out = {}; for (const c of this.chains) out[c] = deriveAddress(c, this._seed, index); return out; }
  async balance(chain, index = 0) { return (await this.account(chain, index)).getBalance(); }

  // Gated spend: every send/sign that moves value or authorizes is routed through the consent gate
  // BEFORE a signature is produced. Default-deny — no signature without explicit human approval.
  async send({ chain, to, amount, token, index = 0 }) {
    const req = { type: token ? "transfer" : "send", chain, to, amount: String(amount), token, address: await this.address(chain, index) };
    if (!(await this._gate(req))) throw new Error("Signature request denied");
    const acc = await this.account(chain, index);
    const value = baseUnits(chain, amount);
    return token ? acc.transfer({ token, recipient: to, amount: value }) : acc.sendTransaction({ to, value });
  }
  async signMessage({ chain, message, index = 0 }) {
    if (!(await this._gate({ type: "sign", chain, message, address: await this.address(chain, index) }))) throw new Error("Signature request denied");
    return (await this.account(chain, index)).sign(message);
  }
}

export default HoloWallet;
