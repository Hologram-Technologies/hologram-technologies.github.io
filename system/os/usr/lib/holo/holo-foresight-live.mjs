// holo-foresight-live.mjs — PROOF OF FORESIGHT, in one call. The live loop the UI invokes: take what the
// operator privately knows (THE +'s κ-hypergraph) and the crowd's read-only price (holo-foresight-feed),
// form the belief with the best reader present (Q on-device, else the deterministic baseline), keep only the
// markets where I disagree with the crowd, and commit each belief to the source chain the moment it forms.
// One door in, signals + tamper-evident proofs out — acting on a signal stays a SEPARATE, human-gated step.
//
// Mirrors holo-plus.bindQ: every intelligence is a SWAPPABLE SEAM with a graceful upgrade, never a hard
// dependency. No brain → the baseline reader (Node-runnable, no GPU). No strand → scan only (zero side
// effects). The + chain (runPlus) is a LAZY import inside run(), so this module loads in Node when you feed
// it a graph directly (the witness path) without dragging the whole ingest stack. Pure ESM, isomorphic.

import { makeForesight } from "./holo-foresight.mjs";
import { makeBaselineReader, makeQReader } from "./holo-foresight-graph.mjs";

// bindForesight(brain) → the belief reader. Q's on-device zero-shot reader when a brain is present, else the
// deterministic baseline over the same real graph. This is the one place "auto" resolves which mind reads me.
export function bindForesight(brain) {
  return brain ? makeQReader(brain) : makeBaselineReader();
}

// makeLiveForesight({ brain, strand, threshold, now }) → the bound loop.
//   watch(graph, markets, opt)  — scan a graph against markets and commit signals (the core live tick).
//   run({ inputs, graph, markets, plus, feed }) — end-to-end: build the graph from THE + (if `graph` absent;
//       lazy runPlus over `inputs`) and the markets from the read-only feed (if `markets` absent), then watch.
//   proofs({ since }) — the committed track record on the chain.
export function makeLiveForesight({ brain = null, strand = null, threshold = 0.1, now = () => "1970-01-01T00:00:00Z" } = {}) {
  const read = bindForesight(brain);
  const fs = makeForesight({ read, strand, threshold, now });

  const watch = (graph, markets, opt) => fs.scanAndCommit(markets || [], graph || [], opt);

  async function run({ inputs = [], graph = null, markets = null, plus = {}, feed = {} } = {}) {
    let g = graph;
    if (!g) { const { runPlus } = await import("./holo-plus.mjs"); g = (await runPlus(inputs, plus)).graph; }
    let m = markets;
    if (!m) { const { fetchMarkets } = await import("./holo-foresight-feed.mjs"); m = await fetchMarkets(feed); }
    return { ...(await fs.scanAndCommit(m, g, {})), graph: g, markets: m };
  }

  return { reader: read, foresight: fs, watch, run, proofs: fs.proofs };
}

export default { bindForesight, makeLiveForesight };
