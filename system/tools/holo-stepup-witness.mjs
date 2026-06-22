// holo-stepup-witness.mjs — conformance witness for the canonical TEE-anchored step-up.
//
// Proves the §1 requirements (hologram-auth-canonical-design.md Phase 4) against the real
// os/usr/lib/holo/holo-stepup.mjs primitive. Two axes:
//   • SOVEREIGN axis — runs the module's own selftest (build/verify/payload-binding/tamper-
//     refuse/presence-policy), the Ed25519 identity-key signature over the action.
//   • WEBAUTHN axis — what the selftest can NOT cover: a stand-in ES256 platform authenticator
//     produces a real WebAuthn-shaped assertion over the action challenge, so verifyWebAuthnAxis'
//     full crypto path (DER→raw, ECDSA P-256 verify, UV-flag, challenge-binding) is exercised
//     AND its refusals (wrong challenge / presence-without-verification / tampered sig) proven.
//
// Hermetic Node + WebCrypto, fail-closed (exit nonzero on any miss) — gate.mjs LIVE_EXIT.

import { canon, addressOf } from "../os/usr/lib/holo/holo-identity.mjs";
import { buildStepUp, attachWebAuthn, verifyStepUp, verifyWebAuthnAxis, challengeFor, needsStepUp, levelOf, selftest } from "../os/usr/lib/holo/holo-stepup.mjs";

const SUB = globalThis.crypto.subtle, te = new TextEncoder();
const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
const b64u = (u) => b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha = async (u) => new Uint8Array(await SUB.digest("SHA-256", u));

let pass = 0, fail = 0; const rows = [];
const W = (req, claim, ok) => { rows.push({ req, claim, ok: !!ok }); ok ? pass++ : fail++; };

// raw 64-byte ECDSA (r||s) → ASN.1 DER (the shape a real WebAuthn ES256 assertion carries)
function raw2der(raw) {
  const enc = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = Uint8Array.from([0, ...b]); return b; };
  const r = enc(raw.slice(0, 32)), s = enc(raw.slice(32));
  return Uint8Array.from([0x30, 2 + r.length + 2 + s.length, 0x02, r.length, ...r, 0x02, s.length, ...s]);
}

// ── a stand-in PLATFORM authenticator (ES256) — the TEE we don't have in Node ──
async function makeAuthenticator({ uv = true } = {}) {
  const kp = await SUB.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const credPub = b64u(new Uint8Array(await SUB.exportKey("spki", kp.publicKey)));
  const credentialId = b64u(crypto.getRandomValues(new Uint8Array(16)));
  return {
    credPub, credentialId,
    // assert over a base64url challenge string (= token.challenge), WebAuthn-faithful
    async assertOver(challengeB64u, { flagUv = uv, badSig = false } = {}) {
      const clientDataJSON = te.encode(JSON.stringify({ type: "webauthn.get", challenge: challengeB64u, origin: "https://localhost", crossOrigin: false }));
      const authData = new Uint8Array(37); authData.set(await sha(te.encode("localhost")), 0);
      authData[32] = 0x01 | (flagUv ? 0x04 : 0x00);                  // UP, optionally UV
      const signed = new Uint8Array([...authData, ...(await sha(clientDataJSON))]);
      let raw = new Uint8Array(await SUB.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, signed));
      if (badSig) raw[0] ^= 0xff;
      return { credentialId, clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(raw2der(raw)), credPub };
    },
  };
}

// a sovereign Ed25519 signer (mirrors the holo-login principal shape)
async function makeSigner() {
  const kp = await SUB.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pubRaw = new Uint8Array(await SUB.exportKey("raw", kp.publicKey));
  const kappa = await addressOf(pubRaw);
  return { kappa, alg: "Ed25519", pub: b64(pubRaw), async sign(s) { const u = typeof s === "string" ? te.encode(s) : s; return b64(await SUB.sign({ name: "Ed25519" }, kp.privateKey, u)); } };
}

