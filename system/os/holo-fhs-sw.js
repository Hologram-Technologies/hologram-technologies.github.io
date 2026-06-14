// holo-fhs-sw.js — the CONTENT-ADDRESSED delivery worker. It makes the OS boot on any dumb
// static host (GitHub Pages) with no server cooperation, AND it makes every booted byte native
// to the UOR substrate: nothing is trusted by location — every response is RE-DERIVED to its κ
// and refused on mismatch (Law L5). The origin is thereby demoted from authority to one untrusted
// CDN: tamper with it, or swap a byte in transit, and the boot fails closed.
//
//   1 · Names → bytes. A request's path is a NAME; its identity is its κ in the OS closure
//       (etc/os-closure.json). The flat URL space maps onto the FHS tree via the ONE shared rule
//       (lib/holo-fhs-map.mjs), shared with the dev server — dev and prod resolve identically (L2).
//   2 · Verify by re-derivation (L5). Fetch the bytes, hash them, compare to the pinned κ
//       (the κ-route hex, or the closure κ for the path). Mismatch ⇒ refuse (409). Unpinned ⇒ pass.
//   3 · κ-route. /.holo/sha256/<hex> resolves a byte-set by content directly.
//   4 · Cross-origin isolation. Stamp COOP/COEP/CORP so crossOriginIsolated works without headers.

import { fhsMap } from "./lib/holo-fhs-map.mjs";
import { blake3hex } from "./usr/lib/holo/holo-blake3.mjs";   // pure-JS BLAKE3 ≡ the substrate's kappo() (crypto.subtle has no BLAKE3)
import { makeServer as makeMcpServer, descriptor as mcpDescriptor, buildAppRegistry as buildMcpAppRegistry } from "./usr/lib/holo/mcp/holo-mcp-core.mjs";   // the node-free MCP engine → the SW IS a serverless MCP endpoint
import { handleApi as handleHoloApi, collectNdjson as apiNdjson, collectSse as apiSse } from "./usr/lib/holo/api/holo-api-core.mjs";   // the node-free REST engine → the SW IS a serverless κ-stream API
import { resolveByKappa } from "./sbin/holo-resolver.mjs";    // the κ-verified multi-source resolver (Law L5) — accept the FIRST copy that re-derives
import { ipfsPeer, bridgePeer } from "./sbin/holo-peers.mjs"; // recovery transports: IPFS Trustless Gateways · WebRTC mesh (page bridge)
import * as holoIpfs from "./usr/lib/holo/holo-ipfs.js";      // a sha-256 κ IS a CIDv1 sha2-256 — IPFS adopted, not bridged (import-safe: no network, no top-level effects)

const BASE = new URL(self.registration.scope).pathname;       // "/" at a root/user site, "/<repo>/" under a project site
const COI = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "cross-origin",
};
const KCACHE = "holo-kappa-v1";   // content-addressed response cache: key = κ-route URL, so identical bytes are stored ONCE and shared across every app (dedup), and a re-open is network-free. Only VERIFIED bytes are ever cached.
const kKey = (axis, hex) => `${BASE}.holo/${axis}/${hex}`;

