// holo-social-graph.mjs — derive the user's SOVEREIGN SOCIAL GRAPH (nodes + weighted edges) from their
// interaction firehose, anchored 100% in the κ substrate. This is Stage-7 P1 of "your network on your own
// Holo Chain": the PURE, DETERMINISTIC fold that turns real interactions (across every connected platform)
// into a private hypergraph the user owns. It composes — it invents no new primitive:
//   • a node's identity κ  = address(its canonical merged identity)        (holo-object.mjs, Law L1/L2)
//   • edges → Links on a Perspective (a holo-strand)                          (project via holo-ad4m.mjs)
//
// THREE GUARANTEES (acceptance for P1):
//   1 · RE-DERIVABLE. The same events ALWAYS yield the same node κs and the same graph (Law L2) — so it is
//       cheap to recompute (holo-kmemo memoises it) and identical wherever it runs (Node · browser · SW).
//   2 · NEVER FABRICATES. An edge exists ONLY because real interactions created it, and every edge CITES the
//       source κ(s) of those interactions (Law-L5 provenance). No interaction ⇒ no edge.
//   3 · NO BLIND MERGE. The same human is collapsed to one node ONLY by a STRONG shared key (phone number /
//       handle) or a user-confirmed alias. Same-name-across-platforms is a SUGGESTION, never auto-applied.
//
// Pure ESM, isomorphic, dependency-injected nothing-browser. The only import is the substrate's content hash.

import { address } from "./holo-object.mjs";

// ── identity normalization ───────────────────────────────────────────────────────────────────────────
const normNumber = (s) => { const d = String(s || "").replace(/\D/g, ""); return d.length >= 7 ? d.slice(-12) : ""; };   // last ≤12 digits ≈ a stable phone key
const normHandle = (s) => String(s || "").trim().toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9._-]/g, "");
const normName   = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// STRONG keys uniquely identify a human across platforms (number > handle). WhatsApp jids are numbers; X/IG/
// LinkedIn carry handles. Two peers that share ANY strong key ARE the same node (deterministic, never wrong).
function strongKeys(peer = {}) {
  const ks = [];
  const num = normNumber(peer.number || peer.phone || (/^\d{7,}/.test(String(peer.id || "")) ? peer.id : ""));
  if (num) ks.push("num:" + num);
  const h = normHandle(peer.handle || peer.username);
  if (h) ks.push("handle:" + h);
  return ks;
}
// a WEAK key only groups events that gave no strong key (so every peer still becomes a node) — scoped to its
// platform so two different "John"s on the same platform stay together but never cross platforms by name alone.
const weakKey = (peer = {}, platform = "") => "name:" + platform + ":" + (normName(peer.name) || String(peer.id || "?"));

// ── union-find over peer keys → one component per human ────────────────────────────────────────────────
function makeUF() {
  const p = new Map();
  const find = (x) => { if (!p.has(x)) p.set(x, x); let r = x; while (p.get(r) !== r) r = p.get(r); while (p.get(x) !== r) { const n = p.get(x); p.set(x, r); x = n; } return r; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) p.set(ra < rb ? rb : ra, ra < rb ? ra : rb); };   // lexically-smallest root → deterministic
  return { find, union, has: (x) => p.has(x) };
}

// weight model: a relationship's strength is real interaction volume, decayed by recency, boosted by two-way
// reciprocity and channel diversity. All bounded + monotonic → stable, explainable, no magic.
function edgeWeight(e, nowMs, halfLifeDays = 30) {
  const ageDays = Math.max(0, (nowMs - e.lastTs) / 86400000);
  const recency = Math.pow(0.5, ageDays / halfLifeDays);              // exp decay, ~half every 30d
  const volume = Math.log2(1 + e.count);
  const tot = e.inCount + e.outCount;
  const reciprocity = tot ? (2 * Math.min(e.inCount, e.outCount)) / tot : 0;   // 0 one-way … 1 perfectly mutual
  const diversity = 1 + 0.1 * (e.channels.size - 1);
  return +(volume * recency * (0.5 + 0.5 * reciprocity) * diversity).toFixed(4);
}

const tsOf = (t) => (typeof t === "number" ? t : Date.parse(t) || 0);

