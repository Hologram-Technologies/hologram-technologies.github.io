// holo-linux-sw.js — Holo Linux's offline engine. Two jobs:
//
//  1. Cross-origin isolation. Stamp COOP/COEP/CORP on every response so the engine's
//     SharedArrayBuffer works even on a static host that sends no such headers.
//  2. 100% serverless after first load. Cache the WHOLE app — shell, engine wasm,
//     the κ-pinned kernel + Debian rootfs — so it boots with the origin server OFF.
//
// Every app asset is vendored under this SW's scope, so the SW can serve every byte
// the boot needs from Cache Storage. The boot's κ-gate still re-derives the kernel +
// rootfs SHA-256 on each boot, so serving them from cache is safe: a corrupted cache
// entry fails the gate exactly like a corrupted download — integrity is never trusted.

const VERSION = "hl-v4";   // bumped: rootfs re-pinned (7 unprefixed commands) → purge the old cached image
const CACHE = "holo-linux-" + VERSION;
const SCOPE = new URL(self.registration.scope).pathname; // e.g. /apps/holo-linux/

const COI = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

// The complete set needed to cold-boot offline (relative to scope). The "make offline"
// button warms exactly this; the status check reports how much of it is resident.
const BOOT_SET = [
  "index.html", "holo-linux-worker.js", "holo-splash.js", "unicode-animations.js", "kappa.json", "icon.svg",
  "os-kernel.gz", "os-rootfs.tar.gz",
  "pkg/holospaces_web.js", "pkg/holospaces_web_bg.wasm",
  "vendor/xterm/xterm.css", "vendor/xterm/xterm.js", "vendor/xterm/addon-fit.js",
  "vendor/xterm/addon-webgl.js", "vendor/xterm/addon-web-links.js", "vendor/xterm/addon-search.js",
  "vendor/xterm/addon-unicode11.js", "vendor/xterm/addon-clipboard.js",
];

// "Airplane mode" — when set, the SW refuses ALL network and serves cache only. It
// makes the serverless claim self-evident: block the network at the worker boundary,
// cold-boot, and if Linux still comes up, the boot used zero network by construction.
let NET_BLOCKED = false;
const netFetch = (req) => NET_BLOCKED ? Promise.reject(new Error("holo: network blocked (airplane mode)")) : fetch(req);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("holo-linux-") && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// Rebuild a response with COI headers added (a live network response — body is a stream).
function withCOI(resp) {
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(COI)) h.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}
// Same, for a cached response (read its bytes so the result is independently servable).
async function coiFrom(resp) {
  const buf = await resp.arrayBuffer();
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(COI)) h.set(k, v);
  return new Response(buf, { status: 200, headers: h });
}

// Heavy, content-stable artifacts → cache-first (never re-download 34 MB per boot; the
// κ-gate re-verifies them regardless). Everything else → network-first so a live edit
// shows immediately, with cache as the OFFLINE fallback when the origin is gone.
const HEAVY = /\/(os-kernel\.gz|os-rootfs\.tar\.gz|holospaces_web_bg\.wasm)(\?|$)/;
const VENDORED = (p) => p.includes("/vendor/") || p.includes("/pkg/");

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  event.respondWith(handle(req, url));
});

async function handle(req, url) {
  const cache = await caches.open(CACHE);
  const cacheFirst = HEAVY.test(url.pathname) || VENDORED(url.pathname);

  if (cacheFirst) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return coiFrom(hit);
    try {
      const resp = await netFetch(req);
      if (resp.ok) cache.put(req, resp.clone());
      return withCOI(resp);
    } catch (e) {
      const any = await cache.match(req, { ignoreSearch: true });
      if (any) return coiFrom(any);
      throw e;
    }
  }

  // network-first (shell / worker / json / small assets) — but cache-first while
  // airplane mode is on, so a blocked boot serves entirely from Cache Storage.
  if (NET_BLOCKED) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (await cache.match(SCOPE + "index.html"));
    if (hit) return coiFrom(hit);
    return new Response("holo: offline, not cached", { status: 504, headers: COI });
  }
  try {
    const resp = await netFetch(req);
    if (resp.ok) cache.put(req, resp.clone());
    return withCOI(resp);
  } catch (e) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (await cache.match(SCOPE + "index.html"));
    if (hit) return coiFrom(hit);
    throw e;
  }
}

// ── message API (page ↔ SW) ────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "holo-warm") event.waitUntil(warm(event));
  else if (msg.type === "holo-cache-status") event.waitUntil(reportStatus(event));
  else if (msg.type === "holo-netblock") { NET_BLOCKED = !!msg.on; reply(event, { type: "holo-netblock", on: NET_BLOCKED }); }
});

// Pull the entire boot set into cache so the user can deliberately go offline.
async function warm(event) {
  const cache = await caches.open(CACHE);
  let done = 0, bytes = 0;
  for (const rel of BOOT_SET) {
    const u = SCOPE + rel;
    try {
      let hit = await cache.match(u, { ignoreSearch: true });
      if (!hit) { const r = await fetch(u, { cache: "reload" }); if (r.ok) { await cache.put(u, r.clone()); hit = r; } }
      if (hit) { bytes += (await hit.clone().arrayBuffer()).byteLength; done++; }
    } catch (_) {}
    reply(event, { type: "holo-warm-progress", done, total: BOOT_SET.length, bytes });
  }
  reply(event, { type: "holo-warm-done", done, total: BOOT_SET.length, bytes });
}

async function reportStatus(event) {
  const cache = await caches.open(CACHE);
  let cached = 0, bytes = 0;
  for (const rel of BOOT_SET) {
    const hit = await cache.match(SCOPE + rel, { ignoreSearch: true });
    if (hit) { cached++; try { bytes += (await hit.clone().arrayBuffer()).byteLength; } catch (_) {} }
  }
  reply(event, { type: "holo-cache-status", cached, total: BOOT_SET.length, bytes, ready: cached >= BOOT_SET.length });
}

function reply(event, data) {
  if (event.source) event.source.postMessage(data);
  else if (event.ports && event.ports[0]) event.ports[0].postMessage(data);
}
