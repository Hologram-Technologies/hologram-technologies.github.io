// holo-vc.mjs — W3C Verifiable Credentials (S6 / Agentic-Web trust face). An issuer (a did:holo identity)
// makes a signed, machine-checkable CLAIM about a subject (typically a κ-object), bound into the UOR
// envelope's trust face so agents delegate and are accountable. Authority: W3C VC Data Model 2.0 + VC Data
// Integrity (cryptosuite eddsa-jcs-2022 — JCS canonicalization, which IS the substrate's canonical form,
// Law L2; ed25519 signature). Node/app-side (ed25519 via node:crypto; the browser verify path can use
// WebCrypto later). JCS comes from the ONE isomorphic substrate so issuer and verifier canonicalize equally.

import { jcs } from "../usr/lib/holo/holo-uor.mjs";
import { generateKeyPairSync, sign as edSign, verify as edVerify, createPublicKey } from "node:crypto";

const enc = (s) => Buffer.from(s, "utf8");
const concat = (...arrs) => { const u = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of arrs) { u.set(a, o); o += a.length; } return u; };

// base58btc (multibase 'z') — used for the ed25519 Multikey and the proofValue.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58encode(bytes) {
  let zeros = 0; while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const num = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < num.length; j++) { carry += num[j] << 8; num[j] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { num.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let str = "1".repeat(zeros);
  for (let i = num.length - 1; i >= 0; i--) str += B58[num[i]];
  return str;
}
function base58decode(str) {
  const bytes = [0];
  for (const ch of str) {
    const val = B58.indexOf(ch); if (val < 0) throw new Error("bad base58 char");
    let carry = val;
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  let zeros = 0; for (const ch of str) { if (ch === "1") zeros++; else break; }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i];
  return out;
}

const ED_MULTICODEC = Uint8Array.from([0xed, 0x01]);                                   // multicodec: ed25519-pub
const SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
const rawPub = (publicKey) => new Uint8Array(publicKey.export({ type: "spki", format: "der" })).slice(-32);
const pubFromMultibase = (mb) => createPublicKey({ key: Buffer.from(concat(SPKI_PREFIX, base58decode(String(mb).slice(1)).slice(2))), format: "der", type: "spki" });

// generateKey() → an ed25519 keypair + its ed25519 Multikey (publicKeyMultibase, 'z'+base58btc(0xed01‖raw)).
export function generateKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey, privateKey, publicKeyMultibase: "z" + base58encode(concat(ED_MULTICODEC, rawPub(publicKey))) };
}

// issueCredential({issuer, subject, type, claims, key, created}) → a VC 2.0 with an eddsa-jcs-2022 Data
// Integrity proof. The proof OPTIONS are part of the canonicalized signing input; proofValue is the
// multibase ed25519 signature. `created` is passed in (deterministic — no ambient clock).
export function issueCredential({ issuer, subject, type = [], claims = {}, key, created = "1970-01-01T00:00:00Z" }) {
  const credential = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", ...type],
    issuer,
    credentialSubject: { id: subject, ...claims },
  };
  const proof = { type: "DataIntegrityProof", cryptosuite: "eddsa-jcs-2022", created, verificationMethod: issuer + "#key-1", proofPurpose: "assertionMethod" };
  const signingInput = enc(jcs({ ...credential, proof }));                              // canonicalize doc + proof options
  proof.proofValue = "z" + base58encode(new Uint8Array(edSign(null, signingInput, key.privateKey)));
  return { ...credential, proof };
}

// verifyCredential(vc, {publicKey | publicKeyMultibase}) → { ok, why? }. Re-canonicalizes the credential with
// the proof options (minus proofValue) and verifies the ed25519 signature. A tampered claim or proof fails.
export function verifyCredential(vc, { publicKey, publicKeyMultibase } = {}) {
  if (!vc || !vc.proof || !vc.proof.proofValue) return { ok: false, why: "no proof" };
  const { proof, ...credential } = vc;
  const { proofValue, ...proofOpts } = proof;
  if (proofOpts.cryptosuite !== "eddsa-jcs-2022") return { ok: false, why: "unsupported cryptosuite" };
  let pub; try { pub = publicKey || pubFromMultibase(publicKeyMultibase); } catch (e) { return { ok: false, why: "bad key: " + ((e && e.message) || e) }; }
  let sig; try { sig = base58decode(String(proofValue).slice(1)); } catch { return { ok: false, why: "bad proofValue" }; }
  const signingInput = enc(jcs({ ...credential, proof: proofOpts }));
  return { ok: edVerify(null, signingInput, pub, Buffer.from(sig)) };
}
