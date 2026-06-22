// holo-bridge.mjs — the cross-chain BRIDGE engine: USD₮0 over LayerZero's OFT (Omnichain Fungible Token),
// hologram-native. WDK parity: @tetherto/wdk-protocol-bridge-usdt0-evm. Bridging USD₮0 = calling the OFT's
// send() on the source chain (burns locally, LayerZero mints on the destination). Same default-deny gate.
//
// First principles (holospaces L5 / SEC-1, SEC-6):
//   • Destination is RE-DERIVED, never trusted from input. dstEid comes from a PINNED endpoint table keyed
//     by chain name; the recipient is OUR address left-padded to bytes32. A caller can't smuggle a foreign
//     endpoint or a look-alike recipient past the gate (SEC-6: the reference→κ binding is verified on its axis).
//   • The OFT contract per chain is PINNED (sealed config from docs.usdt0.to). The built tx MUST be sent to
//     that exact OFT — a look-alike `to` (a drainer) is refused (assertBridgeTx, structural anti-phishing).
//   • min-amount FLOOR re-derived from amountLD ⊕ slippageBps (LayerZero credits amountReceivedLD ≥ minAmountLD
//     or reverts) — the user is never silently shorted.
//   • quote + SIMULATE before the gate; default-deny SIGNING (the key stays in Holo Wallet).
//
// Pure (Node-testable, no network): the config, EID table, recipient derivation, minAmountFloor, the OFT
// ABI encoders (quoteSend/send), and assertBridgeTx. Network: quoteSend (eth_call) + the bridge() orchestrator.

import { keccak256, bytesToHex, decodeWord, encodeCall } from "./holo-eth.js";

const te = new TextEncoder();
const selector = (sig) => bytesToHex(keccak256(te.encode(sig))).slice(0, 10);
const strip = (h) => String(h || "0x").replace(/^0x/, "").toLowerCase();
// uint256 → 32-byte word (hex, no 0x), two's-complement for negatives
const word = (n) => { let v = BigInt(n); if (v < 0n) v += 1n << 256n; return v.toString(16).padStart(64, "0"); };
const padL = (h) => strip(h).padStart(64, "0");
export const addrToBytes32 = (addr) => "0x" + padL(addr);

