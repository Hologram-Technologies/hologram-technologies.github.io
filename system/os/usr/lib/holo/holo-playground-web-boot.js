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
  function boot() {
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

    // the ONE gesture, in-page: a PROMINENT ✦ launcher pinned TOP-RIGHT of EVERY page the host injects into
    // (where a browser extension's icon lives — same mental model, zero native-chrome dependency, travels with
    // the page). It pops in, pulses twice to catch the eye, and expands to "Edit page" on hover. Tap it to ARM
    // Playground; the agent then shows its "right-click to edit · Esc to exit" badge and the launcher hides; on
    // exit it returns. Marked data-holo-ephemeral (style + button), so a snapshot never contains it (Law L5).
    let launcher = null;
    function mountLauncher() {
      if (launcher || !document.body) return;
      if (!document.getElementById("holo-pg-launch-css")) {
        const st = document.createElement("style"); st.id = "holo-pg-launch-css"; st.setAttribute("data-holo-ephemeral", "");
        st.textContent =
          "#holo-pg-launch{position:fixed;top:12px;right:14px;z-index:2147483550;display:flex;align-items:center;height:40px;width:40px;padding:0;overflow:hidden;" +
          "border-radius:999px;border:1px solid color-mix(in srgb,var(--holo-accent,#5b8cff) 75%,#ffffff22);color:#fff;cursor:pointer;" +
          "background:linear-gradient(135deg,color-mix(in srgb,var(--holo-accent,#5b8cff) 95%,#000),color-mix(in srgb,var(--holo-accent,#5b8cff) 60%,#1b1f2a));" +
          "box-shadow:0 6px 20px rgba(0,0,0,.45);font:600 13px/1 system-ui,-apple-system,Segoe UI,sans-serif;" +
          "animation:holo-pg-pop .45s cubic-bezier(.2,1.3,.5,1) both,holo-pg-glow 2s ease-in-out .8s 2}" +
          "#holo-pg-launch .i{flex:0 0 40px;display:grid;place-items:center;font-size:18px}" +
          "#holo-pg-launch .t{white-space:nowrap;opacity:0;transition:opacity .15s;padding-right:15px}" +
          "#holo-pg-launch:hover{width:128px}#holo-pg-launch:hover .t{opacity:1}" +
          "@keyframes holo-pg-pop{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}" +
          "@keyframes holo-pg-glow{0%,100%{box-shadow:0 6px 20px rgba(0,0,0,.45),0 0 0 0 color-mix(in srgb,var(--holo-accent,#5b8cff) 55%,transparent)}50%{box-shadow:0 6px 20px rgba(0,0,0,.45),0 0 0 9px color-mix(in srgb,var(--holo-accent,#5b8cff) 0%,transparent)}}" +
          "@media (prefers-reduced-motion:reduce){#holo-pg-launch{animation:holo-pg-pop .2s both}}";
        (document.head || document.documentElement).appendChild(st);
      }
      launcher = document.createElement("button");
      launcher.id = "holo-pg-launch"; launcher.setAttribute("data-holo-ephemeral", ""); launcher.type = "button";
      launcher.title = "Edit this page — move, hide, rewrite, edit code (Playground)";
      launcher.innerHTML = '<span class="i">✦</span><span class="t">Edit page</span>';
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
   } catch (e) { try { window.__holoPgBootError = String((e && e.stack) || e); } catch (_) {} }
  }
  // The host injects this at OnContextCreated — BEFORE the DOM exists (document.head/body are null), which is
  // why mounting immediately threw on appendChild. Defer until the document is parsed: then head/body exist and
  // the agent + the top-right ✦ launcher attach cleanly. (CSP-proof: host V8 exec, no external fetch.)
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
