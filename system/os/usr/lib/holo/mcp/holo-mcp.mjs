// holo-mcp.mjs — project holospaces to a Model Context Protocol server. A holospace's
// apps/<id>/holospace.json manifest declares its resources + tools; this GENERATES the MCP
// server from those manifests (one source of truth for conformance AND agent exposure).
//
// The novelty no ordinary MCP server has: every resource is a SELF-VERIFYING UOR object —
// an agent fetches it AND re-derives its did (Law L5), so provenance + integrity come with
// the context, not from a trusted server. Minimal, transport-agnostic JSON-RPC 2.0 core
// (no SDK dependency); holo-mcp-server.mjs wires a stdio transport. Pure Node.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { verify as verifyObject, jcs, makeObject } from "../holo-object.mjs";
import { makeEdge, personalRank, commitRank, recommend, expandNeighbourhood, THETA } from "../holo-rank.mjs";
import { QmlEngine, createHeadlessBackend } from "../holo-qml.mjs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeApp } from "../holo-app.mjs";
import { makeStore, memBackend } from "../holo-store.js";
import { sha256hex } from "../holo-uor.mjs";
import * as own from "../holo-own.mjs";

export const PROTOCOL_VERSION = "2024-11-05";
const SERVER = { name: "hologram-os", version: "0.1.0", title: "Hologram OS" };

