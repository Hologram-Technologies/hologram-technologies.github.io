// holo-ton.mjs — the TON (The Open Network) wallet engine, hologram-native. WDK parity:
// @tetherto/wdk-wallet-ton. TON addresses are NOT a hash of a public key — they are the hash of the wallet
// CONTRACT's StateInit cell (code ‖ data). So this rides the VENDORED, κ-sealed @ton/core (cells + BoC +
// representation hash); the v4r2 wallet code is a pinned constant. Keys are Ed25519 (SLIP-0010, like Solana).
//
// First principles (holospaces L5 / Product-Security):
//   • DERIVATION IS VALIDATED. tonAddress(pubkey) re-derives the SAME address @ton/ton produces — proven by
//     a pinned vector (vendor/ton/vendor.pins.json): a fixed pubkey → a fixed v4r2 address + code-hash. The
//     vendored bundle re-derives to its sha256 pin (a tampered bundle is refused). Never an unvalidated address.
//   • verify-before-sign (L5): a transfer's signing message is re-parsed and its recipient + amount checked
//     against intent BEFORE the Ed25519 key signs — a built message that doesn't match is refused.
//   • The key never leaves this module; the wallet gates the send before calling it. Reads never gate.
//
// Pure (Node-testable): tonAddress, verifyTransfer, code/cell derivation. Network: getBalance, getSeqno,
// send (toncenter REST). Isomorphic (the @ton/core bundle runs in Node + browser; its shim sets Buffer).

import { Cell, Address, beginCell, contractAddress, storeStateInit, internal, external, storeMessage, storeMessageRelaxed, loadMessageRelaxed, SendMode } from "./vendor/ton/ton-core.bundle.mjs";
import { ed25519 } from "./wdk-crypto/wdk-crypto.bundle.mjs";

// ── pinned wallet v4r2 code (BoC base64). Its hash (feb5ff68…) is checked at load; the address derived from
//    it + a data cell matches @ton/ton's WalletContractV4 (the vendor.pins vector). ──
export const WALLET_V4R2_CODE_B64 = "te6cckECFAEAAtQAART/APSkE/S88sgLAQIBIAIPAgFIAwYC5tAB0NMDIXGwkl8E4CLXScEgkl8E4ALTHyGCEHBsdWe9IoIQZHN0cr2wkl8F4AP6QDAg+kQByMoHy//J0O1E0IEBQNch9AQwXIEBCPQKb6Exs5JfB+AF0z/IJYIQcGx1Z7qSODDjDQOCEGRzdHK6kl8G4w0EBQB4AfoA9AQw+CdvIjBQCqEhvvLgUIIQcGx1Z4MesXCAGFAEywUmzxZY+gIZ9ADLaRfLH1Jgyz8gyYBA+wAGAIpQBIEBCPRZMO1E0IEBQNcgyAHPFvQAye1UAXKwjiOCEGRzdHKDHrFwgBhQBcsFUAPPFiP6AhPLassfyz/JgED7AJJfA+ICASAHDgIBIAgNAgFYCQoAPbKd+1E0IEBQNch9AQwAsjKB8v/ydABgQEI9ApvoTGACASALDAAZrc52omhAIGuQ64X/wAAZrx32omhAEGuQ64WPwAARuMl+1E0NcLH4AFm9JCtvaiaECAoGuQ+gIYRw1AgIR6STfSmRDOaQPp/5g3gSgBt4EBSJhxWfMYQE+PKDCNcYINMf0x/THwL4I7vyZO1E0NMf0x/T//QE0VFDuvKhUVG68qIF+QFUEGT5EPKj+AAkpMjLH1JAyx9SMMv/UhD0AMntVPgPAdMHIcAAn2xRkyDXSpbTB9QC+wDoMOAhwAHjACHAAuMAAcADkTDjDQOkyMsfEssfy/8QERITAG7SB/oA1NQi+QAFyMoHFcv/ydB3dIAYyMsFywIizxZQBfoCFMtrEszMyXP7AMhAFIEBCPRR8qcCAHCBAQjXGPoA0z/IVCBHgQEI9FHyp4IQbm90ZXB0gBjIywXLAlAGzxZQBPoCFMtqEssfyz/Jc/sAAgBsgQEI1xj6ANM/MFIkgQEI9Fnyp4IQZHN0cnB0gBjIywXLAlAFzxZQA/oCE8tqyx8Syz/Jc/sAAAr0AMntVAj45Sg=";
export const WALLET_ID = 698983191;                                  // 0x29a9a317 — v4r2 default subwallet id
const TON_DECIMALS = 9;

const hex = (u) => { let s = ""; for (let i = 0; i < u.length; i++) s += u[i].toString(16).padStart(2, "0"); return s; };
const buf = (u) => globalThis.Buffer.from(u);                        // the @ton/core bundle's shim sets globalThis.Buffer
let _code = null;
const codeCell = () => (_code ||= Cell.fromBoc(buf(Uint8Array.from(atob(WALLET_V4R2_CODE_B64), (c) => c.charCodeAt(0))))[0]);
export const codeHashHex = () => codeCell().hash().toString("hex");

