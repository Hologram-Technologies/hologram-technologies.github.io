// holo-graph-analytics.mjs — Stage-8 P3: the graph ANALYTICS (communities + influence) that the upstream stack
// uses Memgraph+MAGE for — but computed ON-DEVICE, in milliseconds, over the κ graph. At personal scale (hundreds
// to low-thousands of people) a graph-database container is overkill: label propagation + weighted PageRank are a
// few lines each and run instantly with zero infrastructure — SIMPLER and MORE SOVEREIGN (no server, no container).
// Memgraph (fed by holo-graph-cypher) remains the optional SCALE-OUT path for huge graphs; this is the default.
//
// The native graph is ego-centric (you → people) + group hyperedges; this module reconstructs PERSON↔PERSON
// structure from shared group membership, so communities/influence are meaningful. Pure, deterministic, isomorphic.

const ME = "__me__";

// buildAdjacency(nodes, links) → { adj:Map(κ→Map(κ→weight)), me } — a weighted undirected graph:
//   you↔person (interaction weight) + person↔person (they share ≥1 group). co-member links carry membership.
export function buildAdjacency(nodes = [], links = [], opts = {}) {
  const adj = new Map();
  const add = (a, b, w) => { if (a === b) return; if (!adj.has(a)) adj.set(a, new Map()); const m = adj.get(a); m.set(b, (m.get(b) || 0) + w); };
  // the operator's own κ is the SOURCE of the you→person edges; detect it so we can fold it to the ego node ME and,
  // crucially, EXCLUDE the ego's own me→group "co-member" edge from group membership (else you'd be a member of
  // every group → you'd wire all your clusters together and they'd collapse into one community).
  let meKappa = opts.meKappa || null;
  if (!meKappa) for (const l of links) if (l.predicate !== "co-member") { meKappa = l.source; break; }
  const groups = new Map();   // groupκ → Set(memberκ)
  for (const l of links) {
    if (l.predicate === "co-member") { if (l.source === meKappa) continue; if (!groups.has(l.target)) groups.set(l.target, new Set()); groups.get(l.target).add(l.source); continue; }
    const w = (l.meta && l.meta.weight) || 0.01;
    const src = (l.source === meKappa || !l.source) ? ME : l.source;
    add(src, l.target, w); add(l.target, src, w);
  }
  for (const members of groups.values()) {
    const ms = [...members].sort();
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) { add(ms[i], ms[j], 1); add(ms[j], ms[i], 1); }
  }
  // make sure every node exists in adj even if isolated (so analytics covers them)
  for (const n of nodes) if (!adj.has(n.kappa)) adj.set(n.kappa, new Map());
  return { adj, me: ME };
}

// communities(adj) — DETERMINISTIC weighted label propagation. Each node adopts the strongest label among its
// neighbours; ties break to the smallest label id; nodes processed in sorted order → identical result every run.
export function communities(adj) {
  const ids = [...adj.keys()].sort();
  const label = new Map(ids.map((k, i) => [k, i]));
  for (let iter = 0; iter < 30; iter++) {
    let changed = false;
    for (const k of ids) {
      const nb = adj.get(k); if (!nb || !nb.size) continue;
      const tally = new Map();
      for (const [n, w] of nb) tally.set(label.get(n), (tally.get(label.get(n)) || 0) + w);
      let best = label.get(k), bestW = tally.get(best) || 0;
      for (const [lab, w] of tally) if (w > bestW || (w === bestW && lab < best)) { best = lab; bestW = w; }
      if (best !== label.get(k)) { label.set(k, best); changed = true; }
    }
    if (!changed) break;
  }
  // renumber labels 0..n-1 in first-seen (sorted) order → stable, small ids
  const remap = new Map(); let c = 0;
  const community = new Map();
  for (const k of ids) { const l = label.get(k); if (!remap.has(l)) remap.set(l, c++); community.set(k, remap.get(l)); }
  return { community, count: c };
}

// influence(adj) — weighted PageRank: who is central in YOUR world (interaction-weighted, group-bridged).
export function influence(adj, { damping = 0.85, iters = 50 } = {}) {
  const ids = [...adj.keys()].sort(); const N = ids.length || 1;
  const outW = new Map(ids.map((k) => [k, [...(adj.get(k) || new Map()).values()].reduce((s, w) => s + w, 0)]));
  let pr = new Map(ids.map((k) => [k, 1 / N]));
  for (let it = 0; it < iters; it++) {
    const next = new Map(ids.map((k) => [k, (1 - damping) / N]));
    for (const k of ids) { const nb = adj.get(k), ow = outW.get(k) || 0; if (!nb || !ow) continue;
      for (const [n, w] of nb) next.set(n, next.get(n) + damping * pr.get(k) * (w / ow)); }
    pr = next;
  }
  return pr;   // Map(κ → score)
}

// analyze(nodes, links) → everything the Studio overlay needs, in one pass.
export function analyze(nodes = [], links = [], opts = {}) {
  const { adj, me } = buildAdjacency(nodes, links, opts);
  // EGO-NETWORK analysis: the ego (you) connects to everyone, so including you would merge ALL communities into one
  // and dominate centrality. Analyse the ALTER graph (person↔person only) — you are the viewer, not a data point.
  const padj = new Map();
  for (const [k, nb] of adj) { if (k === me) continue; const m = new Map(); for (const [n, w] of nb) if (n !== me) m.set(n, w); padj.set(k, m); }
  const { community, count } = communities(padj);
  const inf = influence(padj);
  const sizes = new Map();
  for (const c of community.values()) sizes.set(c, (sizes.get(c) || 0) + 1);
  return { me, community, communityCount: count, influence: inf, communitySizes: sizes };
}
