// holo-aside.mjs — the ONE right side-carriage primitive shared by Create, Play, and Share, so the
// three holospace verbs open with identical chrome, animation, and feel.
//
// It is the Holo Wallet / Create-studio gesture, distilled: a body-level aside docked on the right that
// SQUEEZES the live holospace left by --holo-aside-w (the desktop stays beside you, never overlaid).
//   • Throttle-safe slide — --holo-aside-w is set SYNCHRONOUSLY on open and the panel is opaque on mount;
//     only a 26px nudge animates, so a paused transition (a backgrounded tab) just leaves it a hair off,
//     never hidden. (The lesson the Create studio's own comment records.)
//   • One carriage at a time — opening one closes the others, so they never fight over the dock.
//   • A left-edge handle that DRAG-RESIZES the width (live, persisted per id) or, on a plain click,
//     collapses the carriage. Double-click resets the width.
//   • NO auto-close on a canvas click. Esc, the handle-click, or the header ✕ close it.
//
// createAside({ id, title, logo, defaultW, minW, maxW, onClose }) → { el, body, header, actions,
//   open, close, toggle, isOpen, setTitle, setActions }.

const ASIDE_W = "--holo-aside-w";
const registry = new Set();   // currently-open carriages (for single-open coordination)
const closers = new Set();    // external closers (e.g. the Create studio, which manages its own lifecycle)

// registerAsideCloser(fn) — let a non-primitive right-dock surface (Create) join the single-open rule.
export function registerAsideCloser(fn) { closers.add(fn); return () => closers.delete(fn); }
// closeAllAsides() — close every open carriage + run external closers (one carriage at a time).
export function closeAllAsides(except) { for (const a of [...registry]) { if (a !== except) try { a.close(); } catch (e) {} } for (const f of closers) try { f(); } catch (e) {} }
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clampW = (w, lo, hi) => Math.max(lo, Math.min(hi, w | 0));

export function createAside({ id, title = "", logo = "", defaultW = 460, minW = 360, maxW = 760, onClose } = {}) {
  const domId = "holo-aside-" + (id || "x");
  const existing = document.getElementById(domId);
  if (existing && existing._aside) return existing._aside;
  injectStyles();

  const WKEY = "holo.aside.w." + (id || "default");
  let width = defaultW; try { const s = localStorage.getItem(WKEY); const n = parseInt(s, 10); if (n) width = clampW(n, minW, maxW); } catch (e) {}

  const el = document.createElement("aside");
  el.className = "holo-aside"; el.id = domId; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", title || "Panel");
  el.style.width = width + "px";
  el.innerHTML = `
    <div class="ha-grip" title="Drag to resize · click to close" aria-label="Resize or close"></div>
    <header class="ha-head">
      <div class="ha-logo">${logo || ""}</div>
      <div class="ha-title">${esc(title)}</div>
      <div class="ha-actions"></div>
      <button class="ha-x" type="button" title="Close" aria-label="Close">✕</button>
    </header>
    <div class="ha-body"></div>`;
  document.body.appendChild(el);
  const body = el.querySelector(".ha-body"), head = el.querySelector(".ha-head"), actionsSlot = el.querySelector(".ha-actions"), grip = el.querySelector(".ha-grip");

  let open = false;
  const setDockW = () => { try { document.documentElement.style.setProperty(ASIDE_W, el.offsetWidth + "px"); } catch (e) {} };
  function doOpen() {
    if (open) return;
    for (const a of registry) { if (a !== api) try { a.close(); } catch (e) {} }   // one carriage at a time
    for (const f of closers) try { f(); } catch (e) {}                             // close external surfaces (Create)
    open = true; registry.add(api);
    el.classList.add("on"); setDockW(); document.documentElement.classList.add("aside-open");
  }
  function doClose() {
    if (!open) return; open = false; registry.delete(api);
    el.classList.remove("on");
    if (!registry.size) { try { document.documentElement.style.removeProperty(ASIDE_W); } catch (e) {} document.documentElement.classList.remove("aside-open"); }
    try { dispatchEvent(new Event("resize")); } catch (e) {}
    try { onClose && onClose(); } catch (e) {}
  }
  const toggle = () => (open ? doClose() : doOpen());

  // the left-edge handle: drag to resize (live + persisted), or a plain click collapses it.
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault(); try { grip.setPointerCapture(e.pointerId); } catch (x) {}
    const sx = e.clientX, sw = el.offsetWidth; let moved = false;
    el.classList.add("resizing");
    const move = (ev) => { if (Math.abs(ev.clientX - sx) > 3) moved = true; const w = clampW(sw + (sx - ev.clientX), minW, maxW); el.style.width = w + "px"; setDockW(); try { dispatchEvent(new Event("resize")); } catch (x) {} };
    const up = () => {
      el.classList.remove("resizing"); document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
      if (!moved) { doClose(); return; }                                  // a click, not a drag → collapse
      try { localStorage.setItem(WKEY, String(el.offsetWidth)); } catch (x) {}
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
  });
  grip.addEventListener("dblclick", () => { el.style.width = defaultW + "px"; setDockW(); try { dispatchEvent(new Event("resize")); localStorage.setItem(WKEY, String(defaultW)); } catch (x) {} });

  el.querySelector(".ha-x").addEventListener("click", doClose);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) doClose(); });
  // NOTE: deliberately NO canvas / pointerdown-on-world auto-close — the carriage stays put while you work.

  const api = {
    el, body, header: head, actions: actionsSlot,
    open: doOpen, close: doClose, toggle, isOpen: () => open,
    setTitle: (t) => { const n = el.querySelector(".ha-title"); if (n) n.textContent = t || ""; el.setAttribute("aria-label", t || "Panel"); },
    setActions: (html) => { actionsSlot.innerHTML = html || ""; return actionsSlot; },
  };
  el._aside = api;
  return api;
}

