// holo-mcp-core.mjs — the ISOMORPHIC, node-free Model Context Protocol engine. This is the
// SERVERLESS tier: it imports ONLY holo-object.mjs (browser-safe), so the SAME bytes that answer
// MCP in Node also run in a Service Worker, an in-page transport, or any edge — no server, no SDK,
// no node:fs. A live holospace IS its own MCP server, by content address (Law L4: everything
// through the substrate; Law L1: no server authority).
//
// Single source of truth is ENFORCED, not assumed: holo-mcp-core-witness.mjs asserts byte-identical
// behaviour with the heavy Node core (holo-mcp.mjs) on the shared surface — capability card, registry
// shapes, and the standardized tool responses. Drift turns the gate red.
//
// The heavy, Node-only built-ins (render_qml, bittensor_*, own_*, holo_rank) are NOT in this tier;
// build·run·share are available when an app object (window.HoloApp) is injected via ctx.app. The
// effectful escape hatch (ctx.toolHandlers) and the declared κ / projection handlers work everywhere.

import { verify as verifyObject, jcs, makeObject } from "../holo-object.mjs";

export const PROTOCOL_VERSION = "2024-11-05";
export const SERVER = { name: "hologram-os", version: "0.1.0", title: "Hologram OS" };

// ── the STANDARDIZED, application-agnostic core tools — present identically on every holospace ──
export const CORE_TOOLS = [
  { name: "verify_object", description: "Re-derive a UOR object's did from its content and report whether it self-verifies (Law L5).",
    inputSchema: { type: "object", properties: { object: { type: "object" } }, required: ["object"] } },
  { name: "resolve_object", description: "Resolve a did:holo / holo:// resource to its self-verifying UOR object.",
    inputSchema: { type: "object", properties: { uri: { type: "string" } }, required: ["uri"] } },
  { name: "holo_describe", description: "The STANDARDIZED, application-agnostic capability card for THIS holospace — present identically on every Holo app's MCP server. One call returns a self-verifying W3C JSON-LD object (schema.org SoftwareApplication + a schema:Action per tool with its input schema + published resources + conformsTo + MCP protocol metadata): who the app is, what it can do, how to invoke it. Re-derive the card's id to verify it (Law L5). The uniform entry point for an agent to introspect ANY holospace. No args (also published as the resource holo://capabilities).",
    inputSchema: { type: "object", properties: {} } },
  { name: "verify_batch", description: "Verify many UOR objects at once; reports progress and is cancellable.",
    inputSchema: { type: "object", properties: { objects: { type: "array", items: { type: "object" } } }, required: ["objects"] } },
];
// build·run·share — available in the serverless tier when an app/forge is injected (window.HoloApp).
export const FORGE_TOOLS = [
  { name: "holo_build", description: "BUILD a holospace app: compile source (Holo-C) to spec-valid WebAssembly, persisted by its content address (κ). Deterministic + O(1) on repeat. Returns { ok, kappa, sourceKappa, receipt, exports }; a compile error returns { ok:false, error:{message,line,col} }. Serverless, self-verifying (Law L5).",
    inputSchema: { type: "object", properties: { source: { type: "string", description: "Holo-C source" }, lang: { type: "string" } }, required: ["source"] } },
  { name: "holo_run", description: "RUN a built app by content address. Pass { kappa } (artifact runs directly; a source κ self-compiles) OR { source }; optionally { fn, args } to call an exported function (i32 args). The wasm is re-derived before running (Law L5). No server.",
    inputSchema: { type: "object", properties: { kappa: { type: "string" }, source: { type: "string" }, fn: { type: "string" }, args: { type: "array", items: { type: "number" } } } } },
  { name: "holo_share", description: "SHARE a built app: the κ IS the share. Returns { kappa, holo (holo://κ), url } — location-independent, self-verifying, self-compiling; the recipient resolves + re-derives it (Law L5) and runs it, no server.",
    inputSchema: { type: "object", properties: { kappa: { type: "string" } }, required: ["kappa"] } },
];

