# Changelog

All notable changes to Hologram OS are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/); this project versions by content
addressing, so releases are tagged by their deployed κ rather than semver.

## [Unreleased]

### Added
- **Holo UI — minimum text size + strict canonical conformance (ADR-0057).** Added
  `--holo-font-min`, a first-class accessibility lever (default 16px; `0` = off) in the one
  canonical UI engine (`holo-theme.js` → `HoloUI`), surfaced as a "Minimum text size" control
  (Off/14/16/18/20) in the single Holo UI settings panel and carried in the content-addressed
  Holo UI profile. The floor lives in the token layer with `max()`: `holo-theme.css` floors the
  root font-size and `holo-mobile.css` floors the sub-1rem type ramp + form controls, so no text
  rendered through the `--holo-*` tokens can fall below it (the hierarchy above the floor is
  preserved; "Off" restores the raw ramp). Routed the first-party offenders that hardcoded
  sub-floor px text to `--holo-text-sm`; verbatim SDDM/Plymouth reproductions stay exempt. A new
  required gate witness (`holo-ui-conformance-witness.mjs`, catalog row `#holo-ui-conformance`)
  proves the contract is wired and not bypassed — strict conformance to one set of canonical
  parameters, enforced rather than hoped. Added `repin-shared-refs.mjs` for the deferred
  production content-address re-pin of edited shared libs.
- **The floor is enforced across every holospace application, not just the OS chrome (ADR-0057).**
  `holo-app-ui-conformance-witness.mjs` (required row `#app-ui-conformance`) is a ratchet over the
  served app repo: it fails if any app's authored `index.html` gains a sub-16px `font-size` beyond
  its committed baseline (`holo-app-ui-baseline.json` — the visible burn-down). No native application
  can introduce new too-small text; burning the baseline down only ever passes. Read-only (no app
  edits, no κ re-pin).
