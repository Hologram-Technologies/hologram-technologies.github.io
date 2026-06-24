// holo-aside.mjs — the ONE right side-carriage primitive. EVERY surface that slides in from the right
// edge (Create · Play · Share · Notify · Wallet) wears this exact template, so they open with identical
// chrome, scale, animation, and the same single collapse control. There is no second way to make one.
//
// It is a body-level aside docked on the right that SQUEEZES the live holospace left by --holo-aside-w
// (the desktop stays beside you, never overlaid).
//   • Golden scale — the width is LOCKED to the minor golden share of the viewport (vw / φ² ≈ 0.382·vw,
//     clamped 360–720px). The holospace always keeps the major φ share beside it, so the panel never
//     dominates a small screen, and the ratio holds at any size. One formula (--ha-gw), no drag-resize.
//   • One carriage at a time — opening one closes the others, so they never fight over the dock.
//   • One obvious collapse control — a » chevron at the header's trailing edge (plus Esc). Nothing else.
//   • Throttle-safe slide — only a small nudge animates, so a paused transition just leaves it a hair off.
//   • NO auto-close on a canvas click. The » chevron or Esc close it; it stays put while you work.
//
// createAside({ id, title, logo, minW, maxW, onClose }) → { el, body, header, actions, open, close,
//   toggle, isOpen, setTitle, setActions }.

const ASIDE_W = "--holo-aside-w";
const registry = new Set();   // currently-open carriages (for single-open coordination)
const closers = new Set();    // external closers (e.g. the Create studio, which manages its own lifecycle)

// registerAsideCloser(fn) — let a non-primitive right-dock surface (Create) join the single-open rule.
export function registerAsideCloser(fn) { closers.add(fn); return () => closers.delete(fn); }
// closeAllAsides() — close every open carriage + run external closers (one carriage at a time).
export function closeAllAsides(except) { for (const a of [...registry]) { if (a !== except) try { a.close(); } catch (e) {} } for (const f of closers) try { f(); } catch (e) {} }
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// syncDockWidth() — mirror the open carriage's actual (clamped) width into --holo-aside-w as concrete px
// so the holospace + floating widgets (which parseFloat it) squeeze by exactly the right amount. Runs on
// open/close AND on every resize, since the golden width is responsive. Matches ANY surface wearing the
// template — createAside panels, the Create studio, the Wallet — so all dock identically. No resize is
// dispatched here, so there is no feedback loop.
export function syncDockWidth() {
  try {
    const root = document.documentElement;
    // ONLY an aside that is genuinely on screen (attached, visible, painting, with width) may reserve the
    // right inset. A carriage that was torn down, detached, or hidden without a resync must NOT strand
    // --holo-aside-w: a stale value leaves the whole desktop permanently squeezed left — a phantom dark
    // band on the right that reads as "the canvas doesn't cover the screen", and it grows as the window is
    // widened. Querying `.holo-aside.on` alone trusted the class; we now verify the element actually paints,
    // so syncDockWidth is self-healing — the next resize (e.g. expanding the window) clears any phantom inset.
    let reserve = 0;
    for (const a of document.querySelectorAll(".holo-aside.on")) {
      if (a.offsetParent === null) continue;                       // detached / display:none ancestor → not on screen
      const cs = getComputedStyle(a);
      if (cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
      const w = a.getBoundingClientRect().width;
      if (w >= 1) reserve = Math.max(reserve, Math.round(w));
    }
    if (reserve > 0) { root.style.setProperty(ASIDE_W, reserve + "px"); root.classList.add("aside-open"); }
    else { root.style.removeProperty(ASIDE_W); root.classList.remove("aside-open"); }
  } catch (e) {}
}
if (typeof window !== "undefined") {
  window.addEventListener("resize", syncDockWidth);
  // Self-heal any inset that was stranded before this listener existed (or by a torn-down carriage): reconcile
  // once the layout settles, and whenever the tab returns to the foreground. Cheap, idempotent, no resize needed.
  const reconcile = () => { try { syncDockWidth(); } catch (e) {} };
  if (document.readyState === "complete") requestAnimationFrame(reconcile);
  else window.addEventListener("load", () => requestAnimationFrame(reconcile), { once: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) reconcile(); });
}

// reflowGlide() — nudge the floating widgets + Q orb to re-anchor IN LOCKSTEP with the carriage glide.
// The holospace squeezes via --holo-aside-w (CSS), which does NOT change innerWidth, so holo-widgets'
// centre-anchored reflow (keyed on the `resize` event) never fires on its own — the widgets and the Q
// orb would stay stranded under the opening panel. Dispatch a short run of resize ticks across the
// .42s slide so recenter()/anchorOrb() track the moving holospace centre the whole way, and OUTLAST
// the ~120ms deskBounds cache (keyed on innerWidth, which is unchanged here) that a single tick reads
// stale. Symmetric on open AND close, so the tab returns to its exact prior layout. Idempotent — extra
// ticks are no-ops once the centre stops moving.
function reflowGlide() {
  if (typeof window === "undefined") return;
  let n = 0;
  const tick = () => { try { dispatchEvent(new Event("resize")); } catch (e) {} };
  tick();                                                            // immediate — the desktop starts gliding with the panel, not after it
  const id = setInterval(() => { tick(); if (++n >= 10) clearInterval(id); }, 48);   // ~480ms run covers the .42s slide + the bounds cache
}