// build · run · share (ADR-0051) — the agent-native verbs, over a per-server in-memory κ-store
// (same makeApp the SDK + <holo-app> use; Node-provable). An agent builds → gets a κ → runs/shares it.
let _forge = null;
function forgeApp() {
  if (_forge) return _forge;
  const store = makeStore({ hash: (b) => sha256hex(b), axis: "did:holo:sha256", backend: memBackend() });
  _forge = makeApp({ store, hash: (b) => sha256hex(b) });
  try { _forge.build.compilerKappa = "did:holo:sha256:" + sha256hex(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../holo-forge/holo-forge.mjs"))); } catch {}
  return _forge;
}

// Built-in tools every Hologram MCP server exposes — the self-verifying superpower.
const BUILTIN_TOOLS = [
  { name: "verify_object", description: "Re-derive a UOR object's did from its content and report whether it self-verifies (Law L5).",
    inputSchema: { type: "object", properties: { object: { type: "object" } }, required: ["object"] } },
  { name: "resolve_object", description: "Resolve a did:holo / holo:// resource to its self-verifying UOR object.",
    inputSchema: { type: "object", properties: { uri: { type: "string" } }, required: ["uri"] } },
  { name: "ask_model", description: "Ask the connected agent's OWN model a question (MCP sampling — the INVERSE direction: a holospace borrows the agent's intelligence). Requires a sampling-capable client.",
    inputSchema: { type: "object", properties: { prompt: { type: "string" }, maxTokens: { type: "number" } }, required: ["prompt"] } },
  { name: "ask_user", description: "Ask the human, via the agent host, for input (MCP elicitation). Requires an elicitation-capable client.",
    inputSchema: { type: "object", properties: { message: { type: "string" }, schema: { type: "object" } }, required: ["message"] } },
  { name: "list_roots", description: "List the file:// roots the agent host has granted access to (MCP roots). Requires a roots-capable client.",
    inputSchema: { type: "object", properties: {} } },
  { name: "verify_batch", description: "Verify many UOR objects at once; reports progress and is cancellable.",
    inputSchema: { type: "object", properties: { objects: { type: "array", items: { type: "object" } } }, required: ["objects"] } },
  { name: "holo_rank", description: "Personal, content-addressed PageRank (HoloRank). Given reference edges {rel,from,to,by?,weight?} and a seed (teleport set of did:holo you trust/own), returns a SELF-VERIFYING UOR ranking object. The result is deterministic, so DON'T trust it — re-derive its did (verify_object, Law L5) and/or recompute holo_rank over the same edges to confirm the same κ. Trustless ranking for agents.",
    inputSchema: { type: "object", properties: {
      edges: { type: "array", items: { type: "object", properties: { rel: { type: "string" }, from: { type: "string" }, to: { type: "string" }, by: { type: "string" }, weight: { type: "number" } }, required: ["rel", "from", "to"] } },
      seed: { type: "array", items: { type: "string" } },
      params: { type: "object", properties: { d: { type: "number" }, epsilon: { type: "number" } } } }, required: ["edges", "seed"] } },
  { name: "holo_recommend", description: "One round-trip personal recommendations. Give the apps/did:holo you use ('usage'); the server fetches only YOUR neighbourhood by content address (bounded — taste-aligned reviewers + their picks, not the whole corpus) and ranks it, returning recs (each with a reason) plus a SELF-VERIFYING UOR result you re-derive (Law L5) and can recompute (deterministic). Requires the server to be wired to a review corpus.",
    inputSchema: { type: "object", properties: {
      usage: { type: "array", items: { type: "string" }, description: "app ids / did:holo you already use" },
      limit: { type: "number" }, budget: { type: "number" } }, required: ["usage"] } },
  { name: "render_qml", description: "Parse + EXECUTE a QML document with Holo QML (the from-spec engine that runs the real upstream SDDM greeter in the browser — Qt 6 QML Reference semantics, no Qt runtime) and return its live component tree + signal wiring as a SELF-VERIFYING UOR object: re-derive its did (verify_object, Law L5); deterministic, so an agent recomputes the same κ. Lets an agent introspect any QML UI's structure + the API it wires, without a browser. Input: { qml } (the QML source — e.g. resolve the greeter's source via resolve_object first). The display manager's own greeter is also published as the resource usr/share/sddm/greeter.uor.json.",
    inputSchema: { type: "object", properties: { qml: { type: "string", description: "the QML document source" }, baseUrl: { type: "string", description: "optional base for Qt.resolvedUrl()" } }, required: ["qml"] } },
  { name: "holo_build", description: "BUILD a holospace app: compile source (Holo-C — a C subset: int functions, arithmetic, if/while, short-circuit logic, calls, mutual recursion) to spec-valid WebAssembly, persisted by its content address (κ). Deterministic + O(1) on repeat (identical source rebinds, not recompiles). Returns { ok, kappa (the artifact did:holo), sourceKappa, receipt (a self-verifying PROV-O build receipt κ), exports }. On a compile error returns { ok:false, error:{ message, line, col } } — FIX the source at that line and call holo_build again (the tight build loop). COMPOSE by content address: declare `extern int f(int a) from \"did:holo:…\";` (or `str` params/results for strings) to import another component's export BY ITS κ — the response's `imports` lists the dependency κ's, holo_run links them automatically. Serverless, self-verifying (Law L5).",
    inputSchema: { type: "object", properties: { source: { type: "string", description: "Holo-C source" }, lang: { type: "string", description: "default holo-c" } }, required: ["source"] } },
  { name: "holo_run", description: "RUN a built app by content address. Pass { kappa } (an ARTIFACT κ runs directly; a SOURCE κ self-compiles then runs) OR { source } to build-then-run. Optionally { fn, args } to call an exported function with i32 args and get its result. Returns { ok, kappa, selfCompiled, exports:[names], result? }. The wasm is re-derived before running (Law L5). No server.",
    inputSchema: { type: "object", properties: { kappa: { type: "string", description: "artifact or source κ" }, source: { type: "string", description: "Holo-C source (if no kappa)" }, fn: { type: "string", description: "exported function to call" }, args: { type: "array", items: { type: "number" }, description: "i32 args for fn" } } } },
  { name: "holo_share", description: "SHARE a built app: the κ IS the share. Returns { kappa, holo (holo://κ), url } — location-independent, self-verifying, self-compiling; the recipient resolves it from cache/peers/IPFS/origin, re-derives it (Law L5), and runs it, with no server. Agents collaborate by passing κ.",
    inputSchema: { type: "object", properties: { kappa: { type: "string", description: "the artifact or source κ to share" } }, required: ["kappa"] } },
  { name: "own_verify", description: "Verify a content-addressed OWNERSHIP chain (ADR-053 Titles): re-derive every Title κ, check each transfer's signature + authority (the current owner, or an attenuated UCAN delegation) + lineage (Law L5 / SEC-2), and report who owns it NOW. Returns { ok, owner (σ-axis κ), ownerDid (did:holo), head, errors, result } — `result` is a SELF-VERIFYING UOR object (re-derive its id, Law L5). An agent verifies ownership without trusting any server. An agent ACQUIRES ownership by signing a Title locally (its own holo-identity) and verifying the extended chain here.",
    inputSchema: { type: "object", properties: { titles: { type: "array", items: { type: "object" }, description: "the Title chain, genesis→head" }, delegations: { type: "object", description: "optional { titleκ: delegation } proofs for delegated transfers" } }, required: ["titles"] } },
  { name: "own_settle", description: "Settle value against a PROVEN Title (ADR-053/048): releases a voucher ONLY if the ownership chain re-derives AND the payer's order commits to the proven head — pay against proven ownership, not claimed. Keyless + anyone-runs; a tampered/unproven Title releases nothing. Returns { released, voucher } (voucher κ = the idempotent txId).",
    inputSchema: { type: "object", properties: { order: { type: "object", properties: { subject: { type: "string" }, amount: { type: "object" }, buyer: { type: "string" } }, required: ["subject"] }, titles: { type: "array", items: { type: "object" } }, delegations: { type: "object" } }, required: ["order", "titles"] } },
  { name: "own_passport", description: "An ownership passport for an object: verify its Title chain and summarise { owner, ownerDid, verified, history (number of transfers), head } as a SELF-VERIFYING UOR object (re-derive its id, Law L5). The agent-facing 'who owns this, provably' tool.",
    inputSchema: { type: "object", properties: { titles: { type: "array", items: { type: "object" } } }, required: ["titles"] } },
];

// Built-in prompts — reusable, agent-facing templates that teach the self-verifying model.
const BUILTIN_PROMPTS = [
  { name: "verify_object", description: "Verify a UOR object by re-deriving its did (Law L5).",
    arguments: [{ name: "did", description: "the did:holo of the object", required: true }],
    render: (a) => [{ role: "user", content: { type: "text", text: `Resolve the UOR object ${a?.did || "<did>"}, re-derive its hash, and confirm it self-verifies (Law L5). Report verified true/false and what it is.` } }] },
  { name: "conformance_brief", description: "Explain Hologram OS's content-addressed, self-verifying model to an agent.",
    arguments: [],
    render: () => [{ role: "user", content: { type: "text", text: "Hologram OS objects are content-addressed (did:holo) and self-verifying: fetch any object, re-derive its hash, and you have verified it (Law L5). Resources you receive are JSON-LD you can both interpret and verify. Prefer verify_object before trusting a resource." } }] },
];

// A built-in, self-verifying sample resource, so a fresh server has live data demonstrating
// verify-by-re-derivation out of the box (Law L5) — not an empty resource list.
export const SAMPLE_URI = "holo://sample";
export const sampleObject = () => makeObject(new Map(), { type: ["schema:CreativeWork", "prov:Entity"],
  "schema:name": "Hologram OS sample object",
  "schema:description": "A self-verifying UOR object — re-derive its id from its content to verify it (Law L5)." });
const BUILTIN_RESOURCES = [
  { uri: SAMPLE_URI, name: "Sample UOR object", description: "A built-in self-verifying object; re-derive its id to verify it (Law L5).", mimeType: "application/ld+json", type: "schema:CreativeWork" },
];

// getPrompt(registry, name, args) → { description, messages } (MCP prompts/get result).
export function getPrompt(registry, name, args) {
  const p = (registry.prompts || []).find((x) => x.name === name);
  if (!p) return null;
  return { description: p.description, messages: p.render ? p.render(args || {}) : (p.messages || []) };
}

// paginate(items, cursor, size) → { page, nextCursor } — MCP list pagination. The cursor is
// an opaque numeric string (isomorphic: no Buffer), absent when there are no more pages.
export const paginate = (items, cursor, size = 50) => {
  const start = cursor && Number.isFinite(+cursor) ? +cursor : 0;
  const page = items.slice(start, start + size);
  return { page, nextCursor: start + size < items.length ? String(start + size) : undefined };
};

// scanManifests(appsDir) → every apps/<id>/holospace.json (the _example template is skipped).
export function scanManifests(appsDir) {
  if (!existsSync(appsDir)) return [];
  const out = [];
  for (const d of readdirSync(appsDir)) {
    if (d.startsWith("_") || d.startsWith(".")) continue;
    const p = join(appsDir, d, "holospace.json");
    if (existsSync(p)) { try { out.push(JSON.parse(readFileSync(p, "utf8"))); } catch {} }
  }
  return out;
}

// buildRegistry(manifests) → the MCP capability set aggregated from the manifests.
export function buildRegistry(manifests = []) {
  const resources = [...BUILTIN_RESOURCES], tools = [...BUILTIN_TOOLS], prompts = [...BUILTIN_PROMPTS];
  for (const m of manifests) {
    for (const r of m.resources || []) resources.push({ uri: r.uri, name: r.name, description: r.description,
      mimeType: r.mimeType || "application/ld+json", type: r.type, app: m.name });
    for (const t of m.tools || []) if (!tools.some((x) => x.name === t.name))
      tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema || { type: "object" }, app: m.name });
    for (const p of m.prompts || []) if (!prompts.some((x) => x.name === p.name))
      prompts.push({ name: p.name, description: p.description, arguments: p.arguments || [], render: () => p.messages || [] });
  }
  return { server: SERVER, resources, tools, prompts };
}

