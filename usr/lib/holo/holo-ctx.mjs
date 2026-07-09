// holo-ctx.mjs — the ONE context-menu kernel for Hologram OS (HOLO-CTX-ONE S0).
// Every right-click in the OS opens THIS engine; surfaces declare menus as DATA, never DOM.
//
//   HoloCtx.open(x, y, items, opts?)   items: [{ label, ic?, sc?, sub?, mark?, danger?, disabled?, act? } | { sep:true }]
//   HoloCtx.close()
//   HoloCtx.os()                       "windows" | "mac" | "linux"   (the ONE host-OS detector)
//   HoloCtx.key("mod+k")               → "Ctrl+K" / "⌘K", rendered the way the native OS renders it
//
// LAWS it enforces (callers cannot opt out):
//   L1 paint-before-work — opening paints this frame; clicking an item dismisses THIS frame and the
//      action runs after that paint (rAF → macrotask). A heavy action can never hold the menu open.
//   L2 native mirror — macOS drops decorative icons and marks with ✓; Windows/Linux keep icons and
//      mark with ●/○; shortcuts render ⌘K vs Ctrl+K. Ordering/casing live in the CALLER's item data.
//   L5 fail-open — this module missing ⇒ callers must not preventDefault, so the browser menu shows.
//
// Zero dependencies, pure DOM (icons may be strings OR Nodes), installs window.HoloCtx, also exports.
// Extracted 1:1 from the proven shell engine (shell-main.mjs showCtx/renderMenu/openKid) — same look
// (CSS cloned from shell.html .ctx, namespaced .holoctx), same flyout behavior, same marks.

const DOC = document;

// ── the ONE host-OS detector (was: shell-main hostOS + messenger hostOS — now only here) ────────────
function os() {
  try {
    const p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || "").toLowerCase();
    if (/mac|iphone|ipad|ipod/.test(p)) return "mac";
    if (/win/.test(p)) return "windows";
    if (/linux|x11|cros/.test(p)) return "linux";
  } catch (e) {}
  return "windows";
}
function key(sc, forOS) {                                   // present a shortcut the way the native OS does
  if (!sc) return "";
  if ((forOS || os()) === "mac") return String(sc).replace(/ctrl|control|cmd|command|meta|super|mod/ig, "⌘").replace(/[\s+]+/g, "").toUpperCase().replace(/⌘/g, "⌘");
  return String(sc).replace(/\bmod\b/ig, "Ctrl").replace(/\s+/g, "+").replace(/\+\+/g, "+").replace(/\b([a-z])$/i, (m) => m.toUpperCase());
}

// ── look: cloned from shell.html .ctx (κ-canonical chrome), namespaced so it collides with nothing ──
const CSS = `
.holoctx { position: fixed; z-index: 2147483000; min-width: 184px; background: #161b22f2; border: 1px solid #30363d; border-radius: var(--holo-radius, 10px); padding: 5px; box-shadow: 0 16px 40px #000b; backdrop-filter: blur(8px); font: var(--holo-text-sm, 1rem) var(--win-font, var(--holo-font-sans, system-ui, sans-serif)); color: #c9d1d9; }
.holoctx button { display: flex; width: 100%; align-items: center; gap: 10px; background: none; border: 0; color: #c9d1d9; padding: 7px 10px; border-radius: var(--holo-radius, 7px); cursor: pointer; text-align: left; font: inherit; }
.holoctx button:hover:not(:disabled) { background: var(--accent, #1f6feb); color: #fff; }
.holoctx button:disabled { opacity: .38; cursor: default; }
.holoctx button.danger:hover:not(:disabled) { background: #e81123; }
.holoctx button .ic { width: 16px; text-align: center; opacity: .9; flex: 0 0 auto; display: inline-flex; justify-content: center; }
.holoctx button .lbl { flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.holoctx button .sc { margin-left: auto; padding-left: 14px; color: #6e7681; font: var(--holo-text-sm, 1rem) ui-monospace, monospace; flex: 0 0 auto; }
.holoctx button:hover .sc { color: #ffffffb0; }
.holoctx button .chev { margin-left: 8px; opacity: .55; font-size: var(--holo-text-sm, 0.813rem); flex: 0 0 auto; }
.holoctx button.sub-open { background: var(--accent, #1f6feb); color: #fff; }
.holoctx button.sub-open .chev { opacity: .95; }
.holoctx .sep { height: 1px; background: #30363d; margin: 5px 6px; }
@media (prefers-reduced-motion: no-preference) { .holoctx { animation: holoctx-pop .085s ease-out; } }
@keyframes holoctx-pop { from { opacity: 0; transform: translateY(-3px) scale(.985); } to { opacity: 1; transform: none; } }`;
function ensureCSS() {
  if (DOC.getElementById("holo-ctx-css")) return;
  const st = DOC.createElement("style"); st.id = "holo-ctx-css"; st.textContent = CSS; DOC.head.appendChild(st);
}

// ── engine state: the root panel + open flyouts (depth ≥ 1) ─────────────────────────────────────────
let panels = [];                                            // [{ el, depth, parent? }]
let listening = false;

