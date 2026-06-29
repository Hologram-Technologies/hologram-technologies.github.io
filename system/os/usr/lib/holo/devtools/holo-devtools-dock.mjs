// holo-devtools-dock.mjs — the GLOBAL F12 DevTools dock (ADR-0095). "F12, just like Chrome", for the
// CURRENTLY ACTIVE tab — not the Create studio. It points the proven κ-CDP LIVE backend
// (holo-devtools-live-backend via window.HoloDevTools.installLive) at the active tab's same-origin
// holospace, then docks the vendored Chrome devtools-frontend on the right of the shell. So Elements
// shows the active tab's REAL DOM, Styles the REAL CSSOM, Console evaluates in the REAL page — every
// handle κ-aliased, edits re-sealed to a new κ via liveEdit (Law L2/L3). Opens on the canonical chord
// set (holo-devtools-keys.mjs): F12 / Ctrl+Shift+I toggle, +J console, +C inspect.
//
// Pure + dependency-injected (the Atlas-isomorphism discipline): the shell passes its own accessors
// (activeFrame · activeKappa · studioOpen); the witness passes mocks. Identical logic in both. A bare
// Node import (no document/window) is INERT — so importing the module for the witness has no side effect.

import { devToolsAction } from "./holo-devtools-keys.mjs";

