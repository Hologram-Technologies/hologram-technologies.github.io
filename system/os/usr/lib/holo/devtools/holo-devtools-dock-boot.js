// holo-devtools-dock-boot.js — the IN-PAGE bootstrap that gives EVERY native tab a right-docked,
// golden-width Holo DevTools (ADR-0095), the same way holo-playground-web-boot.js gives every tab the
// Playground. The CEF host injects this (data-holo-ephemeral) into every top-level holo:// document.
//
// WHY this exists: a native app tab is a TOP document (holo://<κ>/), an isolated κ-holospace with no
// shell parent — so the shell's holo-gov bus can't route the inspector's CDP. CEF's Chrome runtime also
// refuses to dock the real Chromium DevTools into the host's window (it always detaches). So we dock the
// REAL vendored Chrome devtools-frontend OURSELVES, in-page: a right-sliding panel (golden-ratio width)
// whose iframe is the κ-served frontend, driven by the κ-CDP LIVE backend over THIS page's own document.
// Elements shows the tab's REAL κ-DOM, Styles the REAL CSSOM, Console evaluates in the REAL page — every
// handle κ-aliased, reads re-derive (Law L5). The frontend's CDP is answered HERE (this script plays the
// holo-gov role locally), so it is fully self-contained per tab — no shell, no WebSocket, low latency.
//
// Marked ephemeral so the sealed κ never contains this injector (Law L5). Imports resolve cross-origin
// from holo://os (the host grants scoped ACAO for the devtools graph, exactly like the playground graph).

import { installGlobalDevDock } from "./holo-devtools-dock.mjs";
import "./holo-devtools-ui.js";   // browser auto-install: window.HoloDevTools (installLive) + HoloLens

(function () {
  function boot() {
    try {
      if (window.__holoDevDockBoot) return;
      // The shell (holo://os/shell.html) installs its own dock + holo-gov bus — don't double-install there.
      if (window.HoloDevDock || window.HoloGov) return;
      window.__holoDevDockBoot = true;

      // ── play the holo-gov role locally: answer the DevTools iframe's CDP frames ──────────────────────
      // The κ-served frontend (holo-devtools.html?ws=holo-bridge), when embedded, posts every CDP frame to
      // its parent as { type:"holo-privacy:rpc", method:"cdp", args:{cdp}, id } and awaits a matching
      // { type:"holo-privacy:res", id, result, error } (+ streamed { type:"holo-privacy:delta", id, delta }).
      // We answer with window.HoloDevToolsServe — the LIVE κ-CDP backend the dock points at THIS document.
      window.addEventListener("message", function (e) {
        var d = e.data;
        if (!d || d.type !== "holo-privacy:rpc" || d.method !== "cdp") return;
        var src = e.source;
        var post = function (msg) { try { if (src) src.postMessage(msg, "*"); } catch (x) {} };
        var serve = window.HoloDevToolsServe;
        if (typeof serve !== "function") { post({ type: "holo-privacy:res", id: d.id, result: null, error: "no devtools backend" }); return; }
        var onDelta = function (evt) { post({ type: "holo-privacy:delta", id: d.id, delta: evt }); };
        Promise.resolve()
          .then(function () { return serve({ app: "holo-devtools-local", method: "cdp", args: d.args || {}, onEvent: onDelta }); })
          .then(function (out) { post({ type: "holo-privacy:res", id: d.id, result: (out && out.result != null) ? out.result : null, error: (out && out.error) || null }); })
          .catch(function (err) { post({ type: "holo-privacy:res", id: d.id, result: null, error: String((err && err.message) || err) }); });
      });

      // ── install the right-slide golden dock, pointed at THIS tab's live κ-holospace ──────────────────
      // activeFrame() returns a frame-shaped view onto the page itself so the LIVE backend reflects this
      // document directly (same-origin to itself; no cross-origin read). The OnKeyEvent in the host routes
      // F12 here (window.HoloDevDock.toggle) so Chrome's own F12 never steals it.
      var selfFrame = { get contentDocument() { return document; }, get contentWindow() { return window; } };
      installGlobalDevDock({
        activeFrame: function () { return selfFrame; },
        activeKappa: function () { try { return location.protocol === "holo:" ? ("holo://" + location.host) : location.href; } catch (e) { return null; } },
        studioOpen: function () { return false; },
        // ABSOLUTE holo://os src: the frontend + its 5127 vendored files live under holo://os, not under
        // this app's κ-origin. A relative "/_shared/…" would resolve to holo://<κ>/ and 404. The iframe is
        // then cross-origin (holo://os) and posts its CDP to us (parent) via postMessage — answered above.
        src: function (nonce) { return "holo://os/_shared/devtools/holo-devtools.html?ws=holo-bridge#" + nonce; },
      });
    } catch (e) { /* additive — never break the page */ }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
