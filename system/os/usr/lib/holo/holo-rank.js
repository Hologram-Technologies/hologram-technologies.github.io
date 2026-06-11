// _shared/holo-rank.js — browser mirror of holo-rank.mjs (the idiom of holo-object.js ↔
// holo-object.mjs). The ranking math (EigenTrust + Forward-Push PPR) is PURE and sync, so it
// is byte-identical to the canonical engine; only the κ-deriving steps (makeEdge / commitRank)
// are async here, using Web Crypto via holo-object.js. holo-rank-web-witness.mjs proves this
// file re-derives the SAME edge κ, the SAME ranking and the SAME result κ as the .mjs — no drift.
//
// What this enables: the Hub (and any holospace) computes a personal, verifiable PageRank in
// the tab — teleport from your pins, walk your trust graph, rank content by κ. window.HoloRank.

import { jcs, address, verify } from "./holo-object.js";

// canonical field keys + per-relation weights θ — IDENTICAL to holo-rank.mjs.
const F = { by: "prov:wasAttributedTo", to: "schema:itemReviewed", from: "prov:wasDerivedFrom",
            rel: "rel", weight: "schema:reviewRating", at: "dcterms:created" };
export const THETA = Object.freeze({ wasDerivedFrom: 1.0, cites: 0.7, endorses: 0.6, mentions: 0.3, refutes: 0.0 });

// the UOR envelope @context — copied verbatim from holo-object.mjs so a re-derived κ MATCHES
// (JCS sorts keys, so the κ is identical to the canonical engine's; the witness enforces it).
const UOR_CONTEXT = Object.freeze([
  "https://www.w3.org/ns/did/v1",
  "https://w3id.org/security/data-integrity/v2",
  { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", dcterms: "http://purl.org/dc/terms/",
    rel: "schema:additionalType", links: { "@id": "schema:hasPart", "@container": "@set" } },
]);
const hexOf = (did) => String(did).split(":").pop();
async function sealPut(store, obj) { const id = await address(obj); const sealed = { ...obj, id }; if (store) store.set(hexOf(id), jcs(sealed)); return sealed; }
async function makeObject(store, { type, context = [], ...props }) { return sealPut(store, { "@context": [...UOR_CONTEXT, ...context], "@type": type, ...props }); }

// makeEdge (async): a reference edge as its own content-addressed UOR object; pass a `signer`
// (a browser holo-vc with async .sign) to attach a W3C Data Integrity proof.
export async function makeEdge(store, { rel, from, to, by, weight = 1, at = 0, proof = null, signer = null }) {
  const props = { [F.rel]: rel, [F.from]: from, [F.to]: to, [F.by]: signer ? signer.did : by, [F.weight]: weight, [F.at]: at };
  if (signer) { const doc = { "@context": [...UOR_CONTEXT], "@type": ["schema:Review", "prov:Entity"], ...props }; return sealPut(store, { ...doc, proof: await signer.sign(doc) }); }
  return makeObject(store, { type: ["schema:Review", "prov:Entity"], ...props, ...(proof ? { proof } : {}) });
}
const edgeView = (e) => ({ rel: e[F.rel], from: e[F.from], to: e[F.to], by: e[F.by], weight: e[F.weight], at: e[F.at] });

