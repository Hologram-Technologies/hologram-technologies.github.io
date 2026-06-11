// holo-theme-launch.js — ONE drop-in that puts the Holo UI control surface on every
// holospace frame. It adds a small palette icon to the TOP-RIGHT row, docked immediately
// next to the Holo Stream icon (→ capture · stream · Holo UI · manage), and opens the
// canonical Holo UI surface (holo-ui.html) near full-screen — the single place to control
// the entire Hologram OS look & feel. Loaded by holo-manage.js (same universal presence).
// Exposes window.HoloUILaunch (window.HoloThemeLaunch kept as a back-compat alias).
(function () {
  "use strict";
  const W = window;
  if (W.HoloUILaunch) return;
  const loader = (location.pathname || "").toLowerCase();
  if (/(?:holo-ui|theme)\.html$/.test(loader)) return;     // don't launch the surface inside itself

  const me = document.currentScript || document.querySelector('script[src*="holo-theme-launch.js"]');
  const SHARED = me ? me.src.replace(/holo-theme-launch\.js.*$/, "") : "_shared/";
  const THEME_URL = SHARED.replace(/_shared\/$/, "") + "holo-ui.html";
  const ACCENT = "var(--holo-accent, #5b8cff)";

  const CSS = `
  #holo-themedash-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 auto;
    border-radius:8px;border:1px solid transparent;background:transparent;color:currentColor;cursor:pointer;opacity:.78;padding:0;
    transition:opacity .15s,border-color .15s,color .15s}
  #holo-themedash-btn:hover{opacity:1;border-color:${ACCENT};color:${ACCENT}}
  #holo-themedash-btn:focus-visible{outline:2px solid ${ACCENT};outline-offset:2px}
  #holo-themedash-btn svg{width:18px;height:18px;display:block}
  #holo-themedash-btn.float{position:fixed;top:8px;right:118px;z-index:2147482000;width:34px;height:34px;
    background:var(--holo-surface,#0d1117cc);border-color:var(--holo-border,#2a3340);color:var(--holo-ink-dim,#9fb0bd);
    backdrop-filter:blur(6px);box-shadow:0 4px 14px rgba(0,0,0,.4)}
  #holo-themedash-overlay{position:fixed;inset:0;z-index:2147483400;display:flex;align-items:center;justify-content:center;
    background:rgba(2,4,8,.62);backdrop-filter:blur(3px);opacity:0;transition:opacity .18s;padding:1.2vmin}
  #holo-themedash-overlay.in{opacity:1}
  #holo-themedash-overlay .panel{display:flex;flex-direction:column;width:min(1500px,97vw);height:min(96vh,1000px);
    background:var(--holo-bg,#0b0f15);border:1px solid var(--holo-border,#20262e);border-radius:16px;overflow:hidden;
    box-shadow:0 30px 90px rgba(0,0,0,.6);transform:scale(.985);opacity:.6;transition:transform .18s,opacity .18s}
  #holo-themedash-overlay.in .panel{transform:none;opacity:1}
  #holo-themedash-overlay .hd{flex:0 0 auto;display:flex;align-items:center;gap:10px;height:46px;padding:0 10px 0 14px;
    background:var(--holo-surface,#0d1117);border-bottom:1px solid var(--holo-border,#161c24);
    font:var(--holo-text-sm, 1rem) var(--holo-font-sans,ui-sans-serif),system-ui,sans-serif;color:var(--holo-ink,#e6edf3)}
  #holo-themedash-overlay .hd .ic{color:${ACCENT};display:inline-flex}
  #holo-themedash-overlay .hd .ic svg{width:18px;height:18px}
  #holo-themedash-overlay .hd .nm{font-weight:700;letter-spacing:.01em}
  #holo-themedash-overlay .hd .sub{color:var(--holo-ink-dim,#6e7681);font-size:var(--holo-text-sm,1rem)}
  #holo-themedash-overlay .hd .sp{margin-left:auto}
  #holo-themedash-overlay .hd .kbd{color:var(--holo-ink-dim,#8b949e);border:1px solid var(--holo-border,#28323d);border-radius:6px;padding:2px 7px;font:var(--holo-text-sm, 1rem) ui-monospace,monospace}
  #holo-themedash-overlay .hd .x{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;
    border:1px solid transparent;background:transparent;color:var(--holo-ink-dim,#9fb0bd);cursor:pointer;font:16px ui-sans-serif;line-height:1}
  #holo-themedash-overlay .hd .x:hover{border-color:#5c2222;color:#fca5a5;background:#1f0f0f}
  #holo-themedash-overlay iframe{flex:1 1 auto;width:100%;border:0;display:block;background:var(--holo-bg,#0b0f15)}
  @media (max-width:760px){#holo-themedash-overlay{padding:0}#holo-themedash-overlay .panel{width:100vw;height:100dvh;border-radius:0;border:0}#holo-themedash-overlay .hd .sub{display:none}#holo-themedash-btn{min-height:38px;min-width:38px}}
  @media (prefers-reduced-motion:reduce){#holo-themedash-overlay,#holo-themedash-overlay .panel{transition:none}#holo-themedash-overlay .panel{transform:none}}
  @media print{#holo-themedash-btn,#holo-themedash-overlay{display:none!important}}`;

  // a paint-palette glyph (distinct from manage/capture/stream)
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 1.8 1.8 0 0 0 1.6-2.7 1.8 1.8 0 0 1 1.6-2.7H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9.6z"/><circle cx="8.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10.5" r="1" fill="currentColor" stroke="none"/></svg>';

  let btnEl, overlayEl, lastFocus = null;
  function injectStyle() { if (document.getElementById("holo-themedash-css")) return; const s = document.createElement("style"); s.id = "holo-themedash-css"; s.textContent = CSS; document.head.appendChild(s); }

  function injectButton() {
    if (document.getElementById("holo-themedash-btn")) return;
    injectStyle();
    btnEl = document.createElement("button"); btnEl.id = "holo-themedash-btn"; btnEl.type = "button";
    btnEl.setAttribute("aria-label", "Open Holo UI"); btnEl.title = "Holo UI — control the whole OS look & feel";
    btnEl.setAttribute("aria-haspopup", "dialog"); btnEl.innerHTML = ICON;
    btnEl.addEventListener("click", toggle);
    dock();
    try { const host = () => document.getElementById("holo-stream-btn")?.parentElement || document.getElementById("holo-manage-btn")?.parentElement; const h = host(); if (h) { const mo = new MutationObserver(() => { if (!document.getElementById("holo-themedash-btn")) dock(); }); mo.observe(h, { childList: true }); } } catch {}
  }
  // place immediately next to the Holo Stream icon (→ capture · stream · theme · manage)
  function dock() {
    const stream = document.getElementById("holo-stream-btn");
    if (stream && stream.parentElement && !stream.classList.contains("float")) { stream.after(btnEl); return; }
    const cap = document.getElementById("holo-capture-btn");
    if (cap && cap.parentElement && !cap.classList.contains("float")) { cap.after(btnEl); return; }
    const manage = document.getElementById("holo-manage-btn");
    if (manage && manage.parentElement && !manage.classList.contains("float")) { manage.parentElement.insertBefore(btnEl, manage); return; }
    const bar = findBar();
    if (bar) bar.appendChild(btnEl); else { btnEl.classList.add("float"); document.body.appendChild(btnEl); }
  }
  function findBar() {
    for (const sel of ["#bar", "header", '[role="banner"]', "#topbar", ".titlebar", ".topbar", "#chrome", "#appbar"]) {
      const el = document.querySelector(sel); if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= Math.min(320, innerWidth * 0.5) && r.top <= 14 && r.height >= 16 && r.height <= 140) return el;
    }
    return null;
  }

  function open() {
    if (overlayEl) return; injectStyle(); lastFocus = document.activeElement;
    overlayEl = document.createElement("div"); overlayEl.id = "holo-themedash-overlay"; overlayEl.setAttribute("role", "dialog");
    overlayEl.setAttribute("aria-modal", "true"); overlayEl.setAttribute("aria-label", "Holo UI");
    overlayEl.innerHTML =
      `<div class="panel">
        <div class="hd">
          <span class="ic">${ICON}</span>
          <span class="nm">Holo UI</span>
          <span class="sub">· control the entire Hologram OS look &amp; feel</span>
          <span class="sp"></span>
          <span class="kbd">Esc</span>
          <button class="x" type="button" aria-label="Close" title="Close">✕</button>
        </div>
        <iframe title="Holo UI" allow="clipboard-read; clipboard-write" src="${THEME_URL}"></iframe>
      </div>`;
    overlayEl.addEventListener("click", (e) => { if (e.target === overlayEl) close(); });
    overlayEl.querySelector(".x").addEventListener("click", close);
    document.body.appendChild(overlayEl);
    requestAnimationFrame(() => { overlayEl.classList.add("in"); const x = overlayEl.querySelector(".x"); x && x.focus(); });
    document.addEventListener("keydown", onKey, true);
    if (btnEl) btnEl.setAttribute("aria-expanded", "true");
  }
  function close() {
    if (!overlayEl) return; document.removeEventListener("keydown", onKey, true);
    const el = overlayEl; overlayEl = null; el.classList.remove("in");
    let removed = false; const once = () => { if (removed) return; removed = true; el.remove(); };
    el.addEventListener("transitionend", once, { once: true }); setTimeout(once, 260);
    if (btnEl) btnEl.setAttribute("aria-expanded", "false");
    try { lastFocus && lastFocus.focus && lastFocus.focus(); } catch {}
  }
  const toggle = () => (overlayEl ? close() : open());
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }

  function boot() { injectButton(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  W.HoloUILaunch = { open, close, toggle, get button() { return btnEl; }, surfaceUrl: THEME_URL, dashboardUrl: THEME_URL };
  W.HoloThemeLaunch = W.HoloUILaunch;   // back-compat alias
})();
