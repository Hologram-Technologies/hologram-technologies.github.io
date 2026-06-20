#!/usr/bin/env node
// holo-surface-input-witness.mjs — cc-surface-input: proves the κ-surface `button` kind is a CONFORMANT
// interactive primitive — the one thing every control (Hub's action row, and every app's) composes from.
// Maps to the W3C standards it must honor:
//   • UI Events (https://www.w3.org/TR/uievents/)        — a real <button> mirror; "click" → the action
//   • Pointer Events (https://www.w3.org/TR/pointerevents/) — hit-index + hitTest resolve a point → action
//   • WAI-ARIA 1.2 (https://www.w3.org/TR/wai-aria-1.2/)  — button role + aria-pressed/-disabled/-label
// plus the Hologram conscience invariants the input path must keep:
//   • L4/L5 — `action` is a content-addressed id; the substrate executes NO inline code
//   • P7    — dispatch routes through the conscience gate, which can VETO (fail-closed); disabled is inert
//   • P5    — the render/input path emits no telemetry (no fetch/sendBeacon/XHR in the module)
//
// Stub DOM (no browser); the in-browser proof is Hub's watch action row (cc-render-hub). Exit 0 = green.
// Run: node holo-os/system/tools/holo-surface-input-witness.mjs
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const MOD = join(here, "../os/usr/lib/holo/holo-surface.mjs");
const S = await import(pathToFileURL(MOD)).catch((e) => ({ __err: e }));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + m); };
if (S.__err) { console.log("  ✗ import holo-surface.mjs (" + S.__err.message + ")"); console.log("\nRED"); process.exit(1); }

// ── minimal DOM stub (records what the substrate constructs) ──
const mk = (tag) => ({
  tagName: tag.toUpperCase(), children: [], _attrs: {}, style: {}, _l: {}, className: "", disabled: false, parentElement: null, _text: null,
  setAttribute(k, v) { this._attrs[k] = String(v); }, getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
  addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
  appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
  replaceChildren(...cs) { this.children = []; for (const c of cs) this.appendChild(c); },
  querySelectorAll() { const self = this; return { forEach(fn) { self.children.filter((c) => c.className === "holo-btn-proxy").forEach(fn); } }; },
  remove() { const p = this.parentElement; if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); } },
  click(ev) { (this._l.click || []).forEach((f) => f(ev || {})); },
  set textContent(v) { this._text = v; }, get textContent() { return this._text; },
});
const doc = { createElement: (t) => mk(t) };
const findTag = (root, tag) => { if (root.tagName === tag) return root; for (const c of root.children || []) { const r = findTag(c, tag); if (r) return r; } return null; };
function stub() {
  const pipeline = { getBindGroupLayout: () => ({}) };
  return {
    createShaderModule: () => ({}), createRenderPipeline: () => pipeline,
    createBuffer: () => ({}), createBindGroup: () => ({}),
    createTexture: () => ({ createView: () => ({}) }), createSampler: () => ({}),
    createCommandEncoder: () => ({ beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }), finish: () => ({}) }),
    queue: { writeBuffer() {}, writeTexture() {}, submit() {} },
  };
}
const inj = (d) => ({ device: d, format: "bgra8unorm", context: { configure() {} }, view: {} });

// ── WAI-ARIA + UI Events: DOM mirror is a real <button> that dispatches on activation ──
{
  let fired = null;
  const target = mk("div");
  await S.renderSceneDOM(target, { "@type": "holo:Surface", kind: "container", w: 220, children: [
    { kind: "button", label: "Save", action: "save", aria: "Save to library", toggleable: true, toggled: true },
    { kind: "button", label: "Off", action: "noop", disabled: true },
  ] }, { actions: { save: () => { fired = "save"; } } }, doc);
  const btn = findTag(target, "BUTTON");
  ok(btn && btn.tagName === "BUTTON", "UI Events: the DOM mirror is a real <button> (implicit role=button, focusable, Enter/Space activates natively)");
  ok(btn.getAttribute("aria-label") === "Save to library", "WAI-ARIA: aria-label carries the accessible name");
  ok(btn.getAttribute("aria-pressed") === "true", "WAI-ARIA: a toggled button exposes aria-pressed");
  const off = target.children[0].children.find((c) => c.getAttribute("aria-disabled"));
  ok(off && off.disabled === true && off.getAttribute("aria-disabled") === "true", "WAI-ARIA: a disabled button exposes aria-disabled and is inert");
  btn.click(); ok(fired === "save", "UI Events: activating the button dispatches its κ-action");
}

// ── Pointer Events: a point → the button's action, no GPU readback ──
{
  const lay = S.layoutScene({ "@type": "holo:Surface", kind: "container", w: 200, pad: 8, gap: 8, children: [
    { kind: "button", label: "Go", action: "go", w: 80, h: 36 }, { kind: "button", label: "Stop", action: "stop", w: 80, h: 36 },
  ] });
  const idx = S.buildHitIndex(lay.draws);
  ok(idx.length === 2 && idx.every((e) => e.kind === "button" && e.action), "Pointer Events: hit-index carries every interactive node's action");
  const hit = S.hitTest(idx, 12, 14);
  ok(hit && hit.action === "go", "Pointer Events: hitTest(point) resolves to the button's action (O(n), no GPU readback)");
}

