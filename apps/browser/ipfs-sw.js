// ipfs-sw.js — the Holo IPFS service-worker gateway. THIS is what makes the dweb feel
// like Chrome: a whole IPFS website renders and navigates natively, with EVERY subresource
// (HTML, CSS, JS, images, fonts) re-derived against its CID in the browser before it is
// served (Law L5 = the IETF Trustless Gateway contract). No gateway is trusted.
//
// Base-path aware: it derives its mount point from its own registration scope, so it works
// at the origin root (holo-serve) OR under a subpath like /<repo>/ (GitHub Pages). A request
// for <base>ipfsview/<cid>/<path> is resolved in the UnixFS DAG, every block verified, and
// served with the right content-type. A site's root-absolute subresource ("/style.css") is
// mapped back to its site via the Referer. Blocks come from: a bundled static block file
// (pure-static hosting), else the shared κ-cache, else a race of trustless gateways, else
// delegated-routing discovery — each re-verified. Files STREAM (first-paint on the first
// verified leaf). The page renders the site in a sandboxed iframe and drives back/forward.
//
// Module service worker → it imports the SAME engine the page + worker + witness use.

import * as IPFS from "./_shared/holo-ipfs.js";
// Milestone 1 convergence: the serve path (traverse UnixFS · stream file · list dir · error page) is the
// witnessed engine, not a second copy in this worker. getBlock is composed below (static bundle → engine's
// κ-cache / gateway race / delegated-routing discovery). OS canonical: holo-os/system/os/sbin/holo-ipfs-gateway.mjs.
import { makeGetBlock, resolveIpfsPath, directoryListingHtml, ipfsErrorHtml, imageViewerHtml } from "./_shared/holo-ipfs-gateway.mjs";

// holo-serve makes the page cross-origin-isolated (COOP same-origin + COEP credentialless); a same-origin
// response the isolated renderer embeds MUST carry compatible COEP/CORP or it is ERR_BLOCKED_BY_RESPONSE.
// The SW serves from the gateway/κ store, so it stamps them itself (mirrors browser-sw.js). Without this,
// IPFS paints in the standalone app but a subresourced site breaks embedded in the messenger's Q origin.
const COEPH = { "cross-origin-embedder-policy": "credentialless", "cross-origin-opener-policy": "same-origin", "cross-origin-resource-policy": "cross-origin" };

// Bump on any change to this worker OR its imported engine (holo-ipfs-gateway.mjs) so the browser
// re-installs and re-fetches the imports — a byte-identical SW script is NOT reinstalled, and static
// imports are cached with the worker. (M2: HAMT-sharded directory support in the gateway.)
const SW_BUILD = "ipfs-sw/m3-instant-car+viewer-2026-07-08c";
const CFG = "holo-ipfs-cfg-v1";
// Mount point + app base, derived from the SW's own scope (e.g. /repo/ipfsview/ → /repo/).
const VIEW = new URL(self.registration.scope).pathname.replace(/\/?$/, "/");
const APP_BASE = VIEW.replace(/ipfsview\/$/, "");
const STATIC = APP_BASE + "ipfs-demo/blocks/";        // bundled blocks (works on GitHub Pages)
const DEFAULT_GW = [
  { origin: "https://trustless-gateway.link", viaProxy: false },
  { origin: "https://ipfs.io", viaProxy: false },
  { origin: "https://dweb.link", viaProxy: false },
  { origin: "https://4everland.io", viaProxy: false },
  { origin: "https://w3s.link", viaProxy: false },
];
let CONFIG = null;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => {
  const m = e.data || {};
  if (m.type === "config") { CONFIG = { gateways: m.gateways || DEFAULT_GW, proxyBase: m.proxyBase || (APP_BASE + "ipfs?url=") }; caches.open(CFG).then((c) => c.put("/__cfg", new Response(JSON.stringify(CONFIG)))).catch(() => {}); if (e.ports && e.ports[0]) e.ports[0].postMessage("ok"); }
});
async function config() {
  if (CONFIG) return CONFIG;
  try { const c = await caches.open(CFG); const r = await c.match("/__cfg"); if (r) CONFIG = await r.json(); } catch {}
  return CONFIG || { gateways: DEFAULT_GW, proxyBase: APP_BASE + "ipfs?url=" };
}

// ── block retrieval — ONE getBlock, composed (every tier re-derives to the CID, Law L5) ──────────────
//   1 · bundled static block  (<base>ipfs-demo/blocks/<cid>.block) — pure-static hosting, offline, no gateway
//   2 · the engine's getBlock  — L1/L2 κ-cache → race the trustless gateways → delegated-routing DISCOVERY
// Tier 2 is the witnessed makeGetBlock; discoverGateways gives the whole-network reach this worker never had
// (a CID not on the 5 default gateways still resolves), plus the shared block cache. A wrong byte loses.
async function staticBlock(cid, cidObj) {
  try {
    const r = await fetch(STATIC + cid + ".block", { cache: "force-cache" });
    if (!r.ok) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    return (await IPFS.verifyBlock(cidObj, b)) ? b : null;
  } catch { return null; }
}
let ENGINE_GET = null;
async function engineGet() {
  if (ENGINE_GET) return ENGINE_GET;
  const { gateways } = await config();
  const origins = (gateways || []).map((g) => (typeof g === "string" ? g : g.origin)).filter(Boolean);
  ENGINE_GET = makeGetBlock(fetch, { gateways: origins, discover: true });   // cache → gateway race → discovery
  return ENGINE_GET;
}
async function getBlock(cidStr) {
  const cid = IPFS.cidToString(IPFS.parseCID(cidStr));
  const cidObj = IPFS.parseCID(cid);
  const s = await staticBlock(cid, cidObj);
  if (s) return s;
  const eng = await engineGet();
  const b = await eng(cid);
  if (!b) throw new Error("no source verified " + cid + " (gateways + delegated routing exhausted)");
  return b;
}
// CAR one-shot warm, delegated to the engine — streamUnixFsFile calls this to pull a whole DAG in one request.
getBlock.warm = async (cid, scope) => { const eng = await engineGet(); return (eng && typeof eng.warm === "function") ? eng.warm(cid, scope) : 0; };