function clearFrom(depth) {
  for (let i = panels.length - 1; i >= 0; i--) {
    if (panels[i].depth >= depth) { panels[i].parent && panels[i].parent.classList.remove("sub-open"); panels[i].el.remove(); panels.splice(i, 1); }
  }
}
function close() { clearFrom(0); unlisten(); }
function onDown(e) { if (!panels.some((p) => p.el.contains(e.target))) close(); }
function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
function listen() {
  if (listening) return; listening = true;
  // pointerdown (capture) so a click ANYWHERE dismisses first — including into iframeless app chrome
  setTimeout(() => { if (listening) { DOC.addEventListener("pointerdown", onDown, true); } }, 0);
  DOC.addEventListener("keydown", onKey, true);
  addEventListener("scroll", close, true);
  addEventListener("resize", close);
  addEventListener("blur", close);
}
function unlisten() {
  if (!listening) return; listening = false;
  DOC.removeEventListener("pointerdown", onDown, true);
  DOC.removeEventListener("keydown", onKey, true);
  removeEventListener("scroll", close, true);
  removeEventListener("resize", close);
  removeEventListener("blur", close);
}

// L2: the leading column — a selection marker, else a decorative icon (dropped on macOS, like native)
function markerFor(it, mac) {
  if (it.mark !== undefined) { const s = DOC.createElement("span"); s.className = "ic mark"; s.textContent = it.mark ? (mac ? "✓" : "●") : (mac ? "" : "○"); return s; }
  if (it.ic != null && !mac) {
    const s = DOC.createElement("span"); s.className = "ic";
    if (typeof it.ic === "string") s.textContent = it.ic; else if (it.ic instanceof Node) s.appendChild(it.ic);
    return s;
  }
  return null;
}
function buildPanel(items, depth, mac) {
  const el = DOC.createElement("div"); el.className = "holoctx"; el.setAttribute("role", "menu");
  for (const it of items) {
    if (it.sep) { const s = DOC.createElement("div"); s.className = "sep"; el.appendChild(s); continue; }
    const b = DOC.createElement("button"); b.type = "button";
    if (it.danger) b.classList.add("danger");
    if (it.disabled) b.disabled = true;
    b.setAttribute("role", it.mark !== undefined ? "menuitemradio" : "menuitem");
    if (it.mark !== undefined) b.setAttribute("aria-checked", String(!!it.mark));
    const mk = markerFor(it, mac); if (mk) b.appendChild(mk);
    const lbl = DOC.createElement("span"); lbl.className = "lbl"; lbl.textContent = String(it.label == null ? "" : it.label); b.appendChild(lbl);
    if (it.sub) { const c = DOC.createElement("span"); c.className = "chev"; c.textContent = "›"; b.appendChild(c); }
    else if (it.sc) { const c = DOC.createElement("span"); c.className = "sc"; c.textContent = it.sc; b.appendChild(c); }
    if (it.sub) {
      b.addEventListener("mouseenter", () => openSub(b, it.sub, depth + 1, mac));
      b.addEventListener("click", (e) => { e.stopPropagation(); openSub(b, it.sub, depth + 1, mac); });
    } else {
      b.addEventListener("mouseenter", () => clearFrom(depth + 1));   // a leaf at this level closes any deeper flyout
      // L1: dismiss + paint FIRST; the action runs after that frame — a click never waits on its action
      b.addEventListener("click", () => { close(); if (it.act && !it.disabled) requestAnimationFrame(() => setTimeout(it.act, 0)); });
    }
    el.appendChild(b);
  }
  return el;
}
function placeRoot(el, x, y) {
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
  el.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
}
function openSub(parentBtn, items, depth, mac) {
  if (parentBtn.classList.contains("sub-open")) return;       // already open
  clearFrom(depth);                                           // close siblings + anything deeper
  const el = buildPanel(items, depth, mac); DOC.body.appendChild(el);
  const pr = parentBtn.getBoundingClientRect(), er = el.getBoundingClientRect();
  let left = pr.right - 4; if (left + er.width > innerWidth - 8) left = pr.left - er.width + 4;
  let top = pr.top - 5; if (top + er.height > innerHeight - 8) top = innerHeight - er.height - 8;
  el.style.left = Math.max(8, left) + "px"; el.style.top = Math.max(8, top) + "px";
  panels.push({ el, depth, parent: parentBtn }); parentBtn.classList.add("sub-open");
}
function open(x, y, items, opts) {
  ensureCSS(); close();
  const mac = ((opts && opts.os) || os()) === "mac";
  const el = buildPanel(items || [], 0, mac);
  el.style.left = "0px"; el.style.top = "0px"; DOC.body.appendChild(el);
  placeRoot(el, x, y);
  panels.push({ el, depth: 0 });
  listen();
  return el;
}

const HoloCtx = { open, close, os, key };
try { window.HoloCtx = HoloCtx; } catch (e) {}
export { open, close, os, key };
export default HoloCtx;
