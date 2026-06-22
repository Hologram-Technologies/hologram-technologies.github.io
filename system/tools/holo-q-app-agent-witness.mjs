// holo-q-app-agent-witness.mjs — Stage H proof (the whole loop): one intent → a SEALED, CONFORMANT, full-stack
// holo-app. The agent composes A–G, SELF-TESTS the produced app against the laws (L1/L5/SEC-2/§2.9/§3 + beauty),
// SELF-FIXES a bad plan into a valid app, seals to one manifest κ, and checkpoints each build (free rollback). It
// never authors data autonomously (§2.9). Deterministic. Composes the REAL modules end-to-end. Pure Node.
// Run: node holo-q-app-agent-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const { buildFullStackApp, conformanceCheck } = await imp("../os/usr/lib/holo/q/holo-q-app-agent.mjs");
const { openApp, mergeStores } = await imp("../os/usr/lib/holo/q/holo-q-app-seal.mjs");
const { serveMcp } = await imp("../os/usr/lib/holo/q/holo-q-app-api.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// the "plan": Q's structured synth — intent → a typed spec. (Here a deterministic stand-in for the on-device model.)
const plan = async (intent) => ({
  name: "Flat Expenses", identity: "required",
  ui: { type: "page", children: [{ type: "hero", props: { title: "Flat Expenses", subtitle: intent, cta: "Add" } }, { type: "form", props: { fields: [{ label: "What", name: "title", type: "text" }], submit: "add" } }] },
  collections: [{ name: "expenses", kind: "expense", fields: [{ name: "title", type: "string" }, { name: "amount", type: "number" }] }],
  capabilities: [{ collection: "expenses", ops: ["read", "write"] }],
});

console.log("\nholo-q app agent — one sentence → a sealed, conformant, full-stack holo-app\n");

// ── 1) end-to-end: intent → a sealed full-stack app, ALL law checks pass ──────────────────────────────────
console.log("the whole loop (plan → compile → wire → self-test → seal → checkpoint):");
const r = await buildFullStackApp("a shared expense tracker for my flat, with logins", { plan, pricing: { expenses: { amount: 5, currency: "USDC" } } });
ok(/^[0-9a-f]{64}$/.test(r.manifestK), "produced a single sealed app κ from one intent");
ok(r.test.ok, "the app PASSES every law check: " + r.test.checks.map((c) => c.rule + (c.ok ? "✓" : "✗")).join(" · "));
ok(r.app.collections.length === 1 && r.api.routes.length > 0 && r.bridge.capabilities.length === 1, "the full stack is wired: UI + data (collection) + REST/MCP + capability bridge");
ok(r.api.routes.some((x) => x.path === "/expenses/access" && x.op === "purchase"), "monetization wired (a priced collection got a purchase route)");

// ── 2) the sealed app opens + verifies (any browser, serverless) ──────────────────────────────────────────
console.log("\nthe sealed app opens + verifies anywhere:");
{
  const opened = openApp(r.manifestK, r.sealed.store);
  ok(opened.manifest.name === "Flat Expenses" && opened.projectionHtml.includes("Flat Expenses"), "opening the κ resolves the verified app");
}

// ── 3) §2.9: the agent never authors data autonomously ────────────────────────────────────────────────────
console.log("\nconsent-gated — the agent never writes on the user's key (§2.9):");
{
  const call = serveMcp({ api: r.api, bridge: r.bridge });
  const w = call("propose_expenses", { title: "Coffee", amount: 4 });
  ok(w.proposal && w.proposal.needsAuth && !("event" in w), "an agent 'write' is only a PROPOSAL — it needs the user's authorization");
}

// ── 4) SELF-FIX: a broken plan still yields a valid, conformant app ───────────────────────────────────────
console.log("\nself-fix — a broken plan heals into a valid app:");
{
  const badPlan = async () => ({ ui: { type: "NOPE" }, collections: "garbage", capabilities: [{ collection: "ghost", ops: ["hack"] }] });
  const b = await buildFullStackApp("a thing", { plan: badPlan });
  ok(b.test.ok && /^[0-9a-f]{64}$/.test(b.manifestK), "a malformed plan still produces a sealed, law-passing app (never a broken one)");
  const thrower = async () => { throw new Error("model died"); };
  const t = await buildFullStackApp("a notes app", { plan: thrower });
  ok(t.test.ok && t.app.projectionHtml.includes("notes app"), "a plan that THROWS → the loop falls back to a valid app from the intent");
}

// ── 5) κ-checkpoints: each build is a version; rollback = a prior κ ────────────────────────────────────────
console.log("\nκ-checkpoints — every build is a version; rollback is free:");
{
  const v1 = await buildFullStackApp("v1", { plan: async () => ({ name: "App", ui: { type: "page", children: [{ type: "hero", props: { title: "Version One" } }] }, collections: [], capabilities: [] }) });
  const v2 = await buildFullStackApp("v2", { history: v1.checkpoints, plan: async () => ({ name: "App", ui: { type: "page", children: [{ type: "hero", props: { title: "Version Two" } }] }, collections: [], capabilities: [] }) });
  ok(v2.checkpoints.length === 2 && v2.checkpoints[0] === v1.manifestK, "the checkpoint chain records each build's κ");
  const both = mergeStores(v1.sealed.store, v2.sealed.store);
  ok(openApp(v1.manifestK, both).projectionHtml.includes("Version One"), "rollback: a prior checkpoint κ still opens to that exact version (immutable)");
  ok(v1.manifestK !== v2.manifestK, "each version is a distinct κ");
}

// ── 6) deterministic ──────────────────────────────────────────────────────────────────────────────────────
console.log("\ndeterministic:");
{
  const a = await buildFullStackApp("x", { plan });
  const b = await buildFullStackApp("x", { plan });
  ok(a.manifestK === b.manifestK, "same intent+plan → same app κ (re-derivable)");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
