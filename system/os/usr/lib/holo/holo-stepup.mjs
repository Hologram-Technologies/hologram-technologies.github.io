// holo-stepup.mjs — payload-bound biometric STEP-UP for security-sensitive actions.
//
// A session proves "this operator is here." A step-up proves "this operator, present at THIS device's
// TEE right now, approved THIS exact action." It is the realization of the holo-apps standard's
// "explicit consent" for consent-bearing kinds (value transfer, membership/epoch, key reveal,
// delegation issuance): a signature MUST NOT be produced for those kinds without a corresponding
// human-presence proof bound to the act itself.
//
// One ceremony, three commitments, key wiped:
//   1) challenge = sha256(canon(action))  — so the WebAuthn assertion signature commits to the payload,
//      not a random nonce. The authenticator's userVerification:required gate proves fresh presence.
//   2) the SAME ceremony's PRF secret unlocks the vault → re-derives the sovereign principal, which
//   3) signs canon(action) (Ed25519 ‖ ML-DSA). The principal is discarded immediately after.
//
// The result is a content-addressed StepUp attestation that (a) re-derives to its own κ (Law L5),
// (b) re-derives to the operator κ (CC-1), (c) carries a sovereign signature over the action bytes,
// and (d) optionally carries the authenticator's own signature over the same bytes (second axis,
// when the credential's public key was captured at enrol). Offline-verifiable; fail-closed.
//
// Isomorphic: the build/verify CORE is pure (Node-witnessable). The browser glue `requireStepUp`
// composes holo-webauthn (teeAssert) + holo-login (unlock) and lives behind the same import.
// Single addressing path: canon/addressOf are imported from holo-identity (no second hashing).

import { canon, addressOf } from "./holo-identity.mjs";

const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const te = new TextEncoder();
const td = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64u = (buf) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => { const t = String(s).replace(/-/g, "+").replace(/_/g, "/"); return unb64(t + "===".slice((t.length + 3) % 4)); };
async function sha256(u8) { return new Uint8Array(await SUB.digest("SHA-256", u8 instanceof Uint8Array ? u8 : new Uint8Array(u8))); }
const rand = (n) => (globalThis.crypto).getRandomValues(new Uint8Array(n));
const hex = (u) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");

// ── which actions REQUIRE a fresh step-up, and when a recent one may stand in (the trust window). ──
// The point of the system is to ask ONCE, only when authority actually escalates, and always say why.
// Levels: "value" (irreversible transfer) and "reveal" (surface the key) ALWAYS step up — they never
// ride a trust window. "authority" (issue/attenuate a delegation, membership/epoch) steps up but a very
// recent one for the SAME kind may stand. "low" never steps up. Unknown kinds default to "authority"
// (fail-safe: a kind nobody classified is treated as sensitive, never silently waved through).
const VALUE = new Set(["wallet.send", "wallet.swap", "wallet.swapEvm", "wallet.bridge", "wallet.lending", "wallet.fiat", "wallet.signTypedData", "wallet.sign", "tx.send"]);
const REVEAL = new Set(["identity.revealMnemonic", "identity.exportKey", "backup.export", "vault.reveal", "vault.export"]);
const AUTHORITY = new Set(["delegation.issue", "delegation.attenuate", "space.membership", "space.epoch", "terms.grantSensitive", "everything.open", "capability.grant"]);
const LOW = new Set(["app.open", "file.read", "ui.navigate"]);

export function levelOf(kind) {
  if (VALUE.has(kind)) return "value";
  if (REVEAL.has(kind)) return "reveal";
  if (LOW.has(kind)) return "low";
  return "authority"; // AUTHORITY set + every unknown kind → sensitive by default (fail-safe)
}

// needsStepUp(kind, ctx) -> boolean. ctx: { last:{kind,atMs} | null, nowMs, windowMs=120000 }.
// Risk-scaled suppression: a "value" or "reveal" act always asks; an "authority" act may be suppressed
// only if an identical-kind step-up happened within the window. "low" never asks. This is what makes
// it feel effortless without ever waving through money or a key.
export function needsStepUp(kind, { last = null, nowMs = 0, windowMs = 120000 } = {}) {
  const lvl = levelOf(kind);
  if (lvl === "low") return false;
  if (lvl === "value" || lvl === "reveal") return true;            // never suppressed
  if (last && last.kind === kind && nowMs - (last.atMs || 0) < windowMs) return false; // same authority kind, fresh
  return true;
}

