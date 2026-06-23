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

import { fhsMap, devFreshAllowed } from "./lib/holo-fhs-map.mjs";
import { blake3hex } from "./usr/lib/holo/holo-blake3.mjs";   // pure-JS BLAKE3 ≡ the substrate's kappo() (crypto.subtle has no BLAKE3)
import { makeArchiveStore } from "./usr/lib/holo/holo-onnx-kstore.mjs";   // ADR-0101 Seam A: serve a content-addressed .holo model by its blake3 κ from the κ-store (IndexedDB), re-derived (L5)
import { makeServer as makeMcpServer, descriptor as mcpDescriptor, buildAppRegistry as buildMcpAppRegistry } from "./usr/lib/holo/mcp/holo-mcp-core.mjs";   // the node-free MCP engine → the SW IS a serverless MCP endpoint
import { handleApi as handleHoloApi, collectNdjson as apiNdjson, collectSse as apiSse } from "./usr/lib/holo/api/holo-api-core.mjs";   // the node-free REST engine → the SW IS a serverless κ-stream API
import { resolveByKappa } from "./sbin/holo-resolver.mjs";    // the κ-verified multi-source resolver (Law L5) — accept the FIRST copy that re-derives
import { ipfsPeer, bridgePeer } from "./sbin/holo-peers.mjs"; // recovery transports: IPFS Trustless Gateways · WebRTC mesh (page bridge)
import * as holoIpfs from "./usr/lib/holo/holo-ipfs.js";      // a sha-256 κ IS a CIDv1 sha2-256 — IPFS adopted, not bridged (import-safe: no network, no top-level effects)
import { parseIpfsPath, makeGetBlock, resolveIpfsPath, directoryListingHtml, ipfsErrorHtml, injectNavReporter } from "./sbin/holo-ipfs-gateway.mjs";   // the VERIFIED /ipfs/<cid>/<path> path gateway — browse the object graph natively, every block re-derived (L5)
import { OpfsKappaStore } from "./usr/lib/holo/holo-opfs-kappastore.mjs";   // -04- durable κ-store (OPFS): a persistence tier BEHIND KCACHE that survives Cache-Storage eviction (Law L3)

const BASE = new URL(self.registration.scope).pathname;       // "/" at a root/user site, "/<repo>/" under a project site
// DEV-FRESH — live source is edited on disk, so the closure's κ pins are intentionally stale. In dev
// we serve PATH requests FRESH (no by-κ cache, no L5 refusal) so edits show without a reload; κ-route
// requests stay content-addressed/cached (immutable by definition). Prod keeps full L1/L5.
//
// L5 (audit M1): dev-fresh is an EXPLICIT opt-in, NEVER hostname alone. The sealed source ships
// ALLOW_DEV_FRESH=false, so a production deploy keeps full re-derive+refuse even when served from a
// localhost origin (a packaged app, a local proxy, a prod build run locally). Only the dev server
// (tools/holo-serve-fhs.mjs) flips this true when it serves the SW — a deliberate dev action.
const ALLOW_DEV_FRESH = false;
const DEV = devFreshAllowed(ALLOW_DEV_FRESH, self.location.hostname);
const COI = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "cross-origin",
  // Clickjacking floor on EVERY κ-served byte. A substrate page may be framed SAME-ORIGIN (shell →
  // holospace iframes) but never by a foreign site. frame-ancestors is header-only (ignored in <meta>),
  // so it is stamped here, where every response passes; X-Frame-Options is the legacy belt for older
  // engines. Law L5 proves WHAT the bytes are — this governs WHO may frame the proven bytes.
  "Content-Security-Policy": "frame-ancestors 'self'",
  "X-Frame-Options": "SAMEORIGIN",
};
const KCACHE = "holo-kappa-v2";   // content-addressed response cache: key = κ-route URL, so identical bytes are stored ONCE and shared across every app (dedup), and a re-open is network-free. Only VERIFIED bytes are ever cached. (bumped v1→v2 to force a SW re-activate so the fresh closure — new wallet κ — is served.)
const IMPORTS = "holo-imports-v1";   // IMPORTED-app surfaces (ADR-0093): the page caches an imported app's holospace.json + its self-verifying κ-objects here, so /~<id>/mcp + /~<id>/api answer for an in-memory import with NO origin server. Must match holo-import-agent.SW_IMPORTS_CACHE + swCacheEntries.
const kKey = (axis, hex) => `${BASE}.holo/${axis}/${hex}`;

// ── -04- · OpfsKappaStore: the DURABLE persistence tier behind KCACHE ──────────────────────────────
// KCACHE (Cache Storage) is the hot tier; OPFS is the address space (Law L3 — the store is the
// memory). Verified bytes are written through to OPFS at store time; on a KCACHE miss the SW serves
// from OPFS network-free, so durability SURVIVES Cache-Storage eviction. Best-effort + feature-
// detected: if OPFS is unavailable in this worker, KSTORE stays null and the SW behaves EXACTLY as
// before (no regression). put() is the L5 trust boundary — only κ-verified bytes are ever written.
let KSTORE = null, _ksTried = false;
async function kstore() { if (_ksTried) return KSTORE; _ksTried = true; try { KSTORE = await OpfsKappaStore.open("holo-fhs-kstore"); } catch { KSTORE = null; } return KSTORE; }
const _SWT = { html: "text/html", js: "text/javascript", mjs: "text/javascript", json: "application/json", jsonld: "application/ld+json", css: "text/css", wasm: "application/wasm", webmanifest: "application/manifest+json", svg: "image/svg+xml", png: "image/png", woff2: "font/woff2", map: "application/json", txt: "text/plain" };
const ctOf = (rel) => _SWT[(rel.split(".").pop() || "").toLowerCase()] || "application/octet-stream";

