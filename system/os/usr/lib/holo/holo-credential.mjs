// holo-credential.mjs — the κ-native VERIFIABLE CREDENTIAL. The one primitive Self.ID
// (docs.selfid.com) calls a "Molecule": an issuer-signed claim about a subject, held by
// that subject, verifiable by anyone with NO contact to the issuer and NO registry.
//
// Self.ID carries this on a DID registry + attestor network + ledger. Hologram needs none
// of that: a credential is a κ-object whose name is the hash of its own bytes (Law L1), and
// trust is re-derivation, not a lookup (Law L5). Issue once; verify forever, offline.
//
// SELECTIVE DISCLOSURE without foreign crypto (Law L4 — no BBS+/pairings, WebCrypto only):
// the SD-JWT-VC model, which is pure SHA-256. At issuance each claim becomes a SALTED LEAF
//   leaf = sha256(canon([salt, key, value]))
// and the SIGNED credential commits only to the sorted SET of leaf hashes (`_sd`), never to
// the cleartext. The holder keeps the {salt,key,value} disclosures privately and later reveals
// only the ones a verifier asked for; each revealed leaf must re-derive into the signed `_sd`,
// so the issuer's single signature covers any subset the holder chooses to show.
//
// External ground truth (holospaces "conform, never author"): this is a profile of the
// W3C Verifiable Credentials Data Model 2.0 (@context) serialisable as IETF SD-JWT VC.
//
// Symmetry: `issuer` and `subject` are just κ. A human operator κ (holo-identity) and an agent
// passport κ (holo-agent-passport) verify by the IDENTICAL path — see the witness.
//
// One hashing path (Law L2): canon/addressOf/sha256Hex are imported from holo-identity, the
// same primitives the operator key, session token and roster already commit to.

import { canon, addressOf, sha256Hex } from "./holo-identity.mjs";

const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const RNG = globalThis.crypto || (typeof require !== "undefined" ? require("node:crypto").webcrypto : null);
const te = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => RNG.getRandomValues(new Uint8Array(n));
const W3C_VC = "https://www.w3.org/ns/credentials/v2";

// the SAME WebCrypto axis mapping holo-identity uses (Ed25519, ECDSA P-256 fallback). Plumbing,
// not a second signer — every signature still flows through one verify path (kappaOfPub/verifySig).
const keyParams = (a) => a === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" };
const sigParams = (a) => a === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" };

// the κ of a public key = the address of its raw bytes (CC-1 / Law L1) — an issuer or holder κ
// must equal this, or the claimed identity is forged. Exported so holo-present reuses ONE path.
export async function kappaOfPub(pubB64) { return addressOf(unb64(pubB64)); }
// verify a base64 signature over canonical bytes with a raw public key. Exported for reuse (Law L2).
export async function verifySig(pubB64, alg, sigB64, bytes) {
  try {
    const key = await SUB.importKey("raw", unb64(pubB64), keyParams(alg), false, ["verify"]);
    return SUB.verify(sigParams(alg), key, unb64(sigB64), bytes);
  } catch { return false; }
}

// a salted leaf for one claim — sha256 over the canonical [salt,key,value] triple (SD-JWT shape).
// BRIDGE: SD-JWT-VC (IETF) — the disclosure-hash algorithm is fixed by the selective-disclosure spec a
// foreign verifier checks, so this stays sha256 (NOT a κ). The credential's own id IS a canonical κ.
async function leafOf(disclosure) { return sha256Hex(te.encode(canon(disclosure))); }

// ── ISSUE (the Attestor → Holder act). `issuer` is a holo-identity/passport principal
//    { kappa, alg, pub, sign(), optionally pqAlg/pqPub/pqSign() }. Returns the credential the
//    holder stores: the signed core (commits to `_sd` only) PLUS the private `disclosures` map. ──
export async function issueCredential(issuer, { subject, claims, schema = null, ttlMs = 31536000000, issuedAt = null, context = [] } = {}) {
  if (!issuer || !issuer.kappa || !issuer.sign) throw new Error("issueCredential needs a signing principal");
  if (!subject) throw new Error("a credential must bind a subject κ");
  const subjKappa = typeof subject === "object" ? subject.kappa : subject;
  const now = issuedAt || new Date().toISOString();
  const keys = Object.keys(claims || {}).sort();                                   // canonical claim order (Law L2)
  const disclosures = {}; const sd = [];
  for (const k of keys) {
    const d = [hex(rand(16)), k, claims[k]];                                       // [salt, key, value]
    disclosures[k] = d; sd.push(await leafOf(d));
  }
  sd.sort();                                                                       // the SET commitment is order-free
  const body = {
    "@context": [W3C_VC, ...context], "@type": "HoloCredential",
    issuer: issuer.kappa, subject: subjKappa, schema,
    sdAlg: "sha-256", _sd: sd,
    issuedAt: now, expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(), nonce: hex(rand(8)),
    ...(issuer.pqPub ? { pqAlg: issuer.pqAlg, pqPub: issuer.pqPub } : {}),
  };
  const c = canon(body);
  const kappa = await addressOf(te.encode(c));
  const cred = { kappa, ...body, alg: issuer.alg, pub: issuer.pub, sig: await issuer.sign(c), disclosures };
  if (issuer.pqSign && issuer.pqPub) cred.pqSig = await issuer.pqSign(c);          // hybrid co-signature (Ed25519 ‖ ML-DSA)
  return cred;
}

