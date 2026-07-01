// holo-import-agent.mjs — Holo Import → AGENT-NATIVE (ADR-0093). The moment a GitHub repo imports
// (ADR-0092), auto-WIRE it into the seams every holospace ALREADY exposes — the MCP server
// (holo-mcp.mjs: buildAppRegistry + handle) and the unified REST surface at /~<app>/api
// (holo-api-core.mjs: makeApiServer) — so any AI agent or other holo app can fetch · re-derive (L5) ·
// run · share it with ZERO author effort. We do NOT rebuild those endpoints; we DERIVE the one
// manifest + the one resolver that mount an imported app into them. Pure + isomorphic (deps injected),
// so the browser/Service-Worker path and the Node witness run identical logic.
//
// THE FINDING (why this is small): MCP `resolve_object`/`verify_object` and REST `GET /o/<κ>` both take
// a `resolve(uri) → self-verifying UOR object`. An imported app's source IS already such an object (the
// publishSource envelope verifies under holo-object.verify — proven). So the agent surface is: (1) a
// holospace.json declaring that object as a RESOURCE, fed to buildAppRegistry; (2) a resolve() returning
// it. The universal built-in tools (resolve_object · verify_object · holo_describe · holo_run · holo_share)
// then cover the agent verbs over its κ — nothing per-app to write.
//
// TIERS (honest): BASELINE (every imported app, free) = the resource + the built-in verbs above + a NANDA
// AgentFacts record (ADR-0034) so agents DISCOVER it, not just reach it. DECLARED surface (when the repo
// ships an OpenAPI spec / typed exports / postMessage handlers — STAGED) = those map to app-declared MCP
// tools (`handler:{resolve|kappa}`); detected + named here, NOT faked. EXPOSURE ≠ AUTHORIZATION: the
// manifest EXPOSES a surface; capability stays default-deny behind the conscience (ADR-0033) — auto-
// mounting an untrusted repo grants it nothing. Grounded in Laws L1 (κ identity, not a URL), L3 (O(1)
// re-resolve), L4 (the only network is the governed import ingest), L5 (every resource re-derives; tamper
// refused). Composes Holo Import (0092) · holo-mcp · holo-api · NANDA (0034) · Holo Prov (0082).

import { appEnvelope, jcs } from "./holo-import.mjs";
import { blake3hex } from "./holo-blake3.mjs";   // the ONE canonical κ hash (§1.2 BLAKE3-only mint)

const hexOf = (k) => String(k || "").split(":").pop();
const enc = (s) => new TextEncoder().encode(typeof s === "string" ? s : jcs(s));
// seal any content object → a self-verifying UOR object whose id re-derives (same scheme as
// holo-object.address / publishSource: did:holo:<axis> over jcs(content sans id)). §1.2: the MINT is BLAKE3
// (blake3hex is sync + isomorphic — same in browser + Node witness); the injected `hash` is accepted for
// back-compat but the canonical content address is minted on the ONE axis.
export function sealObject(content, hash) {
  const { id, ...c } = content || {};
  return { ...c, id: "did:holo:blake3:" + blake3hex(enc(jcs(c))) };
}

