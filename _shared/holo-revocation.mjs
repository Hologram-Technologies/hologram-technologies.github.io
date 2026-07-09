// holo-revocation.mjs — κ-native revocation for Agent Passports: a sealed, owner-signed SET of revoked
// agent (subject) κs. The only net-new primitive the passport needs; everything else already existed in
// holo-delegate / holo-stepup / holo-identity. No CA, no coordinator, no real-time receipt server —
// SEC-4 ("identity self-sovereign and unforgeable") and holo-apps §2.3 ("a verified replica, not a
// coordinator") forbid an authority, and a receipt server would break offline verification (SEC-5).
//
// First principles (holospaces Laws):
//   • Revocation is an OBJECT (L1): { issuer, epoch, revoked:[...].sort(), issuedAt } → hybrid-signed → κ.
//     Revoking an entry changes the bytes, hence the κ — the set is self-describing and dedups network-wide.
//   • Verify by re-derivation, fail closed (L5): tampered bytes, a forged either-half signature, or a stale
//     set (issuedAt older than the caller's freshness window) all refuse.
//   • Authority only narrows (SEC-2): only the issuing operator's key can sign its own revocation set.
//   • Mirrors verifyDelegation EXACTLY (same canon, same hybrid Ed25519 ‖ ML-DSA check) — no new crypto.

import { sha256, ed25519 } from "./wdk-crypto/wdk-crypto.bundle.mjs";
import { mldsaVerify } from "./holo-pqc.mjs";

const te = new TextEncoder();
const HEXC = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0"));
const hex = (u) => { let s = ""; for (let i = 0; i < u.length; i++) s += HEXC[u[i]]; return s; };
const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// canonical JSON (recursively sorted keys) — identical to holo-delegate, so both re-derive the same κ (L5)
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
  : JSON.stringify(v);
const kappaOf = (s) => "did:holo:sha256:" + hex(sha256(te.encode(s)));

// ── build a revocation set: the operator hybrid-signs (Ed25519 ‖ ML-DSA) the sorted, de-duped list of
//    revoked subject κs. `operator` is a holo-login principal { kappa, pub, pqPub, sign(), pqSign() }.
//    `epoch` lets the issuer monotonically version sets; `issuedAt` is the freshness stamp the gate checks. ──
export async function buildRevocationSet(operator, subjects = [], { epoch = 0, issuedAt = null } = {}) {
  const body = {
    "@context": "https://hologram.os/ns/identity", "@type": "HoloRevocation",
    issuer: operator.kappa, issuerPub: operator.pub, issuerPq: operator.pqPub,   // lineage: signed by THIS operator
    epoch, revoked: [...new Set(subjects)].sort(), issuedAt,
  };
  const c = canon(body);
  return { id: kappaOf(c), ...body, alg: "Ed25519", sig: await operator.sign(c), pqSig: operator.pqSign(c) }; // HYBRID
}

// ── verify a revocation set (anyone, offline): re-derive κ, check BOTH signatures. Returns body | null. ──
export function verifyRevocationSet(set) {
  try {
    const { id, alg, sig, pqSig, ...body } = set;
    const c = canon(body);
    if (kappaOf(c) !== id) return null;                                          // id commits to the body (L5)
    if (!ed25519.verify(unb64(sig), te.encode(c), unb64(body.issuerPub))) return null;  // classical half
    if (!mldsaVerify(body.issuerPq, c, pqSig)) return null;                      // post-quantum half (both required)
    return body;
  } catch { return null; }
}

// is a subject κ present in an ALREADY-VERIFIED set body?
export const isRevoked = (body, subjectKappa) =>
  !!body && Array.isArray(body.revoked) && body.revoked.includes(subjectKappa);

// freshness window (last-known-good policy): the set's issuedAt must be within ttlMs of `nowIso`, and not in
// the future. A set with no issuedAt / no nowIso / no ttl is treated as NEVER fresh (fail closed) so a caller
// can never accidentally accept an unstamped set. Returns boolean.
export function freshEnough(body, { nowIso = null, ttlMs = 0 } = {}) {
  if (!body || !body.issuedAt || !nowIso || !ttlMs) return false;
  const now = Date.parse(nowIso), at = Date.parse(body.issuedAt);
  if (Number.isNaN(now) || Number.isNaN(at)) return false;
  return now >= at && (now - at) <= ttlMs;
}
