// holo-openbank-prove.mjs — prove "my balance is at least £X" as a shareable κ-link, WITHOUT revealing the
// amount, the account, or which bank. The killer B2B use of Open Banking (affordability / income proof for a
// landlord or lender), made privacy-preserving and verifiable by ANYONE off-Hologram.
//
// First principles:
//   • A proof IS a step-up attestation (holo-stepup): the predicate {ccy, threshold, holds, asOf, expiresAt}
//     is the PAYLOAD, bound by ONE biometric. So the whole offline verifier comes for free — verifyStepUp
//     re-derives the κ (L5), re-derives the operator κ from the signing key (CC-1), checks the sovereign
//     signature over the exact bytes, and fails closed. No new crypto, no new trust root.
//   • Selective disclosure: the payload carries the PREDICATE ONLY. No balance, no account id, no bank name,
//     no statement. The verifier learns "operator κ proved ≥ £X in GBP, valid until T" — nothing more.
//   • Tamper-evident by construction: flip the threshold or the holds bit and the κ no longer re-derives /
//     the signature breaks. Time-bound: a proof past expiresAt is refused.
//   • Two assurance levels, stated honestly. Operator axis (always): proves THIS identity issued it,
//     untampered — but a user could assert holds=true without a real balance. Attestor axis (optional):
//     the licensed TPP/aggregator that READ the balance under consent co-signs the κ — THAT is what makes
//     the proof trustworthy to a stranger. The verifier reports assurance:"self" vs "attested" plainly.
//   • Off-Hologram: the proof travels in a b64url URL fragment (Holo Pay's pattern). A standalone verify page
//     in any browser decodes it and runs verifyBalanceProof — no Hologram, no server, no account access.
//
// Pure + isomorphic: the live balance read (openbank) and the operator step-up are injected; verify is offline.

import { verifyStepUp } from "./holo-stepup.mjs";
import { addressOf } from "./holo-identity.mjs";

const te = new TextEncoder();
const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const unb64 = (s) => Uint8Array.from(atobSafe(s), (c) => c.charCodeAt(0));
const btoaSafe = (s) => (typeof btoa === "function") ? btoa(s) : Buffer.from(s, "binary").toString("base64");
const atobSafe = (s) => (typeof atob === "function") ? atob(s) : Buffer.from(s, "base64").toString("binary");
const b64uEnc = (obj) => { const bin = String.fromCharCode(...te.encode(JSON.stringify(obj))); return btoaSafe(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const b64uDec = (s) => { const t = String(s).replace(/-/g, "+").replace(/_/g, "/"); const bin = atobSafe(t + "===".slice((t.length + 3) % 4)); return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))); };

// the proof minus its attestor axis — exactly the bytes the operator step-up signed (attestor is added AFTER).
const operatorView = (proof) => { const { attestor, ...rest } = proof; return rest; };

// mintBalanceProof — read the LIVE balance, compute the predicate, bind it with ONE operator biometric, and
// (optionally) have the TPP attest the κ. stepUp: (action)->verified step-up token (browser: requireStepUp;
// witness: buildStepUp+signer). attest: (kappa)->b64 signature over the proof κ; attestor: { kappa, alg, pub }.
export async function mintBalanceProof(openbank, { accountId, consent, ccy, threshold, issuedAt, validForMs = 7 * 86400000, reason, stepUp, attest, attestor, now = Date.now() } = {}) {
  if (typeof stepUp !== "function") return { ok: false, reason: "a stepUp signer is required" };
  const r = await openbank.getBalance(accountId, { consent });
  if (!r || !r.ok) return { ok: false, reason: "balance read failed" };
  const bal = r.balance;
  const holds = bal.ccy === ccy && Number(bal.amount) >= Number(threshold);   // computed from REAL data, never free-typed
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  const payload = {
    "@type": "BalanceAtLeast", ccy, threshold: String(threshold), holds, asOf: bal.asOf,
    issuedAt: issuedAt || new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + validForMs).toISOString(),
    basis: "open-banking-ais",                                                // predicate ONLY — no amount, no account, no bank
  };
  const token = await stepUp({ kind: "bank.disclose", payload, reason: reason || `Prove balance ≥ ${threshold} ${ccy}` });
  if (!token || !token.id) return { ok: false, reason: "operator step-up failed" };
  let proof = token;
  if (attest && attestor) proof = { ...token, attestor: { kappa: attestor.kappa, alg: attestor.alg || "Ed25519", pub: attestor.pub, sig: await attest(token.id) } };
  return { ok: true, holds, proof };
}

export const encodeProofLink = (proof, { base = "https://hologram.os/verify" } = {}) => `${base}#p=${b64uEnc(proof)}`;
export function decodeProofLink(url) {
  try { const frag = String(url).split("#")[1] || ""; const m = new URLSearchParams(frag).get("p"); return m ? b64uDec(m) : null; } catch { return null; }
}

// verifyAttestor — the TPP/aggregator axis: its key re-derives to its κ (CC-1) and its signature verifies over
// the proof κ. This is the bit that says "a licensed party that read the balance vouches for it."
async function verifyAttestor(proof) {
  try {
    const a = proof.attestor; if (!a || !a.pub || !a.sig) return false;
    if (await addressOf(unb64(a.pub)) !== a.kappa) return false;             // CC-1 for the attestor
    const key = await SUB.importKey("raw", unb64(a.pub), { name: "Ed25519" }, false, ["verify"]);
    return SUB.verify({ name: "Ed25519" }, key, unb64(a.sig), te.encode(proof.id));
  } catch { return false; }
}

// verifyBalanceProof — OFFLINE, fail-closed. Operator axis (always) + expiry + optional attestor axis.
// A present-but-INVALID attestor is a hard fail (tamper), never a silent downgrade. Returns the predicate only.
export async function verifyBalanceProof(proof, { now = Date.now(), requireAttested = false } = {}) {
  const reasons = [];
  if (!proof || proof.kind !== "bank.disclose") return { ok: false, reasons: ["not a balance proof"] };
  const body = await verifyStepUp(operatorView(proof));                       // L5 + CC-1 + sovereign signature
  if (!body) return { ok: false, reasons: ["operator signature invalid"] };
  const p = body.payload || {};
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (p.expiresAt && nowMs > Date.parse(p.expiresAt)) reasons.push("expired");
  if (p.issuedAt && nowMs < Date.parse(p.issuedAt)) reasons.push("not yet valid");
  let assurance = "self";
  if (proof.attestor) { (await verifyAttestor(proof)) ? (assurance = "attested") : reasons.push("attestation invalid"); }
  else if (requireAttested) reasons.push("no attestation");
  return {
    ok: reasons.length === 0, holds: !!p.holds, ccy: p.ccy, threshold: p.threshold,
    operator: body.operator, asOf: p.asOf, issuedAt: p.issuedAt, expiresAt: p.expiresAt, assurance, reasons,
  };
}

export default { mintBalanceProof, encodeProofLink, decodeProofLink, verifyBalanceProof };