export const BUILTIN_PROMPTS = [
  { name: "verify_object", description: "Verify a UOR object by re-deriving its did (Law L5).",
    arguments: [{ name: "did", description: "the did:holo of the object", required: true }],
    render: (a) => [{ role: "user", content: { type: "text", text: `Resolve the UOR object ${a?.did || "<did>"}, re-derive its hash, and confirm it self-verifies (Law L5). Report verified true/false and what it is.` } }] },
  { name: "conformance_brief", description: "Explain Hologram OS's content-addressed, self-verifying model to an agent.",
    arguments: [],
    render: () => [{ role: "user", content: { type: "text", text: "Hologram OS objects are content-addressed (did:holo) and self-verifying: fetch any object, re-derive its hash, and you have verified it (Law L5). Resources you receive are JSON-LD you can both interpret and verify. Prefer verify_object before trusting a resource." } }] },
];

export const SAMPLE_URI = "holo://sample";
export const sampleObject = () => makeObject(new Map(), { type: ["schema:CreativeWork", "prov:Entity"],
  "schema:name": "Hologram OS sample object",
  "schema:description": "A self-verifying UOR object — re-derive its id from its content to verify it (Law L5)." });

// The STANDARDIZED, application-agnostic capability card — published at a fixed URI on EVERY holospace.
export const CAPABILITIES_URI = "holo://capabilities";
// capabilityCard(registry) → a self-verifying W3C JSON-LD description of a holospace's agent surface:
// schema.org SoftwareApplication + one schema:Action per tool (with its input schema) + the published
// resources + what it conformsTo + the MCP protocol metadata. App-agnostic shape, app-specific content.
// (DEFINITION SHARED with holo-mcp.mjs by re-export; the witness enforces it stays identical.)
export function capabilityCard(registry) {
  return makeObject(new Map(), {
    type: ["schema:SoftwareApplication", "prov:Entity"],
    "schema:name": registry.server.title || registry.server.name,
    "schema:identifier": registry.server.name,
    "schema:softwareVersion": registry.server.version,
    "schema:applicationCategory": "Holospace",
    "schema:operatingSystem": "Hologram OS",
    "dct:conformsTo": ["https://spec.modelcontextprotocol.io", "https://hologram.os/conformance/os2#holo-shell-mcp"],
    mcp: { protocolVersion: PROTOCOL_VERSION, transport: "streamable-http", capabilities: { tools: {}, resources: {}, prompts: {} } },
    "schema:potentialAction": (registry.tools || []).map((t) => ({ "@type": "schema:Action",
      "schema:name": t.name, "schema:description": t.description || "", "schema:object": t.inputSchema || { type: "object" }, ...(t.app ? { app: t.app } : {}) })),
    "schema:subjectOf": (registry.resources || []).map((r) => ({ "@type": "schema:CreativeWork",
      "@id": r.uri, "schema:name": r.name, "schema:encodingFormat": r.mimeType || "application/ld+json" })),
  });
}
export const CORE_RESOURCES = [
  { uri: SAMPLE_URI, name: "Sample UOR object", description: "A built-in self-verifying object; re-derive its id to verify it (Law L5).", mimeType: "application/ld+json", type: "schema:CreativeWork" },
  { uri: CAPABILITIES_URI, name: "Holospace capability card", description: "The standardized, application-agnostic W3C capability card for this holospace — self-verifying (Law L5).", mimeType: "application/ld+json", type: "schema:SoftwareApplication" },
];

// getPrompt / paginate — identical to the Node core (re-exported there).
export function getPrompt(registry, name, args) {
  const p = (registry.prompts || []).find((x) => x.name === name);
  if (!p) return null;
  return { description: p.description, messages: p.render ? p.render(args || {}) : (p.messages || []) };
}
export const paginate = (items, cursor, size = 50) => {
  const start = cursor && Number.isFinite(+cursor) ? +cursor : 0;
  const page = items.slice(start, start + size);
  return { page, nextCursor: start + size < items.length ? String(start + size) : undefined };
};