// ── SELF-HEAL (ADR-0067): turn the dead-end refusal into RECOVERY. A content address is a perfect
// lie-detector but not a healer — so when the origin serves a WRONG byte (κ mismatch), 404s, or is
// unreachable, re-fetch the SAME κ from a NON-origin source — IPFS (a sha-256 κ IS a CIDv1 sha2-256)
// or a WebRTC-mesh peer — and accept it ONLY after it RE-DERIVES (Law L5). A wrong byte from any source
// is refused; nothing is laundered; only a copy that hashes to the SAME κ is ever served. Best-effort +
// TIME-BOXED: heal() never blocks longer than HEAL_MS before falling through to the original
// refuse/passthrough, so the boot happy-path is byte-identical and cannot regress. The sealed ANCHOR is
// out of scope here by construction — these are os-closure/app-lock κ, never the constitution's own bytes.
const HEAL_MS = 6000;
// A fast HTTP content source for APP bytes: the apps-holo repo, served raw by GitHub's CDN (whole files,
// CORS, large files included). heal() fetches an app file from here by its serve-rel path and verifies the
// whole-file κ — so an app streams by content from here, IPFS, or the mesh interchangeably (Law L1).
const APPS_HOLO_BASE = "https://raw.githubusercontent.com/Hologram-Technologies/hologram-apps/main/";
// HEAVY app bytes (model weights, OS images) exceed GitHub's 100 MB/file + 1 GB Pages limits, so they are
// NOT in the git tree or the deploy — they are published as κ-NAMED assets on the apps repo's Releases
// (assets ≤2 GB, served with CORS from objects.githubusercontent.com). The asset filename IS the sha256 κ,
// so heal fetches by content with no manifest and verifies the whole-file hash (Law L5). Same identity
// (Law L1), different location. Set the tag to the published weights release.
const WEIGHTS_RELEASE_BASE = "https://github.com/Hologram-Technologies/hologram-apps/releases/download/weights-v1/";
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
const SUBPATH_PREFIXES = ["_shared", "sbin", "usr", "lib", "lib64", "pkg", "apps", "etc", "var", "opt", "srv", "boot", "bin", "home", "root", "mnt", "media", ".well-known", ".holo", "ipfs", "ipns"];
const TOPLEVEL_MODULES = ["holo-resolver.mjs", "holo-sources.mjs", "holo-peers.mjs", "holo-wire.mjs", "holo-fabric.mjs", "holo-launch.mjs", "holo-omni.mjs", "holo-boot-sw-register.mjs", "holo-heal-boot.mjs", "browser-sw.js"];   // OS modules imported as a bare-root specifier "/holo-*.mjs" (fhsMap routes them to sbin/ or lib/)
const FLAT_SRC = "^/(?:" + SUBPATH_PREFIXES.map((p) => p.replace(/[.]/g, "\\.")).join("|") + ")(?:/|$)";   // matches an origin-absolute OS-flat path "/usr/…", "/.holo/…" — NOT a BASE-rooted one
const reroot = (v) => (typeof v === "string" && /^\/(?!\/)/.test(v)) ? BASE + v.slice(1) : v;   // origin-absolute "/x" → "BASE x"; leaves //, https://, bare, relative alone
const rerootMap = (obj) => { const o = {}; for (const [k, v] of Object.entries(obj || {})) o[reroot(k)] = (v && typeof v === "object") ? rerootMap(v) : reroot(v); return o; };
// subpathBoot() — the inline runtime shim, as a classic <script> that runs before any module. It wraps
// fetch/XHR/Worker and watches the DOM, re-rooting only origin-absolute OS-flat paths (FLAT_SRC) onto BASE;
// everything else (relative, BASE-rooted, cross-origin) passes untouched. Self-contained, no deps.
function subpathBootBody() {
  return "(function(){try{"
    + "var B=" + JSON.stringify(BASE) + ";if(B===\"/\")return;self.__HOLO_BASE__=B;"
    + "var F=new RegExp(" + JSON.stringify(FLAT_SRC) + ");"
    + "function rr(u){try{var x=new URL(u,document.baseURI);if(x.origin===location.origin&&F.test(x.pathname)){x.pathname=B+x.pathname.slice(1);return x.href;}}catch(e){}return u;}"
    + "var of=self.fetch;if(of)self.fetch=function(i,n){try{i=(i&&i.url)?new Request(rr(i.url),i):rr(i);}catch(e){}return of.call(this,i,n);};"
    + "try{var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{arguments[1]=rr(u);}catch(e){}return xo.apply(this,arguments);};}catch(e){}"
    + "try{var W=self.Worker;if(W){self.Worker=function(u,o){return new W(rr(u),o);};self.Worker.prototype=W.prototype;}}catch(e){}"
    + "function fx(el){if(el&&el.getAttribute)[\"src\",\"href\"].forEach(function(a){var v=el.getAttribute(a);if(v&&F.test(v))el.setAttribute(a,B+v.slice(1));});}"
    + "function sc(n){if(n.nodeType===1){fx(n);if(n.querySelectorAll)[].forEach.call(n.querySelectorAll(\"[src],[href]\"),fx);}}"
    + "try{new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var a=ms[i].addedNodes;for(var j=0;j<a.length;j++)sc(a[j]);}}).observe(document.documentElement||document,{childList:true,subtree:true});}catch(e){}"
    + "}catch(e){}})();";
}
function subpathBoot() { return "<script>" + subpathBootBody() + "</script>"; }
// The fresh import map injected into a page that has NONE of its own. Factored out so loadClosure can hash
// the EXACT bytes it injects and allow them in the CSP (the SW's own injection must not violate its CSP).
function freshImportmapBody() {
  const prefixImports = {}; for (const p of SUBPATH_PREFIXES) prefixImports["/" + p + "/"] = BASE + p + "/";
  for (const n of TOPLEVEL_MODULES) prefixImports["/" + n] = BASE + n;
  return JSON.stringify({ imports: prefixImports });
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
  const inject = subpathBoot() + (mapped ? "" : `<script type="importmap">${freshImportmapBody()}</script>`);
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => m + inject) : inject + out;
  out = out.replace(/(\s(?:src|href))="\/(?!\/)/g, (_m, attr) => attr + '="' + BASE);   // origin-absolute src/href attrs → BASE-rooted (skips // protocol-relative)
  return out;
}
// finalize(buf, resp, rel, extra) — the ONE response builder for served bytes: re-roots HTML for the subpath,
// passes everything else straight through. When it rewrites, it drops content-length (the body grew) and
// content-encoding (the bytes are now identity) so the browser does not truncate or mis-decode the response.
function finalize(buf, resp, rel, extra = {}) {
  const cspro = CSPRO && CSPRO.get(rel);                 // a strict, hash-derived CSP for this boot screen?
  if (cspro) extra = { ...extra, "Content-Security-Policy-Report-Only": cspro };   // observe-only; promoted to enforcing after a browser pass
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
// Bound an EXTERNAL recovery fetch so a STALLED (not failed) connection can't hang heal() forever — on
// timeout it aborts and heal falls through to the next source. Used only for SMALL source files; the large
// weight-asset fetch below is intentionally left to the browser's own socket timeout (a short cap would
// abort legitimate >100 MB downloads on a slow link). The PRIMARY origin fetch is never bounded either —
// a slow network still needs it to complete. Only small, redundant recovery sources are time-boxed.
async function fetchT(url, opts, ms = HEAL_MS) {
  const ac = new AbortController();
  const t = setTimeout(() => { try { ac.abort(); } catch {} }, ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}
async function heal(rel, hex, axis, resp) {
  if (axis !== "sha256" || !/^[0-9a-f]{64}$/.test(hex)) return null;   // IPFS/mesh κ are sha2-256 (the open-web axis)
  let bytes = null, src = "mesh";
  // FAST content source: the apps-holo repo serves app files WHOLE by path (GitHub CDN — no IPFS
  // chunking/propagation lag, large files included). Try it first for app bytes and VERIFY the whole-file
  // κ (Law L5) so a wrong byte is refused. Location is just a latency choice; the κ is the identity (Law L1).
  // Time-boxed (small source files): a stalled CDN falls through to the release/IPFS sources, never hangs.
  if (rel.startsWith("apps/")) {
    try {
      const r = await fetchT(APPS_HOLO_BASE + rel, { cache: "no-store" });
      if (r.ok) { const ab = await r.arrayBuffer(); if ((await sha256hex(ab)) === hex) { bytes = new Uint8Array(ab); src = "apps-holo"; } }
    } catch {}
  }
  // κ-NAMED RELEASE ASSET: heavy weights/images live on the apps repo's Releases, named by their κ.
  // Fetch the asset whose name is this hex and verify the whole-file hash. Covers the >100 MB files that
  // can never be in the tree (so the apps-holo raw fetch above 404s). CORS-enabled; follows the 302 to
  // objects.githubusercontent.com. Tried before IPFS — a direct CDN GET beats DHT discovery latency.
  if (!bytes) {
    try {
      const r = await fetch(WEIGHTS_RELEASE_BASE + hex, { cache: "no-store" });
      if (r.ok) { const ab = await r.arrayBuffer(); if ((await sha256hex(ab)) === hex) { bytes = new Uint8Array(ab); src = "release"; } }
    } catch {}
  }
  // fallback: IPFS trustless gateways + WebRTC mesh, re-derived, time-boxed.
  if (!bytes) {
    try { bytes = await Promise.race([resolveByKappa("did:holo:sha256:" + hex, recovery(), new Map()), new Promise((r) => setTimeout(() => r(null), HEAL_MS))]); }
    catch { bytes = null; }                                            // resolveByKappa throws when no source served a κ-verified copy
  }
  if (!bytes) return null;
  // Derive the type from the FILE (extension), NOT from `resp` — resp is the origin's 404 page, whose
  // content-type is text/html. Serving a healed .js/.wasm as text/html breaks module-script loading
  // ("Expected a JavaScript-or-Wasm module script…"), which silently stalls workers. mimeOf wins.
  const ct = mimeOf(rel) || (resp && resp.headers.get("content-type")) || "application/octet-stream";
  const h = new Headers(); for (const [k, v] of Object.entries(COI)) h.set(k, v);
  h.set("content-type", ct); h.set("x-holo-cache", "heal"); h.set("x-holo-source", src);
  try { (await caches.open(KCACHE)).put(kKey(axis, hex), new Response(bytes.slice(0), { headers: h })); } catch {}   // seed the verified copy → tier-0 serves it network-free next time
  return new Response(bytes, { status: 200, headers: h });
}

let BYHEX = null;     // sha256 hex → os-relative path (the OS serving κ-route)
let BYBLAKE = null;   // blake3 hex → os-relative path (the unified-substrate σ-axis route)
let ARCHIVES = null;  // lazy .holo κ-store (ADR-0101): content-addressed models in IndexedDB, not the OS closure
const archiveStore = () => (ARCHIVES ||= makeArchiveStore());   // shares db/store names with the page's ingest
let BYPATH = null;    // os-relative path → sha256 hex (the verification pins)
let CSPRO = null;     // serve-rel HTML name → strict CSP, served Report-Only (etc/boot-csp.json, tools/csp-hashes.mjs)
const APPLOCK = new Set();   // app-ids whose lock closure has been folded into the pins (lazy, L5 for app bytes)
// ── G1 / SEC-1 — the TRUST ROOT. etc/os-closure.json carries every per-path κ pin; were the origin able to
// swap it, it could re-point every pin to forged-but-self-consistent bytes and the per-byte L5 check below
// would pass against the forgery. So the pin set itself is verified: re-derive os-closure.json against this
// baked anchor — the ONE κ a tamperer cannot forge without also editing this worker, which the browser loads
// out-of-band (SW registration / SRI), never through the handler it defines. Sealed by tools/holo-anchor-sw.mjs
// on every reseal. Empty string ⇒ an unsealed dev tree → enforcement off (no false refusal before first seal).
const CLOSURE_KAPPA = "72c64f203141374397ab15829fd0e2fb5b15fd3418d312ddd811ed35697a442f";
let CLOSURE_TRUSTED = true;   // flips false iff a baked anchor is present AND os-closure.json fails to re-derive → fail closed
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
  BYHEX = new Map(); BYBLAKE = new Map(); BYPATH = new Map(); CSPRO = new Map();
  try {
    const buf = await (await fetch(BASE + "etc/os-closure.json", { cache: "no-store" })).arrayBuffer();
    if (CLOSURE_KAPPA && !DEV && (await sha256hex(buf)) !== CLOSURE_KAPPA) { CLOSURE_TRUSTED = false; return; }   // G1/SEC-1: tampered pin set → fail CLOSED (handler refuses every request)
    foldClosure(JSON.parse(new TextDecoder().decode(buf)).closure);
  }
  catch { /* no closure → serve unverified (flat mapping still works) */ }
  // Strict per-page CSP for the boot screens, served REPORT-ONLY (observe, never block) until a browser
  // pass confirms zero violations — then promoted to the enforcing header. Hash-derived (not nonce-based)
  // so it composes with content addressing: a per-response nonce would change the bytes and break L5.
  try { for (const [k, v] of Object.entries(await (await fetch(BASE + "etc/boot-csp.json", { cache: "no-store" })).json())) { if (k.endsWith(".html") && typeof v === "string") CSPRO.set(k, v); } }
  catch { /* no CSP manifest → boot pages serve without the Report-Only header (unchanged behaviour) */ }
  // On a SUBPATH deploy (BASE !== "/") finalize() injects inline scripts the build-time hashes can't know
  // (the subpath shim + a fresh import map, both BASE-dependent). Hash exactly those and extend each
  // policy's script-src so the SW's own injection never trips its own CSP. No-op at a root deploy.
  if (BASE !== "/" && CSPRO.size) {
    try {
      const sha = async (s) => "'sha256-" + btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))))) + "'";
      const inj = (await sha(subpathBootBody())) + " " + (await sha(freshImportmapBody()));
      for (const [k, v] of CSPRO) CSPRO.set(k, v.replace(/(script-src [^;]*)/, "$1 " + inj));
    } catch { /* augmentation best-effort; Report-Only never blocks regardless */ }
  }
}
// Lazily fold an app's OWN lock closure into the pins, so app bytes are VERIFIED too (not just OS bytes) —
// the app's holospace.lock.json keys are already serve-rel paths (apps/<id>/* and the _shared/* runtime).
async function ensureAppLock(rel) {
  const id = (rel.match(/^apps\/([^/]+)\//) || [])[1];
  if (!id || APPLOCK.has(id)) return;
  APPLOCK.add(id);   // mark first → a missing/!ok lock just leaves those bytes unpinned (still served), never retried in a loop
  // SW-initiated fetches BYPASS our own fetch handler, so they don't get the flat→FHS mapping. Apply it
  // here, else on a static host (GitHub Pages) the flat lock path 404s, the app's closure never folds, and
  // its bytes can't heal by κ — the exact reason apps couldn't stream on the deploy.
  const lockRel = `apps/${id}/holospace.lock.json`;
  try { const r = await fetch(`${BASE}${fhsMap(lockRel) || lockRel}`, { cache: "no-store" }); if (r.ok) foldClosure((await r.json()).closure); }
  catch { /* unpinned → serve unverified, as before */ }
}
// Lazily fold the VOICE model κ-manifest into the pins (once). The voice weights live under
// usr/lib/holo/voice/vendor/ — gitignored, never committed or Pages-deployed (3.4 GB, >1 GB cap). The
// manifest (committed) maps each model file + runtime file to its sha256 κ. Folding it lets the SW HEAL
// those bytes by κ (Release asset → IPFS) on a static deploy, exactly as app bytes heal via their lock.
// The pinned paths aren't served from origin (gitignored), so a pin can only enable a heal, never cause
// a false refusal. No manifest → voice paths stay unpinned (clean 404), never retried.
let VOICEFOLDED = false;
async function ensureVoiceManifest(rel) {
  if (VOICEFOLDED || !rel.startsWith("usr/lib/holo/voice/vendor/")) return;
  VOICEFOLDED = true;
  try {
    const r = await fetch(`${BASE}usr/lib/holo/voice/models.manifest.json`, { cache: "no-store" });
    if (!r.ok) return;
    const m = await r.json();
    const put = (p, k) => { const hex = String(k).split(":").pop().toLowerCase(); if (/^[0-9a-f]{64}$/.test(hex)) { BYHEX.set(hex, p); if (!BYPATH.has(p)) BYPATH.set(p, hex); } };
    for (const [id, files] of Object.entries(m.models || {})) for (const [f, k] of Object.entries(files)) put(`usr/lib/holo/voice/vendor/models/${id}/${f}`, k);
    for (const [f, k] of Object.entries(m.runtime || {})) put(`usr/lib/holo/voice/vendor/transformers/${f}`, k);
  } catch { /* unpinned → as before */ }
}
// Lazily fold the SERVED-set closure (os/etc/os-served.json) into the pins, ONCE. os-closure.json is the
// curated network-free BOOT set (~500 κ); but the SW also serves the WHOLE os/ tree, and without this the
// ~93% of served files outside the boot closure pass UNVERIFIED (the unpinned branch below). os-served
// pins every served file (serve-rel/FHS-disk key → sha256), so re-derivation (Law L5) covers the whole OS,
// not just boot. Best-effort: a missing/!ok manifest leaves the extra paths unpinned (served as before,
// NEVER refused) — so this can only ADD verification; it cannot regress boot, and offline boot still
// verifies via the boot closure (os-closure). Folded with the SAME foldClosure() as os-closure (Law L5).
// A shared PROMISE, not a boolean: concurrent early-boot requests must AWAIT the same fold, else a request
// that arrives mid-fetch would see "already folding" and race ahead to an empty pin map → serve unverified.
// Memoized, so the manifest is fetched+folded exactly once; a miss/error resolves (those bytes stay
// unpinned = served as before, no regression) and is not retried in a loop.
let SERVEDFOLD = null, SERVED_OK = false;
const SEALED_TOPS = new Set();   // top-level dirs os-served pins → a "sealed zone". Excludes apps/* (they verify via per-app locks), so an app byte is never caught by the fail-closed refuse below.
function ensureServed() {
  return SERVEDFOLD || (SERVEDFOLD = (async () => {
    try {
      const r = await fetch(BASE + "etc/os-served.json", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); foldClosure(j.closure); for (const k of Object.keys(j.closure || {})) SEALED_TOPS.add(k.split("/")[0]); SERVED_OK = true; }
    }
    catch { /* no served manifest → those bytes stay unpinned (served unverified, as before) — no regression */ }
  })());
}
const sha256hex = async (buf) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  await self.clients.claim(); await loadClosure();
  for (const n of await caches.keys()) if (n.startsWith("holo-kappa-") && n !== KCACHE) await caches.delete(n);   // drop stale cache versions
})()));

