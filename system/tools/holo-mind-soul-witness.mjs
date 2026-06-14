#!/usr/bin/env node
// holo-mind-soul-witness.mjs — proves Holo Mind PHASE 3 (ADR-0081): the SOUL. All checks hold against
// the real os/usr/lib/holo/holo-mind-soul.mjs (and the REAL output court in holo-conscience.js):
//   1. drivesPropose      — drives past threshold raise curiosity/self goal PROPOSALS (intents), not acts; below → none
//   2. drivesDeterministic — a tick is a PURE function of (drives ⊕ integer observations) — re-derivable (no clock/random)
//   3. coherenceMeasure   — the signal/noise utility is DETERMINISTIC: re-derivable+novel → max; unverifiable → 0; duplicate penalised
//   4. outputCourt        — the measure of a GOOD action is the REAL court (ADR-033): a clean draft passes, PII trips the Dignity RED LINE (block)
//   5. selfDiscipline     — a proposal carries NO effect/verb — there is no act in the soul that can skip the conscience (structural)
//   6. userModelPrivate   — the user model re-derives, is flagged private, teaches, and revisions chain (prov:wasRevisionOf, L5)
//   7. selfModelDivergence — the self model re-derives; divergence GROWS with experience; the chain re-derives
//   8. primeDirective     — the one objective is a stable κ (deterministic, re-derivable)
//
//   node tools/holo-mind-soul-witness.mjs        (also run live by tools/gate.mjs)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { verify, verifyDeep, resolve, makeObject } from "../os/usr/lib/holo/holo-mind.mjs";
import { initDrives, tickDrives, proposeGoals, coherence, sealUserModel, sealSelfModel, divergenceOf, PRIME_DIRECTIVE, HE_THRESHOLD } from "../os/usr/lib/holo/holo-mind-soul.mjs";
import { judgeOutput } from "../os/usr/lib/holo/holo-conscience.js";

const here = dirname(fileURLToPath(import.meta.url));
const HOLO = { holo: "https://hologram.os/ns/mind#" };
const checks = {};
const K = (c) => "did:holo:sha256:" + String(c).repeat(64).slice(0, 64);

// ── 1. drivesPropose — past threshold → curiosity/self goal proposals; below → none ──
{
  let d = initDrives();                                            // epistemicHunger 0, fitness 1
  d = tickDrives(d, { unseen: HE_THRESHOLD });                     // raise hunger to threshold
  const hungry = proposeGoals(d);
  const low = tickDrives(initDrives(), { failures: 5 });           // fitness floored
  const lowGoals = proposeGoals(low);
  const calm = proposeGoals(initDrives());                          // nothing past threshold
  checks.drivesPropose = hungry.some((g) => g.source === "curiosity")
    && lowGoals.some((g) => g.source === "self") && calm.length === 0;
}

// ── 2. drivesDeterministic — a tick re-derives from its inputs (no clock/random) ──
{
  const a = tickDrives({ epistemicHunger: 2, fitness: 3, seen: 4 }, { unseen: 2, failures: 1, successes: 0 });
  const b = tickDrives({ epistemicHunger: 2, fitness: 3, seen: 4 }, { unseen: 2, failures: 1, successes: 0 });
  checks.drivesDeterministic = JSON.stringify(a) === JSON.stringify(b) && a.epistemicHunger === 4 && a.fitness === 2;
}

// ── 3. coherenceMeasure — deterministic signal/noise; not a self-grade ──
{
  const seen = new Set([K("d")]);
  const full = coherence({ effectKappa: K("a"), seen, receipts: 1, refused: 0 });          // re-derivable+novel+grounded+coherent → 4
  const dup = coherence({ effectKappa: K("d"), seen, receipts: 1, refused: 0 });            // duplicate → 3
  const noise = coherence({ effectKappa: "not-a-kappa", seen, receipts: 0, refused: 2 });   // none → 0
  const again = coherence({ effectKappa: K("a"), seen, receipts: 1, refused: 0 });
  checks.coherenceMeasure = full.signal === 4 && full.max === 4 && dup.signal === 3 && noise.signal === 0
    && JSON.stringify(full) === JSON.stringify(again);             // deterministic, re-derivable — not a self-grade
}

