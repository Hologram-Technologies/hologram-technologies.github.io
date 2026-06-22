// holo-attest.mjs — PORTABLE κ-ATTESTATION: "prove what this is, that it hasn't changed, and what
// will execute — before you trust it." The counterparty-facing projection of the primitives we already
// own (κ/L5 from holo-identity, the TEE step-up axis from holo-stepup). Where a session proves "this
// operator is here" and a step-up proves "this operator approved THIS act", an attestation proves
// "THIS κ will run, under THIS sealed closure, on a device with THIS TEE evidence" to a RELYING PARTY
// who checks it BEFORE granting consent or data. Trust is granted to a re-derivable proof, not a host.
//
// This is the RATS model (IETF RFC 9334) realised on the κ substrate:
//   Attester        — this device (the operator principal + its TEE).
//   Evidence        — the HoloAttestation record below (content-addressed, signed).
//   Verifier        — verifyAttestation() (pure, offline, fail-closed, re-derivable from the record alone).
//   Relying Party   — the counterparty, who supplies `expect` constraints (the κ it asked about, the
//                     sealed closure it trusts, a freshness nonce) and acts only on a verified result.
//   Attestation Result — the verified body, or null. Never a partial trust.
//
// Honest scope: the EXECUTION-environment evidence available in the browser substrate is the platform
// authenticator's user-verification (TEE-backed key presence, the same WebAuthn axis holo-stepup binds).
// A full hardware quote (Intel TDX / AMD SEV-SNP / NVIDIA CC — see RFC 9334 §Evidence, by reference) is
// the out-of-band frontier; this module carries the axis we can re-derive on-device and names the rest.
//
// One addressing path (Law L4): canon/addressOf are imported from holo-identity — no second hasher.
// Isomorphic: build + verify are pure (Node-witnessable); the WebAuthn axis is reused verbatim from
// holo-stepup so the TEE evidence is checked by exactly one code path.

import { canon, addressOf } from "./holo-identity.mjs";
import { attachWebAuthn, verifyWebAuthnAxis } from "./holo-stepup.mjs";

const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const te = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64u = (buf) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sha256(u8) { return new Uint8Array(await SUB.digest("SHA-256", u8 instanceof Uint8Array ? u8 : new Uint8Array(u8))); }
const hex = (u) => [...new Uint8Array(u)].map((b) => b.toString(16).padStart(2, "0")).join("");
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// ── the canonical Evidence body the attestation κ commits to. Minimal, stable, human-describable. ──
// `subject`  — the κ of WHAT will run (an app/lock/holospace κ). "prove what this is."
// `closure`  — the sealed CLOSURE_KAPPA lineage the subject runs under. "that it hasn't changed since seal."
// `measure`  — re-derivable claims about the execution environment (the TEE axis; never a faked quote).
// `attester` — the operator κ emitting the Evidence. "who attests."
// `audience` — optional relying-party κ this Evidence is scoped to (null = publicly checkable on demand).
// `nonce`    — freshness; a relying party MAY pin its own nonce (RFC 9334 freshness) and check it back.
function attestationBody({ subject, closure = null, measure = null, attester, audience = null, issuedAt, nonce }) {
  return { "@type": "HoloAttestation", subject, closure, measure: measure || { tee: false }, attester, audience, issuedAt, nonce };
}

// challengeFor(body) — base64url(sha256(canon(body))): the bytes the WebAuthn TEE assertion signs over,
// so the authenticator presence is bound to THIS Evidence (identical pattern to holo-stepup).
export async function challengeForAttestation(body) { return b64u(await sha256(te.encode(canon(body)))); }

// ── BUILD (pure): given a fully-formed Evidence body + a signer (the unlocked operator principal,
//    holo-identity/holo-login shape { kappa, alg, pub, sign }), produce the signed, content-addressed
//    HoloAttestation. The id commits to the body (L5); the attester κ is the address of the signing key
//    (CC-1); the signature is over the canonical bytes. `challenge` is carried so a TEE axis may attach.
export async function buildAttestation(body, signer) {
  if (body.attester !== signer.kappa) throw new Error("attest: signer κ does not match the attester");
  const c = canon(body);
  const id = await addressOf(te.encode(c));
  const challenge = b64u(await sha256(te.encode(c)));
  return { id, ...body, challenge, alg: signer.alg, pub: signer.pub, sig: await signer.sign(c) };
}