// ── serve <base>ipfsview/<cid>/<path> — resolve through the engine, STREAM files (first-paint) ────────
// resolveIpfsPath walks the UnixFS DAG (serves index.html for a dir, else a native listing) and hands back
// a STREAM factory for files, so a big file / video / page renders on its FIRST verified leaf instead of
// buffering the whole DAG (the old reassembleFile path). Every block re-derives in getBlock (Law L5).
// collect a ReadableStream into one Uint8Array (bounded — huge images fall through to a raw stream).
async function collectStream(stream, cap = 40 * 1024 * 1024) {
  const reader = stream.getReader(); const parts = []; let n = 0;
  for (; ;) { const { value, done } = await reader.read(); if (done) break; parts.push(value); n += value.length; if (n > cap) { try { await reader.cancel(); } catch {} throw new Error("too large"); } }
  const out = new Uint8Array(n); let p = 0; for (const x of parts) { out.set(x, p); p += x.length; } return out;
}
async function serveIpfsView(rootCid, path, reqPath, opts = {}) {
  const res = await resolveIpfsPath(rootCid, path, getBlock);
  if (res.kind === "error") {
    return new Response(ipfsErrorHtml({ root: rootCid, path }, { reason: res.reason, status: res.status }),
      { status: res.status || 502, headers: { "content-type": "text/html; charset=utf-8", ...COEPH } });
  }
  // Web-canonical trailing slash: a directory (or a dir that serves index.html) MUST be viewed at a URL
  // ending in "/", so the page's own relative links and subresources (./style.css, about/) resolve against
  // the directory, not its parent. Without it, clicking a listing entry drops the CID ("ipfs://about") and a
  // real site's CSS/JS 404. Redirect once — exactly like nginx/apache. (Files are served at their exact URL.)
  if (reqPath && !reqPath.endsWith("/") && (res.kind === "directory" || res.servedIndex)) {
    return Response.redirect(new URL(reqPath + "/", self.location.origin).href, 301);
  }
  if (res.kind === "directory") {
    const html = directoryListingHtml(rootCid, path, res.entries);
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-holo-cid": res.cidStr, "x-holo-verified": "L5", ...COEPH } });
  }
  const ct = res.contentType || "application/octet-stream";
  // A navigated image (top-level document — not a subresource, not ?raw) → the STUNNING viewer: parse
  // format · true dimensions · EXIF from the already-verified bytes and frame it beautifully. The viewer's
  // own <img> re-requests ?raw (a cache hit) → the raw stream below. SVG is already a document; skip it.
  if (opts.asDocument && !opts.hasRaw && /^image\//.test(ct) && ct !== "image/svg+xml") {
    try {
      const bytes = await collectStream(res.stream());
      const html = imageViewerHtml(bytes, { name: res.name || (path ? path.split("/").pop() : ""), cidStr: res.cidStr, rawUrl: "?raw=1" });
      return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-holo-cid": res.cidStr, "x-holo-verified": "L5", ...COEPH } });
    } catch {}   // too large / parse error → fall through to the raw stream
  }
  // file → STREAM (never buffer the whole file)
  return new Response(res.stream(), { status: 200, headers: { "content-type": ct, "x-holo-cid": res.cidStr, "x-holo-verified": "L5", "cache-control": "public, max-age=31536000, immutable", ...COEPH } });
}

const refused = (e) => new Response("Holo IPFS could not verify this resource:\n" + e.message, { status: 502, headers: { "content-type": "text/plain", ...COEPH } });
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;                 // only our origin
  if (url.pathname.startsWith(VIEW)) {
    const rest = url.pathname.slice(VIEW.length);
    const m = rest.match(/^([^/]+)(\/.*)?$/);
    if (m) {
      // top-level navigation → a document (gets the image viewer for images); a subresource <img>/<script> or
      // an explicit ?raw → the raw bytes. This is what makes "open an image" a gallery, "embed one" a picture.
      const asDocument = event.request.mode === "navigate" || event.request.destination === "document";
      const hasRaw = url.searchParams.has("raw");
      event.respondWith(serveIpfsView(m[1], (m[2] || "").replace(/^\//, ""), url.pathname, { asDocument, hasRaw }).catch(refused));
    }
    return;
  }
  // root-absolute subresource from a site (e.g. "/style.css") → map back to its CID via Referer
  const rm = (event.request.referrer || "").match(new RegExp(VIEW.replace(/[/]/g, "\\/") + "([^/]+)\\/"));
  if (rm && url.pathname !== APP_BASE && !url.pathname.startsWith(APP_BASE + "_shared/") && !url.pathname.startsWith(APP_BASE + "ipfs")) {
    const sub = url.pathname.startsWith(APP_BASE) ? url.pathname.slice(APP_BASE.length) : url.pathname.replace(/^\//, "");
    // IPFS paths are content-addressed — a query string is not part of the path; strip it so DAG traversal
    // matches the real filename (a trailing "?v=1" would otherwise corrupt the last-segment lookup).
    event.respondWith(serveIpfsView(rm[1], sub).catch(() => fetch(event.request)));
  }
});
