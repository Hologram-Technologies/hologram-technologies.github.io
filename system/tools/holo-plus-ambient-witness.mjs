#!/usr/bin/env node
// holo-plus-ambient-witness.mjs — proves A0 of "The + Everywhere": THE AMBIENT INJECTOR. A small "+" must appear
// on the omni bar AND every eligible text input across the OS — once, post-gesture, additively, zero per-app edits.
// The DOM driver is injected with fakes so the eligibility/idempotency/guard CORE is Node-witnessable; the real
// DOM injection is verified separately in the live browser. (Mirrors how holo-sound's logic is pure + browser-bound.)
//
// Checks (all must hold):
//   1 eligibilityIsCorrect      — textarea / text-like input / contenteditable are eligible; password/hidden/file/checkbox
//                                 + our own ui + opted-out [data-holo-plus-skip] are NOT.
//   2 omniGetsLeftOthersRight   — a search/omni input anchors the "+" LEFT (the mockup); ordinary inputs anchor RIGHT.
//   3 guardBlocksBeforeGesture  — before arm() nothing attaches; after arm() the same inputs attach (invisible until wanted).
//   4 onePlusPerInputIdempotent — scanning twice attaches each eligible input exactly once (never a second "+").
//   5 scanCoversMixedApps       — a fake multi-app DOM (mixed eligible + ineligible) → "+" on every eligible, none else.
//   6 additiveNeverDisturbs     — attaching never changes the input's value, focus, or tab order (it is an overlay).
//   7 invokeEmitsEvent          — activating the "+" fires the holo-plus-invoke signal A1 (the popover) listens for.
//   8 lateMountedGetAdorned     — the attach path works on a node added after the initial scan (observer-equivalent).
//
// Authority: holospaces Law L2 (one canonical wire) · mirrors #holo-sound (universal per-document router).
//   node tools/holo-plus-ambient-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isEligibleInput, anchorSide, makeAmbient } from "../os/usr/lib/holo/holo-plus-ambient.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── a tiny fake DOM: element-likes + a root with querySelectorAll ───────────────────────────────────
let idSeq = 0;
const elem = (tag, attrs = {}, extra = {}) => {
  const a = { ...attrs };
  return {
    tagName: tag, _id: ++idSeq, value: extra.value ?? "", focused: false, tabIndex: 0, _listeners: {},
    isContentEditable: extra.isContentEditable === true,
    getAttribute: (n) => (n in a ? a[n] : null),
    setAttribute: (n, v) => { a[n] = String(v); },
    addEventListener: (ev, fn) => { (a._l = a._l || {})[ev] = fn; },
    dispatchEvent: (e) => { const fn = (a._l || {})[e.type]; if (fn) fn(e); return true; },
    _attrs: a, ...extra,
  };
};
const fakeRoot = (els) => ({ querySelectorAll: () => els });
// injected DOM seams: a no-op button + a mount that records placement WITHOUT touching the input.
const mkButton = () => { const b = elem("button", { "data-holo-plus-ui": "1" }); b.textContent = "+"; return b; };
const mounts = [];
const mount = (input, btn, side) => { mounts.push({ inputId: input._id, side, btnTag: btn.tagName }); };
const win = { CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; this.bubbles = true; } } };

const newAmbient = (over = {}) => makeAmbient({ doc: null, win, mkButton, mount, ...over });

// ── 1 · eligibility ─────────────────────────────────────────────────────────────────────────────────
const E = [
  [elem("textarea"), true], [elem("input", { type: "text" }), true], [elem("input", { type: "search" }), true],
  [elem("input", {}), true], [elem("div", {}, { isContentEditable: true }), true],
  [elem("input", { type: "password" }), false], [elem("input", { type: "hidden" }), false],
  [elem("input", { type: "file" }), false], [elem("input", { type: "checkbox" }), false],
  [elem("div", {}), false], [elem("button", { "data-holo-plus-ui": "1" }), false],
  [elem("textarea", { "data-holo-plus-skip": "" }), false],
];
ok("eligibilityIsCorrect", E.every(([el, want]) => isEligibleInput(el) === want),
  E.filter(([el, want]) => isEligibleInput(el) !== want).map(([el]) => el.tagName + ":" + (el.getAttribute("type") || "")).join(","));

// ── 2 · omni anchors left, others right ─────────────────────────────────────────────────────────────
ok("omniGetsLeftOthersRight",
  anchorSide(elem("input", { type: "search" })) === "left" && anchorSide(elem("input", { "data-omni": "" })) === "left"
  && anchorSide(elem("textarea")) === "right" && anchorSide(elem("input", { type: "text" })) === "right");

