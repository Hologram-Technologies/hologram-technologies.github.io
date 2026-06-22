// holo-lending-witness.mjs — proves Aave V3 lending is trust-minimized behind the gate: positions decode
// (incl. health factor), calldata builders, the SEALED-Pool assertion (a drainer `to` refused), allowance
// for supply/repay, no-capacity borrow refused, simulate-before-gate, default-deny, and the agent surface
// routes lending_supply/borrow through the gate (Q asks; attenuation holds). Network-free.
//
//   node system/tools/holo-lending-witness.mjs

import { AAVE_POOL, poolFor, decodePositions, buildSupply, buildBorrow, buildRepay, buildWithdraw, assertPoolTx, execute } from "../os/usr/lib/holo/holo-lending.mjs";
import { makeWalletAgent, qContext } from "../os/usr/lib/holo/holo-wallet-agent.mjs";
import { mintNpc, delegate, authorizeRequest } from "../os/usr/lib/holo/holo-delegate.mjs";
import { principalFromSeed } from "../os/usr/lib/holo/holo-login.mjs";
import { firstRun } from "../os/usr/lib/holo/holo-ceremony.mjs";
import { generateMnemonic, seedFromMnemonic } from "../os/usr/lib/holo/holo-wdk.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };
const w = (n) => BigInt(n).toString(16).padStart(64, "0");

console.log("Holo Lending — Aave V3, trust-minimized behind the gate\n");

const POOL = poolFor("arbitrum");
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // Arbitrum USDC
const FROM = "0x1111111111111111111111111111111111111111";

// 1) positions decode — collateral/debt/health; healthFactor=uint256.max → Infinity (no debt).
{
  const ret = "0x" + w("500000000000") + w("100000000000") + w("250000000000") + w("8500") + w("8000") + w((1n << 256n) - 1n);
  const p = decodePositions(ret);
  ok("positions decode collateral/debt/availableBorrows (USD 8dp)", p.collateralUsd === 5000 && p.debtUsd === 1000 && p.availableBorrowsUsd === 2500);
  ok("max healthFactor decodes to Infinity (no debt)", p.healthFactorNum === Infinity);
  const ret2 = "0x" + w("500000000000") + w("100000000000") + w("250000000000") + w("8500") + w("8000") + w("1500000000000000000");
  ok("a finite healthFactor decodes (1e18-scaled)", decodePositions(ret2).healthFactorNum === 1.5);
}

// 2) calldata builders carry the right selectors + args.
ok("supply calldata targets supply(address,uint256,address,uint16)", buildSupply(USDC, "1000000", FROM).startsWith("0x617ba037"));
ok("borrow calldata targets borrow(address,uint256,uint256,uint16,address)", buildBorrow(USDC, "1000000", FROM).startsWith("0xa415bcad"));
ok("supply calldata encodes asset + amount + onBehalf", buildSupply(USDC, "1000000", FROM).includes(USDC.slice(2).toLowerCase()) && buildSupply(USDC, "1000000", FROM).includes(w("1000000")));

// 3) sealed-Pool assertion (anti-phishing).
ok("tx to the sealed Aave Pool passes", !!assertPoolTx({ to: POOL, data: "0x12" }, { pool: POOL }));
let threw = false; try { assertPoolTx({ to: "0x00000000000000000000000000000000DeaDBeeF", data: "0x12" }, { pool: POOL }); } catch { threw = true; }
ok("tx to a NON-sealed pool (drainer) is refused", threw);

// rpc stub: allowance(0xdd62ed3e), getUserAccountData(0xbf92857c), eth_call simulate.
const mkRpc = ({ allowance = "0x" + w((1n << 200n)), avail = "250000000000", revert = false } = {}) => ({ call: async (m, p) => {
  const d = p[0].data || "";
  if (d.startsWith("0xdd62ed3e")) return allowance;
  if (d.startsWith("0xbf92857c")) return "0x" + w("500000000000") + w("100000000000") + w(avail) + w("8500") + w("8000") + w("1500000000000000000");
  if (p[0].from && revert) throw new Error("execution reverted");
  return "0x";
} });

