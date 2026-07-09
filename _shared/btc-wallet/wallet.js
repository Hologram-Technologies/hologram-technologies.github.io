// wallet.js — a real, self-custodial Bitcoin wallet, entirely in the browser.
//
// Keys are generated and signed on-device with the audited scure-btc-signer /
// noble-curves stack (vendored, no CDN). Addresses are real native-segwit
// (P2WPKH, bech32). Balance, history, UTXOs and broadcast use the Esplora REST
// API (mempool.space) — the wallet is a real light client. Nothing here is
// simulated: a generated address can receive real BTC, and `send()` builds,
// signs and broadcasts a real transaction.
//
// Default network is **testnet** so the full send/sign/broadcast path is proven
// with free coins before any mainnet funds are touched.

import * as L from "./btc-lib.js";

export const NETWORKS = {
  testnet: { name: "testnet", net: L.btc.TEST_NETWORK, api: "https://mempool.space/testnet/api", explorer: "https://mempool.space/testnet", hrp: "tb", faucet: "https://mempool.space/testnet/faucet", coin: "tBTC" },
  mainnet: { name: "mainnet", net: L.btc.NETWORK, api: "https://mempool.space/api", explorer: "https://mempool.space", hrp: "bc", faucet: null, coin: "BTC" },
};

const enc = (u8) => L.hex.encode(u8);
const dec = (hex) => L.hex.decode(hex);
const pubOf = (priv) => L.secp256k1.getPublicKey(priv, true);

export function newKey() { return L.secp256k1.utils.randomSecretKey(); }
export function deriveAddress(priv, netKey) { return L.btc.p2wpkh(pubOf(priv), NETWORKS[netKey].net).address; }
export function toWIF(priv, netKey) { return L.btc.WIF(NETWORKS[netKey].net).encode(priv); }
export function privHex(priv) { return enc(priv); }

// import a secret as WIF (mainnet or testnet) or as 64-char hex; returns {priv, netKey?}
export function importSecret(text) {
  const t = String(text).trim();
  if (/^[0-9a-fA-F]{64}$/.test(t)) return { priv: dec(t.toLowerCase()) };
  for (const k of ["mainnet", "testnet"]) {
    try { const priv = L.btc.WIF(NETWORKS[k].net).decode(t); return { priv, netKey: k }; } catch {}
  }
  throw new Error("not a valid WIF or 64-char hex key");
}

export function isValidAddress(addr, netKey) {
  try { L.btc.Address(NETWORKS[netKey].net).decode(addr); return true; } catch { return false; }
}

// ── chain reads (Esplora) ─────────────────────────────────────────────────────
async function api(netKey, path, opts) {
  const r = await fetch(NETWORKS[netKey].api + path, opts);
  if (!r.ok) throw new Error((await r.text()) || ("HTTP " + r.status));
  const ct = r.headers.get("content-type") || "";
  return ct.includes("json") ? r.json() : r.text();
}
export async function getBalance(addr, netKey) {
  const a = await api(netKey, "/address/" + addr);
  const c = a.chain_stats, m = a.mempool_stats;
  return { confirmed: c.funded_txo_sum - c.spent_txo_sum, pending: m.funded_txo_sum - m.spent_txo_sum, txCount: c.tx_count + m.tx_count };
}
export async function getHistory(addr, netKey) {
  const txs = await api(netKey, "/address/" + addr + "/txs");
  return txs.map((t) => {
    let inSum = 0, outSum = 0;
    for (const v of t.vin) if (v.prevout && v.prevout.scriptpubkey_address === addr) inSum += v.prevout.value;
    for (const o of t.vout) if (o.scriptpubkey_address === addr) outSum += o.value;
    const net = outSum - inSum;                       // +received / -sent (excl. fee precision)
    return { txid: t.txid, net, confirmed: !!(t.status && t.status.confirmed), time: t.status && t.status.block_time, dir: net >= 0 ? "in" : "out" };
  });
}
export async function getUtxos(addr, netKey) { return api(netKey, "/address/" + addr + "/utxo"); }
export async function feeRate(netKey) { try { const f = await api(netKey, "/v1/fees/recommended"); return Math.max(1, f.halfHourFee || f.economyFee || 1); } catch { return 2; } }

// ── send: build + sign + broadcast a REAL transaction ─────────────────────────
export async function send({ priv, toAddr, amountSats, netKey, rate }) {
  const n = NETWORKS[netKey];
  const pub = pubOf(priv);
  const spk = L.btc.p2wpkh(pub, n.net);
  const from = spk.address;
  const target = BigInt(amountSats);
  if (target <= 0n) throw new Error("amount must be positive");
  if (!isValidAddress(toAddr, netKey)) throw new Error("recipient is not a valid " + netKey + " address");
  const feeR = BigInt(Math.max(1, rate || (await feeRate(netKey))));

  const all = (await getUtxos(from, netKey)).filter((u) => u.status && u.status.confirmed).sort((a, b) => b.value - a.value);
  if (!all.length) throw new Error("no confirmed coins to spend");

  // accumulate largest-first until amount + fee is covered
  const sel = []; let inSum = 0n, fee = 0n;
  const estFee = (nIn, nOut) => BigInt(11 + nIn * 68 + nOut * 31) * feeR;     // P2WPKH vbytes
  for (const u of all) {
    sel.push(u); inSum += BigInt(u.value);
    fee = estFee(sel.length, 2);
    if (inSum >= target + fee) break;
  }
  fee = estFee(sel.length, 2);
  if (inSum < target + fee) throw new Error("insufficient funds — need " + (target + fee) + " sats, have " + inSum);

  const tx = new L.btc.Transaction();
  for (const u of sel) tx.addInput({ txid: dec(u.txid), index: u.vout, witnessUtxo: { script: spk.script, amount: BigInt(u.value) } });
  tx.addOutputAddress(toAddr, target, n.net);
  let change = inSum - target - fee;
  if (change > 546n) tx.addOutputAddress(from, change, n.net);                 // else give dust to fee
  else { change = 0n; fee = inSum - target; }

  tx.sign(priv); tx.finalize();
  const raw = enc(tx.extract());
  const txid = await api(netKey, "/tx", { method: "POST", headers: { "content-type": "text/plain" }, body: raw });
  return { txid: String(txid).trim(), fee: Number(fee), inputs: sel.length, change: Number(change) };
}

// ── QR (SVG, no canvas) ───────────────────────────────────────────────────────
export function qrSvg(text) { const q = L.qrcode(0, "M"); q.addData(String(text)); q.make(); return q.createSvgTag({ cellSize: 4, margin: 1, scalable: true }); }

// the BIP173 reference vector — used by the witness to prove correct derivation
export const REF = { priv: "0000000000000000000000000000000000000000000000000000000000000001", mainnet: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", testnet: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx" };
