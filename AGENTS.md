# AGENTS.md — Hologram OS for AI agents

The entry point for AI agents (and humans) working on or with this repository. Read this
first; see [README.md](README.md) for the full picture.

> **AI agents — start at [`/.well-known/agents.json`](system/os/.well-known/agents.json)** (a self-verifying
> discovery doc): every agent door (MCP · NANDA · A2A · Agent Skills) and the agent-stack verbs.
> Connect over MCP with `npx hologram-mcp`, then call `agent_facts`, `agent_reputation`,
> `verify_receipt`, `verify_delegation`, `verify_settlement`, `agent_passport` — every result is a
> self-verifying object you re-derive (Law L5). Verify, don't trust.
>
> **Boot the OS:** open [`index.html`](index.html) — the single gateway. It resolves the whole OS
> from one seed and runs it in the browser. **Everything is governed by the
> [Constitution](CONSTITUTION.md)** (ADR-033): a fail-closed conscience checked at every chokepoint;
> re-derive it and a single altered byte is refused (Law L5).

## What this is

An internet computer: every object is a self-verifying, W3C-linked-data node addressed by
its content (`did:holo:sha256:…`). Fetch it, get JSON-LD you understand, and re-derive the
hash to verify it — provenance and integrity with no trusted server.

## The one invariant — verify by re-derivation (Law L5)

Identity is content. An object's id is `did:holo:sha256:H(canonical-form)`. To trust
anything, re-derive its hash and compare — never trust a location or a server; a mismatch
is refused. This holds at every level of the object graph.

## How to work here

Run from `system/`:

- `npm run gate` — `node tools/gate.mjs`, the release gate: re-runs each pure-Node witness live, joins it to `os/etc/conformance.jsonld`, fails closed on any unwitnessed required row, and emits a W3C **EARL** report (`os/etc/earl-report.jsonld`).
- `node tools/<name>-witness.mjs` — run one component's conformance witness (writes `tools/<name>.result.json`).

Rules:

- **Conformance is the definition of done.** A component is complete only when its row in
  [`os/etc/conformance.jsonld`](system/os/etc/conformance.jsonld) is witnessed against an
  external authority. Add the witness with the code; the gate (`npm run gate`) must stay green.
- **Mint nothing.** Use W3C / schema.org / Dublin Core / PROV-O / EARL terms; never a
  private vocabulary where a standard term exists (ADR-024 A6).
- **The engine is read-only.** `holospaces/` is a pinned submodule consumed unmodified
  (ADR-006). Engine-level work goes upstream, not here.
- **Witnesses are pure Node where possible** (so they are green in CI); browser-only checks
  must say so and degrade honestly (never a false pass).

## The map

| Concern | Files | ADR |
|---|---|---|
| Object envelope (everything is a self-verifying object) | `holo-object.mjs` (Node) · `_shared/holo-object.js` (browser) | 0025 |
| Addressing / the holospace descriptor | `holo-descriptor.mjs` · `build-holo-site.mjs` | 0022 |
| Conformance regime | `os/etc/conformance.jsonld` · `tools/gate.mjs` · `tools/*-witness.mjs` | 0024 |
| Apps (holospaces) | `*.html` · `apps/<id>/holospace.json` (the package + MCP manifest) | — |
| Agent access (MCP) | `holo-mcp-sdk.mjs` (official SDK, pinned) · `holo-mcp-http.mjs` (HTTP + prompts) · `ask_model` (sampling, inverse direction) · `npx hologram-mcp` (`holo-mcp-launch.mjs`) · `.well-known/mcp.json` | 0025 |
| Agent discovery (NANDA — Internet of AI Agents) | `holo-nanda.mjs` (the projection) · `nanda-witness.mjs` · `.well-known/agent-facts.json` · `nanda/index.jsonld` — each holospace as a NANDA AgentFacts record ⊕ self-verifying UOR object ⊕ W3C VC (dual trust) | 0034 |
| Agent2Agent (A2A — horizontal agent↔agent) | `holo-a2a.mjs` (cards + JSON-RPC bridge over MCP) · `holo-a2a-serve.mjs` (live `/a2a` HTTP: JSON-RPC · `message/stream` SSE · signed push) · `a2a-witness.mjs` + `a2a-serve-witness.mjs` · `.well-known/agent-card.json` · `a2a/index.jsonld` — each holospace as an A2A AgentCard ⊕ self-verifying UOR object ⊕ A2A-native EdDSA JWS (dual trust) | 0036 |
| Agent reputation (verifiable, portable, tamper-evident) | `holo-agenttrust.mjs` · `agenttrust-witness.mjs` · `agenttrust/index.jsonld` — an agent's reputation as a content-addressed, append-only, hash-linked chain (one κ = the whole history); un-gameable telemetry, freshly-minted detection, real audit trails, portable reputation; closes NANDA's `AgentFacts.evaluations.auditTrail` loop | 0039 |
| Sybil-resistant issuer reputation (× HoloRank) | `holo-agenttrust-rank.mjs` · `agenttrust-rank-witness.mjs` · `agenttrust/issuer-rank.jsonld` — attestations weighted by their issuer's personalized PageRank trust (from a seed, over authorized endorsements); a Sybil flood adds exactly 0 (Cheng-Friedman defence) | 0039 |
| Agent authorization (capability delegation) | `holo-delegate.mjs` · `delegate-witness.mjs` · `delegate/index.jsonld` — UCAN capability chains: A grants B a scoped, revocable authority that is one object (UCAN ⊕ UOR ⊕ VC); escalation caught by re-derivation (principal alignment + attenuation), policy engine scopes args, revocation invalidates the subtree | 0042 |
| Verifiable multi-agent orchestration (the work receipt) | `holo-orchestrate.mjs` · `orchestrate-witness.mjs` · `orchestrate/index.jsonld` — a content-addressed execution DAG whose κ proves a whole collaboration: each step links the agent's NANDA identity ⊕ AgentTrust reputation ⊕ its UCAN delegation ⊕ its inputs ⊕ a **Constitution conscience verdict** (PROV-O); re-deriving the answer proves every step passed the conscience gate; the keystone composing 034·039·042·033 | 0045 |
| Verifiable settlement (pay against proven work) | `holo-settle.mjs` · `settle-witness.mjs` · `settle/index.jsonld` — a payer-signed x402-NP order releases a payment voucher per contributing agent ONLY if the work receipt re-derives + every step authorized + conscience-accepted (release ⇐ verifyDeep); tampered work pays nothing; the voucher κ is the txId; the capstone composing 045·042·033 → the trustless agent economy | 0048 |
| Agent discovery + use (the entry point) | `.well-known/agents.json` (self-verifying, lists every door + verb) · `mcp/holo-agent-mcp.mjs` (the stack as MCP tools: agent_facts · agent_reputation · verify_receipt · verify_delegation · verify_settlement · agent_passport) · `agents-mcp-witness.mjs` — an AI agent connects (`npx hologram-mcp`), discovers, and calls; every result self-verifying | 0049 |
| Decisions / method specs | `docs/adr/` · `docs/specs/` | — |

## Conventions

- ADRs: `docs/adr/NNNN-title.md`. Product ADRs are `0022+`; `0001–0021` are engine ADRs
  (`holospaces/docs/`).
- Commit messages: imperative; explain the *why*; a conformance change names its catalog row.
- A holospace is a package: `apps/<id>/` holds its `index.html`, worker, `holospace.json`
  manifest, and witness — and the manifest's `resources` / `tools` are what an MCP server
  exposes to you (roadmap).
