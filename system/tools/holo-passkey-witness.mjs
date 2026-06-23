// Witness: Hologram as a WebAuthn passkey provider. Prove a minted passkey produces assertions a REAL
// relying party verifies (ES256 over authData‖SHA256(clientDataJSON), rpIdHash, challenge, origin,
// monotonic signCount), the step-up gates signing, and cross-rp / tamper / replay all fail-closed.
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
// btoa/atob shims for Node
if (!globalThis.btoa) globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
if (!globalThis.atob) globalThis.atob = (s) => Buffer.from(s, "base64").toString("binary");

const { createCredential, getAssertion, verifyAssertion } = await import("../os/usr/lib/holo/holo-passkey.mjs");

const r = {};
const RP = "example.com", ORIGIN = "https://example.com";
const b64u = (buf) => { const b = new Uint8Array(buf); let s = ""; for (const x of b) s += String.fromCharCode(x); return Buffer.from(s, "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const chal = () => b64u(crypto.getRandomValues(new Uint8Array(32)));
const okStepup = async () => ({ id: "stepup-token" });
const denyStepup = async () => null;
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };

// 1) CREATE a passkey for example.com (one user, one device-local credential)
const c1 = chal();
const created = await createCredential({ rpId: RP, userId: "user-123", userName: "ilya@uor.foundation", challenge: c1, origin: ORIGIN });
r.created = !!(created.credential.id && created.credential.response.attestationObject && created.publicKeyCose);
r.storeHasPriv = !!created.store.privJwk && created.store.rpId === RP && created.store.signCount === 0;

// a vault-like store + the lookup/persist the host would wire
const VAULT = new Map(); VAULT.set(created.store.credentialId, { ...created.store });
const lookup = async (rpId, allowIds) => { for (const rec of VAULT.values()) if (rec.rpId === rpId && (!allowIds.length || allowIds.includes(rec.credentialId))) return rec; return null; };
const persist = async (rec) => { VAULT.set(rec.credentialId, { ...rec }); };

// 2) ASSERT (sign in) — gated; verify as a relying party with the minted pubkey
const c2 = chal();
const a1 = await getAssertion({ rpId: RP, challenge: c2, origin: ORIGIN, allowCredentials: [created.credential.id] }, { lookup, stepup: okStepup, persist });
const v1 = await verifyAssertion({ publicKeyCose: created.publicKeyCose, assertion: a1.credential, expectedRpId: RP, expectedChallenge: c2, expectedOrigin: ORIGIN, lastSignCount: 0 });
r.assertVerifiesAtRP = v1.ok === true;
r.signCountAdvanced = a1.signCount === 1 && VAULT.get(created.store.credentialId).signCount === 1;

// 3) MONOTONIC signCount across two assertions
const c3 = chal();
const a2 = await getAssertion({ rpId: RP, challenge: c3, origin: ORIGIN }, { lookup, stepup: okStepup, persist });
const v2 = await verifyAssertion({ publicKeyCose: created.publicKeyCose, assertion: a2.credential, expectedRpId: RP, expectedChallenge: c3, expectedOrigin: ORIGIN, lastSignCount: 1 });
r.secondAssertVerifies = v2.ok === true && a2.signCount === 2;

// ── REFUSALS (assert what fails closed) ──
// 4) STEP-UP denied → no signature is produced
r.stepupGatedFailClosed = await throws(() => getAssertion({ rpId: RP, challenge: chal(), origin: ORIGIN }, { lookup, stepup: denyStepup, persist }));
// 5) CROSS-RP (phishing): no passkey exists for evil.example → fail-closed (the credential never signs for another rp)
r.crossRpRefused = await throws(() => getAssertion({ rpId: "evil.example", challenge: chal(), origin: "https://evil.example", allowCredentials: [created.credential.id] }, { lookup, stepup: okStepup, persist }));
// 6) WRONG ORIGIN at the RP check → rejected
const vWrongOrigin = await verifyAssertion({ publicKeyCose: created.publicKeyCose, assertion: a1.credential, expectedRpId: RP, expectedChallenge: c2, expectedOrigin: "https://phish.example", lastSignCount: 0 });
r.wrongOriginRejected = vWrongOrigin.ok === false && /origin/.test(vWrongOrigin.reason);
// 7) WRONG rpId at the RP check → rpIdHash mismatch
const vWrongRp = await verifyAssertion({ publicKeyCose: created.publicKeyCose, assertion: a1.credential, expectedRpId: "other.example", expectedChallenge: c2, expectedOrigin: ORIGIN, lastSignCount: 0 });
r.wrongRpRejected = vWrongRp.ok === false && /rpIdHash/.test(vWrongRp.reason);
// 8) TAMPERED signature → invalid
const tampered = JSON.parse(JSON.stringify(a2.credential)); const sig = tampered.response.signature; const mid = Math.floor(sig.length / 2); tampered.response.signature = sig.slice(0, mid) + (sig[mid] === "A" ? "B" : "A") + sig.slice(mid + 1);
const vTamper = await verifyAssertion({ publicKeyCose: created.publicKeyCose, assertion: tampered, expectedRpId: RP, expectedChallenge: c3, expectedOrigin: ORIGIN, lastSignCount: 1 });
r.tamperedSigRejected = vTamper.ok === false;
// 9) REPLAY (signCount not advancing) → rejected
const vReplay = await verifyAssertion({ publicKeyCose: created.publicKeyCose, assertion: a1.credential, expectedRpId: RP, expectedChallenge: c2, expectedOrigin: ORIGIN, lastSignCount: 5 });
r.replayRejected = vReplay.ok === false && /monotonic/.test(vReplay.reason);

r.ok = Object.entries(r).filter(([k]) => k !== "ok").every(([, v]) => v === true);
console.log("holo-passkey witness:", JSON.stringify(r, null, 2));
process.exit(r.ok ? 0 : 1);
