#!/usr/bin/env node
// holo-plus-rank-witness.mjs — proves A3 of "The + Everywhere": CONTEXT-AWARE RANKING. The magic of the ambient
// "+": the SAME source dropped in two different places surfaces two different things, because insights are ranked
// to what the user is doing NOW. Ranking is PRESENTATION metadata (holo:relevance) — it never changes an insight's
// κ identity or breaks its provenance (S5). No context → confidence order (backward compatible). Baseline scorer is
// deterministic term-overlap; Q scores relevance in production (swappable seam).
//
// Checks (all must hold):
//   1 sameSourceTwoContextsDifferTop — ONE source, two contexts → DIFFERENT top-ranked insight. THE headline.
//   2 relevanceAnnotated      — every ranked insight carries holo:relevance ∈ [0,1].
//   3 kappaUnchangedByRanking — ranking does NOT change any insight @id (relevance is presentation, not identity).
//   4 provenanceSurvivesRank  — a ranked insight still verifies (S5) against the graph + source bytes.
//   5 noContextPreservesOrder — with no context, order is pure confidence (rankByContext returns input unchanged).
//   6 baselineTermOverlap     — an insight sharing terms with the context scores strictly higher than an unrelated one.
//   7 runPlusEndToEnd         — runPlus(src, ctxA) vs runPlus(src, ctxB) → different brief top line, same insight κs.
//   8 qScorerSeam             — a custom relevance scorer (Q stand-in) drops in and changes the ranking.
//
// Authority: holospaces Laws L2/L5 · rests on #holo-plus + #holo-insight + #holo-plus-context.
//   node tools/holo-plus-rank-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rankByContext, baselineRelevance } from "../os/usr/lib/holo/holo-plus-context.mjs";
import { investigate, verifyInsight } from "../os/usr/lib/holo/holo-insight.mjs";
import { sealIngest } from "../os/usr/lib/holo/holo-ingest.mjs";
import { extractGraph } from "../os/usr/lib/holo/holo-map.mjs";
import { runPlus } from "../os/usr/lib/holo/holo-plus.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);

// ── one source with several facets (corroboration, location, CEO, funding) ──────────────────────────
const DOC = "Acme Corp is based in Berlin. Acme Corp is based in Berlin. CEO: Dana Lee. Acme Corp raised €4,200,000 in Berlin in 2024.";
const bytes = enc(DOC);
const src = sealIngest({ name: "acme.txt", bytes });
const graph = extractGraph({ text: DOC, sourceKappa: src.source });
const insights = await investigate(graph);
const sourceBytes = new Map([[src.source, bytes]]);

// two different reasons-for-dropping. The local-surface inputText uses words that appear in DIFFERENT insights —
// the user's own words ("berlin"/"location" vs "ceo"/"dana") are the relevance signal. (We avoid "acme" — it is in
// every insight, so it carries no discriminating signal.)
const ctxLocation = { surface: "local", activeApp: "atlas", inputText: "berlin location city headquarters" };
const ctxCeo = { surface: "local", activeApp: "records", inputText: "ceo dana lee executive leadership" };

const rankedLoc = rankByContext(insights, ctxLocation);
const rankedCeo = rankByContext(insights, ctxCeo);

// ── 1 · same source, two contexts → different top insight ───────────────────────────────────────────
const topLoc = rankedLoc[0]["schema:text"], topCeo = rankedCeo[0]["schema:text"];
ok("sameSourceTwoContextsDifferTop", topLoc !== topCeo, `loc-top="${topLoc}" ceo-top="${topCeo}"`);

// ── 2 · relevance annotated in [0,1] ────────────────────────────────────────────────────────────────
ok("relevanceAnnotated", rankedLoc.every((i) => typeof i["holo:relevance"] === "number" && i["holo:relevance"] >= 0 && i["holo:relevance"] <= 1));

