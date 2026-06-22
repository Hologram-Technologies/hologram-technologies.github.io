// holo-wallet-agent-witness.mjs — proves the wallet's AGENT tool surface enforces the trust boundary:
// keys never leave the wallet, every value-moving call goes through the human gate, Q must ASK before any
// activity (reads included), and an agent's authority can only attenuate (SEC-2). Fund-free, browserless.
//
//   node system/tools/holo-wallet-agent-witness.mjs
//
// The seam is an in-memory spy: it records every call and a (denyable) gate, so we can prove what was
// and was NOT routed to it. The real browser seam is holo-wallet-bridge (BroadcastChannel → wallet gate).

import { makeWalletAgent, describe, listTools, prepare, kappaOf, TOOLS, qContext } from "../os/usr/lib/holo/holo-wallet-agent.mjs";
import { seam as bridgeSeam } from "../os/usr/lib/holo/holo-wallet-bridge.js";
import { mintNpc, delegate, authorizeRequest } from "../os/usr/lib/holo/holo-delegate.mjs";
import { principalFromSeed } from "../os/usr/lib/holo/holo-login.mjs";
import { firstRun } from "../os/usr/lib/holo/holo-ceremony.mjs";
import { generateMnemonic, seedFromMnemonic } from "../os/usr/lib/holo/holo-wdk.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };

console.log("Holo Wallet — agent tool surface witness (WDK-MCP parity, one human-gated door)\n");

// ── a spy seam: records calls; gate is denyable so we can prove "no consent ⇒ no value moves". ──
function spySeam({ gate = true } = {}) {
  const calls = [];
  const wrap = (kind) => async (args) => { calls.push({ kind, args }); if (!gate) throw new Error("user denied at gate"); return { kind, signed: true }; };
  return { calls, address: wrap("address"), addresses: wrap("addresses"), balance: wrap("balance"), tokenBalance: wrap("tokenBalance"), sign: wrap("sign"), signTypedData: wrap("signTypedData"), send: wrap("send"), swap: wrap("swap"), price: wrap("price"), history: wrap("history"), swapQuote: wrap("swapQuote") };
}
// authorizer wired to the REAL holo-delegate (same source of truth the wallet uses).
const authorize = async (d, o) => authorizeRequest(d, o);

// 1) introspection — the catalog covers WDK's 7 categories and self-verifies (L5).
const card = describe();
const cats = new Set(listTools().map((t) => t.category));
ok("catalog advertises all 7 WDK categories", ["wallet", "pricing", "indexer", "swap", "bridge", "lending", "fiat"].every((c) => cats.has(c)), [...cats].join(","));
ok("capability card re-derives to its own id (Law L5)", card.id === kappaOf((() => { const { id, ...rest } = card; return rest; })()), card.id.slice(0, 28) + "…");

// 2) proactive prepare() is a PROPOSAL with ZERO side effects (the seam is never touched).
const seam0 = spySeam();
const agent0 = makeWalletAgent({ seam: seam0, authorize });
const prop = prepare("wallet_send", { chain: "ethereum", to: "0xabc", amount: "5", token: "usdt" });
ok("prepare() returns a non-executing proposal", prop.ok && prop.proposal === true && prop.willRequireConsent === true);
ok("prepare() touches the seam ZERO times (no value moves)", seam0.calls.length === 0);
ok("prepare() of a spend warns it is irreversible + biometric-gated", /irreversible/i.test(prop.humanSummary));

// 3) Q must ASK — default-deny on EVERYTHING, reads included.
const seamQ = spySeam();
const aQ = makeWalletAgent({ seam: seamQ, authorize });
let r = await aQ.invoke("wallet_get_balance", { chain: "ethereum" }, { caller: { kind: "q" } });
ok("Q read with no consent is REFUSED (must ask)", r.ok === false && r.refused === true && r.needsConsent === "read");
r = await aQ.invoke("wallet_send", { chain: "ethereum", to: "0xabc", amount: "5" }, { caller: { kind: "q" } });
ok("Q spend with no per-action approval is REFUSED", r.ok === false && r.refused === true);
ok("a refused Q call NEVER reaches the seam (no signature attempted)", seamQ.calls.length === 0);

// 4) Q WITH consent proceeds — read via standing grant, spend via per-action approval — and only then the seam fires.
const seamQ2 = spySeam();
const aQ2 = makeWalletAgent({ seam: seamQ2, authorize });
r = await aQ2.invoke("wallet_get_address", { chain: "ethereum" }, { caller: { kind: "q" }, readGrant: true });
ok("Q read with a standing read-grant is allowed", r.ok === true && r.via === "q-standing-read-grant");
r = await aQ2.invoke("wallet_sign_message", { chain: "ethereum", message: "hi" }, { caller: { kind: "q" }, userApproved: true });
ok("Q sign with a fresh per-action approval is allowed", r.ok === true && r.via === "q-per-action-approval");
ok("a standing READ grant can NOT authorize a SPEND (no escalation)",
  (await aQ2.invoke("wallet_send", { chain: "ethereum", to: "0x1", amount: "1" }, { caller: { kind: "q" }, readGrant: true })).ok === false);