// ── SELF-HEAL (ADR-0067): turn the dead-end refusal into RECOVERY. A content address is a perfect
// lie-detector but not a healer — so when the origin serves a WRONG byte (κ mismatch), 404s, or is
// unreachable, re-fetch the SAME κ from a NON-origin source — IPFS (a sha-256 κ IS a CIDv1 sha2-256)
// or a WebRTC-mesh peer — and accept it ONLY after it RE-DERIVES (Law L5). A wrong byte from any source
// is refused; nothing is laundered; only a copy that hashes to the SAME κ is ever served. Best-effort +
// TIME-BOXED: heal() never blocks longer than HEAL_MS before falling through to the original
// refuse/passthrough, so the boot happy-path is byte-identical and cannot regress. The sealed ANCHOR is
// out of scope here by construction — these are os-closure/app-lock κ, never the constitution's own bytes.
const HEAL_MS = 6000;
const MIME = { html: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json", jsonld: "application/ld+json", svg: "image/svg+xml", png: "image/png", webp: "image/webp", wasm: "application/wasm", woff2: "font/woff2", map: "application/json", txt: "text/plain", wav: "audio/wav" };
const mimeOf = (rel) => MIME[String(rel).split(".").pop().toLowerCase()] || "application/octet-stream";

// ── SUBPATH REWRITE (the "served at /<repo>/" follow-up). The OS image's flat URL space is rooted at
// the ORIGIN ("/_shared/…", "/usr/…", a module `import "/sbin/…"`, a runtime `fetch("/.holo/…")`). At a ROOT
// site BASE is "/" and those already resolve; under a PROJECT site BASE is "/<repo>/os/" and an origin-absolute
// reference escapes the SW scope and 404s. Fix it WHERE the bytes are served, deployment-agnostic: re-root
// every flat reference at BASE as the HTML leaves the worker. THREE mechanisms cover the three kinds of ref:
//   · an import map re-roots ES-module specifiers (static + dynamic import) — the only thing that can.
//   · an attribute rewrite re-roots origin-absolute src/href present in the static HTML.
//   · a tiny inline shim re-roots the RUNTIME boundaries the first two can't reach — fetch()/XHR/Worker URLs
//     and src/href on nodes inserted at runtime (innerHTML icons, thumbnails) — onto BASE.
// Applied to a COPY *after* κ re-derivation, so Law L5 still guards the canonical bytes (the pins are on the
// un-rewritten file). No-op at a root deploy (BASE === "/"), so dev + user-site boots are byte-unchanged.
const HTMLISH = (rel) => rel === "" || rel.endsWith("/") || /\.html?$/i.test(rel);
const SUBPATH_PREFIXES = ["_shared", "sbin", "usr", "lib", "lib64", "pkg", "apps", "etc", "var", "opt", "srv", "boot", "bin", "home", "root", "mnt", "media", ".well-known", ".holo"];
const TOPLEVEL_MODULES = ["holo-resolver.mjs", "holo-sources.mjs", "holo-peers.mjs", "holo-uor.mjs", "holo-object.mjs", "holo-wire.mjs", "holo-sw.js", "holo-launch.mjs", "holo-omni.mjs", "holo-boot-sw-register.mjs", "holo-heal-boot.mjs", "browser-sw.js"];   // OS modules imported as a bare-root specifier "/holo-*.mjs" (fhsMap routes them to sbin/ or lib/)
const FLAT_SRC = "^/(?:" + SUBPATH_PREFIXES.map((p) => p.replace(/[.]/g, "\\.")).join("|") + ")(?:/|$)";   // matches an origin-absolute OS-flat path "/usr/…", "/.holo/…" — NOT a BASE-rooted one
const reroot = (v) => (typeof v === "string" && /^\/(?!\/)/.test(v)) ? BASE + v.slice(1) : v;   // origin-absolute "/x" → "BASE x"; leaves //, https://, bare, relative alone
const rerootMap = (obj) => { const o = {}; for (const [k, v] of Object.entries(obj || {})) o[reroot(k)] = (v && typeof v === "object") ? rerootMap(v) : reroot(v); return o; };
// subpathBoot() — the inline runtime shim, as a classic <script> that runs before any module. It wraps
// fetch/XHR/Worker and watches the DOM, re-rooting only origin-absolute OS-flat paths (FLAT_SRC) onto BASE;
// everything else (relative, BASE-rooted, cross-origin) passes untouched. Self-contained, no deps.
function subpathBoot() {
  return "<script>(function(){try{"
    + "var B=" + JSON.stringify(BASE) + ";if(B===\"/\")return;self.__HOLO_BASE__=B;"
    + "var F=new RegExp(" + JSON.stringify(FLAT_SRC) + ");"
    + "function rr(u){try{var x=new URL(u,document.baseURI);if(x.origin===location.origin&&F.test(x.pathname)){x.pathname=B+x.pathname.slice(1);return x.href;}}catch(e){}return u;}"
    + "var of=self.fetch;if(of)self.fetch=function(i,n){try{i=(i&&i.url)?new Request(rr(i.url),i):rr(i);}catch(e){}return of.call(this,i,n);};"
    + "try{var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{arguments[1]=rr(u);}catch(e){}return xo.apply(this,arguments);};}catch(e){}"
    + "try{var W=self.Worker;if(W){self.Worker=function(u,o){return new W(rr(u),o);};self.Worker.prototype=W.prototype;}}catch(e){}"
    + "function fx(el){if(el&&el.getAttribute)[\"src\",\"href\"].forEach(function(a){var v=el.getAttribute(a);if(v&&F.test(v))el.setAttribute(a,B+v.slice(1));});}"
    + "function sc(n){if(n.nodeType===1){fx(n);if(n.querySelectorAll)[].forEach.call(n.querySelectorAll(\"[src],[href]\"),fx);}}"
    + "try{new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var a=ms[i].addedNodes;for(var j=0;j<a.length;j++)sc(a[j]);}}).observe(document.documentElement||document,{childList:true,subtree:true});}catch(e){}"
    + "}catch(e){}})();</script>";
}
function subpathHtml(text) {
  if (BASE === "/") return text;                                  // root/user site: flat refs already resolve
  const prefixImports = {}; for (const p of SUBPATH_PREFIXES) prefixImports["/" + p + "/"] = BASE + p + "/";
  for (const n of TOPLEVEL_MODULES) prefixImports["/" + n] = BASE + n;   // bare-root module files (e.g. import "/holo-resolver.mjs")
  // Merge into the page's OWN import map if it has one (a SECOND map is a hard error), re-rooting its
  // existing absolute targets/scopes too; else inject a fresh map. Either way the prefix entries re-root
  // every flat ES-module specifier the OS code imports.
  let out = text, mapped = false;
  out = out.replace(/<script\s+type=(["'])importmap\1\s*>([\s\S]*?)<\/script>/i, (_m, _q, body) => {
    mapped = true;
    let map; try { map = JSON.parse(body); } catch { map = {}; }
    const merged = { imports: { ...prefixImports, ...rerootMap(map.imports) } };   // page entries win on key conflict
    if (map.scopes) merged.scopes = rerootMap(map.scopes);
    return `<script type="importmap">${JSON.stringify(merged)}</script>`;
  });
  // Inject the runtime shim FIRST (classic, before any module), then a fresh import map if the page had none.
  const inject = subpathBoot() + (mapped ? "" : `<script type="importmap">${JSON.stringify({ imports: prefixImports })}</script>`);
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => m + inject) : inject + out;
  out = out.replace(/(\s(?:src|href))="\/(?!\/)/g, (_m, attr) => attr + '="' + BASE);   // origin-absolute src/href attrs → BASE-rooted (skips // protocol-relative)
  return out;
}
// finalize(buf, resp, rel, extra) — the ONE response builder for served bytes: re-roots HTML for the subpath,
// passes everything else straight through. When it rewrites, it drops content-length (the body grew) and
// content-encoding (the bytes are now identity) so the browser does not truncate or mis-decode the response.
function finalize(buf, resp, rel, extra = {}) {
  if (BASE !== "/" && HTMLISH(rel)) {
    try {
      const body = new TextEncoder().encode(subpathHtml(new TextDecoder().decode(buf)));
      const h = new Headers(resp.headers);
      for (const [k, v] of Object.entries({ ...COI, ...extra })) h.set(k, v);
      h.delete("content-length"); h.delete("content-encoding");
      return new Response(body, { status: resp.status, statusText: resp.statusText, headers: h });
    } catch { /* fall through to raw */ }
  }
  return withHeaders(buf, resp, extra);
}
// askClient(κ) — the SW↔page bridge: a mesh peer's state lives in the page (holo-boot-sw-register.serveMeshToSw).
// Absent in default mode (no client answers) → 3 s timeout → null → falls through. The resolver re-derives the reply.
async function askClient(kappa) {
  try {
    for (const client of await self.clients.matchAll({ includeUncontrolled: true, type: "window" })) {
      const bytes = await new Promise((res) => {
        const ch = new MessageChannel(); const to = setTimeout(() => res(null), 3000);
        ch.port1.onmessage = (ev) => { clearTimeout(to); const b = ev.data && ev.data.bytes; res(b ? new Uint8Array(b) : null); };
        client.postMessage({ holoPeerRequest: kappa }, [ch.port2]);
      });
      if (bytes) return bytes;
    }
  } catch { /* no client / closed port → null */ }
  return null;
}
let RECOVERY = null;   // the ordered NON-origin recovery chain, built once (IPFS, then the mesh bridge)
const recovery = () => RECOVERY || (RECOVERY = [(() => { try { return ipfsPeer({ ipfs: holoIpfs }); } catch { return null; } })(), bridgePeer("mesh", askClient)].filter(Boolean));
// heal(rel, hex, axis, resp) → Response | null — κ-verified bytes recovered from a non-origin source, time-boxed.
async function heal(rel, hex, axis, resp) {
  if (axis !== "sha256" || !/^[0-9a-f]{64}$/.test(hex)) return null;   // IPFS/mesh κ are sha2-256 (the open-web axis)
  let bytes = null;
  try { bytes = await Promise.race([resolveByKappa("did:holo:sha256:" + hex, recovery(), new Map()), new Promise((r) => setTimeout(() => r(null), HEAL_MS))]); }
  catch { bytes = null; }                                              // resolveByKappa throws when no source served a κ-verified copy
  if (!bytes) return null;
  const ct = (resp && resp.headers.get("content-type")) || mimeOf(rel);
  const h = new Headers(); for (const [k, v] of Object.entries(COI)) h.set(k, v);
  h.set("content-type", ct); h.set("x-holo-cache", "heal"); h.set("x-holo-source", "mesh");
  try { (await caches.open(KCACHE)).put(kKey(axis, hex), new Response(bytes.slice(0), { headers: h })); } catch {}   // seed the verified copy → tier-0 serves it network-free next time
  return new Response(bytes, { status: 200, headers: h });
}

let BYHEX = null;     // sha256 hex → os-relative path (the OS serving κ-route)
let BYBLAKE = null;   // blake3 hex → os-relative path (the unified-substrate σ-axis route)
let BYPATH = null;    // os-relative path → sha256 hex (the verification pins)
const APPLOCK = new Set();   // app-ids whose lock closure has been folded into the pins (lazy, L5 for app bytes)
function foldClosure(closure) {
  for (const [p, v] of Object.entries(closure || {})) {
    const k = typeof v === "string" ? v : (v.kappa || v.did || v["@id"] || "");
    const hex = String(k).split(":").pop().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(hex)) { BYHEX.set(hex, p); if (!BYPATH.has(p)) BYPATH.set(p, hex); }
    if (v && typeof v === "object") for (const aka of (v.alsoKnownAs || [])) { const b = /^did:holo:blake3:([0-9a-f]{64})$/.exec(String(aka)); if (b) BYBLAKE.set(b[1].toLowerCase(), p); }
  }
}
async function loadClosure() {
  if (BYPATH) return;
  BYHEX = new Map(); BYBLAKE = new Map(); BYPATH = new Map();
  try { foldClosure((await (await fetch(BASE + "etc/os-closure.json", { cache: "no-store" })).json()).closure); }
  catch { /* no closure → serve unverified (flat mapping still works) */ }
}
// Lazily fold an app's OWN lock closure into the pins, so app bytes are VERIFIED too (not just OS bytes) —
// the app's holospace.lock.json keys are already serve-rel paths (apps/<id>/* and the _shared/* runtime).
async function ensureAppLock(rel) {
  const id = (rel.match(/^apps\/([^/]+)\//) || [])[1];
  if (!id || APPLOCK.has(id)) return;
  APPLOCK.add(id);   // mark first → a missing/!ok lock just leaves those bytes unpinned (still served), never retried in a loop
  try { const r = await fetch(`${BASE}apps/${id}/holospace.lock.json`, { cache: "no-store" }); if (r.ok) foldClosure((await r.json()).closure); }
  catch { /* unpinned → serve unverified, as before */ }
}
const sha256hex = async (buf) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  await self.clients.claim(); await loadClosure();
  for (const n of await caches.keys()) if (n.startsWith("holo-kappa-") && n !== KCACHE) await caches.delete(n);   // drop stale cache versions
})()));

