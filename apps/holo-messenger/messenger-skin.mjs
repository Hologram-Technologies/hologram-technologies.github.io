// messenger-skin.mjs — bakes the SLACK re-tone as the messenger default (aubergine chrome + a floating,
// inset content pane; see the data-skin="slack" block in messenger-skins) and applies the hi-DPI /
// high-FPS perf layer. No picker / no toggle. Additive + guarded. Escape hatch: set localStorage
// "holo.skin" to graphite | warm | contrast | light (or "" to remove) to override the default.

(function () {
  if (!document.querySelector("link[data-holo-skins]")) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = new URL("./messenger-skins.css?v=d76d596376d1", import.meta.url); l.setAttribute("data-holo-skins", "1"); document.head.appendChild(l);
  }
  let skin = "whatsapp";
  try { const s = localStorage.getItem("holo.skin"); if (s) skin = s; } catch {}
  // ?skin=aim — the AIM opt-in for THIS visit (session-only; the saved default is untouched)
  try { const q = new URLSearchParams(location.search).get("skin"); if (q) skin = q; } catch {}
  if (skin) document.documentElement.setAttribute("data-skin", skin); else document.documentElement.removeAttribute("data-skin");
  // the AIM experience layer (buddy list · sign-on · away · door sounds, A0-A5) rides ONLY its own skin —
  // every other skin pays nothing. Lazy + fail-soft, the holo-msg-mount idiom.
  if (skin === "aim") { try { import("./holo-aim.mjs?v=aim1").catch(() => {}); } catch {} }
  // remove any lingering picker + its persisted flag from earlier ?skins=1 sessions
  try { localStorage.removeItem("holo.skins"); } catch {}
  try { const p = document.querySelector(".holo-skin-pick"); if (p) p.remove(); } catch {}
})();

// ── UX ENHANCER (whatsapp-ux-v1) — additive, guarded, DOM-only. Two WhatsApp-desktop niceties the compiled
//    bundle can't get surgically: (1) a DRAG-RESIZE divider between the chat list and the conversation, persisted
//    per device; (2) CLICK-AWAY / tap-outside close for the composer "+" attach sheet and the emoji popover (the
//    message + row menus already close on outside-click via the bundle; these two didn't). Everything here is
//    idempotent and fail-open — if the DOM shape ever changes, it simply does nothing.
(function () {
  const root = document.documentElement, LS_W = "holo.side.w";
  const MIN = 260, MAXPX = 560, MAXPCT = 0.46;
  const applyWidth = (px) => { if (px == null) root.style.removeProperty("--holo-side-w"); else root.style.setProperty("--holo-side-w", px + "px"); };
  // returning users reopen at their chosen width (set before first paint)
  try { const v = parseFloat(localStorage.getItem(LS_W)); if (v > 0) applyWidth(v); } catch {}

  const container = () => document.querySelector(".holo-wa-root .cs-main-container");
  const sidebar = () => document.querySelector(".holo-wa-root .cs-sidebar.cs-sidebar--left");

  function ensureHandle() {
    if (window.innerWidth < 900) return;                       // desktop only
    const c = container(); if (!c) return;
    if (c.querySelector(":scope > .holo-side-resize")) return; // already mounted
    const h = document.createElement("div");
    h.className = "holo-side-resize"; h.title = "Drag to resize, double-click to reset"; h.setAttribute("aria-hidden", "true");
    c.appendChild(h);
    let startX = 0, startW = 0, raf = 0, pending = 0;
    const maxW = () => Math.min(MAXPX, Math.round((c.clientWidth || window.innerWidth) * MAXPCT));
    const onMove = (e) => {
      pending = Math.max(MIN, Math.min(maxW(), startW + (e.clientX - startX)));
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; applyWidth(pending); });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.classList.remove("holo-side-dragging");
      h.classList.remove("holo-drag");
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      applyWidth(pending);
      try { localStorage.setItem(LS_W, String(pending)); } catch {}
    };
    h.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const sb = sidebar(); if (!sb) return;
      startX = e.clientX; startW = Math.round(sb.getBoundingClientRect().width); pending = startW;
      document.body.classList.add("holo-side-dragging"); h.classList.add("holo-drag");
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
    h.addEventListener("dblclick", (e) => { e.preventDefault(); applyWidth(null); try { localStorage.removeItem(LS_W); } catch {} });   // reset to default
  }

  const boot = () => {
    ensureHandle();
    try { new MutationObserver(() => ensureHandle()).observe(document.body, { childList: true, subtree: true }); } catch {}
    window.addEventListener("resize", ensureHandle, { passive: true });
  };
  if (document.body) boot(); else window.addEventListener("DOMContentLoaded", boot, { once: true });

  // (2) click-away close for the two composer popovers. They close cleanly through the app's OWN Escape handler,
  //     so dispatch Escape on an outside pointerdown. pointerdown fires BEFORE React's onClick, and skipping the
  //     composer icons (the triggers) avoids the toggle-reopen race.
  document.addEventListener("pointerdown", (e) => {
    const pop = document.querySelector(".holo-attach-menu, .holo-emoji-pop");
    if (!pop) return;                                              // nothing open
    if (pop.contains(e.target)) return;                            // clicked inside → keep open
    if (e.target.closest && e.target.closest(".holo-c-icon")) return;   // a composer trigger → let it toggle
    try { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); } catch {}
  }, true);
})();

// ── AUDITED E2E STACK (whatsapp-e2e-voz) — activate the additive vodozemac Olm/Megolm engine as an OPT-IN
//    (window.HoloMsg). Importing only DEFINES the door; the 393 KB crypto wasm + the spine load on FIRST USE,
//    so the default holo-seal door pays nothing and is entirely untouched. Nothing calls HoloMsg yet — this
//    just makes the audited Double-Ratchet engine LIVE-CAPABLE; the UI opt-in (?e2e=voz) is the next step.
try { import("./holo-msg-mount.mjs").catch(() => {}); } catch {}
