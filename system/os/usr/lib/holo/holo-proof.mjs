// holo-proof.mjs — "prove it without showing it": the app-facing layer that lets you share a FACT about
// yourself as a κ-addressable PROOF that reveals nothing else. Built on the GREEN holo-zk selective-disclosure
// (salted-digest SD-JWT) + did:key signing. ISSUER-ASSERTED ATTRIBUTE/BOOLEAN tier (the ~90%): a signed claim
// set; disclose ONLY the chosen attributes; the verifier learns those and nothing more (the rest stay hidden
// by their salt), verify-before-trust (L5). No circuit/SNARK — self-asserted NUMERIC predicates (e.g. "balance
// > X" with no issuer) are the range-proof frontier (bulletproofs, on demand). 100% local; the SHARE is
// consented (holo-stepup) + rides the existing κ-carriage. Pure + isomorphic (Node + browser).
import "./holo-zk.js";                                   // side-effect: sets globalThis.HoloZK (IIFE)
import { jcs, sha256hex, didHolo } from "./holo-uor.mjs";
const ZK = (typeof globalThis !== "undefined" && globalThis.HoloZK) || null;

// issueCredential(claims, signer) — sign a salted-digest claim set under your did:key. The credential is
// PUBLIC-safe (did + pub + digests + sig, no values); the disclosures (salts+values) stay ON-DEVICE.
export async function issueCredential(claims, signer) {
  if (!ZK) throw new Error("holo-proof: holo-zk unavailable");
  const sd = await ZK.sdIssue(claims);                  // { digests (signed set), disclosures (private) }
  const sig = (signer && signer.sign) ? await signer.sign(ZK.jcs(sd.digests)) : null;
  return { "@type": "HoloCredential", did: (signer && signer.did) || null, pub: (signer && signer.publicKeyHex) || null,
    digests: sd.digests, sig, disclosures: sd.disclosures };
}

// proveAttribute(cred, keys) — a κ-PROOF disclosing ONLY `keys`. The κ (id) content-addresses the proof so it
// re-derives (tamper-refuse). The disclosures for the OTHER claims are never included (hidden by salt).
export function proveAttribute(cred, keys) {
  if (!ZK) throw new Error("holo-proof: holo-zk unavailable");
  const pres = ZK.sdDisclose({ digests: cred.digests, disclosures: cred.disclosures }, [].concat(keys || []));
  const body = { "@type": "HoloProof", did: cred.did || null, pub: cred.pub || null, digests: cred.digests, sig: cred.sig || null, revealed: pres.revealed };
  return { ...body, id: didHolo("sha256", sha256hex(jcs(body))) };
}

// verifyProof(proof) — VERIFY-BEFORE-TRUST: (1) κ re-derives over the body (tamper-refuse); (2) the issuer
// signature binds the claim set to the did:key; (3) each revealed claim's digest is in that signed set (else
// forged). Returns ONLY the disclosed facts { ok, did, claims }, or null. Offline, no server.
export async function verifyProof(proof) {
  if (!ZK || !proof || !Array.isArray(proof.digests)) return null;
  const { id, ...body } = proof;
  if (id && id !== didHolo("sha256", sha256hex(jcs(body)))) return null;            // body tampered
  if (proof.sig && proof.pub) { const okSig = await ZK.verifySig(ZK.jcs(proof.digests), proof.sig, proof.pub); if (!okSig) return null; }  // sig binds claim set to issuer
  const got = await ZK.sdVerify({ digests: proof.digests, revealed: proof.revealed || [] });   // each revealed ∈ signed set
  if (!got) return null;
  return { ok: true, did: proof.did || null, claims: got };
}

// shareProof — the B1 flow ("prove X to this app/person"): assemble a signed credential, get PER-ACTION
// CONSENT (holo-stepup, which NAMES exactly what's shared + with whom), then disclose ONLY the consented
// attributes as a κ-proof + a self-contained share link. Refuses without consent. gate injectable (prod =
// biometric step-up; witness = a stub). The recipient decodeProofLink()s it and verifyProof()s — learning
// only the disclosed fact. 100% local; the consent gate is the ONLY egress point.
export async function shareProof({ claims, attributes, audience = null, signer = null, gate = null } = {}) {
  const s = signer || await operatorSigner();
  const cred = await issueCredential(claims, s);
  const attrs = [].concat(attributes || []);
  const action = { kind: "proof.share", attributes: attrs, audience, reason: "Share a proof of [" + attrs.join(", ") + "]" + (audience ? " with " + audience : "") + " — nothing else is revealed." };
  const consent = gate ? await gate(action) : await defaultGate(action);
  if (!consent || !consent.ok) return { ok: false, refused: true, reason: (consent && consent.reason) || "consent required", action };
  const proof = proveAttribute(cred, attrs);
  let enc; try { enc = (typeof btoa !== "undefined") ? btoa(unescape(encodeURIComponent(JSON.stringify(proof)))) : Buffer.from(JSON.stringify(proof)).toString("base64"); } catch (e) { enc = ""; }
  return { ok: true, proof, action, link: "#proof=" + enc };
}
async function defaultGate(action) {
  try { const m = await import("./holo-stepup.mjs"); if (m.requireStepUp) { const tok = await m.requireStepUp({ kind: action.kind, payload: { attributes: action.attributes, audience: action.audience }, reason: action.reason }); return { ok: !!tok, token: tok }; } } catch (e) {}
  return { ok: false, reason: "step-up unavailable" };
}
// decodeProofLink(hash) — the recipient side: extract the proof from a #proof= link to verify it offline.
export function decodeProofLink(hash) {
  try { const m = String(hash || "").match(/[#&]proof=([^&]+)/); if (!m) return null; const json = (typeof atob !== "undefined") ? decodeURIComponent(escape(atob(decodeURIComponent(m[1])))) : Buffer.from(decodeURIComponent(m[1]), "base64").toString("utf8"); return JSON.parse(json); } catch (e) { return null; }
}

// signer helpers: the OS-wide persistent did:key (browser) or an ephemeral one (Node/witness).
export async function operatorSigner() {
  try { if (ZK.identitySigner && typeof localStorage !== "undefined") return await ZK.identitySigner(); } catch (e) {}
  return ZK.genSigner();                                 // Node / no-localStorage → an ephemeral did:key
}

// browser surface: window.HoloProof.verify(proof) — any holo app calls this to check a presented proof,
// learning only the disclosed fact (verify-before-trust). The PROVE side (assemble + stepup-consent + share)
// is driven by Q / the Share carriage (holo-proof-ui), not here.
if (typeof window !== "undefined" && !window.HoloProof) {
  window.HoloProof = Object.freeze({ verify: verifyProof, prove: proveAttribute, issue: issueCredential, signer: operatorSigner, share: shareProof, decode: decodeProofLink });
}
export default { issueCredential, proveAttribute, verifyProof, operatorSigner, shareProof, decodeProofLink };
