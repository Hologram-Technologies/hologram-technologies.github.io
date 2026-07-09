// holo-graph-cypher.mjs — Stage-8 P2 ETL: project the sovereign social graph (holo-social-graph) into
// openCypher so an off-the-shelf graph engine (Memgraph / Neo4j) can run the heavy analytics (communities,
// influence, recommendations) WITHOUT us hand-writing a graph engine. This is the ONLY new code between the
// native κ graph and the cloned Memgraph holospace — everything else is upstream, unmodified.
//
// THREE PROPERTIES (acceptance for P2):
//   1 · IDEMPOTENT. Every statement is MERGE (never CREATE), keyed by a stable κ. Re-running the load over a
//       changed graph updates in place and never duplicates — so Memgraph is a re-derivable INDEX, not a system
//       of record (drop + reload = same graph). The κ spine (holo-strand) stays authoritative.
//   2 · CONTENT-ADDRESSED. Each node carries its identity κ; each edge gets a stable κ = address(source,pred,
//       target). Same relationship → same κ → MERGE dedups it. The whole script also has its own κ (provenance).
//   3 · PROVENANCE PRESERVED. Every edge keeps its source κ(s) (the real interactions that created it, Law L5) —
//       so an analytic result can always cite the evidence. No fabricated edges survive the ETL.
//
// Pure, deterministic, isomorphic. Imports only the substrate content hash.

import { address } from "./holo-object.mjs";

const esc = (s) => String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const strList = (xs) => "[" + (xs || []).map((x) => `'${esc(x)}'`).join(",") + "]";
const num = (n) => (Number.isFinite(+n) ? +n : 0);
const REL = (p) => String(p || "messaged").toUpperCase().replace(/[^A-Z0-9_]/g, "_");   // a safe Cypher relationship type

// edgeKappa — the content address of a relationship: same (source,predicate,target) → same κ → MERGE is idempotent.
export function edgeKappa(e) { return address({ t: "edge", source: e.source, predicate: e.predicate, target: e.target }); }

// toCypher(graph) → an ordered array of idempotent openCypher statements (one per line, ';'-terminated).
//   graph = the object from holo-social-graph.deriveGraph({ nodes, edges, groups, me, … }).
export function toCypher(graph) {
  const lines = [];
  // the operator (you) — the centre of your own graph
  lines.push(`MERGE (me:Agent {kappa:'${esc(graph.me)}'}) SET me.is_me = true;`);
  // person / agent nodes
  for (const n of graph.nodes.values()) {
    lines.push(`MERGE (a:Agent {kappa:'${esc(n.kappa)}'}) SET a.name='${esc(n.name)}', a.platforms=${strList(n.platforms)}, a.handles=${strList(n.handles)}, a.weak=${!!n.weak};`);
  }
  // weighted, provenance-cited edges (you → person)
  for (const e of graph.edges.values()) {
    const k = edgeKappa(e);
    lines.push(
      // label-agnostic endpoints: b may be an Agent OR a Group (co-member hyperedges target a Group node)
      `MATCH (a {kappa:'${esc(e.source)}'}), (b {kappa:'${esc(e.target)}'}) ` +
      `MERGE (a)-[r:${REL(e.predicate)} {kappa:'${esc(k)}'}]->(b) ` +
      `SET r.weight=${num(e.weight)}, r.count=${num(e.count)}, r.inCount=${num(e.inCount)}, r.outCount=${num(e.outCount)}, ` +
      `r.lastTs=${num(e.lastTs)}, r.channels=${strList([...(e.channels || [])])}, r.sources=${strList(e.sources)};`);
  }
  // groups → hyperedges: a Group node + MEMBER_OF edges from each known member
  for (const g of graph.groups.values()) {
    lines.push(`MERGE (g:Group {kappa:'${esc(g.kappa)}'}) SET g.name='${esc(g.name)}', g.platform='${esc(g.platform)}', g.count=${num(g.count)};`);
    for (const mk of g.members) {
      lines.push(`MATCH (m:Agent {kappa:'${esc(mk)}'}), (g:Group {kappa:'${esc(g.kappa)}'}) MERGE (m)-[:MEMBER_OF]->(g);`);
    }
  }
  return lines;
}

// toScript(graph) → one runnable .cypher text + its own κ (the load is itself content-addressed → cache/dedup).
export function toScript(graph) {
  const lines = toCypher(graph);
  const body = lines.join("\n") + "\n";
  return { kappa: address({ t: "cypher-load", lines }), body, count: lines.length };
}

// parseCypher(lines) → reconstruct the {nodes,edges,groups,members} sets the script ENCODES — so a witness can prove
// a faithful graph→Cypher→graph round-trip WITHOUT standing up a database (this is a parser, not an engine).
export function parseCypher(lines) {
  const nodes = new Set(), me = []; const edges = []; const groups = new Set(); const members = [];
  for (const ln of lines) {
    let m;
    if ((m = ln.match(/MERGE \(a:Agent \{kappa:'([^']*)'\}\) SET a\.name/))) { nodes.add(m[1]); continue; }
    if ((m = ln.match(/MERGE \(me:Agent \{kappa:'([^']*)'\}\)/))) { me.push(m[1]); continue; }
    if ((m = ln.match(/MATCH \(a \{kappa:'([^']*)'\}\), \(b \{kappa:'([^']*)'\}\) MERGE \(a\)-\[r:([A-Z0-9_]+) \{kappa:'([^']*)'\}\]->\(b\) SET r\.weight=([0-9.eE+-]+).*?r\.sources=\[([^\]]*)\]/))) {
      edges.push({ source: m[1], target: m[2], predicate: m[3], kappa: m[4], weight: +m[5], sources: (m[6].match(/'([^']*)'/g) || []).map((s) => s.slice(1, -1)) });
      continue;
    }
    if ((m = ln.match(/MERGE \(g:Group \{kappa:'([^']*)'\}\) SET g\.name/))) { groups.add(m[1]); continue; }
    if ((m = ln.match(/MATCH \(m:Agent \{kappa:'([^']*)'\}\), \(g:Group \{kappa:'([^']*)'\}\) MERGE \(m\)-\[:MEMBER_OF\]->\(g\)/))) { members.push([m[1], m[2]]); continue; }
  }
  return { me, nodes, edges, groups, members };
}