// ── the canonical action body the whole ceremony commits to. Stable, minimal, human-describable. ──
// `reason` is the in-context sentence shown to the operator ("Send 0.4 ETH to 0x…"). It is committed,
// so the thing the human read is the thing that was signed.
function actionBody({ kind, payload = null, appId = "", operator, reason = "", issuedAt, nonce }) {
  return { "@type": "HoloStepUp", kind, appId, operator, reason, payload, issuedAt, nonce };
}

// challengeFor(action) -> base64url(sha256(canon(action))) — the bytes the WebAuthn assertion signs over.
export async function challengeFor(action) { return b64u(await sha256(te.encode(canon(action)))); }

// ── BUILD (pure): given a fully-formed action + a signer (the unlocked principal), produce the
//    sovereign-signed StepUp token. `signer` is the holo-login principal shape:
//    { kappa, alg, pub, sign(strOrBytes)->b64, pqAlg?, pqPub?, pqSign?(strOrBytes)->sig }.
export async function buildStepUp(action, signer) {
  if (action.operator !== signer.kappa) throw new Error("step-up: signer κ does not match the action operator");
  const c = canon(action);
  const id = await addressOf(te.encode(c));
  const challenge = b64u(await sha256(te.encode(c)));
  const token = { id, ...action, challenge, alg: signer.alg, pub: signer.pub, sig: await signer.sign(c) };
  if (signer.pqSign && signer.pqPub) { token.pqAlg = signer.pqAlg; token.pqPub = signer.pqPub; token.pqSig = await signer.pqSign(c); }
  return token;
}

// ── attach the SECOND axis (browser): the raw WebAuthn assertion over the same challenge. `credPub`
//    (SPKI captured at enrol) makes the authenticator signature offline-verifiable; without it the
//    assertion still carries presence (UV flag) but only the sovereign axis is cryptographically checked.
export function attachWebAuthn(token, assertion, credPub) {
  if (!assertion) return token;
  return { ...token, webauthn: {
    credentialId: assertion.credentialId,
    clientDataJSON: assertion.clientDataJSON,   // base64url
    authenticatorData: assertion.authenticatorData, // base64url
    signature: assertion.signature,             // base64url (DER for ES256)
    credPub: credPub || assertion.credPub || null,  // base64url SPKI
  } };
}

// DER ECDSA (r,s) → raw 64-byte r||s for WebCrypto verify. WebAuthn ES256 signatures are DER-encoded.
function der2raw(der) {
  let i = 0; if (der[i++] !== 0x30) throw new Error("bad DER"); if (der[i] & 0x80) i += (der[i] & 0x7f); i++;
  if (der[i++] !== 0x02) throw new Error("bad DER r"); let rl = der[i++]; let r = der.slice(i, i + rl); i += rl;
  if (der[i++] !== 0x02) throw new Error("bad DER s"); let sl = der[i++]; let s = der.slice(i, i + sl);
  const strip = (x) => { while (x.length > 32 && x[0] === 0) x = x.slice(1); return x; };
  const pad = (x) => { const o = new Uint8Array(32); o.set(strip(x), 32 - strip(x).length); return o; };
  const out = new Uint8Array(64); out.set(pad(r), 0); out.set(pad(s), 32); return out;
}

