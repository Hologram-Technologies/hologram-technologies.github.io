#!/usr/bin/env node
// holo-factory-grow-witness.mjs — proves SELF-IMPROVEMENT (ADR-0097): the factory improves by observing its
// own failures. Booleans over the real os/usr/lib/holo/q/holo-factory-grow.mjs (composing Holo Mind Phase 2):
//   1. growsOnFailures  — ≥ minFailures failure traces + a model ⇒ a governed SkillRevision is sealed
//   2. honestThreshold  — below the failure threshold ⇒ no revision (won't churn the skill on noise) + a reason
//   3. governedInForce  — a PASSING gate ⇒ inForce true; a FAILING gate ⇒ the sealed revision is honestly NOT in force
//   4. noModelNoProposal— no sampler ⇒ no proposal (the optimizer borrows the existing model; nothing to govern)
//   5. revisionReDerives— the sealed revision + its DAG re-derive (Law L5)
//   6. derivesFromCorpus— the revision links prov:wasDerivedFrom the corpus head (the audit trail of HOW it learned)
//
//   node tools/holo-factory-grow-witness.mjs        (also run live by tools/gate.mjs)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { growFromFailures } from "../os/usr/lib/holo/q/holo-factory-grow.mjs";
import { appendTrace } from "../os/usr/lib/holo/holo-mind-evolve.mjs";
import { verify, verifyDeep, resolve } from "../os/usr/lib/holo/holo-mind.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};
const SKILL = "---\nname: factory-fix\ndescription: an improved fix strategy learned from failures\n---\nAlways verify syntax before proposing; prefer minimal in-place edits.";
const sampler = async () => SKILL;
const PASS_GATE = { testsPass: true, conscienceOutcome: "accept", ratifiedBy: "operator", coolingOffElapsed: true };
const FAIL_GATE = { testsPass: false, conscienceOutcome: "accept", ratifiedBy: "operator", coolingOffElapsed: true };

// build a corpus with two failure traces (the tender appends these per failed run)
function corpusWithFailures(store, n) {
  let head = null;
  for (let i = 0; i < n; i++) { const t = appendTrace(store, head, { intentKappa: "did:holo:sha256:" + "f".repeat(63) + i, outcome: "failure", failureKind: "syntax" }); head = t.id; }
  return head;
}

// ── 1. growsOnFailures ──
{
  const store = new Map(); const head = corpusWithFailures(store, 2);
  const r = await growFromFailures(store, head, { sampler, gate: PASS_GATE, minFailures: 2 });
  checks.growsOnFailures = r.grew === true && r.failures === 2 && typeof r.revision === "string" && !!resolve(store, r.revision);
}

// ── 2. honestThreshold ──
{
  const store = new Map(); const head = corpusWithFailures(store, 1);
  const r = await growFromFailures(store, head, { sampler, gate: PASS_GATE, minFailures: 2 });
  checks.honestThreshold = r.grew === false && r.failures === 1 && typeof r.reason === "string" && /threshold|need|churn/i.test(r.reason);
}

// ── 3. governedInForce ──
{
  const s1 = new Map(), h1 = corpusWithFailures(s1, 2);
  const pass = await growFromFailures(s1, h1, { sampler, gate: PASS_GATE, minFailures: 2 });
  const s2 = new Map(), h2 = corpusWithFailures(s2, 2);
  const fail = await growFromFailures(s2, h2, { sampler, gate: FAIL_GATE, minFailures: 2 });
  checks.governedInForce = pass.grew === true && pass.inForce === true && fail.grew === true && fail.inForce === false;
}

// ── 4. noModelNoProposal ──
{
  const store = new Map(); const head = corpusWithFailures(store, 3);
  const r = await growFromFailures(store, head, { sampler: null, gate: PASS_GATE, minFailures: 2 });
  checks.noModelNoProposal = r.grew === false && /model|propose|borrows/i.test(r.reason);
}

// ── 5. revisionReDerives ──
{
  const store = new Map(); const head = corpusWithFailures(store, 2);
  const r = await growFromFailures(store, head, { sampler, gate: PASS_GATE, minFailures: 2 });
  const rev = resolve(store, r.revision);
  checks.revisionReDerives = !!rev && verify(rev) === true && verifyDeep(store, rev).ok === true;
}

// ── 6. derivesFromCorpus ──
{
  const store = new Map(); const head = corpusWithFailures(store, 2);
  const r = await growFromFailures(store, head, { sampler, gate: PASS_GATE, minFailures: 2 });
  const rev = resolve(store, r.revision);
  const links = (rev.links || []).filter((l) => l.rel === "prov:wasDerivedFrom").map((l) => l.id);
  checks.derivesFromCorpus = links.includes(head);
}

const witnessed = Object.values(checks).every(Boolean);
const out = {
  spec: "Holo Factory SELF-IMPROVEMENT (ADR-0097) — the factory improves over time by OBSERVING ITSELF (the last Factory 2.0 "
    + "pillar). The tender appends a Trace per run; growth reads the FAILURE traces and drives Holo Mind's Phase-2 optimizer "
    + "(evolve, ADR-0081): propose an improved skill from the failures, seal it as a GOVERNED, re-derivable SkillRevision in force "
    + "ONLY when every condition holds (tests pass · within size ceiling · conscience accepts · operator-ratified · cooling-off "
    + "elapsed). No new substrate — composes holo-mind-evolve verbatim. HONEST (Law L5 + the ADR-0052 boundary): the proposal is a "
    + "stochastic generation, NOT reproducible — L5 holds over the AUDIT TRAIL (which corpus, which gates), not the search; below a "
    + "failure threshold it does nothing (no churn on noise); no model ⇒ no proposal; a failing gate ⇒ honestly NOT in force.",
  authority: "W3C PROV-O (prov:wasRevisionOf / wasDerivedFrom) · IETF RFC 8785 (JCS) · W3C Subresource Integrity · UOR-ADDR (κ = "
    + "H(canonical form)) · the Holo Constitution governed succession + conscience gate + adaptive-immune-classifier pattern (ADR-033) · "
    + "Holo Mind ADR-0081 Phase 2 (the trace corpus + governed self-evolution) · Holo Factory ADR-0097 · holospaces Laws L1/L2/L3/L4/L5",
  witnessed,
  covers: ["holo-factory", "self-improvement", "learn-from-failure", "governed-evolution", "audit-trail", "law-l5"],
  checks,
  notes: { core: "os/usr/lib/holo/q/holo-factory-grow.mjs", basis: "growFromFailures() composes holo-mind-evolve.evolve over the factory's failure traces; in-force is governed + re-derived" },
};
writeFileSync(join(here, "holo-factory-grow-witness.result.json"), JSON.stringify(out, null, 2));
console.log(`holo-factory-grow-witness: ${witnessed ? "PASS" : "FAIL"}`);
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"} ${k}`);
process.exit(witnessed ? 0 : 1);
