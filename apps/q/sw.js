// sw.js — the WHOLE-RUNTIME offline service worker for Holo Q. The neural-computer "no server"
// claim made literal: after one online load, kill the network and everything still works — the
// app shell, the WebGPU engine + WASM, the agent tools, AND the model κ-object itself all serve
// from the local CacheStorage. Nothing in the inference loop ever needed a server; this proves it.
//
// WHY cache-first is correct here (not a staleness hazard): the model is a CONTENT-ADDRESSED object
// — each tensor block is fetched as /models/<m>/b/<κ>.gz where the filename IS the sha256 (Law L1).
// Immutable by construction ⇒ a cached block can never be wrong; re-deriving its κ (Law L5, done by
// the engine on decode) is the integrity check. So cache-first is both fastest AND lawful. The app
// code is versioned by ?v=NN query, so a new engine build simply caches under a new key.

const CACHE = "holo-q-runtime-v1";

// the minimal shell that must open with the network OFF (everything else is runtime-cached on first use)
const SHELL = [
  "./",
  "./index.html",
  "./ui/app.css",
  "./_shared/holo-mobile.css",
  "./_shared/holo-theme.js",
  "./ui/boot.js",
  "./icon.svg",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // best-effort precache — a missing optional asset must not abort the install
    await Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: "reload" }))));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// cache-first, then network, then store. Same-origin GET only. A navigation that fails offline
// falls back to the cached index.html so the app always boots.
self.addEventListener("fetch", (e) => {
  const req = e.req || e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never touch cross-origin (CDNs, telemetry)

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      // store only full, OK, basic responses — 206 Range / errors / opaque are not safe to replay
      if (res && res.status === 200 && (res.type === "basic" || res.type === "default")) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      if (req.mode === "navigate") {
        const shell = await cache.match("./index.html") || await cache.match("./");
        if (shell) return shell;
      }
      // offline + uncached (e.g. HoloFX best-effort κ-enrichment of a freshly-minted address):
      // degrade gracefully with a synthetic 504 so callers get a clean "unavailable" instead of a
      // hard network error — nothing actually reaches the wire. Core runtime is already cached.
      return new Response("", { status: 504, statusText: "offline (uncached)" });
    }
  })());
});

// let the page ask "is the model already fully cached?" (drives the offline-ready pill)
self.addEventListener("message", (e) => {
  const { type, base } = e.data || {};
  if (type === "model-cached?") {
    e.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const man = await cache.match(base + "/manifest.json", { ignoreVary: true });
      e.source && e.source.postMessage({ type: "model-cached", base, cached: !!man });
    })());
  }
});