// ── EigenTrust (pure, sync — identical to holo-rank.mjs) ─────────────────────────────────────
export function eigenTrust(issuers, vouches = [], pre = new Map(), { mix = 0.85, iters = 50, tol = 1e-9, floor = 1e-4 } = {}) {
  const ids = [...new Set([...issuers, ...vouches.flatMap((v) => [v.from, v.to]), ...pre.keys()])];
  if (!ids.length) return new Map();
  const p = new Map(ids.map((i) => [i, 0]));
  let ps = 0; for (const [k, v] of pre) if (p.has(k)) { p.set(k, Math.max(0, v)); ps += Math.max(0, v); }
  if (ps === 0) for (const i of ids) p.set(i, 1 / ids.length); else for (const i of ids) p.set(i, p.get(i) / ps);
  const out = new Map(ids.map((i) => [i, new Map()]));
  for (const v of vouches) { const w = Math.max(0, v.weight ?? 1); if (w) out.get(v.from).set(v.to, (out.get(v.from).get(v.to) || 0) + w); }
  const C = new Map();
  for (const i of ids) { const row = out.get(i); let s = 0; for (const w of row.values()) s += w; C.set(i, s > 0 ? new Map([...row].map(([j, w]) => [j, w / s])) : null); }
  let t = new Map(p);
  for (let k = 0; k < iters; k++) {
    const nt = new Map(ids.map((i) => [i, (1 - mix) * p.get(i)]));
    for (const i of ids) { const row = C.get(i), ti = t.get(i);
      if (row) for (const [j, c] of row) nt.set(j, nt.get(j) + mix * ti * c);
      else for (const j of ids) nt.set(j, nt.get(j) + mix * ti * p.get(j)); }
    let d = 0; for (const i of ids) d += Math.abs(nt.get(i) - t.get(i)); t = nt; if (d < tol) break;
  }
  for (const i of ids) if (t.get(i) < floor) t.set(i, floor);
  return t;
}

