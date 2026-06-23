#!/usr/bin/env node
// holo-pair-witness.mjs — locks the cross-device "Link a device" engine (the WhatsApp-linked-devices model,
// self-sovereign): a new device shows a QR; the operator's device grants it a scoped, revocable capability,
// signed by the operator and E2E-encrypted to the device — verify-before-trust (L5), never the relay. This
// engine powers login + the ♥ Share "Link a device" surface; it was unwitnessed. Real holo-identity operator.
//
// Checks (all must hold):
//   1 offerRoundtrip      — createPairOffer → offerToUrl → urlToOffer re-derives the device κ from its pubkey (L5).
//   2 grantAcceptHappy    — operator mints a grant → the device decrypts + accepts it (operator κ + caps returned).
//   3 tamperedSigRejected — flip the operator signature → verifyDelegation refuses ("bad operator signature").
//   4 wrongAudienceRejected — a grant for a different device κ → refused (audience).
//   5 expiredRejected     — a grant past its window → refused ("expired").
//   6 capEscalationRejected — caps beyond the allowed set → refused ("capability escalation").
//   7 forgedIssuerRejected — issuer pubkey that doesn't re-derive to the issuer κ → refused (L5).
//   8 revocationWorks     — operator revokes → verifyRevocation yields the grant id; verify with revoked → refused.
//
// Authority: UOR-ADDR · holospaces Laws L1/L5 · UCAN-style attenuated delegation · rests on #holo-pair + #holo-identity.
// node tools/holo-pair-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPairOffer, offerToUrl, urlToOffer, mintDeviceGrant, acceptGrant, verifyDelegation, makeRevocation, verifyRevocation } from "../os/usr/lib/holo/holo-pair.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const NOW = Date.parse("2026-06-23T12:00:00Z");

const op = await enroll({ label: "pair-operator", passphrase: "link my devices" });

// ── 1 · the new device's QR offer round-trips, device κ re-derives ───────────────────────────────────
const { offer, secrets } = await createPairOffer({ deviceName: "Ilya's laptop" });
const url = offerToUrl(offer, "https://holo.local");
const parsed = await urlToOffer(url);
ok("offerRoundtrip", parsed.deviceKappa === secrets.deviceKappa && parsed.channel === offer.channel && /pair\.html#o=/.test(url), JSON.stringify({ dk: parsed.deviceKappa.slice(0, 20) }));

// ── 2 · happy path: operator grants → device accepts ─────────────────────────────────────────────────
const { blob, grantId } = await mintDeviceGrant(op, parsed, { nowMs: NOW });
{
  const r = await acceptGrant(secrets, clone(blob), { nowMs: NOW + 1000 });
  ok("grantAcceptHappy", r && r.operator === op.kappa && Array.isArray(r.can) && r.can.includes("session/open"), JSON.stringify({ operator: r && r.operator && r.operator.slice(0, 16), can: r && r.can }));
}

// for the verify-level checks, decrypt once to get the grant object, then mutate copies
const accepted = await acceptGrant(secrets, clone(blob), { nowMs: NOW + 1000 });
const grant = accepted.grant;

// ── 3 · tampered signature rejected ──────────────────────────────────────────────────────────────────
{
  const bad = clone(grant); bad.sig = Buffer.from("forged".padEnd(64, "x")).toString("base64");
  const v = await verifyDelegation(bad, { nowMs: NOW + 1000, expectAud: secrets.deviceKappa });
  ok("tamperedSigRejected", v.ok === false && /sig/i.test(v.reason), JSON.stringify(v));
}
// ── 4 · wrong audience rejected ──────────────────────────────────────────────────────────────────────
{
  const v = await verifyDelegation(grant, { nowMs: NOW + 1000, expectAud: "did:holo:sha256:" + "b".repeat(64) });
  ok("wrongAudienceRejected", v.ok === false && /audience/i.test(v.reason), JSON.stringify(v));
}
// ── 5 · expired rejected ─────────────────────────────────────────────────────────────────────────────
{
  const { blob: b2 } = await mintDeviceGrant(op, parsed, { nowMs: NOW - 40 * 24 * 3600e3 });   // minted 40d ago, ttl 30d
  let threw = null; try { await acceptGrant(secrets, b2, { nowMs: NOW }); } catch (e) { threw = e.message; }
  ok("expiredRejected", threw && /expired/i.test(threw), String(threw));
}
// ── 6 · capability escalation rejected ───────────────────────────────────────────────────────────────
{
  // mint a (legitimately-signed) grant carrying caps beyond the verifier's ceiling → escalation refused
  const { blob: bEsc } = await mintDeviceGrant(op, parsed, { nowMs: NOW, caps: ["session/open", "identity/export"] });
  let threw = null; try { await acceptGrant(secrets, bEsc, { nowMs: NOW + 1000 }); } catch (e) { threw = e.message; }
  ok("capEscalationRejected", threw && /escalation/i.test(threw), String(threw));
}
// ── 7 · forged issuer pubkey rejected (L5: iss κ must re-derive from issPub) ─────────────────────────
{
  const op2 = await enroll({ label: "impostor", passphrase: "not the operator" });
  const forged = clone(grant); forged.issPub = op2.pub;   // claims op.kappa but carries op2's pubkey
  const v = await verifyDelegation(forged, { nowMs: NOW + 1000, expectAud: secrets.deviceKappa });
  ok("forgedIssuerRejected", v.ok === false && /pubkey|sig/i.test(v.reason), JSON.stringify(v));
  await forget(op2.kappa);
}
// ── 8 · revocation ───────────────────────────────────────────────────────────────────────────────────
{
  const rev = await makeRevocation(op, grantId, { nowMs: NOW });
  const revokes = await verifyRevocation(rev);
  const v = await verifyDelegation(grant, { nowMs: NOW + 1000, expectAud: secrets.deviceKappa, revoked: [revokes] });
  ok("revocationWorks", revokes === grantId && v.ok === false && /revoked/i.test(v.reason), JSON.stringify({ revokes: revokes === grantId, v: v.reason }));
}

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-pair — the self-sovereign 'Link a device' engine (WhatsApp-linked-devices model): a new device's QR offer round-trips and its κ re-derives from its pubkey (L5); the operator mints a scoped, time-boxed, E2E-encrypted UCAN-style grant the device decrypts + accepts; verify-before-trust refuses a tampered signature, wrong audience, expired window, capability escalation, or a forged issuer pubkey; and the operator can revoke per-device. The relay is never trusted. Powers login + the ♥ Share 'Link a device' surface.",
  authority: "UOR-ADDR · holospaces Laws L1/L5 · UCAN attenuated delegation · rests on #holo-pair + #holo-identity",
  witnessed,
  covers: witnessed ? ["offer-roundtrip", "grant-accept-happy", "tampered-sig-rejected", "wrong-audience-rejected", "expired-rejected", "cap-escalation-rejected", "forged-issuer-rejected", "revocation-works"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-pair-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-pair witness — scan a QR to link a device, verified, scoped, revocable\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  a linked device gets a scoped, revocable capability — never your key" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
