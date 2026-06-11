// holo-notepad-launch.js — ONE drop-in that makes Holo Notepad UBIQUITOUS: it puts a small
// "second-brain" icon on every holospace frame AND quietly records your activity into your
// memory bank. Loaded automatically by holo-manage.js so it rides the same universal presence.
// Self-contained (vanilla JS + CSS, no deps, no CDN). Exposes window.HoloNotepadLaunch.
//
// TWO affordances, one file:
//   • UBIQUITY — a brain icon (docked beside the Capture/Stream/Theme/Manage icons) + a global
//     hotkey (Ctrl/Cmd-Shift-K) open a quick-capture / "ask your brain" overlay framing
//     notepad.html?quick=1 — jot a thought or search your whole memory from anywhere in one key.
//   • CAPTURE PROBE — on load / when the frame becomes visible, it emits a content-blind activity
//     event (which app/page/article you opened, who you met) onto the BroadcastChannel + a
//     localStorage inbox that Holo Notepad drains — so your day is recorded even when Notepad
//     isn't open. 100% local. A master kill-switch (held by Notepad) pauses ALL capture.
//
// The probe is deliberately tiny (no engine load on every frame): it only broadcasts + buffers.
// Holo Notepad's recorder (holo-memory.js) does the content-addressing, indexing and graphing.

