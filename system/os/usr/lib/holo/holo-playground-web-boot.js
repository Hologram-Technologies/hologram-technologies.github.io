// holo-playground-web-boot.js — the IN-PAGE bootstrap for REAL web tabs in the native browser.
//
// The CEF host injects this (data-holo-ephemeral) into every top-level document it renders — real web, IPFS,
// κ-app. Unlike holo-playground-app.js (same-origin app frames that post UP to the shell), a real tab is the
// TOP document with no parent shell, so the agent commits DIRECTLY to the native-tab snapshot host: an element
// edit on any page mints a SNAPSHOT κ you own. Dormant by default — one gesture (the browser-chrome ✦ toggle,
// or window.HoloPlayground.arm(true)) arms it for this tab. Marked ephemeral so the sealed κ never contains
// this injector (Law L5).

import { createPlaygroundAgent } from "./holo-playground-agent.mjs";
import { createWebPlaygroundHost, holoUrl, shortK } from "./holo-playground-web.mjs";
import { sha256hex } from "./holo-uor.mjs";                                  // the σ-axis content addresser (sync, pure JS)

(function () {
  try {
    if (window.__holoPlayground) return;

    // durable pin (best-effort, OFF the content-address path): hand the snapshot bytes to the κ-store if one
    // is present (HoloRender.stash auto-persists). A missing/failing store never blocks the edit — the κ is
    // still re-derivable from the bytes, and the share link carries the bytes inline.
    const pin = (source) => { try { return window.HoloRender && window.HoloRender.stash ? window.HoloRender.stash(source) : null; } catch (e) { return null; } };

    const host = createWebPlaygroundHost({
      hash: (s) => sha256hex(s),                                            // snapshot κ = σ-axis content address of the serialised bytes
      urlOf: () => { try { return location.href; } catch (e) { return ""; } },
      pin,
      onSnapshot: (s) => { try { const a = window.__holoPlayground; if (a && a.__toast) a.__toast("✦ snapshot · κ " + shortK(s.kappa) + " — yours to share"); } catch (e) {} },
    });

    const surfaceId = (function () { try { return "tab:" + location.href; } catch (e) { return "tab"; } })();
    host.register(surfaceId);

    // HOST mode (commit DIRECTLY — no parent frame): the agent serialises ephemeral-stripped bytes and calls
    // host.commit, which seals the snapshot through the ONE primitive. No second sealer, no shadow copy.
    const agent = createPlaygroundAgent({
      doc: document, win: window, surfaceId,
      commit: (id, source) => host.commit(id, source),
    });
    agent.mount();
    window.__holoPlayground = agent;

    // the ONE gesture: the browser chrome / omnibar ✦ toggle calls this; nothing else changes for the page.
    window.HoloPlayground = {
      arm: (on) => { try { return agent.setActive(on === undefined ? !agent.isActive() : !!on); } catch (e) { return false; } },
      isOn: () => { try { return agent.isActive(); } catch (e) { return false; } },
      host, holoUrl,
      lineage: () => host.lineage(),                                        // url→κ snapshot edges for this tab (out-of-band provenance)
      last: () => host.last(),
    };
  } catch (e) { /* a page that refuses injection simply isn't element-editable — honest, no crash */ }
})();
