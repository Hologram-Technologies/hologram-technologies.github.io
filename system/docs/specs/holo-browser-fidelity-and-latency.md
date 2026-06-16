# Holo Browser — faithful rendering, unified substrate, low latency

Status: design (this round = the cheap compounding wins; native CEF is the deferred endgame)
Scope: the in-browser web build. Files: `os/lib/browser-sw.js`, `os/usr/lib/holo/holo-browser.js`, `os/usr/lib/holo/holo-blake3.mjs`, `tools/holo-serve-fhs.mjs`, `os/usr/share/frame/shell.html`.

## 0. The honest ceiling

A same-origin rewriting proxy **cannot be 100% faithful to every site**. Every proxied page collapses onto our one origin (`<origin>/webview/`). That structurally breaks anything origin-sensitive: domain cookies, login/auth, the site's own service worker, websockets, and `location`/origin checks in JS. Static + content sites render faithfully today (github.com, HN, Wikipedia all verified). Authed SPAs will not — that is a property of the architecture, not a bug to patch.

True "render anything as its original code" = the **native CEF/WebView2 build**, where the webview loads real origins and the κ-store is the verified resource cache (`CefResourceHandler` over the same store `browser-sw.js` already implements). This round maximizes fidelity + speed *within the proxy* and is **forward-compatible** with that endgame (§5), not throwaway.

## 1. Goal

1. **Faithful** — serve each page as its **original code** (stop mutating it).
2. **Unified** — every web byte is a first-class object in the **one κ-substrate** (dedup across sites *and* apps).
3. **Fast** — first paint must not wait on a full download + hash.

Three changes, each small, each lifting more than one goal.

---

## 2. Change F — faithful original code (stop mutating HTML)

**Today** (`browser-sw.js rewriteHtml`, L75–90): regex-rewrites every `<a href>` and `<form action>` to `/webview/w/<enc>`. This **edits the original code**, is regex-fragile on real-world HTML, and still misses JS-driven navigation (the L71–73 caveat).

**New:** do **not** rewrite links. Keep `<base href=realUrl>`. Inject **one runtime navigation interceptor** `<script data-holo-ephemeral>` that captures navigation at the *event layer*, leaving the DOM byte-faithful:
- `click` (capture) → nearest `<a href>`; if it would leave the doc, `preventDefault()` + `location.assign("/webview/w/" + enc(abs))`.
- `submit` (capture) on GET forms → same in-scope redirect with the query.
- wrap `history.pushState`/`replaceState` → keep SPA routing in-scope (mirror the real URL into the HUD + the `/webview/w/` path) — this is the SPA fidelity win.
- (optional) `window.open`, `<base>`-relative `fetch`/XHR already resolve to real absolute URLs → the SW intercepts + mints them (unchanged).

**Why faithful:** the served bytes = the original page + a `<base>` + one ephemeral `<script>` prefix. The κ is minted over the **original fetched bytes** (before injection), so `x-holo-cid` stays the source — identical discipline to `serveKappa`'s content-script transform (L127–139). The injected script is marked `data-holo-ephemeral` (the OS already strips these from re-derivation, see shell.html mount L1001).

**Why more robust than today:** a client-side interceptor (`preventDefault` + in-scope redirect) does **not** depend on the SW intercepting cross-origin navigations (the thing the L71–73 comment says "escapes"). It replaces *both* the regex rewrite *and* the fragile SW-nav reliance.

**Risk:** a site that builds links in JS after load is still covered (event-layer capture is live). The residual gap is a site that calls `location.href = "https://other"` directly in JS to a cross-origin URL — caught by the `pushState`/navigation wrapper where possible, else it escapes (named in §6).

---

## 3. Change L — stream-while-hash (low latency)

**Today** (`serveWeb` L143–160, `serveSub` L163–173): `fetch → await arrayBuffer() → kappaOf(all) → kPut → verify → serve`. Render is blocked on the **full download + a full hash pass**.

