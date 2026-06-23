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

    // the ONE gesture, in-page: a tiny dormant ✦ launcher pinned to the corner of EVERY page the host injects
    // into (zero native chrome dependency — it travels with the page). Tap it to ARM Playground; the agent then
    // shows its own "right-click to edit · Esc to exit" badge and the launcher hides. On exit it returns. The
    // launcher is data-holo-ephemeral, so a snapshot never contains it (Law L5). prefers-reduced-motion safe.
    let launcher = null;
    function mountLauncher() {
      if (launcher || !document.body) return;
      launcher = document.createElement("button");
      launcher.id = "holo-pg-launch"; launcher.setAttribute("data-holo-ephemeral", ""); launcher.type = "button";
      launcher.textContent = "✦ Edit";
      launcher.title = "Edit this page — move, hide, rewrite anything (Playground)";
      launcher.style.cssText = "position:fixed;left:14px;bottom:14px;z-index:2147483550;padding:8px 13px;border-radius:999px;" +
        "border:1px solid color-mix(in srgb,var(--holo-accent,#5b8cff) 60%,transparent);background:color-mix(in srgb,var(--holo-accent,#5b8cff) 16%,rgba(20,22,27,.86));" +
        "color:#eef2f6;font:600 13px system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer;backdrop-filter:blur(8px);box-shadow:0 8px 24px rgba(0,0,0,.4);opacity:.82;transition:opacity .15s,transform .15s";
      launcher.onmouseenter = () => { launcher.style.opacity = "1"; launcher.style.transform = "translateY(-1px)"; };
      launcher.onmouseleave = () => { launcher.style.opacity = ".82"; launcher.style.transform = "none"; };
      launcher.onclick = () => { try { agent.setActive(true); } catch (e) {} syncLauncher(); };
      document.body.appendChild(launcher);
    }
    function syncLauncher() { if (launcher) { try { launcher.style.display = agent.isActive() ? "none" : ""; } catch (e) {} } }   // armed ⇒ the agent's badge owns the screen

    // HOST mode (commit DIRECTLY — no parent frame): the agent serialises ephemeral-stripped bytes and calls
    // host.commit, which seals the snapshot through the ONE primitive. No second sealer, no shadow copy.
    const agent = createPlaygroundAgent({
      doc: document, win: window, surfaceId,
      commit: (id, source) => host.commit(id, source),
      postUp: (msg) => { try { if (msg && msg.op === "playground-request" && !msg.on) syncLauncher(); } catch (e) {} },   // Esc / element-menu / badge exit → the launcher returns
    });
    agent.mount();
    window.__holoPlayground = agent;
    try { if (document.body) mountLauncher(); else window.addEventListener("DOMContentLoaded", mountLauncher, { once: true }); } catch (e) {}

    // the ONE gesture: the browser chrome / omnibar ✦ toggle calls this; nothing else changes for the page.
    window.HoloPlayground = {
      arm: (on) => { try { const r = agent.setActive(on === undefined ? !agent.isActive() : !!on); syncLauncher(); return r; } catch (e) { return false; } },
      isOn: () => { try { return agent.isActive(); } catch (e) { return false; } },
      host, holoUrl,
      lineage: () => host.lineage(),                                        // url→κ snapshot edges for this tab (out-of-band provenance)
      last: () => host.last(),
    };
  } catch (e) { /* a page that refuses injection simply isn't element-editable — honest, no crash */ }
})();