// a stable, reverse-DNS app id from a repo ref (the holospace.json `id`; buildAppRegistry names the
// per-app MCP server from it, so an agent connecting to ONE app sees a coherent, app-scoped surface).
export function appId(repo) {
  const o = String((repo && repo.owner) || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const r = String((repo && repo.repo) || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return "io.github." + (o || "owner") + "." + (r || "app");
}

// sourceObject(imp) → the imported app AS a self-verifying UOR object (what resolve returns over MCP+REST).
// It IS the publishSource envelope (κ-parity with the studio), stamped with its κ — verifies under
// holo-object.verify (re-derive its id → Law L5). `imp` is the ADR-0092 importRepo result.
export function sourceObject(imp) {
  if (!imp || !imp.app || !imp.html) throw new Error("sourceObject needs a runnable import result {app,html}");
  return { ...appEnvelope(imp.repo.repo, imp.html), id: imp.app.id };
}

// deriveManifest(imp) → the holospace.json that buildAppRegistry(manifest) + makeApiServer mount. BASELINE:
// ── DECLARED-surface detection (ADR-0093, the rung above baseline): if the repo ships a machine-readable
//    interface, project it FAITHFULLY into app-declared MCP tools (names · descriptions · input schemas
//    preserved). HONEST about execution locus — `x-holo-exec` says how a tool would run, and the projection
//    is DISCOVERY, not authorization: a backend op needs GOVERNED EGRESS (holo-gov, default-deny, opt-in,
//    ADR-0090) and an arbitrary JS export needs the conscience-gated SANDBOX (staged) — neither auto-runs.
const sanitizeName = (s) => String(s || "tool").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "tool";

function opInputSchema(op) {
  const props = {}, required = [];
  for (const p of op.parameters || []) {                       // OpenAPI 3 (p.schema) + Swagger 2 (p.type)
    if (!p || !p.name || p.in === "header") continue;
    props[p.name] = p.schema ? { ...p.schema, ...(p.description ? { description: p.description } : {}) } : { type: p.type || "string", ...(p.description ? { description: p.description } : {}) };
    if (p.required) required.push(p.name);
  }
  const content = op.requestBody && op.requestBody.content;
  const media = content && (content["application/json"] || content[Object.keys(content)[0]]);
  if (media && media.schema) { props.body = media.schema; if (op.requestBody.required) required.push("body"); }
  const out = { type: "object", properties: props };
  if (required.length) out.required = required;
  return out;
}

// openapiToTools(spec) → one MCP tool per operation, schemas faithful. The handler is an `egress` marker
// (method · path · server) — execDeclaredHandler doesn't run it (returns null → no fake result), so the
// tool is DISCOVERABLE with a correct schema but calling it needs a governed egress grant (the honest line).
export function openapiToTools(spec) {
  const tools = [];
  if (!spec || typeof spec !== "object") return tools;
  const server = (spec.servers && spec.servers[0] && spec.servers[0].url) || (spec.host ? ("https://" + spec.host + (spec.basePath || "")) : null);
  for (const [path, item] of Object.entries(spec.paths || {})) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = item && item[method]; if (!op || typeof op !== "object") continue;
      tools.push({
        name: sanitizeName(op.operationId || (method + "_" + path)),
        description: String(op.summary || op.description || (method.toUpperCase() + " " + path)).slice(0, 300),
        inputSchema: opInputSchema(op),
        handler: { egress: { method: method.toUpperCase(), path, server } },   // honest: governed egress, not serverless
        "x-holo-exec": "egress",
      });
    }
  }
  return tools;
}

