// holo-evm-swap-witness.mjs — proves the EVM spot-swap (Velora/ParaSwap) is trust-minimized the same way
// holo-jupiter is on Solana: an independently re-derived min-out FLOOR, a SEALED-router assertion (a drainer
// `to` is refused), a pre-sign SIMULATION (a revert never reaches the gate), and default-deny SIGNING. Plus
// the agent surface routes swap_execute(EVM) through the gate (Q must ask; attenuation holds). Network-free.
//
//   node system/tools/holo-evm-swap-witness.mjs

import { VELORA, routerFor, minOutFloor, assertSwapTx, allowanceOf, approveCalldata, swap } from "../os/usr/lib/holo/holo-evm-swap.mjs";
import { makeWalletAgent, qContext } from "../os/usr/lib/holo/holo-wallet-agent.mjs";
import { mintNpc, delegate, authorizeRequest } from "../os/usr/lib/holo/holo-delegate.mjs";
import { principalFromSeed } from "../os/usr/lib/holo/holo-login.mjs";
import { firstRun } from "../os/usr/lib/holo/holo-ceremony.mjs";
import { generateMnemonic, seedFromMnemonic } from "../os/usr/lib/holo/holo-wdk.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };

console.log("Holo EVM Swap — Velora/ParaSwap, trust-minimized behind the gate\n");

const ROUTER = VELORA.router, NATIVE = VELORA.native;
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const FROM = "0x1111111111111111111111111111111111111111";
const priceRoute = { srcAmount: "100000000000000000", destAmount: "173282779", network: 1, contractAddress: ROUTER, version: "6.2", bestRoute: [{ swaps: [{ swapExchanges: [{ exchange: "uniswapv3" }] }] }] };

// canned network: /prices → priceRoute · /transactions → a tx to `to` (parametrised so we can forge it).
function mkFetch(buildTo = ROUTER) {
  return async (url, init) => {
    const u = String(url);
    if (u.includes("/prices")) return { ok: true, status: 200, json: async () => ({ priceRoute }) };
    if (u.includes("/transactions/")) return { ok: true, status: 200, json: async () => ({ to: buildTo, data: "0xabcdef01", value: "100000000000000000", chainId: 1, from: FROM }) }; // ParaSwap returns DECIMAL value
    return { ok: false, status: 404, text: async () => "nf" };
  };
}
// canned rpc: eth_call simulate ok unless we say revert; allowance returns a number.
const mkRpc = ({ revert = false, allowance = "0x0" } = {}) => ({ call: async (m, p) => {
  if (m === "eth_call") { const to = p[0].to; if (to !== ROUTER && p[0].data.startsWith("0xdd62ed3e")) return allowance; /* allowance() */ if (revert) throw new Error("execution reverted"); return "0x"; }
  return "0x";
} });

// 1) min-out floor re-derivation (independent of the aggregator).
const f = minOutFloor(priceRoute, 50);
ok("min-out floor = destAmount·(1−bps) re-derived", f.floor === (173282779n * 9950n) / 10000n, f.floor.toString());

// 2) sealed-router assertion — a forged `to` (drainer) is refused (the anti-phishing keystone).
let threw = false; try { assertSwapTx({ to: "0x00000000000000000000000000000000DeaDBeeF", data: "0x1", from: FROM }, { router: ROUTER, expectedFrom: FROM }); } catch { threw = true; }
ok("build to a NON-sealed router is refused", threw === true);
ok("build to the sealed router passes", !!assertSwapTx({ to: ROUTER, data: "0x1", from: FROM }, { router: ROUTER, expectedFrom: FROM }));
threw = false; try { assertSwapTx({ to: ROUTER, data: "0x1", from: "0x2222222222222222222222222222222222222222" }, { router: ROUTER, expectedFrom: FROM }); } catch { threw = true; }
ok("build whose from ≠ wallet is refused", threw === true);

// 3) routerFor: served vs unserved chains.
ok("routerFor returns the Augustus router for a served chain", routerFor(VELORA, 1) === ROUTER);
ok("routerFor returns null for an unserved chain", routerFor(VELORA, 999999) === null);

