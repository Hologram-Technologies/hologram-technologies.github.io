# AGENTS.md — Hologram OS for AI agents

The entry point for AI agents (and humans) working on or with this repository. Read this
first; see [README.md](README.md) for the full picture.

> **AI agents — start at [`/.well-known/agents.json`](system/os/.well-known/agents.json)** (a self-verifying
> discovery doc): every agent door (MCP · NANDA · A2A · Agent Skills) and the agent-stack verbs.
> Connect over MCP with `npx hologram-mcp`, then call the tools it advertises — read the live list
> with `tools/list` or from [`mcp.json`](system/os/usr/lib/holo/mcp/.well-known/mcp.json) (e.g.
> `verify_object`, `resolve_object`, `own_verify`, `own_settle`, `own_passport`). Every result is a
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

## Build topology — one source, generated derivatives

The canonical OS is THIS tree, `system/os/` (GitHub Pages deploys it; sealed by `npm run reseal`,
verified by `npm run reseal:check`). Everything else is **generated** from it — never hand-edit a
derivative, and never audit one as if it were source:

- The **native desktop image** `holo-apps/apps/tauri/dist/` is built by `apps/tauri/make-dist.mjs` (the
  Tauri `beforeBuildCommand`): it materializes the `holo-fhs-map.mjs` rules ahead of time, self-seals,
  and bakes the worker `CLOSURE_KAPPA` anchor. It is **gitignored** — a stale local `dist/` is a build
  leftover, not a source. **Audit and seal `system/os/`, never a build output.** (A stale `dist/`
  derailed the 2026-06-20 self-reflection audit; `make-dist.mjs` now fails loud if the OS source is
  missing rather than silently building an empty image.)
- `/_shared/*`, `/apps/<id>/*`, `/home.html`, … are flat-URL **aliases** of the FHS tree via
  `lib/holo-fhs-map.mjs` (e.g. `_shared/* → usr/lib/holo/*`), not physical copies — there is no
  `_shared/` dir in `system/os/`.

Reseal after any `system/os/` edit with `npm run reseal` — ONE entrypoint, dependency-correct order:
boot closure (`reseal-drift`) → SW anchor (`holo-anchor-sw`) → served tree (`seal-served`). The CI gate
`npm run reseal:check` fails on any served-byte-≠-pinned-κ drift across the boot closure AND the whole
tree.

## The map

| Concern | Files | ADR |
|---|---|---|
| Object envelope (everything is a self-verifying object) | `holo-object.mjs` (Node) · `_shared/holo-object.js` (browser) | 0025 |
| Addressing / the holospace descriptor | `holo-descriptor.mjs` · `build-holo-site.mjs` | 0022 |
| Conformance regime | `os/etc/conformance.jsonld` · `tools/gate.mjs` · `tools/*-witness.mjs` | 0024 |
| Apps (holospaces) | `*.html` · `apps/<id>/holospace.json` (the package + MCP manifest) | — |
| Agent access (MCP) | `holo-mcp-sdk.mjs` (official SDK, pinned) · `holo-mcp-http.mjs` (HTTP + prompts) · `ask_model` (sampling, inverse direction) · `npx hologram-mcp` (`holo-mcp-launch.mjs`) · `.well-known/mcp.json` | 0025 |
| Agent authorization (UCAN delegation) — **built, witnessed** | `holo-delegate.mjs` · `tools/holo-delegate-witness.mjs` — scoped, revocable UCAN capability chains: A grants B a narrow authority; escalation is caught by re-derivation (principal alignment + attenuation), revocation invalidates the subtree | 0042 |
| Provable ownership & settlement — **built, witnessed** | `holo-own.mjs` · `tools/holo-own-witness.mjs` · MCP `own_verify` / `own_settle` / `own_passport` — re-derive a Title chain to prove who controls an object now, and settle value against a *proven* head (pay-for-proven; a forged or tampered title releases nothing). **Provenance is delivered** (who controls a κ; an *issuer-bound* asset Title additionally proves the originator — a competing genesis to the same asset κ is structurally impossible). **Exclusive transferable title is not** — double-genesis and double-transfer are forks resolved only by an ordering anchor (`detectForks` + `resolveForkByAnchor` + chain rail, Layer-2), never by local content-addressing alone | 0053 |
| Verifiable multi-agent orchestration (the work receipt) — **built, witnessed** | `holo-mind-orchestrate.mjs` · `tools/holo-mind-orchestrate-witness.mjs` — a content-addressed PROV-O work DAG whose root κ proves a whole collaboration: each step carries a **Constitution conscience verdict**, so re-deriving the root proves every step passed the gate | 0081 (idiom 0045) |
| Agent economy (Bittensor bridge) — **built, witnessed** | `holo-bittensor.mjs` · `tools/holo-bittensor-witness.mjs` · `bittensor_*` MCP tools | 0071 |
| Agent identity (NANDA · A2A) — **datasets live; modules roadmap** | self-verifying datasets are present: `.well-known/agent-facts.json` + `srv/nanda/index.jsonld` (NANDA AgentFacts), `.well-known/agent-card.json` + `srv/a2a/index.jsonld` (A2A AgentCard). The live `holo-nanda.mjs` / `holo-a2a*.mjs` projections + `agent_facts` tool are ADR-specced, **not yet wired** | 0034 · 0036 |
| Agent reputation (AgentTrust) — **roadmap** | a content-addressed, append-only, tamper-evident reputation chain. Specced; **not yet implemented** (no module, no MCP tool) | 0039 |
| Verifiable x402 settlement — **roadmap** | a payer-signed x402 voucher released only against a re-derived work receipt. Specced; **not yet wired** — today, settlement runs through `own_settle` (pay against a proven title, ADR-0053) | 0048 |
| Agent discovery + use (the entry point) | `.well-known/agents.json` (self-verifying, lists every door) · `mcp/holo-mcp.mjs` (the MCP server; its live tool list — `own_verify` · `own_settle` · `own_passport` · the `bittensor_*` agent-economy tools — is published at `.well-known/mcp.json` and via `tools/list`) — an AI agent connects (`npx hologram-mcp`), discovers, and calls; every result self-verifying | 0049 |
| Decisions / method specs | `docs/adr/` · `docs/specs/` | — |

## Conventions

- ADRs: `docs/adr/NNNN-title.md`. Product ADRs are `0022+`; `0001–0021` are engine ADRs
  (`holospaces/docs/`).
- Commit messages: imperative; explain the *why*; a conformance change names its catalog row.
- A holospace is a package: `apps/<id>/` holds its `index.html`, worker, `holospace.json`
  manifest, and witness — and the manifest's `resources` / `tools` are what an MCP server
  exposes to you (roadmap).
