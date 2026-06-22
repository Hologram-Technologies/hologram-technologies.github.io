// holo-bridge-witness.mjs — proves the USD₮0 cross-chain bridge (LayerZero OFT) is trust-minimized: the
// destination (dstEid) is RE-DERIVED from a pinned table (a foreign endpoint is refused), the recipient is
// our address→bytes32, the OFT ABI is encoded correctly (selectors + offsets), the built tx MUST target the
// SEALED OFT (a drainer `to` refused), the LZ fee is quoted + simulated BEFORE the gate, and signing is
// default-deny. Plus the agent surface routes bridge_execute through the gate (Q asks; attenuation holds).
//
//   node system/tools/holo-bridge-witness.mjs

import { USDT0, EID, dstEidFor, oftFor, addrToBytes32, minAmountFloor, buildSendParam, assertBridgeTx, encodeQuoteSend, encodeSend, quoteSend, bridge, QUOTE_SEND_SEL, SEND_SEL } from "../os/usr/lib/holo/holo-bridge.mjs";
import { makeWalletAgent, qContext } from "../os/usr/lib/holo/holo-wallet-agent.mjs";
import { mintNpc, delegate, authorizeRequest } from "../os/usr/lib/holo/holo-delegate.mjs";
import { principalFromSeed } from "../os/usr/lib/holo/holo-login.mjs";
import { firstRun } from "../os/usr/lib/holo/holo-ceremony.mjs";
import { generateMnemonic, seedFromMnemonic } from "../os/usr/lib/holo/holo-wdk.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };
const w = (n) => BigInt(n).toString(16).padStart(64, "0");

console.log("Holo Bridge — USD₮0 over LayerZero OFT, trust-minimized behind the gate\n");

const FROM = "0x1111111111111111111111111111111111111111";
const RECIP = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const ARB_OFT = oftFor("arbitrum").oft;

// 1) canonical selectors (validated live against the real OFT in the browser proof).
ok("quoteSend / send selectors are the OFT ABI selectors", QUOTE_SEND_SEL === "0x3b6f743b" && SEND_SEL === "0xc7c7f5b3", QUOTE_SEND_SEL + " / " + SEND_SEL);

// 2) recipient + floor re-derivation.
ok("addrToBytes32 left-pads the recipient to 32 bytes", addrToBytes32(RECIP) === "0x000000000000000000000000" + RECIP.slice(2).toLowerCase());
ok("min-amount floor = amountLD·(1−bps)", minAmountFloor("10000000", 50).floor === 9950000n);

// 3) destination RE-DERIVED from the pinned table; foreign endpoint / bad src / same-chain refused.
const sp = buildSendParam({ srcChain: "arbitrum", dstChain: "ethereum", to: RECIP, amountLD: "10000000", slippageBps: 50 });
ok("dstEid is taken from the pinned EID table (not caller input)", sp.dstEid === EID.ethereum && sp.dstEid === 30101);
let threw = false; try { buildSendParam({ srcChain: "arbitrum", dstChain: "fantom", to: RECIP, amountLD: "1" }); } catch { threw = true; }
ok("a destination NOT in the pinned table is refused", threw);
threw = false; try { buildSendParam({ srcChain: "fantom", dstChain: "ethereum", to: RECIP, amountLD: "1" }); } catch { threw = true; }
ok("a source with no sealed OFT is refused", threw);
threw = false; try { buildSendParam({ srcChain: "arbitrum", dstChain: "arbitrum", to: RECIP, amountLD: "1" }); } catch { threw = true; }
ok("bridging to the same chain is refused", threw);

// 4) ABI encoding structure: selector + the dynamic-tuple offset + the static head words.
const qd = encodeQuoteSend(sp).slice(2);
ok("quoteSend calldata = selector + offset(64) + bool + tuple", "0x" + qd.slice(0, 8) === QUOTE_SEND_SEL && qd.slice(8, 72) === w(64) && qd.slice(72, 136) === w(0));
ok("the encoded tuple head carries dstEid, recipient, amount, minAmount", qd.includes(w(30101)) && qd.includes(addrToBytes32(RECIP).slice(2)) && qd.includes(w(10000000)) && qd.includes(w(9950000)));
const sd = encodeSend(sp, { nativeFee: "388044904692108", lzTokenFee: "0" }, RECIP).slice(2);
ok("send calldata = selector + offset(128) + nativeFee + lzTokenFee + refund", "0x" + sd.slice(0, 8) === SEND_SEL && sd.slice(8, 72) === w(128) && sd.slice(72, 136) === w("388044904692108"));

// 5) sealed-OFT assertion (anti-phishing): a forged `to` is refused; the sealed OFT passes.
ok("build to the sealed OFT passes", !!assertBridgeTx({ to: ARB_OFT, data: "0x12" }, { oft: ARB_OFT }));
threw = false; try { assertBridgeTx({ to: "0x00000000000000000000000000000000DeaDBeeF", data: "0x12" }, { oft: ARB_OFT }); } catch { threw = true; }
ok("build to a NON-sealed OFT (drainer) is refused", threw);