// verifyWebAuthnAxis(token) -> boolean. Checks: clientData.type==="webauthn.get", its challenge equals
// the token challenge (payload binding at the authenticator), the UV (user-verified) flag is set, and —
// when credPub is present — the assertion signature verifies over authenticatorData‖sha256(clientData).
export async function verifyWebAuthnAxis(token) {
  try {
    const w = token.webauthn; if (!w || !w.clientDataJSON) return false;
    const cd = JSON.parse(td.decode(unb64u(w.clientDataJSON)));
    if (cd.type !== "webauthn.get") return false;
    if (cd.challenge !== token.challenge) return false;              // the human verified THIS payload
    const ad = unb64u(w.authenticatorData);
    if (!(ad[32] & 0x04)) return false;                             // UV bit — userVerification really happened
    if (!w.credPub || !w.signature) return true;                   // presence-only axis (no pubkey captured)
    const data = new Uint8Array([...ad, ...(await sha256(unb64u(w.clientDataJSON)))]);
    const key = await SUB.importKey("spki", unb64u(w.credPub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return SUB.verify({ name: "ECDSA", hash: "SHA-256" }, key, der2raw(unb64u(w.signature)), data);
  } catch { return false; }
}

// ── VERIFY (pure, offline, fail-closed): re-derive the token κ from its own bytes (L5), re-derive the
//    operator κ from the signing key (CC-1), check the sovereign signature over the action bytes, confirm
//    the challenge commits to those same bytes (payload binding), and — if present — the ML-DSA co-sig.
//    Returns the verified action body or null. `opts.requireWebAuthn` additionally demands the second axis.
export async function verifyStepUp(token, { requireWebAuthn = false } = {}) {
  try {
    if (!token || !token.id || !token.sig) return null;
    const { id, challenge, alg, pub, sig, pqAlg, pqPub, pqSig, webauthn, ...body } = token;
    const c = canon(body);
    if (await addressOf(te.encode(c)) !== id) return null;          // L5: id commits to the action body
    if (await addressOf(unb64(pub)) !== body.operator) return null; // CC-1: operator κ == address of its pubkey
    if (b64u(await sha256(te.encode(c))) !== challenge) return null; // payload binding: challenge == sha256(body)
    const key = await SUB.importKey("raw", unb64(pub), alg === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await SUB.verify(alg === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" }, key, unb64(sig), te.encode(c));
    if (!ok) return null;                                           // sovereign signature over the action
    if (pqPub) {                                                    // hybrid: ML-DSA co-signature must also verify
      const { mldsaVerify } = await import("./holo-pqc.mjs");
      if (!pqSig || !mldsaVerify(pqPub, c, pqSig)) return null;
    }
    if (requireWebAuthn && !(await verifyWebAuthnAxis(token))) return null; // demand the authenticator axis
    return body;
  } catch { return null; }
}

// ── BROWSER GLUE: requireStepUp(action, { kappa, credentialId }) — the one call a sensitive site makes.
// Computes the challenge, runs ONE biometric (userVerification:required) bound to it, uses the released
// PRF secret to unlock the vault and re-derive the sovereign principal, signs the action, attaches the
// authenticator axis, then DISCARDS the principal. Throws on cancel / wrong device / fail — caller MUST
// treat any throw as "denied" (fail-closed). Never returns an unverified token.
// `exposeSecret:true` additionally returns the ceremony's vault-unlock secret as { token, secret }, so an
// operation that INHERENTLY opens the vault in the same breath (reveal recovery phrase, mint a delegation —
// both need the signing key) does ONE biometric, not two. The secret is handed only to the caller that asked;
// the default (false) still discards it. This is opt-in precisely because exposing it is a deliberate act.
export async function requireStepUp({ kind, payload = null, appId = "", operator, reason = "" }, { credentialId, exposeSecret = false } = {}) {
  if (!operator) throw new Error("step-up needs the operator κ");
  const [{ teeAssert, teeReason }, login] = await Promise.all([import("./holo-webauthn.mjs"), import("./holo-login.mjs")]);
  const why = await teeReason();
  if (why) throw new Error("step-up unavailable: " + why);          // no TEE here → fail closed, never a weaker path
  const action = actionBody({ kind, payload, appId, operator, reason, issuedAt: new Date().toISOString(), nonce: hex(rand(8)) });
  const challenge = unb64u(await challengeFor(action));             // bind the biometric to THIS action
  const credRec = await login.credentialOf(operator);              // the operator's enrolled credential { credentialId, pub } — pub for the signed second axis
  const assertion = await teeAssert({ credentialId: credentialId || credRec?.credentialId, challenge }); // fresh UV ceremony over the payload (throws on cancel)
  const principal = await login.unlock(operator, assertion.secret); // re-derive the signer from the TEE secret
  try {
    const token = await buildStepUp(action, principal);
    const full = attachWebAuthn(token, assertion, credRec?.pub);   // credPub comes from the operator record (the assertion can't carry it)
    if (!(await verifyStepUp(full))) throw new Error("step-up self-verification failed");
    return exposeSecret ? { token: full, secret: assertion.secret } : full;
  } finally { /* principal holds a non-extractable in-memory key; drop the reference */ }
}

// selftest (node): sovereign axis — build → verify → payload-binding → tamper-refuse → presence policy.
export async function selftest() {
  const r = {};
  // a synthetic principal using WebCrypto Ed25519 (mirrors holo-login's principal shape, sovereign axis only)
  const kp = await SUB.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pubRaw = new Uint8Array(await SUB.exportKey("raw", kp.publicKey));
  const kappa = await addressOf(pubRaw);
  const signer = { kappa, alg: "Ed25519", pub: b64(pubRaw), async sign(s) { const u = typeof s === "string" ? te.encode(s) : s; return b64(await SUB.sign({ name: "Ed25519" }, kp.privateKey, u)); } };
  const action = actionBody({ kind: "wallet.send", payload: { to: "0xabc", amount: "0.4", chain: "eth" }, appId: "org.hologram.HoloWallet", operator: kappa, reason: "Send 0.4 ETH to 0xabc", issuedAt: "2026-06-21T00:00:00.000Z", nonce: "0011223344556677" });
  const tok = await buildStepUp(action, signer);
  r.builds = /^did:holo:sha256:[0-9a-f]{64}$/.test(tok.id) && !!tok.sig && !!tok.challenge;
  r.verifies = (await verifyStepUp(tok)) !== null;                                  // round-trip
  r.challengeBindsPayload = tok.challenge === (await challengeFor(action));          // challenge == sha256(body)
  r.tamperPayload = (await verifyStepUp({ ...tok, payload: { to: "0xEVIL", amount: "9.9", chain: "eth" } })) === null; // changed amount/recipient → refused
  r.tamperOperator = (await verifyStepUp({ ...tok, operator: "did:holo:sha256:" + "0".repeat(64) })) === null;         // forged operator → refused
  r.tamperChallenge = (await verifyStepUp({ ...tok, challenge: b64u(rand(32)) })) === null;                            // unbound challenge → refused
  r.wrongSignerRejected = await (async () => { try { await buildStepUp({ ...action, operator: "did:holo:sha256:" + "1".repeat(64) }, signer); return false; } catch { return true; } })();
  r.requireWebAuthnFailsWithout = (await verifyStepUp(tok, { requireWebAuthn: true })) === null;                       // no authenticator axis → refused when demanded
  // presence policy
  r.valueAlwaysAsks = needsStepUp("wallet.send", { last: { kind: "wallet.send", atMs: 1000 }, nowMs: 1001 }) === true; // money never suppressed
  r.revealAlwaysAsks = needsStepUp("identity.revealMnemonic", { last: { kind: "identity.revealMnemonic", atMs: 1000 }, nowMs: 1001 }) === true;
  r.lowNeverAsks = needsStepUp("app.open", { nowMs: 0 }) === false;
  r.authoritySuppressedWhenFresh = needsStepUp("delegation.issue", { last: { kind: "delegation.issue", atMs: 1000 }, nowMs: 2000, windowMs: 120000 }) === false;
  r.authorityAsksWhenStale = needsStepUp("delegation.issue", { last: { kind: "delegation.issue", atMs: 1000 }, nowMs: 200000, windowMs: 120000 }) === true;
  r.unknownKindIsSensitive = levelOf("totally.new.kind") === "authority" && needsStepUp("totally.new.kind", { nowMs: 0 }) === true;
  r.ok = Object.values(r).every(Boolean);
  return r;
}

if (typeof process !== "undefined" && process.argv && /holo-stepup\.mjs$/.test(process.argv[1] || "")) {
  selftest().then((r) => { console.log("holo-stepup selftest:", r); process.exit(r.ok ? 0 : 1); });
}
