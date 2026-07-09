// holo-tron.mjs — the Tron wallet engine, hologram-native. WDK parity: @tetherto/wdk-wallet-tron.
// Tron reuses secp256k1 (the SAME curve/key as EVM), so derivation is BIP-44 m/44'/195'/0'/0/i; only the
// address encoding differs: keccak(pubkey)[-20:] prefixed with 0x41 and base58check-encoded ("T…").
//
// First principles (holospaces L5): a Tron tx is assembled by the node (createtransaction), but we never
// trust it — before signing we RE-DERIVE that the built raw_data pays exactly our recipient + amount AND
// that its txID == sha256(raw_data_hex). A node that returns a different recipient/amount is refused. The
// key never leaves this module; the wallet gates the send before calling it.
//
// Pure (Node-testable): base58check, address derivation, the verify-before-sign check. Network: getBalance,
// getTokenBalance, send (TronGrid REST). Isomorphic.

import { sha256, base58, secp256k1 } from "./wdk-crypto/wdk-crypto.bundle.mjs";
import { keccak256, bytesToHex, hexToBytes } from "./holo-eth.js";

const concat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0); const o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

// ── base58check (Tron address encoding) ──
export function base58check(payload) {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  return base58.encode(concat(payload, checksum));
}
export function base58checkDecode(s) {
  const full = base58.decode(s);
  return full.slice(0, full.length - 4);          // drop the 4-byte checksum (assumed valid for our own derivations)
}
// "T…" base58 address → 41-prefixed 21-byte hex (no 0x) for ABI/param use; and the bare 20-byte hex.
export const addrToHex41 = (b58) => bytesToHex(base58checkDecode(b58)).slice(2);
export const addrToHex20 = (b58) => bytesToHex(base58checkDecode(b58)).slice(4);   // drop "0x41"

// ── derive the Tron address from a secp256k1 private key (same key as EVM, different encoding) ──
export function tronAddress(priv) {
  const pub = secp256k1.getPublicKey(priv, false).subarray(1);     // 64-byte uncompressed (drop 0x04)
  const h20 = keccak256(pub).slice(-20);
  return base58check(concat(Uint8Array.of(0x41), h20));
}

// ── TronGrid REST helper (failover list) ──
function sources(apis) { return (Array.isArray(apis) ? apis : [apis]).filter(Boolean); }
async function post(apis, path, body, fetchImpl) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null); if (!f) throw new Error("no fetch");
  let err;
  for (const api of sources(apis)) {
    try { const r = await f(api + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return await r.json(); }
    catch (e) { err = e; }
  }
  throw err || new Error("all Tron endpoints failed");
}

// ── reads ──
export async function getBalance(addr, { apis, fetchImpl } = {}) {
  const j = await post(apis, "/wallet/getaccount", { address: addr, visible: true }, fetchImpl);
  return BigInt(j.balance || 0);                                    // sun (1 TRX = 1e6 sun)
}
export async function getTokenBalance(addr, contract, { apis, fetchImpl } = {}) {
  const parameter = "0".repeat(24) + addrToHex20(addr);            // address left-padded to a 32-byte word
  const j = await post(apis, "/wallet/triggerconstantcontract", { owner_address: addr, contract_address: contract, function_selector: "balanceOf(address)", parameter, visible: true }, fetchImpl);
  const hex = j.constant_result && j.constant_result[0];
  return hex ? BigInt("0x" + hex) : 0n;
}

// ── verify a node-built tx against our intent (Law L5) — pure, witnessable ──
const b58Maybe = (a) => (typeof a === "string" && a.startsWith("T")) ? a : base58check(hexToBytes("0x" + String(a)));
export function verifyBuiltTx(tx, { toAddr, amountSun }) {
  const c = tx && tx.raw_data && tx.raw_data.contract && tx.raw_data.contract[0] && tx.raw_data.contract[0].parameter && tx.raw_data.contract[0].parameter.value;
  if (!c) throw new Error("tron: built tx has no transfer contract — refusing");
  if (b58Maybe(c.to_address) !== toAddr) throw new Error("tron: built tx recipient ≠ requested — refusing");
  if (Number(c.amount) !== Number(amountSun)) throw new Error("tron: built tx amount ≠ requested — refusing");
  const txid = bytesToHex(sha256(hexToBytes("0x" + tx.raw_data_hex))).slice(2);
  if (txid !== tx.txID) throw new Error("tron: txID ≠ sha256(raw_data) — refusing");
  return true;
}

// ── send TRX: createtransaction (node) → VERIFY → sign → broadcast. The key never leaves this module. ──
export async function send({ priv, fromAddr, toAddr, amountSun, apis, fetchImpl }) {
  const tx = await post(apis, "/wallet/createtransaction", { owner_address: fromAddr, to_address: toAddr, amount: Number(amountSun), visible: true }, fetchImpl);
  if (tx.Error || tx.error) throw new Error("tron createtransaction: " + (tx.Error || tx.error));
  verifyBuiltTx(tx, { toAddr, amountSun });                        // L5: refuse a tx that doesn't match intent
  const digest = sha256(hexToBytes("0x" + tx.raw_data_hex));
  const sig = secp256k1.sign(digest, priv, { format: "recovered", lowS: true, prehash: false }); // [rec, r(32), s(32)]
  tx.signature = [bytesToHex(sig.subarray(1)).slice(2) + sig[0].toString(16).padStart(2, "0")];   // r‖s‖v
  const res = await post(apis, "/wallet/broadcasttransaction", tx, fetchImpl);
  if (!res.result && !res.txid) throw new Error("tron broadcast failed: " + JSON.stringify(res).slice(0, 160));
  return { txid: tx.txID, fee: 0n };
}

export default { base58check, base58checkDecode, addrToHex41, addrToHex20, tronAddress, getBalance, getTokenBalance, verifyBuiltTx, send };
