// holo-stream-launch.js — ONE drop-in that puts Holo Stream on every holospace frame.
//
// It adds a small, self-descriptive "broadcast" icon to the TOP-RIGHT of the frame, docked
// immediately to the RIGHT of the Holo Capture camera icon (and left of the self-manage
// icon), and opens the FULLY FUNCTIONAL Holo Stream tool — OBS Studio, hologram-native — in a
// clean overlay: one click from any holospace to go live (screen + camera) or record. Self-
// contained (vanilla JS + CSS, no deps, no CDN); loaded automatically by holo-manage.js so it
// rides the same universal presence as the manage + capture icons. Exposes window.HoloStreamLaunch.
//
// Same design language as holo-capture-launch.js (a soft blurred backdrop, a precise panel
// that scales in, the real tool — stream.html — framed in an iframe granted display-capture +
// camera + microphone). Esc / backdrop / ✕ close. Reduced-motion + mobile aware.

(function () {
  "use strict";
  const W = window;
  if (W.HoloStreamLaunch) return;
  if (typeof document === "undefined") return;                       // browser only

  const loader = (location.pathname.split("/").pop() || "").toLowerCase();
  if (/stream\.html$/.test(loader)) return;                           // don't launch Stream inside Stream

  // stream.html lives at the OS root (beside apps/). Resolve it from the PAGE path so it works from
  // a root page, a nested packaged app (…/apps/<id>/), the κ-route, AND a Pages subpath.
  const ROOT = location.pathname.includes("/apps/") ? location.pathname.replace(/\/apps\/.*$/, "/") : location.pathname.replace(/[^/]*$/, "");
  const STREAM_URL = ROOT + "stream.html";
  const ACCENT = "#2dd4bf";

  const CSS = `
  #holo-stream-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 auto;
    border-radius:8px;border:1px solid transparent;background:transparent;color:currentColor;cursor:pointer;opacity:.78;padding:0;
    transition:opacity .15s,border-color .15s,color .15s}
  #holo-stream-btn:hover{opacity:1;border-color:${ACCENT};color:${ACCENT}}
  #holo-stream-btn:focus-visible{outline:2px solid ${ACCENT};outline-offset:2px}
  #holo-stream-btn svg{width:18px;height:18px;display:block}
  #holo-stream-btn.float{position:fixed;top:8px;right:82px;z-index:2147482000;width:34px;height:34px;background:#0d1117cc;
    border-color:#2a3340;color:#9fb0bd;backdrop-filter:blur(6px);box-shadow:0 4px 14px rgba(0,0,0,.4)}

  #holo-stream-overlay{position:fixed;inset:0;z-index:2147483400;display:flex;align-items:center;justify-content:center;
    padding:24px;background:rgba(3,6,10,.62);backdrop-filter:blur(10px) saturate(1.05);-webkit-backdrop-filter:blur(10px) saturate(1.05);
    opacity:0;transition:opacity .16s ease}
  #holo-stream-overlay.in{opacity:1}
  #holo-stream-overlay .panel{display:flex;flex-direction:column;width:min(1200px,95vw);height:min(88vh,880px);
    background:#0b0f15;border:1px solid #20262e;border-radius:16px;overflow:hidden;
    box-shadow:0 40px 120px rgba(0,0,0,.62),0 0 0 1px rgba(45,212,191,.06);
    transform:scale(.985) translateY(6px);opacity:.6;transition:transform .2s cubic-bezier(.2,.8,.2,1),opacity .2s ease}
  #holo-stream-overlay.in .panel{transform:none;opacity:1}
  #holo-stream-overlay .hd{flex:0 0 auto;display:flex;align-items:center;gap:10px;height:46px;padding:0 10px 0 14px;
    background:#0d1117;border-bottom:1px solid #161c24;font:var(--holo-text-sm, 1rem) ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e6edf3}
  #holo-stream-overlay .hd .ic{color:${ACCENT};display:inline-flex}
  #holo-stream-overlay .hd .ic svg{width:18px;height:18px}
  #holo-stream-overlay .hd .nm{font-weight:700;letter-spacing:.01em}
  #holo-stream-overlay .hd .sub{color:#6e7681;font-size:var(--holo-text-sm,1rem)}
  #holo-stream-overlay .hd .sp{margin-left:auto}
  #holo-stream-overlay .hd .kbd{color:#8b949e;border:1px solid #28323d;border-radius:6px;padding:2px 7px;font:var(--holo-text-sm, 1rem) ui-monospace,monospace;background:#0b0f15}
  #holo-stream-overlay .hd .x{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;
    border:1px solid transparent;background:transparent;color:#9fb0bd;cursor:pointer;font:16px ui-sans-serif;line-height:1}
  #holo-stream-overlay .hd .x:hover{border-color:#5c2222;color:#fca5a5;background:#1f0f0f}
  #holo-stream-overlay iframe{flex:1 1 auto;width:100%;border:0;display:block;background:#070b10}
  @media (max-width:640px){
    #holo-stream-overlay{padding:0}
    #holo-stream-overlay .panel{width:100vw;height:100dvh;border-radius:0;border:0}
    #holo-stream-overlay .hd .sub{display:none}
    #holo-stream-btn{min-height:38px;min-width:38px}
  }
  @media (prefers-reduced-motion:reduce){ #holo-stream-overlay,#holo-stream-overlay .panel{transition:none} #holo-stream-overlay .panel{transform:none} }
  @media print{#holo-stream-btn,#holo-stream-overlay{display:none!important}}`;

  // a "broadcast / live" glyph — a center dot with signal arcs (distinct from the camera)
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4"/><path d="M5 5a10 10 0 0 0 0 14M19 19a10 10 0 0 0 0-14"/></svg>';

  let btnEl, overlayEl, lastFocus = null;

  function injectStyle() { if (document.getElementById("holo-stream-css")) return; const s = document.createElement("style"); s.id = "holo-stream-css"; s.textContent = CSS; document.head.appendChild(s); }

  function injectButton() {
    if (document.getElementById("holo-stream-btn")) return;
    injectStyle();
    btnEl = document.createElement("button"); btnEl.id = "holo-stream-btn"; btnEl.type = "button";
    btnEl.setAttribute("aria-label", "Go live with Holo Stream"); btnEl.title = "Holo Stream — live screen + camera streaming (OBS)";
    btnEl.setAttribute("aria-haspopup", "dialog"); btnEl.innerHTML = ICON;
    btnEl.addEventListener("click", toggle);
    dock();
    // re-dock if the app rebuilds its bar, keeping the order capture → stream → manage
    try { const host = () => document.getElementById("holo-capture-btn")?.parentElement || document.getElementById("holo-manage-btn")?.parentElement; const h = host(); if (h) { const mo = new MutationObserver(() => { if (!document.getElementById("holo-stream-btn")) dock(); }); mo.observe(h, { childList: true }); } } catch {}
  }
  // place immediately to the RIGHT of the Holo Capture icon (→ capture · stream · manage)
  function dock() {
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
    overlayEl = document.createElement("div"); overlayEl.id = "holo-stream-overlay"; overlayEl.setAttribute("role", "dialog");
    overlayEl.setAttribute("aria-modal", "true"); overlayEl.setAttribute("aria-label", "Holo Stream");
    overlayEl.innerHTML =
      `<div class="panel">
        <div class="hd">
          <span class="ic">${ICON}</span>
          <span class="nm">Holo Stream</span>
          <span class="sub">· live screen &amp; camera streaming</span>
          <span class="sp"></span>
          <span class="kbd">Esc</span>
          <button class="x" type="button" aria-label="Close Holo Stream" title="Close">✕</button>
        </div>
        <iframe title="Holo Stream" allow="display-capture; camera; microphone; clipboard-read; clipboard-write; fullscreen"
          referrerpolicy="no-referrer" src="${STREAM_URL}"></iframe>
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

  W.HoloStreamLaunch = { open, close, toggle, get button() { return btnEl; }, streamUrl: STREAM_URL };
})();
