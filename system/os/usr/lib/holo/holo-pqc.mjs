// holo-pqc.mjs — Holo's HYBRID, crypto-agile, post-quantum primitive. 100% serverless (vendored audited
// @noble — same lineage as wdk-crypto), no CDN, no custom cryptography. This is the security floor the
// unified Holo Identity (one sovereign self-verifying κ) is built on.
//
// First principles (holospaces Laws + NIST):
//   • HYBRID by default — classical ‖ post-quantum, so a break in EITHER family is not a break of the
//     system. Ed25519 ‖ ML-DSA-65 (FIPS 204) for signatures; X25519 ‖ ML-KEM-1024 (FIPS 203) for key
//     establishment; AES-256-GCM at rest; SLH-DSA (FIPS 205) as a hash-based backup signer.
//   • CRYPTO-AGILE — every signed/sealed object COMMITS to its scheme id (SCHEMES.*). The identity κ is
//     the content address of a VERSIONED public-key object, so verify-by-re-derivation (Law L5) checks
//     the RIGHT algorithm and a scheme can be retired/added without reinterpreting past objects.
//   • HARVEST-NOW-DECRYPT-LATER — the seed/vault is long-lived, so its data-key is encapsulated with the
//     hybrid KEM NOW; a future quantum adversary who harvested today's ciphertext still cannot open it.
//   • NO custom crypto — only the audited primitives; combiners are SHA-256 KDFs (a standard construction).
//
// Isomorphic: Node + browser (SubtleCrypto for AES-GCM; @noble for the rest). Pure + witnessable.

import { ed25519, sha256 } from "./wdk-crypto/wdk-crypto.bundle.mjs";                 // classical sig + hash (already vendored)
import { ml_dsa65, ml_kem1024, slh_dsa_sha2_256f, x25519 } from "./holo-pqc/holo-pqc.bundle.mjs"; // FIPS 203/204/205 + x25519

const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const te = new TextEncoder();
const HEXC = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0"));
const hex = (u) => { let s = ""; for (let i = 0; i < u.length; i++) s += HEXC[u[i]]; return s; };
const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const cat = (...arrs) => { const n = arrs.reduce((a, u) => a + u.length, 0), out = new Uint8Array(n); let o = 0; for (const u of arrs) { out.set(u, o); o += u.length; } return out; };
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// ── scheme registry — VERSIONED. Add rows; never reinterpret an existing id (crypto-agility). ──────────
export const SCHEMES = {
  sign:       "hybrid:ed25519+ml-dsa-65/v1",   // FIPS 204 lattice ‖ classical EdDSA
  signBackup: "hash:slh-dsa-sha2-256f/v1",     // FIPS 205 hash-based (different math, defence-in-depth)
  kem:        "hybrid:x25519+ml-kem-1024/v1",  // FIPS 203 lattice ‖ classical ECDH
  aead:       "aes-256-gcm/v1",                // authenticated at-rest
};

// ── HYBRID SIGNATURES (Ed25519 ‖ ML-DSA-65) — a signature is valid only if BOTH halves verify ─────────
export function signKeygen() {
  const edSk = ed25519.utils.randomSecretKey();
  const pq = ml_dsa65.keygen();
  return { scheme: SCHEMES.sign, sk: { ed: edSk, pq: pq.secretKey }, pub: { ed: ed25519.getPublicKey(edSk), pq: pq.publicKey } };
}
const asBytes = (m) => typeof m === "string" ? te.encode(m) : m;
export function hybridSign(sk, msg) { const m = asBytes(msg); return { scheme: SCHEMES.sign, ed: b64(ed25519.sign(m, sk.ed)), pq: b64(ml_dsa65.sign(m, sk.pq)) }; }
export function hybridVerify(pub, msg, sig) {
  try { if (!sig || sig.scheme !== SCHEMES.sign) return false; const m = asBytes(msg);
    return ed25519.verify(unb64(sig.ed), m, pub.ed) && ml_dsa65.verify(unb64(sig.pq), m, pub.pq); } catch { return false; }
}
// SLH-DSA backup signer (hash-based) — for anchors that must survive a lattice break too.
export function slhKeygen() { const k = slh_dsa_sha2_256f.keygen(); return { scheme: SCHEMES.signBackup, sk: k.secretKey, pub: k.publicKey }; }
export function slhSign(sk, msg) { return b64(slh_dsa_sha2_256f.sign(asBytes(msg), sk)); }
export function slhVerify(pub, msg, sig) { try { return slh_dsa_sha2_256f.verify(unb64(sig), asBytes(msg), pub); } catch { return false; } }

// ── HYBRID KEM (X25519 ‖ ML-KEM-1024) — shared secret = SHA-256(x25519_dh ‖ mlkem_ss ‖ scheme) ─────────
export function kemKeygen() {
  const xSk = x25519.utils.randomSecretKey();
  const pq = ml_kem1024.keygen();
  return { scheme: SCHEMES.kem, sk: { x: xSk, pq: pq.secretKey }, pub: { x: x25519.getPublicKey(xSk), pq: pq.publicKey } };
}
const kdf = (xs, ps) => sha256(cat(xs, ps, te.encode(SCHEMES.kem)));   // combiner KDF (binds both halves)
export function hybridEncaps(pub) {
  const eph = x25519.utils.randomSecretKey();
  const xs = x25519.getSharedSecret(eph, pub.x);
  const { cipherText, sharedSecret } = ml_kem1024.encapsulate(pub.pq);
  return { scheme: SCHEMES.kem, ct: { x: b64(x25519.getPublicKey(eph)), pq: b64(cipherText) }, ss: kdf(xs, sharedSecret) };
}
export function hybridDecaps(sk, ct) {
  const xs = x25519.getSharedSecret(sk.x, unb64(ct.x));
  const ps = ml_kem1024.decapsulate(unb64(ct.pq), sk.pq);
  return kdf(xs, ps);
}

// ── AEAD at-rest (AES-256-GCM) ─────────────────────────────────────────────────────────────────────────
export async function aeadSeal(key32, plaintext, aad) {
  const iv = rand(12), k = await SUB.importKey("raw", key32, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await SUB.encrypt({ name: "AES-GCM", iv, additionalData: aad || new Uint8Array() }, k, asBytes(plaintext)));
  return { scheme: SCHEMES.aead, iv: b64(iv), ct: b64(ct) };
}
export async function aeadOpen(key32, sealed, aad) {
  const k = await SUB.importKey("raw", key32, "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await SUB.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv), additionalData: aad || new Uint8Array() }, k, unb64(sealed.ct)));
}

// ── SELF-VERIFYING IDENTITY κ — the content address of the VERSIONED hybrid public-key object. Identity
//    IS content (Law L1); anyone can re-derive κ from the pubkeys and refuse a mismatch (Law L5). The
//    scheme is COMMITTED, so the κ is crypto-agile by construction. ───────────────────────────────────
export function identityCanon(pub) {
  return JSON.stringify({ "@context": "https://hologram.os/ns/identity", "@type": "HoloIdentityKey", scheme: SCHEMES.sign, ed: b64(pub.ed), pq: b64(pub.pq) });
}
export function identityKappa(pub) { return "did:holo:sha256:" + hex(sha256(te.encode(identityCanon(pub)))); }
// re-derive + check (the verify-by-re-derivation gate)
export function verifyIdentityKappa(pub, kappa) { return identityKappa(pub) === kappa; }

export const VERSION = "holo-pqc/1";
