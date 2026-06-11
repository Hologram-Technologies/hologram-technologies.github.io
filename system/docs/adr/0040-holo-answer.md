# ADR-040: Holo Answer — the composed answer card: a Google-style answer where every fact is a clickable `did:holo`

**Status:** Accepted — witnessed: `holo-answer-witness.mjs` is green and `uor:holo-answer` is a required,
product-gated row in `w3c-conformance.jsonld`. Composes over two real, byte-pinned responses (Wikipedia +
Wikidata for one entity), reusing Holo Resolve's fixtures. Builds on Holo Resolve (ADR-037), Holo Federate
(ADR-038), the UOR envelope (ADR-025), and the constitution (ADR-033).

**Context.** Holo Resolve (ADR-037) resolves an identifier to an object; Holo Federate (ADR-038) fuses a
query into a ranked result set. The last step to a Google-like homepage is the **answer box** — a single,
direct answer at the top. Every other answer box on the web is generated: a model writes prose that *may*
be grounded. That is exactly the failure mode the constitution exists to prevent (hallucination,
unattributed claims). This is solvable without a model: an algorithmic "Letter" composes a multi-part answer
*algorithmically* from engine outputs, and its due-diligence engine does **numeric reconciliation and
contradiction detection** across sources, with every claim traced to a `claim_id` you click to verify. The
realisation: over the open web's *self-verifying* objects, the same composition is not just grounded — it
is **re-derivable**. An answer can be assembled from facts that each re-derive to the bytes a source
returned, so it cannot hallucinate, because it asserts only what verifiable sources assert.

**Decision.** **The answer is a reconciliation of verifiable facts, not generated prose.** Four rules:

1. **Extract facts purely.** From each resolved source object, a deterministic `extractFacts` reads the
   comparable fields (the canonical name, a lifespan parsed from the description, and the
   *characterization* — the description with the lifespan removed). No model.
2. **Corroborate and flag conflicts.** `reconcileFacts` groups each fact's values across the sources: a
   value held by ≥2 independent sources is a **corroborated** fact; *more than one distinct value* is a
   **conflict**, carrying every variant and the source that asserts it — surfaced, never silently merged.
   (For "Douglas Adams": birth 1952 and death 2001 are corroborated by both Wikipedia and Wikidata; the
   characterization — "English writer" vs "British science-fiction writer" — is flagged as a conflict.)
   This is deterministic contradiction detection, over the open web.
3. **Answer from corroboration only; bracket everything.** The one-line answer is built *only* from
   corroborated facts (the disputed field is shown but not asserted). Every fact is a `schema:Claim` that
   links (`prov:wasDerivedFrom`) to the source OBJECT it came from — a clickable `did:holo` provenance
   bracket — and those objects link to the raw bytes the web returned. So the whole card RE-DERIVES
   top-to-bottom to the source bytes (Law L5, depth ≥ 3): a composed answer that **cannot hallucinate**.
4. **Seal the card; witness it.** The answer is one κ-rooted `schema:Answer` committing to the query, the
   answer line, every claim and conflict, and the source objects it is based on — a shareable, re-derivable
   `holo://κ`. Witnessed offline: facts extract, dates corroborate, the characterization conflict is
   flagged, the headline uses only corroborated facts, every claim resolves to a real source object, the
   card re-derives to the bytes, the build is deterministic, and it mints nothing.

**Consequences.** The homepage now has its answer box — direct, corroborated, conflict-aware, and entirely
verifiable: a Google answer where you can click any fact down to the bytes a source returned, and where
disagreement is shown rather than averaged away. The standing cost is one runtime + one witness (the
fixtures are reused from ADR-037). Explicit follow-ons: **richer fact extraction** (more fields, units,
numeric reconciliation as in a due-diligence engine); **federate-then-answer** (compose over the top
reconciled cluster of a federated search, not just two pre-chosen sources); **the certainty register**
(L0–L3 — say how sure, from corroboration count, the constitution's honesty spine); **the homepage** (wire
the splash search bar to render the card); and **the MCP tool** (`answer` returning a self-verifying card an
agent re-derives). The constitution's output court (ADR-033 §5) governs the prose the card ships
(dignity/transparency), and its perimeter governs the query.

External authorities: **Wikipedia / Wikidata** (the federated sources); **W3C schema.org** (Answer / Claim
/ the provenance model), **DCMI Terms**, **W3C PROV-O**; **W3C SRI** / **IPLD** content-addressed
Merkle-DAG (Law L5); an algorithmic Letter + due-diligence contradiction detection (the design
lineage); the constitution (ADR-033). Runtime (extraction + reconciliation): `os/_shared/holo-answer.js`;
sealing + CLI: `os/holo-answer.mjs`; committed demo card: `os/answer/card.uor.json`; witness:
`os/holo-answer-witness.mjs`; catalog row: `uor:holo-answer` in `conformance/w3c-conformance.jsonld`.
