// _shared/holo-graph.js — Holo Graph (ADR-046): browse the internet's OBJECT GRAPH. A resolved UOR object
// carries edges — a paper's cited DOIs (schema:citation), an entity's canonical Wikidata id (schema:sameAs).
// Traversal resolves each edge to ITS object and NESTS it, recursively, into one content-addressed DAG:
// nesting = links, recursion = verifyDeep (the A27 self-authoring idiom — open an object from an object).
// So the open web is not a list of pages but one navigable, self-verifying graph you can walk and re-derive.
//
// This module is the pure edge-extractor; the resolving + sealing lives in holo-graph.mjs / the browser.

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

// edgesOf(obj) → the resolvable edges a UOR object exposes, as { rel, kind, id } the resolver can follow.
// schema:sameAs → the canonical Wikidata entity; schema:citation → each cited work (a DOI). Deterministic.
export function edgesOf(obj) {
  const edges = [];
  const qid = str(obj && obj["schema:sameAs"]).match(/Q\d+$/);
  if (qid) edges.push({ rel: "schema:sameAs", kind: "wikidata", id: qid[0] });
  for (const doi of (obj && obj["schema:citation"]) || []) if (/^10\.\d{4,9}\/\S+$/.test(str(doi))) edges.push({ rel: "schema:citation", kind: "doi", id: str(doi) });
  return edges;
}

if (typeof window !== "undefined") window.HoloGraph = { edgesOf };