// 5) external agent — SEC-2 attenuation: the delegation must already hold the capability.
const pc = await principalFromSeed(seedFromMnemonic(generateMnemonic(12)), "Ada");
await firstRun(pc, {});
const npc = mintNpc("Scout");
const readOnly = (await delegate(pc, npc, { capabilities: ["wallet:read"], notAfter: "2999-01-01T00:00:00Z" })).credential;
const spender = (await delegate(pc, npc, { capabilities: ["wallet:read", "wallet:sign", "wallet:spend"], notAfter: "2999-01-01T00:00:00Z" })).credential;
const seamA = spySeam();
const aA = makeWalletAgent({ seam: seamA, authorize });
ok("agent with NO delegation is refused (default-deny)",
  (await aA.invoke("wallet_get_address", { chain: "ethereum" }, { caller: { kind: "agent" } })).ok === false);
ok("agent with a wallet:read grant may read",
  (await aA.invoke("wallet_get_address", { chain: "ethereum" }, { caller: { kind: "agent" }, delegation: readOnly })).ok === true);
ok("agent with ONLY wallet:read is refused a SPEND (attenuation, SEC-2)",
  (await aA.invoke("wallet_send", { chain: "ethereum", to: "0x1", amount: "1" }, { caller: { kind: "agent" }, delegation: readOnly })).ok === false);
ok("agent with wallet:spend may request a send (human still signs at the seam)",
  (await aA.invoke("wallet_send", { chain: "ethereum", to: "0x1", amount: "1" }, { caller: { kind: "agent" }, delegation: spender })).ok === true);

// 6) the gate is the only thing that signs — a DENY at the gate moves nothing.
const seamDeny = spySeam({ gate: false });
const aDeny = makeWalletAgent({ seam: seamDeny, authorize });
let threw = false;
try { await aDeny.invoke("wallet_send", { chain: "ethereum", to: "0x1", amount: "1" }, { caller: { kind: "human" } }); } catch { threw = true; }
ok("human send DENIED at the gate yields no signature (seam threw)", threw === true);

// 7) honest surface + CONVERGENCE — any tool still advertised as `planned` must refuse honestly with its
//    target WDK module (never fake). After full convergence there are none: assert the matrix is complete.
const seamP = spySeam();
const aP = makeWalletAgent({ seam: seamP, authorize });
const planned = listTools().filter((t) => t.status === "planned");
for (const t of planned) {
  const rr = await aP.invoke(t.name, {}, { caller: { kind: "human" } });
  ok(`planned tool ${t.name} refuses honestly and names its WDK module`, rr.ok === false && rr.status === "planned" && !!rr.maps_to);
}
ok("CONVERGENCE — every advertised tool is wired (no 'planned' left)", planned.length === 0, planned.length ? planned.map((t) => t.name).join(",") : "all wired");

// 8) LIVE WIRING — the bridge `seam` is a real drop-in: every wired/needs-seam tool's seamKind is a
//    method on holo-wallet-bridge.seam, so makeWalletAgent({ seam: bridgeSeam }) routes for real.
const seamKinds = [...new Set(TOOLS.filter((t) => t.seamKind).map((t) => t.seamKind))];
ok("every tool's seamKind is a method on the live bridge seam (drop-in)", seamKinds.every((k) => typeof bridgeSeam[k] === "function"), seamKinds.join(","));
ok("the 6 read tools that needed a seam are now status:wired", TOOLS.filter((t) => ["wallet_list_accounts", "wallet_get_balance", "wallet_get_token_balance", "pricing_get_price", "indexer_get_history", "swap_get_quote"].includes(t.name)).every((t) => t.status === "wired"));

// 9) the live bridge seam routes a Q read end-to-end through governance (mock the wallet by spying the seam's
//    BroadcastChannel target is browser-only; here we assert the governance + drop-in compose without a window).
const liveQ = makeWalletAgent({ seam: bridgeSeam, authorize });
const noGrant = await liveQ.invoke("wallet_get_balance", { chain: "ethereum" }, qContext({ /* readGrant defaults OFF */ }));
ok("Q over the LIVE bridge seam: read still default-deny without consent", noGrant.ok === false && noGrant.refused === true);

console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
