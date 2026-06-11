# ADR-047: Holo Window MCP — the unified window as governed, self-verifying MCP tools

**Status:** Accepted — witnessed: `holo-window-mcp-witness.mjs` is green and `uor:holo-window-mcp` is a
required, product-gated row in `w3c-conformance.jsonld`. Builds on Holo Resolve (ADR-037), Holo Federate
(ADR-038), Holo Answer (ADR-040), Holo Find (ADR-044), the Hologram MCP server (the agent door), and the
Holo Constitution (ADR-033, the pre-dispatch gate).

**Context.** The unified window — resolve any identifier, federate any query, compose a corroborated answer —
was built for the human at `os/find.html`. But Hologram OS already speaks MCP (JSON-RPC 2.0): the same
content-addressed substrate that serves a person should serve an *agent*, and it should serve it the OS's
own currency — **self-verifying UOR objects**, not opaque text an agent must trust. An agent that asks "who
is Q42?" should get back an object whose `did:holo` it re-derives itself (Law L5), not a sentence. What was
missing is the door: the open-web window exposed as MCP tools, governed by the same constitution every other
tool passes through, with no AI anywhere in the path.

**Decision.** **Expose the window as three MCP tools that return self-verifying objects and pass the
constitutional gate like every other tool.** Concretely, in `os/mcp/holo-mcp.mjs`:

1. **`resolve_object` is extended to the open web.** It still serves a `did:holo` from the store unchanged
   (backward compatible); given a web-fetch capability (`ctx.webFetch`) it now also classifies any open-web
   identifier (DOI · ISBN · Wikidata Q-id · place · GitHub repo · species · chemical · domain · fediverse
   handle · free text) and resolves it to a **self-verifying UOR object** via `webResolve` — the agent
   re-derives its `did:holo` (Law L5). Content-addressed kinds (IPFS · Ethereum · `did:holo`) report the
   engine that already verifies them (delegation, not duplication). Without `ctx.webFetch` it behaves
   exactly as before — no regression.
2. **`search_web` + `answer` expose federation and composition.** `search_web` runs the federated,
   RRF-fused, Wikidata-reconciled search (every result re-derivable via `resolve_object`); `answer` returns
   the deterministically-composed answer card (corroborated facts, conflicts flagged, never a model
   hallucination). Both run the witnessed `holo-find` pipeline in-process with the injected fetch — live in
   production, fixtures in the witness.
3. **Every tool passes the constitution.** The tools sit *behind* the server's existing pre-dispatch
   constitutional review (ADR-033): a halted OS refuses every one of them (kill-switch supremacy, P7), the
   verdict is recorded for provenance (P2), and the untrusted query is screened by the immune perimeter.
   No new gate — the window inherits the OS-wide one.

**Consequences.** The whole open-web window is now agent-consumable through one standard protocol, returning
objects an agent verifies rather than prose it trusts — the decisive edge over a plain web-search tool. An
agent can resolve a citation to its object, federate a question, and get a corroborated answer, all governed,
all re-derivable, all without AI in the resolution path. Explicit follow-ons: **stream the graph walk**
(expose Holo Graph traversal, ADR-046, as a tool); **a tool to open a result in the A27 spatial shell**; and
**per-source rate-limit etiquette** for the live server's `ctx.webFetch`. The CORS/live caveats of ADR-037/044
hold; objects re-derive by κ regardless of transport.

External authorities: **Model Context Protocol** (JSON-RPC 2.0 — the agent door); **W3C schema.org**
(the returned objects' vocabulary); **IPLD** content-addressed Merkle-DAG / **W3C SRI** (Law L5);
the Holo Constitution (ADR-033, the pre-dispatch gate). Tools + helper: `os/mcp/holo-mcp.mjs`
(`webResolve`, `resolve_object`/`search_web`/`answer`); pipeline: `os/_shared/holo-find.js`;
witness: `os/holo-window-mcp-witness.mjs`; catalog row: `uor:holo-window-mcp` in
`conformance/w3c-conformance.jsonld`.
