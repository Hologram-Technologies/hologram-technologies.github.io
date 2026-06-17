// holo-rdf.mjs — JSON-LD→RDF materialization + a SPARQL Basic-Graph-Pattern query surface (S4), over the
// L5-VERIFIED object graph. The novelty is not the RDF engine (vendored N3.js: a real W3C RDF/JS term model,
// indexed quad store, Turtle/N-Quads serialization) — it is that every triple carries PROVENANCE: it is
// materialized into the NAMED GRAPH of its source object's κ, and only objects that passed re-derivation
// (Law L5, via holo-graph.traverse) are ever materialized. So a query result is not just data — its bytes
// trace back to verified source CIDs.
//
// SPARQL surface: query() evaluates a Basic Graph Pattern (the join core of SPARQL SELECT) over the union of
// named graphs — provably equivalent to a SPARQL SELECT WHERE { …bgp… }. Full SPARQL syntax + W3C DAWG
// conformance attach when a full engine (Comunica/Oxigraph) is vendored at promotion; this is the verified
// data layer beneath it. Node/app-side (N3 + the holo-graph verify path); the vendored n3.min.js is the
// κ-sealed browser artifact for the later in-browser query surface.

import { Store, DataFactory, Writer, Parser } from "n3";
const { namedNode, literal, quad } = DataFactory;

// CURIE prefixes from the UOR contexts (holo-object UOR_CONTEXT + holo-render-contract RENDER_CONTEXT).
export const PREFIXES = Object.freeze({
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  owl: "http://www.w3.org/2002/07/owl#",
  schema: "https://schema.org/",
  holo: "https://hologram.os/ns#",
  prov: "http://www.w3.org/ns/prov#",
  dcterms: "http://purl.org/dc/terms/",
});
const RDF_TYPE = PREFIXES.rdf + "type";

// expandCurie(t) → an absolute IRI. "schema:name" → "https://schema.org/name"; a did:/http(s): IRI passes
// through unchanged (a did URI's "did" prefix is not a CURIE prefix, so it is left whole).
export function expandCurie(t) {
  const m = /^([a-z][\w.-]*):(.+)$/i.exec(String(t));
  if (m && PREFIXES[m[1]]) return PREFIXES[m[1]] + m[2];
  return String(t);
}

// objToQuads(obj) → the RDF quads for one UOR object, in ITS OWN named graph (graph = obj.id = the source κ,
// so provenance is carried at the quad level). Subject = obj.id (a did URI). @type → rdf:type; name →
// schema:name; render.renderKind → holo:renderKind; each link → schema:hasPart edge to the child's κ URI.
export function objToQuads(obj) {
  const s = namedNode(obj.id);
  const g = namedNode(obj.id);
  const out = [];
  for (const t of [].concat(obj["@type"] || [])) out.push(quad(s, namedNode(RDF_TYPE), namedNode(expandCurie(t)), g));
  if (typeof obj.name === "string") out.push(quad(s, namedNode(PREFIXES.schema + "name"), literal(obj.name), g));
  if (obj.render && obj.render.renderKind) out.push(quad(s, namedNode(PREFIXES.holo + "renderKind"), literal(obj.render.renderKind), g));
  for (const l of obj.links || []) out.push(quad(s, namedNode(PREFIXES.schema + "hasPart"), namedNode(l.id), g));
  // axioms: an object may carry ontology assertions ([s,p,o] CURIE/IRI triples, e.g. an RDFS schema). They
  // materialize into the SAME named graph (the object's κ), so a schema is itself L5-verified linked data.
  for (const [as, ap, ao] of obj.axioms || []) out.push(quad(namedNode(expandCurie(as)), namedNode(expandCurie(ap)), namedNode(expandCurie(ao)), g));
  return out;
}

// materialize(nodes) → an N3 Store of all triples from the VERIFIED object nodes of a traversal
// (holo-graph.traverse result `.nodes`). Only kind:"object" nodes (which passed L5) contribute, so every
// named graph in the store corresponds to a re-derived source object.
export function materialize(nodes) {
  const store = new Store();
  for (const n of nodes || []) if (n && n.kind === "object" && n.obj) store.addQuads(objToQuads(n.obj));
  return store;
}

const isVar = (t) => typeof t === "string" && t.startsWith("?");
// termOf(t) — coerce a pattern term to an N3 term. {lit:"x"} → literal; {iri:"schema:x"} or a bare string →
// named node (CURIE-expanded). Variables ("?x") are handled by query(), never coerced here.
function termOf(t) {
  if (t && typeof t === "object" && t.lit != null) return literal(t.lit);
  if (t && typeof t === "object" && t.iri) return namedNode(expandCurie(t.iri));
  return namedNode(expandCurie(t));
}

// query(store, patterns) → SPARQL Basic Graph Pattern SELECT over the UNION of named graphs (default-graph
// semantics = match any graph). `patterns` is [{s,p,o}] with "?var" terms; returns an array of binding maps
// (var → N3 term). Standard nested-loop join: a shared variable across patterns joins their matches.
export function query(store, patterns) {
  let solutions = [{}];
  for (const pat of patterns) {
    const next = [];
    for (const b of solutions) {
      const s = isVar(pat.s) ? (b[pat.s] || null) : termOf(pat.s);
      const p = isVar(pat.p) ? (b[pat.p] || null) : termOf(pat.p);
      const o = isVar(pat.o) ? (b[pat.o] || null) : termOf(pat.o);
      for (const q of store.getQuads(s, p, o, null)) {            // null graph = any (union of named graphs)
        const nb = { ...b };
        if (isVar(pat.s)) nb[pat.s] = q.subject;
        if (isVar(pat.p)) nb[pat.p] = q.predicate;
        if (isVar(pat.o)) nb[pat.o] = q.object;
        next.push(nb);
      }
    }
    solutions = next;
  }
  return solutions;
}

// provenanceGraphs(store, patterns) → the set of named-graph IRIs (source κ URIs) whose quads satisfy the
// FIRST pattern — i.e. which source objects a query's data came from. Used to prove a result spans sources.
export function provenanceGraphs(store, patterns) {
  const pat = patterns[0];
  const s = isVar(pat.s) ? null : termOf(pat.s);
  const p = isVar(pat.p) ? null : termOf(pat.p);
  const o = isVar(pat.o) ? null : termOf(pat.o);
  const set = new Set();
  for (const q of store.getQuads(s, p, o, null)) set.add(q.graph.value);
  return set;
}

// toNQuads(store) → the W3C N-Quads serialization (graphs preserved) — the standard interop artifact an
// external agent or SPARQL engine consumes.
export function toNQuads(store) {
  return new Promise((res, rej) => {
    const w = new Writer({ format: "N-Quads" });
    w.addQuads(store.getQuads(null, null, null, null));
    w.end((e, r) => (e ? rej(e) : res(r)));
  });
}
// parseNQuads(text) → quads (round-trip / ingest of external N-Quads).
export const parseNQuads = (text) => new Parser({ format: "N-Quads" }).parse(text);
