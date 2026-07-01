// holo-rank.mjs — HoloRank: a hologram-native, personal PageRank over the UOR object
// graph (the trust layer the W3C stack left unfinished — A7). It is to Google's PageRank
// what content addressing is to URLs: votes are for immutable content (κ), are attributable
// (signed assertions), are weighted by a trust eigenvector, and the RESULT is itself a
// self-verifying UOR object — anyone re-derives the same rank from the same κ-set (Law L5).
//
// WHY a new edge type (the structural crux). The UOR `links` of holo-object.mjs are a
// containment Merkle-DAG: acyclic BY CONSTRUCTION (a cycle needs a hash to depend on itself
// — pre-image-impossible). PageRank is fundamentally cyclic (the recursive random walk). So
// HoloRank does NOT run on `links`. It runs on a SECOND class of edge — a *reference* edge —
// published as its OWN content-addressed UOR object, embedded in neither endpoint. Because
// neither endpoint's κ contains the other, reference edges may form cycles. Two graphs, one
// substrate: containment = structure (acyclic), reference = votes (cyclic, ranked here).
//
// An edge is a UOR object → content-addressed (immutable, tamper-evident) and, once A7
// (VC Data Integrity) lands, cryptographically attributable to `by` (a did:key). HoloRank
// treats `by` as the trust principal; proof verification is an injectable seam (verifyProof).
//
// Pure + dependency-free: imports ONLY holo-object.mjs (which is ONLY holo-uor.mjs). Mints
// no vocabulary — edges are schema:Review + prov:Entity, results are prov:Entity + schema:
// Dataset (ADR-024: mint nothing where a W3C term exists). The browser mirror is _shared/
// holo-rank.js (async address, exactly as holo-object.js mirrors this file).

import { makeObject, seal, verify, address, resolve, put, UOR_CONTEXT } from "./holo-object.mjs";

// ── canonical field keys (JSON-LD terms; no bespoke vocab) ────────────────────────────────
const F = { by: "prov:wasAttributedTo", to: "schema:itemReviewed", from: "prov:wasDerivedFrom",
            rel: "rel", weight: "schema:reviewRating", at: "dcterms:created" };

// default per-relation weight θ — provenance/derivation is the strongest objective signal,
// raw mention the weakest. Negative relations (refutes) are NOT part of the stochastic walk
// (they would break sub-stochasticity); they are surfaced separately. θ ≥ 0 always.
export const THETA = Object.freeze({ wasDerivedFrom: 1.0, cites: 0.7, endorses: 0.6, mentions: 0.3, refutes: 0.0 });

// makeEdge: a reference edge as its OWN content-addressed UOR object. `from`/`to` are κ
// (did:holo) of the voting and voted-for objects; the issuer is `by` (a did:key). Pass a
// `signer` (holo-vc.mjs) to ATTACH a W3C Data Integrity proof — then `by` is the signer's
// did:key and the edge is provably attributable (A7); the κ commits to the proof too.
export function makeEdge(store, { rel, from, to, by, weight = 1, at = 0, proof = null, signer = null }) {
  const props = { [F.rel]: rel, [F.from]: from, [F.to]: to, [F.by]: signer ? signer.did : by, [F.weight]: weight, [F.at]: at };
  if (signer) {                                                         // sign the unsecured doc, then seal (κ over content+proof)
    const doc = { "@context": [...UOR_CONTEXT], "@type": ["schema:Review", "prov:Entity"], ...props };
    return put(store, { ...doc, proof: signer.sign(doc) });
  }
  return makeObject(store, { type: ["schema:Review", "prov:Entity"], ...props, ...(proof ? { proof } : {}) });
}
const edgeView = (e) => ({ rel: e[F.rel], from: e[F.from], to: e[F.to], by: e[F.by],
                           weight: e[F.weight], at: e[F.at] });

