// holo-devtools-dock-witness.mjs — proves the GLOBAL F12 DevTools dock (holo-devtools-dock.mjs):
// the canonical chord toggles a right-side dock that points the κ-CDP LIVE backend at the ACTIVE tab,
// registers the DevTools frame on the holo-gov bus, defers to the Create studio when it owns the Dev
// surface, and is INERT on a bare Node import. Pure: a tiny mock DOM/window, no jsdom.
//
// Run: node system/tools/holo-devtools-dock-witness.mjs

import { installGlobalDevDock } from "../os/usr/lib/holo/devtools/holo-devtools-dock.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  — " + extra : "")); } };

// ── a tiny mock DOM (only what the dock touches) ─────────────────────────────────────────────────
function mkEl(tag) {
  return {
    tagName: String(tag || "div").toUpperCase(), id: "", title: "", textContent: "",
    style: { cssText: "", _set: {} }, children: [], _attrs: {}, _listeners: {}, onclick: null,
    contentWindow: { _frameWin: true },
    setAttribute(k, v) { this._attrs[k] = v; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    addEventListener(t, fn, o) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    querySelector() { return null; },
    set src(v) { this._src = v; if (this._listeners.load) this._listeners.load.forEach((f) => f()); },
    get src() { return this._src; },
  };
}
function mkDoc() {
  const byId = {};
  const body = mkEl("body");
  return {
    _byId: byId, body,
    createElement: (t) => mkEl(t),
    getElementById: (id) => byId[id] || null,
    _register(el) { if (el.id) byId[el.id] = el; (el.children || []).forEach((c) => this._register(c)); },
  };
}
function mkWin(over = {}) {
  const w = { _keys: [], addEventListener(t, fn) { if (t === "keydown") w._keys.push(fn); }, Date: { now: () => 12345 } };
  return Object.assign(w, over);
}

// helpers to introspect the dock element after toggle (re-index ids each call)
function index(doc) { const root = doc.body.children[0]; if (root) doc._register(root); return doc.getElementById("holo-devdock"); }

// ── 1: bare Node import is inert (no doc/win) ────────────────────────────────────────────────────
{
  const api = installGlobalDevDock({ doc: null, win: null });
  ok("inert without DOM (toggle is a no-op, isOpen false)", typeof api.toggle === "function" && api.isOpen() === false);
}

// ── 2: F12 toggles a dock, points HoloDevToolsServe via installLive, registers on the bus ─────────
{
  const doc = mkDoc();
  let installLiveArgs = null, registered = null;
  const frameTarget = { contentDocument: { _live: true }, contentWindow: { _w: true } };
  const win = mkWin({
    HoloDevTools: { installLive: (a) => { installLiveArgs = a; return function serve() {}; } },
    HoloGov: { register: (cw, app) => { registered = app; } },
    HoloConscience: { evaluate: () => ({ outcome: "accept" }) },
  });
  const api = installGlobalDevDock({
    doc, win,
    activeFrame: () => frameTarget,
    activeKappa: () => "did:holo:sha256:abc123",
    studioOpen: () => false,
  });
  ok("a keydown listener was installed", win._keys.length === 1);
  ok("dock not shown before any chord", (index(doc) && index(doc).style.cssText.includes("display:none")) || !index(doc));

  // press F12 (the canonical toggle chord)
  const F12 = { key: "F12", preventDefault() { this._pd = true; }, stopPropagation() {} };
  win._keys[0](F12);
  ok("F12 calls preventDefault (consumes the chord)", F12._pd === true);
  ok("F12 opened the dock", api.isOpen() === true);

  const dock = index(doc);
  ok("dock element exists and is shown (display:block)", !!dock && dock.style.display === "block");
  ok("HoloDevToolsServe pointed via installLive", typeof win.HoloDevToolsServe === "function" && !!installLiveArgs);
  const tgt = installLiveArgs && installLiveArgs.target && installLiveArgs.target();
  ok("live target = the ACTIVE tab's doc/win/κ", !!tgt && tgt.doc && tgt.win && tgt.kappa === "did:holo:sha256:abc123");
  ok("conscience passed to the backend (L4 gate)", installLiveArgs && installLiveArgs.conscience === win.HoloConscience);
  ok("DevTools frame registered on the holo-gov bus", registered && registered.id === "org.hologram.HoloDevTools");

  // press F12 again → closes
  win._keys[0]({ key: "F12", preventDefault() {}, stopPropagation() {} });
  ok("second F12 closes the dock", api.isOpen() === false);
}

// ── 3: cross-origin active tab → live doc is null (backend falls back to scene), no throw ─────────
{
  const doc = mkDoc();
  let liveArgs = null;
  const win = mkWin({ HoloDevTools: { installLive: (a) => { liveArgs = a; return () => {}; } } });
  const xframe = { get contentDocument() { throw new Error("cross-origin"); }, get contentWindow() { throw new Error("cross-origin"); } };
  const api = installGlobalDevDock({ doc, win, activeFrame: () => xframe, activeKappa: () => null });
  win._keys[0]({ key: "F12", preventDefault() {}, stopPropagation() {} });
  const tgt = liveArgs && liveArgs.target();
  ok("cross-origin tab → target doc/win null, no throw", !!tgt && tgt.doc === null && tgt.win === null);
  ok("opened anyway (scene fallback path)", api.isOpen() === true);
}

// ── 4: Create studio open → defer to its tested Dev tab (#cs-tab-dev click), don't stack ──────────
{
  const doc = mkDoc();
  let clicked = false;
  doc._byId["cs-tab-dev"] = Object.assign(mkEl("button"), { id: "cs-tab-dev", click() { clicked = true; } });
  const win = mkWin({ HoloDevTools: { installLive: () => () => {} } });
  const api = installGlobalDevDock({ doc, win, studioOpen: () => true, activeFrame: () => null });
  win._keys[0]({ key: "F12", preventDefault() {}, stopPropagation() {} });
  ok("studio open → clicks #cs-tab-dev, does not open a 2nd dock", clicked === true && api.isOpen() === false);
}

// ── 5: non-chord keys are ignored (let the keystroke through) ─────────────────────────────────────
{
  const doc = mkDoc();
  const win = mkWin({ HoloDevTools: { installLive: () => () => {} } });
  const api = installGlobalDevDock({ doc, win, activeFrame: () => null });
  let pd = false;
  win._keys[0]({ key: "a", preventDefault() { pd = true; }, stopPropagation() {} });
  ok("plain key ignored (no preventDefault, dock stays closed)", pd === false && api.isOpen() === false);
}

console.log("");
if (fail === 0) console.log("WITNESSED ✓  " + pass + " checks, 0 failures");
else { console.log("RED — " + pass + " passed, " + fail + " failed"); process.exitCode = 1; }