**New:** return a **streamed `Response`**. Pipe the proxy body through a `TransformStream` that (a) forwards each chunk to the iframe immediately (render starts on first bytes), (b) accumulates for the mint. On `flush`: mint κ, write to the unified store (§4), `broadcast` committed.
- **Subresources** (CSS/JS/img/font — the byte bulk): pure stream-through, no buffering.
- **HTML**: stream the small injected prefix (`<base>` + interceptor) first, then stream the original body. Only the head prefix is synthesized; the body streams.
- **L5 stays honest**: first-sighting *is* the mint — the κ is *defined* by exactly the streamed bytes, so there is nothing prior to violate. Re-visits serve the already-verified cache entry (content-addressed, no re-hash).

**Hashing:** `holo-blake3.mjs` is one-shot today (`blake3hex`), so v1 hashes the accumulated buffer at `flush` — the win is overlapping **network with render**, not the hash itself. v2: add an incremental `Blake3Hasher{update,finalize}` (the chunked state machine already exists internally) to hash as chunks arrive and drop the tail pass.

**Proxy throughput** (`tools/holo-serve-fhs.mjs webProxy`): give the outbound `fetch` an HTTP/2 keep-alive connection pool (undici `Agent({ keepAlive })`) so a page's many subresources reuse connections instead of reconnecting.

---

## 4. Change U — unify into the κ-substrate (anchoring + dedup)

**Today:** web bytes mint via blake3 into a **siloed** Cache `holo-browser-kappa-v1` (`browser-sw.js` L30). Siloed from the OS κ-store → no cross-OS dedup, not κ-routable.

**New:** mint into the **main κ-store on the σ-axis (blake3)**, keyed exactly like the OS (`<base>.holo/blake3/<hex>`, the `KCACHE` namespace `holo-fhs-sw.js` already uses). Reads check the unified store first.
- **Dedup:** a web font / JS lib byte-identical to one an app ships → **one κ**, served once, network-free to *every* site and app thereafter.
- **κ-routable:** every web resource becomes a first-class substrate object, resolvable via `/.holo/blake3/<hex>` anywhere in the OS — "anchored in the unified κ-addressable substrate," literally.
- **Axis choice:** blake3 is the substrate's native σ-axis *and* incremental-friendly (for §3). sha256 stays the open-web/IPFS/CID axis; a CID can be derived on demand for IPFS interop. So web mint = blake3 σ-axis; no conflict with the IPFS gateway (sha256).

---

## 5. Forward-compatibility with native CEF

This round is not throwaway — it *is* the CEF design, minus the engine:
- The **runtime navigation interceptor** + `<base>` maps directly onto CEF's `OnBeforeBrowse` / request handler (real origins, no rewrite).
- The **unified κ-store** *is* the `CefResourceHandler`'s cache — `browser-sw.js` calls itself "the in-OS twin." Same store, same κ, same L5 verification; the native build swaps the SW seam for `CefResourceHandler` over the identical substrate.
- Streaming maps onto CEF's `CefResponseFilter` / `ReadResponse`.
So the proxy and the native build share the substrate, the verification, and the navigation model — only the byte source differs.

---

## 6. Out of scope this round (named, not hidden)

Require native CEF (origin fidelity): per-origin **cookie/session jar + auth**, **websockets**, the site's **own service worker**, true **cross-origin isolation**, JS `location.href=` to a cross-origin URL. Also owed regardless: a **production proxy** (the `/web` proxy is dev-only Node; static/prod needs an edge function or the import-to-κ path).

---

## 7. Sequence + verification (each proven live)

1. **U — unify store.** Smallest, enables dedup. Verify: a browser-minted resource is fetchable via `/.holo/blake3/<hex>`; a second site reusing the same lib hits cache (network-free).
2. **F — interceptor, drop rewrite.** Verify: served HTML byte-matches the origin (minus the `<base>`+script prefix); link clicks + a `pushState` SPA stay in-scope and κ-anchored.
3. **L — stream + keep-alive.** Verify: first-paint time drops measurably on a large page (compare time-to-first-render before/after); subresources reuse connections.

Done when a real content site renders byte-faithful, a re-used CDN library is served from the unified store without a network hit, and first paint is visibly faster — all on the one κ-substrate.