// detectDeclaredSurface(files) → { kind, source, tools, note? } | null. JSON OpenAPI is projected fully;
// YAML OpenAPI is DETECTED but deferred (zero-dep: no YAML parser) — surfaced, not faked. Typed exports
// (package.json types / a .d.ts + the entry's named exports) project DESCRIPTIVE tools (exec = sandbox, staged).
export function detectDeclaredSurface(files) {
  if (!files || typeof files.get !== "function") return null;
  const paths = [...files.keys()];
  const specPath = paths.find((p) => /(^|\/)(openapi|swagger)\.json$/i.test(p));
  if (specPath) {
    const f = files.get(specPath);
    if (f && f.text) { try { const spec = JSON.parse(f.text); const tools = openapiToTools(spec); if (tools.length) return { kind: "openapi", source: specPath, version: spec.openapi || spec.swagger || null, tools }; } catch { /* malformed spec → fall through */ } }
  }
  const yamlPath = paths.find((p) => /(^|\/)(openapi|swagger)\.ya?ml$/i.test(p));
  if (yamlPath) return { kind: "openapi-yaml", source: yamlPath, tools: [], note: "OpenAPI YAML detected — JSON is projected in v1, YAML projection staged (zero-dep, no YAML parser)" };
  // typed exports — a declared interface, but arbitrary JS is NOT serverless-executable (the sandbox is staged)
  const pkgRaw = files.get("package.json"); let pkg = null; if (pkgRaw && pkgRaw.text) { try { pkg = JSON.parse(pkgRaw.text); } catch {} }
  const dts = paths.find((p) => /\.d\.ts$/i.test(p));
  if ((pkg && (pkg.types || pkg.typings)) || dts) {
    const entry = (pkg && (pkg.module || pkg.main)) || null;
    const ef = entry ? (files.get(entry.replace(/^\.?\//, "")) || null) : null;
    const names = ef && ef.text ? exportedNames(ef.text) : [];
    const tools = names.slice(0, 24).map((n) => ({ name: sanitizeName(n), description: "Exported " + n + "() — declared interface (execution via the conscience-gated sandbox, staged)", inputSchema: { type: "object" }, "x-holo-exec": "sandbox" }));
    return { kind: "exports", source: (pkg && (pkg.types || pkg.typings)) || dts || entry, tools, note: tools.length ? null : "typed interface detected; no named exports parsed from the entry" };
  }
  return null;
}
// exportedNames(src) — deterministic, dependency-free: `export function/const/class NAME` + `export { a, b }`.
function exportedNames(src) {
  const out = new Set();
  for (const m of String(src).matchAll(/\bexport\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of String(src).matchAll(/\bexport\s*\{([^}]*)\}/g)) for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop().trim(); if (/^[A-Za-z_$][\w$]*$/.test(n) && n !== "default") out.add(n); }
  return [...out];
}

// declares the app source as a self-verifying RESOURCE (uri = the app κ). BASELINE has no app-specific
// tools (the universal built-ins cover the verbs); the DECLARED tier adds the projected `tools` here.
export function deriveManifest(imp, { declared = null } = {}) {
  if (!imp || !imp.runnable) throw new Error("deriveManifest: only a runnable import has an agent surface");
  const id = appId(imp.repo);
  return {
    id, name: imp.repo.repo,
    "@type": ["schema:SoftwareApplication", "schema:WebApplication"],
    type: ["schema:SoftwareApplication", "schema:WebApplication"],
    summary: "Imported from " + imp.repo.url + (imp.commit ? " @" + imp.commit.slice(0, 10) : ""),
    entry: "index.html",
    "schema:codeRepository": imp.repo.url,
    "schema:version": imp.commit || null,
    resources: [{
      uri: imp.app.id, name: imp.repo.repo + " — source",
      description: "The imported app as a self-verifying UOR object — re-derive its κ to verify it (Law L5).",
      mimeType: "text/html", type: "schema:WebApplication",
    }],
    // BASELINE exposes NO app-specific tools (the universal built-ins are the verbs over the app κ); the
    // DECLARED tier projects the repo's own interface into `tools`. EXPOSURE ≠ AUTHORIZATION either way:
    // a projected tool is discoverable + faithfully-schema'd, but its `x-holo-exec` (egress/sandbox) does
    // NOT auto-run — execution needs a governed grant. The source resource is always present.
    tools: (declared && declared.tools) || [],
    conforms: { specs: ["holo-import", "holo-shell-mcp"] },
    "hosc:buildLocus": imp.classification && imp.classification.path,
    ...(declared ? { "hosc:declaredSurface": { kind: declared.kind, source: declared.source, tools: (declared.tools || []).length, ...(declared.note ? { note: declared.note } : {}) } } : {}),
    ...(imp.externalRefs && imp.externalRefs.length ? { "hosc:unservedExternalRefs": imp.externalRefs.map((r) => r.ref) } : {}),
  };
}

// agentFacts(imp, {hash}) → a NANDA AgentFacts discovery record (ADR-0034), self-verifying. An imported
// app joins the agentic web by EXISTING: other agents/holo apps find it by this record, then reach it over
// the MCP server / the /~<id>/api REST surface. `prov:wasDerivedFrom` ties it to the app κ (honest lineage).
export function agentFacts(imp, { hash, declared = null } = {}) {
  if (typeof hash !== "function") throw new Error("agentFacts needs an injected hash");
  const id = appId(imp.repo);
  const baseVerbs = ["resolve_object", "verify_object", "holo_describe", "holo_run", "holo_share"];
  const declaredNames = (declared && declared.tools || []).map((t) => t.name);
  const record = {
    "@context": ["https://www.w3.org/ns/did/v1",
      { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", nanda: "https://nanda.media.mit.edu/ns#" }],
    "@type": ["nanda:AgentFacts", "schema:SoftwareApplication", "prov:Entity"],
    "schema:name": imp.repo.repo,
    "nanda:agentName": id,
    "nanda:endpoints": { mcp: "holo://" + hexOf(imp.app.id) + "/mcp", rest: "/~" + id + "/api", capabilities: "holo://capabilities" },
    "nanda:capabilities": [...baseVerbs, ...declaredNames],
    ...(declared ? { "nanda:declaredInterface": declared.kind } : {}),
    "schema:codeRepository": imp.repo.url,
    "prov:wasDerivedFrom": imp.app.id,
  };
  return sealObject(record, hash);
}

// deriveAgentSurface(imp, {hash}) → everything a consumer (the witness, the live shell/SW) feeds to the
// existing seams: the manifest (→ buildAppRegistry), a resolve(uri)→object (→ MCP handle ctx + makeApiServer),
// the source object, and the AgentFacts record. ONE resolver serves both MCP and REST (one κ-store, no
// parallel infra). A consumer NEVER has to know how the app was made — only its κ resolves.
export function deriveAgentSurface(imp, { hash, files = null } = {}) {
  const declared = files ? detectDeclaredSurface(files) : null;   // DECLARED tier when the repo files are available
  const manifest = deriveManifest(imp, { declared });
  const src = sourceObject(imp);
  const facts = agentFacts(imp, { hash, declared });
  const byHex = new Map([[hexOf(src.id), src], [hexOf(facts.id), facts]]);
  // resolve(uri) — accepts a did:holo, a holo://κ, or a bare hex; returns the self-verifying object or null.
  const resolve = (uri) => byHex.get(hexOf(String(uri || "").replace(/^holo:\/\//, "").split("/")[0])) || null;
  return { manifest, resolve, sourceObject: src, agentFacts: facts, appId: manifest.id, declared };
}

// makeEgressToolHandlers({ manifest, governedFetch, hash }) → an MCP `toolHandlers` map that makes the
// DECLARED egress tools (ADR-0093, OpenAPI ops) actually CALLABLE — but EXPOSURE ≠ AUTHORIZATION holds: the
// call goes through `governedFetch` (the conscience-gated egress boundary, Law L4/ADR-0090), so it is
// DEFAULT-DENY — refused unless the conscience grants the target host. A granted call fills {path params} +
// query + JSON body from the agent's args, performs the governed request, and seals a re-derivable PROV-O
// `hosc:Egress` receipt (tool · url · response κ); a refused call returns an honest refusal, never a fake.
export function makeEgressToolHandlers({ manifest, governedFetch, hash = null } = {}) {
  const handlers = {};
  for (const t of (manifest && manifest.tools) || []) {
    const eg = t.handler && t.handler.egress; if (!eg) continue;
    handlers[t.name] = async (args = {}) => {
      if (typeof governedFetch !== "function") return { ok: false, refused: true, reason: "no egress authority — exposure ≠ authorization (grant required)", tool: t.name };
      const pathParams = (String(eg.path || "").match(/\{(\w+)\}/g) || []).map((s) => s.slice(1, -1));
      const filled = String(eg.path || "").replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(args[k] != null ? args[k] : ""));
      const query = Object.entries(args).filter(([k]) => k !== "body" && !pathParams.includes(k)).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
      const base = String(eg.server || "").replace(/\/+$/, "");
      const url = base + (filled.startsWith("/") ? filled : "/" + filled) + (query.length ? "?" + query.join("&") : "");
      const method = String(eg.method || "GET").toUpperCase();
      const hasBody = ["POST", "PUT", "PATCH"].includes(method) && args.body != null;
      const init = { method, ...(hasBody ? { headers: { "content-type": "application/json" }, body: JSON.stringify(args.body) } : {}) };
      let r; try { r = await governedFetch(url, { purpose: "egress:" + t.name, init, body: hasBody ? args.body : null }); }
      catch (e) { return { ok: false, error: "egress failed: " + ((e && e.message) || e), tool: t.name, url }; }   // unreachable backend → honest error, not a crash
      if (!r.ok) return { ok: false, refused: true, reason: r.reason || "refused by the conscience (default-deny)", tool: t.name, url };
      let body = null; try { body = r.response && typeof r.response.text === "function" ? await r.response.text() : (r.response && r.response.body) || null; } catch (e) {}
      const receipt = { "@context": { prov: "http://www.w3.org/ns/prov#", hosc: "https://hologram.os/ns/conformance#" },
        "@type": ["prov:Activity", "hosc:Egress"], "hosc:tool": t.name, "prov:used": url, "hosc:method": method,
        ...(body != null ? { "prov:generated": "did:holo:blake3:" + blake3hex(enc(body)) } : {}), "hosc:ingestReceipt": r.receipt || null };   // §1.2: content address of the response body on the ONE (BLAKE3) axis
      return { ok: true, status: r.response && r.response.status, tool: t.name, body, receipt };
    };
  }
  return handlers;
}

// createLiveRegistry({ makeServer, makeApiServer, hash, governedFetch }) → an IN-PAGE, serverless agent fabric for
// IMPORTED apps. An imported app exists only as an in-memory κ (no apps/<id>/holospace.json on disk), so
// the disk-manifest server tier (holo-serve-fhs) can't see it — but the node-free in-page tier can: feed
// the DERIVED manifest + a κ-store-backed resolve to `makeServer` (holo-mcp-core, the browser MCP engine)
// and `makeApiServer` (holo-api-core, isomorphic REST). The shell injects those two factories + the browser
// hash and calls register() right after an import — so the app answers MCP + /~<id>/api with NO reload and
// NO server (Law L1/L4). PURE: the factories are injected, so this same registry is witnessed in Node.
export function createLiveRegistry({ makeServer, makeApiServer, hash, governedFetch = null } = {}) {
  if (typeof makeServer !== "function" || typeof makeApiServer !== "function") throw new Error("createLiveRegistry needs makeServer + makeApiServer injected");
  const apps = new Map();                               // appId → { manifest, source, facts, appKappa }
  const store = new Map();                              // hex → self-verifying object (the resolver's κ-store)
  const resolve = (uri) => store.get(hexOf(String(uri || "").replace(/^holo:\/\//, "").split("/")[0])) || null;
  function register(imp, files = null) {                 // pass the repo files to project the DECLARED surface
    const surf = deriveAgentSurface(imp, { hash, files });
    store.set(hexOf(surf.sourceObject.id), surf.sourceObject);
    store.set(hexOf(surf.agentFacts.id), surf.agentFacts);
    apps.set(surf.appId, { manifest: surf.manifest, source: surf.sourceObject, facts: surf.agentFacts, appKappa: surf.sourceObject.id });
    return surf;
  }
  // mount(appId) → a live { mcp, api } pair for ONE imported app, sharing the ONE κ-store resolver.
  function mount(appId) {
    const a = apps.get(appId); if (!a) return null;
    // egress executors for the declared tools — conscience-gated (default-deny) when a governedFetch is wired
    const toolHandlers = governedFetch ? makeEgressToolHandlers({ manifest: a.manifest, governedFetch, hash }) : undefined;
    const mcp = makeServer({ appManifest: a.manifest, resolve, toolHandlers });
    const api = makeApiServer({ appId, registry: mcp.registry, resolve });
    return { mcp, api, manifest: a.manifest, appKappa: a.appKappa, agentFacts: a.facts };
  }
  return { register, mount, resolve, store, apps, has: (id) => apps.has(id), list: () => [...apps.keys()] };
}

// ── THE SERVERLESS TRANSPORT BRIDGE (close the last mile): the Service Worker (`holo-fhs-sw.js`) ALREADY
//    serves /~<id>/mcp + /~<id>/api for any app whose holospace.json + κ it can find — it just reads them
//    from origin, so an imported (in-memory) app 404s. We don't add a transport; we make the import
//    FINDABLE: the page writes these entries into ONE cache the SW checks first, so an EXTERNAL HTTP agent
//    reaches the imported app over standard MCP/REST with no reload and no origin server (Law L1/L4). The
//    SW + the page agree on this cache name + these exact keys. PURE: returns the {url,body} list to cache.
export const SW_IMPORTS_CACHE = "holo-imports-v1";
export function swCacheEntries(surf, { base = "/" } = {}) {
  const b = base.endsWith("/") ? base : base + "/";
  const J = "application/ld+json";
  return [
    { url: b + "apps/" + surf.appId + "/holospace.json", contentType: J, body: JSON.stringify(surf.manifest) },         // mcpManifest(id) reads this
    { url: b + ".holo-import/o/" + hexOf(surf.sourceObject.id), contentType: J, body: JSON.stringify(surf.sourceObject) }, // resolve(appκ) reads this
    { url: b + ".holo-import/o/" + hexOf(surf.agentFacts.id), contentType: J, body: JSON.stringify(surf.agentFacts) },
  ];
}

export function describeAgent() {
  return {
    is: "an imported GitHub app, auto-wired into the MCP + /~<app>/api REST seams every holospace already exposes — fetch · re-derive (L5) · run · share, by agents, with zero author effort",
    baseline: "a holospace.json declaring the app source as a self-verifying RESOURCE + the universal built-in verbs + a NANDA AgentFacts record (discoverable)",
    declared: "OpenAPI JSON / typed exports → app-declared MCP tools, faithfully schema'd (LANDED); execution is honestly marked (`x-holo-exec`: egress needs a governed grant, sandbox is staged) — discovery, not authorization; OpenAPI YAML + postMessage staged",
    honest: "EXPOSURE ≠ AUTHORIZATION — the manifest exposes a surface; capability is default-deny behind the conscience (ADR-0033); an arbitrary app's DOM/internal functions are NOT auto a clean tool API",
  };
}

export default { sealObject, appId, sourceObject, deriveManifest, agentFacts, deriveAgentSurface, detectDeclaredSurface, openapiToTools, makeEgressToolHandlers, createLiveRegistry, swCacheEntries, SW_IMPORTS_CACHE, describeAgent };
