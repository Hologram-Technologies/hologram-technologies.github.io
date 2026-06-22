// holo-stepup-wiring-witness.mjs — proves the credPub WIRING chain end-to-end in Node.
//
// The unit witness (holo-stepup-witness.mjs) proves the step-up crypto with an injected credential.
// THIS witness proves the integration the browser glue depends on: a credential's public key,
// captured at enrol, is STORED in the operator record (holo-login), RETRIEVED via credentialOf,
// and is exactly what verifies a payload-bound step-up's authenticator axis — the data flow
//   teeEnroll(credPub) → enroll/record → credentialOf → attachWebAuthn → verifyWebAuthnAxis.
// Everything but the live WebAuthn ceremony (browser-only) runs here over a real WDK principal +
// a stand-in ES256 authenticator. Fail-closed (exit nonzero on any miss) — gate.mjs LIVE_EXIT.

import * as L from "../os/usr/lib/holo/holo-login.mjs";
import { buildStepUp, attachWebAuthn, verifyStepUp, verifyWebAuthnAxis, challengeFor } from "../os/usr/lib/holo/holo-stepup.mjs";

const SUB = globalThis.crypto.subtle, te = new TextEncoder();
const b64u = (u) => btoa(String.fromCharCode(...new Uint8Array(u))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha = async (u) => new Uint8Array(await SUB.digest("SHA-256", u));
let pass = 0, fail = 0; const rows = [];
const W = (claim, ok) => { rows.push({ claim, ok: !!ok }); ok ? pass++ : fail++; };

function raw2der(raw) {
  const enc = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = Uint8Array.from([0, ...b]); return b; };
  const r = enc(raw.slice(0, 32)), s = enc(raw.slice(32));
  return Uint8Array.from([0x30, 2 + r.length + 2 + s.length, 0x02, r.length, ...r, 0x02, s.length, ...s]);
}
async function makeAuthenticator() {
  const kp = await SUB.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const credPub = b64u(new Uint8Array(await SUB.exportKey("spki", kp.publicKey)));
  const credentialId = b64u(crypto.getRandomValues(new Uint8Array(16)));
  return { credPub, credentialId, async assertOver(challengeB64u, { flagUv = true } = {}) {
    const clientDataJSON = te.encode(JSON.stringify({ type: "webauthn.get", challenge: challengeB64u, origin: "https://localhost" }));
    const authData = new Uint8Array(37); authData.set(await sha(te.encode("localhost")), 0); authData[32] = 0x01 | (flagUv ? 0x04 : 0);
    const raw = new Uint8Array(await SUB.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, new Uint8Array([...authData, ...(await sha(clientDataJSON))])));
    return { credentialId, clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(raw2der(raw)) };
  } };
}

(async () => {
  const auth = await makeAuthenticator();
  // ENROL: a real WDK operator, capturing the authenticator's credPub (as sddm→holo-login now does)
  const { principal } = await L.enroll({ label: "wiring", secret: "biometric-prf-secret-xyz", cred: auth.credentialId, credPub: auth.credPub, credAlg: -7 });

  // 1) the operator record stores + returns the credential pubkey (credentialOf — the new accessor)
  const credRec = await L.credentialOf(principal.kappa);
  W("enrolled credPub round-trips via credentialOf()", credRec && credRec.credentialId === auth.credentialId && credRec.pub === auth.credPub);

  // 2) a payload-bound step-up signed by THIS operator + an assertion from THIS authenticator, verified
  //    with the credPub fetched FROM THE RECORD, passes the full two-axis check (the requireStepUp flow)
  const action = { "@type": "HoloStepUp", kind: "wallet.send", appId: "org.hologram.HoloWallet", operator: principal.kappa, reason: "Send 0.4 ETH to 0xabc", payload: { to: "0xabc", amount: "0.4", chain: "eth" }, issuedAt: "2026-06-21T00:00:00.000Z", nonce: "0011223344556677" };
  const token = await buildStepUp(action, principal);
  const full = attachWebAuthn(token, await auth.assertOver(await challengeFor(action)), credRec.pub);
  W("sovereign+PQ axis verifies (hybrid Ed25519‖ML-DSA over the action)", (await verifyStepUp(token)) !== null);
  W("authenticator axis verifies against the RECORD's credPub (requireWebAuthn:true)", (await verifyStepUp(full, { requireWebAuthn: true })) !== null);
  W("verifyWebAuthnAxis true for the record-sourced credPub", await verifyWebAuthnAxis(full));

  // 3) NEGATIVE: an operator with no captured credPub (legacy) → requireWebAuthn cannot do the signed axis
  const { principal: legacy } = await L.enroll({ label: "legacy", secret: "another-prf-secret-000", cred: "legacy-cred-id" }); // no credPub
  const legacyRec = await L.credentialOf(legacy.kappa);
  W("legacy operator (no credPub) → credentialOf.pub is null", legacyRec && legacyRec.pub === null);

  // 4) NEGATIVE: a DIFFERENT operator κ → null (no cross-operator credential reuse)
  W("credentialOf for an unknown operator κ is null", (await L.credentialOf("did:holo:sha256:" + "0".repeat(64))) === null);

  console.log("\nholo-stepup WIRING witness (credPub: enrol → record → credentialOf → verify):");
  for (const r of rows) console.log(`  [${r.ok ? "✓" : "✗"}] ${r.claim}`);
  console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED"}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("wiring witness error:", e); process.exit(1); });
