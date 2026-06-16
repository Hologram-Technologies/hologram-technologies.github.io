# Hologram Web Recorder — Spike B

The **zero-native-binary** companion extension: κ-anchor your *real* browsing. It attaches the real Chrome DevTools Protocol (`chrome.debugger`) to a tab, so the page runs at its **real origin in your real session** — cookies, login, passkeys, OAuth, WebSockets, the site's own service worker all work natively. The extension only **observes → mints → caches**:

- **Network** (`responseReceived`/`loadingFinished`) → reads each response body *after* load (doesn't block the render, so misses stream natively) and mints its **BLAKE3 κ** (the verified incremental hasher — the substrate σ-axis; κ values match Hologram OS exactly).
- **Fetch** (Request stage) → a GET you've already minted is served from the κ-store via `Fetch.fulfillRequest` — **O(1), zero network**, deduped across every site (L1 in-memory + L2 IndexedDB).

This is the in-browser twin of `browser-sw.js` / the CEF `CefResourceHandler`, proving the highest-fidelity zero-install path: **closest to CEF, arguably better on auth** (it inherits your real logged-in profile).

## Load it (Chrome / Brave / Edge)

1. `chrome://extensions` → toggle **Developer mode** (top-right).
2. **Load unpacked** → select this folder (`…/usr/share/holo-web-recorder`).
3. Pin the extension; click its icon → **Attach to this tab**. A *"… is debugging this browser"* banner appears (that's the real CDP — honest cost).

## Test the bar

- **Real auth:** attach, then log into a real account (passkey/OAuth and all) — it works, because it's your real browser at the real origin. The popup shows κ-objects minting as you browse.
- **O(1) re-access:** **reload the page.** Re-fetched resources serve from the κ-store (`x-holo-cache: L1`) at memory speed — watch *cache hits* climb and *served-from-κ* bytes rise with **0 network**. The popup shows median **cold → warm** time and the speedup.
- **Dedup:** visit a second site sharing a CDN library/font — *deduped* increments (one κ, served free).
- **Live protocols / SPAs:** a WebSocket app or a full SPA (Figma/Notion/Docs) runs natively — WS/WebRTC pass straight through (CDP `Fetch` is HTTP-only by design), the SPA's own service worker works.

## Honest caveats (Spike-level)

- **MV3 service-worker is ephemeral** — on long idle it can unload, dropping the in-memory L1/stats and the debugger session (L2 IndexedDB persists). Active browsing keeps it alive; if stats freeze, click **Detach → Attach**. (Hardening: persist `URLK` to `chrome.storage` + re-hydrate + a keep-alive.)
- **Serving a cache hit is buffered** (full body via `fulfillRequest`) — same as WebView2; it's O(1) because it's from the κ-store, not the network. Misses stream natively (we mint *after* load, off the render path).
- **Chromium only** (the `chrome.debugger`/CDP path). Firefox needs a different transport.
- Cross-store dedup with the OS substrate is conceptual here (matching κ values); a live bridge into `holo-kappa-v2` is future work.
