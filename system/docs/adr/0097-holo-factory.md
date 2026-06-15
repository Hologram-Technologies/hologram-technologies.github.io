# ADR-0097 — Holo Factory: the software factory as one verb, native to Q

Status: Accepted (2026-06-15)
Relates: [[holo-mind-adr]] (ADR-0081, the ambient agentic loop + trace corpus) · [[dream-diffusion-llm-holo-q]] (ADR-0083, diffusion infill) · ADR-0091 (one door window.Q) · ADR-033 (the conscience gate) · ADR-0035 (skills) · ADR-0095 (Holo DevTools)

## Context

The industry framing of "AI software engineering" is moving from coding agents to a
**software factory**: a self-observing loop over the whole SDLC — signals (bug reports,
feedback, a red check) → triage → change → test → review → secure → ship → monitor →
*more signals* — instrumented on one shared agent core, one model router, one
organizational context, improving as it observes itself. The stated requirements are
**model independence**, **sovereign intelligence** (owned, air-gappable, learns inside
your walls), and **continual self-improvement**.

Hologram already satisfies the hardest axis by construction. **Sovereignty is not a
deployment SKU here — it is the substrate**: 100% serverless, in-tab, κ-addressed, runs
on your device, governed default-deny egress. And the "shared agent core" already exists:
**Holo Mind** (ADR-0081) is the ambient agentic loop (intent → plan → act → seal) with a
durable, append-only **trace corpus** (Phase 2 learning) and **orchestration** (Phase 4).
What was missing was the *specialization* of that core into the closed **code** loop, and
a single magical surface over it. Building a second orchestrator would violate Law L4
(everything through the substrate) and fragment the learning corpus.

## Decision

**Holo Factory is one verb — `Q.factory(signal)` — that specializes Holo Mind into the
closed SDLC loop. It adds no substrate.** `system/os/usr/lib/holo/q/holo-factory.mjs` is a
pure, isomorphic core (Node · browser) that composes the existing primitives:

```
signal → intent → [ change → verify ]↺ → seal → learn
```

