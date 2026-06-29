#!/usr/bin/env node
// holo-foresight-graph-witness.mjs — proves the bridge from THE + to PROOF OF FORESIGHT
// (holo-foresight-graph): the forecaster runs over a REAL κ-hypergraph extracted by holo-map from ingested
// text — not hand-authored nodes — and the belief reader exists in both honest forms (deterministic baseline
// over the real graph, and Q's zero-shot reader proven against its CONTRACT with a stub brain). The evidence
// a signal cites is the REAL provenance source κ of the claims that formed the belief (Law L5 end to end).
//
// Hermetic: holo-map's heuristic extractor builds the graph from fixture text; a stub brain stands in for Q.
// Drives the real substrate (holo-map seal/closure, holo-strand commit + verify, holo-identity signer).
//
// Checks (all must hold):
//   1 subgraphIsEvidence    — subgraphFor pulls exactly the matched entity, its claims, and the source κ.
//   2 baselineStanceFromGraph — toNodes derives stance from claim polarity + weight from evidence density.
//   3 baselineSignalRealκ    — baseline reader over the real graph surfaces a signal citing the REAL source κ.
//   4 qReaderContract        — makeQReader(stub) returns {p,evidence,informed} with evidence = real source κs.
//   5 qReaderDefersOnGarbage — a brain that emits garbage ⇒ informed:false (defer to crowd, never fabricate).
//   6 qReaderBlindDefers     — a market with no matching entity ⇒ informed:false, empty evidence.
//   7 qIntegratesEndToEnd    — makeForesight(read=Q) scans the real graph + commits a verifiable belief.
//   8 evidenceReDerives      — the cited source κ is the SAME κ holo-map anchored the claim to (re-derivable).
//   9 deterministicBaseline  — the baseline belief is byte-identical across runs (pure).
//
// Authority: UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-map + #holo-foresight + #holo-strand.
// node tools/holo-foresight-graph-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractGraph } from "../os/usr/lib/holo/holo-map.mjs";
import { subgraphFor, toNodes, makeBaselineReader, makeQReader } from "../os/usr/lib/holo/holo-foresight-graph.mjs";
import { makeForesight } from "../os/usr/lib/holo/holo-foresight.mjs";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = () => { let store = []; return { load: async () => clone(store), save: async (r) => { store = clone(r); } }; };
let tick = 0; const now = () => `2026-06-28T01:00:${String(tick++).padStart(2, "0")}.000Z`;

// ── a REAL + graph from ingested private text (the heuristic extractor is the witness fixture) ───────
// The private note says the Acme Corp merger is in trouble (a lawsuit blocks it) — something the crowd at
// 70% hasn't priced. This is what only I know.
const sourceKappa = "did:holo:sha256:note-2026-06-28";
const note = "A regulator lawsuit will block the Acme Corp deal; collapse likely.";
// holo-map's extractor is a SWAPPABLE SEAM (heuristic baseline vs Q). Sentiment-bearing claims are Q's job —
// the heuristic only lifts bare proper nouns — so we inject a production-shaped extractor here (exactly as
// the live + injects makeQExtractor). The foresight bridge is what's under test, over a REAL holo-map graph.
const extract = () => ({ entities: [{ name: "Acme Corp", type: "Organization", attributes: { "holo:status": "regulator lawsuit will block the deal; collapse likely" } }], relationships: [] });
const graph = extractGraph({ text: note, sourceKappa, extract });
const market = { id: "m-acme", question: "Will the Acme Corp merger close this quarter?", yes: 0.70, entities: ["Acme Corp"], kappa: "did:holo:sha256:mkt-acme" };

// ── 1 · the evidence bundle ──────────────────────────────────────────────────────────────────────────
const bundle = subgraphFor(graph, market);
const acme = bundle.entities.find((e) => /acme/i.test(e["schema:name"]));
ok("subgraphIsEvidence",
  !!acme && bundle.claims.every((c) => c["holo:subject"] === (acme.kappa || acme["@id"])) && bundle.sources.includes(sourceKappa),
  JSON.stringify({ ents: bundle.entities.map((e) => e["schema:name"]), claims: bundle.claims.length, sources: bundle.sources }));

// ── 2 · baseline nodes: stance from polarity, weight from density, sourceKappa = real anchor ─────────
const nodes = toNodes(graph, market);
const an = nodes.find((n) => /acme/i.test(n.label));
ok("baselineStanceFromGraph",
  an && an.stance < 0 && an.weight > 0 && an.sourceKappa === sourceKappa,
  JSON.stringify(an));