// 4) allowance: native src needs none; ERC-20 short allowance → needsApproval (refuse-with-instruction).
ok("native src needs no allowance", (await allowanceOf({ rpc: mkRpc(), token: NATIVE, owner: FROM })).needed === false);
{
  const res = await swap({ chainId: 1, srcToken: USDC, destToken: NATIVE, amount: "100000000", slippageBps: 50, userAddress: FROM }, { rpc: mkRpc({ allowance: "0x0" }), send: async () => "0xSHOULD_NOT", approve: async () => true, fetchImpl: mkFetch() });
  ok("ERC-20 src with zero allowance returns needsApproval (no send)", res.needsApproval === true && /allowance/.test(res.reason));
}

// 5) simulation revert → throws BEFORE the gate (gate never called, nothing sent).
{
  let gated = false, sent = false;
  let err = null;
  try { await swap({ chainId: 1, srcToken: NATIVE, destToken: USDC, amount: "100000000000000000", slippageBps: 50, userAddress: FROM }, { rpc: mkRpc({ revert: true }), send: async () => { sent = true; return "0x"; }, approve: async () => { gated = true; return true; }, fetchImpl: mkFetch() }); } catch (e) { err = e; }
  ok("a reverting simulation refuses BEFORE the gate", !!err && /simulation reverted/.test(err.message) && gated === false && sent === false);
}

// 6) happy path: quote→floor→build→assert→simulate→APPROVE→send. The gate sees re-derived numbers.
{
  let seen = null, sent = null;
  const res = await swap({ chainId: 1, srcToken: NATIVE, destToken: USDC, amount: "100000000000000000", slippageBps: 50, userAddress: FROM }, { rpc: mkRpc(), send: async (tx) => { sent = tx; return "0xhash"; }, approve: async (info) => { seen = info; return true; }, fetchImpl: mkFetch() });
  ok("approved swap sends to the sealed router and returns a hash", res.hash === "0xhash" && sent.to === ROUTER);
  ok("ParaSwap's DECIMAL value is normalised to a hex quantity before send", typeof sent.value === "string" && sent.value.startsWith("0x") && BigInt(sent.value) === 100000000000000000n, sent.value);
  ok("the gate saw the re-derived minOut + route (verified numbers)", seen.minOut === ((173282779n * 9950n) / 10000n).toString() && seen.route.includes("uniswapv3"));
}

// 7) default-deny: gate says no → nothing sends.
{
  let sent = false;
  let err = null;
  try { await swap({ chainId: 1, srcToken: NATIVE, destToken: USDC, amount: "100000000000000000", slippageBps: 50, userAddress: FROM }, { rpc: mkRpc(), send: async () => { sent = true; return "0x"; }, approve: async () => false, fetchImpl: mkFetch() }); } catch (e) { err = e; }
  ok("a denied gate sends nothing (default-deny)", !!err && /denied/.test(err.message) && sent === false);
}

// 8) AGENT surface — swap_execute(EVM) rides the gate. Q must ask; attenuation holds.
const spy = { calls: [], swapEvm: async (a) => { spy.calls.push(["swapEvm", a]); return { hash: "0xevm" }; }, swapQuoteEvm: async () => ({ destAmount: "1" }), swap: async () => ({ txid: "x" }), swapQuote: async () => ({}) };
const authorize = async (d, o) => authorizeRequest(d, o);
const agent = makeWalletAgent({ seam: spy, authorize });
let r = await agent.invoke("swap_execute", { chain: "ethereum", srcToken: NATIVE, destToken: USDC, amount: "0.1" }, qContext());
ok("Q EVM swap with no approval is REFUSED (must ask)", r.ok === false && r.refused === true && spy.calls.length === 0);
r = await agent.invoke("swap_execute", { chain: "ethereum", srcToken: NATIVE, destToken: USDC, amount: "0.1" }, qContext({ userApproved: true }));
ok("Q EVM swap WITH approval routes to seam.swapEvm", r.ok === true && spy.calls.length === 1 && spy.calls[0][0] === "swapEvm");

const pc = await principalFromSeed(seedFromMnemonic(generateMnemonic(12)), "Ada");
await firstRun(pc, {});
const readOnly = (await delegate(pc, mintNpc("Scout"), { capabilities: ["wallet:read"], notAfter: "2999-01-01T00:00:00Z" })).credential;
ok("agent with only wallet:read is refused swap_execute (attenuation, SEC-2)",
  (await agent.invoke("swap_execute", { chain: "ethereum", srcToken: NATIVE, destToken: USDC, amount: "0.1" }, { caller: { kind: "agent" }, delegation: readOnly })).ok === false);

console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
