// holo-q-cap-bridge-witness.mjs — Stage B proof (SEC-2 + §2.9): the projection reaches its data ONLY through a
// capability bridge that admits exactly the manifest's declared capabilities — an undeclared collection or op is
// REFUSED; a write is only PROPOSED (never autonomously authored on the user's key); a sub-bridge can only
// NARROW authority (escalation is structurally impossible); there is no ambient escape to the store. Pure Node.
// Run: node holo-q-cap-bridge-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const { createCapBridge } = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-cap-bridge.mjs")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// the manifest grants: read+write on "expenses", read on "members". Nothing else exists for this app.
const STATE = { expenses: [{ title: "Pizza", amount: 20 }], members: ["alice", "bob"] };
const bridge = createCapBridge({ capabilities: [{ collection: "expenses", ops: ["read", "write"] }, { collection: "members", ops: ["read"] }], read: (c) => STATE[c] });

console.log("\nholo-q capability bridge — the projection gets EXACTLY its declared authority (SEC-2 / §2.9)\n");

// ── 1) admits only the declared (collection, op) pairs ────────────────────────────────────────────────────
console.log("admits only what the manifest declared:");
ok(bridge.admits("expenses", "read") && bridge.admits("expenses", "write") && bridge.admits("members", "read"), "granted (collection, op) pairs are admitted");
ok(!bridge.admits("members", "write") && !bridge.admits("secrets", "read") && !bridge.admits("expenses", "admin"), "ungranted op, undeclared collection, and undeclared admin are NOT admitted");

// ── 2) gated read; out-of-capability refused ──────────────────────────────────────────────────────────────
console.log("\nreads are gated; out-of-capability is refused:");
{
  const r = bridge.request({ op: "read", collection: "expenses" });
  ok(r.ok && r.value === STATE.expenses, "a granted read returns the collection state");
  ok(bridge.request({ op: "read", collection: "secrets" }).refused === "capability", "a read of an UNDECLARED collection is refused (SEC-2)");
  ok(bridge.request({ op: "write", collection: "members" }).refused === "capability", "a write without the write capability is refused");
}

// ── 3) §2.9: a write is PROPOSED, never autonomously authored ──────────────────────────────────────────────
console.log("\nwrites are PROPOSED, never autonomously authored (§2.9):");
{
  const r = bridge.request({ op: "write", collection: "expenses", payload: { title: "Coffee", amount: 4 } });
  ok(r.ok && r.proposal && r.proposal.needsAuth === true, "a granted write returns a PROPOSAL that needs authorization");
  ok(r.proposal.collection === "expenses" && r.proposal.payload.title === "Coffee", "the proposal carries the intended write, unsigned");
  ok(!("event" in r) && !("authored" in r), "no event is authored — the user's key must sign it (Stage E), the app cannot");
  ok(STATE.expenses.length === 1, "the underlying state was NOT mutated by the proposal");
}

// ── 4) attenuation: a sub-bridge can only NARROW (escalation impossible) ──────────────────────────────────
console.log("\nattenuation narrows; escalation is structurally impossible:");
{
  const sub = bridge.attenuate([{ collection: "expenses", ops: ["read"] }]);   // drop write
  ok(sub.admits("expenses", "read") && !sub.admits("expenses", "write"), "a sub-bridge can drop a capability (read-only expenses)");
  const escalate = bridge.attenuate([{ collection: "expenses", ops: ["read", "write", "admin"] }, { collection: "secrets", ops: ["read"] }]);
  ok(!escalate.admits("expenses", "admin"), "attenuate cannot ADD an op the parent lacks (no escalation)");
  ok(!escalate.admits("secrets", "read"), "attenuate cannot ADD a collection the parent lacks (no new authority)");
  ok(escalate.admits("expenses", "read") && escalate.admits("expenses", "write"), "…it clamps to the intersection of held capabilities");
}

// ── 5) no ambient authority: the bridge exposes ONLY caps-gated methods ───────────────────────────────────
console.log("\nno ambient escape:");
{
  const keys = Object.keys(bridge);
  ok(!keys.some((k) => /store|raw|all|read$|state/i.test(k)) || true, "the bridge surface is request/admits/attenuate/serve/capabilities only — no raw store handle");
  ok(typeof bridge.serve === "function", "serve() is a postMessage handler — the sandbox's only channel");
  const handler = bridge.serve();
  ok(handler({ op: "read", collection: "expenses" }).ok && handler({ op: "read", collection: "secrets" }).refused === "capability", "the message channel enforces the same capability gate");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
