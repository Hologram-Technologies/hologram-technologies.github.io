#!/usr/bin/env node
// holo-insight-witness.mjs — proves S4 of "the +": THE REASON REFLEX. The magic. With ZERO user input — no
// query, nothing typed — ingesting sources fires a signal (S3) that wakes the investigator, which produces
// content-addressed INSIGHT κs over the κ-hypergraph. Each insight CITES its evidence (claim/entity κs) and
// traces to the SOURCE κs, so the brief (S6) is just these κs rendered and provenance (S5) is structural.
//
// The witness drives the DETERMINISTIC baseline investigators (no GPU) so it proves the reflex MECHANICS, not
// LLM novelty — Q's zero-shot brain (makeQInvestigator) is the production investigator, proven in the browser.
// The headline check is the one that beats ANIMA: a "corroboration" insight emerges with no query, computable
// ONLY because the κ-substrate gave multi-source provenance for free (S2).
//
// Checks (all must hold):
//   1 reflexFiresWithNoUserInput  — reactToIngest({graph,tap}) returns a signal + ≥1 insight; nothing was asked.
//   2 corroborationInsightEmerges — a 2-source merged graph yields a "corroborated by 2 sources" insight (the magic).
//   3 everyInsightCitesEvidence   — every insight's evidence κs all exist as nodes/edges in the graph (no dangling).
//   4 insightTracesToSources      — every insight's prov sources are real ingest source κs in the graph.
//   5 insightKappaReDerives       — each insight κ re-derives from its canonical finding form (Law L5, independent hash).
//   6 findingsAreDeduped          — identical findings collapse to one insight κ (content-addressed, like S2).
//   7 investigatorSeamIsSwappable — a custom investigator drops into investigate() and changes the insights (Q drop-in).
//   8 singleSourceRiskHonest      — a single-sourced claim is flagged as a risk (the system names its own weak evidence).
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · W3C PROV-O · IETF RFC 8785 (JCS) · holospaces Laws L2/L5 ·
// rests on #holo-ingest (S0) + #holo-map (S1/S2) + #holo-telemetry-tap (S3). node tools/holo-insight-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeTelemetry } from "../os/usr/lib/holo/holo-telemetry.mjs";
import { makeStore, memBackend } from "../os/usr/lib/holo/holo-store.js";
import { sha256hex, jcs } from "../os/usr/lib/holo/holo-uor.mjs";
import { makeTap } from "../os/usr/lib/holo/holo-telemetry-tap.mjs";
import { sealIngest } from "../os/usr/lib/holo/holo-ingest.mjs";
import { extractGraph, mergeGraphs } from "../os/usr/lib/holo/holo-map.mjs";
import { reactToIngest, investigate } from "../os/usr/lib/holo/holo-insight.mjs";
import { reDerive } from "../os/sbin/holo-resolver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const reKappa = async (bytes) => "did:holo:sha256:" + (await reDerive(bytes));

// ── two sources mentioning the same entity → merged graph with multi-source provenance (S2) ────────
const DOC_A = "Acme Corp operates in Berlin. Acme Corp shipped 12 products in 2023.";
const DOC_B = "Acme Corp is based in Berlin. CEO: Dana Lee leads the company.";
const srcA = sealIngest({ name: "a.txt", bytes: enc(DOC_A) });
const srcB = sealIngest({ name: "b.txt", bytes: enc(DOC_B) });
const graph = mergeGraphs([
  extractGraph({ text: DOC_A, sourceKappa: srcA.source }),
  extractGraph({ text: DOC_B, sourceKappa: srcB.source }),
]);

// telemetry tap (the S3 signal plane) — the reflex fires the signal through it
const tel = makeTelemetry({ store: makeStore({ hash: (b) => sha256hex(b), axis: "did:holo:sha256", backend: memBackend() }), hash: (b) => sha256hex(b), now: () => 1000 });
const tap = makeTap({ telemetry: tel, service: "the-plus" });

// ── 1 · THE REFLEX: no query, nothing typed — just react to the ingest ──────────────────────────────
const { signal, insights } = await reactToIngest({ graph, tap });
ok("reflexFiresWithNoUserInput",
  !!signal && (await tel.verify(signal.span.kappa)).ok === true && insights.length >= 1,
  `insights=${insights.length}`);

// ── 2 · THE MAGIC: a corroboration insight emerges unbidden (only possible via S2 multi-source prov) ─
const corro = insights.find((i) => i["holo:kind"] === "corroboration" && /Acme Corp/.test(i["schema:text"]) && /2 independent sources/.test(i["schema:text"]));
ok("corroborationInsightEmerges", !!corro, corro ? corro["schema:text"] : "no corroboration insight");

