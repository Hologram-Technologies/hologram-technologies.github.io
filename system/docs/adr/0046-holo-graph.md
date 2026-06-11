# ADR-046: Holo Graph — browse the internet's object graph (resolve an edge, nest its object)

**Status:** Accepted — witnessed: `holo-graph-witness.mjs` is green and `uor:holo-graph` is a required,
product-gated row in `w3c-conformance.jsonld`. Builds on Holo Resolve (ADR-037), the UOR envelope
(ADR-025), and the spatial self-authoring shell (A27, ADR-024 catalog).

**Context.** Holo Resolve turns an identifier into a self-verifying object — and every such object carries
*edges*: a paper's cited DOIs (`schema:citation`), an entity's canonical Wikidata id (`schema:sameAs`),
related works. The open web is therefore not a list of pages but a *graph* of linked objects. What was
missing is the move that lets you *walk* it: resolve an edge to its object and nest it, recursively. The OS
already has the idiom — A27's self-authoring shell makes the world a Merkle-DAG where nesting is links and
recursion is `verifyDeep` (open a holospace from a holospace). Applied to the open web, the same idiom makes
the internet one navigable, self-verifying object graph.

**Decision.** **Traversal is resolve-an-edge-and-nest, recursively, into one re-derivable DAG.** Three rules:

1. **Edges are data; extraction is pure.** `edgesOf(obj)` reads an object's resolvable edges as
   `{ rel, kind, id }` — `schema:sameAs` → the Wikidata entity, `schema:citation` → each cited DOI. No model.
2. **Nest the resolved object as a child node.** `traverse(store, rootObj, resolveSpec, {depth})` builds a
   node per object — linking the object it stands for (`schema:subjectOf`) and a child node for each
   resolved edge — recursively, bounded by `depth` and a seen-set (so a self-referential edge does not loop;
   the DAG is acyclic by construction). `resolveSpec` follows an edge to its object (live `fetchResolve`, or
   the vendored fixtures offline).
3. **One κ commits to the whole walk.** The traversal is one κ-rooted Merkle-DAG that `verifyDeep`
   re-derives top-to-bottom to the source bytes (Law L5): walk "Douglas Adams" (Wikipedia) → its `sameAs`
   edge resolves the canonical Wikidata Q42 record and nests it (depth ≥ 3). Witnessed offline: edges
   extract, the edge resolves and nests, the DAG re-derives, is acyclic and deterministic, equals its
   committed artifact, and mints nothing.

**Consequences.** The unified window gains depth: a result is not a dead end but a doorway — click a
citation or a `sameAs` and open *that* object, and the object it cites, all the way down, every node
verifiable and the whole walk one shareable `holo://κ`. Each node can be opened in the A27 spatial shell
(nest a holospace from a holospace). Explicit follow-ons: **citation-graph depth** (vendor a few cited-DOI
fixtures / walk live to many hops — the runtime already does it via `--fetch`); **more edge kinds** (authors
→ ORCID, places → nearby, repos → dependencies); **personal ranking over the walked graph** (HoloRank); and
rendering the graph in the homepage. The CORS caveat of ADR-037 holds; nodes re-derive by κ regardless.

External authorities: **Wikipedia / Wikidata / Crossref** (the linked sources); **W3C schema.org** (the edge
vocabulary) + **PROV-O**; **IPLD** content-addressed Merkle-DAG / **W3C SRI** (Law L5); A27 self-authoring
(the nesting idiom). Edge extractor: `os/_shared/holo-graph.js`; traversal + sealing + CLI:
`os/holo-graph.mjs`; committed demo: `os/graph/graph.uor.json`; witness: `os/holo-graph-witness.mjs`;
catalog row: `uor:holo-graph` in `conformance/w3c-conformance.jsonld`.
