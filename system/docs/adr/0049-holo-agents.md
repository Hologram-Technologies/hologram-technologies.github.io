# ADR-049: Holo Agents — the agent stack, discoverable and usable by AI agents

**Status:** Accepted — witnessed: `agents-mcp-witness.mjs` is green and `w3c:A59-holo-agents` is a row in
`w3c-conformance.jsonld`; the `holo-agents` spec row is in `specs.json`; the agent-stack tools are in the
MCP server's built-ins + `/.well-known/mcp.json`, and the unified entry point `/.well-known/agents.json`
is the 12th root of the repository graph. Builds on the MCP server (A15–A23) and the agent stack
(034·035·036·039·042·045·048).

**Context.** The agent stack is complete and witnessed — but an AI agent can only *use* what it can
*discover and call*. The verifiable capabilities lived as engines + generated artifacts (`nanda/`,
`a2a/`, `agenttrust/`, `delegate/`, `orchestrate/`, `settle/`) with no agent-facing surface: an agent
connecting to the Hologram MCP server could `verify_object` but could not verify *another agent's
reputation*, *a work receipt*, *a delegation*, or *a settlement*. And the discovery surfaces
(`.well-known/mcp.json`, `agent-card.json`, `agent-facts.json`, `skills/`) were separate — no single
entry point said "here is everything, and here is how to verify it."

**Decision.** **Expose the whole stack as MCP tools, behind one self-verifying entry point.** Two
binding rules:

1. **The agent stack is MCP tools** (`mcp/holo-agent-mcp.mjs`). Six verbs — `agent_facts`,
   `agent_reputation`, `verify_receipt`, `verify_delegation`, `verify_settlement`, `agent_passport` —
   wired *exactly* like the other MCP capabilities (`loadWallet`/`loadBrowser`): the definitions are
   added to the server's `BUILTIN_TOOLS` (so they appear in `tools/list` **and** in
   `/.well-known/mcp.json` — discoverable), and the handlers are merged into `ctx.toolHandlers` by the
   launcher (so they execute). Every tool returns a **self-verifying** result the agent re-derives
   (Law L5) — `agent_facts`/`agent_passport` return objects whose `did:holo` re-derives;
   `verify_receipt`/`verify_delegation`/`verify_settlement` re-derive their inputs and report. **Verify,
   don't trust.**
2. **One entry point** (`holo-agents.mjs` → `/.well-known/agents.json`). A single, **self-verifying** UOR
   object an agent fetches to discover everything: every agent door (MCP · NANDA · A2A · Agent Skills),
   the agent-stack verbs, the subsystem indices, and the one governing principle — every object is
   content-addressed and self-verifying, so re-derive its hash to verify it. The discovery document an
   agent trusts is one it can verify.

**Consequences.**

- **Usable today.** `npx hologram-mcp` (stdio or `--http`) serves the live endpoint; an agent lists the
  tools and calls, e.g., `verify_receipt` on an answer assembled by ten agents and learns — provably —
  who acted, how reputable, under what authority, that every step passed the conscience gate, and exactly
  what they produced. Witnessed: all six verbs execute over the real handler, results self-verify, and a
  tampered receipt/settlement is refused *through the tools an agent calls*.
- **One link to onboard.** `agent_passport` returns a single self-verifying object bundling an agent's
  identity + reputation + skills + every door — one-link onboarding for another agent or registry.
- **No new vocabulary, no app cascade.** Built-in tools (not a new holospace), handlers via the existing
  `ctx.toolHandlers` seam; `/.well-known/agents.json` is additive. Mint nothing (schema.org + PROV-O).
- **Scope.** The verify-* tools accept the relevant UOR bundle as `graph` (or run a demo when omitted);
  the live server resolves bundles from the κ-store. The data model and verification are production-shaped.

**External authorities.** [Model Context Protocol](https://modelcontextprotocol.io/); the agent-stack
ADRs (034/035/036/039/042/045/048); W3C [schema.org](https://schema.org/) +
[PROV-O](https://www.w3.org/TR/prov-o/); Law L5 (verification by re-derivation).