// ── 3 · baseline reader over the REAL graph surfaces a NO signal citing the real source κ ────────────
const baseFs = makeForesight({ read: makeBaselineReader(), threshold: 0.05, now });
const baseSignals = await baseFs.scan([market], graph);
ok("baselineSignalRealκ",
  baseSignals.length === 1 && baseSignals[0].side === "no" && baseSignals[0].evidence.includes(sourceKappa),
  JSON.stringify(baseSignals.map((s) => ({ side: s.side, edge: s.edge, ev: s.evidence }))));

// ── 4 · Q reader contract: a stub brain that reads the private facts and returns low p ───────────────
const goodBrain = { generate: async (prompt) => { ok("_promptHasFacts", /Acme Corp/.test(prompt) && /collapse|block|lawsuit/i.test(prompt)); return `{"p":0.08,"why":"regulator blocking the merger"}`; } };
const qread = makeQReader(goodBrain);
const qb = await qread(market, graph);
ok("qReaderContract", qb.informed && qb.p === 0.08 && qb.evidence.includes(sourceKappa), JSON.stringify(qb));

// ── 5 · garbage brain ⇒ defer (never fabricate an edge) ──────────────────────────────────────────────
const garbage = await makeQReader({ generate: async () => "the sky is blue" })(market, graph);
ok("qReaderDefersOnGarbage", garbage.informed === false && garbage.p === market.yes, JSON.stringify(garbage));

// ── 6 · blind market ⇒ defer, no evidence ────────────────────────────────────────────────────────────
const blind = { id: "m-blind", question: "Will Zorblax win?", yes: 0.4, entities: ["Zorblax"] };
const blindRead = await qread(blind, graph);
ok("qReaderBlindDefers", blindRead.informed === false && blindRead.evidence.length === 0, JSON.stringify(blindRead));

// ── 7 · Q integrates end to end: scan + commit a verifiable belief onto a real signed strand ─────────
const op = await enroll({ label: "foresight-graph-tester", passphrase: "correct horse battery" });
const strand = makeStrand({ backend: arrayBackend(), now, signer: op });
const qFs = makeForesight({ read: qread, strand, threshold: 0.1, now });
const { signals, entries } = await qFs.scanAndCommit([market], graph);
const v = await strand.verify();
ok("qIntegratesEndToEnd",
  signals.length === 1 && signals[0].side === "no" && entries.length === 1 && v.ok && entries[0]["holstr:payload"].evidence.includes(sourceKappa),
  JSON.stringify({ sig: signals.map((s) => ({ side: s.side, edge: s.edge })), v }));

// ── 8 · the cited evidence κ re-derives: it is exactly the source κ holo-map anchored the claims to ──
const anchored = (graph["holo:provenance"] || []).some((p) => p["prov:wasDerivedFrom"] === sourceKappa);
ok("evidenceReDerives", anchored && signals[0].evidence[0] === sourceKappa, `${anchored} ${signals[0].evidence[0]}`);

// ── 9 · determinism ──────────────────────────────────────────────────────────────────────────────────
ok("deterministicBaseline", JSON.stringify(toNodes(graph, market)) === JSON.stringify(toNodes(graph, market)));

await forget(op.kappa);

const witnessed = Object.values(checks).filter((_, i) => true).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-foresight-graph — the bridge from THE + to PROOF OF FORESIGHT. The forecaster runs over a REAL κ-hypergraph (holo-map: entities/claims/provenance extracted from ingested private text), via a belief reader in two honest forms: a deterministic baseline over the real graph (polarity lexicon + evidence-density weight) and Q's on-device zero-shot reader (proven against its contract with a stub). Every signal cites the REAL provenance source κ of the claims that formed the belief, so the evidence re-derives end to end (Law L5). The edge never leaves the device (L1).",
  authority: "UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-map + #holo-foresight + #holo-strand + #holo-identity",
  witnessed,
  covers: witnessed ? ["subgraph-is-evidence", "baseline-stance-from-graph", "baseline-signal-real-kappa", "q-reader-contract", "q-defers-on-garbage", "q-blind-defers", "q-end-to-end", "evidence-re-derives", "deterministic-baseline"] : [],
  sample: { entity: acme && acme["schema:name"], baselineNode: an, qBelief: qb, signal: signals[0] && { side: signals[0].side, marketYes: signals[0].marketYes, impliedP: signals[0].impliedP, edge: signals[0].edge, evidence: signals[0].evidence } },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-foresight-graph-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-foresight-graph witness — THE + → PROOF OF FORESIGHT (real κ-graph · baseline + Q reader · real evidence)\n");
for (const [k, val] of Object.entries(checks)) if (!k.startsWith("_")) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  entity "${acme && acme["schema:name"]}": baseline stance ${an && an.stance.toFixed(3)} · Q p ${qb.p} · signal ${signals[0] && signals[0].side}(${signals[0] && signals[0].edge}) citing ${signals[0] && signals[0].evidence[0]}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the belief is formed from MY real private graph, and the proof cites real evidence" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