// installGlobalDevDock(env) → { toggle(want?), isOpen() }.
//   env.doc / env.win   — DOM globals (default to the ambient document/window; injectable for tests).
//   env.activeFrame()   — the active tab's <iframe> (or null). Same-origin → readable live doc;
//                         cross-origin → contentDocument throws → null → backend falls back to scene.
//   env.activeKappa()   — the active tab's κ / address string (or null), shown in the dock title.
//   env.studioOpen()    — true when the Create studio owns its own (tested) Dev tab; then F12 defers
//                         to it (clicks #cs-tab-dev) instead of stacking a second surface.
//   env.src(nonce)      — the DevTools holospace URL (default the κ-bridge frontend, cache-busted).
export function installGlobalDevDock(env = {}) {
  const doc = env.doc || (typeof document !== "undefined" ? document : null);
  const win = env.win || (typeof window !== "undefined" ? window : null);
  const activeFrame = env.activeFrame || (() => null);
  const activeKappa = env.activeKappa || (() => null);
  const studioOpen = env.studioOpen || (() => false);
  const src = env.src || ((nonce) => "/_shared/devtools/holo-devtools.html?ws=holo-bridge#" + nonce);
  // No DOM ⇒ inert (Node import for the witness is side-effect-free).
  if (!doc || !win) return { toggle() {}, isOpen: () => false };

  let dock = null, frame = null, mounted = false, open = false, nonce = 0;

  // The live target the κ-CDP backend reflects: the active tab's same-origin document/window + its κ.
  function liveTarget() {
    let f = null; try { f = activeFrame(); } catch (e) {}
    let d = null, w = null;
    try { d = f && f.contentDocument; w = f && f.contentWindow; } catch (e) { d = null; w = null; }   // cross-origin → blocked
    let k = null; try { k = activeKappa(); } catch (e) {}
    return { doc: d, win: w, kappa: k };
  }

  // (Re)point window.HoloDevToolsServe at the LIVE backend over the current active tab. Mutations route
  // through liveEdit (re-seal → new κ); reads/eval fail-closed through the conscience (L4) the backend holds.
  function point() {
    try {
      const H = win.HoloDevTools;
      if (H && H.installLive) {
        win.HoloDevToolsServe = H.installLive({
          target: liveTarget,
          edit: (kappa, source) => {
            try { return (win.HoloLiveEdit && win.HoloLiveEdit.edit) ? win.HoloLiveEdit.edit(kappa, source) : null; }
            catch (e) { return null; }
          },
          conscience: win.HoloConscience || null,
        });
      }
    } catch (e) {}
  }

  function ensure() {
    if (dock) return;
    // The slide is a one-shot ENTRANCE keyframe (injected once). The RESTING open state has NO transform —
    // it just sits at right:0, so it can never get "stuck" translated off-screen (a transform-as-resting-
    // state hit a compositor quirk where the inline translateX(0) didn't paint). Closed = display:none.
    if (!doc.getElementById("holo-devdock-style")) {
      const st = doc.createElement("style"); st.id = "holo-devdock-style";
      st.textContent = "@keyframes holo-dock-in{from{transform:translateX(100%)}to{transform:translateX(0)}}";
      (doc.head || doc.documentElement).appendChild(st);
    }
    dock = doc.createElement("div");
    dock.id = "holo-devdock";
    // GOLDEN-RATIO width: page : devtools = φ : 1, so the dock takes 1/(1+φ) = 38.2% of the viewport
    // (the page keeps the golden major 61.8%). Docked hard to the right edge, pixel-crisp (no scaling).
    dock.style.cssText =
      "position:fixed;top:0;right:0;width:38.2vw;min-width:420px;max-width:1100px;height:100vh;" +
      "z-index:2147482000;background:#0b0d10;box-shadow:-8px 0 28px rgba(0,0,0,.55);" +
      "border-left:1px solid rgba(255,255,255,.08);display:none";
    const bar = doc.createElement("div");
    bar.style.cssText =
      "height:30px;display:flex;align-items:center;gap:8px;padding:0 10px;font:12px system-ui;" +
      "color:#9aa3b8;border-bottom:1px solid rgba(255,255,255,.06)";
    const title = doc.createElement("span");
    title.textContent = "Holo DevTools"; title.style.cssText = "font-weight:600;color:#cbd3e6";
    const kspan = doc.createElement("span");
    kspan.id = "holo-devdock-k";
    kspan.style.cssText = "flex:1;font:11px ui-monospace,monospace;color:#6b7488;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    const x = doc.createElement("button");
    x.textContent = "✕"; x.title = "Close (F12)";
    x.style.cssText = "all:unset;cursor:pointer;color:#9aa3b8;padding:2px 8px";
    x.onclick = () => toggle(false);
    bar.appendChild(title); bar.appendChild(kspan); bar.appendChild(x);
    frame = doc.createElement("iframe");
    frame.id = "holo-devdock-frame"; frame.title = "Holo DevTools";
    frame.setAttribute("allow", "clipboard-write");
    frame.style.cssText = "width:100%;height:calc(100vh - 30px);border:0;background:#0b0d10";
    dock.appendChild(bar); dock.appendChild(frame);
    doc.body.appendChild(dock);
  }

  function mount() {
    if (mounted) return;
    ensure();
    point();
    // Attach the load handler BEFORE setting src (a cached/instant load must not race the listener).
    // The DevTools frame's CDP must ride the holo-gov bus → register it as the DevTools app (κ path).
    frame.addEventListener("load", () => {
      try { if (win.HoloGov && frame.contentWindow) win.HoloGov.register(frame.contentWindow, { did: "did:holo:app:holo-devtools", id: "org.hologram.HoloDevTools", name: "Holo DevTools" }); }
      catch (e) {}
    }, { once: true });
    nonce = (win.Date && win.Date.now) ? win.Date.now() : (nonce + 1);
    frame.src = src(nonce);
    mounted = true;
  }

  function label() {
    try { const el = doc.getElementById("holo-devdock-k"); if (el) { const k = liveTarget().kappa; el.textContent = k ? String(k) : ""; } }
    catch (e) {}
  }

  function toggle(want) {
    // Defer to the Create studio's own tested Dev tab when it is open (avoid two inspector surfaces).
    try { if (studioOpen()) { const t = doc.getElementById("cs-tab-dev"); if (t) { t.click(); return; } } } catch (e) {}
    const show = (typeof want === "boolean") ? want : !open;
    if (show) {
      mount(); point(); label(); ensure();
      dock.style.display = "block";        // resting open state: visible at right:0, NO transform (can't stick)
      dock.style.animation = "holo-dock-in 220ms cubic-bezier(.16,.84,.44,1)";  // one-shot slide-in entrance
      open = true;
    } else if (dock) {
      dock.style.animation = "";
      dock.style.display = "none";
      open = false;
    }
  }

  function onKey(e) {
    let act = null; try { act = devToolsAction(e); } catch (x) {}
    if (!act) return;
    try { e.preventDefault(); e.stopPropagation(); } catch (x) {}
    toggle(act.action === "toggle" ? undefined : true);
  }
  win.addEventListener("keydown", onKey, true);

  const api = { toggle, isOpen: () => open, refresh: () => { point(); label(); }, _liveTarget: liveTarget };
  try { win.HoloDevDock = api; } catch (e) {}
  return api;
}

export default { installGlobalDevDock };
