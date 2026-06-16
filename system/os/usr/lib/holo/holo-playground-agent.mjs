// holo-playground-agent.mjs — Holo Playground: every element rendered INSIDE a holo app becomes a
// right-click-editable κ-object, edited live in the browser. "Bang on the objects and they bang back"
// (Playground 2.0, github.com/PlaygroundNow/Playground-2.0), native to κ + the conscience + the Laws.
//
// THE ONE EDIT PATH. The in-frame agent NEVER seals anything itself. It mutates its own live DOM, strips
// its own UI, serialises the host document, and hands the bytes UP to the shell — which calls the ONE
// primitive `createLiveEditor` (holo-live-edit.mjs). So an in-app element edit bottoms out in the exact
// same `edit`/`agentEdit` that the Q chat sidecar, Holo DevTools (ADR-0095), and AI agents (ADR-0093) use.
// There is no second sealer and no shadow copy. An element edit reseals the WHOLE host surface to a new
// root κ (the surface IS one κ-object; an element is a sub-tree of it).
//
// L5-CRITICAL: the agent is injected into the LIVE contentDocument after load (NOT baked into the sealed
// srcdoc), so the sealed source must stay pristine. `serialize()` drops every [data-holo-ephemeral] node
// (the agent's own UI/script + any ambient injected runtime) and the transient hover class, so the resealed
// κ === "user source + user edit" with ZERO injected noise — it re-derives by content (Law L5).
//
// Pure + isomorphic (the Atlas discipline): `serialize` and the host `handle` are dependency-injected pure
// functions, so the exact logic runs in the shell AND in the Node witness over a tiny deterministic DOM —
// no jsdom, no browser. The browser-only surface (menu, inline editor, glow) is gated on `win`/`doc`.

import { createPlaySession, createCanvasDock, createSelectionUI, rectsIntersect } from "./holo-playground-canvas.mjs";   // Playground 3.0 canvas + selection/handles
import { createForceEngine, FORCES } from "./holo-playground-forces.mjs";              // Stage 2: whole-screen forces (tornado · earthquake)
import { createShatter } from "./holo-playground-shatter.mjs";                          // Stage 2 (Track D): text-shatter without reflow
import { createGameHost, GAMES } from "./holo-playground-games.mjs";                    // Stage 3: mini-games on the screen's own objects

const EPHEMERAL = "data-holo-ephemeral";   // marks the agent's own nodes (+ ambient injected runtime) — stripped before sealing
const HOT = "holo-pg-hot";                 // the transient "editable" glow class — never persisted into the κ
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

const isKappaDefault = (s) => typeof s === "string" && /^did:holo:(sha256|blake3):[0-9a-f]+$/.test(s);
const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function isEphemeral(el) {
  try { return el && el.nodeType === 1 && typeof el.getAttribute === "function" && el.getAttribute(EPHEMERAL) !== null; }
  catch (e) { return false; }
}
function cleanClass(v) { return String(v || "").split(/\s+/).filter(Boolean).filter((c) => !c.startsWith("holo-pg-")).join(" "); }   // strip EVERY transient playground class (glow · multi-select · game markers) — none ever seals (L5)

// serialise ONE live node → HTML, dropping every ephemeral sub-tree and the transient glow class. Pure: works
// on a real DOM node AND on the witness's deterministic mock (both expose nodeType/childNodes/attributes).
function serializeNode(node) {
  if (!node) return "";
  const t = node.nodeType;
  if (t === 3) return escText(node.nodeValue || "");            // text
  if (t === 8) return "<!--" + (node.nodeValue || "") + "-->";  // comment
  if (t !== 1) return "";
  if (isEphemeral(node)) return "";                             // the agent's own node — gone before sealing
  const tag = String(node.localName || node.nodeName || "").toLowerCase();
  let attrs = "";
  const list = node.attributes ? [...node.attributes] : [];
  for (const a of list) {
    let val = a.value;
    if (a.name === "class") { val = cleanClass(val); if (!val) continue; }   // drop the transient glow, never persist it
    attrs += " " + a.name + '="' + escAttr(val) + '"';
  }
  const open = "<" + tag + attrs + ">";
  if (VOID.has(tag)) return open;
  let inner = "";
  const kids = node.childNodes ? [...node.childNodes] : [];
  for (const k of kids) inner += serializeNode(k);
  return open + inner + "</" + tag + ">";
}

