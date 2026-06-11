# ADR-044: Holo Find — the homepage: a Google-like search bar onto the open web's object universe

**Status:** Accepted — witnessed: `holo-find-witness.mjs` is green and `uor:holo-find` is a required,
product-gated row in `w3c-conformance.jsonld`. The page is `os/find.html`; the in-tab orchestration is
`_shared/holo-find.js`. Delivers the user-facing surface of Holo Resolve (ADR-037) + Holo Federate
(ADR-038) + Holo Answer (ADR-040) + Holo Ask (ADR-041), governed by the constitution (ADR-033).

**Context.** Four slices built the unified-window pipeline; what remained was the **homepage** — the simple,
Google-like search bar the whole thing was for. The requirement was specific: it must work *without AI*,
from *any browser*, over *only existing open internet infrastructure*, enabled by the content-addressable
substrate. The pipeline already satisfies all of that; the homepage is the thin, in-tab surface that runs
it live and paints the result.

**Decision.** **One page, one bar, the whole window.** Three rules:

1. **The page runs the witnessed pipeline in-tab, live.** `_shared/holo-find.js` `find(query, {fetchJson})`
   is the browser counterpart of Holo Ask: SCREEN (the immune perimeter) → ROUTE → RESOLVE an identifier,
   or FEDERATE free text (the evidence) + ANCHOR the entity on Wikipedia's primary topic + RESOLVE it +
   COMPOSE the answer. It calls the open APIs directly from the tab (`window.fetch`, with `&origin=*` for
   the MediaWiki action API's CORS) — no server, no key, no AI. `fetchJson` is injected, so the whole flow
   is witnessed offline against the vendored fixtures; the live page just passes `browserFetchJson`.
2. **Paint the answer, bracket the sources, flag the conflicts.** `os/find.html` renders the composed
   answer (Holo Answer): the corroborated facts each with a source chip linking to where they came from,
   the conflicts shown side-by-side ("English writer" vs "British science-fiction writer") rather than
   merged, and the federated "see also" beneath — every result a link to its source, agreement across
   sources marked. The footer states the contract: *resolved live from the open web, no AI, every fact
   links to its source*. The page adopts the shared mobile-conformance + theme layers, so it is responsive
   and themed like the rest of the OS.
3. **Govern the bar; witness the surface.** Every query the bar receives is screened by the constitution's
   immune perimeter before it runs (a perimeter `block` is refused in the UI). Witnessed (node, offline):
   resolve-mode answers an identifier, federate-mode answers free text anchored on Wikipedia's primary
   topic, the homepage's render model has PARITY with the witnessed answer pipeline (same answer, same
   corroborated facts, same conflicts), the input is governed, and the page adopts the mobile + theme
   layers and loads the runtime.

**Consequences.** Hologram OS now has its front door: a clean homepage where you type anything — a person,
a place, a paper, a book, an identifier — and get back a corroborated, conflict-aware, source-linked answer
plus the federated "see also", resolved live from the open web, with no AI and no keys. Verified live: it
correctly answers "marie curie" (the person, Q7186, after ADR-041's Wikipedia anchoring), a DOI ("Deep
learning"), and "Eiffel Tower" (Q243). Explicit follow-ons: **seal + verify in-tab** (compute the
`did:holo` of each result client-side via `holo-object.js` so the page itself re-derives, not just
renders — the full self-verifying property); **personal ranking** (HoloRank over the result set);
**make it the OS shell / an installable app** (wire it into the launcher + the content-addressed image —
it is a standalone page for now, deliberately outside the sealed closure); **richer fact extraction**; and
the **`ask` MCP tool**. The CORS caveat of ADR-037/038 holds — a non-CORS source needs a content-blind
gateway, but results re-derive by κ, so the gateway is never trusted (Law L5).

External authorities: **Wikipedia / Wikidata / Open Library / Crossref / OpenStreetMap** (the live
sources); **W3C HTML / CSS** (the page) + **schema.org** (the answer model); the witnessed pipeline
(ADR-037/038/040/041); the constitution's immune perimeter (ADR-033). In-tab orchestration:
`os/_shared/holo-find.js`; the page: `os/find.html`; witness: `os/holo-find-witness.mjs`; catalog row:
`uor:holo-find` in `conformance/w3c-conformance.jsonld`.
