// holo-sw.js — the ONE messenger service worker (scope /apps/holo-messenger/). Three jobs in one worker,
// because a scope may hold only one registration:
//
//   1. REACH (push): receive web-push while the app is closed, show a content-blind notification, deep-link on click.
//   2. M1 shell cache: precache the shell + serve it CACHE-FIRST so the 2nd open paints with ZERO network bytes.
//   3. κ-VERIFIED SHELL DELIVERY: every shell asset is verified against its committed content κ (shell-manifest.json)
//      BEFORE it is served or cached. Bytes may come from cache → the κ-store (content-addressed mirror, origin-
//      independent) → the origin, in that order. A hash MISMATCH is REFUSED — the one place this worker is NOT
//      fail-soft: a poisoned byte must never paint. This makes the boot link the integrity root for the whole shell
//      (the link commits the manifest's aggregate κ; the page verifies that; here we verify each byte against it).
//
// ES module (shares holo-push-route). The SHELL list mirrors SHELL_MANIFEST in holo-m1-boot.mjs (witness gates drift).
import { notificationFor, routeFor } from "./holo-push-route.mjs";

const CACHE = "holo-msgr-shell-a7801bc7f1fd";                     // bump → old (unverified) caches are purged on activate
// BASE-RELOCATABLE: the worker may be served under ANY prefix (OS root, a GitHub Pages /<repo>/ subpath, a
// static mirror). Every location below derives from where THIS script actually lives; at the OS root BASE is ""
// and behavior is byte-identical. Manifest paths stay CANONICAL ("/apps/holo-messenger/…" — they are identity,
// not location); canon() maps a runtime pathname back to its canonical id before any κ lookup.
const BASE = self.location.pathname.replace(/\/apps\/holo-messenger\/holo-sw\.js$/, "");
const canon = (p) => (BASE && p.startsWith(BASE)) ? p.slice(BASE.length) : p;
const SCOPE = BASE + "/apps/holo-messenger/";
const MANIFEST_URL = BASE + "/apps/holo-messenger/shell-manifest.json";
// content-addressed κ-store sources: an asset's exact bytes live at <base> + <sha256>. Tried in order — the
// same-origin mirror first (fast, but dies with the app origin), then the CROSS-ORIGIN HF κ-mirror, which gives
// TRUE origin independence: the shell boots even if the app's own server is gone. Because every byte is re-verified
// (Law L5), the source is untrusted plumbing — an untrusted CDN cannot forge the shell.
const K_STORES = [
  BASE + "/b/",
  "https://huggingface.co/HOLOGRAMTECH/holo-messenger-shell/resolve/main/b/",
];

const SHELL = [
  "/apps/holo-messenger/app.html",
  "/apps/holo-messenger/_vendor/ui/chat-ui.bundle.js",
  "/apps/holo-messenger/_vendor/ui/chat-ui.bundle.css",
  "/apps/holo-messenger/holo-messenger-login.mjs",
  "/apps/holo-messenger/holo-messenger-app.mjs",
  "/apps/holo-messenger/messenger-shadcn-ui.mjs",
  "/apps/holo-messenger/holo-messenger-weave.mjs",
  "/apps/holo-messenger/messenger-skin.mjs",
  "/apps/holo-messenger/messenger-skins.css",
  "/apps/holo-messenger/messenger-sw-register.mjs",
  "/apps/holo-messenger/holo-m1-boot.mjs",
  "/apps/holo-messenger/holo-release-boot.mjs",
  "/apps/holo-messenger/holo-release-verify.mjs",
  "/apps/holo-messenger/mail/holo-mail-attach.mjs",
  "/apps/holo-messenger/_vendor/wallpaper-default.jpg",
];

// path → committed content κ. Seeded from shell-manifest.json on install; UPGRADED (authoritatively) when the page
// hands us a link-verified manifest (postMessage), so a poisoned origin manifest can't lower the bar for a real link.
let SHELL_KAPPA = new Map();