// ── EigenTrust: a trust eigenvector over ISSUERS (did:key), seeded on whom YOU pre-trust ───
// vouches: issuer→issuer trust assertions [{from,to,weight}] (own edge corpus, rel:"vouches").
// pre: Map issuer→prior (your seed of trust, normalized). Returns Map issuer→τ in [0,1].
// τ(unknown issuer) defaults to `floor` so out-of-trust-closure Sybils are near-zero.
export function eigenTrust(issuers, vouches = [], pre = new Map(), { mix = 0.85, iters = 50, tol = 1e-9, floor = 1e-4 } = {}) {
  const ids = [...new Set([...issuers, ...vouches.flatMap((v) => [v.from, v.to]), ...pre.keys()])];
  if (!ids.length) return new Map();
  const p = new Map(ids.map((i) => [i, 0]));
  let ps = 0; for (const [k, v] of pre) if (p.has(k)) { p.set(k, Math.max(0, v)); ps += Math.max(0, v); }
  if (ps === 0) for (const i of ids) p.set(i, 1 / ids.length); else for (const i of ids) p.set(i, p.get(i) / ps);
  // row-normalized local trust C[i][j]; a non-vouching issuer falls back to the prior p.
  const out = new Map(ids.map((i) => [i, new Map()]));
  for (const v of vouches) { const w = Math.max(0, v.weight ?? 1); if (w) out.get(v.from).set(v.to, (out.get(v.from).get(v.to) || 0) + w); }
  const C = new Map();
  for (const i of ids) { const row = out.get(i); let s = 0; for (const w of row.values()) s += w;
    C.set(i, s > 0 ? new Map([...row].map(([j, w]) => [j, w / s])) : null); }       // null → use prior
  let t = new Map(p);
  for (let k = 0; k < iters; k++) {
    const nt = new Map(ids.map((i) => [i, (1 - mix) * p.get(i)]));
    for (const i of ids) {                                                           // distribute t[i] over C[i] (or prior)
      const row = C.get(i), ti = t.get(i);
      if (row) for (const [j, c] of row) nt.set(j, nt.get(j) + mix * ti * c);
      else for (const j of ids) nt.set(j, nt.get(j) + mix * ti * p.get(j));
    }
    let d = 0; for (const i of ids) d += Math.abs(nt.get(i) - t.get(i)); t = nt;
    if (d < tol) break;
  }
  for (const i of ids) if (t.get(i) < floor) t.set(i, floor);                         // never fully zero a known issuer
  return t;
}

// ── build the weighted reference graph from edge objects ───────────────────────────────────
// w(e) = weight · θ(rel) · τ(issuer) · decay(now − created). Trust-weighting is what makes
// the rank Sybil-resistant; θ encodes relation semantics; decay encodes freshness.
// verifyProof (optional, holo-vc.mjs): when supplied, an edge whose signature does NOT prove
// its issuer (unsigned, tampered, or impersonated) is neutralised — its weight collapses to ~0.
// This is the gate that turns content-addressing's integrity into Sybil-resistant attribution.
export function buildGraph(edges, { theta = THETA, trust = new Map(), now = 0, decay = () => 1, verifyProof = null } = {}) {
  const nodes = new Set(), out = new Map(), W = new Map();
  const add = (n) => { if (!out.has(n)) { out.set(n, []); W.set(n, 0); } nodes.add(n); };
  for (const raw of edges) {
    const e = edgeView(raw); if (!e.from || !e.to) continue;
    const th = theta[e.rel] ?? 0; if (th <= 0) continue;                              // non-walk relations skipped
    const attributed = !verifyProof || (raw.proof && verifyProof(raw));              // proven by `by`?
    const tau = !attributed ? 1e-6 : (trust.size ? (trust.get(e.by) ?? 1e-4) : 1);
    const w = (Number(e.weight) || 1) * th * tau * decay(now - (e.at || 0));
    if (w <= 0) continue;
    add(e.from); add(e.to); out.get(e.from).push({ to: e.to, w }); W.set(e.from, W.get(e.from) + w);
  }
  // canonicalize: sort each node's out-edges + re-sum its weight in that fixed order, so the
  // float arithmetic is independent of edge-arrival order → every peer derives identical scores.
  for (const [u, arr] of out) { arr.sort((a, b) => a.to < b.to ? -1 : a.to > b.to ? 1 : 0); let sw = 0; for (const e of arr) sw += e.w; W.set(u, sw); }
  return { nodes, out, W };
}

