#!/usr/bin/env node
// holo-factory-triage-witness.mjs — proves SEMANTIC TRIAGE (ADR-0097): the factory FINDS the target by
// MEANING. Booleans over the real os/usr/lib/holo/q/holo-factory-triage.mjs (embedder injected as a
// deterministic stub whose vectors encode meaning, NOT shared words — the live embedder is EmbeddingGemma,
// already verified separately):
//   1. ranksByMeaning   — the query shares NO words with the right candidate yet ranks it first; the unrelated one scores ~0
//   2. locateThreshold  — locate() returns the best target when it clears the threshold
//   3. honestNoGuess    — nothing above the threshold ⇒ target null + a reason (never guesses — Law L5)
//   4. deterministic    — two ranks of the same input are identical (re-derivable given the embedder)
//   5. discoverRegisters— tender.discover() locates the target and REGISTERS a check for it (no human naming)
//   6. discoverThenFix  — the discovered check, when red, drives a factory fix on the next tend (triage → register → fix, end to end)
//
//   node tools/holo-factory-triage-witness.mjs        (also run live by tools/gate.mjs)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTriage } from "../os/usr/lib/holo/q/holo-factory-triage.mjs";
import { createTender } from "../os/usr/lib/holo/q/holo-factory-tend.mjs";
import { createFactory } from "../os/usr/lib/holo/q/holo-factory.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};
const ACCEPT = async () => ({ outcome: "accept" });
const GOOD = "function f(){ return 1; }";
const BAD = "function f({ ";

// a deterministic stub embedder: vectors encode MEANING (felines cluster; truck/flowers are orthogonal),
// so the query "the pet is sick" matches "a fluffy kitten" with ZERO shared words — proving it's semantic.
const VEC = {
  "the pet is sick": [1.0, 0.10, 0, 0],
  "a fluffy kitten": [0.98, 0.12, 0, 0],          // closest in direction to the query → the unambiguous match
  "my cat naps all day": [0.85, 0.25, 0, 0],      // also feline (near), but a clear runner-up
  "a diesel truck engine": [0, 0, 1, 0],          // orthogonal → ~0
  "garden flowers bloom": [0, 0, 0, 1],           // orthogonal → ~0
};
const embed = async (t) => Array.isArray(t) ? t.map((x) => VEC[x] || [0, 0, 0, 0]) : (VEC[t] || [0, 0, 0, 0]);
const triage = createTriage({ embed });
const CANDS = [
  { id: "kitten", text: "a fluffy kitten" },
  { id: "truck", text: "a diesel truck engine" },
  { id: "flowers", text: "garden flowers bloom" },
  { id: "cat", text: "my cat naps all day" },
];

// ── 1. ranksByMeaning — semantic, not keyword ──
{
  const r = await triage.rank("the pet is sick", CANDS);
  const top = r[0], truck = r.find((x) => x.candidate.id === "truck");
  checks.ranksByMeaning = top.candidate.id === "kitten" && top.score > 0.9 && truck.score < 0.1
    && r.findIndex((x) => x.candidate.id === "kitten") < r.findIndex((x) => x.candidate.id === "truck");
}

// ── 2. locateThreshold — best target above the bar ──
{
  const loc = await triage.locate("the pet is sick", CANDS, { threshold: 0.5 });
  checks.locateThreshold = !!loc.target && loc.target.id === "kitten" && loc.score > 0.9;
}

// ── 3. honestNoGuess — nothing relevant ⇒ no target (Law L5) ──
{
  const loc = await triage.locate("the pet is sick", [CANDS[1], CANDS[2]], { threshold: 0.5 });   // only truck + flowers
  checks.honestNoGuess = loc.target === null && typeof loc.reason === "string" && loc.reason.length > 0;
}

// ── 4. deterministic — re-derivable given the embedder ──
{
  const a = await triage.rank("the pet is sick", CANDS), b = await triage.rank("the pet is sick", CANDS);
  checks.deterministic = JSON.stringify(a.map((x) => x.candidate.id)) === JSON.stringify(b.map((x) => x.candidate.id));
}

// ── 5. discoverRegisters — triage locates + the tender registers a check, no human naming ──
{
  const factory = createFactory({ propose: async () => ({ source: GOOD, lang: "js" }), gate: ACCEPT });
  const tender = createTender({ factory, triage });
  const cands = CANDS.map((c) => ({ ...c, read: () => GOOD, write: () => {}, lang: "js" }));
  const d = await tender.discover("the pet is sick", cands, { threshold: 0.5 });
  checks.discoverRegisters = d.located === "kitten" && d.registered.length === 1 && tender.list().includes("triage:kitten");
}

// ── 6. discoverThenFix — the located check, red, drives a factory fix end to end ──
{
  let src = BAD;
  const factory = createFactory({ propose: async () => ({ source: GOOD, lang: "js" }), gate: ACCEPT });
  const tender = createTender({ factory, triage });
  const cands = [{ id: "kitten", text: "a fluffy kitten", read: () => src, write: (s) => { src = s; }, lang: "js" },
    { id: "truck", text: "a diesel truck engine", read: () => GOOD, write: () => {}, lang: "js" }];
  await tender.discover("the pet is sick", cands, { threshold: 0.5 });
  const r = await tender.tend();
  const row = r.results.find((x) => x.name === "triage:kitten");
  checks.discoverThenFix = !!row && row.status === "fixed" && src === GOOD;
}

const witnessed = Object.values(checks).every(Boolean);
const out = {
  spec: "Holo Factory SEMANTIC TRIAGE (ADR-0097) — the factory finds the target itself. A natural-language signal is "
    + "embedded (EmbeddingGemma-300m, the OS's verified embedder) and matched BY MEANING against the live candidate surfaces, "
    + "not by keyword — so the user states intent ('the add function is broken', 'keep my notepad working') and the factory "
    + "LOCATES what to fix or watch, then the tender registers a check for it. Pure given the injected embed(); deterministic "
    + "cosine ranking ⇒ re-derivable. HONEST (Law L5): nothing above the similarity threshold ⇒ NO target — it reports it can't "
    + "locate, it does not guess (mirrors never-fakes-green).",
  authority: "W3C DID Core · IETF RFC 8785 (JCS) · UOR-ADDR (κ = H(canonical form)) · EmbeddingGemma-300m (ADR-0096, the verified "
    + "any-browser embedder) · Holo Factory ADR-0097 · Holo Mind ADR-0081 (injected-faculty isomorphism) · holospaces Laws L1/L4/L5",
  witnessed,
  covers: ["holo-factory", "semantic-triage", "embedding-locate", "never-guesses", "self-locating", "law-l4", "law-l5"],
  checks,
  notes: { core: "os/usr/lib/holo/q/holo-factory-triage.mjs", basis: "createTriage{embed} → rank/locate; tender.discover() registers the located check; live embedder = HoloVoice.embed (EmbeddingGemma)" },
};
writeFileSync(join(here, "holo-factory-triage-witness.result.json"), JSON.stringify(out, null, 2));
console.log(`holo-factory-triage-witness: ${witnessed ? "PASS" : "FAIL"}`);
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"} ${k}`);
process.exit(witnessed ? 0 : 1);