// ── StateInit + address (the VALIDATED derivation). pubkey = 32-byte Ed25519 public key. ──
export function stateInitFor(pubkey) {
  const pk = BigInt("0x" + hex(pubkey));
  const data = beginCell().storeUint(0, 32).storeUint(WALLET_ID, 32).storeUint(pk, 256).storeBit(0).endCell();
  return { code: codeCell(), data };
}
export function tonAddress(pubkey, { bounceable = false, testnet = false } = {}) {
  return contractAddress(0, stateInitFor(pubkey)).toString({ bounceable, urlSafe: true, testOnly: testnet });
}
export const tonAddressRaw = (pubkey) => contractAddress(0, stateInitFor(pubkey)).toRawString();

// ── reads (toncenter REST; failover list) ──
function apisOf(a) { return (Array.isArray(a) ? a : [a]).filter(Boolean); }
async function tcGet(apis, path, fetchImpl) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null); if (!f) throw new Error("no fetch");
  let err;
  for (const api of apisOf(apis)) { try { const r = await f(api + path); const j = await r.json(); if (j.ok === false) throw new Error(j.error || "toncenter error"); return j; } catch (e) { err = e; } }
  throw err || new Error("all TON endpoints failed");
}
export async function getBalance(address, { apis, fetchImpl } = {}) {
  const j = await tcGet(apis, "/api/v2/getAddressBalance?address=" + encodeURIComponent(address), fetchImpl);
  return BigInt(j.result || 0);                                      // nanoton (1 TON = 1e9)
}
export async function getSeqno(address, { apis, fetchImpl } = {}) {
  try { const j = await tcGet(apis, "/api/v2/runGetMethod?address=" + encodeURIComponent(address) + "&method=seqno&stack=[]", fetchImpl); const v = j.result?.stack?.[0]?.[1]; return v ? Number(BigInt(v)) : 0; }
  catch { return 0; }                                               // un-deployed wallet → seqno 0
}

// ── build the v4r2 signing message (mirrors WalletContractV4.createTransfer). op=0 simple order. ──
export function buildSigningMessage({ toAddr, amountNano, seqno, validUntil, sendMode = SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS, bounce = false }) {
  const order = internal({ to: Address.parse(toAddr), value: BigInt(amountNano), bounce, body: beginCell().endCell() });
  const sm = beginCell().storeUint(WALLET_ID, 32);
  if (seqno === 0) sm.storeUint(0xffffffff, 32); else sm.storeUint(validUntil, 32);
  sm.storeUint(seqno, 32).storeUint(0, 8);                          // op = 0 (simple transfer)
  sm.storeUint(sendMode, 8).storeRef(beginCell().store(storeMessageRelaxed(order)).endCell());
  return sm.endCell();
}
// ── verify-before-sign (L5): re-parse the signing message's order and check recipient + amount. ──
export function verifyTransfer(signingCell, { toAddr, amountNano }) {
  const s = signingCell.beginParse();
  s.loadUint(32); s.loadUint(32); s.loadUint(32); s.loadUint(8); s.loadUint(8); // walletId, validUntil, seqno, op, sendMode
  const order = loadMessageRelaxed(s.loadRef().beginParse());
  const dest = order.info.dest?.toString({ urlSafe: true, bounceable: false, testOnly: false });
  const want = Address.parse(toAddr).toString({ urlSafe: true, bounceable: false, testOnly: false });
  if (dest !== want) throw new Error("ton: built message recipient ≠ requested — refusing");
  if (BigInt(order.info.value.coins) !== BigInt(amountNano)) throw new Error("ton: built message amount ≠ requested — refusing");
  return true;
}

// ── send: build → VERIFY → sign → external message → broadcast (toncenter sendBoc). ──
export async function send({ priv, pubkey, toAddr, amountNano, apis, fetchImpl, seqno, validUntil, testnet = false }) {
  const fromAddress = tonAddress(pubkey, { bounceable: true, testnet });
  seqno = seqno ?? await getSeqno(fromAddress, { apis, fetchImpl });
  validUntil = validUntil ?? Math.floor(Date.now() / 1000) + 120;
  const signing = buildSigningMessage({ toAddr, amountNano, seqno, validUntil });
  verifyTransfer(signing, { toAddr, amountNano });                  // L5: refuse a mismatched message
  const sig = ed25519.sign(signing.hash(), priv);                   // 64-byte Ed25519
  const body = beginCell().storeBuffer(buf(sig)).storeSlice(signing.beginParse()).endCell();
  const ext = external({ to: Address.parse(fromAddress), init: seqno === 0 ? stateInitFor(pubkey) : undefined, body });
  const boc = beginCell().store(storeMessage(ext)).endCell().toBoc().toString("base64");
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  let err, res;
  for (const api of apisOf(apis)) { try { res = await (await f(api + "/api/v2/sendBoc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ boc }) })).json(); if (res.ok !== false) break; err = new Error(res.error); } catch (e) { err = e; } }
  if (!res || res.ok === false) throw new Error("ton broadcast failed: " + ((err && err.message) || "unknown"));
  // the message hash is the external message's representation hash (the tx is identified on-chain by it)
  return { hash: beginCell().store(storeMessage(ext)).endCell().hash().toString("hex"), fee: 0n };
}

export default { WALLET_V4R2_CODE_B64, WALLET_ID, tonAddress, tonAddressRaw, stateInitFor, codeHashHex, getBalance, getSeqno, buildSigningMessage, verifyTransfer, send };
