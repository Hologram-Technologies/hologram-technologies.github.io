#!/usr/bin/env node
// holo-ad4m-mcp-witness.mjs — AD4M FOR AGENTS: the meta-ontology as callable tools, no new server. The same
// { describe, listTools, prepare, invoke } surface Q registers, bound to a live makeAd4m + Perspective +
// Neighbourhood, and projected as MCP tool descriptors. An agent drives the FULL ontology end to end
// (create → link → query → join), every result is substrate-shaped, an unknown tool fails closed, and the
// MCP descriptors validate + register onto a mock server.
//
// Authority: AD4M live MCP server (docs.ad4m.dev) · Model Context Protocol tool shape · holospaces Law L2
// (one wire) · rests on #holo-ad4m + #holo-ad4m-neighbourhood. node tools/holo-ad4m-mcp-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeAd4m } from "../os/usr/lib/holo/holo-ad4m.mjs";
import { makeNeighbourhood } from "../os/usr/lib/holo/holo-ad4m-neighbourhood.mjs";
import { makeAd4mAgent } from "../os/usr/lib/holo/holo-ad4m-mcp.mjs";
import { verify as verifyObj } from "../os/usr/lib/holo/holo-object.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-25T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "mcp-agent", passphrase: "agents are peers" });
const ad4m = makeAd4m({ signer: op, store: new Map(), now });
const persp = ad4m.perspective({ backend: arrayBackend() });
const nb = makeNeighbourhood({ perspective: persp, me: op.kappa, self: "agent", post: () => {} });
const face = makeAd4mAgent({ ad4m, perspective: persp, neighbourhood: nb });

// ── 1 · listTools exposes the 7 AD4M verbs ───────────────────────────────────────────────────────────
const names = face.listTools().map((t) => t.name);
const want = ["agent_me", "expression_create", "expression_get", "perspective_add_link", "perspective_query", "neighbourhood_publish", "neighbourhood_join"];
ok("sevenVerbs", want.every((w) => names.includes(w)) && names.length === 7, JSON.stringify(names));

// ── 2 · agent_me returns the sovereign DID ───────────────────────────────────────────────────────────
const meR = await face.invoke("agent_me");
ok("agentMe", meR.ok && meR.did === op.kappa, JSON.stringify(meR.did && meR.did.slice(-8)));

// ── 3 · expression_create then expression_get round-trips; the result is a verifiable κ ──────────────
const cr = await face.invoke("expression_create", { language: "literal", data: { headline: "agents cohere" } });
const gr = await face.invoke("expression_get", { url: cr.url });
ok("expressionRoundTrip", cr.ok && verifyObj(cr.expr) && gr.ok && gr.expr.id === cr.url, JSON.stringify({ c: cr.ok, g: gr.ok }));

// ── 4 · perspective_add_link + perspective_query returns the Link ────────────────────────────────────
const al = await face.invoke("perspective_add_link", { source: op.kappa, predicate: "authored", target: cr.url });
const ql = await face.invoke("perspective_query", { predicate: "authored" });
ok("linkAndQuery", al.ok && ql.ok && ql.links.some((l) => l.target === cr.url && l.author === op.kappa), JSON.stringify(ql.links.map((l) => l.predicate)));

// ── 5 · neighbourhood_publish advertises (head present); join lists members ──────────────────────────
const pub = await face.invoke("neighbourhood_publish");
const jn = await face.invoke("neighbourhood_join");
ok("neighbourhoodTools", pub.ok && pub.published === persp.head() && jn.ok && jn.members.includes(op.kappa), JSON.stringify({ pub: pub.ok, join: jn.ok }));

// ── 6 · an unknown tool fails closed ─────────────────────────────────────────────────────────────────
const un = await face.invoke("delete_everything", {});
ok("unknownToolRefused", un.ok === false && /unknown tool/.test(un.reason), JSON.stringify(un));

// ── 7 · MCP descriptors validate (name + description + JSON inputSchema) ─────────────────────────────
const mcp = face.mcpTools();
ok("mcpDescriptorsValid", mcp.length === 7 && mcp.every((t) => t.name && t.description && t.inputSchema && t.inputSchema.type === "object"), JSON.stringify(mcp.map((t) => t.name).slice(0, 3)));

// ── 8 · register() wires every tool onto a mock MCP server, and a wired tool actually invokes ────────
const registered = []; let captured = null;
const mockServer = { registerTool: (name, _meta, handler) => { registered.push(name); if (name === "agent_me") captured = handler; } };
const wiredNames = face.register(mockServer);
const wiredResult = captured ? await captured({}) : null;
ok("registerWires", registered.length === 7 && wiredNames.length === 7 && wiredResult && JSON.parse(wiredResult.content[0].text).did === op.kappa, JSON.stringify(registered.slice(0, 3)));

await forget(op.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ad4m-mcp — AD4M's agent-centric web as callable tools with NO new server: the { describe, listTools, prepare, invoke } surface Q registers, bound to a live makeAd4m + Perspective + Neighbourhood, and projected as MCP tool descriptors for @modelcontextprotocol/sdk. An AI agent drives the full ontology end to end; every result is substrate-shaped (a verifiable κ); a human and a delegated agent travel the same path. In-substrate/in-host, never a daemon.",
  authority: "AD4M live MCP server (docs.ad4m.dev) · Model Context Protocol tool shape · holospaces Law L2 · rests on #holo-ad4m + #holo-ad4m-neighbourhood",
  witnessed,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-mcp-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m MCP witness — the agent-centric web as callable tools (agents are peers, no server)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
