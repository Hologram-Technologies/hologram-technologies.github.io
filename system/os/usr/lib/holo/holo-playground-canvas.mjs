// holo-playground-canvas.mjs — Holo Playground 3.0, the CANVAS layer: when Playground is armed every element
// becomes directly manipulable — grab it, drag it, hide it, delete it — as effortlessly as child's play. This
// is the "play is ephemeral, Freeze commits" spine (the L5 rule): direct manipulation mutates the LIVE DOM but
// does NOT reseal, so the κ does not churn while you play. A tornado that scatters the screen and is dismissed
// leaves the κ unchanged (Reset); only an explicit Freeze writes the new arrangement into the source → a new κ
// through the ONE primitive (createLiveEditor, ADR-0093). The agent owns the pointer wiring; THIS owns the model.
//
// THE TWO HALVES (the Atlas discipline — a pure core + a browser-only skin over the SAME state):
//   createPlaySession — PURE + isomorphic: every play op snapshots the element's pre-play state, mutates a REAL
//     serializable attribute (inline `style` for move/hide, structural removal for delete), and reset() restores
//     it byte-for-byte. No window, no rAF — a Node witness drives it over a deterministic mock DOM. The move/hide
//     bytes are REAL inline styles, so the agent's existing serialize() (ephemeral-stripped, L5) bakes them into
//     the κ on Freeze with ZERO play-chrome, and a no-Freeze Reset returns to the exact prior bytes.
//   createCanvasDock — browser-only [data-holo-ephemeral] HUD (counts · Freeze ✦ · Reset · a tray to un-hide).
//     Pure no-op without a document, so it never enters the witness or the sealed κ.
//
// Direct manipulation = PLAY (ephemeral, tracked here). Code editing (Edit source / Edit text) stays an explicit
// immediate κ-edit in the agent — a different verb. ANY commit (the Freeze button, or an explicit code Apply)
// reseals the live bytes and then calls session.freeze() so the current arrangement becomes the new baseline.

const EPHEMERAL = "data-holo-ephemeral";