// ── sealed config (docs.usdt0.to) — OFT per chain (chain's own EID) + the LayerZero v2 EID table. A bridge
//    FROM a chain with no pinned OFT refuses; a bridge TO a chain with no pinned EID refuses (re-derived dest). ──
// USD₮0 uses the adapter/lockbox pattern on every chain: a TOKEN (the ERC-20 the user holds) + a separate
// OFT/Adapter (the contract exposing send/quoteSend). To bridge: approve the OFT to spend the token, then
// send() on the OFT. Addresses are the canonical deployments (docs.usdt0.to/…/deployments) — NOT a block-
// explorer search (lookalike risk; the Arbitrum token 0xFd08… does NOT expose the OFT interface).
export const USDT0 = {
  ethereum:    { oft: "0x6C96dE32CEa08842dcc4058c14d3aaAD7Fa41dee", token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", eid: 30101, decimals: 6 }, // OFT Adapter over legacy USDT
  arbitrum:    { oft: "0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92", token: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", eid: 30110, decimals: 6 },
  optimism:    { oft: "0xF03b4d9AC1D5d1E7c4cEf54C2A313b9fe051A0aD", token: "0x01bFF41798a0BcF287b996046Ca68b395DbC1071", eid: 30111, decimals: 6 },
  polygon:     { oft: "0x6BA10300f0DC58B7a1e4c0e41f5daBb7D7829e13", token: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", eid: 30109, decimals: 6 },
  plasma:      { oft: "0x02ca37966753bDdDf11216B73B16C1dE756A7CF9", token: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb", eid: 30383, decimals: 6 },
  hyperliquid: { oft: "0x904861a24F30EC96ea7CFC3bE9EA4B476d237e98", token: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb", eid: 30367, decimals: 6 },
};
// LayerZero v2 mainnet endpoint IDs (destination selection is from THIS table, not caller input).
export const EID = { ethereum: 30101, arbitrum: 30110, optimism: 30111, base: 30184, polygon: 30109, bsc: 30102, avalanche: 30106, plasma: 30383, hyperliquid: 30367 };
export const dstEidFor = (chain) => EID[chain] || null;
export const oftFor = (chain) => USDT0[chain] || null;

const lc = (s) => String(s || "").toLowerCase();

// ── min-amount floor (LayerZero credits ≥ minAmountLD or reverts) ──
export function minAmountFloor(amountLD, slippageBps = 50) {
  const amt = BigInt(amountLD), bps = BigInt(slippageBps);
  return { floor: (amt * (10000n - bps)) / 10000n, amountLD: amt, slippageBps: Number(bps) };
}

// ── OFT ABI encoding. SendParam is a DYNAMIC tuple (it carries `bytes` fields), so it is encoded at an
//    offset; MessagingFee is a STATIC tuple (two uints) encoded inline. extraOptions/composeMsg/oftCmd are
//    empty here (the OFT's enforced options apply) — keeping the encoder small and auditable. ──
function encodeSendParam(sp) {                                       // → tuple body hex (no 0x), self-contained
  const head = word(sp.dstEid) + padL(sp.to) + word(sp.amountLD) + word(sp.minAmountLD);
  const dyn = [strip(sp.extraOptions), strip(sp.composeMsg), strip(sp.oftCmd)];
  let off = 7 * 32; const offs = [], tails = [];
  for (const d of dyn) { offs.push(word(off)); const len = d.length / 2; const padded = d + "0".repeat((64 - (d.length % 64 || 64)) % 64); const tail = word(len) + padded; tails.push(tail); off += tail.length / 2; }
  return head + offs.join("") + tails.join("");
}
const SEND_PARAM_T = "(uint32,bytes32,uint256,uint256,bytes,bytes,bytes)";
export const QUOTE_SEND_SEL = selector(`quoteSend(${SEND_PARAM_T},bool)`);
export const SEND_SEL = selector(`send(${SEND_PARAM_T},(uint256,uint256),address)`);

export function encodeQuoteSend(sp, payInLzToken = false) {
  // args: (SendParam dynamic → offset 64) , (bool inline). tuple data follows the 2-word head.
  return QUOTE_SEND_SEL + word(64) + word(payInLzToken ? 1 : 0) + encodeSendParam(sp);
}
export function encodeSend(sp, fee, refundAddress) {
  // args: (SendParam dynamic → offset 128) , (MessagingFee static: nativeFee, lzTokenFee) , (address). tuple after the 4-word head.
  return SEND_SEL + word(128) + word(fee.nativeFee) + word(fee.lzTokenFee || 0) + padL(refundAddress) + encodeSendParam(sp);
}

// ── build the SendParam, deriving dstEid + recipient by re-derivation (not trusting the caller). ──
// the standard LayerZero type-3 executor option: lzReceive with 200_000 gas (OFTs require executor options
// unless enforced options are set on-chain; supplying it makes quoteSend deterministic across deployments).
export const DEFAULT_OPTS = "0x00030100110100000000000000000000000000030d40";
export function buildSendParam({ srcChain, dstChain, to, amountLD, slippageBps = 50, extraOptions = DEFAULT_OPTS }) {
  const src = oftFor(srcChain); if (!src) throw new Error("bridge: no sealed USD₮0 OFT on source chain " + srcChain);
  const dstEid = dstEidFor(dstChain); if (!dstEid) throw new Error("bridge: destination chain " + dstChain + " not in the pinned EID table — refusing");
  if (lc(srcChain) === lc(dstChain)) throw new Error("bridge: source and destination are the same chain");
  const { floor } = minAmountFloor(amountLD, slippageBps);
  return { dstEid, to: addrToBytes32(to), amountLD: String(amountLD), minAmountLD: floor.toString(), extraOptions, composeMsg: "0x", oftCmd: "0x", _oft: src.oft };
}

// ── trust-minimize the built tx: it MUST target the sealed OFT for the source chain (anti-phishing). ──
export function assertBridgeTx(tx, { oft }) {
  if (!tx || !tx.to || !tx.data) throw new Error("bridge: no tx");
  if (lc(tx.to) !== lc(oft)) throw new Error(`bridge: target ${tx.to} ≠ sealed USD₮0 OFT ${oft} — refusing`);
  return tx;
}

// ── network: quoteSend (eth_call) → { nativeFee, lzTokenFee } ──
export async function quoteSend({ rpc, srcChain, sendParam }) {
  const src = oftFor(srcChain); if (!src) throw new Error("bridge: no OFT on " + srcChain);
  const ret = await rpc.call("eth_call", [{ to: src.oft, data: encodeQuoteSend(sendParam, false) }, "latest"]);
  return { nativeFee: decodeWord(ret, "uint256", 0), lzTokenFee: decodeWord(ret, "uint256", 1) };
}

// ── bridge() — quote → derive(dst,recipient) → FLOOR → quoteSend(fee) → build → ASSERT oft → SIMULATE →
//    APPROVE(gate) → SEND. `send(tx)` is the gated wallet send (value = the LayerZero native fee). ──
export async function bridge({ srcChain, dstChain, to, amountLD, slippageBps = 50, userAddress }, { rpc, send, approve = async () => true } = {}) {
  if (!rpc) throw new Error("bridge needs an rpc source (.call)");
  if (!send) throw new Error("bridge needs a gated send(tx) callback");
  const src = oftFor(srcChain); if (!src) throw new Error("bridge: source chain " + srcChain + " has no sealed USD₮0 OFT");
  // the OFT (adapter/lockbox) must be allowed to spend the user's USD₮0 token (refuse-with-instruction, never silent).
  if (src.token) {
    const data = encodeCall("allowance(address,address)", [userAddress, src.oft]);
    const al = decodeWord(await rpc.call("eth_call", [{ to: src.token, data }, "latest"]), "uint256");
    if (BigInt(al) < BigInt(amountLD)) return { needsApproval: true, token: src.token, spender: src.oft, reason: "USD₮0 allowance to the OFT is insufficient — approve first" };
  }
  const sp = buildSendParam({ srcChain, dstChain, to, amountLD, slippageBps });
  const fee = await quoteSend({ rpc, srcChain, sendParam: sp });
  const data = encodeSend(sp, fee, userAddress);
  const valueHex = "0x" + BigInt(fee.nativeFee).toString(16);
  const tx = { to: src.oft, value: valueHex, data: "0x" + data };
  assertBridgeTx(tx, { oft: src.oft });
  try { await rpc.call("eth_call", [{ from: userAddress, to: tx.to, value: valueHex, data: tx.data }, "latest"]); }
  catch (e) { throw new Error("bridge simulation reverted — refusing before the gate: " + (e && e.message)); }
  const info = { from: srcChain, to: dstChain, recipient: to, amountLD: String(amountLD), minAmountLD: sp.minAmountLD, nativeFee: String(fee.nativeFee), dstEid: sp.dstEid };
  if (!(await approve(info))) throw new Error("Bridge request denied");
  const hash = await send(tx);
  return { hash: hash && hash.hash ? hash.hash : hash, ...info };
}

export default { USDT0, EID, dstEidFor, oftFor, addrToBytes32, minAmountFloor, buildSendParam, assertBridgeTx, encodeQuoteSend, encodeSend, quoteSend, bridge, QUOTE_SEND_SEL, SEND_SEL };
