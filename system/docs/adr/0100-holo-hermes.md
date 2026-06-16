# ADR-0100 — Holo Hermes: a native, in-tab, κ-anchored Hermes-compatible agent on the Q door (+ bidirectional interop)

Status: **DRAFT — DESIGN ONLY**, EXCEPT the "biggest unlock" (the GEPA-style evolving-skill loop), which is **LANDED + witnessed (9/9)**. Findings sourced from deep-research run `wf_259d3784-e6f` (23 primary sources, 22 verified claims, 3 refuted). Pin any implementation to a specific Hermes commit/tag — the project is fast-moving (tags v0.2.0→v0.16.0 / v2026.5.16 seen within months) and backend/provider counts drift.

> **Implementation note (landed 2026-06-16).** Investigating the strongest additive borrow (GEPA reflective
> evolving skills) revealed the optimizer ALREADY EXISTS in Hologram: `holo-mind-evolve.mjs` (ADR-0081
> Phase-2) is a GEPA/DSPy-style reflective optimizer (`failures → evolvePrompt/proposeRevision → evolve →
> sealSkillRevision` with κ-lineage `prov:wasRevisionOf` + governed `isInForce` + agentskills.io
> `projectSkill`), and `holo-factory-grow.mjs` already bridged failures→optimizer. The genuine gap was
> WIRING: the Factory's `grow` never projected the verified skill live, never chained the lineage, and the
> evolved procedure never fed the change step. **Closed now:** new pure `growSkill()` transform
> (`holo-factory-grow.mjs`) grows → projects the in-force skill → advances the κ-addressed lineage head
> (verified generations only); `Q.factory.grow` (`holo-mind-ui.js`) consumes it — projects live into the
> durable `learnedSkills` roster, persists the lineage head, and injects the evolved procedure into the
> change step (learn → act). Witnessed by `holo-factory-grow-witness.mjs` (9/9, +3 new: `growSkillProjects`,
> `lineageChains`, `failingGateNoAdvance`). New door surface: `Q.factory.grow` (now loop-closing) + `Q.factory.skill`.
> This is an ADR-0097/0081 enhancement motivated by the Hermes research — the broader Hermes RUNTIME below
> stays DESIGN ONLY.
>
> **Hands-off self-improvement (landed same day).** The autonomous tender now self-improves during a
> `watch()`: `Q.factory.watch(intent, { grow: true | { minFailures?, gate? } })` (and `Q.factory.tend({ grow })`)
> run the optimizer after a pass once ≥`minFailures` NEW failures accrue. Prerequisite fix: `tend()` now
> threads + publishes the SHARED corpus head (`getHead`/`setHead`), so a watch session's failures accumulate
> on ONE chain and `failures()` can see them (previously the tender's factory froze its head — failures were
> invisible siblings). GOVERNANCE PRESERVED (ADR-0033 rule 4): auto-grow is OPT-IN (default off) and the
> succession gate still rules — with the default empty gate a revision seals (κ + audit trail) but is NOT in
> force (a proposal awaiting ratification), so fully hands-off evolution cannot silently change behaviour;
> pass a passing gate to allow live projection that session. No churn (fires only on NEW failures).
> Witnessed by `holo-factory-tend-witness.mjs` (9/9, +1: `headThreads`).
Relates: [[holo-q-mux-specialists]] (ADR-0091, one door `window.Q`) · [[holo-q-fuse-adr]] (ADR-0098, panel→judge→synthesize) · [[holo-recall-adr]] (ADR-0099, κ-graph retrieval over the PRIVATE corpus) · [[holo-mind-adr]] (ADR-0081, self-evolving fabric) · [[holo-factory-adr]] (ADR-0097, signal→change→verify→seal→learn + watch/tend) · [[holo-q-remote-model]] (ADR-0090, governed remote-LLM seam) · [[holo-import-adr]] (ADR-0092/0093, GitHub→Holo app + agent-native wiring + governed egress) · [[holo-q-model-registry]] (ADR-0096, the on-device brain) · ADR-0051 (Holo Forge κ-transform) · ADR-0033/0083 (conscience) · ADR-0082 (PROV-O receipts)

## Context

Nous Research's **Hermes Agent** (MIT, Copyright (c) 2025 Nous Research; launched ~Feb 2026) is a
persistent, self-improving AI operator. The user's ask is threefold and ordered: (1) understand its
real architecture; (2) borrow the genuinely-missing features into the Q door; (3) **install and run a
Hermes agent natively inside Hologram — 100% serverless in-tab, anchored in the κ-addressable
substrate, reusing the existing stack** — plus seamless interop.