// attest(params, signer) — the floor: assemble the Evidence and sign it. Emitting attestation reveals
// only κs already disclosable (subject, sealed closure, operator κ) — it is the artifact MEANT to be
// shown ("checkable on demand"), so it carries no consent gate; binding any PRIVATE claim would route
// through holo-proof/holo-stepup instead. `tee` lets the browser glue attach the authenticator axis.
export async function attest({ subject, closure = null, measure = null, audience = null, issuedAt = null, nonce = null } = {}, signer) {
  if (!signer || !signer.kappa) throw new Error("attest needs a signer principal");
  if (!subject) throw new Error("attest needs a subject κ (what will run)");
  const body = attestationBody({ subject, closure, measure, attester: signer.kappa, audience,
    issuedAt: issuedAt || new Date().toISOString(), nonce: nonce || hex(rand(8)) });
  return buildAttestation(body, signer);
}

// attachTee(record, assertion, credPub) — second axis: bind a real WebAuthn assertion over the record's
// challenge as the execution-environment (TEE presence) evidence. Reuses holo-stepup verbatim. The
// `measure.tee` CLAIM is signed into the body at build time (declare it via attest({measure:{tee:true}}));
// this attaches the assertion that PROVES it, into the stripped `webauthn` field — it never mutates the
// signed body (doing so would break the id, Law L5). No-op if no assertion (sovereign axis only).
export function attachTee(record, assertion, credPub) {
  if (!assertion) return record;
  return attachWebAuthn(record, assertion, credPub);
}

