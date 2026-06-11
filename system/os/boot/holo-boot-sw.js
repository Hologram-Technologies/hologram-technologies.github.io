// holo-boot-sw.js — the OS-wide κ Service Worker (ADR-026). Where holo-sw.js serves ONE mounted
// holospace's subresources by content, this serves the WHOLE Hologram OS by content: it resolves
// every same-origin GET in scope by its κ (from the OS-wide closure committed by the single OS root
// κ, os-root.jsonld) out of a MULTI-SOURCE chain — local cache → peers (IPFS/mesh) → origin —
// re-deriving every byte (Law L5). The origin gateway is thereby demoted from authority to one CDN
// among peers: deny it and the byte-identical, verified OS still boots from cache or a neighbour.
//
// SELF-BOOTSTRAPPING: a Service Worker can be killed and restarted at any time, losing in-memory
// state, so this does NOT depend on a one-time postMessage. It persists its config (closure + peer
// transports) to the Cache API and, on any fetch where the resolver is not yet live, reloads the
// closure from os-closure.json itself — so it survives restarts and works offline. The postMessage
// from holo-boot-sw-register.mjs is then just the fast path + the peer/gateway config channel.
//
// The resolution spine is holo-resolver.mjs (A29); the source chain is holo-sources.mjs; the live
// transports are holo-peers.mjs. Witnessed in Node (os-root / holo-peers) + the browser witness.

import { makeResolver, resolveByKappa, hexOf } from "./holo-resolver.mjs";
import { cacheSource, originSource, sourceChain } from "./holo-sources.mjs";
import { ipfsPeer, bridgePeer } from "./holo-peers.mjs";
import { joinLan } from "./holo-lan.mjs";
import { joinRelay } from "./holo-lan-relay-client.mjs";
import * as ipfs from "./_shared/holo-ipfs.js";

const CACHE = "holo-os-κ-v1";                              // the persistent κ-store + config (Cache API)
const store = new Map();                                  // RAM dedup of the address space (Law L3)
let resolve = null, CLOSURE = null, booting = null, LAN;  // LAN: undefined→unjoined, null→unavailable
let SOURCES = null;                                       // the live source chain, for the κ-route (resolve any address)
let RELAY = null, RELAY_URL = null;                       // the cross-device LAN relay (peerConfig.relay)

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// the Cache-API side of the local κ-store: hex → bytes (persists across restarts / offline).
async function cacheGet(hex) {
  try { const r = await (await caches.open(CACHE)).match("/.holo/κ/" + hex); return r && r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; }
}
async function cachePut(hex, bytes) { try { (await caches.open(CACHE)).put("/.holo/κ/" + hex, new Response(bytes)); } catch {} }
// the persisted config: { closure: {path→κ}, peers, peerConfig } — reloaded after a restart.
async function saveConfig(cfg) { try { (await caches.open(CACHE)).put("/.holo/config", new Response(JSON.stringify(cfg))); } catch {} }
async function loadConfig() { try { const r = await (await caches.open(CACHE)).match("/.holo/config"); return r && r.ok ? await r.json() : null; } catch { return null; } }

// ensureLan() — join the same-browser OFFLINE mesh once (BroadcastChannel) and answer siblings'
// wants from our κ-store. A `lan` peer then pulls a κ from a sibling when our cache misses — offline,
// no server (ADR-027). The resolver re-derives the reply (Law L5), so the sibling is untrusted.
function ensureLan() {
  if (LAN !== undefined) return LAN;
  LAN = typeof BroadcastChannel === "undefined" ? null : joinLan();
  if (LAN) LAN.serve(async (hex) => store.get(hex) || (await cacheGet(hex)));
  return LAN;
}

// ensureRelay(url) — join a cross-device LAN relay (holo-lan-relay on the LAN, no internet) and serve
// other devices' wants from our κ-store. A `relay` peer then pulls a κ from a warm device through the
// broker (ADR-027). Re-derived by the resolver, so the relay + peer are untrusted.
function ensureRelay(url) {
  if (!url) return RELAY;
  if (url !== RELAY_URL) { try { RELAY?.close(); } catch {} RELAY = joinRelay(url, { getByHex: async (hex) => store.get(hex) || (await cacheGet(hex)) }); RELAY_URL = url; }
  return RELAY;
}

// the live peer chain from the requested transport names (default ["ipfs"]). IPFS runs in the
// worker (a sha-256 κ IS a CIDv1 → race the Trustless Gateways; gateways overridable via
// peerConfig.ipfs — pin your own); "mesh" routes through the SW↔page bridge (askClient).
function buildPeers(names = ["ipfs"], peerConfig = {}) {
  const peers = [];
  for (const name of names) {
    if (name === "ipfs") peers.push(ipfsPeer({ ipfs, ...(peerConfig.ipfs || {}) }));
    else if (name === "mesh") peers.push(bridgePeer("mesh", askClient));
  }
  return peers;
}

function build(closure, peers, peerConfig) {
  CLOSURE = closure;
  const lan = ensureLan();
  const relay = ensureRelay(peerConfig && peerConfig.relay);
  const sources = sourceChain({
    cache: cacheSource(cacheGet),
    // offline-first order: cache → same-browser sibling → LAN relay → internet peers → origin (last).
    peers: [...(lan ? [lan.peer()] : []), ...(relay ? [relay.peer()] : []), ...buildPeers(peers && peers.length ? peers : ["ipfs"], peerConfig || {})],
    // the origin fetch carries __holo_raw so it is NOT re-intercepted by this worker (no recursion).
    origin: originSource(closure, (u, o) => fetch(u + (u.includes("?") ? "&" : "?") + "__holo_raw=1", o)),
  });
  SOURCES = sources;
  resolve = makeResolver({ closure, sources, store });
}