export function buildGraph(edges, { theta = THETA, trust = new Map(), now = 0, decay = () => 1, verifyProof = null } = {}) {
  const nodes = new Set(), out = new Map(), W = new Map();
  const add = (n) => { if (!out.has(n)) { out.set(n, []); W.set(n, 0); } nodes.add(n); };
  for (const raw of edges) {
    const e = edgeView(raw); if (!e.from || !e.to) continue;
    const th = theta[e.rel] ?? 0; if (th <= 0) continue;
    const attributed = !verifyProof || (raw.proof && verifyProof(raw));
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

// DETERMINISTIC + LOCAL + SCALE-INDEPENDENT (mirror of holo-rank.mjs): processes the residual
// frontier in canonical sorted order each round → bit-identical scores on every peer/agent
// regardless of edge order or platform; pushes bounded by ~1/(epsilon·alpha), touching only the
// seed's reachable neighbourhood, so per-query cost scales with your closure, not the corpus.
export function forwardPushPPR(graph, seed, { d = 0.85, epsilon = 1e-6, maxPush = 1e6 } = {}) {
  const { nodes, out, W } = graph, alpha = 1 - d;
  const s = new Map(); const seeds = [...new Set(seed)].sort(); const sp = 1 / (seeds.length || 1);
  for (const n of seeds) { s.set(n, sp); nodes.add(n); if (!out.has(n)) { out.set(n, []); W.set(n, 0); } }
  const tele = [...s].sort((a, b) => a[0] < b[0] ? -1 : 1);
  const p = new Map(), r = new Map(s); let pushes = 0, active = true;
  while (active && pushes < maxPush) {
    active = false;
    const ready = [...r].filter(([, v]) => v >= epsilon).map(([k]) => k).sort();
    for (const u of ready) {
      const ru = r.get(u) || 0; if (ru < epsilon) continue;
      p.set(u, (p.get(u) || 0) + alpha * ru); r.set(u, 0); pushes++;
      const mass = (1 - alpha) * ru, wu = W.get(u) || 0;
      const spread = wu > 0 ? out.get(u).map(({ to, w }) => [to, mass * (w / wu)]) : tele.map(([to, sv]) => [to, mass * sv]);
      for (const [v, dv] of spread) r.set(v, (r.get(v) || 0) + dv);
      active = true;
    }
  }
  let z = 0; for (const v of p.values()) z += v;
  return { scores: new Map([...p].map(([k, v]) => [k, z > 0 ? v / z : 0])), pushes, converged: pushes < maxPush };
}

// query: the scalable per-user entry — PPR over a PREBUILT graph (build index once, query millions
// of times, each O(reachable neighbourhood)). Ties break by node id for a deterministic order/κ.
export function query(graph, seed, { d = 0.85, epsilon = 1e-6 } = {}) {
  const { scores, pushes, converged } = forwardPushPPR(graph, seed, { d, epsilon });
  const ranking = [...scores].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([node, score]) => ({ node, score }));
  return { ranking, scores, pushes, converged, nodes: graph.nodes.size };
}

export function personalRank(edges, seed, { vouches = [], preTrust = new Map(), theta = THETA, now = 0, decay = () => 1, d = 0.85, epsilon = 1e-6, verifyProof = null } = {}) {
  const issuers = new Set(edges.map((e) => e[F.by]).filter(Boolean));
  const trust = (vouches.length || preTrust.size) ? eigenTrust(issuers, vouches, preTrust) : new Map();
  const graph = buildGraph(edges, { theta, trust, now, decay, verifyProof });
  return { ...query(graph, seed, { d, epsilon }), trust };
}

export async function commitRank(store, { ranking, edges, seed, params }) {
  return makeObject(store, { type: ["prov:Entity", "schema:Dataset"], "schema:name": "HoloRank — personal PageRank result",
    "prov:wasGeneratedBy": { "@type": "prov:Activity", algorithm: "forward-push-ppr", ...params },
    "prov:used": edges.map((e) => e.id).sort(), teleport: [...seed].sort(), ranking });
}
export const verifyRank = (obj) => verify(obj);   // async (Law L5)

export async function selfTest() {
  const store = new Map(), K = (h) => "did:holo:sha256:" + h.padEnd(64, "0");
  const [A, B, C] = ["aa", "bb", "cc"].map(K);
  const edges = [await makeEdge(store, { rel: "cites", from: A, to: B, by: "did:key:me" }),
    await makeEdge(store, { rel: "cites", from: B, to: C, by: "did:key:me" }),
    await makeEdge(store, { rel: "cites", from: C, to: A, by: "did:key:peer" })];
  const r = personalRank(edges, [A]);
  return r.converged && r.ranking.length === 3 && r.ranking[0].node === A && r.ranking[0].score > 0;
}

// ── recommend: a PRIVATE, content-addressed collaborative filter ────────────────────────────
// The most valuable feature of a media platform — "for you" — without the surveillance. From
// your LOCAL usage (the holospaces you've installed — which never leaves this device) it infers
// which reviewers share your taste, then ranks the apps THEY rate highly that you don't have
// yet. Pure + sync: personalRank reads only edge fields, so no κ-sealing / crypto is needed for
// the ranking — it runs identically in the tab and in the witness. Cold start (no usage) falls
// back to community-popular and sharpens automatically as you use the OS. Every recommendation
// carries a verifiable, human reason ("Because you use …") — transparent, not a black box.
const RATING_TO_STAR = (r) => Math.round((r || 0) / 20);
function reasonFor(recId, usageSet, byReviewer, apps) {
  if (!usageSet.size) return { kind: "popular", text: "Popular in the community" };
  const co = new Map();                                   // co-endorsement: who rated BOTH this and an app you use
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
  let total = 0; const aff = new Map();                   // taste affinity me→reviewer (LOCAL; never shared)
  for (const [u, rs] of byReviewer) { let a = 0; for (const x of rs) if (usageSet.has(x.app_id)) a += x.star; if (a > 0) { aff.set(u, a); total += a; } }
  const personalized = total > 0;
  if (personalized) for (const [u, a] of aff) edges.push(edge("follows", me, rev(u), a / total));
  else for (const u of byReviewer.keys()) edges.push(edge("follows", me, rev(u), 1));   // cold start: trust the crowd
  const { scores } = personalRank(edges, [me], { theta: { ...THETA, follows: 1.0 } });
  const recs = [];
  for (const [node, score] of [...scores].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
    const id = nodeToId.get(node); if (!id || usageSet.has(id)) continue;             // skip people + apps you already have
    recs.push({ id, name: A.get(id).name, node, score, reason: reasonFor(id, usageSet, byReviewer, A) });
    if (recs.length >= limit) break;
  }
  return { recs, personalized, me };
}

// ── O(1) κ-memo: Hologram run_memoized, the "trace/state" grain ───────────────────────────────
// A recommendation is a DETERMINISTIC function of (corpus κ-set, usage) → ranking. ODRS review
// ids are already content addresses, so recommendKey is a true content key: same inputs (in any
// order) → same key; any changed/added/removed review or install → a different key. recommendMemoized
// serves a hit with ZERO re-execution (O(1) restore) and CANNOT be stale — the key IS the content
// (Hologram: "deterministic work is never done twice"). The result still commits to its own κ via
// commitRank; this memo is the cheap front door that makes the experience feel instant.
const cid = (r) => r.id || `${r.app_id}|${r.user_hash}|${r.rating}|${r.date_created || ""}`;
function cyrb53(str, seed = 0) {                          // tiny stable 53-bit digest of the input set
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export function recommendKey(reviews, usage = []) {
  const rids = [...new Set((reviews || []).map(cid))].sort();
  const us = [...new Set(usage)].sort();
  return `rk1.${rids.length}.${us.length}.${cyrb53(rids.join(",") + "|" + us.join(","))}`;
}
export function recommendMemoized(args, cache, { cap = 256 } = {}) {
  const key = recommendKey(args.reviews, args.usage);
  if (cache && cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return { ...v, key, restored: true }; } // LRU touch
  const out = recommend(args);
  const rec = { recs: out.recs, personalized: out.personalized };
  if (cache) { cache.set(key, rec); while (cache.size > cap) cache.delete(cache.keys().next().value); } // bounded (LRU evict oldest)
  return { ...rec, key, restored: false };
}

// ── neighbourhood fetch: the planetary data path ────────────────────────────────────────────
// You never hold the whole corpus. From your usage you fetch only YOUR slice, by content
// address, BOUNDED: hop 0 = reviews of the apps you use → the reviewers who share your taste;
// hop 1 = those reviewers' other reviews → your candidate apps. Reviewers with no taste overlap
// are never fetched, so the slice is O(your closure), not O(corpus). Transport-agnostic: the
// fetchers read the local ReviewStore today and a κ-addressed remote (holo-ipfs / κ pub/sub)
// tomorrow — same code. recommend() over this slice is LOSSLESS: only taste-aligned reviewers
// affect your personalized rank, and those are exactly what we fetched.
export function expandNeighbourhood({ seedApps = [], reviewsByApp, reviewsByReviewer, budget = 4000 }) {
  const seen = new Set(), reviews = [], reviewers = new Set();
  let fetches = 0;
  const cidOf = (r) => r.id || `${r.app_id}|${r.user_hash}`;
  const take = (list) => { for (const r of (list || [])) { const k = cidOf(r); if (!seen.has(k) && reviews.length < budget) { seen.add(k); reviews.push(r); } } };
  for (const a of new Set(seedApps)) { if (fetches >= budget) break; fetches++; const list = reviewsByApp(a) || []; take(list); for (const r of list) reviewers.add(r.user_hash); }   // hop 0
  if (reviewsByReviewer) for (const u of reviewers) { if (fetches >= budget) break; fetches++; take(reviewsByReviewer(u)); }                                                          // hop 1
  return { reviews, fetches, reviewers: reviewers.size };
}

if (typeof window !== "undefined") window.HoloRank = { THETA, makeEdge, eigenTrust, buildGraph, forwardPushPPR, query, personalRank, commitRank, verifyRank, recommend, recommendKey, recommendMemoized, expandNeighbourhood, selfTest };