### What Hermes actually is (verified from primary sources)

- **A server-oriented Python stack, not a browser app.** The core is a *synchronous Python
  orchestration engine* (`AIAgent` in `run_agent.py`) fronted by an always-on host: a CLI (`cli.py`),
  an always-on API gateway (`gateway/run.py`), and an IDE ACP adapter over stdio/JSON-RPC. Prereqs:
  `uv, Python 3.11, Node.js, ripgrep, ffmpeg`. Language bar **Python 82.4% / TypeScript 13.6%**.
  [architecture.md]
- **State is a host-filesystem SQLite + FTS5 store** (`hermes_state.py`, `~/.hermes/state.db`, WAL):
  `messages_fts` (unicode61 + trigram), parent/child lineage across compressions, per-platform
  isolation via a `source` column (`cli`/`telegram`/`discord`). [architecture.md, hermes_state.py]
- **An on-disk state tree** `~/.hermes/` (rooted at `HERMES_HOME`): `config.yaml`, `.env`,
  `auth.json`, `memories/` (MEMORY.md, USER.md), `skills/` (agent-created), `sessions/`, `logs/`,
  plus `SOUL.md`, `cron/`. [configuration.md]
- **A self-registering tool registry** — each `tools/*.py` registers at import time; 70+ tools across
  ~28 toolsets, dispatched via `model_tools.handle_function_call()` across three API modes
  (`chat_completions` / `codex_responses` / `anthropic`). [architecture.md]
- **Six OS-level terminal backends** — local, Docker, SSH, Daytona, Modal, Singularity; the safe
  default starts *one long-lived Docker container* and routes every terminal/file/execute_code call
  through `docker exec`. The docs state plainly: *"None of these backends run inside a web browser
  tab."* [architecture.md, configuration.md, security]
- **A clean provider resolver** mapping `(provider, model) → (api_mode, api_key, base_url)` over 18+
  providers with OAuth, credential pools, alias resolution; a **`base_url` override bypasses the
  provider** and authenticates with `api_key`/`OPENAI_API_KEY`. Local models via Ollama/vLLM/
  llama.cpp/SGLang or *any OpenAI-compatible server*. [architecture.md, configuration.md, faq.md]
- **A closed learning loop** — after a complex task (~5+ tool calls) it autonomously writes a reusable
  Markdown skill via `skill_manage` (curator-graded, archived after 90 days unused); agent-curated
  memory with periodic nudges; FTS5 session search + LLM summarization for cross-session recall;
  compatible with the **agentskills.io** open standard (SKILL.md). [README, hermes-agent.org]
- **A separate self-evolution repo** — `hermes-agent-self-evolution` uses **DSPy + GEPA**
  (Genetic-Pareto / Reflective Prompt Evolution, arXiv:2507.19457, ICLR 2026 Oral): reads execution
  traces to diagnose *why* things fail, proposes targeted prompt/skill/code edits, **no GPU, ~$2–10
  per run**. [self-evolution README, dspy.ai/GEPA]
- **No telemetry by default**; data stays local in `~/.hermes/`. This *aligns with* Hologram's
  no-lock-in / no-telemetry constraint — preserve it. [faq.md, LICENSE]

**Explicitly unverified / refuted (do not rely on):** the "100k+ stars" and funding figures could not
be confirmed against any primary source — treat as marketing. Refuted 0-3: skills as 15 KB-capped
SKILL.md files that *are* the memory store (skills and the SQLite session store are distinct); a
fansite "200+ models / 100% self-hosted" framing; a "v0.16.0 copyright 2026" version claim.

### The load-bearing reality: most of Hermes already exists in Q

Every *high-level* Hermes capability maps onto a Q-door surface we already shipped — so this is not
"build an agent runtime," it is "borrow the few missing behaviors and honor Hermes's formats." The
genuinely-incompatible parts are all *runtime substrate* (Python/Node host, always-on gateway, the
on-disk tree, the six terminal backends), and the operator constraint already tells us where those
go: outside the tab, reachable only through existing governed doors.

## Decision (provisional)

Add **one new verb family on the existing door** (ADR-0091) — no parallel door, no new transport, no
new store, no new gate (Law L4). Working name **`Q.hermes`**, implemented in `q/holo-q-hermes.js` as a
thin orchestrator. Three correctness-critical reframings from the research:

