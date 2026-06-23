// holo-devtools-keybind-witness.mjs — proves the ONE canonical DevTools key-chord spec (ADR-0095):
// "F12, just like Chrome", Ctrl+Shift+I toggle, Ctrl+Shift+J Console, Ctrl+Shift+C inspect — and that
// the native host's Windows-VK decision (handler.cc OnKeyEvent) matches the web spec exactly, so the
// two tiers cannot drift. Pure function over event-shaped objects; no DOM.
//
// Run: node system/tools/holo-devtools-keybind-witness.mjs

import { devToolsAction, nativeAction, WIN_VK } from "../os/usr/lib/holo/devtools/holo-devtools-keys.mjs";

let pass = 0, fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  — " + extra : "")); } };

// ── web spec (devToolsAction) ───────────────────────────────────────────────────────────────────
ok("F12 → toggle (no modifiers needed)",
   eq(devToolsAction({ key: "F12" }), { action: "toggle" }));
ok("Ctrl+Shift+I → toggle",
   eq(devToolsAction({ key: "I", ctrlKey: true, shiftKey: true }), { action: "toggle" }));
ok("Cmd+Opt+I (mac) → toggle (meta accepted as ctrl)",
   eq(devToolsAction({ key: "I", metaKey: true, shiftKey: true }), { action: "toggle" }));
ok("Ctrl+Shift+J → open console",
   eq(devToolsAction({ key: "J", ctrlKey: true, shiftKey: true }), { action: "open", panel: "console" }));
ok("Ctrl+Shift+C → open inspect",
   eq(devToolsAction({ key: "C", ctrlKey: true, shiftKey: true }), { action: "open", panel: "inspect" }));
ok("lowercase key (no shift-upcase) still maps",
   eq(devToolsAction({ key: "i", ctrlKey: true, shiftKey: true }), { action: "toggle" }));

// ── negatives (must NOT swallow the keystroke) ───────────────────────────────────────────────────
ok("Ctrl+I (no shift) → null", devToolsAction({ key: "I", ctrlKey: true, shiftKey: false }) === null);
ok("Shift+I (no ctrl) → null", devToolsAction({ key: "I", ctrlKey: false, shiftKey: true }) === null);
ok("plain 'i' → null", devToolsAction({ key: "i" }) === null);
ok("Ctrl+Shift+K (unmapped) → null", devToolsAction({ key: "K", ctrlKey: true, shiftKey: true }) === null);
ok("F11 → null", devToolsAction({ key: "F11" }) === null);
ok("null event → null", devToolsAction(null) === null);

// ── native host parity (Windows VK) — the host's OnKeyEvent must decide identically ──────────────
ok("VK F12 → toggle", eq(nativeAction(WIN_VK.F12), { action: "toggle" }));
ok("VK Ctrl+Shift+I → toggle", eq(nativeAction(WIN_VK.I, { ctrl: true, shift: true }), { action: "toggle" }));
ok("VK Ctrl+Shift+J → console", eq(nativeAction(WIN_VK.J, { ctrl: true, shift: true }), { action: "open", panel: "console" }));
ok("VK Ctrl+Shift+C → inspect", eq(nativeAction(WIN_VK.C, { ctrl: true, shift: true }), { action: "open", panel: "inspect" }));
ok("VK I without ctrl+shift → null", nativeAction(WIN_VK.I, { ctrl: false, shift: false }) === null);
ok("VK codes are the documented Windows virtual-keys",
   WIN_VK.F12 === 0x7b && WIN_VK.I === 0x49 && WIN_VK.J === 0x4a && WIN_VK.C === 0x43);

// web spec ⇔ native parity: every Chrome chord yields the SAME action on both paths.
const parity = [
  ["F12",  devToolsAction({ key: "F12" }),                                   nativeAction(WIN_VK.F12)],
  ["C+S+I", devToolsAction({ key: "I", ctrlKey: true, shiftKey: true }),     nativeAction(WIN_VK.I, { ctrl: true, shift: true })],
  ["C+S+J", devToolsAction({ key: "J", ctrlKey: true, shiftKey: true }),     nativeAction(WIN_VK.J, { ctrl: true, shift: true })],
  ["C+S+C", devToolsAction({ key: "C", ctrlKey: true, shiftKey: true }),     nativeAction(WIN_VK.C, { ctrl: true, shift: true })],
];
ok("web spec and native host agree on every chord", parity.every(([, a, b]) => eq(a, b)),
   parity.filter(([, a, b]) => !eq(a, b)).map(([n]) => n).join(","));

console.log("");
if (fail === 0) console.log("WITNESSED ✓  " + pass + " checks, 0 failures");
else { console.log("RED — " + pass + " passed, " + fail + " failed"); process.exitCode = 1; }