// 4) supply with short allowance → needsApproval (no send).
{
  const res = await execute({ chain: "arbitrum", action: "supply", asset: USDC, amount: "1000000", userAddress: FROM }, { rpc: mkRpc({ allowance: "0x" + w(0) }), send: async () => "0xNO", approve: async () => true });
  ok("supply with short allowance → needsApproval (no send)", res.needsApproval === true && /allowance/.test(res.reason));
}
// 5) borrow with no capacity → refused (verify-before-act).
{
  const res = await execute({ chain: "arbitrum", action: "borrow", asset: USDC, amount: "1000000", userAddress: FROM }, { rpc: mkRpc({ avail: "0" }), send: async () => "0xNO", approve: async () => true });
  ok("borrow with zero available capacity is refused", res.refused === true && /capacity/.test(res.reason));
}
// 6) simulate revert (Aave rejects unsafe action) → refuse BEFORE the gate.
{
  let gated = false, sent = false, err = null;
  try { await execute({ chain: "arbitrum", action: "borrow", asset: USDC, amount: "1000000", userAddress: FROM }, { rpc: mkRpc({ revert: true }), send: async () => { sent = true; }, approve: async () => { gated = true; return true; } }); } catch (e) { err = e; }
  ok("a reverting simulation refuses BEFORE the gate", !!err && /simulation reverted/.test(err.message) && !gated && !sent);
}
// 7) happy path: borrow → assert pool → simulate → APPROVE → send; gate sees the health factor.
{
  let seen = null, sent = null;
  const res = await execute({ chain: "arbitrum", action: "borrow", asset: USDC, amount: "1000000", userAddress: FROM }, { rpc: mkRpc(), send: async (tx) => { sent = tx; return "0xhash"; }, approve: async (info) => { seen = info; return true; } });
  ok("approved borrow sends to the sealed Pool and returns a hash", res.hash === "0xhash" && sent.to === POOL);
  ok("the gate saw the re-derived health factor", seen.healthFactor === 1.5 && seen.action === "borrow");
}
// 8) default-deny: gate says no → nothing sends.
{
  let sent = false, err = null;
  try { await execute({ chain: "arbitrum", action: "borrow", asset: USDC, amount: "1000000", userAddress: FROM }, { rpc: mkRpc(), send: async () => { sent = true; }, approve: async () => false }); } catch (e) { err = e; }
  ok("a denied gate sends nothing (default-deny)", !!err && /denied/.test(err.message) && !sent);
}

// 9) AGENT surface — lending_supply/borrow ride the gate; positions is read; attenuation holds.
const spy = { calls: [], lending: async (a) => { spy.calls.push(a.action); return { hash: "0xL" }; }, lendingPositions: async () => ({ healthFactorNum: Infinity }) };
const agent = makeWalletAgent({ seam: spy, authorize: async (d, o) => authorizeRequest(d, o) });
ok("Q lending_supply with no approval is REFUSED (must ask)", (await agent.invoke("lending_supply", { asset: USDC, amount: "1" }, qContext())).refused === true && spy.calls.length === 0);
let r = await agent.invoke("lending_borrow", { asset: USDC, amount: "1" }, qContext({ userApproved: true }));
ok("Q lending_borrow WITH approval routes to seam.lending(borrow)", r.ok === true && spy.calls[0] === "borrow");
const pc = await principalFromSeed(seedFromMnemonic(generateMnemonic(12)), "Ada");
await firstRun(pc, {});
const readOnly = (await delegate(pc, mintNpc("Scout"), { capabilities: ["wallet:read"], notAfter: "2999-01-01T00:00:00Z" })).credential;
ok("agent with only wallet:read may read positions but NOT supply (attenuation)",
  (await agent.invoke("lending_positions", {}, { caller: { kind: "agent" }, delegation: readOnly })).ok === true &&
  (await agent.invoke("lending_supply", { asset: USDC, amount: "1" }, { caller: { kind: "agent" }, delegation: readOnly })).ok === false);

console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