const withHeaders = (body, resp, extra = {}) => { const h = new Headers(resp.headers); for (const [k, v] of Object.entries({ ...COI, ...extra })) h.set(k, v); return new Response(body, { status: resp.status, statusText: resp.statusText, headers: h }); };
const refuse = (rel, want, got, axis = "sha256") => new Response(`holo-fhs-sw: κ MISMATCH — refused (Law L5)\n  name: ${rel}\n  want: ${axis}:${want}\n  got:  ${axis}:${got}\nThe origin is untrusted; tampered bytes do not boot.`, { status: 409, headers: { ...COI, "content-type": "text/plain" } });

// ── SERVERLESS MCP — the SW answers the Model Context Protocol with NO origin server (Law L1/L4).
// Discovery (GET .well-known/mcp.json + /~<app>/.well-known/mcp.json) and JSON-RPC (POST /mcp +
// /~<app>/mcp) are generated client-side by the node-free engine over an app manifest read from the
// content cache. The standardized core (holo_describe + verify/resolve) and declared resolve handlers
// work here; build·run·share belong to the in-page tier (window.HoloApp), so they report honestly.
const MCP_APP = /^~([a-z0-9._-]{1,40})\/(mcp|\.well-known\/mcp\.json)$/i;
const isMcpRoute = (rel) => rel === "mcp" || rel === ".well-known/mcp.json" || MCP_APP.test(rel);
const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...COI, "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" } });
async function mcpManifest(id) {   // read the app's manifest from cache/origin → the per-app surface
  try { const r = await fetch(`${BASE}apps/${id}/holospace.json`, { cache: "no-store" }); if (r.ok) return { ...(await r.json()), id }; } catch {}
  return null;
}
// a best-effort resolver over served UOR objects (resolve_object / declared resolve-handlers)
const mcpResolve = async (uri) => { try { const r = await fetch(BASE + String(uri).replace(/^\/+/, ""), { cache: "no-store" }); if (r.ok) return await r.json(); } catch {} return null; };
async function mcpRespond(req, rel) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...COI, "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,accept" } });
  const appId = (rel.match(MCP_APP) || [])[1];
  const appManifest = appId ? await mcpManifest(appId) : null;
  if (appId && !appManifest) return jsonRes({ error: "no such holospace: " + appId }, 404);
  const wellKnown = rel.endsWith(".well-known/mcp.json");
  const server = makeMcpServer({ appManifest, resolve: mcpResolve });
  if (wellKnown || req.method === "GET") {   // discovery
    const doc = { ...mcpDescriptor(server.registry), transport: "streamable-http", endpoint: appId ? `/~${appId}/mcp` : "/mcp",
      note: "Serverless MCP — answered by the Hologram Service Worker (no origin server); resources are self-verifying UOR objects (Law L5)." };
    return jsonRes(doc);
  }
  let body; try { body = await req.json(); } catch { return jsonRes({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400); }
  try { return jsonRes(await server.handle(body)); }
  catch (e) { return jsonRes({ jsonrpc: "2.0", id: body && body.id || null, error: { code: -32603, message: (e && e.message) || String(e) } }, 500); }
}

