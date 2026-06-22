#!/usr/bin/env node
// holo-strand-audit-witness.mjs — proves P3: ONE SIGNED AUDIT SOURCE on the spine. The consequential
// acts — consent (terms.grantSensitive), delegation (delegation.issue), value transfer (wallet.send) —
// each produce a real, payload-bound, operator-signed StepUp attestation; recording them onto the source
// chain gives ONE ordered, tamper-evident audit log that Inbox/Control read. Every audit entry references
// a verifiable StepUp; a forged act cannot present a verifying attestation; a tampered log breaks (Law L5).
//
// Drives the REAL substrate: holo-stepup buildStepUp/verifyStepUp with a REAL enrolled holo-identity
// principal, holo-strand as the spine, holo-strand-audit as the seam under test.
//
// Checks (all must hold):
//   1 actsRecordedOnSpine   — 3 acts (consent · delegation · value) → 3 signed audit entries, in order; chain verifies.
//   2 oneUnifiedSource      — auditLog returns all three across families from the ONE spine.
//   3 levelFilterWorks      — filter by level: value→1 (wallet), authority→2 (consent+delegation).
//   4 actReferencesStepUp   — verifyAct passes: each entry's StepUp κ matches + verifyStepUp validates it.
//   5 forgedActRefused      — a step-up with an altered payload fails verifyStepUp ⇒ verifyAct refuses.
//   6 tamperedLogRefused    — mutate an audit entry ⇒ spine.verify fails (the trail is not trusted).
//   7 auditEntriesSigned    — every audit entry carries a verifying operator signature (authorship).
//
// Authority: holo-apps "explicit consent" standard · UOR-ADDR (κ=H(canonical_form)) · IETF RFC 8785 (JCS) ·
// holospaces Laws L1/L2/L5 · rests on #holo-stepup + #holo-strand + #holo-identity. node tools/holo-strand-audit-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildStepUp } from "../os/usr/lib/holo/holo-stepup.mjs";
import { makeStrand, verifyEntry } from "../os/usr/lib/holo/holo-strand.mjs";
import { recordConsent, recordDelegation, recordApproval, auditLog, verifyAct } from "../os/usr/lib/holo/holo-strand-audit.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-22T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "audit-tester", passphrase: "correct horse battery audit" });
const backend = arrayBackend();
const strand = makeStrand({ backend, now, signer: op });

// build a real, payload-bound, operator-signed StepUp for an action (mirrors holo-stepup's actionBody)
const mkStepUp = (kind, payload, reason, appId = "org.hologram.app") =>
  buildStepUp({ "@type": "HoloStepUp", kind, appId, operator: op.kappa, reason, payload, issuedAt: now(), nonce: "00112233" + String(tick) }, op);

// ── three consequential acts, recorded onto the one spine ────────────────────────────────────────────
const suConsent = await mkStepUp("terms.grantSensitive", { app: "HoloAtlas", scope: "files:read" }, "Allow HoloAtlas to read files");
const suDeleg = await mkStepUp("delegation.issue", { delegate: "did:holo:sha256:" + "a".repeat(64), caps: ["inbox.read"] }, "Delegate inbox.read to agent");
const suValue = await mkStepUp("wallet.send", { to: "0xabc", amount: "0.4", chain: "base" }, "Send 0.4 ETH on base to 0xabc", "org.hologram.HoloWallet");
const eConsent = await recordConsent(strand, suConsent);
const eDeleg = await recordDelegation(strand, suDeleg);
const eValue = await recordApproval(strand, suValue);

// ── 1 · all three on the spine, signed, in order; chain verifies ─────────────────────────────────────
const audits = strand.replay({ kind: "audit" });
const v = await strand.verify();
ok("actsRecordedOnSpine",
  v.ok && audits.length === 3 && audits.every((e, i) => e["holstr:seq"] === i)
  && eConsent["holstr:payload"].stepup === suConsent.id,
  JSON.stringify({ chain: v.ok, n: audits.length }));