// buildRegistry(manifests, builtinTools, builtinResources, builtinPrompts) → the MCP capability set.
// The Node core passes its full BUILTIN_TOOLS; the serverless tier passes CORE_TOOLS (+FORGE_TOOLS).
export function buildRegistry(manifests = [], builtinTools = [...CORE_TOOLS, ...FORGE_TOOLS], builtinResources = CORE_RESOURCES, builtinPrompts = BUILTIN_PROMPTS) {
  const resources = [...builtinResources], tools = [...builtinTools], prompts = [...builtinPrompts];
  for (const m of manifests) {
    for (const r of m.resources || []) resources.push({ uri: r.uri, name: r.name, description: r.description,
      mimeType: r.mimeType || "application/ld+json", type: r.type, app: m.name });
    for (const t of m.tools || []) if (!tools.some((x) => x.name === t.name))
      tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema || { type: "object" }, handler: t.handler, app: m.name });
    for (const p of m.prompts || []) if (!prompts.some((x) => x.name === p.name))
      prompts.push({ name: p.name, description: p.description, arguments: p.arguments || [], render: () => p.messages || [] });
  }
  return { server: SERVER, resources, tools, prompts };
}
export function buildAppRegistry(manifest, builtinTools, builtinResources, builtinPrompts) {
  const reg = buildRegistry(manifest ? [manifest] : [], builtinTools, builtinResources, builtinPrompts);
  if (manifest && manifest.name) reg.server = { ...SERVER, name: "hologram-os/" + (manifest.id || manifest.name), title: manifest.name };
  return reg;
}
export const toOpenAITools = (registry) => registry.tools.map((t) => ({
  type: "function", function: { name: t.name, description: t.description || "", parameters: t.inputSchema || { type: "object" } } }));
export const toAnthropicTools = (registry) => registry.tools.map((t) => ({
  name: t.name, description: t.description || "", input_schema: t.inputSchema || { type: "object" } }));
export const descriptor = (registry) => ({ mcpVersion: PROTOCOL_VERSION, server: registry.server,
  resources: registry.resources.map(({ uri, name, mimeType }) => ({ uri, name, mimeType })),
  tools: registry.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  prompts: (registry.prompts || []).map(({ name, description }) => ({ name, description })) });

// execDeclaredHandler(tool, args, ctx) → an app-declared tool's result, or null if it declares no
// handler. Isomorphic: the κ path runs on the INJECTED forge (ctx.app — window.HoloApp in the browser,
// the Node forge in Node), so the same handler executes serverlessly. (Shared with the Node core.)
export async function execDeclaredHandler(tool, args, ctx) {
  const h = tool && tool.handler;
  if (!h || typeof h !== "object") return null;
  const text = (s) => ({ content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s) }] });
  if (typeof h.resolve === "string") {                                  // declarative projection
    const uri = h.resolve.replace(/\{(\w+)\}/g, (_, k) => (args[k] != null ? String(args[k]) : ""));
    const obj = ctx.resolve ? await ctx.resolve(uri) : null;
    if (!obj) return { ...text("resolve handler: not found — " + uri), isError: true };
    if (!h.select) return text(jcs(obj));
    const value = String(h.select).split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
    const result = makeObject(new Map(), { type: ["prov:Entity", "schema:Dataset"], "schema:name": "Holo MCP projection",
      "prov:wasGeneratedBy": { "@type": "prov:Activity", algorithm: "resolve+select" },
      "prov:used": obj.id || uri, select: h.select, value });
    return text({ value, result });
  }
  if (typeof h.kappa === "string") {                                    // content-addressed WASM transform
    if ((h.abi || "i32") !== "i32") return { ...text(`κ-handler abi '${h.abi}' unsupported (v1: i32)`), isError: true };
    const forge = ctx.app || ctx.forge;
    if (!forge || typeof forge.run !== "function") return { ...text("κ-handler needs a forge (ctx.app / window.HoloApp) — unavailable in this tier"), isError: true };
    try {
      const r = await forge.run(h.kappa);
      const fn = r.exports[h.fn];
      if (typeof fn !== "function") return { ...text(`κ-handler: no export '${h.fn}' in ${h.kappa}`), isError: true };
      const names = Array.isArray(h.params) ? h.params : Object.keys((tool.inputSchema && tool.inputSchema.properties) || {});
      const ints = names.map((n) => args[n] | 0);
      const out = fn(...ints);
      const result = makeObject(new Map(), { type: ["prov:Entity", "schema:Dataset"], "schema:name": "Holo MCP κ-handler result",
        "prov:wasGeneratedBy": { "@type": "prov:Activity", algorithm: "forge-run", handler: r.kappa, fn: h.fn },
        args: ints, result: out });
      return text({ result: out, object: result });
    } catch (e) { return { ...text("κ-handler error: " + ((e && e.message) || e)), isError: true }; }
  }
  return null;
}

