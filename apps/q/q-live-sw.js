// q-live-sw.js — BOOT-ONCE. The brain's weights are immutable content-addressed κ-blocks (HF …/resolve/main/
// b/<sha256>): fetch them from HuggingFace ONCE, cache-first forever, so every visit after the first is
// ~0-network and instant — and a flaky cold-stream can't wedge a returning user. Only immutable, content-
// addressed URLs are cached (the sha256 IS the version), so cache-first is always correct — never stale.
//
// Scope /apps/q/ controls q-live.html; the fetch handler still sees its cross-origin HF requests. claim() on
// activate takes control of the already-open page so the FIRST brain load is intercepted + cached as it streams.
const CACHE = "q-live-kappa-v1";

// immutable content-addressed weight blocks + the tokenizer header (both keyed by content). Anything else
// (manifests, app code, the localhost .holo Range reads) passes straight through to the network untouched.
const CACHEABLE = /\/resolve\/main\/b\/|\/b\/sha256_|\/resolve\/main\/tokenizer\.gguf/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  if (e.request.method !== "GET" || !CACHEABLE.test(url)) return;   // network as normal
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request);
    if (hit) return hit;                                            // served from cache — 0 network
    let res;
    try { res = await fetch(e.request); } catch (err) {             // offline + not cached → let it surface
      const stale = await cache.match(e.request); if (stale) return stale; throw err;
    }
    // cache opaque (cross-origin no-cors) and 200 bodies; a κ-block is immutable so this is safe forever.
    try { if (res && (res.status === 200 || res.type === "opaque")) await cache.put(e.request, res.clone()); } catch (_) {}
    return res;
  })());
});
