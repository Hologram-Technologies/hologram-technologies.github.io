// holo-sso.mjs — Sovereign Single Sign-On: unlock the Hologram ONCE; every surface adopts the operator.
//
// Sign-in is a property of the SESSION, not of each app. When an operator authenticates anywhere (the OS
// greeter, or any holospace), that surface PUBLISHES a NON-SECRET presence signal to a same-origin shared
// channel. Any other surface (a messenger tab, a fresh holospace) READS it and, if the operator is enrolled
// here, adopts them without a second full login — and, within the device enclave's trust-window on the
// native host, WITHOUT a visible dialog. The signing key and the PRF secret NEVER travel: adoption always
// re-derives through the enclave (a WebAuthn assertion → holo-login.unlock, Law L5). This module is the
// PURE decision + the shared channel; the enclave assertion + unlock stay in the caller (the gate).
//
// Cross-surface, not cross-tab: sessionStorage is per-browsing-context (a new holospace tab can't see the OS
// shell's session). localStorage IS per-origin (shared across all same-origin contexts), so the presence
// signal lives there. Dependency-free + isomorphic (adoptDecision is Node-testable; the browser bits no-op
// under Node), so it can be reused by any surface without pulling a heavy graph.

// The app-visible presence key. Holds ONLY the disclosure presentationOf() already makes — operator κ +
// label + a device-Hello `verifiedAt` stamp. NEVER pub/sig/secret. A same-origin app reads it; it is not a
// capability (κ ∈ the local roster is still required to adopt, and the enclave still gates the actual unlock).
export const PRESENCE_KEY = "holo.identity.presentation";
// How long a device-Hello stays "warm" enough to attempt a SILENT (dialog-free) re-assertion. A JS proxy for
// the OS enclave's own trust-window; keep it ≤ the platform's Hello cache so a "silent" attempt is truly silent.
export const TRUST_TTL_MS = 90_000;
export const PRESENCE_CHANNEL = "holo-identity";

const _hasLS = () => { try { return typeof localStorage !== "undefined"; } catch { return false; } };

// publishPresence — call at sign-in/unlock (a real operator only; guests are non-persistent and never adopted).
// Writes the non-secret presentation + a fresh verifiedAt, and pings live tabs. Best-effort, never throws.
export function publishPresence(presentation, { nowMs } = {}) {
  try {
    if (!presentation || !presentation.operator || presentation.guest) return null;   // no-op for guests / empty
    const p = { operator: presentation.operator, label: presentation.label || "", guest: false,
      verifiedAt: nowMs != null ? nowMs : Date.now() };
    if (_hasLS()) localStorage.setItem(PRESENCE_KEY, JSON.stringify(p));
    try { if (typeof BroadcastChannel !== "undefined") { const bc = new BroadcastChannel(PRESENCE_CHANNEL); bc.postMessage({ type: "presence", presentation: p }); bc.close(); } } catch {}
    return p;
  } catch { return null; }
}

// readPresence — the current shared presence, or null. Prefers the live localStorage mirror (fast, cross-tab).
export function readPresence() {
  try { if (!_hasLS()) return null; return JSON.parse(localStorage.getItem(PRESENCE_KEY) || "null"); } catch { return null; }
}

// clearPresence — on sign-out / operator lock, so a later open falls back to the full gate (no stale adoption).
export function clearPresence() { try { if (_hasLS()) localStorage.removeItem(PRESENCE_KEY); } catch {} }

// adoptDecision — the PURE, fail-closed policy (no DOM, no crypto, Node-testable). Given the shared presence,
// the LOCAL roster (holo-login), the clock, and whether the host can do a silent enclave assertion, decide:
//   • adopt?  only when presence names a real (non-guest) operator that is ENROLLED here WITH a credential.
//             An unknown/forged κ, a guest, or a legacy no-credential record → do NOT adopt (fall to the gate).
//   • silent? only when the device-Hello is still warm AND the host supports a dialog-free assertion.
// Returns { adopt, silent, warm, operator, cred, label, reason }. Adoption itself (assert + unlock) is the
// caller's job — this only says whether, and how quietly.
export function adoptDecision({ presence, roster = [], nowMs = 0, trustTtlMs = TRUST_TTL_MS, nativeSilent = false } = {}) {
  if (!presence || !presence.operator) return { adopt: false, silent: false, warm: false, reason: "no-presence" };
  if (presence.guest) return { adopt: false, silent: false, warm: false, reason: "guest-not-adopted" };
  const op = (roster || []).find((r) => r && r.kappa === presence.operator);
  if (!op) return { adopt: false, silent: false, warm: false, reason: "not-in-roster" };      // unknown/forged κ → fail-closed
  if (!op.cred) return { adopt: false, silent: false, warm: false, reason: "no-credential" };  // legacy key, no biometric here
  const at = typeof presence.verifiedAt === "number" ? presence.verifiedAt : (Date.parse(presence.verifiedAt || "") || 0);
  const age = nowMs - at;
  const warm = at > 0 && age >= 0 && age < trustTtlMs;
  const silent = !!(warm && nativeSilent);
  return { adopt: true, silent, warm, operator: op.kappa, cred: op.cred, label: op.label || presence.label || "", reason: silent ? "silent" : "one-tap" };
}
