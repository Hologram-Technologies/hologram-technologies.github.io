# ADR-041: Holo Ask — the end-to-end query pipeline: one query → answer + evidence, one self-verifying address

**Status:** Accepted — witnessed: `holo-ask-witness.mjs` is green and `uor:holo-ask` is a required,
product-gated row in `w3c-conformance.jsonld`. Orchestrates Holo Resolve (ADR-037) + Holo Federate
(ADR-038) + Holo Answer (ADR-040) over their byte-pinned fixtures, end to end, offline. Builds on the UOR
envelope (ADR-025) and the constitution (ADR-033).

**Context.** Three slices stand built: Resolve turns an identifier into a self-verifying object; Federate
fuses a query into a ranked result set; Answer composes a corroborated, conflict-aware card. What was
missing is the wire that makes them *one search bar*: a single `ask(query)` that screens, routes, and runs
the whole flow — and a single result that a user (or an agent) can hold, share, and verify. This pattern already
has the shape: the answering spine routes a query down a **certainty ladder** (a fast lookup when the
answer is certain; the deeper machinery when it is not), and the Letter assembles the answer with its
evidence. Over the open web's self-verifying objects, that whole pipeline collapses to one content address.

**Decision.** **One query → one self-verifying address committing to the answer *and* its evidence.** Four
rules:

1. **Screen, then route by shape.** The query passes the constitution's immune perimeter (ADR-033), then
   `route(query)` decides the path deterministically from the query's shape — an identifier (DOI, ISBN,
   Wikidata Q-id, geo, URL, CID, `did:holo`) routes to **resolve** (the certainty-ladder L0: one lookup);
   free text routes to **federate** (L1+: fan across the open web). No model decides; the shape does.
2. **Federate for evidence; anchor the entity on Wikipedia's primary topic.** For free text, fan across the
   sources and fuse (RRF) — that result set is the *evidence* ("see also"). But the canonical *entity* is
   chosen by `anchorEntity`: Wikipedia's own primary-topic disambiguation — the resolved article's
   `wikibase_item` Q-id — is authoritative for "what does this name mean", so it is **preferred over** the
   federated top cluster's reconcile (which a same-named book or film can win by ranking). The anchored
   Q-id resolves the Wikidata record; the article resolves the Wikipedia view; the answer composes over the
   entity across both. This fixes the collision case — "marie curie" resolves to the person (Q7186), not a
   2022 book titled "Marie Curie" (Q114939443) that topped the fused search — and the ask records the
   anchor (`hask:anchor`, `hask:federateAgreed`) for transparency. (When Wikipedia has no entity, it falls
   back to the federated cluster.)
3. **Compose; seal answer *and* evidence under one κ.** The resolved sources compose into an answer card
   (ADR-040: corroborated facts, conflicts flagged, every claim a `did:holo`). The whole ask seals into one
   `schema:SearchAction` that commits to the answer card (`schema:result`) AND the federated result set
   (`schema:hasPart` — the evidence, the "see also") — and through them to every source object and every
   raw byte the open web returned. So the ask RE-DERIVES top-to-bottom (Law L5, depth ≥ 4): **one shareable
   `holo://κ` for a query, its answer, its evidence, and its provenance.**
4. **Witness the whole flow.** Offline: routing is the certainty ladder, the cluster maps to resolves, the
   pipeline chains federate → resolve → answer for "douglas adams" (→ Q42, "Douglas Adams (1952–2001)",
   dates corroborated, characterization flagged), one κ commits to answer + evidence, the whole thing
   re-derives to the bytes, the build is deterministic, the query is governed, and it mints nothing.

**Consequences.** The unified window now has its single entry point: `ask(query)` is the search bar.
Resolve / Federate / Answer are no longer three tools but one flow whose result is a single content address
a peer re-derives — answer, evidence, and provenance in one. The standing cost is one tiny routing runtime
+ one orchestrator + one witness (all fixtures reused). Explicit follow-ons: **the homepage** (wire the
splash search bar to `ask --fetch` and render the card + "see also"); **personal ranking** (HoloRank over
the result set, per the operator's usage); **the certainty register** (say how sure, from corroboration
count — the constitution's honesty spine); **richer resolve-mode answers** (compose a DOI/ISBN result's
own structure); and **the `ask` MCP tool** (the whole window, agent-consumable, governed). The CORS caveat
of ADR-037/038 applies; results re-derive by κ regardless, so no gateway is trusted (Law L5).

External authorities: **Wikipedia / Wikidata / Open Library / Crossref / OpenStreetMap** (the sources);
**W3C schema.org** (SearchAction / Answer / Claim / ItemList), **DCMI Terms**, **W3C PROV-O**; **W3C SRI** /
**IPLD** content-addressed Merkle-DAG (Law L5); an answering spine + certainty ladder (the design
lineage); the constitution (ADR-033). Routing runtime: `os/_shared/holo-ask.js`; orchestrator + CLI:
`os/holo-ask.mjs`; committed demo: `os/ask/ask.uor.json`; witness: `os/holo-ask-witness.mjs`; catalog row:
`uor:holo-ask` in `conformance/w3c-conformance.jsonld`.
