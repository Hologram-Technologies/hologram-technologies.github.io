# Native κ-anchored Chromium for Hologram (CEF / WebView2 endgame)

Status: spec (the deferred endgame; the web-build proxy in [holo-browser-fidelity-and-latency.md](holo-browser-fidelity-and-latency.md) composes toward this — `browser-sw.js` is its in-OS twin). Native (Tauri) build only.

## Vision

Make the *entire* Hologram experience streamable and real-time rendered: every byte the system shows — a live website, a logged-in SPA, an IPFS file, a κ-app, an OS object — is a **streamable κ-addressable object** flowing through one verified substrate. The web doesn't just *render* in Hologram; it *lives* there — logged-in, real-time, process-isolated, full-fidelity, every resource re-derived to a κ and cached O(1). Lean on Hologram's content-addressed **O(1) L1/L2 compute**: anything seen once is a hash-lookup away forever, deduped across every site, app, and object.

Build the native desktop (Tauri) path: real, process-isolated Chromium (WebView2 on Windows — already Chromium and already in the host; CEF for cross-platform parity) loading **real origins**, with the κ-store wired in as the network resource handler. Reuse the substrate, verification, navigation model, and incremental hasher; swap only the byte source.

## ⚠️ Crux de-risked (verified against Microsoft + Tauri docs, June 2026)

**Question:** can the Tauri host intercept WebView2 network requests via `webview2-com`'s `WebResourceRequested` and serve from the κ-store, streamed?

**Verdict: YES it's interceptable, BUT it is *buffered, not streamed*, and it misses service-worker + WebSocket traffic.** This reshapes the design — WebView2's hook gives the **O(1) κ-cache** for free but NOT true progressive streaming or total coverage. True streaming + full coverage = **CEF** (or a local TLS proxy), not the WebView2 hook.