// ── 2 · one unified source across the three families ─────────────────────────────────────────────────
const log = auditLog(strand);
ok("oneUnifiedSource",
  log.length === 3 && log.map((r) => r.act).join(",") === "terms.grantSensitive,delegation.issue,wallet.send",
  JSON.stringify(log.map((r) => r.act)));

// ── 3 · level filter (holo-stepup policy: value vs authority) ────────────────────────────────────────
const value = auditLog(strand, { level: "value" });
const authority = auditLog(strand, { level: "authority" });
ok("levelFilterWorks",
  value.length === 1 && value[0].act === "wallet.send" && authority.length === 2
  && authority.every((r) => r.act === "terms.grantSensitive" || r.act === "delegation.issue"),
  JSON.stringify({ value: value.length, authority: authority.length }));

// ── 4 · each audit entry references a verifying StepUp attestation ────────────────────────────────────
const va = await Promise.all([[eConsent, suConsent], [eDeleg, suDeleg], [eValue, suValue]].map(([e, t]) => verifyAct(e, t)));
ok("actReferencesStepUp", va.every((r) => r.ok), JSON.stringify(va));

// ── 5 · a forged act (altered step-up payload) cannot present a verifying attestation ─────────────────
const forgedStepUp = { ...suValue, payload: { to: "0xEVIL", amount: "9.9", chain: "base" } };   // changed recipient+amount
const vForged = await verifyAct(eValue, forgedStepUp);
ok("forgedActRefused", vForged.ok === false && vForged.why === "stepup-invalid", JSON.stringify(vForged));

// ── 6 · tampering the audit log breaks the chain (fail-closed, Law L5) ────────────────────────────────
const bad = clone(backend.dump());
const idx = bad.findIndex((e) => e["holstr:kind"] === "audit");
bad[idx]["holstr:payload"].act = "app.open";            // downgrade a value act to look harmless
const vbad = await makeStrand({ backend: arrayBackend(bad) }).verify();
ok("tamperedLogRefused", vbad.ok === false && vbad.brokeAt === idx, JSON.stringify(vbad));

// ── 7 · every audit entry is operator-signed (authorship of the record) ──────────────────────────────
const sigs = await Promise.all(audits.map((e) => verifyEntry(e)));
ok("auditEntriesSigned", sigs.every((r) => r.ok && r.signed) && audits.every((e) => e["holstr:op"] === op.kappa), JSON.stringify(sigs.map((r) => r.ok)));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-strand P3 — ONE SIGNED AUDIT SOURCE: consent (terms.grantSensitive), delegation (delegation.issue) and value transfer (wallet.*) acts are recorded as signed `audit` entries on the operator source chain, each referencing a payload-bound, operator-signed StepUp attestation (holo-stepup). Inbox/Control read ONE ordered, tamper-evident audit log; a forged act cannot present a verifying step-up; a tampered log breaks the chain (Law L5). The step-up seam, Terms, delegation and wallet are unchanged; the audit log is one projection of the single spine.",
  authority: "holo-apps explicit-consent standard · UOR-ADDR (κ=H(canonical_form)) · IETF RFC 8785 (JCS) · holospaces Laws L1/L2/L5 · rests on #holo-stepup + #holo-strand + #holo-identity",
  witnessed,
  covers: witnessed ? ["acts-on-spine", "one-unified-source", "level-filter", "references-stepup", "forged-refused", "tamper-refused", "audit-signed"] : [],
  sample: { acts: log.map((r) => `${r.level}:${r.act}`), strandHead: strand.head() },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-strand-audit-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-strand witness — P3 ONE SIGNED AUDIT SOURCE (consent · delegation · value on the source chain)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  audit log (one spine): ${log.map((r) => r.level + ":" + r.act).join("  ·  ")}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  every consent/delegation/approval is one signed, ordered, verifiable record" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
