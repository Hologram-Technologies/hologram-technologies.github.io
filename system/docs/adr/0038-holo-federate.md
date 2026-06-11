# ADR-038: Holo Federate — federated unified search: one query, the whole open web, one self-verifying result set

**Status:** Accepted — witnessed: `holo-federate-witness.mjs` is green and `uor:holo-federate` is a
required, product-gated row in `w3c-conformance.jsonld`. Four real, byte-pinned SEARCH responses
(Wikipedia, Wikidata, Open Library, Crossref for the query "douglas adams") are vendored as the offline
ground truth. Builds on Holo Resolve (ADR-037), the UOR envelope (ADR-025), HoloRank/HoloDiscover, and the
constitution (ADR-033, which governs the query).

**Context.** Holo Resolve (ADR-037) resolves *one* identifier to a self-verifying object. The next move —
the one that turns a search bar into a window onto the whole open web — is to **fan one query across many
sources at once and fuse the results into one ranked answer**. The open knowledge graphs already expose
search endpoints (Wikipedia, Wikidata, Open Library, Crossref, OpenStreetMap), all reachable from any
browser, no key, no AI. What was missing was the deterministic fusion: how to merge ranked lists from
independent retrievers *without* a model, and how to make the merged result trustworthy. Both have clean
answers. The fusion is **Reciprocal Rank Fusion** (Cormack et al., SIGIR 2009) — the standard, fully
deterministic method: `score(d) = Σ_sources 1/(k + rank_source(d))`. The trust is content addressing: seal
the whole search as a re-derivable κ. This is a deterministic query router
realised over the open web, and HoloDiscover supercharged.

**Decision.** **One query → one self-verifying, reconciled, RRF-fused result set.** Four binding rules:

1. **Fan out in parallel; normalise into UOR objects.** Each source has a *pure* `normalizeList(response)`
   (search response → ranked results). The live path fetches every source concurrently
   (`Promise.allSettled`, so a slow or failing source never blocks the rest) and degrades honestly.
2. **Fuse by Reciprocal Rank Fusion — agreement is the signal.** Results cluster by normalised title
   (deduped within each source first), and each cluster accumulates `1/(k + rank + 1)` for every source it
   appears in. A result found by *more* sources accumulates more score and rises — so cross-source
   **agreement** ranks it, deterministically, with no model. "Douglas Adams", found by both Wikipedia and
   Wikidata, outranks every single-source result.
3. **Reconcile to the universal join.** A Wikidata Q-id from *any* source enriches the cluster
   (`schema:sameAs`): "Douglas Adams" reconciles to Q42 even though Wikipedia gave no Q-id — and distinct
   "… Adams" people keep their own Q-ids, not conflated. Reconciliation is what lets two sources *agree*,
   which is what RRF rewards. (Title-cluster fusion is the first-slice heuristic; precise per-Q-id
   resolution is Holo Resolve's job, on demand.)
4. **Seal the whole search; govern the query.** The result set is sealed as one κ-rooted `schema:ItemList`
   that commits to the query, every result (a child UOR object, ordered by RRF), and the **raw bytes each
   source returned** (provenance leaves, Law L5). A search is therefore a shareable `holo://κ` — "exactly
   what the open web returned for X, ranked" — re-derivable forever, immune to link-rot and silent
   re-ranking. The untrusted query is screened by the constitution's immune perimeter (ADR-033) first, and
   the whole thing is witnessed offline against the vendored real responses.

**Consequences.** This is the "one bar, the whole web" moment: type a query and get back a ranked,
reconciled, self-verifying result set you can share, re-derive, open (each result resolves via ADR-037),
nest, and rank personally (HoloRank over the reference graph). The standing cost is one runtime, four
byte-pinned fixtures, and one witness. Explicit follow-ons: **the composed answer card** (assemble facts
from the top results into a Google-style box, conflicts flagged — deterministic contradiction detection);
**personal ranking** (fold HoloRank's trust-weighted PageRank over the fused set, using the operator's
usage); **more searchers** (GBIF, PubChem, arXiv, GitHub, DNS, ActivityPub); **the homepage** (wire the
splash search bar to `fetchFederate`); and **the MCP tool** (`federated_search` returning a self-verifying
result set an agent re-derives). The CORS caveat of ADR-037 applies — a non-CORS source needs a
content-blind gateway, but the result still re-derives by κ, so the gateway is never trusted (Law L5).

External authorities: **Wikipedia REST search**, **Wikidata** (wbsearchentities), **Open Library** (search),
**Crossref** (works search), **OpenStreetMap** (Nominatim); **Reciprocal Rank Fusion** (Cormack, Clarke,
Büttcher — SIGIR 2009); **W3C schema.org / DCAT 3 / DCMI Terms / PROV-O**; **W3C SRI** / **IPLD**
content-addressed Merkle-DAG (Law L5); the constitution's immune perimeter (ADR-033). Runtime (normalizers
+ RRF fuse): `os/_shared/holo-federate.js`; sealing + parallel fetch + catalog + CLI:
`os/holo-federate.mjs`; vendored real responses + pin ledger: `os/federate/fixtures/` +
`os/federate/pins.json`; sealed searcher catalog + demo result set: `os/federate/catalog.uor.json` +
`os/federate/result-set.uor.json`; witness: `os/holo-federate-witness.mjs`; catalog row: `uor:holo-federate`
in `conformance/w3c-conformance.jsonld`.