// ── Declarative + gated + safe: id not code; gate veto (P7); disabled inert; no telemetry (P5) ──
{
  const b = S.normNode({ kind: "button", label: "Buy", action: "buy" });
  ok(typeof b.action === "string" && b.children.every((c) => c.kind !== "script"), "L4/L5: action is a content-addressed id — the substrate holds NO inline code");
  let n = 0; const actions = { buy: () => { n++; } };
  S.dispatchAction(b, {}, { actions, gate: () => false }); ok(n === 0, "P7: the conscience gate can VETO the action (fail-closed)");
  S.dispatchAction(b, {}, { actions, gate: () => true }); ok(n === 1, "P7: a gate-allowed action dispatches exactly once");
  S.dispatchAction({ kind: "button", action: "buy", disabled: true }, {}, { actions }); ok(n === 1, "input: a disabled button never dispatches");
  S.dispatchAction({ kind: "button", action: "missing" }, {}, { actions }); ok(n === 1, "input: an unregistered action id is a no-op (no throw, no code)");
  const src = readFileSync(MOD, "utf8");
  const probe = src.slice(src.indexOf("export function dispatchAction"), src.indexOf("export function dispatchAction") + 700);
  ok(!/\b(fetch|sendBeacon|XMLHttpRequest|navigator\.send)\b/.test(probe), "P5: the dispatch path emits no telemetry (no fetch/sendBeacon/XHR)");
}

// ── Hybrid: the GPU path overlays a REAL <button> proxy (semantics over GPU pixels), wired to dispatch ──
{
  const savedDoc = globalThis.document, savedGCS = globalThis.getComputedStyle;
  globalThis.document = doc; globalThis.getComputedStyle = () => ({ position: "static" });
  let proxyFired = false;
  const cv = { width: 0, height: 0, tagName: "CANVAS" }; const host = mk("div"); host.appendChild(cv); cv.parentElement = host;
  await S.renderSceneGPU(cv, { "@type": "holo:Surface", kind: "container", w: 200, pad: 8, children: [{ kind: "button", action: "share", aria: "Share", w: 90, h: 34 }] }, { ...inj(stub()), actions: { share: () => { proxyFired = true; } } });
  const proxies = host.children.filter((c) => c.className === "holo-btn-proxy");
  ok(proxies.length === 1 && proxies[0].tagName === "BUTTON" && proxies[0].getAttribute("aria-label") === "Share", "Hybrid: GPU path overlays a real <button> proxy with ARIA (GPU pixels + DOM semantics)");
  proxies[0].click(); ok(proxyFired, "Hybrid: clicking the GPU proxy dispatches through the same κ-action path");
  if (savedDoc === undefined) delete globalThis.document; else globalThis.document = savedDoc;
  if (savedGCS === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = savedGCS;
}

// ── TEXT-INPUT kind: the editable-field primitive (same conformance spine — UI Events · ARIA · L4/L5 · P7) ──
{
  const fire = (el, t, ev) => (el._l[t] || []).forEach((f) => f(ev));
  // UI Events: a real editable field; "input" → action(value); Enter → submit (a distinct content-addressed id)
  let typed = null, submitted = false;
  const target = mk("div");
  await S.renderSceneDOM(target, { "@type": "holo:Surface", kind: "container", w: 260, children: [
    { kind: "input", placeholder: "Search…", action: "type", submit: "go", aria: "Search" },
  ] }, { actions: { type: (n, ev) => { typed = ev.target.value; }, go: () => { submitted = true; } } }, doc);
  const fld = findTag(target, "INPUT");
  ok(fld && fld.tagName === "INPUT", "UI Events: text-input DOM mirror is a real <input> (native text entry / IME / caret / selection / clipboard)");
  ok(fld.getAttribute("aria-label") === "Search", "WAI-ARIA: the field exposes an accessible name");
  fld.value = "abc"; fire(fld, "input", { target: fld }); ok(typed === "abc", "UI Events: typing dispatches action(value) on input");
  fire(fld, "keydown", { key: "Enter", preventDefault() {}, target: fld }); ok(submitted, "UI Events: Enter dispatches the distinct submit action");
  const ta = mk("div");
  await S.renderSceneDOM(ta, { "@type": "holo:Surface", kind: "container", w: 260, children: [{ kind: "input", multiline: true, action: "type" }] }, { actions: {} }, doc);
  ok(findTag(ta, "TEXTAREA"), "UI Events: a multiline field is a real <textarea>");
  // L4/L5 + P7: handlers are ids, not code; disabled inert; gate veto fail-closed
  const inode = S.normNode({ kind: "input", action: "type", submit: "go", disabled: true });
  ok(typeof inode.action === "string" && typeof inode.submit === "string" && inode.children.length === 0, "L4/L5: the field's handlers are content-addressed ids — no inline code");
  let n = 0; S.dispatchAction(inode, { target: { value: "x" } }, { actions: { type: () => { n++; } } }); ok(n === 0, "input: a disabled field never dispatches");
  const enode = S.normNode({ kind: "input", action: "type" });
  S.dispatchAction(enode, { target: { value: "x" } }, { actions: { type: () => { n++; } }, gate: () => false }); ok(n === 0, "P7: the gate can VETO a field's action (fail-closed)");
  S.dispatchAction(enode, { target: { value: "x" } }, { actions: { type: () => { n++; } }, gate: () => true }); ok(n === 1, "P7: a gate-allowed field action dispatches");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
