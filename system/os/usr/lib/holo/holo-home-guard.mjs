// holo-home-guard.mjs — IDENTITY WITHOUT ACCOUNTS, the gate. CasaOS has a user-service with passwords;
// Holo Home has none — the key that owns the manifest is the only authority, unlocked once by biometric
// (Holo Pass / TEE). Most of Home is ambient (browse, open, pin). But the verbs that change WHO can reach
// your whole cloud, or that EXPOSE it, must pass a sovereign step-up first. This module is the policy: it
// classifies Home verbs and enforces step-up on the dangerous few — reusing holo-stepup entirely, inventing
// no ceremony.
//
//   ambient (no step-up)  — home.files.add/unlink, home.app.pin/unpin, home.space.*, home.ask.context, reads
//   authority (windowed)  — home.device.pair, home.device.revoke  (a fresh same-verb step-up rides a window)
//   reveal (always asks)  — home.export  (export the manifest/key) — never suppressed, never on a window
//
// A verb nobody classified as ambient is sensitive by default (holo-stepup's fail-safe: unknown → authority).
// Anchored on: holo-stepup (levelOf / needsStepUp / buildStepUp / verifyStepUp). No new crypto.

import { needsStepUp, buildStepUp, verifyStepUp, levelOf } from "./holo-stepup.mjs";

// Home verb → the holo-stepup kind it is gated as. A verb absent here is AMBIENT (never steps up).
export const GUARDED_VERBS = Object.freeze({
  "home.device.pair":   "home.device.pair",   // unknown kind → "authority" (windowed)
  "home.device.revoke": "home.device.revoke", // unknown kind → "authority"
  "home.export":        "vault.export",        // a REVEAL kind → always asks, never suppressed
});

// the step-up kind for a verb, or null if the verb is ambient (no gate).
export function verbStepUpKind(verb) { return GUARDED_VERBS[verb] || null; }

// verbNeedsStepUp(verb, ctx) — does this verb require a step-up right now? Ambient ⇒ false. Otherwise the
// windowed risk policy of holo-stepup (reveal/value never suppressed; authority rides a fresh-window).
export function verbNeedsStepUp(verb, { last = null, nowMs = 0, windowMs = 120000 } = {}) {
  const kind = verbStepUpKind(verb);
  if (!kind) return false;
  return needsStepUp(kind, { last, nowMs, windowMs });
}

// gateVerb(verb, opts) — the enforcement point a Home mutation calls BEFORE it runs. Ambient ⇒ allowed.
// Sensitive ⇒ build a sovereign step-up token (signed by the unlocked owner) and verify it fail-closed.
//   { allowed:true,  guarded:false }                         — ambient verb
//   { allowed:true,  guarded:true, suppressed:true }         — sensitive but a fresh window covers it
//   { allowed:true,  guarded:true, token, kind, atMs }       — stepped up OK (atMs → caller's new `last`)
//   { allowed:false, guarded:true, reason }                  — no signer, or the token failed to verify
export async function gateVerb(verb, { signer = null, payload = null, appId = "holo-home", reason = "", last = null, nowMs = 0, windowMs = 120000, nonce = null } = {}) {
  const kind = verbStepUpKind(verb);
  if (!kind) return { allowed: true, guarded: false };
  if (!needsStepUp(kind, { last, nowMs, windowMs })) return { allowed: true, guarded: true, suppressed: true, kind };
  if (!signer || !signer.kappa || typeof signer.sign !== "function") return { allowed: false, guarded: true, reason: "no-signer", kind };
  const action = { kind, payload, appId, operator: signer.kappa, reason, issuedAt: nowMs, nonce: nonce || ("n" + nowMs) };
  let token;
  try { token = await buildStepUp(action, signer); } catch (e) { return { allowed: false, guarded: true, reason: "build-failed:" + (e && e.message), kind }; }
  const body = await verifyStepUp(token);
  if (!body) return { allowed: false, guarded: true, reason: "stepup-failed", kind };
  return { allowed: true, guarded: true, token, kind, level: levelOf(kind), atMs: nowMs };
}

export default { GUARDED_VERBS, verbStepUpKind, verbNeedsStepUp, gateVerb };
