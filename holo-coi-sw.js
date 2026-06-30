// holo-coi-sw.js — the GATEWAY cross-origin-isolation shim.
//
// The marketing gateway (index.html) is served by a dumb static host (GitHub Pages) with no headers, and
// the FHS service worker only claims the OS subtree (scope system/os/). So the gateway document itself is
// NOT cross-origin-isolated — and a child iframe can be isolated ONLY if every ancestor is. That capped the
// launcher's inline app preview: SAB-heavy apps (Holo Linux, QEMU, Q) could STREAM their bytes but their
// SharedArrayBuffer worker could not start inside the preview (crossOriginIsolated was false).
//
// This tiny worker fixes exactly that and nothing else: it stamps COOP/COEP on the gateway's own responses
// so the page (and every same-origin app-preview iframe under it) becomes crossOriginIsolated. It is a pure
// header pass-through — it never rewrites a body, never caches, never content-addresses. The OS subtree stays
// owned by holo-fhs-sw.js (its narrower scope wins), so this only governs the gateway shell.
//
// credentialless COEP (matching the FHS worker) is the lenient mode: cross-origin subresources load without
// credentials instead of being blocked outright. The gateway has no cross-origin subresources anyway (its
// only off-origin refs are plain <a> links), so isolation here is safe — it cannot break an embed.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => { if (e.data && e.data.type === "holo-coi-deregister") self.registration.unregister(); });

const COI = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // cross-origin requests pass untouched (browser applies credentialless)
  // Defensive: never shadow the OS subtree — the FHS worker owns it (and already stamps its own COI). Its
  // narrower scope wins routing, so this normally never fires; the guard just makes the boundary explicit.
  const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (rel.startsWith("system/os/") || rel.startsWith("os/")) return;
  // only-if-cached cross-origin navigations would throw if intercepted — let them be
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;

  event.respondWith((async () => {
    let resp;
    try { resp = await fetch(req); }
    catch (e) { return new Response("holo-coi-sw: offline", { status: 502 }); }
    if (resp.status === 0 || resp.type === "opaque" || resp.type === "opaqueredirect") return resp;   // body is unreadable/immutable → cannot re-stamp; pass through
    const h = new Headers(resp.headers);
    for (const [k, v] of Object.entries(COI)) h.set(k, v);
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
  })());
});