// ── createPlaygroundAgent — TWO modes over the SAME UI/serialiser (the Atlas discipline). ─────────────────
//   IN-FRAME (default): lives inside a same-origin app frame; serialises the WHOLE document and posts the bytes
//     UP to the shell (postUp) → createPlaygroundHost → createLiveEditor.edit. One surface, one fixed surfaceId.
//   IN-SHELL/HOST (resolveSurface + commit): lives in the shell's OWN document, where non-iframe surfaces (pure
//     components, manim, κ-objects, native blocks) render directly. There is NO cross-frame boundary, so it
//     calls `commit(surfaceId, source)` DIRECTLY (the shell wires that to HoloLiveEdit.edit — still the ONE path).
//     `resolveSurface(targetEl) → { surfaceId, root } | null` tells the agent which surface an element belongs to
//     (and the sub-tree `root` to serialise); a null means "not an editable surface" (shell chrome) → ignored.
// { doc, win, surfaceId, postUp, root, resolveSurface, commit, badge, isKappa } → { mount, unmount, serialize, setActive, isActive, … }
export function createPlaygroundAgent({ doc, win = null, surfaceId = "", postUp = () => {}, root = null, resolveSurface = null, commit = null, badge = true, isKappa = isKappaDefault } = {}) {
  if (!doc) throw new Error("createPlaygroundAgent needs a doc");
  win = win || doc.defaultView || null;
  let curRoot = null, curSurfaceId = surfaceId;        // the surface resolved for the CURRENT interaction (host mode)

  // ── Playground 3.0 canvas: the ephemeral direct-manipulation model + its dock. Play (drag · hide · delete)
  //    mutates REAL serializable bytes but NEVER seals — the κ doesn't churn while you play. Freeze reseals the
  //    arrangement through the ONE path; Reset restores the pre-play bytes. The session is PURE (runs in the
  //    Node witness with win=null); the dock is a browser-only [data-holo-ephemeral] HUD (no-op without a doc). ──
  const session = createPlaySession({ onChange: () => renderDock() });
  let dock = null, drag = null, forceEngine = null, shatter = null, gameHost = null, selUI = null, marquee = null;
  const selection = new Set();                                   // Stage 3: marquee multi-select set
  const forcesEnabled = typeof resolveSurface !== "function";   // forces/games act on a whole-document app surface, NOT shell chrome
  function renderDock() { try { if (dock) dock.render(); } catch (e) {} }
  function gameRunning() { return !!(gameHost && gameHost.isRunning()); }

  // the objects a force acts on: the surface's top-level elements (not chrome / ephemeral / script / style).
  function getObjects() {
    try {
      const rootEl = doc.body; if (!rootEl || !rootEl.children) return [];
      return [...rootEl.children].filter((c) => c && c.nodeType === 1
        && (!c.getAttribute || c.getAttribute(EPHEMERAL) === null)
        && !/^(script|style|link|meta|template)$/i.test(c.localName || c.nodeName || "")
        && !(c.className && String(c.className).startsWith("holo-pg-")));
    } catch (e) { return []; }
  }
  function ensureForces() {
    if (forceEngine || !forcesEnabled || !win || !doc || typeof doc.createElement !== "function") return;
    shatter = createShatter({ doc, win });
    forceEngine = createForceEngine({ doc, win, session, getObjects, shatter, onEnd: () => renderDock() });
  }
  function ensureGames() {
    if (gameHost || !forcesEnabled || !win || !doc || typeof doc.createElement !== "function") return;
    gameHost = createGameHost({ doc, win, getObjects });   // games run in their OWN private session — they never seal
  }
  function ensureSel() {
    if (selUI || !win || !doc || typeof doc.createElement !== "function") return;
    selUI = createSelectionUI({ doc, win, session });      // scale/rotate handles drive the SAME session (Freezable)
  }
  // marquee select / single-select bookkeeping (Stage 3). A single selection shows scale/rotate handles; a multi
  // selection outlines each member (the holo-pg-msel class is L5-stripped by cleanClass, so it never seals).
  function unpaintSel() { for (const el of selection) { try { el.classList.remove("holo-pg-msel"); } catch (e) {} } }
  function clearSelection() { unpaintSel(); selection.clear(); if (selUI) selUI.hide(); }
  function setSelection(els) {
    unpaintSel(); selection.clear(); for (const e of els) selection.add(e);
    ensureSel();
    if (selection.size === 1) { if (selUI) selUI.show([...selection][0]); }
    else { if (selUI) selUI.hide(); for (const el of selection) { try { el.classList.add("holo-pg-msel"); } catch (e) {} } }
  }
  function ensureDock() {
    if (dock || !win || !doc || typeof doc.createElement !== "function") return;
    dock = createCanvasDock({ doc, win, session,
      onFreeze: () => { if (forceEngine) forceEngine.stop(); commitEdit(); },     // settle a running force, then bake through the ONE path
      onReset: () => { if (forceEngine) forceEngine.stop(); clearSelection(); session.reset(); },    // settle, then discard
      isArmed: () => active,
      forces: forcesEnabled ? FORCES.map((f) => ({ id: f.id, label: f.label, icon: f.icon })) : [],
      onForce: (id) => { ensureForces(); if (forceEngine) forceEngine.start(id); },
      games: forcesEnabled ? GAMES.map((g) => ({ id: g.id, label: g.label, icon: g.icon })) : [],
      onGame: (id) => { ensureGames(); clearSelection(); if (gameHost) gameHost.start(id); },
    });
  }
  function afterCommit() { try { session.freeze(); } catch (e) {} renderDock(); }   // a commit reseals the live bytes ⇒ they ARE the new baseline

  // serialise a node MINUS all agent UI/decoration — the exact bytes the shell will seal (L5). A whole document
  // gets a doctype; a sub-tree (in-shell surface root) is serialised as its own element.
  function serialize(node) {
    const n = node || root || doc.documentElement;
    const isDoc = n === doc.documentElement;
    return (isDoc ? "<!doctype html>\n" : "") + serializeNode(n);
  }
  // commit an edit: in-shell calls the injected `commit` DIRECTLY (same document); in-frame hands the bytes UP.
  function commitEdit() {
    if (typeof commit === "function") {
      try {
        const id = curSurfaceId || surfaceId;
        const r = commit(id, serialize(curRoot)) || {};
        const k = r.kappa ? String(r.kappa).split(":").pop() : "";
        if (r.changed && k) toast("✦ sealed · κ " + k.slice(0, 8) + "…");
        afterCommit();           // the arrangement is now baked into the κ — drop the play backups (Reset can't undo a commit)
        return r;
      } catch (e) { return {}; }
    }
    const m = requestReseal();   // in-frame: the shell reseals the bytes we just serialised; freeze optimistically
    afterCommit();
    return m;
  }

  // the ONLY outbound effect: hand the clean source UP. The shell calls createLiveEditor.edit — the ONE path.
  function requestReseal() {
    const msg = { t: "holo-live-edit", op: "reseal", surfaceId, source: serialize() };
    try { postUp(msg); } catch (e) {}
    return msg;
  }
  // a user exit from inside a frame asks the shell to turn the GLOBAL mode off (it broadcasts back to all frames).
  function requestExit() { try { postUp({ t: "holo-live-edit", op: "playground-request", surfaceId, on: false }); } catch (e) {} }
  function userExit() { setActive(false); requestExit(); }

  // ── browser-only direct-manipulation surface (menu · inline edit · glow · toast). No-op without a window. ──
  // OFF BY DEFAULT (`active=false`): the agent is injected into every app but stays DORMANT — it does NOT glow
  // on hover, intercept right-click, or hijack double-click, so a normal app behaves normally. Playground is
  // opt-in PER SURFACE: the shell's window menu toggles it (setActive / a {op:"playground-mode"} message), and
  // it is exited from the element menu, Esc, or the badge. Only when active does direct manipulation light up.
  let menuEl = null, editorEl = null, target = null, active = false, badgeEl = null, hot = null;

  function injectStyle() {
    if (!doc.getElementById || doc.getElementById("holo-pg-style")) return;
    const st = doc.createElement("style");
    st.id = "holo-pg-style"; st.setAttribute(EPHEMERAL, "");
    st.textContent = `
      .${HOT}{outline:1.5px dashed var(--holo-accent,#5b8cff)!important;outline-offset:2px!important;cursor:context-menu!important;
        box-shadow:0 0 0 4px color-mix(in srgb,var(--holo-accent,#5b8cff) 16%,transparent)!important;border-radius:3px;transition:outline-color .12s,box-shadow .12s}
      .holo-pg-menu{position:fixed;z-index:2147483600;min-width:200px;padding:6px;border-radius:12px;
        background:var(--holo-surface,#14161b);border:1px solid var(--holo-border,#2a2f3a);color:var(--holo-ink,#eef2f6);
        box-shadow:0 18px 48px rgba(0,0,0,.5);font:0.95rem/1.4 system-ui,sans-serif;backdrop-filter:blur(9px) saturate(1.15)}
      .holo-pg-menu button{display:flex;gap:10px;align-items:center;width:100%;padding:9px 11px;border:0;border-radius:8px;
        background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
      .holo-pg-menu button:hover{background:color-mix(in srgb,var(--holo-accent,#5b8cff) 22%,transparent)}
      .holo-pg-menu .sep{height:1px;margin:5px 4px;background:var(--holo-border,#2a2f3a)}
      .holo-pg-menu .k{margin-left:auto;opacity:.5;font-size:.8em}
      .holo-pg-editor{position:fixed;z-index:2147483601;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:14px;
        width:min(560px,86vw);background:var(--holo-surface,#14161b);border:1px solid var(--holo-border,#2a2f3a);
        color:var(--holo-ink,#eef2f6);box-shadow:0 24px 64px rgba(0,0,0,.55);font:0.95rem system-ui,sans-serif}
      .holo-pg-editor textarea{min-height:200px;resize:vertical;padding:10px;border-radius:9px;border:1px solid var(--holo-border,#2a2f3a);
        background:var(--holo-bg,#0d1117);color:var(--holo-ink,#eef2f6);font:0.85rem ui-monospace,Menlo,Consolas,monospace;tab-size:2}
      .holo-pg-editor .row{display:flex;gap:8px;justify-content:flex-end}
      .holo-pg-editor button{padding:8px 16px;border-radius:8px;border:1px solid var(--holo-border,#2a2f3a);background:transparent;color:inherit;cursor:pointer;font:inherit}
      .holo-pg-editor button.go{background:var(--holo-accent,#5b8cff);border-color:transparent;color:#fff}
      .holo-pg-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483602;padding:9px 16px;border-radius:999px;
        background:var(--holo-surface,#14161b);border:1px solid var(--holo-border,#2a2f3a);color:var(--holo-ink,#eef2f6);
        box-shadow:0 12px 32px rgba(0,0,0,.45);font:0.85rem system-ui,sans-serif;opacity:0;transition:opacity .25s}
      .holo-pg-toast.show{opacity:1}
      .holo-pg-badge{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483602;padding:7px 14px;border-radius:999px;
        background:color-mix(in srgb,var(--holo-accent,#5b8cff) 22%,var(--holo-surface,#14161b));border:1px solid var(--holo-accent,#5b8cff);
        color:var(--holo-ink,#eef2f6);box-shadow:0 10px 30px rgba(0,0,0,.4);font:0.8rem system-ui,sans-serif;cursor:pointer;user-select:none;opacity:.96}
      .holo-pg-badge:hover{opacity:1}
      .holo-pg-marquee{position:fixed;z-index:2147483597;border:1.5px solid var(--holo-accent,#5b8cff);background:color-mix(in srgb,var(--holo-accent,#5b8cff) 12%,transparent);pointer-events:none;border-radius:2px}
      .holo-pg-msel{outline:1.5px solid var(--holo-accent,#5b8cff)!important;outline-offset:2px!important;border-radius:3px}`;
    (doc.head || doc.documentElement).appendChild(st);
  }

  const inUI = (el) => { try { return !!(el && el.closest && el.closest(".holo-pg-menu,.holo-pg-editor,.holo-pg-toast,.holo-pg-dock,.holo-pg-sel,.holo-pg-hud")); } catch (e) { return false; } };

  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function closeEditor() { if (editorEl) { editorEl.remove(); editorEl = null; } }

  let toastEl = null, toastT = 0;
  function toast(text) {
    if (!toastEl) { toastEl = doc.createElement("div"); toastEl.className = "holo-pg-toast"; toastEl.setAttribute(EPHEMERAL, ""); doc.body.appendChild(toastEl); }
    toastEl.textContent = text;
    requestAnimationFrame(() => toastEl && toastEl.classList.add("show"));
    if (win) { win.clearTimeout(toastT); toastT = win.setTimeout(() => toastEl && toastEl.classList.remove("show"), 2200); }
  }

  // every direct-manipulation verb mutates the LIVE DOM, then reseals for the new κ (mutate-in-place pattern).
  function actEdit() { closeMenu(); openSourceEditor(target); }
  function actText() {
    closeMenu(); if (!target) return;
    try {
      target.setAttribute("contenteditable", "true"); target.focus();
      const done = () => { try { target.removeAttribute("contenteditable"); } catch (e) {} target.removeEventListener("blur", done); commitEdit(); };
      target.addEventListener("blur", done);
    } catch (e) {}
  }
  function actDuplicate() { closeMenu(); try { const c = target.cloneNode(true); target.parentNode.insertBefore(c, target.nextSibling); commitEdit(); } catch (e) {} }
  // direct-manipulation verbs are PLAY: ephemeral, tracked by the session, resolved by Freeze (bake) or Reset (restore).
  function actHide() { closeMenu(); try { if (target) session.hide(target); } catch (e) {} }
  function actDelete() { closeMenu(); try { if (target) session.del(target); } catch (e) {} }   // undoable until Freeze (was: immediate)
  function actFreeze() { closeMenu(); commitEdit(); }
  function actReset() { closeMenu(); try { session.reset(); } catch (e) {} }

  function openSourceEditor(el) {
    if (!el || !win) return;
    closeEditor();
    editorEl = doc.createElement("div"); editorEl.className = "holo-pg-editor"; editorEl.setAttribute(EPHEMERAL, "");
    const ta = doc.createElement("textarea"); ta.value = serializeNode(el);
    const row = doc.createElement("div"); row.className = "row";
    const cancel = doc.createElement("button"); cancel.textContent = "Cancel"; cancel.onclick = closeEditor;
    const apply = doc.createElement("button"); apply.className = "go"; apply.textContent = "Apply ✦";
    apply.onclick = () => {
      try {
        const tmp = doc.createElement("template"); tmp.innerHTML = ta.value;
        const frag = tmp.content || tmp; const nodes = [...(frag.childNodes || [])];
        if (nodes.length) { for (const nn of nodes) el.parentNode.insertBefore(nn.cloneNode(true), el); el.remove(); }
      } catch (e) {}
      closeEditor(); commitEdit();
    };
    row.appendChild(cancel); row.appendChild(apply);
    editorEl.appendChild(ta); editorEl.appendChild(row);
    doc.body.appendChild(editorEl);
    const w = editorEl.offsetWidth, h = editorEl.offsetHeight;
    editorEl.style.left = Math.max(10, (win.innerWidth - w) / 2) + "px";
    editorEl.style.top = Math.max(10, (win.innerHeight - h) / 2) + "px";
    ta.focus();
  }

  function openMenu(x, y) {
    closeMenu();
    menuEl = doc.createElement("div"); menuEl.className = "holo-pg-menu"; menuEl.setAttribute(EPHEMERAL, "");
    const item = (label, fn, hint) => {
      const b = doc.createElement("button"); b.innerHTML = label + (hint ? `<span class="k">${hint}</span>` : "");
      b.onclick = fn; menuEl.appendChild(b);
    };
    const sep = () => { const s = doc.createElement("div"); s.className = "sep"; menuEl.appendChild(s); };
    item("✎&nbsp; Edit source", actEdit);
    item("✏️&nbsp; Edit text", actText, "dbl-click");
    item("⎘&nbsp; Duplicate", actDuplicate);
    item("◻&nbsp; Hide", actHide);
    sep();
    item("🅺&nbsp; View κ", () => { closeMenu(); toast("κ updates on Freeze — play freely, then Freeze to keep"); });
    item("⌫&nbsp; Delete", actDelete, "drag to move");
    if (!session.isEmpty()) { sep(); item("✦&nbsp; Freeze layout", actFreeze, String(session.count())); item("↺&nbsp; Reset", actReset); }
    sep();
    item("✕&nbsp; Exit Playground", () => { closeMenu(); userExit(); });
    doc.body.appendChild(menuEl);
    const w = menuEl.offsetWidth || 200, h = menuEl.offsetHeight || 240;
    menuEl.style.left = Math.min(x, (win ? win.innerWidth : 1e4) - w - 8) + "px";
    menuEl.style.top = Math.min(y, (win ? win.innerHeight : 1e4) - h - 8) + "px";
  }

  // host mode: resolve the surface (and its serialise root) for an element; null ⇒ not editable (shell chrome) ⇒ ignore.
  function resolveFor(el) {
    if (typeof resolveSurface !== "function") return true;     // in-frame mode: the whole document is editable
    const s = resolveSurface(el); if (!s) return false;
    curSurfaceId = s.surfaceId; curRoot = s.root || null; return true;
  }
  function onContextMenu(e) {
    if (!active || gameRunning()) return;   // DORMANT (or a game owns input): let the native right-click work
    if (inUI(e.target)) return;            // let the agent's own UI use the native menu
    if (!resolveFor(e.target)) return;     // host mode: chrome / non-surface → native right-click
    e.preventDefault(); e.stopPropagation();
    target = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
    if (target) openMenu(e.clientX, e.clientY);
  }
  function onDblClick(e) { if (!active || gameRunning() || inUI(e.target)) return; if (!resolveFor(e.target)) return; target = e.target && e.target.nodeType === 1 ? e.target : null; if (target) actText(); }
  function onKeyDown(e) {
    if (e.key !== "Escape") return;
    if (gameRunning()) { gameHost.stop(); return; }          // Esc backs out one layer at a time: game → menu → selection → exit
    if (menuEl || editorEl) { closeMenu(); closeEditor(); return; }
    if (selection.size) { clearSelection(); return; }
    if (active) userExit();
  }
  function onOver(e) { if (!active || (drag && drag.moved)) return; const t = e.target; if (inUI(t) || t === hot || !t || t.nodeType !== 1) return; if (typeof resolveSurface === "function" && !resolveSurface(t)) return; if (hot) hot.classList.remove(HOT); hot = t; try { t.classList.add(HOT); } catch (x) {} }
  function onOut(e) { if (e.target === hot && hot) { hot.classList.remove(HOT); hot = null; } }

  // ── direct manipulation (Stage 1 + 3): a primary-button drag MOVES an element (or the whole multi-selection);
  //    a drag on the BACKGROUND draws a marquee that multi-selects; a plain click selects ONE element (→ scale /
  //    rotate handles). All ephemeral — the dock's Freeze bakes the arrangement, Reset restores it. ─────────────
  function isBackground(t) { return t === doc.body || t === doc.documentElement; }
  function dragStart(e) {
    if (!active || e.button !== 0 || inUI(e.target) || gameRunning()) return;   // a running game owns taps
    if (!resolveFor(e.target)) return;                       // chrome / non-editable surface → no drag
    if (isBackground(e.target)) { marquee = { sx: e.clientX, sy: e.clientY, box: null, moved: false, rect: null }; return; }
    const el = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
    if (!el) return;
    if (selection.size > 1 && selection.has(el)) {           // grabbing inside a multi-selection → move the whole group
      drag = { group: [...selection].map((g) => ({ el: g, x0: session.transformOf(g).x, y0: session.transformOf(g).y })), sx: e.clientX, sy: e.clientY, moved: false };
    } else {
      const base = session.transformOf(el);
      drag = { el, sx: e.clientX, sy: e.clientY, x0: base.x, y0: base.y, moved: false };
    }
  }
  function dragMove(e) {
    if (marquee) return updateMarquee(e);
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved) { if (Math.hypot(dx, dy) < 4) return; drag.moved = true; closeMenu(); if (hot) { try { hot.classList.remove(HOT); } catch (x) {} hot = null; } if (selUI && !drag.group) selUI.hide(); }
    if (drag.group) { for (const g of drag.group) session.setTransform(g.el, { x: g.x0 + dx, y: g.y0 + dy }); }
    else session.setTransform(drag.el, { x: drag.x0 + dx, y: drag.y0 + dy });
    try { e.preventDefault(); } catch (x) {}
  }
  function dragEnd(e) {
    if (marquee) { finishMarquee(); marquee = null; try { e.preventDefault(); } catch (x) {} return; }
    if (!drag) return;
    const moved = drag.moved, single = drag.el;
    drag = null;
    if (moved) { try { e.preventDefault(); e.stopPropagation(); } catch (x) {} if (selUI && selection.size === 1) selUI.refresh(); }
    else if (single) setSelection([single]);                 // a plain click selects one element → scale/rotate handles
  }

  // ── marquee: a background drag rubber-bands a selection rectangle, then selects every object it touches. ──
  function updateMarquee(e) {
    if (!marquee.moved && Math.hypot(e.clientX - marquee.sx, e.clientY - marquee.sy) < 4) return;
    marquee.moved = true;
    const x = Math.min(marquee.sx, e.clientX), y = Math.min(marquee.sy, e.clientY), w = Math.abs(e.clientX - marquee.sx), h = Math.abs(e.clientY - marquee.sy);
    if (!marquee.box) { marquee.box = doc.createElement("div"); marquee.box.className = "holo-pg-marquee"; marquee.box.setAttribute(EPHEMERAL, ""); doc.body.appendChild(marquee.box); }
    marquee.box.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    marquee.rect = { left: x, top: y, right: x + w, bottom: y + h };
    try { e.preventDefault(); } catch (x) {}
  }
  function finishMarquee() {
    if (marquee.box) { try { marquee.box.remove(); } catch (e) {} }
    if (marquee.moved && marquee.rect) {
      const hits = getObjects().filter((el) => { try { return rectsIntersect(marquee.rect, el.getBoundingClientRect()); } catch (x) { return false; } });
      if (hits.length) setSelection(hits); else clearSelection();
    } else clearSelection();                                  // a background click clears the selection
  }

  function onPointerDown(e) { if (menuEl && !inUI(e.target)) closeMenu(); dragStart(e); }
  function onDown(e) {   // host → frame messages: toggle Playground mode, or the resulting κ after a reseal
    const m = e && e.data;
    if (!m || m.t !== "holo-live-edit") return;
    if (m.op === "playground-mode" && (m.surfaceId === surfaceId || m.surfaceId == null)) { setActive(!!m.on); return; }
    if (m.op === "sealed" && m.surfaceId === surfaceId) {
      const k = String(m.kappa || "").split(":").pop() || "";
      if (m.changed) toast("✦ sealed · κ " + k.slice(0, 8) + "…");
    }
  }

  // ── the opt-in switch. OFF by default; the shell's window menu turns it ON for a surface. ──
  function showBadge() {
    if (!badge || !doc.body || typeof doc.createElement !== "function" || badgeEl) return;
    badgeEl = doc.createElement("div"); badgeEl.className = "holo-pg-badge"; badgeEl.setAttribute(EPHEMERAL, "");
    badgeEl.textContent = "✦ Playground · right-click to edit · Esc to exit";
    badgeEl.title = "Exit Playground"; badgeEl.onclick = () => userExit();
    doc.body.appendChild(badgeEl);
  }
  function hideBadge() { if (badgeEl) { badgeEl.remove(); badgeEl = null; } }
  function setActive(on) {
    on = !!on;
    if (on === active) return active;
    active = on;
    if (!on) {
      closeMenu(); closeEditor(); if (hot) { try { hot.classList.remove(HOT); } catch (e) {} hot = null; }
      drag = null; marquee = null; if (gameHost) { try { gameHost.stop(); } catch (e) {} } if (forceEngine) { try { forceEngine.stop(); } catch (e) {} }
      clearSelection();
      try { session.reset(); } catch (e) {}                // exiting without Freeze discards the arrangement (play is ephemeral)
      renderDock(); hideBadge();
    } else { ensureDock(); ensureForces(); ensureGames(); renderDock(); showBadge(); }   // the armed dock shows Forces + Games
    return active;
  }
  function isActive() { return active; }

  function mount() {
    if (!win || !doc || !doc.addEventListener) return false;
    if (doc.getElementById && doc.getElementById("holo-pg-style")) return true;
    injectStyle(); ensureDock(); ensureForces();
    doc.addEventListener("contextmenu", onContextMenu, true);
    doc.addEventListener("dblclick", onDblClick, true);
    doc.addEventListener("keydown", onKeyDown, true);
    doc.addEventListener("pointerover", onOver, true);
    doc.addEventListener("pointerout", onOut, true);
    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("pointermove", dragMove, true);
    doc.addEventListener("pointerup", dragEnd, true);
    win.addEventListener("message", onDown);
    return true;
  }
  function unmount() {
    if (!doc || !doc.removeEventListener) return;
    closeMenu(); closeEditor();
    drag = null; marquee = null; if (gameHost) { try { gameHost.stop(); } catch (e) {} } if (forceEngine) { try { forceEngine.stop(); } catch (e) {} }
    clearSelection(); try { session.reset(); } catch (e) {} if (dock) { try { dock.remove(); } catch (e) {} dock = null; }
    doc.removeEventListener("contextmenu", onContextMenu, true);
    doc.removeEventListener("dblclick", onDblClick, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("pointerover", onOver, true);
    doc.removeEventListener("pointerout", onOut, true);
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("pointermove", dragMove, true);
    doc.removeEventListener("pointerup", dragEnd, true);
    if (win) win.removeEventListener("message", onDown);
    const s = doc.getElementById && doc.getElementById("holo-pg-style"); if (s) s.remove();
  }

  return { mount, unmount, serialize, requestReseal, onContextMenu, setActive, isActive, commitEdit, playSession: session, forces: FORCES, describe: () => ({
    is: "the in-frame Holo Playground agent — makes every element in a holo app right-click-editable AND directly manipulable (drag · hide · delete)",
    default: "OFF — dormant until opted in per surface (the shell window menu toggles it); no hover glow / right-click hijack while off",
    onePath: "the agent NEVER seals; it serialises (ephemeral-stripped, L5) and hands the bytes UP — the shell calls createLiveEditor.edit",
    play: "direct manipulation is EPHEMERAL — move/hide/delete mutate real bytes but don't seal; Freeze reseals through the ONE path, Reset restores (the L5 play rule)",
  }) };
}

