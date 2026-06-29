// holo-present-witness.mjs — conformance witness for the CHALLENGE → SELECTIVE-DISCLOSURE → VERIFY
// loop (Self.ID "Challenge / Response", reimplemented κ-native). Proves the magical property:
// a verifier learns exactly one asked fact, by re-derivation, with NO issuer contact and NO network —
// and that a HUMAN and an AI AGENT travel the identical disclosure path. Fail-closed gate.

import { canon, addressOf } from "../os/usr/lib/holo/holo-identity.mjs";
import { ephemeral } from "../os/usr/lib/holo/holo-identity.mjs";
import { issueCredential } from "../os/usr/lib/holo/holo-credential.mjs";
import { makeChallenge, present, verifyPresentation } from "../os/usr/lib/holo/holo-present.mjs";
import { readFileSync } from "node:fs";

const te = new TextEncoder();
let pass = 0, fail = 0; const rows = [];
const W = (req, claim, ok) => { rows.push({ req, claim, ok: !!ok }); ok ? pass++ : fail++; };

const issuer = await ephemeral({ label: "Gov" });
const human = await ephemeral({ label: "Alice" });
const agent = await ephemeral({ label: "AgentSmith" });
const verifier = await ephemeral({ label: "BarSite" });

const credH = await issueCredential(issuer, { subject: human.kappa, claims: { ageOver18: true, country: "EE", dob: "1990-02-01" } });
const credA = await issueCredential(issuer, { subject: agent.kappa, claims: { ageOver18: true, country: "EE", scope: "trade" } });
const ch = await makeChallenge(verifier, { asks: ["ageOver18"], audience: verifier.kappa });

// PRES-1 — the full loop: a human proves age-over-18, verifier trusts by re-derivation
const presH = await present(human, credH, ch, { release: async () => true /* TEE/biometric released */ });
const okH = await verifyPresentation(presH, ch, { expectedAudience: verifier.kappa });
W("PRES-1", "human presents → verifier accepts the asked claim", !!okH && okH.claims.ageOver18 === true);
// PRES-2 — minimal disclosure: ONLY the asked claim is revealed; the birthday never leaves the holder
W("PRES-2", "only the asked claim is disclosed (dob withheld)", okH && Object.keys(okH.claims).length === 1 && !("dob" in okH.claims));
const wire = canon(presH);
W("PRES-2b", "the withheld value never appears on the wire", !wire.includes("1990-02-01"));
// PRES-3 / PRES-4 — HUMAN ≡ AGENT: identical disclosure path, gated by a delegated capability instead of biometric
const presA = await present(agent, credA, ch, { release: async () => true /* delegated capability ok */ });
const okA = await verifyPresentation(presA, ch, { expectedAudience: verifier.kappa });
W("PRES-3", "agent presents by the identical path", !!okA && okA.claims.ageOver18 === true);
W("PRES-4", "human and agent yield the same issuer, distinct subjects", okH && okA && okH.issuer === okA.issuer && okA.subject === agent.kappa && okH.subject === human.kappa);
// PRES-5 — consent gate: a refused release yields no disclosure
W("PRES-5", "a refused consent gate discloses nothing", (await present(human, credH, ch, { release: async () => false })) === null);
// PRES-6 — you may only present YOUR OWN credential
W("PRES-6", "a non-subject cannot present another's credential", (await present(verifier, credH, ch, { release: async () => true })) === null);
// PRES-7 — replay refusal: a presentation bound to one challenge fails against a fresh challenge (new nonce)
const ch2 = await makeChallenge(verifier, { asks: ["ageOver18"], audience: verifier.kappa });
W("PRES-7", "replay against a fresh challenge is refused", (await verifyPresentation(presH, ch2, { expectedAudience: verifier.kappa })) === null);
// PRES-8 — misdelivery refusal: wrong audience is refused
W("PRES-8", "a wrong audience is refused", (await verifyPresentation(presH, ch, { expectedAudience: "did:holo:sha256:" + "0".repeat(64) })) === null);
// PRES-9 — tampered reveal is refused (the flipped value no longer re-derives into _sd)
W("PRES-9", "a tampered revealed value is refused",
  (await verifyPresentation({ ...presH, reveal: { ageOver18: [presH.reveal.ageOver18[0], "ageOver18", false] } }, ch, { expectedAudience: verifier.kappa })) === null);
// PRES-10 — OVER-DISCLOSURE refusal: a validly-signed presentation that reveals MORE than asked is refused.
//   Build one by hand: holder asked for ageOver18 only, but reveals country too, then signs it.
const leak = { "@type": "HoloPresentation", challenge: ch.kappa, audience: ch.audience, nonce: ch.nonce,
  credential: presH.credential, reveal: { ageOver18: credH.disclosures.ageOver18, country: credH.disclosures.country },
  holder: human.kappa, issuedAt: new Date().toISOString() };
const leakC = canon(leak);
const leakResp = { kappa: await addressOf(te.encode(leakC)), ...leak, alg: human.alg, pub: human.pub, sig: await human.sign(leakC) };
W("PRES-10", "disclosing more than asked is refused (no over-disclosure)", (await verifyPresentation(leakResp, ch, { expectedAudience: verifier.kappa })) === null);
// PRES-11 — cannot satisfy: a claim the credential does not hold yields no presentation
const chMore = await makeChallenge(verifier, { asks: ["passport"], audience: verifier.kappa });
W("PRES-11", "an unsatisfiable challenge discloses nothing", (await present(human, credH, chMore, { release: async () => true })) === null);
// PRES-12 — offline by construction (L3): no network egress anywhere in the loop
const srcP = readFileSync(new URL("../os/usr/lib/holo/holo-present.mjs", import.meta.url), "utf8");
W("PRES-12", "no fetch/XHR/network in the presentation loop", !/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/.test(srcP));

for (const r of rows) console.log(`${r.ok ? "✓" : "✗"} ${r.req}  ${r.claim}`);
console.log(`\nholo-present witness: ${pass}/${pass + fail} GREEN`);
process.exit(fail ? 1 : 0);