// ── pure style-attribute helpers — operate on the REAL `style` attribute (what serialize() sees), so a move is
//    content the κ captures on Freeze. Witnessable: they only touch get/set/removeAttribute. ──────────────────
export function parseStyle(cssText) {
  const out = {};
  for (const decl of String(cssText || "").split(";")) {
    const i = decl.indexOf(":"); if (i < 0) continue;
    const k = decl.slice(0, i).trim(); const v = decl.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}
export function formatStyle(obj) {
  return Object.keys(obj).filter((k) => obj[k] != null && obj[k] !== "").map((k) => `${k}: ${obj[k]}`).join("; ");
}
export function getStyleProp(el, prop) { return parseStyle(el && el.getAttribute ? el.getAttribute("style") : "")[prop] || ""; }
// set (or, when value is null/"", remove) ONE declaration, preserving every other inline style. Empty result ⇒
// drop the attribute entirely so a reset-to-clean element === the pristine source (no stray style="" residue).
export function setStyleProp(el, prop, value) {
  if (!el || !el.setAttribute) return;
  const o = parseStyle(el.getAttribute ? el.getAttribute("style") : "");
  if (value == null || value === "") delete o[prop]; else o[prop] = value;
  const css = formatStyle(o);
  if (css) el.setAttribute("style", css);
  else if (el.removeAttribute) el.removeAttribute("style"); else el.setAttribute("style", "");
}

// ── pure selection + handle geometry (Stage 3) — witnessed; the browser handle/marquee chrome calls these. ──
// do two axis-aligned rects overlap? (marquee hit-test against an element rect). Touching edges don't count.
export function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
// uniform scale factor from dragging a corner: how much the corner's distance from the box centre grew. Clamped
// so an object can't invert or vanish. start/cur are pointer points; centre is the box centre.
export function scaleFromHandle(start, cur, centre, base = 1, min = 0.2, max = 6) {
  const d0 = Math.hypot(start.x - centre.x, start.y - centre.y) || 1;
  const d1 = Math.hypot(cur.x - centre.x, cur.y - centre.y);
  return Math.max(min, Math.min(max, base * (d1 / d0)));
}
// absolute rotation (deg) of a pointer around a centre; pair with a start angle for a relative drag.
export function angleOf(centre, p) { return Math.atan2(p.y - centre.y, p.x - centre.x) * 180 / Math.PI; }
export function rotateFromPointer(centre, start, cur, base = 0) { return base + (angleOf(centre, cur) - angleOf(centre, start)); }

// compose the play transform from the parts we track (Stage 1 uses x/y; Stage 3 handles add scale/rot).
// Identity parts are omitted so a zeroed move leaves NO transform decl (clean reset).
export function composeTransform({ x = 0, y = 0, scale = 1, rot = 0 } = {}) {
  const p = [];
  if (x || y) p.push(`translate(${x}px, ${y}px)`);
  if (rot) p.push(`rotate(${rot}deg)`);
  if (scale !== 1) p.push(`scale(${scale})`);
  return p.join(" ");
}

// ── createPlaySession — the ephemeral direct-manipulation model. PURE (no win/doc). ─────────────────────────
// onChange() fires after every op so the dock can re-render its counts.
export function createPlaySession({ onChange = () => {} } = {}) {
  const styled = new Map();   // el → original `style` attribute (string | null) — snapshot before the FIRST style mutation
  const tf = new Map();       // el → { x, y, scale, rot } — accumulated transform for a moved element
  const hidden = new Set();   // currently hidden elements (for the dock's un-hide tray)
  const deleted = [];         // { el, parent, next } in deletion order — for ordered re-insertion on reset

  let muted = false;   // a running force ticks setTransform ~60fps; mute the onChange so the dock isn't rebuilt per frame
  function backup(el) { if (el && !styled.has(el)) styled.set(el, el.getAttribute ? el.getAttribute("style") : null); }
  function fire() { if (muted) return; try { onChange(); } catch (e) {} }

  // move/transform: accumulate the delta and re-apply ONE transform decl. setTransform replaces; nudge adds.
  function setTransform(el, t) {
    if (!el) return; backup(el);
    const cur = tf.get(el) || { x: 0, y: 0, scale: 1, rot: 0 };
    const next = { ...cur, ...t }; tf.set(el, next);
    setStyleProp(el, "transform", composeTransform(next));
    fire();
  }
  function nudge(el, dx, dy) { const c = tf.get(el) || { x: 0, y: 0, scale: 1, rot: 0 }; setTransform(el, { x: c.x + dx, y: c.y + dy }); }

  function hide(el) { if (!el) return; backup(el); setStyleProp(el, "display", "none"); hidden.add(el); fire(); }
  function show(el) {
    if (!el) return; hidden.delete(el);
    // restore display from the backup (so an element that had its own display keeps it); if untracked, just clear.
    if (styled.has(el)) { const css = styled.get(el); const had = parseStyle(css)["display"]; setStyleProp(el, "display", had || null); }
    else setStyleProp(el, "display", null);
    fire();
  }

  function del(el) {
    if (!el || !el.parentNode) return;
    deleted.push({ el, parent: el.parentNode, next: el.nextSibling || null });
    try { el.remove ? el.remove() : el.parentNode.removeChild(el); } catch (e) {}
    fire();
  }

  // reset — discard ALL pending play, restoring the exact pre-play bytes. Structural undo first (re-insert deleted
  // in reverse so earlier siblings exist as anchors), then style restore (attribute back to its snapshot).
  function reset() {
    for (let i = deleted.length - 1; i >= 0; i--) {
      const d = deleted[i];
      try { d.parent.insertBefore(d.el, d.next); } catch (e) {}
    }
    deleted.length = 0;
    for (const [el, css] of styled) {
      try { if (css == null) { el.removeAttribute ? el.removeAttribute("style") : el.setAttribute("style", ""); } else el.setAttribute("style", css); } catch (e) {}
    }
    styled.clear(); tf.clear(); hidden.clear();
    fire();
  }

  // freeze — the live bytes ARE now the baseline (the agent reseals them through the ONE path right before/after).
  // Drop the backups so a later Reset can't undo a committed arrangement — but KEEP tf, so transformOf still reports
  // the baked transform and a SUBSEQUENT drag/scale composes from it instead of clobbering it. NOTHING is sealed here.
  function freeze() { styled.clear(); hidden.clear(); deleted.length = 0; fire(); }   // tf retained: the frozen transform is the new base

  const count = () => styled.size + deleted.length;   // distinct touched elements + deletions
  return {
    setTransform, nudge, hide, show, del, reset, freeze,
    transformOf: (el) => ({ x: 0, y: 0, scale: 1, rot: 0, ...(tf.get(el) || {}) }),   // current play-transform (for drag accumulation)
    setMuted: (on) => { muted = !!on; },                                              // a force mutes the per-frame onChange
    isHidden: (el) => hidden.has(el),
    hiddenList: () => [...hidden],
    count, isEmpty: () => count() === 0,
    describe: () => ({
      is: "the ephemeral direct-manipulation model — move/hide/delete mutate REAL serializable bytes but never seal",
      rule: "play is ephemeral; Freeze writes the arrangement into the κ through the ONE primitive; Reset restores pre-play bytes",
    }),
  };
}

// ── createCanvasDock — the browser-only ephemeral HUD. No-op (returns inert stubs) without a document. ───────
// Surfaces the pending-play count and the two verbs that resolve it: Freeze ✦ (commit) and Reset (discard), plus
// a tray to bring hidden objects back. Marked [data-holo-ephemeral] so serialize() strips it — never in the κ.
export function createCanvasDock({ doc, win = null, session, onFreeze = () => {}, onReset = () => {}, label = (en) => en,
  forces = [], onForce = () => {}, games = [], onGame = () => {}, isArmed = () => false } = {}) {
  if (!doc || typeof doc.createElement !== "function") return { render: () => {}, remove: () => {}, mounted: () => false };
  win = win || doc.defaultView || null;
  let el = null;

  function ensureStyle() {
    if (!doc.getElementById || doc.getElementById("holo-pg-dock-style")) return;
    const st = doc.createElement("style"); st.id = "holo-pg-dock-style"; st.setAttribute(EPHEMERAL, "");
    st.textContent = `
      .holo-pg-dock{position:fixed;right:18px;bottom:18px;z-index:2147483602;display:flex;flex-direction:column;gap:10px;
        padding:14px 16px;border-radius:16px;min-width:248px;background:var(--holo-surface,#14161b);
        border:1px solid var(--holo-border,#2a2f3a);color:var(--holo-ink,#eef2f6);
        box-shadow:0 20px 56px rgba(0,0,0,.5);font:1rem/1.5 system-ui,sans-serif;backdrop-filter:blur(10px) saturate(1.15)}
      .holo-pg-dock .hd{display:flex;align-items:center;gap:10px;font-weight:600}
      .holo-pg-dock .hd .n{margin-left:auto;font-variant-numeric:tabular-nums;opacity:.7;font-size:.95em}
      .holo-pg-dock .row{display:flex;gap:10px}
      .holo-pg-dock button{flex:1;padding:11px 14px;border-radius:11px;border:1px solid var(--holo-border,#2a2f3a);
        background:transparent;color:inherit;font:inherit;cursor:pointer;min-height:44px}
      .holo-pg-dock button:hover{background:color-mix(in srgb,var(--holo-accent,#5b8cff) 18%,transparent)}
      .holo-pg-dock button.go{background:var(--holo-accent,#5b8cff);border-color:transparent;color:#fff;font-weight:600}
      .holo-pg-dock .tray{display:flex;flex-wrap:wrap;gap:8px;max-height:132px;overflow:auto}
      .holo-pg-dock .chip{padding:7px 11px;border-radius:999px;border:1px solid var(--holo-border,#2a2f3a);
        background:color-mix(in srgb,var(--holo-accent,#5b8cff) 10%,transparent);cursor:pointer;font-size:.9em}
      .holo-pg-dock .chip:hover{background:color-mix(in srgb,var(--holo-accent,#5b8cff) 26%,transparent)}
      .holo-pg-dock .forces{display:flex;flex-wrap:wrap;gap:8px}
      .holo-pg-dock .forces button{flex:0 0 auto;min-width:0;min-height:40px;padding:9px 12px;font-size:.95em}
      .holo-pg-dock .hint{opacity:.6;font-size:.85em}`;
    (doc.head || doc.documentElement).appendChild(st);
  }

  const elName = (n) => { try { const t = (n.localName || n.nodeName || "node").toLowerCase(); const id = n.id ? "#" + n.id : ""; return t + id; } catch (e) { return "object"; } };
  let showForces = false, showGames = false;

  function render() {
    const armed = !!isArmed();
    const pending = session && !session.isEmpty();
    if (!armed && !pending) { remove(); return; }   // dormant: no dock at all
    ensureStyle();
    if (!el) { el = doc.createElement("div"); el.className = "holo-pg-dock"; el.setAttribute(EPHEMERAL, ""); (doc.body || doc.documentElement).appendChild(el); }
    const n = session ? session.count() : 0;
    const hid = session ? session.hiddenList() : [];
    el.textContent = "";

    const hd = doc.createElement("div"); hd.className = "hd";
    hd.innerHTML = `<span>✦ ${label("Playground")}</span>` + (pending ? `<span class="n">${n} ${label(n === 1 ? "change" : "changes")}</span>` : `<span class="n">${label("armed")}</span>`);
    el.appendChild(hd);

    // FORCES + GAMES — data-driven launchers (in-frame surfaces only). One tap unleashes a tornado, or starts a game.
    if ((forces && forces.length) || (games && games.length)) {
      const top = doc.createElement("div"); top.className = "row";
      if (forces && forces.length) { const fb = doc.createElement("button"); fb.type = "button"; fb.textContent = "🌪 " + label("Forces"); fb.onclick = () => { showForces = !showForces; showGames = false; render(); }; top.appendChild(fb); }
      if (games && games.length) { const gb = doc.createElement("button"); gb.type = "button"; gb.textContent = "🎮 " + label("Games"); gb.onclick = () => { showGames = !showGames; showForces = false; render(); }; top.appendChild(gb); }
      el.appendChild(top);
      if (showForces) {
        const grid = doc.createElement("div"); grid.className = "forces";
        for (const f of forces) { const b = doc.createElement("button"); b.type = "button"; b.title = f.label; b.textContent = (f.icon || "✦") + " " + label(f.label); b.onclick = () => { showForces = false; try { onForce(f.id); } catch (e) {} render(); }; grid.appendChild(b); }
        el.appendChild(grid);
        const hint = doc.createElement("div"); hint.className = "hint"; hint.textContent = label("Play freely — then Freeze to keep, or Reset"); el.appendChild(hint);
      }
      if (showGames) {
        const grid = doc.createElement("div"); grid.className = "forces";
        for (const g of games) { const b = doc.createElement("button"); b.type = "button"; b.title = g.label; b.textContent = (g.icon || "🎮") + " " + label(g.label); b.onclick = () => { showGames = false; try { onGame(g.id); } catch (e) {} render(); }; grid.appendChild(b); }
        el.appendChild(grid);
        const hint = doc.createElement("div"); hint.className = "hint"; hint.textContent = label("A game plays on your objects — it never changes them"); el.appendChild(hint);
      }
    }

    if (hid.length) {
      const tray = doc.createElement("div"); tray.className = "tray";
      for (const h of hid) { const c = doc.createElement("button"); c.className = "chip"; c.type = "button"; c.textContent = "👁 " + elName(h); c.onclick = () => { try { session.show(h); } catch (e) {} render(); }; tray.appendChild(c); }
      el.appendChild(tray);
    }

    if (pending) {
      const row = doc.createElement("div"); row.className = "row";
      const reset = doc.createElement("button"); reset.type = "button"; reset.textContent = label("Reset"); reset.onclick = () => { try { onReset(); } catch (e) {} render(); };
      const freeze = doc.createElement("button"); freeze.type = "button"; freeze.className = "go"; freeze.textContent = label("Freeze") + " ✦"; freeze.onclick = () => { try { onFreeze(); } catch (e) {} render(); };
      row.appendChild(reset); row.appendChild(freeze); el.appendChild(row);
    }
  }
  function remove() { showForces = false; showGames = false; if (el) { try { el.remove(); } catch (e) {} el = null; } }
  return { render, remove, mounted: () => !!el };
}

// ── createSelectionUI — browser-only. A handle box over ONE selected element: drag a corner to SCALE, the knob
//    to ROTATE. Drives the SAME ephemeral session (Stage 1), so a resize/rotate is Freezable + Resettable like a
//    move. No-op without a document; marked [data-holo-ephemeral] so it never seals. ───────────────────────────
export function createSelectionUI({ doc, win = null, session } = {}) {
  if (!doc || typeof doc.createElement !== "function") return { show: () => {}, hide: () => {}, refresh: () => {}, mounted: () => false };
  win = win || doc.defaultView || null;
  let box = null, target = null, drag = null;

  function ensureStyle() {
    if (doc.getElementById("holo-pg-sel-style")) return;
    const st = doc.createElement("style"); st.id = "holo-pg-sel-style"; st.setAttribute(EPHEMERAL, "");
    st.textContent = `
      .holo-pg-sel{position:fixed;z-index:2147483598;border:1.5px solid var(--holo-accent,#5b8cff);pointer-events:none;border-radius:3px}
      .holo-pg-sel .h{position:absolute;width:16px;height:16px;border-radius:50%;background:var(--holo-accent,#5b8cff);
        border:2px solid #fff;pointer-events:auto;cursor:nwse-resize;box-shadow:0 2px 8px rgba(0,0,0,.4)}
      .holo-pg-sel .h.tl{left:-9px;top:-9px}.holo-pg-sel .h.tr{right:-9px;top:-9px}.holo-pg-sel .h.bl{left:-9px;bottom:-9px}.holo-pg-sel .h.br{right:-9px;bottom:-9px}
      .holo-pg-sel .rot{position:absolute;left:50%;top:-34px;transform:translateX(-50%);width:18px;height:18px;border-radius:50%;
        background:var(--holo-surface,#14161b);border:2px solid var(--holo-accent,#5b8cff);pointer-events:auto;cursor:grab}
      .holo-pg-sel .stem{position:absolute;left:50%;top:-18px;width:2px;height:18px;background:var(--holo-accent,#5b8cff);transform:translateX(-50%)}`;
    (doc.head || doc.documentElement).appendChild(st);
  }
  const rectOf = (el) => { try { return el.getBoundingClientRect(); } catch (e) { return { left: 0, top: 0, width: 40, height: 24, right: 40, bottom: 24 }; } };
  const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  function show(el) {
    target = el; ensureStyle();
    if (!box) {
      box = doc.createElement("div"); box.className = "holo-pg-sel"; box.setAttribute(EPHEMERAL, "");
      box.innerHTML = `<div class="stem"></div><div class="rot" data-h="rot"></div><div class="h tl" data-h="scale"></div><div class="h tr" data-h="scale"></div><div class="h bl" data-h="scale"></div><div class="h br" data-h="scale"></div>`;
      (doc.body || doc.documentElement).appendChild(box);
      for (const h of [...box.querySelectorAll("[data-h]")]) h.addEventListener("pointerdown", (e) => onHandleDown(e, h.getAttribute("data-h")));
    }
    refresh();
  }
  function refresh() {
    if (!box || !target) return;
    const r = rectOf(target);
    box.style.left = r.left + "px"; box.style.top = r.top + "px"; box.style.width = r.width + "px"; box.style.height = r.height + "px";
  }
  function onHandleDown(e, kind) {
    if (!target) return;
    e.preventDefault(); e.stopPropagation();
    const r = rectOf(target); const c = centre(r); const base = session.transformOf(target);
    drag = { kind, c, start: { x: e.clientX, y: e.clientY }, baseScale: base.scale, baseRot: base.rot };
    const mv = (ev) => onHandleMove(ev), up = () => { drag = null; win.removeEventListener("pointermove", mv, true); win.removeEventListener("pointerup", up, true); };
    win.addEventListener("pointermove", mv, true); win.addEventListener("pointerup", up, true);
  }
  function onHandleMove(e) {
    if (!drag || !target) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (drag.kind === "scale") session.setTransform(target, { scale: scaleFromHandle(drag.start, cur, drag.c, drag.baseScale) });
    else session.setTransform(target, { rot: rotateFromPointer(drag.c, drag.start, cur, drag.baseRot) });
    refresh();
  }
  function hide() { drag = null; if (box) { try { box.remove(); } catch (e) {} box = null; } target = null; }
  return { show, refresh, hide, mounted: () => !!box, target: () => target };
}

export default { createPlaySession, createCanvasDock, createSelectionUI, parseStyle, formatStyle, getStyleProp, setStyleProp, composeTransform, rectsIntersect, scaleFromHandle, rotateFromPointer, angleOf };