(function () {
  "use strict";
  const W = window;
  if (W.HoloNotepadLaunch) return;
  if (typeof document === "undefined") return;

  const loader = (location.pathname.split("/").pop() || "").toLowerCase();
  if (/notepad\.html$/.test(loader)) return;                          // don't launch Notepad inside Notepad

  // notepad.html lives at the OS root (beside apps/). Resolve it from the PAGE path so it works from
  // a root page, a nested packaged app (…/apps/<id>/), the κ-route, AND a Pages subpath.
  const ROOT = location.pathname.includes("/apps/") ? location.pathname.replace(/\/apps\/.*$/, "/") : location.pathname.replace(/[^/]*$/, "");
  const NOTEPAD_URL = ROOT + "notepad.html?quick=1";
  const ACCENT = "#5b6ee1";
  const CAP_FLAG = "holo-memory-capture";

  // Activity capture is owned by HOLO RECORD (_shared/holo-record.js), loaded on every frame by
  // holo-manage.js BEFORE this launcher. This file is purely the ubiquity UI (icon + hotkey +
  // overlay); it delegates all capture to HoloRecord and only mirrors the kill-switch on the dot.
  const captureOn = () => (W.HoloRecord ? W.HoloRecord.captureOn() : (() => { try { return localStorage.getItem(CAP_FLAG) !== "off"; } catch { return true; } })());

  // ── styles (mirrors the Capture/Stream launchers) ─────────────────────────────────
  const CSS = `
  #holo-notepad-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 auto;
    border-radius:8px;border:1px solid transparent;background:transparent;color:currentColor;cursor:pointer;opacity:.78;padding:0;position:relative;
    transition:opacity .15s,border-color .15s,color .15s}
  #holo-notepad-btn:hover{opacity:1;border-color:${ACCENT};color:${ACCENT}}
  #holo-notepad-btn:focus-visible{outline:2px solid ${ACCENT};outline-offset:2px}
  #holo-notepad-btn svg{width:18px;height:18px;display:block}
  #holo-notepad-btn .rec{position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:#ff5d5d;box-shadow:0 0 0 2px rgba(0,0,0,.35);display:none}
  #holo-notepad-btn.recording .rec{display:block;animation:holoMemPulse 1.8s ease-in-out infinite}
  @keyframes holoMemPulse{0%,100%{opacity:1}50%{opacity:.35}}
  #holo-notepad-btn.float{position:fixed;top:8px;right:118px;z-index:2147482000;width:34px;height:34px;background:#0d1117cc;
    border-color:#2a3340;color:#9fb0bd;backdrop-filter:blur(6px);box-shadow:0 4px 14px rgba(0,0,0,.4)}
  #holo-notepad-overlay{position:fixed;inset:0;z-index:2147483400;display:flex;align-items:center;justify-content:center;
    padding:24px;background:rgba(3,6,10,.62);backdrop-filter:blur(10px) saturate(1.05);-webkit-backdrop-filter:blur(10px) saturate(1.05);
    opacity:0;transition:opacity .16s ease}
  #holo-notepad-overlay.in{opacity:1}
  #holo-notepad-overlay .panel{display:flex;flex-direction:column;width:min(880px,95vw);height:min(86vh,820px);
    background:#0b0f15;border:1px solid #20262e;border-radius:16px;overflow:hidden;
    box-shadow:0 40px 120px rgba(0,0,0,.62),0 0 0 1px rgba(91,110,225,.08);
    transform:scale(.985) translateY(6px);opacity:.6;transition:transform .2s cubic-bezier(.2,.8,.2,1),opacity .2s ease}
  #holo-notepad-overlay.in .panel{transform:none;opacity:1}
  #holo-notepad-overlay .hd{flex:0 0 auto;display:flex;align-items:center;gap:10px;height:46px;padding:0 10px 0 14px;
    background:#0d1117;border-bottom:1px solid #161c24;font:var(--holo-text-sm, 1rem) ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e6edf3}
  #holo-notepad-overlay .hd .ic{color:${ACCENT};display:inline-flex}#holo-notepad-overlay .hd .ic svg{width:18px;height:18px}
  #holo-notepad-overlay .hd .nm{font-weight:700;letter-spacing:.01em}
  #holo-notepad-overlay .hd .sub{color:#6e7681;font-size:var(--holo-text-sm,1rem)}
  #holo-notepad-overlay .hd .sp{margin-left:auto}
  #holo-notepad-overlay .hd .kbd{color:#8b949e;border:1px solid #28323d;border-radius:6px;padding:2px 7px;font:var(--holo-text-sm, 1rem) ui-monospace,monospace;background:#0b0f15}
  #holo-notepad-overlay .hd .x{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;
    border:1px solid transparent;background:transparent;color:#9fb0bd;cursor:pointer;font:16px ui-sans-serif;line-height:1}
  #holo-notepad-overlay .hd .x:hover{border-color:#5c2222;color:#fca5a5;background:#1f0f0f}
  #holo-notepad-overlay iframe{flex:1 1 auto;width:100%;border:0;display:block;background:#05070a}
  @media (max-width:640px){#holo-notepad-overlay{padding:0}#holo-notepad-overlay .panel{width:100vw;height:100dvh;border-radius:0;border:0}
    #holo-notepad-overlay .hd .sub{display:none}#holo-notepad-btn{min-height:38px;min-width:38px}}
  @media (prefers-reduced-motion:reduce){#holo-notepad-overlay,#holo-notepad-overlay .panel{transition:none}#holo-notepad-overlay .panel{transform:none}}
  @media print{#holo-notepad-btn,#holo-notepad-overlay{display:none!important}}`;

  // a brain / linked-memory glyph (three connected nodes) — matches the Holo Notepad app icon
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6.5" cy="8" r="2.3"/><circle cx="17.5" cy="6.6" r="2.3"/><circle cx="12" cy="17.5" r="2.3"/><path d="M8.7 8.6 L15.3 7 M7.4 10 L10.7 15.6 M16.4 8.7 L13.3 15.7"/></svg>';

  let btnEl, overlayEl, lastFocus = null;
  function injectStyle() { if (document.getElementById("holo-notepad-css")) return; const s = document.createElement("style"); s.id = "holo-notepad-css"; s.textContent = CSS; document.head.appendChild(s); }

  function injectButton() {
    if (document.getElementById("holo-notepad-btn")) return;
    injectStyle();
    btnEl = document.createElement("button"); btnEl.id = "holo-notepad-btn"; btnEl.type = "button";
    btnEl.setAttribute("aria-label", "Holo Notepad — capture a thought or search your memory");
    btnEl.title = "Holo Notepad — capture & recall (Ctrl/Cmd-Shift-K)"; btnEl.setAttribute("aria-haspopup", "dialog");
    btnEl.innerHTML = ICON + '<span class="rec" title="recording your activity (private, local)"></span>';
    if (captureOn()) btnEl.classList.add("recording");
    btnEl.addEventListener("click", toggle);

    const theme = document.getElementById("holo-theme-btn");
    const capture = document.getElementById("holo-capture-btn");
    const manage = document.getElementById("holo-manage-btn");
    const anchor = theme || capture || manage;                          // dock to the LEFT of the launcher cluster
    if (anchor && anchor.parentElement && !anchor.classList.contains("float")) anchor.parentElement.insertBefore(btnEl, anchor);
    else { const bar = findBar(); if (bar) bar.appendChild(btnEl); else { btnEl.classList.add("float"); document.body.appendChild(btnEl); } }
    try { const host = btnEl.parentElement; if (host) { const mo = new MutationObserver(() => { if (!document.getElementById("holo-notepad-btn")) host.appendChild(btnEl); }); mo.observe(host, { childList: true }); } } catch {}
  }
  function findBar() {
    for (const sel of ["#bar", "header", '[role="banner"]', "#topbar", ".titlebar", ".topbar", "#chrome", "#appbar"]) {
      const el = document.querySelector(sel); if (!el) continue; const r = el.getBoundingClientRect();
      if (r.width >= Math.min(320, innerWidth * 0.5) && r.top <= 14 && r.height >= 16 && r.height <= 140) return el;
    }
    return null;
  }

  function open() {
    if (overlayEl) return;
    injectStyle(); lastFocus = document.activeElement;
    overlayEl = document.createElement("div"); overlayEl.id = "holo-notepad-overlay"; overlayEl.setAttribute("role", "dialog");
    overlayEl.setAttribute("aria-modal", "true"); overlayEl.setAttribute("aria-label", "Holo Notepad");
    overlayEl.innerHTML =
      `<div class="panel"><div class="hd"><span class="ic">${ICON}</span><span class="nm">Holo Notepad</span>
        <span class="sub">· capture &amp; recall your memory</span><span class="sp"></span>
        <span class="kbd">Esc</span><button class="x" type="button" aria-label="Close" title="Close">✕</button></div>
        <iframe title="Holo Notepad" allow="clipboard-read; clipboard-write" referrerpolicy="no-referrer" src="${NOTEPAD_URL}"></iframe></div>`;
    overlayEl.addEventListener("click", (e) => { if (e.target === overlayEl) close(); });
    overlayEl.querySelector(".x").addEventListener("click", close);
    document.body.appendChild(overlayEl);
    requestAnimationFrame(() => { overlayEl.classList.add("in"); const x = overlayEl.querySelector(".x"); x && x.focus(); });
    document.addEventListener("keydown", onKey, true);
    if (btnEl) btnEl.setAttribute("aria-expanded", "true");
  }
  function close() {
    if (!overlayEl) return;
    document.removeEventListener("keydown", onKey, true);
    const el = overlayEl; overlayEl = null; el.classList.remove("in");
    let removed = false; const once = () => { if (removed) return; removed = true; el.remove(); };
    el.addEventListener("transitionend", once, { once: true }); setTimeout(once, 260);
    if (btnEl) btnEl.setAttribute("aria-expanded", "false");
    try { lastFocus && lastFocus.focus && lastFocus.focus(); } catch {}
  }
  const toggle = () => (overlayEl ? close() : open());
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }

  // global hotkey — Ctrl/Cmd-Shift-K opens the quick-capture / ask overlay from anywhere
  function onHotkey(e) {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); toggle(); }
  }

  // reflect the kill-switch (set by Holo Notepad) on the recording dot, live across tabs
  function syncRec() { if (btnEl) btnEl.classList.toggle("recording", captureOn()); }
  try { addEventListener("storage", (e) => { if (e.key === CAP_FLAG) syncRec(); }); } catch {}

  function boot() {
    injectButton();
    addEventListener("keydown", onHotkey, true);   // capture/probing belongs to Holo Record now
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  // open extension point: delegate any precise activity event (e.g. browser → article) to Holo Record
  W.HoloNotepadLaunch = { open, close, toggle, capture: (ev) => (W.HoloRecord ? W.HoloRecord.emit(ev) : null), probe: () => (W.HoloRecord ? W.HoloRecord.probe() : null), get button() { return btnEl; }, notepadUrl: NOTEPAD_URL };
})();