// ── SERVERLESS REST — the SW also answers the unified κ-stream API (/~<app>/api/*) client-side, so a
// statically-hosted holospace can EGRESS/INGRESS κ-addressed object streams with no origin server. The
// egress read path + 402 gating + descriptor work fully; ingress uses an ephemeral SW store (the durable
// κ-store is the in-page tier). Pay-per-κ-stream over HTTP 402 — serverless monetisation.
const MCP_API = /^~([a-z0-9._-]{1,40})\/api(?:\/(.*))?$/i;
const _swApiStore = new Map();   // appId → Map(κ → object) (ephemeral; durable store is in-page OPFS)
async function apiRespond(req, rel) {
  const mm = rel.match(MCP_API); const id = mm[1]; const sub = mm[2] || "";
  const manifest = await mcpManifest(id);
  if (!manifest) return jsonRes({ error: "no such holospace: " + id }, 404);
  const registry = buildMcpAppRegistry(manifest);
  let store = _swApiStore.get(id); if (!store) { store = new Map(); _swApiStore.set(id, store); }
  const resolve = async (k) => store.get(k) || await mcpResolve(k);
  const headers = {}; req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  let body = null; if (req.method === "POST") { const t = await req.text(); body = (headers["content-type"] || "").includes("json") ? (() => { try { return JSON.parse(t); } catch { return t; } })() : t; }
  const ctx = { appId: id, registry, resolve, store, price: manifest.apiPrice || null, now: Date.now() };
  const out = await handleHoloApi({ method: req.method, path: "/" + sub.replace(/^\/+/, ""), query: Object.fromEntries(new URL(req.url).searchParams), headers, body }, ctx);
  if (out.iterator) { const sse = (headers.accept || "").includes("text/event-stream");
    return new Response(sse ? await apiSse(out.iterator) : await apiNdjson(out.iterator), { status: out.status, headers: { ...COI, "access-control-allow-origin": "*", "cache-control": "no-store", "content-type": sse ? "text/event-stream" : "application/x-ndjson" } }); }
  return new Response(out.body || "", { status: out.status, headers: { ...COI, "access-control-allow-origin": "*", "cache-control": "no-store", ...(out.headers || {}) } });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // only our origin (cross-origin untouched)
  if (!url.pathname.startsWith(BASE)) return;                 // out of scope
  const relMcp = decodeURIComponent(url.pathname.slice(BASE.length)).replace(/^\/+/, "");
  if (MCP_API.test(relMcp)) { event.respondWith(apiRespond(req, relMcp)); return; }   // serverless REST κ-stream API
  if (isMcpRoute(relMcp)) { event.respondWith(mcpRespond(req, relMcp)); return; }   // serverless MCP endpoint
  if (req.method !== "GET") return;

  event.respondWith((async () => {
    await loadClosure();
    let rel = decodeURIComponent(url.pathname.slice(BASE.length)).replace(/^\/+/, "");
    if (rel === "" || rel.endsWith("/")) rel += "index.html";

    // κ-route: /.holo/<axis>/<hex> → the pin IS the hex; resolve its name, fetch, re-derive on that axis.
    let expect = null, axis = "sha256";
    const m = rel.match(/^\.holo\/sha256\/([a-f0-9]{64})(?:\.\w+)?$/i);
    const mb = rel.match(/^\.holo\/blake3\/([a-f0-9]{64})(?:\.\w+)?$/i);   // the unified-substrate σ-axis
    if (m) {
      expect = m[1].toLowerCase();
      const named = BYHEX.get(expect);
      if (!named) return new Response("κ not in closure index", { status: 404, headers: COI });
      rel = named;
    } else if (mb) {
      axis = "blake3"; expect = mb[1].toLowerCase();
      const named = BYBLAKE.get(expect);
      if (!named) return new Response("blake3 κ not in substrate index", { status: 404, headers: COI });
      rel = named;
    } else {
      await ensureAppLock(rel);                               // app bytes are verified too (lazy lock fold) — not just OS bytes
      expect = BYPATH.get(rel) || null;                       // the pinned (sha256) κ for this path, if any
    }

    // tier 0 · the content cache: if this name has a known κ and that κ's VERIFIED bytes are already
    // resident, serve them network-free (no origin fetch, no re-hash — they were verified at store time).
    if (expect) {
      const cache = await caches.open(KCACHE);
      const hit = await cache.match(kKey(axis, expect));
      if (hit) return finalize(await hit.arrayBuffer(), hit, rel, { "x-holo-cache": "hit" });
    }

    const phys = fhsMap(rel) || rel;                          // mapped FHS path, else the path as-is
    let resp;
    try { resp = await fetch(BASE + phys, { cache: "no-store" }); }   // SW-initiated → does not re-enter this handler
    catch (e) {                                               // origin unreachable (offline / denied) → SELF-HEAL from a non-origin source before giving up
      const healed = expect ? await heal(rel, expect, axis, null) : null;
      return healed || new Response("holo-fhs-sw: fetch failed for " + phys, { status: 502, headers: COI });
    }
    if (resp.status !== 200 && phys !== rel) {                // fallback: a host that serves the FLAT name (e.g. the dev server streams apps live at apps/<id>/* rather than the vendored FHS path). κ re-derivation below still guards it.
      try { const alt = await fetch(BASE + rel, { cache: "no-store" }); if (alt.status === 200) resp = alt; } catch {}
    }
    if (resp.status !== 200) {                                // origin has no copy → SELF-HEAL the pinned κ from a non-origin source before passing the error through
      const healed = expect ? await heal(rel, expect, axis, resp) : null;
      return healed || withHeaders(resp.body, resp);
    }

    // Law L5: re-derive the bytes against the pinned κ ON ITS AXIS; refuse a mismatch. Unpinned files pass.
    if (expect) {
      const buf = await resp.arrayBuffer();
      const got = axis === "blake3" ? blake3hex(new Uint8Array(buf)) : await sha256hex(buf);
      if (got !== expect) {                                   // tampered/wrong origin byte → SELF-HEAL: recover the SAME κ from a non-origin source, re-derived; only refuse if no source can
        const healed = await heal(rel, expect, axis, resp);
        return healed || refuse(rel, expect, got, axis);
      }
      const out = finalize(buf, resp, rel, { "x-holo-cache": "miss" });
      try { (await caches.open(KCACHE)).put(kKey(axis, expect), withHeaders(buf.slice(0), resp)); } catch {}   // cache the VERIFIED (un-rewritten) bytes by κ — deduped, network-free next time
      return out;
    }
    if (BASE !== "/" && HTMLISH(rel)) return finalize(await resp.arrayBuffer(), resp, rel);   // unpinned HTML still needs the subpath re-root
    return withHeaders(resp.body, resp);
  })());
});
