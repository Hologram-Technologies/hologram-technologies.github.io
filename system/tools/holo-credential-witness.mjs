// holo-credential-witness.mjs — conformance witness for the κ-native Verifiable Credential.
//
// Proves holo-credential.mjs implements Self.ID's "Molecule" (issuer-signed claim) on the
// substrate with NO registry and NO issuer contact, obeying the Five Laws. Requirement-tagged,
// fail-closed (exit nonzero on any miss) — gate.mjs LIVE_EXIT. Hermetic Node + WebCrypto.

import { canon } from "../os/usr/lib/holo/holo-identity.mjs";
import { ephemeral } from "../os/usr/lib/holo/holo-identity.mjs";
import { issueCredential, verifyCredential, verifyDisclosure, credentialCore } from "../os/usr/lib/holo/holo-credential.mjs";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0; const rows = [];
const W = (req, claim, ok) => { rows.push({ req, claim, ok: !!ok }); ok ? pass++ : fail++; };

const issuer = await ephemeral({ label: "Gov" });
const human = await ephemeral({ label: "Alice" });
const agent = await ephemeral({ label: "AgentSmith" });
const cred = await issueCredential(issuer, { subject: human.kappa, claims: { ageOver18: true, country: "EE", dob: "1990-02-01" } });

// CRED-1 — issue → verify by re-derivation (L1 content identity, L5 verify-by-re-derivation)
W("CRED-1", "a freshly issued credential verifies", !!(await verifyCredential(cred)));
// CRED-2 — issuer κ is the address of the issuer's pubkey; you cannot claim another's identity
const body = await verifyCredential(cred);
W("CRED-2", "issuer κ binds the signing key", body && body.issuer === issuer.kappa);
const impostor = await ephemeral({ label: "Eve" });
W("CRED-2b", "a credential re-signed under a swapped pub is refused",
  (await verifyCredential({ ...credentialCore(cred), pub: impostor.pub, alg: impostor.alg })) === null);
// CRED-3 — tamper the body → κ no longer re-derives → refused (L5 fail-closed)
W("CRED-3", "tampering the subject is refused", (await verifyCredential({ ...cred, subject: "did:holo:sha256:" + "0".repeat(64) })) === null);
// CRED-4 — tamper the _sd commitment → refused
W("CRED-4", "tampering the _sd set is refused", (await verifyCredential({ ...credentialCore(cred), _sd: ["0".repeat(64)] })) === null);
// CRED-5 — expiry is fail-closed
W("CRED-5", "an expired credential is refused", (await verifyCredential(cred, { now: "2999-01-01T00:00:00Z" })) === null);
// CRED-6 — revocation is fail-closed, and a throwing revocation source refuses (never fails open)
W("CRED-6", "a revoked subject is refused", (await verifyCredential(cred, { isRevoked: async () => true })) === null);
W("CRED-6b", "an unreachable revocation source refuses (fail-closed)", (await verifyCredential(cred, { isRevoked: async () => { throw new Error("offline"); } })) === null);
// CRED-7 — SELECTIVE DISCLOSURE privacy: no cleartext claim survives in the signed, content-addressed core
const coreStr = canon(credentialCore(cred));
W("CRED-7", "cleartext claim values are absent from the signed core", !coreStr.includes("1990-02-01") && !coreStr.includes("\"claims\""));
// CRED-8 — a disclosure re-derives into the signed _sd; a forged value does not
const d = await verifyDisclosure(body, cred.disclosures.ageOver18);
W("CRED-8", "a held disclosure re-derives into _sd", d && d.key === "ageOver18" && d.value === true);
W("CRED-8b", "a forged disclosure (same salt, flipped value) is refused",
  (await verifyDisclosure(body, [cred.disclosures.ageOver18[0], "ageOver18", false])) === null);
// CRED-9 — HUMAN ≡ AGENT: a credential issued to an agent κ verifies by the identical path
const credAgent = await issueCredential(issuer, { subject: agent.kappa, claims: { ageOver18: true, scope: "trade" } });
const bodyA = await verifyCredential(credAgent);
W("CRED-9", "an agent-subject credential verifies by the identical path", !!bodyA && bodyA.subject === agent.kappa && bodyA.issuer === body.issuer);
// CRED-10 — offline by construction (L3): the primitive contains no network egress
const src = readFileSync(new URL("../os/usr/lib/holo/holo-credential.mjs", import.meta.url), "utf8");
W("CRED-10", "no fetch/XHR/network in the credential primitive", !/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/.test(src));

for (const r of rows) console.log(`${r.ok ? "✓" : "✗"} ${r.req}  ${r.claim}`);
console.log(`\nholo-credential witness: ${pass}/${pass + fail} GREEN`);
process.exit(fail ? 1 : 0);