Verified facts:
- ✅ **Raw `ICoreWebView2` is reachable from Tauri v2** — `webview.with_webview(|wv| … wv.controller())` on Windows returns the `ICoreWebView2Controller` (`webview2-com` / `webview2_com::Microsoft::Web::WebView2::Win32::*`), → `CoreWebView2()`.
- ✅ **Interception works incl. the top-level Document** — `AddWebResourceRequestedFilter("*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)` + `add_WebResourceRequested`; the official Learn example filters `…_CONTEXT_DOCUMENT`. (Caveat to test: `Document` filter has a known bug for *secondary* webviews in the *same process* — WebView2Feedback #4689 — so per-tab content webviews may need separate environments, which we want anyway for isolation.)
- ✅ **Custom response = `Environment.CreateWebResourceResponse(IStream, status, reason, headers)` + `args.put_Response(...)`.** A **cache HIT serves an in-memory `IStream` instantly → this IS the O(1) win** (no streaming needed; it's already local). On a MISS you `GetDeferral()`, fetch+mint on a bg thread, set the response, complete.
- ❌ **No progressive streaming** — WebView2Feedback #3519 (open, unresolved, MS-assigned): the response "is buffered and becomes available to the client all-at-once"; `CreateWebResourceResponse` needs the **complete body before the deferral completes**. So the "first-paint on first chunk" benefit is lost *for resources you intercept-and-override*.
- ❌ **Service-worker fetches don't fire** `WebResourceRequested` (#1114) and **WebSockets don't fire** it (#4303) → SW-driven SPAs and live WS traffic pass through **un-anchored**.

**Design consequence (update the heart below accordingly):**
- WebView2 path = **O(1) content-addressed cache + dedup + provenance** for most resources (hits are instant). For first-sighting of LARGE media, *don't* override — let WebView2 fetch+stream natively and κ-mint afterward via `WebResourceResponseReceived` (`GetContent`), preserving native streaming.
- **True progressive streaming + SW/WS coverage = CEF** (`CefResourceHandler::ReadResponse` genuinely streams) or a local TLS-terminating proxy the webview points at. So CEF moves from "phase-2 parity" to "the vehicle for the streaming-everything + every-byte-anchored maximal vision." The WebView2 spike is still the right Phase 1 — it proves the κ-store/O(1)/isolation seam — but label its streaming/coverage limits honestly.

Sources: [WebResourceRequested how-to](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webresourcerequested) · [Tauri Webview docs](https://docs.rs/tauri/latest/tauri/webview/struct.Webview.html) · [#3519 streaming](https://github.com/MicrosoftEdge/WebView2Feedback/issues/3519) · [#1114 SW](https://github.com/MicrosoftEdge/WebView2Feedback/issues/1114) · [#4303 WebSockets](https://github.com/MicrosoftEdge/WebView2Feedback/issues/4303) · [#4689 secondary-webview Document](https://github.com/MicrosoftEdge/WebView2Feedback/issues/4689).

## The heart: the κ-resource-handler

Wire the unified κ-store into Chromium's network layer so every resource passes through it, transparently, with **no page rewriting** (real origin = full fidelity).

- **WebView2 (Windows, first target):** intercept `CoreWebView2.WebResourceRequested` (filter `http*`/`https*`/all). Per request: check the κ-cache (L1→L2); on hit, fulfil with a `CoreWebView2WebResourceResponse` streamed from the cached κ-object (O(1), no network); on miss, fetch the real origin, **stream** the response to the page via an `IStream` while minting its κ incrementally, then store. Register `holo://` and `ipfs://` as custom URI schemes (`CustomSchemeRegistrations`) handled by the resolvers.
- **CEF (cross-platform parity, phase 2):** the same seam via `CefSchemeHandlerFactory` + `CefResourceHandler` (open/read/skip streaming) and `CefResponseFilter`. The literal native twin of [browser-sw.js](system/os/lib/browser-sw.js) (`serveWeb`/`serveSub`/`handleExternal`).
- **No origin collapse:** the webview navigates the real URL, so cookies, sessions, storage, CSP, CORS, and the site's own SW behave as the real origin. Per-tab/per-origin process isolation.

## O(1) L1/L2 compute — the responsiveness engine

Reuse the substrate's content-addressed cache as the hot path. Mirror the web seam's tiers exactly:
- **L1** — in-memory hot map (κ → bytes), no async, ~1 ms hits (web build measured 76 ms→1.1 ms; aim equal/better native).
- **L2** — the durable unified κ-store (same substrate the OS uses, blake3 σ-axis), shared so a JS lib/font/image byte-identical across any site **or app** is one κ, fetched once, served free everywhere (cross-process dedup).
- Mint incrementally with the verified `createBlake3()` ([holo-blake3.mjs](system/os/usr/lib/holo/holo-blake3.mjs)) — hash as bytes stream, no tail pass.
- Re-access (revisit, shared chunk, back/forward) must be a κ lookup, never a re-fetch. Back/forward and same-site nav feel instant.

## Streaming everywhere — real-time render

Every served object streams: enqueue bytes to the renderer as they arrive (first paint on first chunk), minting in parallel, finalizing the κ at the tail (first-sighting IS the mint — L5 honest; revisits serve the verified cache). Generalize the "streamable κ-object" as the ONE delivery primitive OS-wide — web resources, IPFS DAG leaves ([holo-ipfs-gateway.mjs](system/os/sbin/holo-ipfs-gateway.mjs) `streamUnixFsFile`), κ-apps, OS objects all stream through the same path.

## What real-origin fidelity unlocks (must all work)

- **Identity/state:** cookies, sessions, OAuth/SSO, passkeys/WebAuthn, per-origin isolated storage — log in as you.
- **Live protocols:** WebSockets + WebRTC pass through (κ-logged as provenance, not rewritten) → chat, calls, dashboards, multiplayer, streaming.
- **Full SPAs** (Figma, Notion, Docs, Linear) at their real origin with their own SW.
- **Real MV3 extensions** in real isolated worlds, reusing the κ-verified model from [holo-crx.js](system/os/usr/lib/holo/holo-crx.js)/[holo-ext.js](system/os/usr/lib/holo/holo-ext.js).
- **Real Chrome DevTools (CDP)** on any site — wire to the existing native WebView2 `--remote-debugging-port` CDP path (Holo DevTools real-CDP work).

## The web as κ-objects you own

Every resource re-derived + stored → **offline replay** of anything seen; **share a sealed snapshot of any page by κ**; a **provenance log** of real web traffic (PROV-O receipts, governed-egress sealed); cross-everything dedup. Stable κ-*names* stay for immutable things (IPFS, κ-apps, sealed objects); the live web mints **snapshot κs** (each load a faithful, re-derivable record) while the URL stays the live entry point — be precise about this in the UI and receipts.

## Shell / omnibar integration

One bar, one experience. Route the omnibar's web lane ([shell.html](system/os/usr/share/frame/shell.html) `openHoloBrowser`) to a **native webview tab** on the Tauri host (fall back to the `browser-sw.js` proxy in the pure-web build — same address bar, same κ-card siblings for ENS/IPFS/web3). Native webview tabs are first-class κ-anchored holospace windows beside κ-apps. Address bar, back/forward (instant from L1/L2), reload, κ/verify HUD all driven by the handler's commit events (reuse `NavigationController`/`broadcast` from [holo-browser.js](system/os/usr/lib/holo/holo-browser.js)).

## Constraints

- **Native (Tauri) build only**; the web build keeps the proxy. Share substrate, verification (Law L5 re-derivation on admission), navigation model across both — `browser-sw.js` ↔ native handler are twins, no forked logic.
- Holospaces Laws L1–L5 + W3C interop; governed egress (default-deny per-host, sealed `hosc:Egress` receipts) for real-origin fetches; read-only by default, value-moves via the wallet bridge with human approval.
- **Reuse before building:** κ-store, `createBlake3`, L1/L2 + URL→κ memo, IPFS/web3 resolvers, CDP backend, extension model, omnibar all exist — wire them.
- Honest failure: a byte that doesn't re-derive is refused, never laundered; live/dynamic content labeled snapshot, not a stable name.

## Deliverables

(a) Architecture map: native handler seam (WebView2 now, CEF next) ↔ unified κ-store ↔ `browser-sw.js` twin, exact reuse points + net-new (the handler + scheme registrations + per-tab webview lifecycle). (b) The native κ-resource-handler + `holo://`/`ipfs://` scheme handlers, streaming, L1/L2 O(1), incremental mint, governed egress + receipts. (c) Per-tab process-isolated real-origin webviews as holospace windows, omnibar-wired (address bar + instant back/forward + κ HUD). (d) Snapshot-by-κ (seal/share/offline-replay) + provenance log. (e) Real CDP/DevTools on any tab. (f) A testable build: log into a real account, run a full SPA, make a video/WebSocket call, browse an IPFS site and a κ-app in the SAME window; measure cold-vs-warm (prove O(1)) and first-paint streaming on a heavy page.

## Phasing (prove the core before the breadth)

1. **Spike the seam:** one WebView2 tab loading one real origin through the κ-resource-handler, L1/L2 cache, streamed, with a sealed receipt — measure cold vs warm.
2. **Fidelity:** cookies/auth/storage isolation + a real login + a full SPA + WebSocket.
3. **Schemes + unification:** `holo://`/`ipfs://` handlers, omnibar routing, native tabs beside κ-apps.
4. **Ownership:** snapshot-by-κ, offline replay, provenance; CDP/DevTools; extensions.
5. **Cross-platform:** the CEF handler for parity; converge the twin with `browser-sw.js`.

**The bar:** a real, logged-in, real-time web — Gmail, a video call, a live dashboard, Figma — running natively in a Hologram holospace, every byte streamed and anchored in your κ-substrate, re-access at memory speed, fully isolated, indistinguishable from a native browser except that you own and can re-derive everything you saw.