(async () => {
  // ── A. sovereign axis: the module's own selftest must be fully green ──
  const st = await selftest();
  W("explicit-consent/CC-1/L5", "sovereign-axis selftest 14/14 (build·verify·payload-bind·tamper-refuse·policy)", st.ok);

  // ── B. webauthn axis: a VALID assertion over the action verifies through every check ──
  const signer = await makeSigner(), auth = await makeAuthenticator();
  const action = { "@type": "HoloStepUp", kind: "wallet.send", appId: "org.hologram.HoloWallet", operator: signer.kappa, reason: "Send 0.4 ETH to 0xabc", payload: { to: "0xabc", amount: "0.4", chain: "eth" }, issuedAt: "2026-06-21T00:00:00.000Z", nonce: "0011223344556677" };
  const chal = await challengeFor(action);
  const tok = await buildStepUp(action, signer);
  const full = attachWebAuthn(tok, await auth.assertOver(chal), auth.credPub);
  W("explicit-consent", "valid WebAuthn assertion over the action κ verifies (DER→raw, ECDSA P-256, UV, challenge-bind)", await verifyWebAuthnAxis(full));
  W("explicit-consent", "verifyStepUp(requireWebAuthn:true) accepts the two-axis token", (await verifyStepUp(full, { requireWebAuthn: true })) !== null);

  // ── C. webauthn axis REFUSALS (non-repudiation must be unforgeable) ──
  // C1: an assertion whose authenticator signed a DIFFERENT action's challenge (payload swap)
  const otherChal = await challengeFor({ ...action, payload: { to: "0xEVIL", amount: "9.9", chain: "eth" } });
  const swapped = attachWebAuthn(tok, await auth.assertOver(otherChal), auth.credPub);
  W("explicit-consent/SEC-1", "WebAuthn assertion bound to a DIFFERENT payload is refused", !(await verifyWebAuthnAxis(swapped)));
  // C2: presence without verification (UV bit unset) — a tap, not a biometric
  const presenceOnly = attachWebAuthn(tok, await auth.assertOver(chal, { flagUv: false }), auth.credPub);
  W("explicit-consent", "presence-only (UV unset) assertion is refused — biometric required", !(await verifyWebAuthnAxis(presenceOnly)));
  // C3: tampered signature
  const badSig = attachWebAuthn(tok, await auth.assertOver(chal, { badSig: true }), auth.credPub);
  W("SEC-1/key-custody", "tampered WebAuthn signature is refused", !(await verifyWebAuthnAxis(badSig)));
  // C4: a credential whose pubkey is a DIFFERENT authenticator's (impersonation)
  const auth2 = await makeAuthenticator();
  const impersonated = attachWebAuthn(tok, await auth.assertOver(chal), auth2.credPub);
  W("key-custody", "assertion verified against a different credential's pubkey is refused", !(await verifyWebAuthnAxis(impersonated)));

  // ── D. fail-closed: a consent-bearing action with NO step-up token yields no verified consent ──
  W("fail-closed", "no token → verifyStepUp returns null (no signature stands)", (await verifyStepUp(null)) === null);
  W("fail-closed", "unknown action kind classified sensitive (default-deny), needsStepUp=true", levelOf("totally.new.kind") === "authority" && needsStepUp("totally.new.kind", { nowMs: 0 }));

  // ── E. trust window / no-escalation policy (value & key never suppressed) ──
  W("explicit-consent", "value transfer ALWAYS steps up (never rides the window)", needsStepUp("wallet.send", { last: { kind: "wallet.send", atMs: 1000 }, nowMs: 1001 }));
  W("explicit-consent", "key reveal ALWAYS steps up", needsStepUp("identity.revealMnemonic", { last: { kind: "identity.revealMnemonic", atMs: 1 }, nowMs: 2 }));
  W("SEC-2", "authority repeat within 60s window is suppressed; stale re-asks (effortless, not escalating)", needsStepUp("delegation.issue", { last: { kind: "delegation.issue", atMs: 1000 }, nowMs: 2000, windowMs: 60000 }) === false && needsStepUp("delegation.issue", { last: { kind: "delegation.issue", atMs: 1000 }, nowMs: 200000, windowMs: 60000 }) === true);

  console.log("\nholo-stepup conformance witness:");
  for (const r of rows) console.log(`  [${r.ok ? "✓" : "✗"}] (${r.req}) ${r.claim}`);
  console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED"}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("witness error:", e); process.exit(1); });
