// holo-auto.js — NATIVE in-holospace mouse/pointer automation. Not Playwright/Puppeteer: those
// are external Node drivers (a server process controlling a browser over CDP) — they cannot run
// in a tab and are not serverless. This runs IN the holospace on the web platform's own synthetic
// PointerEvents + a visible automated cursor: move · click · drag · type, all in-page, 100%
// serverless. A MACRO is an ordered list of steps that CONTENT-ADDRESSES to a did:holo — record
// a sequence, share the holo://κ, and a peer replays the EXACT automation, re-derived (Law L5).
// The unlock no prior browser app had: automation as a verifiable, shareable object.
//
// Isomorphic: the macro model (compile/canonicalize) is pure (node-testable); the cursor + event
// dispatch attach in the browser. Dependency-free (Law L4).

// compileRecording(raw) → playable steps. PURE: turns recorded {x,y,at} clicks into click steps
// with `wait`s between them (so replay has the original rhythm). Node-testable.
export function compileRecording(raw) {
  const out = []; let prev = 0;
  for (const s of raw || []) {
    const gap = (s.at || 0) - prev;
    if (gap > 120) out.push({ t: "wait", ms: Math.min(2500, Math.round(gap)) });
    if (s.t === "key") out.push({ t: "key", key: s.key });
    else out.push({ t: "click", x: s.x, y: s.y });
    prev = s.at || prev;
  }
  return out;
}
// the canonical string a macro content-addresses through (the shell turns it into a did:holo).
export const macroCanonical = (steps) => JSON.stringify(Array.isArray(steps) ? steps : (steps && steps.steps) || []);

export function createAutomation(opts = {}) {
  const run = opts.run || (() => {});          // (commandId) => fire a keymap command (semantic steps)
  const hasDOM = typeof document !== "undefined";
  let cursor = null, x = hasDOM ? window.innerWidth / 2 : 0, y = hasDOM ? window.innerHeight / 2 : 0, rec = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function ensureCursor() { if (cursor || !hasDOM) return; cursor = document.createElement("div"); cursor.className = "holo-cursor"; document.body.appendChild(cursor); place(x, y); }
  function place(nx, ny) { x = nx; y = ny; if (cursor) cursor.style.transform = `translate(${x}px,${y}px)`; }
  function show(v) { ensureCursor(); if (cursor) cursor.style.opacity = v ? "1" : "0"; }
  function dispatch(type, px, py, extra = {}) {
    const el = document.elementFromPoint(px, py); if (!el) return null;
    const Ctor = type.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, composed: true, cancelable: true, clientX: px, clientY: py, view: window, button: 0, pointerId: 1, isPrimary: true, ...extra }));
    return el;
  }
  async function moveTo(nx, ny, dur = 480) {
    ensureCursor(); show(true); const sx = x, sy = y, t0 = performance.now();
    await new Promise((res) => { const step = (t) => { const k = Math.min(1, (t - t0) / Math.max(1, dur)); const e = 1 - Math.pow(1 - k, 3); place(sx + (nx - sx) * e, sy + (ny - sy) * e); dispatch("pointermove", x, y); if (k < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
  }
  async function clickAt(px, py) {
    await moveTo(px, py); cursor && cursor.classList.add("down");
    dispatch("pointerdown", px, py); dispatch("mousedown", px, py); await sleep(70);
    dispatch("pointerup", px, py); dispatch("mouseup", px, py); const el = dispatch("click", px, py);
    cursor && cursor.classList.remove("down"); return el;
  }
  async function clickEl(sel) {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel; if (!el) return null;
    const r = el.getBoundingClientRect(); return clickAt(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  }
  async function dragTo(fromX, fromY, toX, toY) {
    await moveTo(fromX, fromY); cursor && cursor.classList.add("down");
    dispatch("pointerdown", fromX, fromY); const steps = 22;
    for (let i = 1; i <= steps; i++) { const k = i / steps; place(fromX + (toX - fromX) * k, fromY + (toY - fromY) * k); dispatch("pointermove", x, y); await sleep(14); }
    dispatch("pointerup", toX, toY); cursor && cursor.classList.remove("down");
  }

  // play(macro) — replay steps with the visible cursor. Step kinds: move · click · clickEl ·
  // drag · cmd (fire a content-addressed command) · key · wait. Deterministic + serverless.
  async function play(macro, { speed = 1 } = {}) {
    const steps = Array.isArray(macro) ? macro : (macro && macro.steps) || [];
    show(true);
    for (const s of steps) {
      if (s.t === "move") await moveTo(s.x, s.y, (s.d || 480) / speed);
      else if (s.t === "click") await clickAt(s.x, s.y);
      else if (s.t === "clickEl") await clickEl(s.sel);
      else if (s.t === "drag") await dragTo(s.x1, s.y1, s.x2, s.y2);
      else if (s.t === "cmd") { run(s.id); await sleep(260 / speed); }
      else if (s.t === "key") { const el = document.activeElement; if (el) el.dispatchEvent(new KeyboardEvent("keydown", { key: s.key, bubbles: true })); }
      else if (s.t === "wait") await sleep((s.ms || 300) / speed);
    }
    await sleep(250); show(false);
  }

  // record() real clicks (+ delays) → stop() returns playable, content-addressable steps.
  function record() {
    rec = { raw: [], t0: performance.now() };
    rec._onClick = (e) => { if (cursor && cursor.contains(e.target)) return; rec.raw.push({ t: "click", x: Math.round(e.clientX), y: Math.round(e.clientY), at: Math.round(performance.now() - rec.t0) }); };
    document.addEventListener("click", rec._onClick, true);
    return rec;
  }
  function stop() { if (!rec) return null; document.removeEventListener("click", rec._onClick, true); const steps = compileRecording(rec.raw); rec = null; return steps; }
  const isRecording = () => !!rec;

  return { moveTo, clickAt, clickEl, dragTo, play, record, stop, isRecording, show, ensureCursor, canonical: macroCanonical, get pos() { return { x, y }; } };
}
