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
import { keccak256, keccak256Hex, bytesToHex as ethHex, hexToBytes, concatBytes, bytesFromQuantity, rlpEncode, txRaw, toChecksumAddress, Rpc, hashTypedData } from "./holo-eth.js";
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
// `rpcs` = the failover list (tried in order; the first to answer wins — no custodian, just public
// endpoints). `rpc` stays the primary for back-compat. New EVM chains are pure config.
export const CHAINS = {
  ethereum: { kind: "evm", name: "Ethereum", symbol: "ETH", decimals: 18, coinType: 60, chainId: 1, rpc: "https://ethereum-rpc.publicnode.com", rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com", "https://rpc.ankr.com/eth"], explorer: "https://etherscan.io", accent: "#627eea", coingecko: "ethereum" },
  base:     { kind: "evm", name: "Base",     symbol: "ETH", decimals: 18, coinType: 60, chainId: 8453, rpc: "https://base-rpc.publicnode.com", rpcs: ["https://base-rpc.publicnode.com", "https://base.llamarpc.com", "https://mainnet.base.org"], explorer: "https://basescan.org", accent: "#0052ff", coingecko: "ethereum" },
  arbitrum: { kind: "evm", name: "Arbitrum", symbol: "ETH", decimals: 18, coinType: 60, chainId: 42161, rpc: "https://arbitrum-one-rpc.publicnode.com", rpcs: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc", "https://rpc.ankr.com/arbitrum"], explorer: "https://arbiscan.io", accent: "#28a0f0", coingecko: "ethereum" },
  optimism: { kind: "evm", name: "Optimism", symbol: "ETH", decimals: 18, coinType: 60, chainId: 10, rpc: "https://optimism-rpc.publicnode.com", rpcs: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io", "https://rpc.ankr.com/optimism"], explorer: "https://optimistic.etherscan.io", accent: "#ff0420", coingecko: "ethereum" },
  polygon:  { kind: "evm", name: "Polygon",  symbol: "POL", decimals: 18, coinType: 60, chainId: 137, rpc: "https://polygon-bor-rpc.publicnode.com", rpcs: ["https://polygon-bor-rpc.publicnode.com", "https://polygon.llamarpc.com", "https://rpc.ankr.com/polygon"], explorer: "https://polygonscan.com", accent: "#8247e5", coingecko: "matic-network" },
  bsc:      { kind: "evm", name: "BNB Chain", symbol: "BNB", decimals: 18, coinType: 60, chainId: 56, rpc: "https://bsc-rpc.publicnode.com", rpcs: ["https://bsc-rpc.publicnode.com", "https://binance.llamarpc.com", "https://rpc.ankr.com/bsc"], explorer: "https://bscscan.com", accent: "#f0b90b", coingecko: "binancecoin" },
  avalanche:{ kind: "evm", name: "Avalanche", symbol: "AVAX", decimals: 18, coinType: 60, chainId: 43114, rpc: "https://avalanche-c-chain-rpc.publicnode.com", rpcs: ["https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc"], explorer: "https://snowtrace.io", accent: "#e84142", coingecko: "avalanche-2" },
  gnosis:   { kind: "evm", name: "Gnosis",   symbol: "xDAI", decimals: 18, coinType: 60, chainId: 100, rpc: "https://gnosis-rpc.publicnode.com", rpcs: ["https://gnosis-rpc.publicnode.com", "https://rpc.gnosischain.com"], explorer: "https://gnosisscan.io", accent: "#48a9a6", coingecko: "xdai" },
  linea:    { kind: "evm", name: "Linea",    symbol: "ETH", decimals: 18, coinType: 60, chainId: 59144, rpc: "https://linea-rpc.publicnode.com", rpcs: ["https://linea-rpc.publicnode.com", "https://rpc.linea.build"], explorer: "https://lineascan.build", accent: "#61dfff", coingecko: "ethereum" },
  scroll:   { kind: "evm", name: "Scroll",   symbol: "ETH", decimals: 18, coinType: 60, chainId: 534352, rpc: "https://scroll-rpc.publicnode.com", rpcs: ["https://scroll-rpc.publicnode.com", "https://rpc.scroll.io"], explorer: "https://scrollscan.com", accent: "#ffeeda", coingecko: "ethereum" },
  celo:     { kind: "evm", name: "Celo",     symbol: "CELO", decimals: 18, coinType: 60, chainId: 42220, rpc: "https://celo-rpc.publicnode.com", rpcs: ["https://celo-rpc.publicnode.com", "https://forno.celo.org"], explorer: "https://celoscan.io", accent: "#fcff52", coingecko: "celo" },
  blast:    { kind: "evm", name: "Blast",    symbol: "ETH", decimals: 18, coinType: 60, chainId: 81457, rpc: "https://blast-rpc.publicnode.com", rpcs: ["https://blast-rpc.publicnode.com", "https://rpc.blast.io"], explorer: "https://blastscan.io", accent: "#fcfc03", coingecko: "ethereum" },
  plasma:   { kind: "evm", name: "Plasma",   symbol: "XPL", decimals: 18, coinType: 60, chainId: 9745, rpc: "https://rpc.plasma.to", rpcs: ["https://rpc.plasma.to"], explorer: "https://plasmascan.to", accent: "#00d18f", coingecko: "plasma" },   // ADR-0068: the Tether-native, gas-abstracted USD₮0 stablecoin rail (eip155:9745)
  bitcoin:  { kind: "btc", name: "Bitcoin",  symbol: "BTC", decimals: 8, coinType: 0, network: "mainnet", explorer: "https://mempool.space", accent: "#f7931a", coingecko: "bitcoin" },
  solana:   { kind: "sol", name: "Solana",   symbol: "SOL", decimals: 9, coinType: 501, rpc: "https://api.mainnet-beta.solana.com", rpcs: ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"], explorer: "https://solscan.io", accent: "#14f195", coingecko: "solana" },
};
// Failover JSON-RPC: try each public endpoint in order; the first to answer wins (no custodian).
function failoverRpc(urls) {
  const list = (urls || []).filter(Boolean);
  return { async call(method, params) { let err; for (const u of list) { try { return await new Rpc(u).call(method, params); } catch (e) { err = e; } } throw err || new Error("all RPC endpoints failed"); } };
}
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
// EIP-712 typed-data signing (the dapp "sign-in / permit / order" digest) — client-side, no provider.
export function signEvmTypedData(typedData, priv) {
  const { yParity, r, s } = secpSign(hashTypedData(typedData), priv);
  return "0x" + r.slice(2) + s.slice(2) + (27 + yParity).toString(16).padStart(2, "0");
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

// ── Solana PDA / Associated Token Account + SPL TransferChecked (for SPL token SEND) ──────
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYS_PROGRAM = "11111111111111111111111111111111";
const PDA_MARKER = utf8("ProgramDerivedAddress");
const _hexOf = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const solOnCurve = (u8) => { try { ed25519.Point.fromHex(_hexOf(u8)); return true; } catch { return false; } };
// findProgramAddress(seeds[], programId) → [addressBase58, bump]. Identical to Solana's: hash
// seeds‖bump‖programId‖"ProgramDerivedAddress"; the first bump (255↓) whose hash is OFF the ed25519
// curve is the PDA (a PDA has no private key by construction).
export function findProgramAddress(seeds, programId) {
  const pid = base58.decode(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const h = new Uint8Array(sha256(concatBytes(...seeds, Uint8Array.of(bump), pid, PDA_MARKER)));
    if (!solOnCurve(h)) return [base58.encode(h), bump];
  }
  throw new Error("unable to find a PDA bump");
}
// the Associated Token Account for (owner, mint) under the SPL token program
export function ataAddress(owner, mint) {
  return findProgramAddress([base58.decode(owner), base58.decode(TOKEN_PROGRAM), base58.decode(mint)], ATA_PROGRAM)[0];
}
// a legacy message carrying TWO instructions so a send works even to a FRESH recipient:
//   1. ATA CreateIdempotent — creates the recipient's associated token account if it doesn't exist
//      (idempotent = a no-op if it already does; the sender funds the tiny rent).
//   2. SPL TransferChecked (#12) — moves `amount` of `mint` from the owner's ATA to the recipient's,
//      validating the mint + decimals on-chain.
export function splTransferMessage({ owner, sourceAta, destAta, recipient, mint, amount, decimals, recentBlockhash }) {
  // account keys, Solana-ordered: writable-signer · [readonly-signer] · writable-nonsigners · readonly-nonsigners
  const order = [owner, sourceAta, destAta, recipient, mint, SYS_PROGRAM, ATA_PROGRAM, TOKEN_PROGRAM];
  const ix = Object.fromEntries(order.map((k, i) => [k, i]));
  const header = Uint8Array.of(1, 0, 5);                          // 1 signer · 0 ro-signed · 5 ro-unsigned (recipient,mint,sys,ata,token)
  // ix1 — ATA CreateIdempotent (data [1]); accounts: funding, ata, wallet, mint, system, token
  const a1 = Uint8Array.of(ix[owner], ix[destAta], ix[recipient], ix[mint], ix[SYS_PROGRAM], ix[TOKEN_PROGRAM]);
  const i1 = concatBytes(Uint8Array.of(ix[ATA_PROGRAM]), shortvec(a1.length), a1, shortvec(1), Uint8Array.of(1));
  // ix2 — Token TransferChecked (data [12, amount u64le, decimals]); accounts: source, mint, dest, authority
  const d = new Uint8Array(10); d[0] = 12; new DataView(d.buffer).setBigUint64(1, BigInt(amount), true); d[9] = decimals & 0xff;
  const a2 = Uint8Array.of(ix[sourceAta], ix[mint], ix[destAta], ix[owner]);
  const i2 = concatBytes(Uint8Array.of(ix[TOKEN_PROGRAM]), shortvec(a2.length), a2, shortvec(d.length), d);
  return concatBytes(header, shortvec(order.length), ...order.map((k) => base58.decode(k)), base58.decode(recentBlockhash), shortvec(2), i1, i2);
}

// ── sign a pre-built Solana transaction (the Jupiter-swap seam) ───────────────────────────
// Jupiter (holo-jupiter.js) returns a fully-formed v0 VersionedTransaction with zeroed signature
// slots; the wallet fills ONLY its own slot. The private key never leaves WDK — holo-jupiter hands
// us base64 and gets signed base64 back. Works for legacy and v0 (the version byte sets bit 0x80).
const _b64ToBytes = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const _b64FromBytes = (u) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
const _shortvecDec = (buf, off) => { let v = 0, sh = 0, p = off; for (;;) { const b = buf[p++]; v |= (b & 0x7f) << sh; if (!(b & 0x80)) break; sh += 7; } return [v, p]; };
export function signSolanaRawTx(b64, priv, pub) {
  const bytes = _b64ToBytes(b64);
  const [sigCount, p1] = _shortvecDec(bytes, 0);
  const message = bytes.subarray(p1 + 64 * sigCount);
  const sigs = []; for (let i = 0; i < sigCount; i++) sigs.push(bytes.slice(p1 + 64 * i, p1 + 64 * i + 64));
  const versioned = (message[0] & 0x80) !== 0; let off = versioned ? 1 : 0;
  const numReqSig = message[off]; off += 3;                       // header: reqSig, roSigned, roUnsigned
  const [keyCount, kp] = _shortvecDec(message, off); off = kp;
  const want = base58.encode(pub); let slot = -1;
  for (let i = 0; i < keyCount; i++) { const k = message.subarray(off, off + 32); off += 32; if (i < numReqSig && base58.encode(k) === want) slot = i; }
  if (slot < 0) throw new Error("wallet key is not a required signer of this transaction");
  sigs[slot] = ed25519.sign(message, priv);
  return _b64FromBytes(concatBytes(shortvec(sigCount), ...sigs, message));
}

// A failover Solana source (.call) over a list of public RPCs — same no-custodian shape as failoverRpc.
export function solanaSource(urls) {
  const list = (urls || []).filter(Boolean);
  return { async call(m, p) { let e; for (const u of list) { try { return await new SolanaSource(u).call(m, p); } catch (x) { e = x; } } throw e || new Error("all Solana RPC endpoints failed"); } };
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
  const rpcList = () => manager._config.rpcs || c.rpcs || [manager._config.rpcUrl || c.rpc];
  const evmRpc = () => failoverRpc(rpcList());
  const solList = () => (manager._config.rpcs || c.rpcs || [manager._config.rpcUrl || c.rpc]).filter(Boolean);
  const sol = () => { const list = solList(); return { async call(m, p) { let e; for (const u of list) { try { return await new SolanaSource(u).call(m, p); } catch (x) { e = x; } } throw e; }, async balance(a) { let e; for (const u of list) { try { return await new SolanaSource(u).balance(a); } catch (x) { e = x; } } throw e; } }; };
  const acc = {
    index, path, _chain: chainKey, _kind: kind,
    get keyPair() { return { publicKey: pub, privateKey: priv }; },
    async getAddress() { return kind === "evm" ? evmAddress(priv) : kind === "btc" ? BTC.deriveAddress(priv, c.network) : solAddress(priv); },
    async sign(message) { return kind === "sol" ? signSolMessage(message, priv) : signEvmMessage(message, priv); },
    async signTypedData(typedData) { if (kind !== "evm") throw new Error("signTypedData (EIP-712) is EVM-only"); return signEvmTypedData(typedData, priv); },
    async signRawSolanaTx(b64) { if (kind !== "sol") throw new Error("signRawSolanaTx is Solana-only"); return signSolanaRawTx(b64, priv, pub); },
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
      if (kind === "evm") {
        const { encodeCall, decodeWord } = await import("./holo-eth.js");
        const data = encodeCall("balanceOf(address)", [await acc.getAddress()]);   // encodeCall already returns 0x-prefixed
        return decodeWord(await evmRpc().call("eth_call", [{ to: tokenAddress, data }, "latest"]), "uint256");
      }
      if (kind === "sol") {                                            // SPL: sum the owner's token accounts for this mint
        const res = await sol().call("getTokenAccountsByOwner", [await acc.getAddress(), { mint: tokenAddress }, { encoding: "jsonParsed" }]);
        let total = 0n; for (const a of (res?.value || [])) total += BigInt(a.account.data.parsed.info.tokenAmount.amount);
        return total;
      }
      throw new Error("getTokenBalance: unsupported chain kind " + kind);
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
    async transfer(options) {
      if (options.token) {
        if (kind === "evm") {                               // ERC-20 transfer(to,amount) via the existing ABI encoder
          const { encodeCall } = await import("./holo-eth.js");
          return acc.sendTransaction({ to: options.token, value: "0x0", data: encodeCall("transfer(address,uint256)", [options.recipient, options.amount]) });
        }
        if (kind === "sol") {                               // SPL TransferChecked: owner's ATA → recipient's ATA
          const src = sol(), owner = await acc.getAddress(), mint = options.token;
          const sourceAta = ataAddress(owner, mint), destAta = ataAddress(options.recipient, mint);
          let decimals = options.decimals;
          if (decimals == null) { const info = await src.call("getAccountInfo", [mint, { encoding: "jsonParsed" }]); decimals = info?.value?.data?.parsed?.info?.decimals ?? 0; }
          const { value } = await src.call("getLatestBlockhash", [{ commitment: "finalized" }]);
          const msg = splTransferMessage({ owner, sourceAta, destAta, recipient: options.recipient, mint, amount: options.amount, decimals, recentBlockhash: value.blockhash });
          const sig = ed25519.sign(msg, priv);
          const txBytes = concatBytes(shortvec(1), sig, msg);
          const hash = await src.call("sendTransaction", [btoa(String.fromCharCode(...txBytes)), { encoding: "base64", skipPreflight: false }]);
          return { hash, fee: 5000n };                      // NB: requires the recipient's ATA to exist (CreateIdempotent = a later refinement)
        }
        throw new Error("token transfer unsupported on " + kind);
      }
      return acc.sendTransaction({ to: options.recipient, value: options.amount });
    },
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
    if (c.kind === "evm") wdk.registerWallet(key, WalletManagerEVM, { chain: key, rpcUrl: c.rpc, rpcs: c.rpcs, chainId: c.chainId });
    else if (c.kind === "btc") wdk.registerWallet(key, WalletManagerBTC, { rpcUrl: c.rpc, rpcs: c.rpcs });
    else if (c.kind === "sol") wdk.registerWallet(key, WalletManagerSolana, { rpcUrl: c.rpc, rpcs: c.rpcs });
  }
  return wdk;
}

// ── price rates — USD prices from CoinGecko's public (no-key) API; nothing custodial ─────
export async function priceUsd(chainKeys = Object.keys(CHAINS), { fetchImpl } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null); if (!f) throw new Error("no fetch");
  const ids = [...new Set(chainKeys.map((k) => CHAINS[k]?.coingecko).filter(Boolean))];
  const r = await f(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`);
  const data = await r.json();
  const out = {}; for (const k of chainKeys) { const id = CHAINS[k]?.coingecko; out[k] = (id && data[id]) ? data[id].usd : null; } return out;
}

// ── transaction history — read-only, from PUBLIC explorers/indexers (no key where avoidable):
//    BTC → mempool.space · Solana → the chain's own RPC · EVM → the chain's block-explorer API.
//    Returns a normalised [{ hash, time, direction, counterparty, value, explorer }]. No custodian.
export async function history(chainKey, address, { limit = 25, fetchImpl } = {}) {
  const c = CHAINS[chainKey]; if (!c) throw new Error("unknown chain " + chainKey);
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null); if (!f) throw new Error("no fetch");
  const link = (h) => `${c.explorer}/${c.kind === "btc" ? "tx" : c.kind === "sol" ? "tx" : "tx"}/${h}`;
  if (c.kind === "btc") {
    const txs = await (await f(`${c.explorer}/api/address/${address}/txs`)).json();
    return (txs || []).slice(0, limit).map((t) => ({ hash: t.txid, time: t.status?.block_time || null, value: null, direction: null, counterparty: null, explorer: link(t.txid) }));
  }
  if (c.kind === "sol") {
    const res = await new SolanaSource((c.rpcs || [c.rpc])[0]).call("getSignaturesForAddress", [address, { limit }]);
    return (res || []).map((s) => ({ hash: s.signature, time: s.blockTime || null, value: null, direction: null, counterparty: null, explorer: link(s.signature) }));
  }
  // EVM: the explorer's public account txlist API (Etherscan/Blockscout family). Best-effort, no key.
  const api = c.explorer.replace("//", "//api.").replace("api.optimistic", "api-optimistic");
  const url = `${api}/api?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=${limit}`;
  try {
    const j = await (await f(url)).json();
    if (!Array.isArray(j.result)) return [];
    return j.result.slice(0, limit).map((t) => ({ hash: t.hash, time: t.timeStamp ? Number(t.timeStamp) : null, value: t.value, direction: t.from?.toLowerCase() === String(address).toLowerCase() ? "out" : "in", counterparty: t.from?.toLowerCase() === String(address).toLowerCase() ? t.to : t.from, explorer: link(t.hash) }));
  } catch { return []; }    // many explorers gate txlist behind a key — degrade gracefully (sovereign-first)
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
  // Boot directly from a seed the UNIFIED Holo Login vault already opened — so "your wallet just
  // opens" from the same identity, with no second vault or passphrase here (Holo Login owns the vault).
  async openSeed(seed) { await this._boot(seed, null); return { did: this.did }; }
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
  // EIP-712 typed-data signing (the dapp/exchange digest, e.g. a Hyperliquid action) — gated, default-deny.
  async signTypedData({ chain, typedData, index = 0 }) {
    if (!(await this._gate({ type: "signTypedData", chain, typedData, address: await this.address(chain, index) }))) throw new Error("Signature request denied");
    return (await this.account(chain, index)).signTypedData(typedData);
  }

  // Solana spot SWAP via Jupiter — the WDK Swidge seam's live provider. The route is untrusted:
  // holo-jupiter re-derives a min-out floor, asserts the sealed Jupiter program, and simulates BEFORE
  // the gate fires, so the human approves verified numbers. Then — and only then — the key signs.
  // `amount` is human decimal in the input token's units; `inputDecimals` defaults to SOL (9).
  async swap({ inputMint, outputMint, amount, slippageBps = 50, inputDecimals = CHAINS.solana.decimals, index = 0 }) {
    const { swap, JUPITER } = await import("./holo-jupiter.js");
    const acc = await this.account("solana", index);
    const userPublicKey = await acc.getAddress();
    const source = solanaSource(CHAINS.solana.rpcs || [CHAINS.solana.rpc]);
    const base = parseUnits(amount, inputDecimals).toString();           // → integer base units (Jupiter's unit)
    return swap({ inputMint, outputMint, amount: base, slippageBps, userPublicKey }, {
      source,
      sign: (b64) => acc.signRawSolanaTx(b64),
      approve: (info) => this._gate({ type: "swap", chain: "solana", venue: JUPITER.name, address: userPublicKey, inputMint, outputMint, amount: String(amount), ...info }),
    });
  }
}

export default HoloWallet;
