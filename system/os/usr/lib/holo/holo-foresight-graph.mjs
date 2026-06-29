// holo-foresight-graph.mjs — the bridge from THE + to PROOF OF FORESIGHT. holo-foresight reads a flat node
// shape ({ label, stance, weight, sourceKappa }); the + produces a κ-hypergraph (holo-map: entities, claims,
// provenance). This module is the seam between them — and the home of the belief READER in both its forms:
//   • a DETERMINISTIC baseline reader over the real graph (Node-witnessable, no GPU) — honest about being
//     mechanics, not intelligence (a small polarity lexicon over the matched entity's claims); and
//   • makeQReader(brain) — the PRODUCTION reader: Q reasons zero-shot over the matched subgraph and the
//     market question to form MY private-implied probability, citing the same content-addressed evidence.
// Same split as holo-map's heuristicExtract vs makeQExtractor: the baseline proves the wiring re-derives;
// Q proves the answer is good. Pure ESM, isomorphic, hash-free (operates on κs already in the graph).

import { sourcesForClaim } from "./holo-map.mjs";
import { defaultRead } from "./holo-foresight.mjs";

const norm = (s) => String(s || "").trim().toLowerCase();
const uniq = (xs) => Array.from(new Set(xs));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ── subgraphFor — the EVIDENCE BUNDLE for a market: every + entity whose name matches a market entity,
// with that entity's outgoing claims and the source κs that attest them. This is exactly what a reader
// (baseline OR Q) gets to see — nothing about the market, only what I privately hold about its entities.
export function subgraphFor(graph, market) {
  const ents = uniq((market.entities || []).map(norm)).filter(Boolean);
  const entities = (graph["holo:entities"] || []).filter((e) => ents.includes(norm(e["schema:name"])));
  const keys = new Set(entities.map((e) => e.kappa || e["@id"]));
  const claims = (graph["holo:claims"] || []).filter((c) => keys.has(c["holo:subject"]));
  const sources = uniq(claims.flatMap((c) => sourcesForClaim(graph, c.kappa || c["@id"])));
  return { entities, claims, sources };
}

// ── the polarity lexicon — DETERMINISTIC baseline ONLY. A claim's predicate+object pushes the entity's
// stance toward YES (does it happen) or NO. Crude by design; the witness proves the bundle→stance→belief
// wiring re-derives, not that this lexicon is smart. Q replaces it wholesale. ─────────────────────────
const POS = /\b(approve\w*|win\w*|beat\w*|expand\w*|acquir\w*|merg\w*|close\w*|launch\w*|grow\w*|surg\w*|rais\w*|up|gain\w*|pass\w*|sign\w*|cut\w*)\b/i;
const NEG = /\b(reject\w*|block\w*|lawsuit\w*|decline\w*|miss\w*|collaps\w*|fail\w*|delay\w*|drop\w*|fall\w*|loss\w*|down|sue\w*|recall\w*|ban\w*|halt\w*)\b/i;

function claimPolarity(claim) {
  const text = `${claim["holo:predicate"] || ""} ${claim["holo:objectKind"] === "literal" ? claim["holo:object"] || "" : ""}`;
  let s = 0; if (POS.test(text)) s += 1; if (NEG.test(text)) s -= 1; return s;
}

// toNodes — map the real evidence bundle into the flat node shape defaultRead consumes. stance = net claim
// polarity (squashed); weight = evidence density (claims + corroborating sources, log-scaled so one loud
// source can't dominate); sourceKappa = the real provenance anchor. One node per matched entity.
export function toNodes(graph, market) {
  const { entities, claims } = subgraphFor(graph, market);
  return entities.map((e) => {
    const ek = e.kappa || e["@id"];
    const mine = claims.filter((c) => c["holo:subject"] === ek);
    const pol = mine.reduce((a, c) => a + claimPolarity(c), 0);
    const srcs = uniq(mine.flatMap((c) => sourcesForClaim(graph, c.kappa || c["@id"])));
    return {
      label: e["schema:name"],
      stance: clamp(Math.tanh(pol), -1, 1),
      weight: Math.log1p(mine.length) + 0.5 * Math.log1p(srcs.length),   // density, not loudness
      sourceKappa: srcs[0] || null,
    };
  });
}

// makeBaselineReader — a read(market, graph) seam that runs the deterministic baseline over the REAL + graph.
// (holo-foresight.defaultRead operates on flat nodes; this adapts the hypergraph to it.) Pass to makeForesight.
export function makeBaselineReader() {
  return (market, graph) => defaultRead(market, toNodes(graph, market));
}

// ── makeQReader — the PRODUCTION reader: Q forms MY private-implied probability from the matched subgraph
// and the market question, on-device. The edge never leaves the machine. Returns the same { p, evidence,
// rationale, informed } contract; evidence is the subgraph's real source κs (not the model's word). Brain
// contract: { generate(prompt) → string }. No subgraph or parse failure ⇒ informed:false → defer to crowd
// (never fabricate an edge; never throw). NOT Node-witnessed for QUALITY (needs a live brain) — the witness
// proves the CONTRACT with a stub. ─────────────────────────────────────────────────────────────────────
export function makeQReader(brain, { generate = "generate" } = {}) {
  const PROMPT = (market, bundle) => {
    const facts = bundle.claims.slice(0, 40).map((c) =>
      `- ${labelOf(bundle, c["holo:subject"])} ${c["holo:predicate"]} ${c["holo:objectKind"] === "entity" ? labelOf(bundle, c["holo:object"]) : c["holo:object"]}`).join("\n");
    return `You privately know these facts (yours alone):
${facts || "(none)"}

Question: ${market.question}
Given ONLY your private facts, estimate the probability (0..1) this resolves YES.
Return ONLY minified JSON: {"p":number,"why":string}`;
  };
  return async function read(market, graph) {
    const bundle = subgraphFor(graph, market);
    const evidence = uniq(bundle.sources);
    if (!bundle.entities.length) return { p: clamp(Number(market.yes) || 0, 0, 1), evidence: [], rationale: "no private signal", informed: false };
    try {
      const out = await brain[generate](PROMPT(market, bundle));
      const m = String(out).match(/\{[\s\S]*\}/);
      const j = JSON.parse(m ? m[0] : out);
      const p = Number(j.p);
      if (!Number.isFinite(p)) throw new Error("no p");
      return { p: clamp(p, 0, 1), evidence, rationale: String(j.why || "Q (private)"), informed: true };
    } catch { return { p: clamp(Number(market.yes) || 0, 0, 1), evidence, rationale: "Q read failed — deferring", informed: false }; }
  };
}

function labelOf(bundle, kappa) {
  const e = bundle.entities.find((x) => (x.kappa || x["@id"]) === kappa);
  return e ? e["schema:name"] : String(kappa || "").slice(0, 16);
}

export default { subgraphFor, toNodes, makeBaselineReader, makeQReader };