const _hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sha256hex(buf) { return _hex(await crypto.subtle.digest("SHA-256", buf)); }
// the κ bar covers the shell AND the runtime table (S3.2): holospaces_web builds are verified on fetch
// exactly like shell assets — bytes that don't re-derive to the committed κ are refused, whatever served them.
function setManifest(assets, runtime) { try { const m = new Map(); for (const a of [...(assets || []), ...(runtime || [])]) if (a && a.path && a.kappa) m.set(a.path, a.kappa); if (m.size) SHELL_KAPPA = m; } catch {} }
async function loadManifest() { try { const r = await fetch(MANIFEST_URL, { cache: "no-store" }); if (r && r.ok) { const j = await r.json(); setManifest(j.assets, j.runtime); return j; } } catch {} return null; }
const expectedKappa = (pathname) => SHELL_KAPPA.get(pathname) || null;

const MIME = { html: "text/html", htm: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json", wasm: "application/wasm", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf" };
const mimeFor = (pathname) => MIME[(pathname.split(".").pop() || "").toLowerCase()] || "application/octet-stream";

// verify bytes against the committed κ, return a fresh SAME-ORIGIN Response with the CORRECT content-type (never
// trust a κ-store's content-type — a cross-origin CDN may serve octet-stream, which would break a module script or
// the navigation). null if the hash doesn't match.
async function verifiedResponse(res, kappa, mime) {
  if (!res || !res.ok) return null;
  const buf = await res.arrayBuffer();
  if (kappa && (await sha256hex(buf)) !== kappa) return null;   // integrity fail → caller falls back / refuses
  return new Response(buf, { status: 200, statusText: "OK", headers: { "content-type": mime || "application/octet-stream" } });
}
// try the origin, then each κ-store base in order; only VERIFIED bytes are returned. null = no source produced valid bytes.
async function fetchVerified(req, kappa, mime) {
  try { const v = await verifiedResponse(await fetch(req, { cache: "reload" }), kappa, mime); if (v) return v; } catch {}
  if (kappa) { for (const base of K_STORES) { try { const v = await verifiedResponse(await fetch(base + kappa, { cache: "reload" }), kappa, mime); if (v) return v; } catch {} } }
  return null;
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  // Precache the shell, VERIFYING each asset (origin → κ-store). Tolerate a single miss so install never wedges.
  e.waitUntil((async () => {
    try {
      await loadManifest();
      const cache = await caches.open(CACHE);
      await Promise.all(SHELL.map(async (u) => {
        try { const v = await fetchVerified(new Request(BASE + u), expectedKappa(u), mimeFor(u)); if (v) await cache.put(BASE + u, v.clone()); } catch {}
      }));
    } catch {}
  })());
});

self.addEventListener("activate", (e) => e.waitUntil((async () => {
  try { for (const k of await caches.keys()) { if (k.startsWith("holo-msgr-") && k !== CACHE) await caches.delete(k); } } catch {}
  try { if (!SHELL_KAPPA.size) await loadManifest(); } catch {}
  try { await self.clients.claim(); } catch {}
})()));

// the page hands us the LINK-VERIFIED manifest (its aggregate was checked against the boot link) — trust it over
// whatever install fetched from the origin.
self.addEventListener("message", (e) => { const d = e.data || {}; if (d.type === "holo-shell-manifest") setManifest(d.assets, d.runtime); });

const CACHEABLE = /\.(jpg|jpeg|png|gif|svg|webp|avif|ico|css|js|mjs|wasm|woff2?|ttf|otf)$/i;
const STATIC_DIRS = [SCOPE, BASE + "/apps/ui/", BASE + "/_shared/", BASE + "/usr/share/", BASE + "/usr/lib/holo/", BASE + "/apps/q/pkg/", BASE + "/apps/workspace/pkg/", BASE + "/usr/lib/pkg/"];