1. **"Install the repo" is mostly infeasible as a bundle — re-implement the loop natively instead.**
   Hermes is 82% Python; Holo Import + Forge esbuild-wasm (ADR-0092) bundles JS/TS, so it can vendor
   the TypeScript surface, the `agentskills.io` skills, and the config — **not** the `AIAgent` Python
   engine. The native path is a small Hermes-*compatible* loop hosted on the Q door that **reads
   Hermes's formats** (skills, sessions, provider config) rather than executing Hermes's process.
   (A Pyodide-hosted Python slice is a research fold-in, not the baseline — see Consequences.)
2. **Borrow behaviors, not substrate.** Adopt the skill self-write loop, the GEPA reflective
   optimizer, the `agentskills.io` standard, and the `base_url` provider seam. Reject the host
   process, the gateway, the `~/.hermes/` tree as-is, and the six OS/container terminal backends.
3. **Heavy execution is out-of-tab infrastructure, declared honestly (L5).** Docker/SSH/Modal/
   Daytona/Singularity cannot run in a tab. They are reachable only via governed egress to an external
   host; the in-tab build never fakes them.

### What is reused vs new

| Capability | Status | Where |
|---|---|---|
| One door, verb-additive surface | reuse | `holo-q.js` (`create/ask/fuse/recall/agent/…`) |
| Persistent memory + self-search (vs SQLite+FTS5 `~/.hermes/state.db`) | **already-covered** | `Q.recall` · `holo-q-recall.js` · `holo-q-corpus.js` (ADR-0099, hybrid vector⊕BM25⊕graph) |
| Compound / multi-model reasoning | **already-covered** | `Q.fuse` · `holo-q-fuse.js` (ADR-0098) · mux (ADR-0091) |
| Model-agnostic providers + `base_url` seam | **already-covered** | `holo-q-remote.mjs` · `-remote-client.mjs` · `-boost.js` (ADR-0090) |
| NL scheduling + async subagents | **already-covered** | `Q.factory.watch/tend` + edge-ticker (ADR-0097) |
| Multi-surface / tool dispatch (vs self-registering registry) | **already-covered** | MCP + `/~<app>/api` REST seams · governed egress (ADR-0093) |
| On-device inference (local OpenAI-compatible provider) | reuse | Holo Q ternary WASM floor (ADR-0096) |
| Receipt canonicalization + Law-L5 re-derivation | reuse | `holo-q-receipt.mjs` |
| Repo → sealed κ app (TS/skills/config only, **not** the Python engine) | reuse (partial) | `holo-import.mjs` · `holo-forge-bundle.mjs` (ADR-0092) |
| **Event-driven skill self-write loop (after N tool calls) + agentskills.io ingest** | **new (additive borrow)** | `holo-q-hermes.js` → writes κ-skills for Holo Mind/Factory |
| **GEPA reflective optimizer (trace→diagnose-why→propose edit→verify→seal)** | **new (strongest borrow)** | `holo-q-hermes.js` optimizer; fills Factory's failures→optimizer gap (ADR-0097) |
| **Hermes-compatible agent loop hosted on Q + `Q.hermes` verb + `holoq:HermesReceipt`** | **new** | `q/holo-q-hermes.js` · `holo-q.js` verb |

### (C) Native in-browser run design

**Install path (honest):** route the Hermes repo through Holo Import → Forge esbuild-wasm to vendor
the **TypeScript adapters, the `agentskills.io` skills, and `config.yaml`** into a κ-sealed app; κ-parity
is the acceptance check on *that* surface. The Python `AIAgent` engine is **not** bundled — its loop is
re-implemented natively on Q (item 1 above).

**Run path:** `Q.hermes(intent)` hosts the compatible loop on the Q door — inference on the ternary
WASM floor *or* the governed remote slot (ADR-0090); each tool call passes the conscience verdict and
seals a `hosc:Egress` receipt; memory + skills are κ-objects via the fabric/κ-store; async subagents
are Factory tender jobs on the edge-ticker; every run seals one `holoq:HermesReceipt` (L5).

**The honest FS / sandbox / runtime gap analysis:**