const withHeaders = (body, resp, extra = {}) => { const h = new Headers(resp.headers); for (const [k, v] of Object.entries({ ...COI, ...extra })) h.set(k, v); return new Response(body, { status: resp.status, statusText: resp.statusText, headers: h }); };
// A κ mismatch is a SAFETY STOP, not a crash. Render it as a calm, plain-language page in the same
// dark, framed look as the rest of the OS (charset utf-8, so the copy never garbles), and let the red
// light · Esc · "Go back" return the visitor to the page they came from.
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
// A safe JS string literal for the page's inline self-report (escape `<` so a path can never close </script>).
const jsLit = (s) => JSON.stringify(String(s)).replace(/</g, "\\u003c");
// kind ∈ "path" (a SINGLE object didn't re-derive → possible tamper / partial transfer) | "closure"
// (the whole pin set is untrusted → the site was published mis-sealed: an OPERATOR error, not an attack on
// the visitor). The copy says WHICH, so a visitor isn't told "you're under attack" when the real cause is a
// bad deploy — and the operator gets an unambiguous, actionable message. The page also self-reports to the
// console (no server exists to beacon to; devtools is where the operator looks).
const refuseHtml = (rel, want, got, axis, kind = "path") => {
  const universal = kind === "closure";
  const notfound = kind === "notfound";   // an in-scope navigation to a path that simply isn't here — NOT a tamper/seal failure
  const kicker = notfound ? "Not found" : "Safety stop";
  const title = notfound ? "Nothing here — Hologram OS" : universal ? "This site wasn’t published correctly — Hologram OS" : "This couldn’t be verified — Hologram OS";
  const h1 = notfound ? "This page isn’t part of Hologram OS" : universal ? "This site didn’t publish correctly" : "This didn’t match, so nothing opened";
  const lead = notfound
    ? "Hologram couldn’t find anything at this address, so nothing opened."
    : universal
    ? "Hologram checks that every part of the page matches its seal before it runs. The published files don’t match their seal, so nothing opened."
    : "Hologram verifies every part before it runs. This one didn’t match, so it stopped here to keep you safe.";
  const quiet = notfound
    ? "The link may be old, or the app may have moved. Your device is fine — nothing went wrong."
    : universal
    ? "This is a problem with how the site was published — not your device, and not an attack on you. Reloading won’t help until it’s republished."
    : "Nothing loaded, and your device is fine — the page was likely changed, or only partly arrived.";
  const micro = notfound
    ? "Go back to where you were, or open Hologram from its home screen."
    : universal
    ? "If you published this site: re-run the reseal and redeploy. Otherwise please try again later, or open Hologram from its official link."
    : "If this keeps happening, open Hologram from its official link.";
  const report = jsLit((notfound ? "[Hologram] Not found: " : "[Hologram] Safety-Stop (" + kind + "): ") + rel + (notfound ? "" : " — wanted " + axis + ":" + want + (got ? (" · got " + axis + ":" + got) : "")));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><title>${esc(title)}</title>
<style>
  :root{ --fg:#eaf0fb; --soft:#c6d2e6; --muted:#8b97ad; --line:#1b2433; --panel:#0c111b; --accent:#7defc9; }
  *{ box-sizing:border-box; } html,body{ height:100%; margin:0; }
  body{ background:radial-gradient(120% 120% at 20% 0%, #1b2a4a 0%, #0d1117 58%, #05070c 100%) fixed; color:var(--fg);
    font:400 17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,Helvetica,Arial,sans-serif;
    display:grid; place-items:center; padding:24px; -webkit-font-smoothing:antialiased; }
  .card{ width:100%; max-width:520px; border:1px solid #2a3547; border-radius:16px; overflow:hidden;
    background:rgba(12,17,27,.72); -webkit-backdrop-filter:blur(22px); backdrop-filter:blur(22px);
    box-shadow:0 40px 110px -34px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.05); }
  .bar{ display:flex; align-items:center; gap:.85em; height:44px; padding:0 16px; border-bottom:1px solid var(--line);
    background:linear-gradient(180deg, rgba(27,27,31,.92), rgba(27,27,31,.6)); }
  .lights{ display:flex; gap:8px; } .lights i{ width:13px; height:13px; border-radius:50%; display:block; }
  .lights i.c{ background:#ff5f57; cursor:pointer; } .lights i.m{ background:#febc2e; } .lights i.x{ background:#28c840; }
  .lights i.c:hover{ filter:brightness(1.15); }
  .btitle{ color:var(--soft); font-weight:600; font-size:14px; letter-spacing:.01em; }
  .body{ padding:34px clamp(22px,5vw,42px) 30px; }
  .ico{ width:44px; height:44px; border-radius:12px; display:grid; place-items:center; margin:0 0 16px;
    color:var(--accent); background:color-mix(in srgb, var(--accent) 14%, transparent); }
  .kicker{ margin:0 0 10px; font-size:12px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; color:var(--accent); }
  h1{ margin:0 0 14px; font-size:clamp(24px,4vw,29px); font-weight:700; letter-spacing:-.02em; line-height:1.15; color:#fff; }
  .lead{ margin:0 0 12px; font-size:17px; line-height:1.55; color:var(--soft); }
  .quiet{ margin:0; font-size:15px; line-height:1.55; color:var(--muted); }
  .micro{ margin:16px 0 0; font-size:13.5px; color:var(--muted); }
  .acts{ display:flex; flex-wrap:wrap; justify-content:center; gap:10px; margin:26px 0 0; }
  .btn{ -webkit-appearance:none; appearance:none; cursor:pointer; border:0; border-radius:999px; font:600 15px/1 inherit;
    padding:13px 24px; transition:filter .14s, transform .1s, border-color .14s; }
  .btn:active{ transform:translateY(1px); }
  .btn-p{ background:#fff; color:#0a0c12; } .btn-p:hover{ filter:brightness(.94); }
  .btn-g{ background:transparent; color:var(--soft); border:1px solid #2a3547; } .btn-g:hover{ color:#fff; border-color:#3a4760; }
  details{ margin-top:24px; border-top:1px solid var(--line); padding-top:14px; }
  summary{ cursor:pointer; color:var(--muted); font-size:13.5px; list-style:none; display:inline-flex; align-items:center; gap:7px; }
  summary::-webkit-details-marker{ display:none; }
  summary::before{ content:"›"; font-size:15px; line-height:1; transition:transform .15s; }
  details[open] summary::before{ transform:rotate(90deg); }
  summary:hover{ color:var(--soft); }
  .tech{ margin-top:14px; display:grid; grid-template-columns:auto 1fr; gap:5px 16px;
    font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--muted); word-break:break-all; }
  .tech b{ color:var(--soft); font-weight:600; }
  @media (prefers-reduced-motion: reduce){ *{ transition:none!important; } }
</style></head>
<body>
  <main class="card" role="dialog" aria-labelledby="h">
    <div class="bar"><span class="lights" aria-hidden="true"><i class="c" id="dot" title="Go back"></i><i class="m"></i><i class="x"></i></span><span class="btitle">Hologram OS</span></div>
    <div class="body">
      <div class="ico" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4v5c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V7z"/><path d="M9.5 12.5l1.8 1.8 3.4-3.6"/></svg></div>
      <div class="kicker">${esc(kicker)}</div>
      <h1 id="h">${esc(h1)}</h1>
      <p class="lead">${esc(lead)}</p>
      <p class="quiet">${esc(quiet)}</p>
      <div class="acts">
        <button class="btn btn-p" id="back" type="button">Go back</button>
        <button class="btn btn-g" id="reload" type="button">${notfound ? "Home" : "Try again"}</button>
      </div>
      <p class="micro">${esc(micro)}</p>
      <details>
        <summary>Technical details</summary>
        <div class="tech"><b>Checked</b><span>${esc(rel)}</span>${notfound ? "" : `<b>Expected</b><span>${axis}:${esc(want)}</span><b>Found</b><span>${axis}:${esc(got)}</span>`}</div>
      </details>
    </div>
  </main>
<script>
  try{ ${notfound ? "console.info" : "console.error"}(${report}); }catch(e){}
  var NOTFOUND = ${notfound ? "true" : "false"}, HOME = ${jsLit(BASE)};
  function goBack(){ if (history.length > 1) history.back(); else location.href = HOME || "../"; }
  document.getElementById("back").addEventListener("click", goBack);
  document.getElementById("dot").addEventListener("click", goBack);
  // Safety-Stop secondary = "Try again" (reload); Not-found secondary = "Home" (reloading a missing page just 404s again).
  document.getElementById("reload").addEventListener("click", function(){ if (NOTFOUND) location.href = HOME || "../"; else location.reload(); });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape") goBack(); });
</script>
</body></html>`;
};
// Make a refusal OBSERVABLE, not just rendered. There is no origin server to beacon to, so "report" means:
// (1) a distinct console.error in the SW scope (where the operator looks in devtools), and (2) a best-effort
// postMessage to every window client, so a BOOTED OS can surface a single-path refusal (possible tamper) via
// its telemetry/Inbox. Both are best-effort and can never throw into the response path. A UNIVERSAL refusal
// has no live client to hear (2) — there its own page self-reports (refuseHtml) and CI's cold-boot witness
// catches it; the message exists for the single-path case, which is the real-tamper scenario the design is for.
function reportRefusal(kind, rel, want, got, axis) {
  try { console.error("[holo-sw] safety-stop (" + kind + "): " + rel + " — wanted " + axis + ":" + want); } catch {}
  try { self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((cs) => { for (const c of cs) c.postMessage({ type: "holo:refusal", kind, rel, want, got, axis }); }, () => {}); } catch {}
}
const refuse = (rel, want, got, axis = "sha256") => { reportRefusal("path", rel, want, got, axis); return new Response(refuseHtml(rel, want, got, axis, "path"), { status: 409, headers: { ...COI, "content-type": "text/html; charset=utf-8" } }); };
// An in-scope NAVIGATION to a path that simply isn't here would otherwise pass the HOST's raw 404 page into
// the frame (the "GitHub 404 inside a tab" a visitor reported). Render a calm in-OS not-found instead — never
// let a foreign error page reach the visitor. Scoped to top-level navigations so app fetch() probes that
// expect a 404 are untouched. Keeps the 404 status (honest), just replaces the body + look.
const notFound = (rel) => { try { console.info("[holo-sw] not found: " + rel); } catch {} return new Response(refuseHtml(rel, "", "", "sha256", "notfound"), { status: 404, headers: { ...COI, "content-type": "text/html; charset=utf-8" } }); };
// G1/SEC-1: the pin set itself failed to re-derive against the baked anchor → the whole boot is untrusted. Fail closed.
const refuseClosure = () => { reportRefusal("closure", "etc/os-closure.json", CLOSURE_KAPPA, "re-derivation failed (untrusted pin set)", "sha256"); return new Response(refuseHtml("etc/os-closure.json", CLOSURE_KAPPA, "re-derivation failed (untrusted pin set)", "sha256", "closure"), { status: 409, headers: { ...COI, "content-type": "text/html; charset=utf-8" } }); };

// ── SERVERLESS MCP — the SW answers the Model Context Protocol with NO origin server (Law L1/L4).
// Discovery (GET .well-known/mcp.json + /~<app>/.well-known/mcp.json) and JSON-RPC (POST /mcp +
// /~<app>/mcp) are generated client-side by the node-free engine over an app manifest read from the
// content cache. The standardized core (holo_describe + verify/resolve) and declared resolve handlers
// work here; build·run·share belong to the in-page tier (window.HoloApp), so they report honestly.
const MCP_APP = /^~([a-z0-9._-]{1,40})\/(mcp|\.well-known\/mcp\.json)$/i;
const isMcpRoute = (rel) => rel === "mcp" || rel === ".well-known/mcp.json" || MCP_APP.test(rel);
const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...COI, "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" } });
async function mcpManifest(id) {   // read the app's manifest: an IMPORTED app's manifest from the imports cache FIRST, else origin
  try { const m = await (await caches.open(IMPORTS)).match(`${BASE}apps/${id}/holospace.json`); if (m) return { ...(await m.json()), id }; } catch {}
  try { const r = await fetch(`${BASE}apps/${id}/holospace.json`, { cache: "no-store" }); if (r.ok) return { ...(await r.json()), id }; } catch {}
  return null;
}
// a best-effort resolver over served UOR objects (resolve_object / declared resolve-handlers): an imported
// app's self-verifying κ-objects live in the imports cache (keyed by hex), else fall back to origin paths.
const mcpResolve = async (uri) => {
  const hex = String(uri).split(":").pop().replace(/^\/+/, "").split(/[/?#]/)[0];
  if (/^[0-9a-f]{64}$/i.test(hex)) { try { const m = await (await caches.open(IMPORTS)).match(`${BASE}.holo-import/o/${hex}`); if (m) return await m.json(); } catch {} }
  try { const r = await fetch(BASE + String(uri).replace(/^\/+/, ""), { cache: "no-store" }); if (r.ok) return await r.json(); } catch {}
  return null;
};
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

// ── SERVERLESS IPFS PATH GATEWAY — /ipfs/<cid>/<path> resolves through the UnixFS DAG, every block
// re-derived against its CID (Law L5), so an IPFS site browses NATIVELY: a page's relative ./assets and its
// <a href> links resolve back through this same gateway. A directory serves its index.html (else a native
// listing); HTML gets the nav-reporter (a verified copy) so the omnibox tracks the journey. Immutable by
// construction (CID = content), so the assembled response is cached by URL — re-visits are network-free.
const IPFSCACHE = "holo-ipfs-v1";
const isIpfsRoute = (rel) => /^ipfs\/[^/?#]+/i.test(rel) || /^ipns\/[^/?#]+/i.test(rel);
async function ipfsRespond(req, rel, url) {
  const p = parseIpfsPath(rel);
  if (!p) return new Response("bad ipfs path", { status: 400, headers: COI });
  if (p.ns === "ipns") return new Response(ipfsErrorHtml(p, { reason: "IPNS names are not yet wired in this build", status: 501 }), { status: 501, headers: { ...COI, "content-type": "text/html; charset=utf-8" } });
  const cache = await caches.open(IPFSCACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;                                         // immutable content → URL-keyed cache, network-free
  let out; try { out = await resolveIpfsPath(p.root, p.path, makeGetBlock(fetch)); }
  catch (e) { out = { kind: "error", reason: (e && e.message) || String(e), status: 502 }; }
  // a directory addressed WITHOUT a trailing slash → redirect to add it, so the page's relative links resolve
  if (out.kind === "directory" && !url.pathname.endsWith("/")) {
    return new Response(null, { status: 308, headers: { ...COI, location: url.pathname + "/" + (url.search || "") } });
  }
  if (out.kind === "error") return new Response(ipfsErrorHtml(p, out), { status: out.status || 502, headers: { ...COI, "content-type": "text/html; charset=utf-8" } });
  const immut = "public, max-age=31536000, immutable";
  // DIRECTORY → a small native listing (buffer + cache).
  if (out.kind === "directory") {
    const body = new TextEncoder().encode(injectNavReporter(directoryListingHtml(p.root, p.path, out.entries)));
    const resp = new Response(body, { status: 200, headers: { ...COI, "content-type": "text/html; charset=utf-8", "x-holo-ipfs": "directory", "x-holo-cid": out.cidStr || p.root, "cache-control": immut } });
    try { await cache.put(req.url, resp.clone()); } catch {}
    return resp;
  }
  // FILE. HTML buffers (the nav-reporter must inject at <head>; HTML docs are small) → cache. Everything else
  // STREAMS block-by-block (large media/binaries render on the first leaf); blocks are O(1)-cached by CID, so
  // we skip the full-response URL cache for streams.
  let ct = out.contentType || "application/octet-stream";
  if (/^(text\/|application\/(json|xml|javascript))/i.test(ct) && !/charset/i.test(ct)) ct += "; charset=utf-8";
  if (/^text\/html/i.test(ct)) {
    const bytes = new Uint8Array(await new Response(out.stream()).arrayBuffer());
    const body = new TextEncoder().encode(injectNavReporter(new TextDecoder().decode(bytes)));
    const resp = new Response(body, { status: 200, headers: { ...COI, "content-type": ct, "x-holo-ipfs": "file", "x-holo-cid": out.cidStr || p.root, "cache-control": immut } });
    try { await cache.put(req.url, resp.clone()); } catch {}
    return resp;
  }
  return new Response(out.stream(), { status: 200, headers: { ...COI, "content-type": ct, "x-holo-ipfs": "file-stream", "x-holo-cid": out.cidStr || p.root, "cache-control": immut } });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // only our origin (cross-origin untouched)
  if (!url.pathname.startsWith(BASE)) return;                 // out of scope
  // Dynamic host back-end routes (dev media proxy, weather, web fetch) are NOT content-addressed and carry
  // QUERY STRINGS — the path-resolver below re-fetches by pathname only and would DROP the query (so e.g.
  // /sc/vstream?url=… and /sc/stream?url=… arrive with no url and the host refuses them). Let these hit the
  // network untouched so the query survives. They simply 404 on a static deploy (same as a direct fetch).
  {
    const relDyn = url.pathname.slice(BASE.length).replace(/^\/+/, "");
    if (/^sc\//.test(relDyn) || relDyn === "audio-proxy" || relDyn === "weather" ||
        ((relDyn === "web" || relDyn.endsWith("/web")) && /[?&]url=/.test(url.search))) return;
  }
  const relMcp = decodeURIComponent(url.pathname.slice(BASE.length)).replace(/^\/+/, "");
  if (MCP_API.test(relMcp)) { event.respondWith(apiRespond(req, relMcp)); return; }   // serverless REST κ-stream API
  if (isMcpRoute(relMcp)) { event.respondWith(mcpRespond(req, relMcp)); return; }   // serverless MCP endpoint
  if (req.method === "GET" && isIpfsRoute(relMcp)) { event.respondWith(ipfsRespond(req, relMcp, url)); return; }   // verified IPFS path gateway → native browsing
  if (req.method !== "GET") return;
  // FLAT-ORIGIN GATEWAY PASSTHROUGH (dev / root deploy where BASE === "/"): the bare-root navigation is
  // the marketing GATEWAY (repo-root index.html — the "Power up" cinematic boot landing), which lives at
  // "/" but OUTSIDE the FHS closure. If the SW answered it, it would serve the in-closure boot index.html
  // and jump straight to the shell, skipping the gateway. Let the bare root hit the network so the dev
  // server / static host serves the gateway. Under a SUBPATH deploy (BASE !== "/") the gateway is already
  // out of scope, so this never triggers and prod boot is byte-unchanged.
  if (BASE === "/" && req.mode === "navigate" && (url.pathname === "/" || url.pathname === "")) return;

  event.respondWith((async () => {
    await loadClosure();
    if (!CLOSURE_TRUSTED) return refuseClosure();              // G1/SEC-1: baked anchor present but os-closure.json did not re-derive → refuse all
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
      if (named) {
        rel = named;
      } else {
        // Not a closure name → it may be a content-addressed .holo MODEL in the κ-store
        // (ADR-0101, Seam A). Serve it by its blake3 κ from IndexedDB, re-derived (L5); a
        // tampered object is refused, not served. This is the wasm `fetch('/.holo/blake3/<κ>')`
        // delivery seam — any ingested model is reachable by κ with no origin (Law L1/L3).
        let bytes;
        try { bytes = await archiveStore().get("blake3:" + expect); }   // re-derives the WHOLE object (L5) before any slice
        catch { return refuse(rel, expect, "(κ-store re-derivation failed)", axis); }
        if (!bytes) return new Response("blake3 κ not in substrate index or κ-store", { status: 404, headers: COI });
        const total = bytes.length;
        const h = new Headers(COI);
        h.set("content-type", "application/octet-stream");
        h.set("x-holo-cache", "kstore"); h.set("x-holo-source", "archive");
        h.set("accept-ranges", "bytes");                                 // Stage 3 (ADR-0101): the κ-store is range-streamable
        // HTTP Range → 206 partial content, so a wasm RangeResolver pages weight bodies
        // by κ WITHOUT the whole archive ever resident in the page (true demand-paging).
        const rng = (req.headers.get("range") || "").match(/^bytes=(\d+)-(\d*)$/);
        if (rng) {
          const start = +rng[1];
          const end = rng[2] === "" ? total - 1 : Math.min(+rng[2], total - 1);
          if (start > end || start >= total) {
            const hr = new Headers(h); hr.set("content-range", `bytes */${total}`);
            return new Response("range not satisfiable", { status: 416, headers: hr });
          }
          const part = bytes.subarray(start, end + 1).slice(0);
          h.set("content-range", `bytes ${start}-${end}/${total}`);
          h.set("content-length", String(part.length));
          return new Response(part, { status: 206, headers: h });        // range responses are not cached whole
        }
        try { (await caches.open(KCACHE)).put(kKey(axis, expect), new Response(bytes.slice(0), { headers: h })); } catch {}
        return new Response(bytes.slice(0), { headers: h });
      }
    } else {
      await ensureAppLock(rel);                               // app bytes are verified too (lazy lock fold) — not just OS bytes
      await ensureVoiceManifest(rel);                         // voice weights heal by κ (gitignored, never deployed)
      await ensureServed();                                   // fold the SERVED-set closure → re-derive EVERY served byte, not just boot (Law L5)
      expect = BYPATH.get(rel) || BYPATH.get(fhsMap(rel) || rel) || null;   // pin by the request path OR its FHS-mapped disk path (os-served is disk-keyed; flat aliases like _shared/* route through fhsMap)
    }

    // κ-routes are content-addressed (immutable) → cacheable + verified. PATH requests bypass the by-κ
    // cache AND L5 refusal in DEV (localhost) so live source edits show without a reload; prod is unchanged.
    // ALSO in DEV: a κ-route that resolves to live SOURCE (not a vendored immutable blob) is served FRESH —
    // right after you edit a shared lib its pin is intentionally stale (e.g. a gateway-marked
    // `data-holo-shared` src froze the OLD κ), so follow the file, not the frozen κ. This is what ends the
    // "SW kept serving stale holo-voice.js" friction; vendored model blobs (onnx/wasm/…) stay content-addressed.
    const isKRoute = !!(m || mb);
    const isVendorBlob = /(^|\/)vendor\//.test(rel) || /\.(onnx|wasm|bin|data|task)$/i.test(rel);
    const devSourceK = DEV && isKRoute && !isVendorBlob;   // a source lib reached via a (now-stale) κ-route, in dev
    const trustCache = (isKRoute || !DEV) && !devSourceK;

    // tier 0 · the content cache: if this name has a known κ and that κ's VERIFIED bytes are already
    // resident, serve them network-free (no origin fetch, no re-hash — they were verified at store time).
    if (expect && trustCache) {
      const cache = await caches.open(KCACHE);
      const hit = await cache.match(kKey(axis, expect));
      if (hit) return finalize(await hit.arrayBuffer(), hit, rel, { "x-holo-cache": "hit" });

      // tier 1 · the DURABLE κ-store (OPFS, Law L3): KCACHE missed, but if these VERIFIED bytes are on
      // disk, serve them network-free — durability that survives Cache-Storage eviction (-04-). Re-warm
      // the hot tier on the way out. Best-effort: any OPFS error falls through to the origin fetch.
      try {
        const ks = await kstore();
        const ob = ks && await ks.getByKey(axis, expect);
        if (ob) {
          const h = new Headers(COI); h.set("content-type", ctOf(rel));
          try { await cache.put(kKey(axis, expect), new Response(ob.slice(0), { headers: h })); } catch {}
          return finalize(ob.slice(0), new Response(ob.slice(0), { headers: h }), rel, { "x-holo-cache": "opfs" });
        }
      } catch { /* OPFS unavailable → origin fetch below */ }
    }

    const phys = fhsMap(rel) || rel;                          // mapped FHS path, else the path as-is
    let resp;
    try { resp = await fetch(BASE + phys, { cache: "no-store" }); }   // SW-initiated → does not re-enter this handler
    catch (e) {                                               // origin unreachable (offline / denied) → SELF-HEAL from a non-origin source before giving up
      const healed = expect && trustCache ? await heal(rel, expect, axis, null) : null;
      return healed || new Response("holo-fhs-sw: fetch failed for " + phys, { status: 502, headers: COI });
    }
    if (resp.status !== 200 && phys !== rel) {                // fallback: a host that serves the FLAT name (e.g. the dev server streams apps live at apps/<id>/* rather than the vendored FHS path). κ re-derivation below still guards it.
      try { const alt = await fetch(BASE + rel, { cache: "no-store" }); if (alt.status === 200) resp = alt; } catch {}
    }
    if (resp.status !== 200) {                                // origin has no copy → SELF-HEAL the pinned κ from a non-origin source before passing the error through
      const healed = expect && trustCache ? await heal(rel, expect, axis, resp) : null;
      if (healed) return healed;
      // A bare host 404 for a top-level navigation strands the visitor on the host's error page. Replace it
      // with a calm in-OS not-found (navigations only; asset/fetch 404s pass through so app logic still sees them).
      if (resp.status === 404 && req.mode === "navigate") return notFound(rel);
      return withHeaders(resp.body, resp);
    }

    // Law L5: re-derive the bytes against the pinned κ ON ITS AXIS; refuse a mismatch. (κ-routes always;
    // PATH requests in PROD. In DEV a pinned path is served FRESH — its closure pin is intentionally stale.)
    if (expect && trustCache) {
      const buf = await resp.arrayBuffer();
      const got = axis === "blake3" ? blake3hex(new Uint8Array(buf)) : await sha256hex(buf);
      if (got !== expect) {                                   // tampered/wrong origin byte → SELF-HEAL: recover the SAME κ from a non-origin source, re-derived; only refuse if no source can
        const healed = await heal(rel, expect, axis, resp);
        return healed || refuse(rel, expect, got, axis);
      }
      const out = finalize(buf, resp, rel, { "x-holo-cache": "miss" });
      try { (await caches.open(KCACHE)).put(kKey(axis, expect), withHeaders(buf.slice(0), resp)); } catch {}   // cache the VERIFIED (un-rewritten) bytes by κ — deduped, network-free next time
      try { const ks = await kstore(); if (ks) await ks.putVerified(axis, expect, new Uint8Array(buf)); } catch {}   // -04- write-through to the DURABLE tier (OPFS) — survives Cache-Storage eviction
      return out;
    }
    if (expect) return finalize(await resp.arrayBuffer(), resp, rel, { "x-holo-cache": "dev-fresh" });   // DEV path request: served fresh, never cached, never refused
    // L5/SEC-1 fail-CLOSED for sealed zones: we reach here only UNPINNED. If os-served loaded (SERVED_OK) and
    // this path sits under a top-level os-served pins (a "sealed zone"), an unpinned 200 is an anomaly — an
    // unsealed or injected first-party byte — so in PROD refuse it instead of serving it unverified. Whole-OS
    // coverage means every legitimate sealed byte IS pinned, so this only catches a reseal gap or tamper. Gated
    // on SERVED_OK → a failed manifest load degrades to the prior passthrough (never bricks); apps/* is not a
    // sealed zone here (it verifies via per-app locks), so an app byte is never refused.
    if (!DEV && SERVED_OK && SEALED_TOPS.has((fhsMap(rel) || rel).split("/")[0])) return refuse(rel, "(sealed — must be in os-served)", "(unpinned)");
    if (BASE !== "/" && HTMLISH(rel)) return finalize(await resp.arrayBuffer(), resp, rel);   // unpinned HTML still needs the subpath re-root
    return withHeaders(resp.body, resp);
  })());
});