// ── createPlaygroundHost — the SHELL half. Receives the in-frame agent's reseal and routes it to the ONE ──
// primitive. Verifies the message came from the actual mounted surface frame (un-forgeable identity, since a
// srcdoc frame's origin is "null"), records lineage as an OUT-OF-BAND prov edge (NOT inside the κ — that would
// break content-addressing / the κ-memo no-op), and posts the resulting κ back so the loop closes visibly.
//   { editor (createLiveEditor), frameFor(id)->window, beforeEdit?(id), onLineage?(edge), replyTo?(id,msg) }
export function createPlaygroundHost({ editor, frameFor, beforeEdit = null, onLineage = null, replyTo = null } = {}) {
  if (!editor || typeof editor.edit !== "function") throw new Error("createPlaygroundHost needs an editor (createLiveEditor)");
  function handle(ev) {
    const msg = ev && ev.data;
    if (!msg || msg.t !== "holo-live-edit" || msg.op !== "reseal") return null;
    const id = msg.surfaceId;
    const frame = typeof frameFor === "function" ? frameFor(id) : null;
    if (!frame || ev.source !== frame) return { rejected: true, reason: "origin: message source is not the mounted surface frame", id };
    const prior = typeof editor.kappaOf === "function" ? editor.kappaOf(id) : null;
    if (typeof beforeEdit === "function") { try { beforeEdit(id); } catch (e) {} }   // shell flags in-place: reseal κ, no reload
    const r = editor.edit(id, String(msg.source || ""));
    let lineage = null;
    if (r && r.ok && r.changed && prior) {
      lineage = { "@context": { prov: "http://www.w3.org/ns/prov#" }, "@type": "prov:Derivation", "prov:generated": r.kappa, "prov:wasDerivedFrom": prior };
      if (typeof onLineage === "function") { try { onLineage(lineage); } catch (e) {} }
    }
    if (r && r.ok && typeof replyTo === "function") { try { replyTo(id, { t: "holo-live-edit", op: "sealed", surfaceId: id, kappa: r.kappa, changed: !!r.changed }); } catch (e) {} }
    return { ...r, prior, lineage };
  }
  return { handle };
}

export default { createPlaygroundAgent, createPlaygroundHost };