- **signal → intent** — `sealIntent` (holo-mind.mjs); a red check is `source:"environment"`.
- **change** — an injected `propose`; the live wiring ROUTES the model door per task
  (Factory 2.0's router): a both-sided span (`prefix`/`suffix`) → **Dream diffusion infill**
  (ADR-0083, the native surgical edit); otherwise the borrowed AR coder produces whole-source.
- **apply** — the change is sealed as a content-addressed `holo:Artifact` κ (in-tab,
  serverless); if a live surface is mounted it is adopted through the **same governed
  `liveEdit` door** (`agentEdit`, conscience-gated, `hosc:Edit` receipt).
- **verify** — an injected verifier (the SDLC oracle: a witness, a test). Built-in in-tab
  floors: `parse` (syntactic validity, never executes) and `rederive` (κ integrity). The
  loop retries change→verify up to a budget, stopping **at** green.
- **seal** — a `holo:FactoryRun` PROV-O activity links the intent (`prov:used`) and every
  attempt's chained `holo:ActionReceipt` (`prov:wasInformedBy`); the whole DAG re-derives
  (Law L5).
- **learn** — `appendTrace` (holo-mind-evolve.mjs) records the outcome into the **same
  durable trace corpus** as the ambient loop; `failures()` feeds governed self-evolution.

The shell binding (holo-mind-ui.js) constructs the factory with Holo Mind's **own** durable
store, `corpusHead`, conscience gate, and borrowed sampler — the literal shared core — and
persists the advanced corpus head, so factory and ambient loop learn into one memory.

### The non-negotiable: never fakes green (Law L5)

The factory returns `ok:true` **only** when an injected verifier passed. With no verifier
bound it returns the change as an honest `proposal` with `outcome:"unverified"` — it does
not claim a fix (mirrors holo-q-diffusion's "report, never fabricate"). A blocked
conscience verdict seals no attempt and produces no effect (fail-closed). Sovereignty and
verifiability are the axes Hologram leads on; faking a green would forfeit both.

### Magic = abstract the complexity, deliver one verb

The caller sees `Q.factory("the diffusion witness is red")` and gets back a re-derivable
receipt or an honest "couldn't". Model choice (AR vs diffusion), governance, the retry
loop, receipt chaining, and corpus learning are all hidden behind the one call.

### The autonomous tender — self-observing, driven only by user intent

The one-verb fix is the manual mode. The factory *self-observes* through the **tender**
(`q/holo-factory-tend.mjs`), which closes the keystone gap: **signal → verified fix,
hands-off.** Its insight is that a **check is both monitor and oracle** — a red check *is*
the signal, and re-running it on a candidate *is* the verification — so auto-signal and
witness-verification are the same object. The tender runs every check; each red one
auto-drives a `factory.run` verified by that check; greens are left untouched; a verified
fix is **shipped** through the check's own `write()`. The OS gate's own EARL report ingests
as signals (`gateChecks` — every failed row a signal; a repo-level row surfaces as an honest
proposal until a browser-runnable witness closes it).

**Driven only by user intent (the binding constraint).** Nothing fires until `watch()`
seals a standing `holo:Intent` (source `user`) — the authority every autonomous tend links
(`prov:used`). The conscience gates every change (inherited — no path skips it); the
edge-clock ticker arms only on the user's call and the user stops it. No timer self-arms;
no act happens without the user's intent. This is Holo Mind's GoalStack + opt-in-scheduler
discipline: **autonomy is authorized, never assumed.** Exposed as `Q.factory.watch(intent)`
/ `Q.factory.tend()` / `Q.factory.register(name, check)`, sharing the same durable store,
corpus, conscience, and model. Witnessed 8/8 (`tools/holo-factory-tend-witness.mjs`):
converges, ships, never-fakes, re-derives, driven-by-intent, **opt-in-no-autofire**, and the
gate's failed rows become signals.

### Semantic triage — the factory finds the target itself

The tender still needed *you* to name the target. Triage (`q/holo-factory-triage.mjs`)
removes that: a natural-language signal is embedded by the OS's verified embedder
(EmbeddingGemma-300m via `HoloVoice.embed`) and matched **by meaning** against the live
candidate surfaces — so `watch("keep my notepad working")` *locates* what to watch, and
`Q.factory("the add function is broken")` finds the surface, with no human naming and no
`prefix`/`suffix`. The core is pure given the injected `embed()` (witnessed in Node with a
stub embedder; live with EmbeddingGemma); cosine ranking is deterministic, so triage
re-derives. `tender.discover()` locates the target(s) and registers a check for each. Honest
(Law L5): nothing above the similarity threshold ⇒ **no target** — it reports it can't
locate, it does not guess. Exposed as `Q.factory.locate/discover`; `watch(intent, {candidates})`
expands the intent into checks before tending. Witnessed 6/6
(`tools/holo-factory-triage-witness.mjs`): ranks by meaning with zero shared words, honest
when nothing matches, deterministic, and discover→fix end to end.

### Candidate catalog — fully hands-off on real holospaces

Triage *locates*, but it needed candidates handed to it. The catalog
(`q/holo-factory-catalog.mjs`) is the live enumeration that removes the last manual step:
`createCatalog(providers)` composes injected providers (`{ list() → candidates }`) plus a
self-register seam `target(id, spec)`, de-duping by id. The built-in `liveEditProvider`
turns **every live mounted holospace surface** into a candidate — `write` through the
governed `agentEdit` door (conscience default-deny, `hosc:Edit` receipt), `read` through
`kRouteResolver` (κ → source over the `/.holo/sha256/<hex>` route; the bytes *are* the κ,
Law L5). No resolver ⇒ read omitted; no `agentEdit` ⇒ write omitted — it never fakes a door.
Wired into `holo-mind-ui.js`: the tender builds the catalog from `window.HoloLiveEdit` + the
κ-route, and `factoryLocate/Discover/Watch` fall back to `catalog.candidates()` when none are
passed — so `Q.factory.watch("keep my notepad working")` finds the surface and closes the loop
unattended. An app self-registers a richer target via `Q.factory.target(id, spec)`. Witnessed
7/7 (`tools/holo-factory-catalog-witness.mjs`). Richer providers (the holospace scene-node and
app catalog) layer on the same seam.

## Consequences

- A micro software-factory exists on our stack today: a red **witness/gate** is the signal,
  the brain (AR coder or diffusion infill) is the change, the **witness re-run** is the
  verifier, the κ-receipt is the proof, the trace corpus is the learning — ~all stages
  already exist; the factory is the connective tissue.
- **Honest scope.** In-tab + serverless: the default verifiers are syntactic/integrity; the
  full SDLC oracle (a real witness/test) is injected. Multi-repo enterprise CI/CD at scale
  is *not* claimed — this is a sovereign personal/team factory, the position our substrate
  uniquely affords.
- Witnessed by `tools/holo-factory-witness.mjs` (9/9): loop convergence, run re-derivation,
  never-fakes-green, fail-closed, learns-from-failure, the parse oracle, no-fabrication,
  tamper-refused, and seal-equivalence across runtimes.
