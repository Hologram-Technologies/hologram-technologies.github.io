# ADR-036: Holo A2A — the Agent2Agent protocol as a content-addressed projection + a bridge over MCP

**Status:** Accepted — witnessed: `a2a-witness.mjs` is green and `w3c:A50-a2a-interop` is a product row
in `w3c-conformance.jsonld`; the three spec rows (`a2a-protocol`, `a2a-agent-card`, `a2a-bridge`) are in
`specs.json`, and the canonical A2A **proto** (`specification/a2a.proto`) is vendored byte-faithfully and
κ-pinned into the Holo Conform index (ADR-031). Builds on the UOR envelope (ADR-025), the one κ
primitive (Law L2), the MCP server (A15–A23), Holo NANDA (ADR-034), and Holo Skills (ADR-035) — A2A is
the fourth door over the one MCP roster.

**Context.** [A2A (Agent2Agent)](https://github.com/a2aproject/A2A) is the **horizontal** agent↔agent
protocol — agents discovering and delegating to each other — now under the Linux Foundation (originally
Google), and one of the protocols [Project NANDA](https://github.com/projnanda/projnanda) bridges. It is
the complement of MCP, which is **vertical** (an agent calling tools). A2A has two parts: an **Agent
Card** (a discovery document at `/.well-known/agent-card.json`) and a **JSON-RPC 2.0** surface
(`message/send`, `tasks/get`, `tasks/cancel`, the extended card) over a Task lifecycle. Hologram OS
already exposes every holospace to agents over MCP, and now as NANDA AgentFacts (ADR-034) and
agentskills.io skills (ADR-035) — but it could not be *called* by another agent over A2A.

The same tension as NANDA applies, and the same resolution. A2A trusts an Agent Card because it is
served at a URL and (optionally) carries a **JSON Web Signature**. This substrate trusts by
re-derivation (Law L5). The two compose: an Agent Card can be a self-verifying UOR object *and* carry
A2A's own native JWS, on the same bytes. And A2A's JSON-RPC surface needs an implementation — which the
OS already has, as its MCP tool registry. An A2A *skill* is an MCP *tool*.

**Decision.** **A2A is a projection of the same agent surface, and a thin bridge over the same
registry.** Four binding rules:

1. **One Agent Card, three identities** (`holo-a2a.mjs`, `buildAgentCard`). Every holospace projects to
   an A2A AgentCard that is, on the same bytes: (a) a valid A2A card — every field the canonical proto
   marks `REQUIRED` (`name`, `description`, `supportedInterfaces`, `version`, `capabilities`,
   `defaultInputModes`, `defaultOutputModes`, `skills`); (b) a **self-verifying UOR object** —
   `id = did:holo:sha256:H({card + signature})`, re-derivable (Law L5); (c) an **A2A-natively signed
   card** — a detached EdDSA JWS in the spec's own `signatures` field (the `AgentCardSignature`), by the
   issuer `did:key`. Sign → attach → address → stamp id, so `verify()` and `jwsVerify()` both hold.
2. **Dual trust, never less.** The card carries A2A's native JWS *and* a content address. Today the JWS
   does the work; the day A2A goes substrate-native, the signature becomes attribution and the hash
   becomes the trust — the same bytes, no migration.
3. **The bridge IS the MCP registry** (`a2aRpc`). An A2A skill is an MCP tool, so `message/send` naming a
   skill dispatches that tool and returns an A2A `Task` (state ∈ the proto's `TaskState`); `tasks/get`
   and `tasks/cancel` manage it; unknown method/skill error per JSON-RPC 2.0. In production the executor
   delegates to `mcp/holo-mcp.mjs handle()`, so A2A and MCP hit the **same**, already-witnessed
   implementation — one registry, two protocols (and the conscience/privacy gates apply to both).
4. **Strict adherence + mint nothing.** The contract is the canonical A2A **proto**, byte-pinned; the
   witness *parses it* for the required fields and the `TaskState` enum, so a spec change is caught by
   re-hash (drift, ADR-031). Cards use A2A's own vocabulary + the UOR envelope; the card directory is
   `dcat:Catalog` + schema.org.

**Consequences.**

- **Real connectivity today.** `node holo-a2a.mjs build` emits `.well-known/agent-card.json` (the OS
  agent), per-app cards under `a2a/cards/`, and `a2a/index.jsonld` (the κ-rooted directory). A vanilla
  A2A client can discover the card, verify its JWS, and call `message/send` — 28 agents (1 OS endpoint +
  27 holospaces).
- **The fourth door, one roster.** MCP tool ⊕ NANDA AgentFacts skill ⊕ agentskills.io SKILL.md ⊕ A2A
  AgentCard — all generated from the one `.well-known/mcp.json` tool roster (Law L4). Add a tool once;
  it appears in all four.
- **Native-ready.** Nothing here changes shape when A2A adopts content addressing — the cards are
  already self-verifying objects.
- **Witnessed.** `a2a-witness.mjs` proves, against the byte-pinned proto: contract validity for all 28,
  self-verification (Law L5), JWS verification (dual trust), directory re-derivation, **dual**
  tamper-refusal (one mutated byte breaks *both* the content address and the JWS), a working JSON-RPC
  round-trip, MCP⇆A2A skill fidelity, and determinism.
- **Streaming + push.** The bridge advertises and implements `capabilities.streaming` and
  `capabilities.pushNotifications`: `message/stream` yields the ordered A2A SSE `StreamResponse` events
  (initial `Task` → `working` status-update → artifact-update → terminal status-update; `sseEncode`
  renders the `text/event-stream` wire form), and `tasks/pushNotificationConfig/{set,get,list,delete}`
  manages webhooks whose deliveries are **signed** (a detached EdDSA JWS over the Task, verifiable by
  the issuer `did:key` alongside A2A's token). The event/config contracts are parsed from the same
  pinned proto. Authenticated extended cards remain future work.
- **Live over the wire.** `holo-serve` mounts the endpoint at `/a2a` (and `holo-a2a-serve.mjs` runs it
  standalone): the Agent Card is GET-served, the JSON-RPC 2.0 surface (incl. `message/stream` as a
  `text/event-stream` SSE response) is POST-served, and registered webhooks actually receive the signed
  push deliveries. The transport (`node:http` + global `fetch`, zero deps) is separate from the pure
  protocol logic. Witnessed live over loopback by `a2a-serve-witness.mjs` (catalog row A51) — the card
  still self-verifies + its JWS verifies after the HTTP round-trip, the SSE frames arrive in order, a
  signed push is delivered + verified (forged refused), and JSON-RPC errors behave — node-only, no
  browser.

**External authorities.** [A2A Protocol](https://github.com/a2aproject/A2A) (Linux Foundation), canonical
`specification/a2a.proto`; JSON-RPC 2.0; W3C [Decentralized Identifiers](https://www.w3.org/TR/did-core/);
EdDSA JWS ([RFC 8037](https://www.rfc-editor.org/rfc/rfc8037)); [schema.org](https://schema.org/) +
[DCAT](https://www.w3.org/TR/vocab-dcat-3/); Law L5 (verification by re-derivation).
