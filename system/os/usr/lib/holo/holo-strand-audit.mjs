// holo-strand-audit.mjs — P3 of the unification: ONE SIGNED AUDIT SOURCE on the spine. Today the
// consequential acts — consent (terms.grantSensitive), delegation (delegation.issue/attenuate), value
// transfer (wallet.*) — each already produce a payload-bound, operator-signed StepUp attestation
// (holo-stepup). But those attestations are scattered; Inbox / Control / "what did I approve?" have no
// single, ordered, tamper-evident record. This seam records each verified act as a signed `audit` entry
// on the operator's source chain, REFERENCING the StepUp by its κ — so the whole audit trail is one
// projection of the one spine: ordered, authorship-bound, and fail-closed (a tampered act breaks the chain).
//
// Additive + projection-only: holo-stepup, HoloTerms, holo-delegate and the wallet bridge are unchanged.
// The audit entry summarizes the act and binds the StepUp κ; the full attestation stays where it lives and
// remains independently re-verifiable (verifyStepUp). The spine is the single source of truth; the audit
// log is a filtered read of it. Holochain's source-chain insight applied to consent/authority/value.

import { verifyStepUp, levelOf } from "./holo-stepup.mjs";

const summarize = (t = {}) => String(t.reason || t.kind || "act");

// recordAct(strand, stepupToken) — record a verified sensitive act on the spine. The StepUp token is the
// payload-bound, operator-signed proof of the act; the audit entry references it by κ (token.id) and
// summarizes it for the log. The strand entry is ALSO operator-signed (authorship of the audit record).
export async function recordAct(strand, stepupToken = {}) {
  const t = stepupToken;
  return strand.append({
    kind: "audit",
    payload: {
      act: t.kind || null,
      level: t.kind ? levelOf(t.kind) : null,        // value · reveal · authority · low (holo-stepup policy)
      stepup: t.id || null,                          // the StepUp attestation κ (independently verifiable)
      operator: t.operator || null,
      appId: t.appId || "",
      reason: summarize(t),
      challenge: t.challenge || null,                // payload binding (challenge == sha256(action body))
      at: t.issuedAt || null,
    },
  });
}

// typed helpers — the three consequential families (kinds match holo-stepup's policy sets exactly).
export const recordConsent = (strand, token) => recordAct(strand, token);     // terms.grantSensitive · everything.open
export const recordDelegation = (strand, token) => recordAct(strand, token);  // delegation.issue · delegation.attenuate
export const recordApproval = (strand, token) => recordAct(strand, token);    // wallet.send/swap/bridge/… (value)

// auditLog(strand, { level, act }) — the unified, ordered audit view for Inbox / Control / "what did I
// approve?". One read across consent + delegation + value, optionally filtered by level or act kind.
export function auditLog(strand, { level = null, act = null } = {}) {
  return strand.replay({ kind: "audit" })
    .filter((e) => {
      const p = e["holstr:payload"] || {};
      return (level ? p.level === level : true) && (act ? p.act === act : true);
    })
    .map((e) => {
      const p = e["holstr:payload"] || {};
      return { seq: e["holstr:seq"], at: p.at, act: p.act, level: p.level, reason: p.reason, appId: p.appId, stepup: p.stepup, operator: p.operator, entry: e.id, signed: !!e["holstr:sig"] };
    });
}

// verifyAct(auditEntry, stepupToken) — prove an audit entry: the StepUp κ it references must match the
// supplied token AND verifyStepUp must pass (the act had a valid, payload-bound, operator-signed attestation).
// Returns { ok, why? }. Fail-closed: a forged/altered act cannot present a verifying step-up.
export async function verifyAct(auditEntry, stepupToken) {
  try {
    const ref = auditEntry && auditEntry["holstr:payload"] && auditEntry["holstr:payload"].stepup;
    if (!ref) return { ok: false, why: "no-stepup-ref" };
    if (!stepupToken || stepupToken.id !== ref) return { ok: false, why: "stepup-ref-mismatch" };
    const body = await verifyStepUp(stepupToken);
    return { ok: !!body, why: body ? null : "stepup-invalid" };
  } catch (e) { return { ok: false, why: "verify-threw:" + (e && e.message) }; }
}

// browser binding: one seam over the live operator strand. Fail-soft; callers degrade if absent.
if (typeof window !== "undefined") {
  window.HoloStrandAudit = { recordAct, recordConsent, recordDelegation, recordApproval, auditLog, verifyAct };
}