// 6) quoteSend decodes the MessagingFee from a canned eth_call return.
{
  const rpc = { call: async () => "0x" + w("388044904692108") + w(0) };
  const fee = await quoteSend({ rpc, srcChain: "arbitrum", sendParam: sp });
  ok("quoteSend decodes nativeFee from the OFT return", String(fee.nativeFee) === "388044904692108");
}

// 7) orchestrator — allowance short → needsApproval (no send).
{
  const rpc = { call: async (m, p) => { const d = p[0].data || ""; if (d.startsWith("0xdd62ed3e")) return "0x" + w(0); return "0x" + w("388044904692108") + w(0); } };
  const res = await bridge({ srcChain: "arbitrum", dstChain: "ethereum", to: RECIP, amountLD: "10000000", userAddress: FROM }, { rpc, send: async () => "0xNO", approve: async () => true });
  ok("insufficient USD₮0 allowance → needsApproval (no send)", res.needsApproval === true && /allowance/.test(res.reason));
}
// 8) simulate revert → refuse BEFORE the gate.
{
  const rpc = { call: async (m, p) => { const d = p[0].data || ""; if (d.startsWith("0xdd62ed3e")) return "0x" + w("99999999999"); if (p[0].from) throw new Error("execution reverted"); return "0x" + w("388044904692108") + w(0); } };
  let gated = false, sent = false, err = null;
  try { await bridge({ srcChain: "arbitrum", dstChain: "ethereum", to: RECIP, amountLD: "10000000", userAddress: FROM }, { rpc, send: async () => { sent = true; }, approve: async () => { gated = true; return true; } }); } catch (e) { err = e; }
  ok("a reverting simulation refuses BEFORE the gate", !!err && /simulation reverted/.test(err.message) && !gated && !sent);
}
// 9) happy path: send to the sealed OFT with value = the LZ native fee (hex); gate sees re-derived info.
{
  const rpc = { call: async (m, p) => { const d = p[0].data || ""; if (d.startsWith("0xdd62ed3e")) return "0x" + w("99999999999"); if (p[0].from) return "0x"; return "0x" + w("388044904692108") + w(0); } };
  let seen = null, sent = null;
  const res = await bridge({ srcChain: "arbitrum", dstChain: "ethereum", to: RECIP, amountLD: "10000000", userAddress: FROM }, { rpc, send: async (tx) => { sent = tx; return "0xhash"; }, approve: async (info) => { seen = info; return true; } });
  ok("approved bridge sends to the sealed OFT, value = LZ native fee (hex)", res.hash === "0xhash" && sent.to === ARB_OFT && sent.value === "0x" + BigInt("388044904692108").toString(16));
  ok("the gate saw the re-derived dest + minAmount + fee", seen.to === "ethereum" && seen.minAmountLD === "9950000" && seen.nativeFee === "388044904692108");
}
// 10) default-deny: gate says no → nothing sends.
{
  const rpc = { call: async (m, p) => { const d = p[0].data || ""; if (d.startsWith("0xdd62ed3e")) return "0x" + w("99999999999"); if (p[0].from) return "0x"; return "0x" + w("388044904692108") + w(0); } };
  let sent = false, err = null;
  try { await bridge({ srcChain: "arbitrum", dstChain: "ethereum", to: RECIP, amountLD: "10000000", userAddress: FROM }, { rpc, send: async () => { sent = true; }, approve: async () => false }); } catch (e) { err = e; }
  ok("a denied gate sends nothing (default-deny)", !!err && /denied/.test(err.message) && !sent);
}

// 11) AGENT surface — bridge_execute rides the gate. Q asks; attenuation holds.
const spy = { calls: 0, bridge: async () => { spy.calls++; return { hash: "0xb" }; }, bridgeQuote: async () => ({ nativeFee: "1" }) };
const agent = makeWalletAgent({ seam: spy, authorize: async (d, o) => authorizeRequest(d, o) });
let r = await agent.invoke("bridge_execute", { srcChain: "arbitrum", dstChain: "ethereum", amount: "10" }, qContext());
ok("Q bridge with no approval is REFUSED (must ask)", r.ok === false && r.refused === true && spy.calls === 0);
r = await agent.invoke("bridge_execute", { srcChain: "arbitrum", dstChain: "ethereum", amount: "10" }, qContext({ userApproved: true }));
ok("Q bridge WITH approval routes to seam.bridge", r.ok === true && spy.calls === 1);
const pc = await principalFromSeed(seedFromMnemonic(generateMnemonic(12)), "Ada");
await firstRun(pc, {});
const readOnly = (await delegate(pc, mintNpc("Scout"), { capabilities: ["wallet:read"], notAfter: "2999-01-01T00:00:00Z" })).credential;
ok("agent with only wallet:read is refused bridge_execute (attenuation)",
  (await agent.invoke("bridge_execute", { srcChain: "arbitrum", dstChain: "ethereum", amount: "10" }, { caller: { kind: "agent" }, delegation: readOnly })).ok === false);

console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