// ── Forward-Push approximate Personalized PageRank (Andersen–Chung–Lang) ────────────────────
// DETERMINISTIC + LOCAL + SCALE-INDEPENDENT. Each round it processes the residual frontier in
// canonical (sorted) order, so the float trajectory — and thus every score bit — is identical
// regardless of edge-arrival order or platform: millions of independent peers/agents re-derive
// the SAME result κ. Total pushes are bounded by ~1/(epsilon·alpha) (Andersen–Chung–Lang),
// INDEPENDENT of total graph size; only the reachable neighbourhood of the seed is ever touched
// (out.get(u) is read lazily on push), so per-query cost scales with YOUR closure, not the corpus.
export function forwardPushPPR(graph, seed, { d = 0.85, epsilon = 1e-6, maxPush = 1e6 } = {}) {
  const { nodes, out, W } = graph, alpha = 1 - d;
  const s = new Map(); const seeds = [...new Set(seed)].sort(); const sp = 1 / (seeds.length || 1);
  for (const n of seeds) { s.set(n, sp); nodes.add(n); if (!out.has(n)) { out.set(n, []); W.set(n, 0); } }
  const tele = [...s].sort((a, b) => a[0] < b[0] ? -1 : 1);                            // canonical dangling target
  const p = new Map(), r = new Map(s);                                                // estimate, residual
  let pushes = 0, active = true;
  while (active && pushes < maxPush) {
    active = false;
    const ready = [...r].filter(([, v]) => v >= epsilon).map(([k]) => k).sort();       // canonical frontier
    for (const u of ready) {
      const ru = r.get(u) || 0; if (ru < epsilon) continue;
      p.set(u, (p.get(u) || 0) + alpha * ru); r.set(u, 0); pushes++;
      const mass = (1 - alpha) * ru, wu = W.get(u) || 0;
      const spread = wu > 0 ? out.get(u).map(({ to, w }) => [to, mass * (w / wu)])     // follow out-edges
                            : tele.map(([to, sv]) => [to, mass * sv]);                 // dangling → teleport home
      for (const [v, dv] of spread) r.set(v, (r.get(v) || 0) + dv);
      active = true;
    }
  }
  let z = 0; for (const v of p.values()) z += v;                                       // normalize to a distribution
  return { scores: new Map([...p].map(([k, v]) => [k, z > 0 ? v / z : 0])), pushes, converged: pushes < maxPush };
}

// query: run the personalized walk over a PREBUILT graph (index). This is the scalable per-user
// entry — build the shared index once, then each of millions of queries costs O(reachable
// neighbourhood). Ranking ties break by node id so the order (and any committed κ) is deterministic.
export function query(graph, seed, { d = 0.85, epsilon = 1e-6 } = {}) {
  const { scores, pushes, converged } = forwardPushPPR(graph, seed, { d, epsilon });
  const ranking = [...scores].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([node, score]) => ({ node, score }));
  return { ranking, scores, pushes, converged, nodes: graph.nodes.size };
}

// personalRank: end-to-end convenience. edges (UOR objects) + your pins (seed κ) → ranked κ list.
export function personalRank(edges, seed, { vouches = [], preTrust = new Map(), theta = THETA,
                                            now = 0, decay = () => 1, d = 0.85, epsilon = 1e-6, verifyProof = null } = {}) {
  const issuers = new Set(edges.map((e) => e[F.by]).filter(Boolean));
  const trust = (vouches.length || preTrust.size) ? eigenTrust(issuers, vouches, preTrust) : new Map();
  const graph = buildGraph(edges, { theta, trust, now, decay, verifyProof });
  return { ...query(graph, seed, { d, epsilon }), trust };
}

// ── commitRank: the result as a self-verifying UOR object (verifiable PageRank) ─────────────
// Its κ commits to {algorithm + params + exact input-edge κ-set + teleport + ranking}. Anyone
// re-runs personalRank over the SAME edges and gets the SAME κ (Law L5). Tamper one score →
// the κ no longer re-derives → refused. This is the property Google's secret rank cannot offer.
export function commitRank(store, { ranking, edges, seed, params }) {
  return makeObject(store, {
    type: ["prov:Entity", "schema:Dataset"],
    "schema:name": "HoloRank — personal PageRank result",
    "prov:wasGeneratedBy": { "@type": "prov:Activity", algorithm: "forward-push-ppr", ...params },
    "prov:used": edges.map((e) => e.id).sort(),                                        // exact input edge κ-set
    teleport: [...seed].sort(),
    ranking,
  });
}

export const verifyRank = (obj) => verify(obj);                                        // Law L5 on the result

