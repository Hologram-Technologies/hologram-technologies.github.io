// holo-capture-launch.js — ONE drop-in that puts Holo Capture on every holospace frame.
//
// It adds a small, self-descriptive camera icon to the TOP-RIGHT of the frame (docked into
// the app's own bar, right beside the self-manage icon), and opens the FULLY FUNCTIONAL
// Holo Capture tool in a clean overlay — one click from any holospace to capture, annotate
// and share. Self-contained (vanilla JS + CSS, no deps, no CDN); loaded automatically by
// holo-manage.js so it rides the same universal presence. Exposes window.HoloCaptureLaunch.
//
// Design: intuitive (a camera = "screenshot"), beautiful (a soft, blurred backdrop and a
// precise panel that scales in), and clean (the overlay just frames the real tool —
// capture.html — in an iframe granted display-capture + clipboard, so nothing is reimplemented
// and the tool stays whole). Esc / backdrop / ✕ close it. Respects reduced-motion + mobile.

(function () {
  "use strict";
  const W = window;
  if (W.HoloCaptureLaunch) return;
  if (typeof document === "undefined") return;                       // browser only

  const loader = (location.pathname.split("/").pop() || "").toLowerCase();
  if (/capture\.html$/.test(loader)) return;                          // don't launch Capture inside Capture

  // Resolve the real URLs from THIS script's own location, so it works from a root page
  // (…/web/) and from a packaged app (…/web/apps/<id>/, which loads via ../_shared/).
  // capture.html lives at the OS root (beside apps/). Resolve it from the PAGE path so it works from
  // a root page, a nested packaged app (…/apps/<id>/), the κ-route, AND a Pages subpath.
  const ROOT = location.pathname.includes("/apps/") ? location.pathname.replace(/\/apps\/.*$/, "/") : location.pathname.replace(/[^/]*$/, "");
  const CAPTURE_URL = ROOT + "capture.html";
  const ACCENT = "#2dd4bf";

  // ── styles ────────────────────────────────────────────────────────────────────────
  const CSS = `
  #holo-capture-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 auto;
    border-radius:8px;border:1px solid transparent;background:transparent;color:currentColor;cursor:pointer;opacity:.78;padding:0;
    transition:opacity .15s,border-color .15s,color .15s}
  #holo-capture-btn:hover{opacity:1;border-color:${ACCENT};color:${ACCENT}}
  #holo-capture-btn:focus-visible{outline:2px solid ${ACCENT};outline-offset:2px}
  #holo-capture-btn svg{width:18px;height:18px;display:block}
  #holo-capture-btn.float{position:fixed;top:8px;right:46px;z-index:2147482000;width:34px;height:34px;background:#0d1117cc;
    border-color:#2a3340;color:#9fb0bd;backdrop-filter:blur(6px);box-shadow:0 4px 14px rgba(0,0,0,.4)}

  #holo-capture-overlay{position:fixed;inset:0;z-index:2147483400;display:flex;align-items:center;justify-content:center;
    padding:24px;background:rgba(3,6,10,.62);backdrop-filter:blur(10px) saturate(1.05);-webkit-backdrop-filter:blur(10px) saturate(1.05);
    opacity:0;transition:opacity .16s ease}
  #holo-capture-overlay.in{opacity:1}
  #holo-capture-overlay .panel{display:flex;flex-direction:column;width:min(1180px,95vw);height:min(88vh,860px);
    background:#0b0f15;border:1px solid #20262e;border-radius:16px;overflow:hidden;
    box-shadow:0 40px 120px rgba(0,0,0,.62),0 0 0 1px rgba(45,212,191,.06);
    transform:scale(.985) translateY(6px);opacity:.6;transition:transform .2s cubic-bezier(.2,.8,.2,1),opacity .2s ease}
  #holo-capture-overlay.in .panel{transform:none;opacity:1}
  #holo-capture-overlay .hd{flex:0 0 auto;display:flex;align-items:center;gap:10px;height:46px;padding:0 10px 0 14px;
    background:#0d1117;border-bottom:1px solid #161c24;font:var(--holo-text-sm, 1rem) ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e6edf3}
  #holo-capture-overlay .hd .ic{color:${ACCENT};display:inline-flex}
  #holo-capture-overlay .hd .ic svg{width:18px;height:18px}
  #holo-capture-overlay .hd .nm{font-weight:700;letter-spacing:.01em}
  #holo-capture-overlay .hd .sub{color:#6e7681;font-size:var(--holo-text-sm,1rem)}
  #holo-capture-overlay .hd .sp{margin-left:auto}
  #holo-capture-overlay .hd .kbd{color:#8b949e;border:1px solid #28323d;border-radius:6px;padding:2px 7px;font:var(--holo-text-sm, 1rem) ui-monospace,monospace;background:#0b0f15}
  #holo-capture-overlay .hd .x{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;
    border:1px solid transparent;background:transparent;color:#9fb0bd;cursor:pointer;font:16px ui-sans-serif;line-height:1}
  #holo-capture-overlay .hd .x:hover{border-color:#5c2222;color:#fca5a5;background:#1f0f0f}
  #holo-capture-overlay iframe{flex:1 1 auto;width:100%;border:0;display:block;background:#05070a}
  @media (max-width:640px){
    #holo-capture-overlay{padding:0}
    #holo-capture-overlay .panel{width:100vw;height:100dvh;border-radius:0;border:0}
    #holo-capture-overlay .hd .sub{display:none}
    #holo-capture-btn{min-height:38px;min-width:38px}
  }
  @media (prefers-reduced-motion:reduce){
    #holo-capture-overlay,#holo-capture-overlay .panel{transition:none}
    #holo-capture-overlay .panel{transform:none}
  }
  @media print{#holo-capture-btn,#holo-capture-overlay{display:none!important}}`;

  // a clean camera glyph (screenshot) with a subtle region tick — universally legible
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="12.5" rx="2.6"/><path d="M8.2 7l1.4-2.2h4.8L15.8 7"/><circle cx="12" cy="13.2" r="3.2"/></svg>';

  let btnEl, overlayEl, lastFocus = null;

  function injectStyle() { if (document.getElementById("holo-capture-css")) return; const s = document.createElement("style"); s.id = "holo-capture-css"; s.textContent = CSS; document.head.appendChild(s); }

  // ── the camera button — dock beside the self-manage icon, else into the bar, else float ─
  function injectButton() {
    if (document.getElementById("holo-capture-btn")) return;
    injectStyle();
    btnEl = document.createElement("button"); btnEl.id = "holo-capture-btn"; btnEl.type = "button";
    btnEl.setAttribute("aria-label", "Capture screen with Holo Capture"); btnEl.title = "Capture screen — annotate & share (Holo Capture)";
    btnEl.setAttribute("aria-haspopup", "dialog"); btnEl.innerHTML = ICON;
    btnEl.addEventListener("click", toggle);

    const manage = document.getElementById("holo-manage-btn");
    if (manage && manage.parentElement && !manage.classList.contains("float")) {
      manage.parentElement.insertBefore(btnEl, manage);                // sit just left of Manage
    } else {
      const bar = findBar();
      if (bar) bar.appendChild(btnEl);
      else { btnEl.classList.add("float"); document.body.appendChild(btnEl); }
    }
    // re-dock if the app rebuilds its bar
    try { const host = btnEl.parentElement; if (host) { const mo = new MutationObserver(() => { if (!document.getElementById("holo-capture-btn")) { const m2 = document.getElementById("holo-manage-btn"); (m2 && m2.parentElement ? m2.parentElement.insertBefore(btnEl, m2) : (host.appendChild ? host.appendChild(btnEl) : 0)); } }); mo.observe(host, { childList: true }); } } catch {}
  }
  function findBar() {
    for (const sel of ["#bar", "header", '[role="banner"]', "#topbar", ".titlebar", ".topbar", "#chrome", "#appbar"]) {
      const el = document.querySelector(sel); if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= Math.min(320, innerWidth * 0.5) && r.top <= 14 && r.height >= 16 && r.height <= 140) return el;
    }
    return null;
  }

  // ── the overlay — frame the real tool (capture.html) in an iframe ───────────────────
  function open() {
    if (overlayEl) return;
    injectStyle();
    lastFocus = document.activeElement;
    overlayEl = document.createElement("div"); overlayEl.id = "holo-capture-overlay"; overlayEl.setAttribute("role", "dialog");
    overlayEl.setAttribute("aria-modal", "true"); overlayEl.setAttribute("aria-label", "Holo Capture");
    overlayEl.innerHTML =
      `<div class="panel">
        <div class="hd">
          <span class="ic">${ICON}</span>
          <span class="nm">Holo Capture</span>
          <span class="sub">· screenshot &amp; annotate</span>
          <span class="sp"></span>
          <span class="kbd">Esc</span>
          <button class="x" type="button" aria-label="Close Holo Capture" title="Close">✕</button>
        </div>
        <iframe title="Holo Capture" allow="display-capture; clipboard-read; clipboard-write; fullscreen"
          referrerpolicy="no-referrer" src="${CAPTURE_URL}"></iframe>
      </div>`;
    overlayEl.addEventListener("click", (e) => { if (e.target === overlayEl) close(); });   // backdrop
    overlayEl.querySelector(".x").addEventListener("click", close);
    document.body.appendChild(overlayEl);
    // animate in + focus the close button (accessible, and Esc works immediately)
    requestAnimationFrame(() => { overlayEl.classList.add("in"); const x = overlayEl.querySelector(".x"); x && x.focus(); });
    document.addEventListener("keydown", onKey, true);
    if (btnEl) btnEl.setAttribute("aria-expanded", "true");
  }
  function close() {
    if (!overlayEl) return;
    document.removeEventListener("keydown", onKey, true);
    const el = overlayEl; overlayEl = null; el.classList.remove("in");
    const done = () => { el.remove(); };
    let removed = false; const once = () => { if (removed) return; removed = true; done(); };
    el.addEventListener("transitionend", once, { once: true });
    setTimeout(once, 260);                                              // fallback if no transition
    if (btnEl) btnEl.setAttribute("aria-expanded", "false");
    try { lastFocus && lastFocus.focus && lastFocus.focus(); } catch {}
  }
  const toggle = () => (overlayEl ? close() : open());
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }

  // ── boot ────────────────────────────────────────────────────────────────────────────
  function boot() { injectButton(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  W.HoloCaptureLaunch = { open, close, toggle, get button() { return btnEl; }, captureUrl: CAPTURE_URL };
})();
