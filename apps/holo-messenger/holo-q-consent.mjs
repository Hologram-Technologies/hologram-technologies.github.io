// holo-q-consent — M11 the DETERMINISTIC CONSENT SPINE (pure, DOM-free, Node+browser; gated GPU-free).
//
// The propose/dispose surface is where the living self becomes felt AND acts. Its entire safety is CONSENT: nothing
// with a side effect happens without the user's explicit accept tap. That decision — what tier a proposal is, whether
// it needs your tap, what accept DOES, whether it's undoable, whether it's hard-gated — lives here in deterministic
// code the M11 gate proves, not in the model or the UI. This module NEVER executes; it plans. The surface calls the
// real executors (setRule / qSendDraft / HoloSysHealth.heal / the pay sheet) ONLY when mayProceed() says yes.
//
// LAW (mirrors the safety action-categories):
//   • READ-ONLY  → information; no consent needed (a brief, a summary).
//   • PERMISSION → your ONE tap → Q.trust.decide → the executor; reversible-first, signed. (reply / mute / heal)
//   • HARD       → money never rides a one-tap card; it opens the BIOMETRIC sheet. Q never moves money.
//   • PROHIBITED → NEVER surfaced as an actionable proposal (returns null). Bulk-delete / egress / credentials.
//   • A permission/hard deed proceeds ONLY on tap===true. Injection can't fake a tap; the UI can't skip the gate.

export const CONSENT = Object.freeze({ READONLY: "readonly", PERMISSION: "permission", HARD: "hard" });

// The grounded executors each permission kind maps to (the surface dispatches these; this module only names them).
const PERMISSION_KINDS = Object.freeze({
  reply: { do: "send-draft", undoable: false, trustTopic: "send-message", trustKind: "publish" },
  mute:  { do: "set-rule",   undoable: true,  trustTopic: "mute-rule",    trustKind: "publish" },
  heal:  { do: "system-heal",undoable: true,  trustTopic: "system-heal",  trustKind: "publish" },
});
const PROHIBITED_KINDS = /^(delete-all|forward-all|export-all|egress|credential|wipe)$/;

// Plan a proposal → { consent, requiresTap, act, undoable } — or null if it must NEVER be proposed. Pure decision.
export function planProposal(p = {}) {
  const kind = String(p.kind || "");
  // PROHIBITED — never an actionable card, no matter what asked for it (even if a message claims authorization).
  if (p.tier === "PROHIBITED" || PROHIBITED_KINDS.test(kind)) return null;
  // READ-ONLY — information; no consent needed.
  if (kind === "brief" || kind === "summary" || p.tier === "READONLY") return Object.freeze({ consent: CONSENT.READONLY, requiresTap: false, act: null, undoable: false });
  // HARD-GATED — money opens the biometric sheet; it is NEVER a silent or one-tap-executes card. Q never moves money.
  if (kind === "pay" || kind === "request" || p.tier === "MONEY") return Object.freeze({ consent: CONSENT.HARD, requiresTap: true, act: Object.freeze({ do: "open-pay-sheet", biometric: true }), undoable: false });
  // PERMISSION — accept = your one tap → Q.trust.decide → the real executor. Reversible-first.
  const perm = PERMISSION_KINDS[kind];
  if (perm) return Object.freeze({ consent: CONSENT.PERMISSION, requiresTap: true, act: perm, undoable: perm.undoable });
  // Unknown kind → treat as read-only info. We NEVER auto-act on something we can't classify.
  return Object.freeze({ consent: CONSENT.READONLY, requiresTap: false, act: null, undoable: false });
}

// THE consent gate, in one place: may a proposal's deed proceed? Read-only info may render; a permission/hard deed
// proceeds ONLY on an explicit accept tap (tap === true, strictly — a truthy string or 1 is NOT a tap). No plan
// (prohibited) never proceeds. This is what the surface MUST call before dispatching any executor.
export function mayProceed(plan, tap) {
  if (!plan) return false;                              // prohibited / unproposable
  if (plan.consent === CONSENT.READONLY) return true;   // information — safe to show
  return tap === true;                                  // permission/hard — your explicit accept, nothing less
}

// Is this an actionable proposal at all (vs pure information)? Helps the surface show a tap affordance only when real.
export function isActionable(plan) { return !!plan && plan.consent !== CONSENT.READONLY; }