export function createAside({ id, title = "", logo = "", minW = 360, maxW = 720, onClose } = {}) {
  const domId = "holo-aside-" + (id || "x");
  const existing = document.getElementById(domId);
  if (existing && existing._aside) return existing._aside;
  injectStyles();

  const el = document.createElement("aside");
  el.className = "holo-aside"; el.id = domId; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", title || "Panel");
  if (minW !== 360) el.style.setProperty("--ha-min", minW + "px");   // optional per-surface bounds; the scale stays golden
  if (maxW !== 720) el.style.setProperty("--ha-max", maxW + "px");
  el.innerHTML = `
    <header class="ha-head">
      <div class="ha-logo">${logo || ""}</div>
      <div class="ha-title">${esc(title)}</div>
      <div class="ha-actions"></div>
      <button class="ha-collapse" type="button" title="Collapse" aria-label="Collapse panel">»</button>
    </header>
    <div class="ha-body"></div>`;
  document.body.appendChild(el);
  const body = el.querySelector(".ha-body"), head = el.querySelector(".ha-head"), actionsSlot = el.querySelector(".ha-actions");

  let open = false;
  function doOpen() {
    if (open) return;
    for (const a of registry) { if (a !== api) try { a.close(); } catch (e) {} }   // one carriage at a time
    for (const f of closers) try { f(); } catch (e) {}                             // close external surfaces (Create)
    open = true; registry.add(api);
    el.classList.add("on"); syncDockWidth(); reflowGlide();   // squeeze the holospace AND glide its widgets + Q orb in lockstep
  }
  function doClose() {
    if (!open) return; open = false; registry.delete(api);
    el.classList.remove("on"); syncDockWidth(); reflowGlide();   // restore full width AND glide everything back to its prior place
    try { onClose && onClose(); } catch (e) {}
  }
  const toggle = () => (open ? doClose() : doOpen());

  el.querySelector(".ha-collapse").addEventListener("click", doClose);
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
  :root{ --ha-gw: clamp(var(--ha-min,360px), calc(100vw / 2.618), var(--ha-max,720px)); }   /* the ONE golden width every right carriage wears */
  /* the ONE frosted-glass surface every right carriage wears (the Q-panel acrylic, distilled): a faintly
     blue near-dark tint over a backdrop blur, a hairline white edge, a soft cast shadow. Content bodies
     stay translucent so the live desktop frosts through. */
  .holo-aside{position:fixed;top:0;right:0;bottom:0;left:auto;width:var(--ha-gw);z-index:60;display:flex;flex-direction:column;
    background:var(--holo-glass-acrylic-bg,rgba(15,19,27,.94));color:var(--holo-ink,#e9eef7);font:16px/1.5 var(--win-font,ui-sans-serif,system-ui);
    -webkit-backdrop-filter:blur(28px) saturate(1.6);backdrop-filter:blur(28px) saturate(1.6);
    border-left:1px solid var(--holo-glass-border,rgba(255,255,255,.14));
    transform:translateX(26px);visibility:hidden;pointer-events:none;box-shadow:-14px 0 44px rgba(0,0,0,.46);
    transition:transform .42s cubic-bezier(.2,.85,.25,1);will-change:transform}
  .holo-aside.on{transform:none;visibility:visible;pointer-events:auto}
  .holo-aside .ha-head{flex:0 0 auto;display:flex;align-items:center;gap:11px;padding:13px 14px 13px 18px;border-bottom:1px solid var(--holo-glass-border,rgba(255,255,255,.1))}
  .holo-aside .ha-logo{width:28px;height:28px;border-radius:8px;flex:0 0 auto;background:linear-gradient(135deg,#ff7eb3,#ff8a5b);display:grid;place-items:center;overflow:hidden}
  .holo-aside .ha-logo:empty{display:none}
  .holo-aside .ha-logo svg{width:74%;height:74%;display:block}
  .holo-aside .ha-title{font-weight:680;font-size:16px;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .holo-aside .ha-actions{margin-left:auto;display:flex;align-items:center;gap:8px;min-width:0}
  /* the ONE collapse control — a » chevron that slides the carriage back off the right edge */
  .holo-aside .ha-collapse{flex:0 0 auto;width:34px;height:34px;border:0;border-radius:10px;background:transparent;color:#9a9aa2;
    font-size:19px;line-height:1;cursor:pointer;display:grid;place-items:center;transition:background .12s,color .12s,transform .12s}
  .holo-aside .ha-collapse:hover{background:color-mix(in srgb,var(--accent,#5b8cff) 22%,#1c1c20);color:#e7e7ea;transform:translateX(2px)}
  .holo-aside .ha-collapse:focus-visible{outline:2px solid var(--accent,#5b8cff);outline-offset:2px}
  .holo-aside .ha-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}
  @media (prefers-reduced-motion: reduce){ .holo-aside,.holo-aside .ha-collapse{transition:none} }
  @media (max-width:600px){ :root{ --ha-gw: 100vw; } }`;
  document.head.appendChild(s);
}

export default { createAside };