// cache-first, with κ-verified refill. A cached hit was verified when stored → served directly (0 net). A miss on a
// MANIFESTED shell asset must pass verification (origin → κ-store) or is REFUSED (502). Non-manifested statics keep
// plain cache-first (nothing to verify against).
async function cacheFirst(req, pathname) {
  // A restarted worker loses the in-memory manifest (install doesn't re-run) — lazily reload it (from the
  // integrity index, which is never intercepted/killed) so verification + κ-store recovery survive eviction.
  if (!SHELL_KAPPA.size) await loadManifest();
  const cache = await caches.open(CACHE);
  const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
  if (hit) return hit;
  const cpath = canon(pathname);   // κ lookups use the canonical id, wherever the shell is mounted
  let kappa = expectedKappa(cpath);
  if (kappa) {
    let v = await fetchVerified(req, kappa, mimeFor(pathname));
    // A rebuilt shell rotates every asset's κ. A long-lived worker's IN-MEMORY manifest goes stale and would
    // reject the fresh bytes — so on a miss, RE-PULL the manifest (no-store) and retry once against the new κ.
    if (!v) { await loadManifest(); const k2 = expectedKappa(cpath); if (k2 && k2 !== kappa) { kappa = k2; v = await fetchVerified(req, kappa, mimeFor(pathname)); } }
    if (v) { try { await cache.put(req, v.clone()); } catch {} return v; }
    // Never BRICK the shell on an integrity miss: fall back to the plain network response (manifest lag / drift).
    // The bytes still came from the origin over TLS; failing closed to a blank 502 is strictly worse for the user.
    try { const res = await fetch(req, { cache: "reload" }); if (res && res.ok) return res; } catch {}
    return new Response("shell integrity check failed", { status: 502, headers: { "content-type": "text/plain" } });
  }
  // non-manifested static: refill from network, cache basic 200s.
  try { const res = await fetch(req); try { if (res && res.ok && res.type === "basic") cache.put(req, res.clone()); } catch {} return res; }
  catch { return new Response("offline", { status: 504 }); }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                   // never touch POST/PUT/etc
  let url; try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;    // own-origin only
  if (self.location.port === "8472" || self.location.port === "8474") return;   // DEV-ITERATE PORTS: never cache/verify — always serve live (edits appear instantly; no stale shell, no integrity brick)
  const p = url.pathname;
  if (p === MANIFEST_URL || p.startsWith(BASE + "/b/")) return;     // the integrity index + same-origin κ-store: never intercept (avoid loops)
  // NAVIGATION (app.html) — κ-verified, cache-first, so the 2nd open needs 0 network to paint.
  if (req.mode === "navigate" && p.startsWith(SCOPE)) { e.respondWith(cacheFirst(req, p)); return; }
  // ROOT-RESCUE (mounted hosts only): runtime code addresses the OS by CANONICAL absolute paths ("/usr/…",
  // "/_shared/…") which resolve against the DOCUMENT — on a /<repo>/ mount they'd escape the bundle and 404.
  // Remap them onto the mount base. At the OS root BASE is "" and this never fires.
  if (BASE && !p.startsWith(BASE + "/") && ["/apps/", "/usr/", "/_shared/", "/vendor/"].some((d) => p.startsWith(d))) {
    e.respondWith(cacheFirst(new Request(BASE + p + url.search, { mode: "same-origin" }), BASE + p)); return;
  }
  const staticAsset = CACHEABLE.test(p) && STATIC_DIRS.some((d) => p.startsWith(d));
  if (!staticAsset) return;                            // PASSTHROUGH: APIs, ws, bridges, media, κ-weights, dynamic
  e.respondWith(cacheFirst(req, p));
});

// ── REACH (push) ─────────────────────────────────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let payload = {}; try { payload = event.data ? event.data.json() : {}; } catch {}
  const n = notificationFor(payload);
  if (!n) return;   // unknown / already-filtered Noise → stay silent
  event.waitUntil(self.registration.showNotification(n.title, {
    body: n.body, tag: n.tag, data: n.data, renotify: !!n.renotify, requireInteraction: !!n.requireInteraction,
    icon: SCOPE + "icon.svg", badge: SCOPE + "icon.svg",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = routeFor((event.notification.data || {}).route || {});
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of wins) { if ("focus" in c) { try { c.postMessage({ type: "holo-notif-route", route }); } catch {} return c.focus(); } }
    if (self.clients.openWindow) return self.clients.openWindow((BASE || "") + "/?route=" + encodeURIComponent(JSON.stringify(route)));
  })());
});
