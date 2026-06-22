// holo-q-app-api-witness.mjs — Stage F proof: the unified REST + monetization + MCP surface is DERIVED from the
// manifest capabilities and routes through the capability bridge, so it is capability-scoped BY CONSTRUCTION — a
// route/tool exists only for a declared capability (none beyond the caps); reads are gated, writes return
// proposals (never autonomously authored, §2.9), token-gating requires a grant, monetization turns payment into
// a grant, and an MCP agent gets exactly the declared, attenuated authority and can never escalate or auto-author
// (SEC-2 / §2.9 / §4.4). Composes the REAL app-spec compiler + capability bridge. Pure Node. Run: node …-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const { compileSpec } = await imp("../os/usr/lib/holo/q/holo-q-app-spec.mjs");
const { createCapBridge } = await imp("../os/usr/lib/holo/q/holo-q-cap-bridge.mjs");
const { deriveApi, serveApi, serveMcp } = await imp("../os/usr/lib/holo/q/holo-q-app-api.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// a real app: read+write on "posts" (gated for pay), read on "members". "secrets" is NOT declared anywhere.
const app = compileSpec({
  name: "Members Blog", identity: "required",
  ui: { type: "page", children: [{ type: "hero", props: { title: "Members Blog" } }] },
  collections: [{ name: "posts", kind: "post", fields: [{ name: "title", type: "string" }] }, { name: "members", kind: "member", fields: [{ name: "name", type: "string" }] }],
  capabilities: [{ collection: "posts", ops: ["read", "write"] }, { collection: "members", ops: ["read"] }],
});
const STATE = { posts: [{ title: "Hello" }], members: ["alice"] };
const bridge = createCapBridge({ capabilities: app.capabilities, read: (c) => STATE[c] });
const api = deriveApi(app.manifest, { pricing: { posts: { amount: 5, currency: "USDC" } } });

console.log("\nholo-q app api — REST + monetization + MCP, derived from caps, capability-scoped\n");

// ── 1) the surface is DERIVED from caps — nothing beyond the declared capabilities ────────────────────────
console.log("derived surface (no route/tool exceeds the manifest):");
ok(api.routes.some((r) => r.method === "GET" && r.path === "/posts") && api.routes.some((r) => r.method === "POST" && r.path === "/posts"), "posts (read+write) → GET + POST routes");
ok(api.routes.some((r) => r.path === "/members") && !api.routes.some((r) => r.method === "POST" && r.path === "/members"), "members (read-only) → GET but NO write route");
ok(!api.routes.some((r) => /secrets/.test(r.path)) && !api.tools.some((t) => /secrets/.test(t.name)), "no route/tool for an UNDECLARED collection (can't exceed the caps)");
ok(api.tools.some((t) => t.name === "read_posts") && api.tools.some((t) => t.name === "propose_posts") && api.tools.some((t) => t.name === "read_members"), "MCP tools mirror the capabilities");

// ── 2) REST: read gated; write → proposal (§2.9); out-of-cap → 404/403 ────────────────────────────────────
console.log("\nREST is capability-scoped:");
{
  let grant = false;
  const handle = serveApi({ api, bridge, hasGrant: () => grant, purchase: (col, pay) => (pay && pay.amount >= 5 ? { kind: "membership", action: "grant", subject: pay.from, ops: ["read"], needsAuth: true } : null) });
  ok(handle({ method: "GET", path: "/posts" }).status === 401, "a token-gated read with NO grant is refused (401)");
  grant = true;
  const r = handle({ method: "GET", path: "/posts" });
  ok(r.status === 200 && r.value === STATE.posts, "with a grant, the gated read returns the collection state");
  const w = handle({ method: "POST", path: "/posts", body: { title: "New" } });
  ok(w.status === 200 && w.proposal && w.proposal.needsAuth, "a write returns a PROPOSAL (needs authorization), never auto-authored (§2.9)");
  ok(handle({ method: "DELETE", path: "/secrets" }).status === 404, "a request outside the surface → 404 (no route)");
  ok(handle({ method: "POST", path: "/members", body: {} }).status === 404, "no write route on a read-only collection (can't exceed caps)");
}

// ── 3) monetization: pay → grant (the grant unlocks the gate) ─────────────────────────────────────────────
console.log("\nmonetization — pay → grant:");
{
  const handle = serveApi({ api, bridge, hasGrant: () => false, purchase: (col, pay) => (pay && pay.amount >= 5 ? { kind: "membership", action: "grant", subject: pay.from, ops: ["read"], needsAuth: true } : null) });
  ok(api.routes.some((r) => r.path === "/posts/access" && r.op === "purchase" && r.price.amount === 5), "a priced collection gets a purchase route");
  ok(handle({ method: "POST", path: "/posts/access", payment: { amount: 3, from: "bob" } }).refused === "payment-required", "underpayment is refused");
  const paid = handle({ method: "POST", path: "/posts/access", payment: { amount: 5, from: "bob" } });
  ok(paid.status === 200 && paid.grant && paid.grant.action === "grant" && paid.grant.needsAuth, "payment yields a membership GRANT proposal (pay→grant; still consent-gated)");
}

// ── 4) MCP: agent gets exactly the caps; write tool → proposal; no escalation, no auto-author ─────────────
console.log("\nMCP agent surface — attenuated, never auto-authoring:");
{
  const call = serveMcp({ api, bridge });
  ok(call("read_posts").value === STATE.posts, "an agent can READ a granted collection");
  const w = call("propose_posts", { title: "Agent post" });
  ok(w.proposal && w.proposal.needsAuth && !("event" in w), "a write tool returns a PROPOSAL — the agent cannot author on the user's key (§2.9)");
  ok(call("read_secrets").error === "no-tool", "an agent cannot call a tool outside the declared capabilities (no escalation)");
  ok(call("delete_everything").error === "no-tool", "an invented tool is rejected");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