// Agentic-framework interop — the MCP tool registry projects deterministically to the tool
// schemas other agent runtimes consume, so the same holospace capabilities are callable from
// OpenAI function-calling, the Anthropic Messages API, and any MCP host. One registry, many
// runtimes — MCP is the universal bridge; these are the thin shape adapters onto it.
export const toOpenAITools = (registry) => registry.tools.map((t) => ({
  type: "function", function: { name: t.name, description: t.description || "", parameters: t.inputSchema || { type: "object" } } }));
export const toAnthropicTools = (registry) => registry.tools.map((t) => ({
  name: t.name, description: t.description || "", input_schema: t.inputSchema || { type: "object" } }));

// descriptor(registry) → the discovery document to publish at .well-known/mcp.json.
export const descriptor = (registry) => ({ mcpVersion: PROTOCOL_VERSION, server: registry.server,
  resources: registry.resources.map(({ uri, name, mimeType }) => ({ uri, name, mimeType })),
  tools: registry.tools.map(({ name, description }) => ({ name, description })),
  prompts: (registry.prompts || []).map(({ name, description }) => ({ name, description })) });

// handle(req, ctx) → a JSON-RPC 2.0 response. ctx: { registry, resolve(uri)→object|null,
// toolHandlers?: { [name]: (args)=>any } }. Implements the MCP core surface.
export async function handle(req, ctx) {
  const reply = (result) => ({ jsonrpc: "2.0", id: req.id ?? null, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id: req.id ?? null, error: { code, message } });
  const text = (s) => ({ content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s) }] });
  const { registry } = ctx;
  switch (req.method) {
    case "initialize":
      return reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { resources: {}, tools: {} }, serverInfo: registry.server });
    case "resources/list":
      return reply({ resources: registry.resources.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType })) });
    case "resources/read": {
      const uri = req.params?.uri;
      const obj = uri === SAMPLE_URI ? sampleObject() : (ctx.resolve ? ctx.resolve(uri) : null);
      if (!obj) return fail(-32602, "resource not found: " + uri);
      return reply({ contents: [{ uri, mimeType: "application/ld+json", text: jcs(obj) }] });
    }
    case "tools/list":
      return reply({ tools: registry.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "prompts/list":
      return reply({ prompts: (registry.prompts || []).map(({ name, description, arguments: a }) => ({ name, description, arguments: a })) });
    case "prompts/get": {
      const p = getPrompt(registry, req.params?.name, req.params?.arguments);
      return p ? reply(p) : fail(-32602, "prompt not found: " + req.params?.name);
    }
    case "tools/call": {
      const { name, arguments: args = {} } = req.params || {};
      if (name === "verify_object") {
        if (!args.object || typeof args.object !== "object") return reply({ ...text("verify_object requires an 'object' argument (a UOR object)"), isError: true });
        return reply({ ...text({ verified: verifyObject(args.object), did: args.object?.id }) }); }
      if (name === "resolve_object") { const o = args.uri === SAMPLE_URI ? sampleObject() : (ctx.resolve ? ctx.resolve(args.uri) : null);
        return o ? reply(text(jcs(o))) : reply({ ...text("not found: " + args.uri), isError: true }); }
      if (name === "verify_batch") {
        if (!Array.isArray(args.objects)) return reply({ ...text("verify_batch requires an 'objects' array"), isError: true });
        return reply(text(args.objects.map((o) => ({ id: o?.id, verified: verifyObject(o) })))); }
      if (name === "holo_rank") {
        if (!Array.isArray(args.edges) || !Array.isArray(args.seed) || !args.seed.length)
          return reply({ ...text("holo_rank requires { edges:[{rel,from,to,by?,weight?}], seed:[did:holo] }"), isError: true });
        const d = args.params?.d ?? 0.85, epsilon = args.params?.epsilon ?? 1e-6;
        const store = new Map();
        const built = args.edges.map((e) => makeEdge(store, { rel: e.rel, from: e.from, to: e.to, by: e.by, weight: e.weight, at: e.at }));
        const { ranking, converged } = personalRank(built, args.seed, { d, epsilon });
        // The result is a content-addressed UOR object: its κ commits to {algorithm + params +
        // input-edge κ-set + teleport + ranking}. Deterministic → any agent re-derives the SAME κ.
        const result = commitRank(store, { ranking, edges: built, seed: args.seed, params: { d, alpha: 1 - d, epsilon, theta: THETA } });
        return reply(text({ ranking, converged, result }));
      }
      if (name === "holo_recommend") {
        const src = ctx.reviewSource;                                   // { reviewsByApp, reviewsByReviewer, apps } — wired to a κ-store/relay
        if (!src || typeof src.reviewsByApp !== "function" || !src.apps)
          return reply({ ...text("holo_recommend needs a review source — wire the server to a corpus (κ-store / relay)"), isError: true });
        const usage = Array.isArray(args.usage) ? args.usage : [];
        if (!usage.length) return reply({ ...text("holo_recommend requires a non-empty 'usage' array"), isError: true });
        const nb = expandNeighbourhood({ seedApps: usage, reviewsByApp: src.reviewsByApp, reviewsByReviewer: src.reviewsByReviewer, budget: args.budget ?? 4000 });
        const rec = recommend({ apps: src.apps, reviews: nb.reviews, usage, limit: args.limit ?? 8 });
        // verifiable: κ commits to {usage + the fetched neighbourhood's review κ-set + recs}; the agent
        // re-derives it (Law L5) and, since recommend is deterministic, recomputes the same κ.
        const result = makeObject(new Map(), { type: ["prov:Entity", "schema:Dataset"], "schema:name": "HoloRank recommendations",
          "prov:wasGeneratedBy": { "@type": "prov:Activity", algorithm: "neighbourhood-recommend" },
          "prov:used": nb.reviews.map((r) => r.id || `${r.app_id}|${r.user_hash}`).sort(), teleport: [...usage].sort(), recs: rec.recs });
        return reply(text({ recs: rec.recs, personalized: rec.personalized, fetched: { indexReads: nb.fetches, reviews: nb.reviews.length }, result }));
      }
      if (name === "render_qml") {
        if (typeof args.qml !== "string" || !args.qml.trim()) return reply({ ...text("render_qml requires a 'qml' string (the QML document source)"), isError: true });
        try {
          // a neutral, side-effect-free greeter context so bindings resolve without a session
          const stub = {
            sddm: { hostName: "device", canPowerOff: true, canReboot: true, login() {}, powerOff() {}, reboot() {}, suspend() {}, connect() {} },
            userModel: { lastUser: "", count: 0, users: [] },
            sessionModel: { lastIndex: 0, sessions: [], count: 0 },
            textConstants: {}, keyboard: { enabled: false, capsLock: false, layouts: [] }, config: {},
          };
          const engine = new QmlEngine({ backend: createHeadlessBackend(), context: stub, baseUrl: typeof args.baseUrl === "string" ? args.baseUrl : "" });
          engine.load(args.qml);
          const tree = JSON.parse(JSON.stringify(engine.describeTree()));      // drop undefined-valued keys → canonical-safe
          const count = (function c(n) { return n ? 1 + (n.children || []).reduce((s, k) => s + c(k), 0) : 0; })(tree);
          // a self-verifying UOR record of the render: κ commits to {engine + imports + tree}
          const result = makeObject(new Map(), {
            type: ["schema:SoftwareSourceCode", "prov:Entity"],
            "schema:name": "Holo QML render", "schema:programmingLanguage": "QML",
            "prov:wasGeneratedBy": { "@type": "prov:Activity", "schema:name": "holo-qml", algorithm: "holo-qml engine (Qt 6 QML Reference)" },
            imports: engine.document.imports.map((i) => `${i.module} ${i.version}`.trim()),
            objectCount: count, tree, warnings: engine._warns.slice(0, 20),
          });
          return reply(text({ objectCount: count, imports: result.imports, warnings: result.warnings, result }));
        } catch (e) { return reply({ ...text("render_qml parse/exec error: " + ((e && e.message) || e)), isError: true }); }
      }
      if (name === "holo_build") {
        if (typeof args.source !== "string" || !args.source.trim()) return reply({ ...text("holo_build requires a 'source' string (Holo-C)"), isError: true });
        try { const b = await forgeApp().build(args.source, { lang: args.lang });
          return reply(text({ ok: true, kappa: b.kappa, sourceKappa: b.sourceKappa, receipt: b.receipt, exports: b.exports, imports: b.imports || [], rebind: !!b.hit })); }
        catch (e) { return reply(text({ ok: false, error: { message: (e && e.message) || String(e), line: e && e.line, col: e && e.col } })); }   // structured → the agent fixes + retries
      }
      if (name === "holo_run") {
        const ref = (typeof args.kappa === "string" && args.kappa) || (typeof args.source === "string" && args.source);
        if (!ref) return reply({ ...text("holo_run requires 'kappa' or 'source'"), isError: true });
        try { const r = await forgeApp().run(ref); const out = { ok: true, kappa: r.kappa, selfCompiled: r.selfCompiled, exports: Object.keys(r.exports) };
          if (args.fn) { const fn = r.exports[args.fn];
            if (typeof fn !== "function") return reply(text({ ok: false, error: { message: `no export '${args.fn}'` }, exports: out.exports }));
            out.result = fn(...(Array.isArray(args.args) ? args.args.map((n) => n | 0) : [])); }
          return reply(text(out)); }
        catch (e) { return reply(text({ ok: false, error: { message: (e && e.message) || String(e) } })); }
      }
      if (name === "holo_share") {
        if (typeof args.kappa !== "string") return reply({ ...text("holo_share requires a 'kappa'"), isError: true });
        return reply(text(forgeApp().share(args.kappa)));
      }
      if (name === "ask_model") { if (ctx.sampler) return reply(text(await ctx.sampler(args)));
        return reply({ ...text("ask_model (sampling) needs a sampling-capable connection — use the SDK server"), isError: true }); }
      if (name === "ask_user" || name === "list_roots") return reply({ ...text(`${name} needs a live agent connection (server→client) — use the SDK server`), isError: true });
      if (name === "own_verify") {
        if (!Array.isArray(args.titles) || !args.titles.length) return reply({ ...text("own_verify requires a non-empty 'titles' array (the ownership chain)"), isError: true });
        const v = await own.verifyChain(args.titles, { delegations: args.delegations || {} });
        const head = args.titles[args.titles.length - 1];
        const result = makeObject(new Map(), { type: ["prov:Entity", "schema:Claim"], "schema:name": "Ownership verification",
          "prov:wasGeneratedBy": { "@type": "prov:Activity", algorithm: "holo-own verifyChain (ADR-053)" },
          subject: (head && head["@id"]) || null, verified: v.ok, owner: v.owner || null, ownerDid: v.ownerDid || null, errors: v.errors || [] });
        return reply(text({ ok: v.ok, owner: v.owner, ownerDid: v.ownerDid, head: head && head["@id"], errors: v.errors, result }));
      }
      if (name === "own_settle") {
        if (!args.order || !Array.isArray(args.titles)) return reply({ ...text("own_settle requires { order, titles }"), isError: true });
        const voucher = await own.settle({ order: args.order, chain: { titles: args.titles, delegations: args.delegations || {} } });
        return reply(text({ released: !!voucher, voucher: voucher || null }));
      }
      if (name === "own_passport") {
        if (!Array.isArray(args.titles) || !args.titles.length) return reply({ ...text("own_passport requires a 'titles' array"), isError: true });
        const v = await own.verifyChain(args.titles);
        const head = args.titles[args.titles.length - 1];
        const result = makeObject(new Map(), { type: ["prov:Entity", "schema:Dataset"], "schema:name": "Ownership passport",
          subject: (head && head["@id"]) || null, owner: v.owner || null, ownerDid: v.ownerDid || null, verified: v.ok, history: args.titles.length });
        return reply(text({ owner: v.owner, ownerDid: v.ownerDid, verified: v.ok, history: args.titles.length, head: head && head["@id"], result }));
      }
      if (ctx.toolHandlers && ctx.toolHandlers[name]) return reply(text(await ctx.toolHandlers[name](args)));
      if (registry.tools.some((t) => t.name === name)) return reply({ ...text(`tool '${name}' is declared by a holospace; wire its handler`), isError: true });
      return fail(-32602, "unknown tool: " + name);
    }
    default: return fail(-32601, "method not found: " + req.method);
  }
}

// makeServer(appsDir, resolve) → a ready handler bound to a registry + resolver.
export function makeServer({ appsDir, manifests, resolve, toolHandlers } = {}) {
  const registry = buildRegistry(manifests || scanManifests(appsDir));
  return { registry, handle: (req) => handle(req, { registry, resolve, toolHandlers }) };
}
