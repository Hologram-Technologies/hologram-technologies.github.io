// holo-plus.mjs — "THE +" in one call. The orchestrator the UI invokes: drop any sources in, get back a deduped
// κ-hypergraph, proactive insights, a brief, and the whole thing as one pinnable investigation κ-DAG — with NO
// query. It ties the witnessed layers together (Port S0/S7 → Map S1/S2 → Reason S4 → Brief S6 → Investigation S8)
// and exposes every intelligence as a SWAPPABLE SEAM so the same call runs on the deterministic baselines (no GPU)
// OR, when present, on Q's real zero-shot brain and the live inbox/voice — graceful upgrade, never a hard dependency.
//
// runPlus(inputs, opts) — inputs: [{ name, bytes, mime }]. opts:
//   adapters       — per-family encoders (video→Holo Tube, audio→Moonshine, …); absent → native/raw fallback.
//   extract        — entity/relationship extractor (default heuristic; pass makeQExtractor(brain).bound for Q).
//   investigators  — insight investigators (default baseline; pass { q: makeQInvestigator(brain).qInsights } for Q).
//   tap            — a telemetry tap (observeIngest) to fire the perception signal (S3); absent → no signal.
//   sink           — an inbox/voice delivery sink (S6); absent → brief returned but not pushed.
//   title, hash, now — cosmetic / injectable determinism.
// Returns { graph, insights, brief, investigation, signal, delivery, sources, kappas, coverage }.

import { makeRouter } from "./holo-ingest.mjs";
import { extractGraph, mergeGraphs } from "./holo-map.mjs";
import { investigate } from "./holo-insight.mjs";
import { composeBrief, deliver } from "./holo-brief.mjs";
import { composeInvestigation } from "./holo-investigation.mjs";
import { sha256hex } from "./holo-uor.mjs";

const enc = new TextEncoder();

export async function runPlus(inputs = [], { adapters = {}, extract, investigators, context = null, rankScorer = undefined, tap = null, sink = null, title = "What the + found", hash = sha256hex, now = () => 0 } = {}) {
  const router = makeRouter({ adapters, hash, now });
  const graphs = [], sources = [], allKappas = [], routedAll = [];
  const sourceBytes = new Map();   // graph source-anchor κ → the bytes that re-derive it (for verify/provenance)

  for (const input of inputs) {
    const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes || 0);
    const routed = await router.route({ name: input.name, bytes, mime: input.mime });
    routedAll.push(routed);
    for (const k of routed.kappas) allKappas.push(k);
    if (routed.textView) {
      // the graph derives from the decoded TEXT VIEW; its κ is the evidence anchor insights will cite, and it
      // re-derives from the canonical UTF-8 of that text (true for both the native path and adapter transcripts).
      const anchor = routed.textView.kappa;
      sourceBytes.set(anchor, enc.encode(routed.textView.text));
      sources.push(anchor);
      graphs.push(extractGraph({ text: routed.textView.text, sourceKappa: anchor, extract }, { hash }));
    } else if (routed.kappas[0]) {
      sources.push(routed.kappas[0]);   // raw/binary: no text to map, but the κ is recorded for the pin set
    }
  }

  const graph = mergeGraphs(graphs, { hash });
  let insights = await investigate(graph, { investigators, hash, context });      // A2: context → investigator
  if (context) { const { rankByContext } = await import("./holo-plus-context.mjs"); insights = rankByContext(insights, context, { scorer: rankScorer }); }  // A3: rank to the now
  const brief = composeBrief({ graph, insights, title, now }, { hash });
  const investigation = composeInvestigation({ title, sources, graph, insights, brief, now }, { hash });

  const signal = tap ? await tap.observeIngest(graph) : null;                 // S3 perception signal (no query)
  const delivery = sink ? await deliver(brief, { sink, graph, sourceBytes, rehash: hash }) : null;  // S6 proactive push

  return { graph, insights, brief, investigation, signal, delivery, sources, sourceBytes, context, kappas: allKappas, coverage: router.coverage(), routed: routedAll };
}

// bindQ(brain) → { extract, investigators } wired to Q's zero-shot .holo brain (browser). Pass these into runPlus
// to upgrade extraction + insight quality. If brain is absent/falsey, returns {} → runPlus uses the baselines.
export async function bindQ(brain) {
  if (!brain) return {};
  const { makeQExtractor } = await import("./holo-map.mjs");
  const { makeQInvestigator } = await import("./holo-insight.mjs");
  return { extract: makeQExtractor(brain), investigators: { q: (g) => makeQInvestigator(brain).qInsights(g) } };
}

export default { runPlus, bindQ };