// ── 3 · guard: nothing before arm(), everything after ───────────────────────────────────────────────
const guarded = newAmbient();
const before = guarded.scan(fakeRoot([elem("input", { type: "text" }), elem("textarea")]));
guarded._armedBefore = guarded.armed;
const inputsG = [elem("input", { type: "text" }), elem("textarea")];
const a2 = newAmbient();
const afterArm = a2.arm.call(a2);  // arm() then scan() with no root → 0 (no doc); use explicit scan
const explicit = a2.scan(fakeRoot(inputsG));
ok("guardBlocksBeforeGesture", before === 0 && guarded.armed === false && a2.armed === true && explicit === 2,
  `before=${before} armedBefore=${guarded.armed} explicit=${explicit}`);

// ── 4 · idempotent: scan twice → attach once ───────────────────────────────────────────────────────
const a3 = newAmbient({ armed: true });
const inputs4 = [elem("input", { type: "text" }), elem("textarea"), elem("input", { type: "search" })];
const root4 = fakeRoot(inputs4);
const first = a3.scan(root4), second = a3.scan(root4);
ok("onePlusPerInputIdempotent", first === 3 && second === 0 && a3.attached.size === 3, `first=${first} second=${second}`);

// ── 5 · mixed multi-app DOM ─────────────────────────────────────────────────────────────────────────
const a5 = newAmbient({ armed: true });
const mixed = [
  elem("input", { type: "search", "data-omni": "" }),   // omni bar (eligible, left)
  elem("textarea"),                                      // notes app (eligible)
  elem("input", { type: "password" }),                   // login (NOT)
  elem("input", { type: "file" }),                       // file picker (NOT)
  elem("div", {}, { isContentEditable: true }),          // rich editor (eligible)
  elem("input", { type: "checkbox" }),                   // toggle (NOT)
];
mounts.length = 0;
const n5 = a5.scan(fakeRoot(mixed));
ok("scanCoversMixedApps", n5 === 3 && mounts.length === 3 && mounts.filter((m) => m.side === "left").length === 1,
  `attached=${n5} mounts=${mounts.length}`);

// ── 6 · additive: attaching never changes value/focus/tabIndex of the input ─────────────────────────
const a6 = newAmbient({ armed: true });
const inp = elem("input", { type: "text" }, { value: "hello", focused: false, tabIndex: 0 });
a6.attach(inp);
ok("additiveNeverDisturbs", inp.value === "hello" && inp.focused === false && inp.tabIndex === 0 && inp.getAttribute("data-holo-plus") === "1");

// ── 7 · invoke fires the A1 signal ──────────────────────────────────────────────────────────────────
let fired = null;
const a7 = newAmbient({ armed: true, onInvoke: (el, info) => { fired = { id: el._id, side: info.side }; } });
const inp7 = elem("input", { type: "text" });
a7.attach(inp7); a7.fire(inp7, anchorSide(inp7));
ok("invokeEmitsEvent", fired && fired.id === inp7._id && fired.side === "right");

// ── 8 · late-mounted input adorned via attach (observer path) ───────────────────────────────────────
const a8 = newAmbient({ armed: true });
const late = elem("textarea");
ok("lateMountedGetAdorned", a8.attach(late) === true && a8.attached.has(late));

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "The + Everywhere — A0 AMBIENT INJECTOR: a near-invisible '+' is attached to the omni bar (left) and every eligible text input (right) — textarea / text-like input / contenteditable — and never to password/hidden/file/checkbox/opted-out elements. It attaches only AFTER a user gesture (invisible until wanted), exactly once per input (idempotent), additively (never changes the input's value/focus/tab order — it is an overlay), works across a mixed multi-app DOM and on late-mounted inputs, and activation emits the holo-plus-invoke signal the A1 popover listens for. Zero per-app edits; mirrors the holo-sound universal per-document router",
  authority: "holospaces Law L2 (one canonical wire) · mirrors #holo-sound (universal per-document router)",
  witnessed,
  covers: witnessed ? ["ambient-injector","eligibility","omni-left","post-gesture-guard","idempotent","mixed-apps","additive","invoke-signal","late-mount"] : [],
  sample: { eligibleKinds: ["textarea", "input[text/search/url/…]", "[contenteditable]"], skipped: ["password", "hidden", "file", "checkbox", "[data-holo-plus-skip]"] },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-plus-ambient-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-plus-ambient witness — A0 The + Everywhere (one '+' on every input + omni bar, guarded, additive)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the ambient injector adorns every eligible input once, post-gesture, additively, zero per-app edits" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