// handle(req, ctx) → a JSON-RPC 2.0 response — the SERVERLESS MCP surface. ctx: { registry,
// resolve(uri)→object|null, toolHandlers?, app? (the forge, e.g. window.HoloApp) }. Implements the
// standardized core + build·run·share (via ctx.app) + the declared κ / projection handlers + the
// effectful escape hatch. Heavy Node-only tools (render_qml/bittensor_*/own_*/holo_rank) report an
// honest "Node tier" error here — they are not part of the serverless core.
export async function handle(req, ctx) {
  const reply = (result) => ({ jsonrpc: "2.0", id: req.id ?? null, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id: req.id ?? null, error: { code, message } });
  const text = (s) => ({ content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s) }] });
  const { registry } = ctx;
  const resolveR = async (uri) => uri === SAMPLE_URI ? sampleObject() : uri === CAPABILITIES_URI ? capabilityCard(registry) : (ctx.resolve ? await ctx.resolve(uri) : null);
  switch (req.method) {
    case "initialize":
      return reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { resources: {}, tools: {} }, serverInfo: registry.server });
    case "resources/list":
      return reply({ resources: registry.resources.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType })) });
    case "resources/read": {
      const uri = req.params?.uri; const obj = await resolveR(uri);
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
      if (name === "holo_describe") return reply(text(jcs(capabilityCard(registry))));
      if (name === "resolve_object") { const o = await resolveR(args.uri);
        return o ? reply(text(jcs(o))) : reply({ ...text("not found: " + args.uri), isError: true }); }
      if (name === "verify_batch") {
        if (!Array.isArray(args.objects)) return reply({ ...text("verify_batch requires an 'objects' array"), isError: true });
        return reply(text(args.objects.map((o) => ({ id: o?.id, verified: verifyObject(o) })))); }
      if (name === "holo_build" || name === "holo_run" || name === "holo_share") {
        const app = ctx.app;
        if (!app) return reply({ ...text(`${name} needs an app/forge (ctx.app / window.HoloApp) wired into this tier`), isError: true });
        try {
          if (name === "holo_build") { const b = await app.build(args.source, { lang: args.lang });
            return reply(text({ ok: true, kappa: b.kappa, sourceKappa: b.sourceKappa, receipt: b.receipt, exports: b.exports, imports: b.imports || [], rebind: !!b.hit })); }
          if (name === "holo_share") { if (typeof args.kappa !== "string") return reply({ ...text("holo_share requires a 'kappa'"), isError: true });
            return reply(text(app.share(args.kappa))); }
          const ref = (typeof args.kappa === "string" && args.kappa) || (typeof args.source === "string" && args.source);
          if (!ref) return reply({ ...text("holo_run requires 'kappa' or 'source'"), isError: true });
          const r = await app.run(ref); const out = { ok: true, kappa: r.kappa, selfCompiled: r.selfCompiled, exports: Object.keys(r.exports) };
          if (args.fn) { const fn = r.exports[args.fn]; if (typeof fn !== "function") return reply(text({ ok: false, error: { message: `no export '${args.fn}'` }, exports: out.exports }));
            out.result = fn(...(Array.isArray(args.args) ? args.args.map((n) => n | 0) : [])); }
          return reply(text(out));
        } catch (e) { return reply(text({ ok: false, error: { message: (e && e.message) || String(e), line: e && e.line, col: e && e.col } })); }
      }
      const declared = registry.tools.find((t) => t.name === name);
      if (declared && declared.handler) { const r = await execDeclaredHandler(declared, args, ctx); if (r) return reply(r); }
      if (ctx.toolHandlers && ctx.toolHandlers[name]) return reply(text(await ctx.toolHandlers[name](args)));
      if (declared) return reply({ ...text(`tool '${name}' is a Node-tier built-in or declared without a handler — not available in the serverless core`), isError: true });
      return fail(-32602, "unknown tool: " + name);
    }
    default: return fail(-32601, "method not found: " + req.method);
  }
}

// makeServer({ manifests | appManifest, resolve, toolHandlers, app }) → { registry, handle } — the
// serverless server, ready to drive over ANY transport (postMessage, Service Worker, WebTransport).
export function makeServer({ manifests, appManifest, resolve, toolHandlers, app } = {}) {
  const registry = appManifest ? buildAppRegistry(appManifest) : buildRegistry(manifests || []);
  return { registry, handle: (req) => handle(req, { registry, resolve, toolHandlers, app }) };
}