// ── 3 · every insight cites evidence that actually exists in the graph ──────────────────────────────
const nodeIds = new Set([...graph["holo:entities"], ...graph["holo:claims"], ...graph["holo:provenance"]].map((n) => n["@id"]));
ok("everyInsightCitesEvidence",
  insights.length > 0 && insights.every((i) => i["holo:evidence"].length > 0 && i["holo:evidence"].every((k) => nodeIds.has(k))));

// ── 4 · every insight traces to REAL ingest source κs ───────────────────────────────────────────────
const realSources = new Set([srcA.source, srcB.source]);
ok("insightTracesToSources",
  insights.every((i) => i["prov:wasDerivedFrom"].length > 0 && i["prov:wasDerivedFrom"].every((s) => realSources.has(s))));

// ── 5 · Law L5: each insight κ re-derives from its canonical finding form (independent hash) ────────
async function reDerivesById(ins) {
  const canonical = { t: "insight", kind: ins["holo:kind"], text: ins["schema:text"], evidence: [...ins["holo:evidence"]].sort() };
  return (await reKappa(enc(jcs(canonical)))) === ins["@id"];
}
ok("insightKappaReDerives", (await Promise.all(insights.map(reDerivesById))).every(Boolean));

// ── 6 · identical findings dedup to one insight κ (content-addressed) ───────────────────────────────
const again = await investigate(graph);
const ids1 = new Set(insights.map((i) => i["@id"]));
const ids2 = new Set(again.map((i) => i["@id"]));
ok("findingsAreDeduped", ids1.size === ids2.size && [...ids2].every((k) => ids1.has(k)) && new Set(again.map((i) => i["@id"])).size === again.length);

// ── 7 · the investigator is a swappable SEAM (Q drops in where the baseline is) ─────────────────────
const customInvestigators = { custom: (g) => [{ kind: "pattern", text: "custom finding", confidence: 0.9, evidence: [g["holo:entities"][0]["@id"]], sources: [g["holo:entities"][0] && srcA.source] }] };
const customInsights = await investigate(graph, { investigators: customInvestigators });
ok("investigatorSeamIsSwappable",
  customInsights.length === 1 && customInsights[0]["schema:text"] === "custom finding" && customInsights[0]["@type"].includes("holo:Insight"));

// ── 8 · the system honestly flags its own weak (single-source) evidence ─────────────────────────────
const risk = insights.find((i) => i["holo:kind"] === "single-source-risk");
ok("singleSourceRiskHonest", !!risk && risk["prov:wasDerivedFrom"].length === 1, risk ? risk["schema:text"] : "no risk insight");

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "the + — S4 REFLEX (holo-insight): with ZERO user input, ingesting fires a signal (S3) that wakes the investigator, which produces content-addressed insight κs over the κ-hypergraph. Each insight cites its evidence (claim/entity κs) and traces to the source κs (S5 foundation). The headline insight — 'corroborated by N independent sources' — emerges unbidden and is computable ONLY because the substrate gave multi-source provenance for free (S2). The investigator is a swappable seam: deterministic baseline witnessed here, Q's zero-shot brain in production. Insight κs re-derive (Law L5) and dedup (content-addressed)",
  authority: "UOR-ADDR (κ = H(canonical_form)) · W3C PROV-O · IETF RFC 8785 (JCS) · holospaces Laws L2/L5 · rests on #holo-ingest + #holo-map + #holo-telemetry-tap",
  witnessed,
  covers: witnessed ? ["reason-reflex","zero-user-input","corroboration-insight","cites-evidence","traces-to-sources","law-l5","insight-dedup","investigator-seam","honest-risk"] : [],
  sample: { insights: insights.map((i) => ({ kind: i["holo:kind"], text: i["schema:text"], conf: i["holo:confidence"], evidence: i["holo:evidence"].length, sources: i["prov:wasDerivedFrom"].length })) },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-insight-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-insight witness — S4 the + REFLEX (ingest → Q investigates unbidden → insight κs)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  insights produced with ZERO user input:`);
for (const i of insights) console.log(`    · [${i["holo:kind"]}] ${i["schema:text"]}  (conf ${i["holo:confidence"].toFixed(2)}, ${i["prov:wasDerivedFrom"].length} src)`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the + investigates on its own and surfaces provenance-backed insights — no query" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