// deriveGraph(events, opts) → { nodes, edges, groups, suggestions, stats }
//   event = { platform, peer:{id,name,handle?,number?,avatar?}, group?:{id,name,members?}, dir:"in"|"out",
//             ts, kind?, ref? }   — ref is the source κ / extId of the real message (provenance).
//   opts  = { meKappa, now?, aliases? }   aliases = [[keyA,keyB], …] user-confirmed cross-platform merges.
export function deriveGraph(events = [], opts = {}) {
  const me = opts.meKappa || "me";
  const nowMs = tsOf(opts.now) || (events.reduce((m, e) => Math.max(m, tsOf(e.ts)), 0) || 0);
  const uf = makeUF();

  // pass 1 — union peer keys into components (the same human)
  const peerKeys = (ev) => { const ks = strongKeys(ev.peer); return ks.length ? ks : [weakKey(ev.peer, ev.platform)]; };
  for (const ev of events) {
    if (ev.group) continue;
    const ks = peerKeys(ev); ks.forEach((k) => uf.find(k)); for (let i = 1; i < ks.length; i++) uf.union(ks[0], ks[i]);
    // group a group's known members too (so a member seen only in a group still gets a node)
  }
  for (const ev of events) for (const mem of (ev.group?.members || [])) { const ks = strongKeys(mem); if (ks.length) { ks.forEach((k) => uf.find(k)); for (let i = 1; i < ks.length; i++) uf.union(ks[0], ks[i]); } else uf.find(weakKey(mem, ev.platform)); }
  for (const [a, b] of (opts.aliases || [])) uf.union(a, b);   // user-confirmed merges

  // pass 2 — materialize nodes (component → canonical identity → stable κ)
  const comp = new Map();   // root → { keys:Set, names:Map<name,count>, platforms:Set, avatar, handles:Set, numbers:Set }
  const touch = (root) => { if (!comp.has(root)) comp.set(root, { keys: new Set(), names: new Map(), platforms: new Set(), avatar: null, handles: new Set(), numbers: new Set() }); return comp.get(root); };
  const absorb = (peer, platform) => {
    const ks = strongKeys(peer); const allk = ks.length ? ks : [weakKey(peer, platform)];
    const root = uf.find(allk[0]); const c = touch(root); allk.forEach((k) => c.keys.add(k));
    if (peer.name) c.names.set(normName(peer.name) ? peer.name : peer.name, (c.names.get(peer.name) || 0) + 1);
    if (platform) c.platforms.add(platform);
    if (peer.avatar && !c.avatar) c.avatar = peer.avatar;
    ks.forEach((k) => { if (k.startsWith("handle:")) c.handles.add(k.slice(7)); if (k.startsWith("num:")) c.numbers.add(k.slice(4)); });
    return root;
  };
  for (const ev of events) { if (!ev.group) absorb(ev.peer, ev.platform); for (const mem of (ev.group?.members || [])) absorb(mem, ev.platform); }

  const rootKappa = new Map();   // uf-root → node κ
  const nodes = new Map();       // node κ → node
  for (const [root, c] of comp) {
    const keys = [...c.keys].sort();
    const kappa = address({ t: "agent", keys });                 // identity κ from the SORTED key set → deterministic + merge-stable
    const name = [...c.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || keys[0];
    rootKappa.set(root, kappa);
    nodes.set(kappa, { kappa, name, platforms: [...c.platforms].sort(), handles: [...c.handles].sort(), numbers: [...c.numbers].sort(), avatar: c.avatar, weak: keys.every((k) => k.startsWith("name:")) });
  }
  const nodeOf = (peer, platform) => { const ks = strongKeys(peer); const allk = ks.length ? ks : [weakKey(peer, platform)]; return rootKappa.get(uf.find(allk[0])); };

  // pass 3 — fold edges (me → person) + group hyperedges, with provenance
  const edges = new Map();       // edgeKey → edge
  const groups = new Map();      // group κ → { kappa, name, platform, members:Set<nodeκ>, count, lastTs }
  const addProv = (arr, ref) => { if (ref && arr.length < 8 && !arr.includes(ref)) arr.push(ref); };
  for (const ev of events) {
    const ts = tsOf(ev.ts); const ch = ev.platform || "?";
    if (ev.group) {
      const gk = address({ t: "group", platform: ev.platform, gid: String(ev.group.id) });   // NB: NOT `id` — address() reserves+strips `id` (its own output field), which would collapse every group to one κ
      let g = groups.get(gk); if (!g) groups.set(gk, g = { kappa: gk, name: ev.group.name || "Group", platform: ev.platform, members: new Set(), count: 0, lastTs: 0, sources: [] });
      g.count++; g.lastTs = Math.max(g.lastTs, ts); addProv(g.sources, ev.ref);
      for (const mem of (ev.group.members || [])) { const nk = nodeOf(mem, ev.platform); if (nk) g.members.add(nk); }
      // a co-membership hyperedge: me ↔ group (and member↔group captured in g.members)
      foldEdge(edges, me, gk, "co-member", ev, ts, ch, addProv);
      continue;
    }
    const nk = nodeOf(ev.peer, ev.platform); if (!nk) continue;
    const predicate = ev.kind === "reply" ? "replied" : ev.kind === "react" ? "reacted" : ev.kind === "call" ? "called" : "messaged";
    foldEdge(edges, me, nk, predicate, ev, ts, ch, addProv);
  }
  for (const e of edges.values()) e.weight = edgeWeight(e, nowMs);

  // name-merge SUGGESTIONS (never auto-applied): distinct nodes on DIFFERENT platforms sharing a normalized name
  const byName = new Map();
  for (const n of nodes.values()) { const nn = normName(n.name); if (!nn) continue; (byName.get(nn) || byName.set(nn, []).get(nn)).push(n); }
  const suggestions = [];
  for (const [nn, group] of byName) if (group.length > 1) {
    const platforms = new Set(group.flatMap((n) => n.platforms));
    if (platforms.size > 1) suggestions.push({ reason: "same-name-across-platforms", name: group[0].name, nodes: group.map((n) => n.kappa), platforms: [...platforms].sort() });
  }

  const stats = { nodes: nodes.size, edges: edges.size, groups: groups.size, suggestions: suggestions.length, events: events.length };
  return { me, nodes, edges, groups, suggestions, stats };
}

function foldEdge(edges, source, target, predicate, ev, ts, ch, addProv) {
  const key = source + "|" + predicate + "|" + target;
  let e = edges.get(key);
  if (!e) edges.set(key, e = { source, target, predicate, count: 0, inCount: 0, outCount: 0, firstTs: ts, lastTs: 0, channels: new Set(), sources: [], weight: 0 });
  e.count++; if (ev.dir === "in") e.inCount++; else e.outCount++;
  e.firstTs = Math.min(e.firstTs || ts, ts); e.lastTs = Math.max(e.lastTs, ts);
  e.channels.add(ch); addProv(e.sources, ev.ref);
}

// project the derived graph → AD4M Link signals (feed each to a Perspective's addLink → they become signed,
// hash-linked strand entries; the Perspective IS the user's owned graph). meta carries weight + provenance.
export function toLinkSignals(graph) {
  const out = [];
  for (const e of graph.edges.values())
    out.push({ source: graph.me, predicate: e.predicate, target: e.target,
      meta: { weight: e.weight, count: e.count, lastTs: e.lastTs, channels: [...e.channels].sort(), sources: e.sources } });
  for (const g of graph.groups.values())
    for (const m of g.members) out.push({ source: m, predicate: "co-member", target: g.kappa, meta: { via: "group", sources: g.sources } });
  return out;
}

// a compact, indexable summary (for monitoring / the "your closest N" surface). Pure read over the graph.
export function summarize(graph, topN = 20) {
  const ranked = [...graph.edges.values()].filter((e) => e.predicate !== "co-member").sort((a, b) => b.weight - a.weight);
  return {
    ...graph.stats,
    closest: ranked.slice(0, topN).map((e) => ({ node: e.target, name: graph.nodes.get(e.target)?.name, weight: e.weight, count: e.count, lastTs: e.lastTs, channels: [...e.channels].sort() })),
    dormant: ranked.filter((e) => e.weight < 0.15 && e.count >= 3).slice(0, topN).map((e) => ({ node: e.target, name: graph.nodes.get(e.target)?.name, lastTs: e.lastTs, count: e.count })),
  };
}
