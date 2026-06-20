// holo-plus-boot.mjs — "The + Everywhere" A7: THE ONE ENTRY. A single import that wires the whole ambient "+" into
// a document, injected by usr/share/frame/shell.html into the shell AND every app frame exactly like holo-sound.mjs
// (one script, zero per-app edits). Each imported module self-initialises behind a `if (!window.HoloX)` guard, so
// loading this once per document is idempotent and order-independent. Importing the leaves pulls their pure cores
// (intake, context) transitively — no need to list those here.
//
//   holo-plus-ambient → the "+" on every text input + the omni bar (A0); fires holo-plus-invoke
//   holo-plus-popover → the invoke popover: upload file · paste link · link a holo object by κ (A1)
//   holo-plus-q       → a drop becomes a Q grounding turn; voice "add this" + text "+" converge (A4)
//   holo-plus-answer  → an omni-bar drop renders as a proactive Q answer card (A5)
//   holo-plus-route   → routes omni→answer · input→chip · voice→ground, never blocking the input (A6)

import "./holo-plus-ambient.mjs";
import "./holo-plus-popover.mjs";
import "./holo-plus-q.mjs";
import "./holo-plus-answer.mjs";
import "./holo-plus-route.mjs";

// a tiny readiness beacon (parity with other shared boots): announce once the ambient layer is live.
if (typeof window !== "undefined" && typeof document !== "undefined" && !window.__holoPlusBooted) {
  window.__holoPlusBooted = true;
  try { document.documentElement.dispatchEvent(new window.CustomEvent("holo-plus-ready")); } catch { /* fail-soft */ }
}

export default { booted: true };