// ── 3 · κ identity unchanged by ranking ─────────────────────────────────────────────────────────────
const idsBefore = new Set(insights.map((i) => i["@id"]));
ok("kappaUnchangedByRanking",
  rankedLoc.length === insights.length && rankedLoc.every((i) => idsBefore.has(i["@id"]))
  && rankedCeo.every((i) => idsBefore.has(i["@id"])));

// ── 4 · provenance survives ranking (S5 still holds on a ranked copy) ───────────────────────────────
ok("provenanceSurvivesRank", rankedLoc.every((i) => verifyInsight(i, { graph, sourceBytes }).ok));

// ── 5 · no context → unchanged (pure confidence order downstream) ───────────────────────────────────
const unranked = rankByContext(insights, null);
ok("noContextPreservesOrder", unranked === insights);

// ── 6 · baseline term-overlap: a context-matching insight scores strictly higher than an unrelated one ─
const locationInsight = insights.find((i) => /location|Berlin/i.test(i["schema:text"]));
const ceoInsight = insights.find((i) => /CEO|Dana/i.test(i["schema:text"]));
ok("baselineTermOverlap",
  !!locationInsight && !!ceoInsight && baselineRelevance(locationInsight, ctxLocation) > baselineRelevance(ceoInsight, ctxLocation),
  `loc=${locationInsight && baselineRelevance(locationInsight, ctxLocation)} ceo=${ceoInsight && baselineRelevance(ceoInsight, ctxLocation)}`);

// ── 7 · runPlus end-to-end: two contexts → different brief top, same insight κ-set ──────────────────
const outA = await runPlus([{ name: "a.txt", bytes }], { context: ctxLocation, title: "A" });
const outB = await runPlus([{ name: "a.txt", bytes }], { context: ctxCeo, title: "B" });
const topA = outA.brief["holo:items"][0]["schema:text"], topB = outB.brief["holo:items"][0]["schema:text"];
const setA = new Set(outA.insights.map((i) => i["@id"])), setB = new Set(outB.insights.map((i) => i["@id"]));
const sameSet = setA.size === setB.size && [...setA].every((k) => setB.has(k));
ok("runPlusEndToEnd", topA !== topB && sameSet, `topA="${topA}" topB="${topB}" sameSet=${sameSet}`);

// ── 8 · Q scorer seam: a custom scorer reorders ─────────────────────────────────────────────────────
const qScorer = (insight) => (/CEO|Dana/i.test(insight["schema:text"]) ? 1 : 0.1);   // Q decides CEO matters most
const rankedQ = rankByContext(insights, ctxLocation, { scorer: qScorer });
ok("qScorerSeam", /CEO|Dana/i.test(rankedQ[0]["schema:text"]) && rankedQ[0]["@id"] === ceoInsight["@id"]);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "The + Everywhere — A3 CONTEXT-AWARE RANKING: the same source ranked under two different local-surface contexts surfaces a different top insight (the ambient magic), via a deterministic term-overlap baseline scorer (Q in production, a swappable seam). Relevance is presentation metadata (holo:relevance) — it never changes an insight's κ identity and never breaks provenance (S5). No context → confidence order preserved (backward compatible). Proven end-to-end through runPlus + composeBrief",
  authority: "holospaces Laws L2/L5 · rests on #holo-plus + #holo-insight + #holo-plus-context",
  witnessed,
  covers: witnessed ? ["context-ranking","two-contexts-differ","relevance-annotated","kappa-stable","provenance-survives","backward-compatible","term-overlap","q-scorer-seam"] : [],
  sample: { locTop: topLoc, ceoTop: topCeo, runPlusTopA: topA, runPlusTopB: topB },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-plus-rank-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-plus-rank witness — A3 The + (same source, different context → different top insight)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  same source, two reasons:`);
console.log(`    · typed "berlin location city"        → top: ${topLoc}`);
console.log(`    · typed "ceo dana lee executive"      → top: ${topCeo}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the + ranks to what you're doing now — same drop, different place, different insight" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