- **Extended the floor to the `font:` shorthand + burned down the high-traffic apps.** Both witnesses
  and `burndown-app-fontmin.mjs` now cover the `font:` shorthand's size (not just the `font-size`
  property) — closing the bypass where body-base fonts (`body{font:14px/1.5 …}`) and chips set size
  via the shorthand. Fixed 38 first-party OS-chrome shorthand offenders (incl. the shell frames
  `home.html`/`holospace.html`/`workspace.html` body fonts) → OS chrome back to 0. Burned **notepad**
  and **q** down to 0 (search was already clean); both **rendered-verified ≥16px** in Chromium
  (notepad min 16, q min 16) and relocked. The app baseline is now shorthand-inclusive (461 across 28
  apps; notepad/q at 0). Relative units (em/rem/%) that compute below the floor stay outside a static
  lint and are fixed case-by-case (e.g. notepad's `.subl`). Gate PASS (29 rows).
- **Burned down the entire app corpus + wired every app to upstream Holo UI.** Routed all 461 sub-16px
  font declarations across **32 apps** to `var(--holo-text-sm, 1rem)` (baseline now 0); a diverse
  sample including Monaco/webamp-vendored apps rendered-verified with no breakage. Added
  `holo-app-wired-witness.mjs` (required row `#app-ui-wired`): every served app must load the Holo UI
  engine (`holo-theme.js`, or via `holo-ui-kernel.js`/`holo-ui.js`) so the shell's canonical parameters
  reach + persist on every instance — forwarder stubs checked at their target. Wired the one island,
  `atlas96`. Resealed os-closure + re-pinned **100** `_shared` content-address refs across **27 apps**
  (`reseal-drift.mjs` + `repin-shared-refs.mjs`) after a reseal had 404'd the apps' engine. Gate PASS
  (31 rows). Remaining (integrity-only, not gate-blocking): per-app `holospace.lock.json` relock + the
  os-closure-root → catalog → atlas regen.
- **Extended conformance from text size to COLOR + SHAPE.** New required row `#app-ui-tokens`
  (`holo-app-token-witness.mjs`) — a no-regression ratchet on hardcoded hex colors + px `border-radius`
  that bypass the canonical `--holo-*` palette/radius tokens. Color is identity (the adopt-vs-own model
  + faithful reproductions), so it is NOT force-rewritten — the ratchet just prevents new bypasses
  (baseline 1769 across 32 apps). Radius IS safely conformable: `burndown-app-radius.mjs` adopted the
  150 exact-match radii (8/12/16px) as `--holo-radius-sm/-/-lg` pixel-for-pixel (same-px fallback),
  verified non-destructive in Chromium. Gate PASS (32 rows).
- **The OS-chrome shell frames adopt the palette.** Forcing color conformance is right for the
  canonical shell (it should follow light/dark). `home.html` reskinned — its GitHub-dark palette (74
  hex) routed to `--holo-*` tokens via a local-alias `:root` (holo value as fallback → dark identical)
  and `color-scheme: dark` → `light dark`. `find.html` referenced non-existent tokens (`--holo-fg`/
  `--holo-fg-dim`/`--holo-font`) that never followed the palette — fixed to the real names. Verified in
  Chromium: `home.html` flips dark↔light with correct contrast both ways. The transient boot intro +
  brand-purple `holospace.html` loader are left as intentional aesthetic chrome. The injected panel
  libs are the continuation (per-panel role-aware color mapping).

### Changed
- **Canonical repository root.** Slimmed the top level to the front-door set
  (`README` · `AGENTS` · `CHANGELOG` · `LICENSE`); moved `CONTRIBUTING`, `SECURITY`,
  and `CODE_OF_CONDUCT` under `.github/` (GitHub still surfaces them). Added
  `codemeta.json` — the repository described as schema.org/JSON-LD linked data
  (CodeMeta 2.0) — and a `.gitattributes` that pins text to LF so content-addressed
  `did:holo` hashes are byte-identical on every OS. Removed the five unused
  `*.yml.disabled` workflows.
- **The repository is one navigable W3C graph from its root.** `codemeta.json` now links
  (`schema:hasPart`) to every published linked-data root — the content-addressed OS image
  (`os-root.jsonld`), the W3C conformance catalog, the holospace app catalog, the Project NANDA
  agent index, and the `hosc:` vocabulary — so the whole semantic graph dereferences from one node.
  Derived + byte-pinned by `scripts/build-repo-graph.mjs` (the two content-addressed roots are linked
  by their current κ); witnessed by `repo-graph-witness.mjs` (catalog row `uor:repo-graph`) — a stale
  κ-link is a verifiable drift (Law L5). Mints nothing (schema.org/DCAT/PROV/OWL/DID).

### Added
- **Holo Agents — the agent stack, discoverable and usable by AI agents (ADR-049, catalog row A59).** The
  whole agent stack is now exposed as **MCP tools**, so any AI agent connecting to the Hologram MCP server
  (`npx hologram-mcp`) finds and uses it. Six verbs — `agent_facts`, `agent_reputation`, `verify_receipt`,
  `verify_delegation`, `verify_settlement`, `agent_passport` — are wired exactly like the other MCP
  capabilities: their definitions are added to the server's built-in tools (so they appear in `tools/list`
  **and** in `/.well-known/mcp.json` — discoverable) and their handlers are merged into `ctx.toolHandlers`
  (so they execute). Every tool returns a **self-verifying** result the agent re-derives (Law L5; *verify,
  don't trust*) — `agent_facts`/`agent_passport` return objects whose `did:holo` re-derives;
  `verify_receipt`/`verify_delegation`/`verify_settlement` re-derive their inputs and report (who acted,
  how trustworthy, under what authority, that every step passed the conscience gate, and whether work was
  proven). One unified entry point — **`/.well-known/agents.json`**, itself a self-verifying UOR object —
  lists every agent door (MCP · NANDA · A2A · Agent Skills), the verbs, and the subsystem indices, so an
  agent has a single URL to discover everything. It is the 12th root of the repository graph; mint nothing
  (schema.org + PROV-O). Witnessed by `agents-mcp-witness.mjs` (6 checks): all six verbs are in the registry
  AND in `/.well-known/mcp.json`; the entry point self-verifies and lists 4 doors + 6 verbs + 4 subsystems;
  each verb executes over the **real** MCP handler with a self-verifying result; and a tampered receipt
  verifies false / a tampered settlement releases nothing — through the very tools an agent calls.
- **Holo Settle — verifiable settlement: pay agents against PROVEN work (ADR-048, catalog row A58).** The
  capstone that closes the loop to a **trustless agent economy**. Project NANDA's payment model is
  **x402-NP** (x402 adapted for NANDA Points): the proof is a *trusted* `txId` that shows a tool was
  *called*. The UOR edge: make the payment proof a re-derivable **work receipt** (ADR-045) and condition
  release on `verifyDeep(receipt)` (Law L5). A settlement is a content-addressed escrow — a payer-signed
  `schema:Order` committing, by content address, to the exact receipt and a **split** — that releases a
  payment **voucher** per contributing agent (split by contribution, bound to its NANDA identity κ)
  **only if** the whole computation verifiably happened: the receipt re-derives, every step was
  authorized (ADR-042), and every step passed the conscience gate (ADR-033). **Tampered/unproven work
  releases nothing**; do the work and the payee releases the voucher itself by re-deriving the proof — no
  escrow agent to trust, in either direction. The voucher's κ is the content-addressed **txId**
  (idempotent → no double-spend on the same work), and a NANDA payments client reads the x402-NP fields.
  This composes the whole stack into one settleable object: identity (034) ⊕ reputation (039) ⊕
  authorization (042) ⊕ conscience (033) ⊕ the computation (045) ⊕ payment. It is the 11th root of the
  repository graph; mint nothing (schema.org Order/Invoice + VC + PROV-O + x402). Witnessed by
  `settle-witness.mjs` (11 checks): the demo settles 10000 NP split `6666/3334` by contribution; release
  happens against a re-deriving receipt and **nothing** against a tampered one; the split is conservative
  + deterministic; each voucher is bound to a real agent identity; a tampered delegation or verdict
  withholds payment; a forged voucher is refused; settlement is idempotent; the payee redeems trustlessly;
  x402-NP compatible.
- **Holo Orchestrate — the verifiable multi-agent work receipt (ADR-045, catalog row A56).** The
  keystone of the agent stack: a **content-addressed execution DAG** whose root κ is self-verifying proof
  of an entire agent collaboration. When agents collaborate to produce an answer, the computation is
  sealed as a W3C **PROV-O** bundle of self-verifying UOR objects — each step a `prov:Activity` linking,
  by content address, to the agent's **identity** (its NANDA AgentFacts κ, ADR-034), the agent's
  **reputation** (its AgentTrust chain head κ, ADR-039), the **delegation** it acted under (a UCAN
  capability, ADR-042), and its **inputs** (`prov:used` → prior steps' outputs). The final answer's κ
  commits transitively to the **entire** collaboration: re-derive it (`verifyDeep`, Law L5) and you have
  verified that every agent was who it claimed, was reputable, was authorized, and produced exactly what
  it produced — **with no orchestrator to trust.** The UOR edge over plain PROV (RDF claims you must
  trust) and signed message logs (which sign messages, not computations): verification across the **whole
  DAG** by re-derivation — tamper any intermediate step and the root κ refuses; deterministic steps
  **replay** to the same κ; a model step is **sealed** with its attestation. The answer's confidence is
  bounded by the least-reputable agent. It is the 10th root of the repository graph; mint nothing (PROV-O
  + schema.org). Witnessed by `orchestrate-witness.mjs` (11 checks): a 3-agent receipt re-derives (depth
  3); every step composes a resolving+verifying identity κ + reputation head κ + a delegation + its
  inputs; every step is authorized (out-of-scope refused); deterministic steps replay; the model step is
  sealed + tamper-evident; the data flow is honest; mutating any step breaks the receipt; the
  trust-weighted confidence is derived; deterministic. This is the precondition for a trustless agent
  economy — paying against *proven* work, not *claimed* work. **Constitutional provenance per step**
  (row A57, ADR-045 × ADR-033): every step also carries a **re-derivable conscience verdict** judged
  against the canonical Holo Constitution κ (sealed into the step via `prov:wasInformedBy`), so
  re-deriving the answer's κ *also* proves **every step passed the conscience gate**. The receipt is
  itself an audit object (P2 Provenance by construction) and the kill switch (P7) is supreme — a
  red-line block or a tripped kill switch hard-refuses and the whole orchestration **halts**
  (fail-closed); a tampered verdict breaks the receipt. The answer now proves not just who acted, how
  reputable, and under what authority, but that every step was **constitutionally permitted**.
- **Holo Delegate — verifiable, content-addressed capability chains (ADR-042, catalog row A54).**
  The authorization sub-layer beneath the agent stack: agent A grants agent B a **scoped, revocable
  authority** that is a self-verifying object. The model is [UCAN](https://github.com/ucan-wg/delegation)
  (decentralized, did-keyed, *attenuating* capability chains). Each delegation is, on the same bytes, a
  valid UCAN delegation (`iss · aud · sub · cmd · pol · nonce · exp`), a **self-verifying UOR object**
  (`id = did:holo` over its content), and a **W3C Verifiable Credential** (`eddsa-jcs-2022` — and per UCAN
  the signature **binds to `iss`**). It references its parent by **content address** (`prov:wasDerivedFrom`),
  so the whole proof chain is a UOR Merkle-DAG that re-derives end-to-end (`verifyDeep`, Law L5) — and the
  two escalation guards are caught **by re-derivation, not by trusting an orchestrator**: **principal
  alignment** (each proof's `aud` = the next `iss`; the chain roots in the subject) and **attenuation** (a
  child's `cmd` nested under its parent's; the effective policy/expiry is the conjunction/min over the
  chain — a child can only narrow). A UCAN policy engine (`==, !=, <, <=, >, >=, like, and, or, not`)
  scopes the invocation's arguments. **Revocation** is a content-addressed, append-only signed object that
  invalidates the **whole subtree** and cannot be un-said. The canonical UCAN spec is vendored
  byte-faithfully and κ-pinned; the delegation index is the 9th root of the repository graph. Mint
  nothing (UCAN vocab + W3C DID/VC + PROV-O). Witnessed by `delegate-witness.mjs` (12 checks): a
  legitimate `owner → A → B` chain re-derives and a scoped invocation authorizes, while the verifier
  independently refuses every attack — principal misalignment, command escalation, out-of-scope /
  policy-violating invocation, a chain rooted in the wrong authority, a revoked subtree, an expired link,
  a tampered byte, and an impersonated signature; deterministic.
- **Holo AgentTrust — verifiable, portable, tamper-evident agent reputation (ADR-039, catalog row A52).**
  The UOR answer to the trust problems Project NANDA's papers + community voice but leave open. An
  agent's reputation is a **content-addressed, append-only, hash-linked chain**: each attestation
  (genesis · uptime measurement · accredited certification · peer review · revocation) is a
  self-verifying UOR object carrying its **issuer's** W3C Data Integrity signature (`eddsa-jcs-2022`) and
  a `prov:wasDerivedFrom` Merkle link to the previous head — so **one κ commits to the agent's whole
  history**, and re-deriving it (`verifyDeep`, Law L5) verifies all of it. The decisive edge over
  NANDA's signature-only model: signatures prove *who* asserts a fact *now*; the chain proves the
  **history wasn't rewritten** — change any past byte and the head no longer re-derives. This directly
  answers the documented gaps: **un-gameable telemetry** (evaluations are *recomputed* from the chain,
  not self-reported — a claimed uptime the chain doesn't support is caught), **freshly-minted detection**
  (a genesis-only identity is flagged — the *BasisOS $531K fraud* signal: "no history showing the
  identity was freshly minted"), **real audit trails** (the AgentFacts `evaluations.auditTrail` becomes a
  `holo://κ` that *resolves* to the chain — NANDA left this "no audit architecture specified"),
  **self-asserted vs third-party** (per-entry signer), **irreversible revocation** (committed into the
  head κ), and **portable reputation** (the κ *is* a CIDv1 — the same object in every registry / on IPFS,
  surviving the "portable reputation 35% problem"). Mint nothing: schema.org (Review/Rating/Certification/
  Observation) + W3C VC + PROV-O + NANDA's own `af:` telemetry vocab; the directory is DCAT, and it is the
  8th root of the repository graph (`codemeta.json`). `node holo-agenttrust.mjs build` emits the OS
  agent's full chain, the κ-rooted directory (every agent's head κ + recomputed summary), and the enriched
  AgentFacts. Witnessed by `agenttrust-witness.mjs` (12 checks): all 28 chains re-derive, every
  attestation's proof verifies across ≥3 distinct issuers, rewriting any past entry breaks the head, the
  summary is deterministic, a forged availability claim is caught, and freshly-minted / revocation /
  portability (κ↔CIDv1) / auditTrail-resolves all hold — the enriched AgentFacts still validates against
  the byte-pinned upstream schema. **Sybil-resistant issuer reputation** (row A53,
  `holo-agenttrust-rank.mjs`): the chain proves history is un-*rewritable*; weighting each attestation by
  its **issuer's** trust — a Personalized PageRank (HoloRank) from a trusted seed over the issuer
  *endorsement* graph, guarded by authorization (`by === from` + proof, so you can't forge "the root
  endorses me") and personalization (a self-endorsing Sybil clique is unreachable → scores 0) — makes it
  un-*floodable*. An unendorsed Sybil scores **exactly 0**, so flooding a chain with 120 validly-signed
  Sybil reviews leaves the trust-weighted reputation **unchanged** (`0.723615 → 0.723615`) while the raw
  and distinct-issuer counts explode (`3 → 123`): the Cheng & Friedman result (counting work is
  exploitable; personalized trust is the escape) made concrete and re-derivable, witnessed by
  `agenttrust-rank-witness.mjs`.
- **Holo A2A — Agent2Agent protocol interoperability (ADR-036, catalog row A50).**
  Hologram OS now speaks [A2A](https://github.com/a2aproject/A2A) — the **horizontal** agent↔agent
  protocol (Linux Foundation; originally Google) that NANDA bridges, the complement of MCP's vertical
  agent↔tools. Every holospace is projected into an A2A **Agent Card** that is, on the same bytes, three
  things at once: a valid A2A card (every field the canonical proto marks `REQUIRED`), a **self-verifying
  UOR object** (a `did:holo` that re-derives from its own content, Law L5), and an **A2A-natively signed**
  card (a detached EdDSA **JSON Web Signature** in the spec's own `signatures` field). **Dual trust:** a
  vanilla A2A client verifies the JWS today; a UOR-native one re-derives the content address. The
  **bridge** runs A2A **JSON-RPC 2.0** (`message/send` · `tasks/get` · `tasks/cancel`) over the MCP tool
  registry — an A2A *skill* IS an MCP *tool*, so `message/send` dispatches a tool and returns a valid A2A
  `Task`; in production the same handler serves both protocols (so the bridge inherits MCP's witnessed
  implementation, conscience + privacy gates included). The **fourth door** over the one
  `.well-known/mcp.json` roster (MCP tool ⊕ NANDA AgentFacts skill ⊕ agentskills.io SKILL.md ⊕ A2A
  AgentCard) — now also linked from `codemeta.json` so the whole repo is one navigable W3C graph
  (`build-repo-graph.mjs` / `repo-graph-witness.mjs`). **Streaming + push:** the bridge advertises and
  implements `capabilities.streaming` (`message/stream` → ordered A2A SSE `StreamResponse` events:
  Task → working → artifact → terminal status-update, with a `text/event-stream` encoder) and
  `capabilities.pushNotifications` (`tasks/pushNotificationConfig/{set,get,list,delete}` over webhooks
  whose deliveries carry a **signed** detached EdDSA JWS, verifiable by the issuer `did:key`). The
  canonical A2A proto is vendored byte-faithfully and κ-pinned; the witness *parses it* for the required
  fields + `TaskState`/event/push contracts (drift is one re-hash away, ADR-031). `node holo-a2a.mjs build`
  emits `.well-known/agent-card.json`, `a2a/index.jsonld`, and per-app cards. Witnessed by
  `a2a-witness.mjs` (18 checks): all 28 cards (1 OS endpoint + 27 apps) satisfy the proto-derived
  contract, self-verify, and their JWS verify; the κ-rooted directory re-derives; a single mutated byte
  breaks **both** trust models; the JSON-RPC round-trip, the SSE stream, and the signed push delivery all
  work; every MCP tool maps to exactly one A2A skill; deterministic. **Live over the wire** (row A51):
  `holo-serve` mounts the endpoint at `/a2a` (`holo-a2a-serve.mjs`, also runnable standalone) — the Agent
  Card is GET-served, the JSON-RPC surface (incl. `message/stream` as `text/event-stream` SSE) is
  POST-served, and registered webhooks actually receive the signed push deliveries; witnessed live over
  loopback HTTP by `a2a-serve-witness.mjs` (node-only: card + JWS survive the round-trip, SSE frames
  arrive ordered, a signed push is delivered + verified, JSON-RPC errors behave).
- **Holo Skills — Agent Skills (agentskills.io) interoperability (ADR-035, catalog row A49).**
  Every Hologram OS capability is published as an [Agent Skill](https://agentskills.io) — the open
  `SKILL.md` standard (originally Anthropic) that the Nous Research
  [Hermes Agent](https://github.com/nousresearch/hermes-agent) "skills" feature consumes — discoverable
  at **`/.well-known/skills/index.json`**. Each skill is, on the *same* bytes, two things at once: a
  **valid Agent Skill** (frontmatter satisfying the spec — `name` ≤ 64 lowercase+hyphen matching its
  directory, `description` 1–1024 — that a vanilla skills client loads unchanged) **and** committed by a
  **self-verifying UOR object** (the skill's metadata is a `did:holo` that Merkle-links the real
  `SKILL.md` bytes; re-derive the κ-rooted index and every skill's bytes re-derive beneath it,
  `verifyDeep`, Law L5). Built deterministically from the OS MCP tool roster
  ([`.well-known/mcp.json`](os/.well-known/mcp.json) — *one source, three doors: an MCP tool ⊕ a NANDA
  AgentFacts skill ⊕ an agentskills.io `SKILL.md`*; Law L4) by [`holo-skills.mjs`](os/holo-skills.mjs) —
  `node holo-skills.mjs build` emits `skills/<name>/SKILL.md` (22 skills), `.well-known/skills/index.json`,
  and `skills/index.jsonld`. Mint nothing (schema.org/DCAT/Dublin-Core/PROV-O + agentskills.io's own
  `skills` field). The upstream format spec is vendored byte-faithfully and κ-pinned into the Holo Conform
  index (ADR-031). Witnessed by [`holo-skills-witness.mjs`](os/holo-skills-witness.mjs): all 22 validate
  against the byte-pinned spec, self-verify, the index re-derives through the `SKILL.md` leaf (depth ≥ 2),
  byte-exact leaves, a single mutated byte is refused, the projection is deterministic, the committed
  artifacts equal a fresh re-derivation, and it mints nothing.
- **Holo NANDA — Internet of AI Agents interoperability (ADR-034, catalog row A48).**
  Every Hologram OS holospace is projected into [Project NANDA](https://github.com/projnanda/projnanda)
  (MIT) as a self-verifying agent. One document is, on the same bytes, three things at once: a valid
  NANDA **AgentFacts** record (so NANDA tools read it), a **self-verifying UOR object** (a `did:holo`
  that re-derives from its own content, Law L5), and a **W3C Verifiable Credential** (a
  `DataIntegrityProof`, `eddsa-jcs-2022`). **Dual trust:** a vanilla NANDA resolver verifies the
  *signature* today; a UOR-native one re-derives the *content address* — so the projection provides
  real connectivity now and is native-ready for when NANDA adopts the substrate (the signature becomes
  attribution, the hash becomes the trust — no migration). The **NANDA Index** records point at content
  addresses — `primary_facts_url = holo://κ` and `private_facts_url = ipfs://<cidv1>` over the *same*
  sha-256 κ (a κ *is* a CIDv1, the `os-peers` law) — so discovery self-resolves with no registry server
  to trust. Mint nothing: schema.org/DCAT for the catalogue, W3C DID + VC for identity/attribution, and
  NANDA's *own* published `af:` vocabulary for agent terms. Built deterministically from what already
  exists (`apps/index.jsonld` + each `holospace.json` + `.well-known/mcp.json`) by
  [`holo-nanda.mjs`](os/holo-nanda.mjs) — `node holo-nanda.mjs build` emits `.well-known/agent-facts.json`,
  `nanda/index.jsonld`, and per-app AgentFacts; the upstream AgentFacts JSON Schema is vendored
  byte-faithfully and κ-pinned into the Holo Conform index (ADR-031). Witnessed by `nanda-witness.mjs`:
  all 28 agents (1 OS endpoint + 27 holospaces) validate against the pinned schema, self-verify, and
  their proofs verify; the κ-rooted index re-derives; a single mutated byte breaks **both** trust
  models; κ⇆CIDv1 equivalence holds; deterministic.
- **Easter egg — *On Liberty* published natively to the UOR substrate (catalog row A24).**
  John Stuart Mill's *On Liberty* (1859, [Project Gutenberg #34901](https://www.gutenberg.org/ebooks/34901),
  public domain) is published as a self-verifying linked-data Merkle-DAG (`apps/liberty/`):
  the root `did:holo` commits to every word, so re-deriving it verifies the whole book with
  no server (Law L5). It is the repository's claim made tangible on one famous artifact —
  a content-addressable substrate that unlocks self-verifying, serverless applications,
  proven by the canonical argument that no authority deserves blind trust. A hidden reading
  room (`apps/liberty/index.html`, not in the Hub catalog) re-derives every node in the
  browser and demonstrates live tamper-refusal; the book is reachable over MCP as a
  self-verifying resource plus a `read_liberty` tool. Built deterministically + offline by
  `build-liberty.mjs` from the vendored source (pinned by κ); witnessed by `liberty-witness.mjs`.
- **W3C / open-semantic-web conformance regime (ADR-024).** A declared catalog
  (`w3c-conformance.jsonld`) and a strict enforcement gate (`w3c-gate.mjs`, wired into the
  Pages build) that blocks any non-conformant build. Emits a W3C **EARL** report.
- **`did:holo` DID method** ([spec](docs/specs/did-holo-method.md)) — self-certifying,
  content-derived identity conforming to W3C DID Core.
- **The UOR object envelope (ADR-025)** — *everything is a self-verifying linked-data
  object*: a content-derived `did:holo`, content-addressed Merkle-DAG links, recursive
  resolve-and-verify (`holo-object.mjs` + the browser `_shared/holo-object.js`).
- **Holo Music adopts UOR** — the library projects to a self-verifying κ-DAG (artist →
  album → song → audio); the player consumes the graph and verifies the *object* on play,
  not just the audio bytes.
- **MCP server scaffold** — `holo-mcp.mjs` generates a Model Context Protocol server from
  the `holospace.json` manifests; resources are self-verifying UOR objects and a built-in
  `verify_object` tool lets an agent re-derive any `did` (catalog row A15).
- **Official MCP SDK, vendored + pinned (Law L5)** — `holo-mcp-sdk.mjs` builds the canonical
  server on `@modelcontextprotocol/sdk` 1.29.0 (unmodified), bridged into the UOR substrate.
  A real official Client↔Server handshake is witnessed (A16), and the tool registry projects
  to OpenAI + Anthropic tool schemas — so any agentic runtime can call a holospace.
- **MCP prompts + Streamable HTTP transport** (`holo-mcp-http.mjs`, A17) with a
  `.well-known/mcp.json` discovery doc — toward feature-complete MCP, reachable on the open web.
- **Live OpenAI Agents SDK consumer** (A18) — the official `@openai/agents` SDK connects to
  the Hologram MCP server over HTTP and discovers its tools; witnessed. The LLM run is gated
  behind `OPENAI_API_KEY`.
- **MCP sampling — the inverse direction** (A19) — a holospace can ask the connected agent's
  OWN model (`ask_model`, server-initiated `createMessage`); witnessed round-trip with a
  sampling-capable client. The OS borrows the agent's intelligence.
- **One-command launch + deploy discovery** (A20) — `npx hologram-mcp` (stdio, or `--http`);
  the Pages build publishes `/.well-known/mcp.json`, generated from the manifests.
- **MCP feature-complete primitives** (A21) — completions, roots, elicitation (`ask_user`),
  and resource subscriptions, alongside the earlier resources/tools/prompts/sampling.
- **Publishable `hologram-mcp` package** (A22) — `crates/holospaces-mcp`, a standalone npm
  package for a real `npx hologram-mcp`; proven by build + `npm pack` + tarball-install + run.
- **MCP protocol housekeeping** (A23) — logging, pagination, progress, and cancellation; the
  MCP surface is now feature-complete.
- **Review hardening** — the HTTP transport is now **stateful** by default, so the inverse
  direction (sampling/elicitation/roots) and notifications work over HTTP, not just stdio
  (witnessed); a built-in self-verifying sample resource (`holo://sample`) ships out of the
  box; input validation + proper unknown-tool errors; aligned dependency-free/​SDK tiers;
  refreshed `.well-known/mcp.json`.
- **Repository presentation** — `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, this changelog; ADRs relocated to `docs/adr/` and indexed; the
  `apps/<id>/holospace.json` package convention documented and schema'd (MCP-ready).

### Changed
- Holospace descriptors mint **no bespoke vocabulary** (ADR-024 A6): `schema:SoftwareApplication`
  + `prov:Entity`, schema.org domain profiles; `specs.json` projects to DCAT + schema.org.
- Accessibility (WCAG 2.2) is enforced as a **no-regression ratchet**; a root-cause sweep
  cut real violations from 131 to 13 and made the strict gate ship green.

### Notes
- The engine (`holospaces/`) remains a pinned, unmodified submodule (ADR-006).