function injectStyles() {
  if (document.getElementById("holo-aside-styles")) return;
  const s = document.createElement("style"); s.id = "holo-aside-styles";
  s.textContent = `
  .holo-aside{position:fixed;top:0;right:0;bottom:0;left:auto;z-index:60;display:flex;flex-direction:column;
    background:#0a0a0b;color:#e7e7ea;font:16px/1.5 var(--win-font,ui-sans-serif,system-ui);
    transform:translateX(26px);visibility:hidden;pointer-events:none;box-shadow:-24px 0 64px -34px #000;
    transition:transform .42s cubic-bezier(.2,.85,.25,1);will-change:transform}
  .holo-aside.on{transform:none;visibility:visible;pointer-events:auto}
  .holo-aside.resizing{transition:none;user-select:none}
  .holo-aside .ha-grip{position:absolute;left:0;top:0;bottom:0;width:9px;cursor:ew-resize;z-index:6;touch-action:none}
  .holo-aside .ha-grip::after{content:"";position:absolute;left:2px;top:50%;transform:translateY(-50%);width:4px;height:44px;border-radius:4px;
    background:color-mix(in srgb,var(--accent,#5b8cff) 70%,#e7e7ea);opacity:.45;transition:opacity .15s,height .15s}
  .holo-aside:hover .ha-grip::after{opacity:.8}
  .holo-aside .ha-grip:hover::after{opacity:1;height:66px}
  .holo-aside .ha-head{flex:0 0 auto;display:flex;align-items:center;gap:11px;padding:13px 16px 13px 18px;border-bottom:1px solid #1d1d21}
  .holo-aside .ha-logo{width:28px;height:28px;border-radius:8px;flex:0 0 auto;background:linear-gradient(135deg,#ff7eb3,#ff8a5b);display:grid;place-items:center;overflow:hidden}
  .holo-aside .ha-logo svg{width:74%;height:74%;display:block}
  .holo-aside .ha-title{font-weight:680;font-size:16px;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .holo-aside .ha-actions{margin-left:auto;display:flex;align-items:center;gap:8px;min-width:0}
  .holo-aside .ha-x{flex:0 0 auto;width:34px;height:34px;border:0;border-radius:9px;background:transparent;color:#9a9aa2;font-size:16px;cursor:pointer;display:grid;place-items:center;transition:.12s}
  .holo-aside .ha-x:hover{background:#1c1c20;color:#e7e7ea}
  .holo-aside .ha-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}
  @media (prefers-reduced-motion: reduce){ .holo-aside{transition:none} }
  @media (max-width:600px){ .holo-aside{width:100vw !important} .holo-aside .ha-grip{display:none} }`;
  document.head.appendChild(s);
}

export default { createAside };