// ── recommend + neighbourhood (PURE; byte-identical to _shared/holo-rank.js, see web witness) ──
// These are crypto-free, so the SAME code runs in the browser (the Hub) and in Node (the MCP
// server) — an agent can pull its slice and rank it server-side in one round-trip.
const RATING_TO_STAR = (r) => Math.round((r || 0) / 20);
function reasonFor(recId, usageSet, byReviewer, apps) {
  if (!usageSet.size) return { kind: "popular", text: "Popular in the community" };
  const co = new Map();
  for (const rs of byReviewer.values()) {
    const rec = rs.find((x) => x.app_id === recId); if (!rec) continue;
    for (const x of rs) if (usageSet.has(x.app_id)) co.set(x.app_id, (co.get(x.app_id) || 0) + x.star * rec.star);
  }
  let best = null, bv = 0; for (const [u, v] of co) if (v > bv) { bv = v; best = u; }
  return best ? { kind: "because", app: best, text: `Because you use ${apps.get(best)?.name || best}` } : { kind: "foryou", text: "Recommended for you" };
}
export function recommend({ apps, reviews, usage = [], me = "did:holo:local:me", limit = 8 }) {
  const A = apps instanceof Map ? apps : new Map((apps || []).map((a) => [a.id, a]));
  const nodeToId = new Map([...A].map(([id, v]) => [v.node, id]));
  const usageSet = new Set(usage);
  const rev = (u) => `did:holo:user:${u}`;
  const edge = (rel, from, to, weight, at = 0) => ({ [F.rel]: rel, [F.from]: from, [F.to]: to, [F.by]: from, [F.weight]: weight, [F.at]: at });
  const edges = [], byReviewer = new Map();
  for (const r of reviews || []) {
    const to = A.get(r.app_id)?.node; if (!to) continue;
    const star = RATING_TO_STAR(r.rating); if (star < 1) continue;
    if (!byReviewer.has(r.user_hash)) byReviewer.set(r.user_hash, []);
    byReviewer.get(r.user_hash).push({ app_id: r.app_id, star });
    edges.push(edge("endorses", rev(r.user_hash), to, star, Date.parse(r.date_created) || 0));
  }
  let total = 0; const aff = new Map();
  for (const [u, rs] of byReviewer) { let a = 0; for (const x of rs) if (usageSet.has(x.app_id)) a += x.star; if (a > 0) { aff.set(u, a); total += a; } }
  const personalized = total > 0;
  if (personalized) for (const [u, a] of aff) edges.push(edge("follows", me, rev(u), a / total));
  else for (const u of byReviewer.keys()) edges.push(edge("follows", me, rev(u), 1));
  const { scores } = personalRank(edges, [me], { theta: { ...THETA, follows: 1.0 } });
  const recs = [];
  for (const [node, score] of [...scores].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
    const id = nodeToId.get(node); if (!id || usageSet.has(id)) continue;
    recs.push({ id, name: A.get(id).name, node, score, reason: reasonFor(id, usageSet, byReviewer, A) });
    if (recs.length >= limit) break;
  }
  return { recs, personalized, me };
}

// neighbourhood fetch — the planetary data path (see _shared/holo-rank.js for the full note).
export function expandNeighbourhood({ seedApps = [], reviewsByApp, reviewsByReviewer, budget = 4000 }) {
  const seen = new Set(), reviews = [], reviewers = new Set(); let fetches = 0;
  const cidOf = (r) => r.id || `${r.app_id}|${r.user_hash}`;
  const take = (list) => { for (const r of (list || [])) { const k = cidOf(r); if (!seen.has(k) && reviews.length < budget) { seen.add(k); reviews.push(r); } } };
  for (const a of new Set(seedApps)) { if (fetches >= budget) break; fetches++; const list = reviewsByApp(a) || []; take(list); for (const r of list) reviewers.add(r.user_hash); }
  if (reviewsByReviewer) for (const u of reviewers) { if (fetches >= budget) break; fetches++; take(reviewsByReviewer(u)); }
  return { reviews, fetches, reviewers: reviewers.size };
}

// ── no-network convergence self-test (idiom of holo-collab.selfTest) ────────────────────────
export function selfTest() {
  const store = new Map();
  const K = (h) => "did:holo:blake3:" + h.padEnd(64, "0");   // §1.2: self-test synthetic keys on the canonical axis
  const [A, B, C, D] = ["aa", "bb", "cc", "dd"].map(K);
  const me = "did:key:me", peer = "did:key:peer";
  const edges = [
    makeEdge(store, { rel: "cites", from: A, to: B, by: me }),
    makeEdge(store, { rel: "cites", from: B, to: C, by: me }),
    makeEdge(store, { rel: "cites", from: C, to: A, by: peer }),                       // cycle A→B→C→A
    makeEdge(store, { rel: "endorses", from: D, to: C, by: peer }),
  ];
  const r = personalRank(edges, [A], { preTrust: new Map([[me, 1]]) });   // D is unreachable from A → 3 ranked
  return r.converged && r.ranking.length === 3 && r.ranking[0].node === A && r.ranking[0].score > 0;
}
