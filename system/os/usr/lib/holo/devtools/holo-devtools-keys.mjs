// holo-devtools-keys.mjs — the ONE canonical DevTools key-chord spec (ADR-0095). "F12, just like Chrome."
//
// This is the single source of truth for which keystroke opens the inspector and in what mode. The web
// shell imports devToolsAction() in its keydown handler (Tier B); the native CEF host's OnKeyEvent
// (handler.cc, Tier A) mirrors the SAME table by hand against Windows virtual-key codes. Having one
// spec — witnessed here — keeps the two tiers Chrome-identical and prevents drift.
//
// Chrome's bindings (the conformance oracle):
//   F12  or  Ctrl+Shift+I   → toggle DevTools (last-used panel)
//   Ctrl+Shift+J            → open DevTools focused on the Console
//   Ctrl+Shift+C            → open DevTools in inspect-element mode
// On macOS the Ctrl+Shift+* chords are Cmd+Opt+* — we accept either (meta OR ctrl) so the spec is
// portable; the native host is Windows-only and uses ctrl.
//
// Pure + dependency-free: devToolsAction(ev) is a total function of an event-shaped object, so the
// witness is a pure function (the Atlas-isomorphism discipline — identical decision in browser + Node).

// devToolsAction(ev) → one of:
//   { action: "toggle" }            — open if closed, close if open (F12 / Ctrl+Shift+I)
//   { action: "open", panel: "console" }   — Ctrl+Shift+J
//   { action: "open", panel: "inspect" }   — Ctrl+Shift+C (element picker armed)
//   null                            — not a DevTools chord (let the event through)
//
// ev shape (a DOM KeyboardEvent already satisfies this): { key, code?, ctrlKey, shiftKey, metaKey, altKey }.
export function devToolsAction(ev) {
  if (!ev) return null;
  const key = String(ev.key || "");
  // F12 has no modifier requirement (and produces key "F12").
  if (key === "F12") return { action: "toggle" };

  // The Ctrl+Shift chords. Accept Cmd (meta) as the cross-platform equivalent of Ctrl, and require
  // Shift. We compare on the produced letter case-insensitively (Shift uppercases ev.key).
  const mod = !!(ev.ctrlKey || ev.metaKey);
  const shift = !!ev.shiftKey;
  if (!mod || !shift) return null;
  const letter = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  if (letter === "i") return { action: "toggle" };
  if (letter === "j") return { action: "open", panel: "console" };
  if (letter === "c") return { action: "open", panel: "inspect" };
  return null;
}

// The Windows virtual-key table the native host mirrors (handler.cc). Exported so a host-parity
// witness can assert the two stay aligned. F12=0x7B, I=0x49, J=0x4A, C=0x43.
export const WIN_VK = Object.freeze({ F12: 0x7b, I: 0x49, J: 0x4a, C: 0x43 });

// nativeAction(vk, { ctrl, shift }) → the same decision as devToolsAction but over Windows VK codes,
// so the witness can prove the host's OnKeyEvent logic matches the web spec exactly.
export function nativeAction(vk, { ctrl = false, shift = false } = {}) {
  if (vk === WIN_VK.F12) return { action: "toggle" };
  if (!ctrl || !shift) return null;
  if (vk === WIN_VK.I) return { action: "toggle" };
  if (vk === WIN_VK.J) return { action: "open", panel: "console" };
  if (vk === WIN_VK.C) return { action: "open", panel: "inspect" };
  return null;
}

export default { devToolsAction, nativeAction, WIN_VK };