// precache() — fetch + store EVERY closure block so the OS boots FULLY offline later (survive the
// switch even from a cold reload). Background, best-effort, idempotent: a cache/store hit skips the
// network. Returns { cached, total }.
async function precache() {
  await ensureResolver();
  if (!CLOSURE) return { cached: 0, total: 0 };
  const paths = Object.keys(CLOSURE); let cached = 0;
  for (const p of paths) {
    try {
      const hex = hexOf(CLOSURE[p]);
      if (store.has(hex) || (await cacheGet(hex))) { cached++; continue; }
      await cachePut(hex, await resolve(p)); cached++;
    } catch {}
  }
  // announce to the LAN relay that this device now holds the whole OS — so cold devices can pull it.
  if (RELAY) try { await RELAY.announce(paths.map((p) => hexOf(CLOSURE[p]))); } catch {}
  return { cached, total: paths.length };
}

// ensureResolver — make the resolver live if it isn't (e.g. after a worker restart). Prefer the
// persisted config; else self-load os-closure.json (the `?__holo_raw` form the fetch handler does
// not intercept, so there is no re-entrancy). Deduplicated so concurrent fetches build it once.
async function ensureResolver() {
  if (resolve) return;
  if (!booting) booting = (async () => {
    let cfg = await loadConfig();
    if (!cfg || !cfg.closure) {
      const lock = await fetch(new URL("os-closure.json?__holo_raw=1", self.registration.scope).href).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (lock && lock.closure) cfg = { closure: Object.fromEntries(Object.entries(lock.closure).map(([p, r]) => [p, r.kappa])), peers: ["ipfs"], peerConfig: {} };
    }
    if (cfg && cfg.closure) build(cfg.closure, cfg.peers || ["ipfs"], cfg.peerConfig || {});
  })().finally(() => { booting = null; });
  await booting;
}

self.addEventListener("message", (e) => {
  const d = e.data || {};
  // precache the whole OS for full-offline boot (survive the switch even cold). Keeps the SW alive.
  if (d.precache) { e.waitUntil(precache().then((r) => { if (e.ports && e.ports[0]) e.ports[0].postMessage({ precached: r }); })); return; }
  if (!d.closure) return;
  const peers = d.peers && d.peers.length ? d.peers : ["ipfs"];
  build(d.closure, peers, d.peerConfig || {});
  saveConfig({ closure: d.closure, peers, peerConfig: d.peerConfig || {} });   // survive restarts (Law L3)
  if (e.ports && e.ports[0]) e.ports[0].postMessage({ ready: true, files: Object.keys(d.closure).length });
});

// askClient(kappa) — the SW↔page bridge for transports whose state lives in the page (the WebRTC
// mesh `sync` the rooms build). The page answers via holo-boot-sw-register.serveMeshToSw(sync). The
// resolver re-derives the reply, so it is untrusted.
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

const TYPE = { html: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css",
  json: "application/json", jsonld: "application/ld+json", svg: "image/svg+xml", png: "image/png",
  webp: "image/webp", wasm: "application/wasm", wav: "audio/wav", woff2: "font/woff2", map: "application/json" };
const mime = (p) => TYPE[p.split(".").pop().toLowerCase()] || "application/octet-stream";

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== "GET") return;
  if (url.searchParams.has("__holo_raw")) return;          // self-bootstrap fetch: never intercept
  const path = url.pathname.replace(/^\//, "");
  // κ-route: a reference to an object BY ITS CONTENT ADDRESS (/.holo/sha256/<hex>[.ext]). Resolved by
  // κ from any source + re-derived (Law L5), so it serves identically wherever the bytes live — an app
  // that references shared code this way is location-independent: relocate _shared/ and nothing breaks.
  const kap = path.match(/^\.holo\/(?:κ|sha256)\/([0-9a-f]{64})(?:\.([a-z0-9]+))?$/);
  if (kap) {
    e.respondWith((async () => {
      try {
        await ensureResolver();
        const bytes = await resolveByKappa("did:holo:sha256:" + kap[1], SOURCES || [], store);
        cachePut(kap[1], bytes);                            // persist by κ for offline / next boot
        return new Response(bytes, { headers: { "content-type": mime("x." + (kap[2] || "bin")), "x-holo-verified": "kappa", "x-holo-source": "multi" } });
      } catch { return fetch(e.request); }
    })());
    return;
  }
  e.respondWith((async () => {
    try {
      await ensureResolver();
      if (!resolve || !CLOSURE || !(path in CLOSURE)) return fetch(e.request);   // outside the OS closure → network
      const bytes = await resolve(path);                   // by κ, from any source, re-derived (Law L5)
      cachePut(hexOf(CLOSURE[path]), bytes);               // persist for offline / next boot
      // header value is ASCII ("kappa"): HTTP header values are ISO-8859-1, so a literal κ throws.
      return new Response(bytes, { headers: { "content-type": mime(path), "x-holo-verified": "kappa", "x-holo-source": "multi" } });
    } catch {
      return fetch(e.request);
    }
  })());
});