// ── 4. outputCourt — the REAL nine-principle court: clean passes, PII trips the Dignity red line ──
{
  const clean = await judgeOutput("The result is 42 [E1].", {});
  const pii = await judgeOutput("Reach me at john@example.com any time.", {});
  checks.outputCourt = clean.outcome !== "block" && pii.outcome === "block" && pii.blocked.includes("C4");
}

// ── 5. selfDiscipline — a proposal is data (source+utterance), never an effect/verb (structural) ──
{
  const goals = proposeGoals({ epistemicHunger: 10, fitness: 0 });
  checks.selfDiscipline = goals.length === 2
    && goals.every((g) => g.source && g.utterance && g.verb === undefined && g.effect === undefined && g.dispatch === undefined);
}

// ── 6. userModelPrivate — re-derives, private, teaches, revisions chain ──
{
  const store = new Map();
  const u1 = sealUserModel(store, { facts: { prefers: "brevity" }, taught: 1 });
  const u2 = sealUserModel(store, { facts: { prefers: "brevity", domain: "physics" }, taught: 3, priorKappa: u1.id });
  const chained = (u2.links || []).some((l) => l.rel === "prov:wasRevisionOf" && l.id === u1.id);
  checks.userModelPrivate = verify(u1) && u1["holo:private"] === true && u2["holo:taught"] === 3
    && chained && verifyDeep(store, u2).ok === true;
}

// ── 7. selfModelDivergence — re-derives; divergence grows with experience ──
{
  const store = new Map();
  const s1 = sealSelfModel(store, { stats: { loops: 1 } });
  const s2 = sealSelfModel(store, { stats: { loops: 10, skillsLearned: 2, revisionsAccepted: 1 }, priorKappa: s1.id });
  checks.selfModelDivergence = verify(s1) && verify(s2)
    && s2["holo:divergence"] > s1["holo:divergence"]
    && s2["holo:divergence"] === divergenceOf({ loops: 10, skillsLearned: 2, revisionsAccepted: 1 })
    && verifyDeep(store, s2).ok === true;
}

// ── 8. primeDirective — the one objective is a stable κ ──
{
  const store = new Map();
  const pd = makeObject(store, { type: ["holo:PrimeDirective", "prov:Entity"], context: [HOLO], "holo:statement": PRIME_DIRECTIVE });
  const pd2 = makeObject(store, { type: ["holo:PrimeDirective", "prov:Entity"], context: [HOLO], "holo:statement": PRIME_DIRECTIVE });
  checks.primeDirective = PRIME_DIRECTIVE.length > 80 && verify(pd) && pd.id === pd2.id && /coherence/i.test(PRIME_DIRECTIVE);
}

// ── verdict + result file ──
const witnessed = Object.values(checks).every(Boolean);
const result = {
  spec: "Holo Mind Phase 3 (ADR-0081) — the SOUL: intrinsic homeostatic drives (anima's digital_desire) that PROPOSE curiosity/self goals which run the ordinary conscience-gated loop (self-discipline is structural — a proposal is never an act); a DETERMINISTIC, re-derivable coherence (signal-vs-noise) utility that cannot be Goodharted by a model self-grade, with the five JUDGED output-court principles (Care · Fairness · Autonomy · Responsibility · Justice, ADR-033) as the model-judged measure of a GOOD action; and self-verifying, PRIVATE-FIRST user + self models (revisioned κ-objects, durable, never published — Data Sovereignty). Drives are integer-only (no clock/random) so a tick re-derives.",
  authority: "W3C PROV-O (wasRevisionOf) · W3C DID Core · IETF RFC 8785 (JCS) · UOR-ADDR (κ = H(canonical form)) · the Holo Constitution output court + conscience gate (ADR-033, the nine-principle judgeOutput) · anima digital_desire/self_reflection (the drives + self model, re-expressed) · holospaces Laws L1/L2/L3/L4/L5 (identity is content · canonical forms only · the store is the memory · everything through the substrate · verify by re-derivation)",
  witnessed,
  covers: witnessed ? ["holo-mind-soul", "intrinsic-drives", "coherence-measure", "output-court", "self-discipline", "user-model", "self-model", "prime-directive", "law-l1", "law-l4", "law-l5"] : [],
  checks,
};
writeFileSync(join(here, "holo-mind-soul-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
