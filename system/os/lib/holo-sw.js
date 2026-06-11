// holo-sw.js — the per-app κ Service Worker (W3C Service Worker + Cache API). Serves a mounted
// holospace's subresources BY CONTENT from a MULTI-SOURCE chain — local cache → peers (IPFS / mesh)
// → origin — re-deriving every byte (Law L5). So the app loads serverless AND distributed: stored
// anywhere, accessed from multiple machines; the origin is one CDN among peers, and a wrong byte from
// any source (incl. the origin) is refused. holospace.html hands it the app's closure (path → κ) and
// optional peer transports. Same resolution spine (holo-resolver, A29) + source chain (holo-sources)
// as the OS-wide holo-boot-sw.js, over ONE app's closure — its narrower twin. The multi-source +
// Law-L5 contract is witnessed in Node (holo-resolver-witness); live serving is the browser witness.
import { makeResolver, resolveByKappa, hexOf } from "./holo-resolver.mjs";
import { cacheSource, originSource } from "./holo-sources.mjs";
import { ipfsPeer, bridgePeer } from "./holo-peers.mjs";
import * as ipfs from "./_shared/holo-ipfs.js";

const CACHE = "holo-app-κ-v1";                            // persistent κ-store (Cache API, offline-first)
const store = new Map();                                 // RAM dedup of the address space (Law L3)
let resolve = null, CLOSURE = null, SOURCES = null;      // SOURCES: the live chain, for the κ-route (resolve any address)

// askClient(kappa) — the SW↔page bridge for transports whose state lives in the page (the WebRTC
// mesh `sync` a room builds). The page answers via holo-boot-sw-register.serveMeshToSw(sync); the
// resolver re-derives the reply, so it is an untrusted fast path (Law L5).
async function askClient(kappa) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  for (const client of clients) {
    const bytes = await new Promise((res) => {
      const ch = new MessageChannel();
      const to = setTimeout(() => res(null), 4000);
      ch.port1.onmessage = (ev) => { clearTimeout(to); const b = ev.data && ev.data.bytes; res(b ? new Uint8Array(b) : null); };
      client.postMessage({ holoPeerRequest: kappa }, [ch.port2]);
    });
    if (bytes) return bytes;
  }
  return null;
}
// the live peer chain from transport names (default ["ipfs"], always-on — a κ IS a CIDv1 sha2-256,
// so IPFS Trustless Gateways serve it directly; "mesh" routes through the page bridge).
function buildPeers(names = ["ipfs"], peerConfig = {}) {
  const peers = [];
  for (const name of names) {
    if (name === "ipfs") peers.push(ipfsPeer({ ipfs, ...(peerConfig.ipfs || {}) }));
    else if (name === "mesh") peers.push(bridgePeer("mesh", askClient));
  }
  return peers;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

async function cacheGet(hex) {
  try { const c = await caches.open(CACHE); const r = await c.match("/.holo/κ/" + hex); return r && r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; }
}
async function cachePut(hex, bytes) { try { (await caches.open(CACHE)).put("/.holo/κ/" + hex, new Response(bytes)); } catch {} }

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (!d.closure) return;
  // Source chain (preference order): persistent cache → live peers (IPFS/mesh) → origin (demoted).
  // The resolver re-derives every byte, so an untrusted peer or a tampered origin is refused alike.
  // Per-app SW: the local origin it was loaded from is the fast PRIMARY; peers (IPFS/mesh) resolve
  // ACROSS MACHINES as the resilience fallback (origin denied / offline). The OS-wide holo-boot-sw
  // demotes the origin behind peers for sovereign delivery; the per-app SW favors latency. Either
  // way every byte is re-derived (Law L5), so source order is a performance choice, not a trust one.
  const sources = [
    cacheSource(cacheGet),
    // the origin fetch carries __holo_raw so it is NOT re-intercepted by this worker (no recursion).
    originSource(d.closure, (u, o) => fetch(u + (u.includes("?") ? "&" : "?") + "__holo_raw=1", o)),
    ...buildPeers(d.peers && d.peers.length ? d.peers : ["ipfs"], d.peerConfig || {}),
  ];
  CLOSURE = d.closure;
  SOURCES = sources;
  resolve = makeResolver({ closure: d.closure, sources, store });
  if (e.ports && e.ports[0]) e.ports[0].postMessage({ ready: true, files: Object.keys(d.closure).length });
});

const TYPE = { html: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css",
  json: "application/json", jsonld: "application/ld+json", svg: "image/svg+xml", png: "image/png",
  webp: "image/webp", wasm: "application/wasm", wav: "audio/wav", woff2: "font/woff2", map: "application/json" };
const mime = (p) => TYPE[p.split(".").pop().toLowerCase()] || "application/octet-stream";

self.addEventListener("fetch", (e) => {
  if (!resolve) return;                                  // not configured yet → default network
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== "GET") return;
  if (url.searchParams.has("__holo_raw")) return;        // this worker's own origin fetch: never re-intercept
  const path = url.pathname.replace(/^\//, "");
  // κ-route: reference an object BY ITS CONTENT ADDRESS (/.holo/sha256/<hex>[.ext]) — resolved by κ from
  // any source, re-derived (Law L5), location-independent. Lets an app import shared objects by address.
  const kap = path.match(/^\.holo\/(?:κ|sha256)\/([0-9a-f]{64})(?:\.([a-z0-9]+))?$/);
  if (kap) {
    e.respondWith((async () => {
      try {
        const bytes = await resolveByKappa("did:holo:sha256:" + kap[1], SOURCES || [], store);
        cachePut(kap[1], bytes);
        return new Response(bytes, { headers: { "content-type": mime("x." + (kap[2] || "bin")), "x-holo-verified": "kappa", "x-holo-source": "multi" } });
      } catch { return fetch(e.request); }
    })());
    return;
  }
  e.respondWith((async () => {
    try {
      const bytes = await resolve(path);                 // by κ, from cache → peers → origin, re-derived (Law L5)
      if (CLOSURE && CLOSURE[path]) cachePut(hexOf(CLOSURE[path]), bytes);   // persist for offline / next boot
      return new Response(bytes, { headers: { "content-type": mime(path), "x-holo-verified": "kappa", "x-holo-source": "multi" } });
    } catch {
      return fetch(e.request);                           // outside the closure → normal fetch
    }
  })());
});