// ── VERIFY (pure, offline, fail-closed) — the RELYING PARTY check, runnable identically in Node and the
//    browser. Re-derive the record κ from its own bytes (L5); re-derive the attester κ from the signing
//    key (CC-1); check the signature over the Evidence; then enforce the relying party's constraints:
//      expectSubject  — the κ I asked about must be the κ that was attested (no bait-and-switch).
//      expectClosure  — the sealed closure must equal the one I trust (unchanged-since-seal; the same
//                       Safety-Stop invariant as the SW: drift ⇒ refuse).
//      nonce          — my freshness nonce must come back (replay refused).
//      requireTee     — the WebAuthn/TEE axis must verify (presence really happened).
//    Returns the verified Evidence body, or null. Never a partial result.
export async function verifyAttestation(record, { expectSubject = null, expectClosure = null, nonce = null, requireTee = false, audience = null } = {}) {
  try {
    if (!record || !record.id || !record.sig) return null;
    const { id, challenge, alg, pub, sig, webauthn, ...body } = record;
    const c = canon(body);
    if (await addressOf(te.encode(c)) !== id) return null;                 // L5: id commits to the Evidence body
    if (await addressOf(unb64(pub)) !== body.attester) return null;        // CC-1: attester κ == address of its pubkey
    if (b64u(await sha256(te.encode(c))) !== challenge) return null;       // the carried challenge binds the same bytes
    const key = await SUB.importKey("raw", unb64(pub), alg === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    if (!(await SUB.verify(alg === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" }, key, unb64(sig), te.encode(c)))) return null;
    // ── relying-party constraints (each fail-closed) ──
    if (expectSubject && body.subject !== expectSubject) return null;      // got the κ I asked about
    if (expectClosure && body.closure !== expectClosure) return null;      // sealed closure unchanged (drift ⇒ refuse)
    if (nonce && body.nonce !== nonce) return null;                        // freshness: my nonce came back
    if (audience && body.audience && body.audience !== audience) return null; // scoped Evidence presented to the wrong party
    if (requireTee && !(body.measure && body.measure.tee === true && await verifyWebAuthnAxis(record))) return null; // signed claim AND proof of TEE presence
    return body;
  } catch { return null; }
}

// ── share-link carriage: an attestation rides a shared link as #att=<base64> (the same grain holo-proof
//    uses), so "open this κ" can carry "and here is the proof of what it is". The relying party decodes
//    and verifies BEFORE mounting (fail-closed). Pure base64 of the canonical JSON — no server. ──
export function encodeAttestationLink(record) {
  try { const json = JSON.stringify(record); const enc = (typeof btoa !== "undefined") ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json).toString("base64"); return "#att=" + enc; }
  catch { return ""; }
}
export function decodeAttestationLink(hash) {
  try { const m = String(hash || "").match(/[#&]att=([^&]+)/); if (!m) return null; const json = (typeof atob !== "undefined") ? decodeURIComponent(escape(atob(decodeURIComponent(m[1])))) : Buffer.from(decodeURIComponent(m[1]), "base64").toString("utf8"); return JSON.parse(json); }
  catch { return null; }
}

// browser surface: window.HoloAttest.verify(record, expect) — any holo app / counterparty checks a
// presented attestation BEFORE trusting it, learning only the verified subject/closure/attester (L5).
if (typeof window !== "undefined" && !window.HoloAttest) {
  window.HoloAttest = Object.freeze({ attest, verify: verifyAttestation, build: buildAttestation, attachTee, challengeFor: challengeForAttestation, encodeLink: encodeAttestationLink, decodeLink: decodeAttestationLink });
}

// ── self-test (node): build → verify → tamper-refuse → relying-party constraints (subject/closure/nonce). ──
export async function selftest() {
  const r = {};
  const kp = await SUB.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pubRaw = new Uint8Array(await SUB.exportKey("raw", kp.publicKey));
  const kappa = await addressOf(pubRaw);
  const signer = { kappa, alg: "Ed25519", pub: b64(pubRaw), async sign(s) { const u = typeof s === "string" ? te.encode(s) : s; return b64(await SUB.sign({ name: "Ed25519" }, kp.privateKey, u)); } };
  const subject = "did:holo:sha256:" + "a".repeat(64);
  const closure = "did:holo:sha256:" + "c".repeat(64);
  const rec = await attest({ subject, closure, nonce: "feedfacecafebeef", issuedAt: "2026-06-22T00:00:00.000Z" }, signer);
  r.builds = /^did:holo:sha256:[0-9a-f]{64}$/.test(rec.id) && !!rec.sig && !!rec.challenge;
  r.verifies = (await verifyAttestation(rec)) !== null;                                                  // round-trip
  r.attesterReDerives = (await verifyAttestation(rec)).attester === kappa;                               // CC-1
  r.subjectMatch = (await verifyAttestation(rec, { expectSubject: subject })) !== null;                  // got the κ asked about
  r.subjectMismatch = (await verifyAttestation(rec, { expectSubject: "did:holo:sha256:" + "b".repeat(64) })) === null; // bait-and-switch refused
  r.closureMatch = (await verifyAttestation(rec, { expectClosure: closure })) !== null;                  // sealed closure trusted
  r.closureDrift = (await verifyAttestation(rec, { expectClosure: "did:holo:sha256:" + "d".repeat(64) })) === null;    // drift ⇒ refuse (Safety-Stop)
  r.nonceFresh = (await verifyAttestation(rec, { nonce: "feedfacecafebeef" })) !== null;                 // freshness honoured
  r.nonceReplay = (await verifyAttestation(rec, { nonce: "0000000000000000" })) === null;                // replay/forged nonce refused
  r.tamperSubject = (await verifyAttestation({ ...rec, subject: "did:holo:sha256:" + "e".repeat(64) })) === null;     // changed subject → id mismatch
  r.tamperClosure = (await verifyAttestation({ ...rec, closure: "did:holo:sha256:" + "f".repeat(64) })) === null;     // changed closure → id mismatch
  r.tamperAttester = (await verifyAttestation({ ...rec, attester: "did:holo:sha256:" + "0".repeat(64) })) === null;   // forged attester → refused
  r.wrongSignerRejected = await (async () => { try { await buildAttestation({ ...rec, attester: "did:holo:sha256:" + "1".repeat(64) }, signer); return false; } catch { return true; } })();
  r.requireTeeFailsWithout = (await verifyAttestation(rec, { requireTee: true })) === null;              // no TEE axis → refused when demanded
  r.noRecord = (await verifyAttestation(null)) === null;                                                 // fail-closed
  r.ok = Object.values(r).every(Boolean);
  return r;
}

if (typeof process !== "undefined" && process.argv && /holo-attest\.mjs$/.test(process.argv[1] || "")) {
  selftest().then((r) => { console.log("holo-attest selftest:", r); process.exit(r.ok ? 0 : 1); });
}

export default { attest, buildAttestation, attachTee, verifyAttestation, challengeForAttestation, encodeAttestationLink, decodeAttestationLink };