| Hermes assumption | In-tab serverless verdict | Mapping |
|---|---|---|
| Synchronous Python `AIAgent` engine | **re-implement** | native compatible loop on the Q door (esbuild can't bundle Python) |
| Always-on gateway / persistent host process | **incompatible in-tab** | state κ-persists; loop ticks only while tab/SW alive; always-on = opt-in external client of governed doors |
| SQLite + FTS5 (`state.db`) | **re-map** | `Q.recall` κ-corpus (already hybrid FTS+vector); or wa-sqlite over OPFS as a fallback (plausible, unproven) |
| On-disk `~/.hermes/` tree | **re-map** | each leaf → κ-object: `memories/`→Recall corpus, `skills/`→Mind/Factory κ-skills, `sessions/`→κ-store |
| Self-registering 70+ tools | **partial** | pure/computational tools run in-tab (WASM + governed egress); host-bound tools (terminal/Docker/file/execute_code) are out-of-tab |
| Six terminal backends (Docker/SSH/Modal/Daytona/Singularity) | **incompatible in-tab** | out-of-tab infrastructure behind governed egress; never faked in-browser (L5) |
| Provider calls (cloud + local OpenAI-compatible) | **satisfiable** | governed remote slot (ADR-0090); the in-tab ternary floor is itself exposable as a local OpenAI-compatible provider |

**Stage-1 probe (smallest end-to-end proof):** import a trivial Hermes config; route one inference
through the Q ternary WASM floor with a `base_url` remote-slot fallback; persist **one session + one
self-written skill** as κ-objects; execute **one** governed-egress tool sealing a `hosc:Egress`
receipt; assert the whole run is re-derivable from a single `holoq:HermesReceipt` — zero server, zero
Python. This proves the loop ticks on the κ substrate.

### (D) Bidirectional interop

- **Hermes-as-client into Hologram:** Hermes already ships an **MCP client** (docs `features/mcp`), so
  Hologram exposes its existing MCP + `/~<app>/api` REST seams and an external Hermes consumes them
  natively — under default-deny governed egress, per-host grant, one `hosc:Egress` receipt per call.
  No new transport.
- **Hermes-as-provider into Hologram:** register a Hermes endpoint as one governed remote slot
  (ADR-0090) via its OpenAI-compatible `base_url`; usable as a Q.fuse panel member (`remote:true` →
  tier "hybrid", per-call opt-in).
- **Hologram-as-provider into Hermes (the elegant reverse):** expose the in-tab Q ternary floor as a
  local OpenAI-compatible server so Hermes lists Holo Q as just another provider via `base_url`.
- **Memory bridge:** Hermes `memories/` ↔ the κ-addressed PRIVATE Recall corpus, preserving the
  open-web/private separation Recall enforces (ADR-0099). Caveat: the exact `agentskills.io` SKILL.md
  schema is an open question (the 15 KB/text-store detail was refuted) — confirm before verbatim ingest.

### (E) Conformance + witness plan

- `holo-q-hermes-witness.mjs` (Node): install κ-parity on the TS/skills surface · loop tick with zero
  server/Python · governed-egress receipt minted + re-derivable · memory/skill writes are κ-objects ·
  agentskills.io skill round-trips · honest-refusal when unconfigured · **declared-incompatible
  backends refuse, never fake** (L5).
- `#holo-hermes` conformance row (earl:passed) + gate exit 0.
- os-closure κ-pin per the Mind/Factory family precedent (may defer, matching ADR-0097).

## Consequences (provisional)

- **What Q gains:** a native, serverless, κ-anchored agent that is *Hermes-compatible* — it reads
  Hermes skills/config and speaks Hermes's provider seam — plus the two genuinely-additive borrows
  (the event-driven skill self-write loop and the GEPA reflective optimizer, which closes Holo
  Factory's long-open failures→optimizer gap). And clean three-way interop: Hermes-as-client,
  Hermes-as-provider, and Holo-Q-as-provider-to-Hermes.
- **Honest limits (stated, not hidden):**
  - The in-tab loop is **not always-on** — state persists, the loop sleeps with the tab/SW. True
    always-on is an out-of-tab Hermes acting as a governed client, not a weakening of the floor.
  - **The Python engine is not bundled.** We run a compatible re-implementation, not Hermes's own
    process; behavioral parity is bounded by what we re-implement and must be witnessed, not assumed.
  - **Six terminal backends and the gateway cannot run in-tab** and are declared incompatible, not
    faked (L5). Host-bound tools are out-of-tab behind governed egress.
  - Remote provider / Hermes-as-provider inherit the ADR-0090 governed-egress trust model; synthesis
    inherits the Q.fuse ceiling. Unverified runs never report green (L5).
  - SQLite+FTS5-over-OPFS (wa-sqlite) is plausible but unproven in this stack; the Recall κ-corpus is
    the preferred memory re-map precisely because it is already built and re-derivable.
- **Fold-in (deferred) — a Pyodide-hosted Python slice.** If a future need demands running a slice of
  the actual `AIAgent` Python in-tab, Pyodide is the serverless route; heavy, and out of scope here.
- **Reversible:** additive only. Remove `Q.hermes` + `holo-q-hermes.js` and the door is exactly
  ADR-0099. Nothing else changes.