// the wire form a holder forwards (signed core + _sd, WITHOUT the private disclosures it didn't reveal).
export function credentialCore(cred) {
  const { disclosures, ...core } = cred;                                          // strip the holder's secret material
  return core;
}

// ── VERIFY (anyone, offline, NO issuer contact). Re-derive the κ, re-derive the issuer κ from its
//    pubkey, check the signature(s), expiry, optional schema + revocation hooks. Returns body | null
//    (fail-closed, Law L5). Mirrors holo-identity.verifySession line-for-line in structure. ──
export async function verifyCredential(cred, { now = null, checkSchema = null, isRevoked = null } = {}) {
  try {
    if (!cred || !cred.kappa || !cred.sig) return null;
    const { kappa, alg, pub, sig, pqSig, disclosures, ...body } = cred;
    const c = canon(body);
    if (await addressOf(te.encode(c)) !== kappa) return null;                      // κ commits to the body (incl. _sd)
    if (await kappaOfPub(pub) !== body.issuer) return null;                        // issuer κ = address of its pubkey
    if (!(await verifySig(pub, alg, sig, te.encode(c)))) return null;              // classical signature
    if (body.pqPub) {                                                              // hybrid: ML-DSA co-sig must also hold
      const { mldsaVerify } = await import("./holo-pqc.mjs");
      if (!pqSig || !mldsaVerify(body.pqPub, c, pqSig)) return null;
    }
    const t = now || new Date().toISOString();
    if (body.expiresAt && t > body.expiresAt) return null;                         // expired
    if (checkSchema && body.schema) { if (!(await checkSchema(body))) return null; } // optional holo-strand-rules hook
    if (isRevoked) { try { if (await isRevoked(body.subject, kappa)) return null; } catch { return null; } } // fail-closed
    return body;
  } catch { return null; }
}

// verify a single disclosure against a credential body — leaf must re-derive into the signed `_sd`.
// Returns { key, value } | null. The proof a revealed claim was truly covered by the issuer's signature.
export async function verifyDisclosure(body, disclosure) {
  try {
    if (!body || !Array.isArray(body._sd) || !Array.isArray(disclosure)) return null;
    const leaf = await leafOf(disclosure);
    if (!body._sd.includes(leaf)) return null;
    return { key: disclosure[1], value: disclosure[2] };
  } catch { return null; }
}

// holder-side helper: pick the disclosures for `keys` (the subset a challenge asked for). Returns
// the disclosure triples to reveal, or null if the credential cannot satisfy every asked key.
export function selectiveOpen(cred, keys) {
  const out = {};
  for (const k of keys) { if (!cred.disclosures || !(k in cred.disclosures)) return null; out[k] = cred.disclosures[k]; }
  return out;
}

// ── self-test (node): issue → verify → tamper-refuse → expiry → selective disclosure re-derivation. ──
export async function selftest() {
  const { ephemeral } = await import("./holo-identity.mjs");
  const r = {};
  const issuer = await ephemeral({ label: "Gov" });
  const holder = await ephemeral({ label: "Alice" });
  const cred = await issueCredential(issuer, { subject: holder.kappa, claims: { ageOver18: true, country: "EE", name: "Alice" } });
  const coreStr = canon(credentialCore(cred));                                     // the SIGNED, content-addressed bytes
  r.shape = /^did:holo:sha256:[0-9a-f]{64}$/.test(cred.kappa) && Array.isArray(cred._sd) && cred._sd.length === 3
    && !coreStr.includes("Alice") && !coreStr.includes("\"claims\"");              // no cleartext claim survives in the signed core
  r.verifies = !!(await verifyCredential(cred));
  r.issuerBound = (await verifyCredential(cred)).issuer === issuer.kappa;
  r.tamperBody = (await verifyCredential({ ...cred, subject: "did:holo:sha256:" + "0".repeat(64) })) === null;
  r.tamperSd = (await verifyCredential({ ...credentialCore(cred), _sd: [...cred._sd.slice(1), "0".repeat(64)] })) === null;
  r.expired = (await verifyCredential(cred, { now: "2999-01-01T00:00:00Z" })) === null;
  r.revoked = (await verifyCredential(cred, { isRevoked: async () => true })) === null;
  const body = await verifyCredential(cred);
  const d = await verifyDisclosure(body, cred.disclosures.ageOver18);
  r.disclosureReDerives = d && d.key === "ageOver18" && d.value === true;
  r.forgedDisclosure = (await verifyDisclosure(body, [cred.disclosures.ageOver18[0], "ageOver18", false])) === null;
  r.ok = Object.values(r).every(Boolean);
  return r;
}

if (typeof process !== "undefined" && process.argv && /holo-credential\.mjs$/.test(process.argv[1] || "")) {
  selftest().then((r) => { console.log("holo-credential selftest:", r); process.exit(r.ok ? 0 : 1); });
}
