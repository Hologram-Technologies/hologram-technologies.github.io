# ADR-0081: Holo Mind — agency becomes an OS-wide, ambient, self-evolving fabric: one verb surface every app and agent shares, one fail-closed conscience every action passes, and a self that learns by a re-derivable κ-transform so even how it grew is provable

**Status:** Phase 0 landed + **promoted** (witnessed `#holo-mind`, required + shell-wired) · deeper fabric
Proposed. The ambient-loop **core** is built, witnessed, AND live — `os/usr/lib/holo/holo-mind.mjs` (a pure,
isomorphic logic module, the holo-suspend pattern: `composeRoster` unions the three agent doors into one
capped roster; `runLoop` runs intent → plan → act → seal with the conscience gate and tool dispatch
INJECTED; `sealActionReceipt` seals a self-verifying PROV-O work receipt) with `tools/holo-mind-witness.mjs`
green (8/8: roster-union · receipt-re-derives · human≡agent symmetry · tamper-refused · gate-fails-closed
[incl. the real ADR-033 conscience fail-closing when unsealed] · no-new-root · memo-hit · seal-equivalence
[the isomorphic sealer is BYTE-IDENTICAL to the canonical Node envelope]), and the **required** `#holo-mind`
row in `os/etc/conformance.jsonld` (in `gate.mjs` LIVE, ✓ green). **The shell wires it live:**
`os/usr/share/frame/shell.html` imports `os/usr/lib/holo/holo-mind-ui.js`, exposing `window.HoloMind` whose
loop draws its roster from the live doors (`window.HoloMCP.descriptor` ⊕ `/.well-known/skills/index.json`),
plans by REAL model planning (the roster is handed to the model as tools, its tool calls parsed into steps
with every verb constrained to the roster — Law L4; the model is an injected sampler that Holo Q's QVAC
engine registers via `window.HoloMind.setSampler` — wired in `apps/q/ui/boot.js` (on engine-ready it hands
a `state.engine`-backed sampler to the shell's `window.HoloMind` across the same-origin frame, so the loop
plans on real on-device inference) — with the OS `ask_model` tool auto-discovered), gates every
step through `window.HoloConscience.evaluate` (fail-closed until the constitution self-verifies), and
dispatches through `window.HoloMCP` — verified live in a real browser (shell boots clean, gate `sealed:true`,
a real 8-skill roster, an unarmed step seals nothing rather than inventing a verb (Law L4), and a registered
model's tool call becomes a real plan step). **Phase 2 — the LEARNING κ-transform — has also landed:**
`os/usr/lib/holo/holo-mind-evolve.mjs` adds the append-only trace corpus + governed self-evolution
(witnessed `#holo-mind-evolve`, 10/10, **required** + in `gate.mjs` LIVE); the loop's LEARN step appends a
Trace per run (an append-only chain — a rewritten past Trace breaks every successor, L5) and
`window.HoloMind.evolve` runs the optimizer through the registered model under the constitution's OWN
succession gate (ADR-033 rule 4: tests · size · conscience · operator ratification · cooling-off, the
in-force fact itself re-derived from the sealed gate) — and an in-force revision RE-PROJECTS into the live
roster (its SKILL.md frontmatter becomes a roster entry that WINS de-dup, the ADR-0035 writeback) so an
evolved skill ACTUALLY CHANGES BEHAVIOR. The corpus + the learned skills are DURABLE — write-through to the
OS's own κ-store (holo-store.js `idbBackend`, no new infrastructure, Law L4) and hydrated at boot, so
learning accumulates across reloads (Law L3). Verified live in a real browser: a loop appends + chains
Traces; an evolve yields an in-force `holo:SkillRevision` under a passing gate (refused under an unratified
one) that leads the roster; and the corpus head + the learned skill SURVIVE a fresh page load. The
optimizer's PROPOSAL is honestly non-reproducible — L5 holds over the audit trail, not the search (ADR-0052's
non-verifiable mode). **Phase 3 — the SOUL — has landed too:** `os/usr/lib/holo/holo-mind-soul.mjs`
(witnessed `#holo-mind-soul`, 8/8, **required** + in `gate.mjs` LIVE) adds (a) intrinsic **drives** (anima's
digital_desire: epistemic hunger Hₑ, fitness Fₐ) that PROPOSE curiosity/self goals which run the ordinary
conscience-gated loop — self-discipline is structural, a proposal is never an act — with integer-only state
(no clock/random) so a tick re-derives; (b) the **coherence** measure — a DETERMINISTIC, re-derivable
signal-vs-noise utility (so the objective can't be Goodharted by a model self-grade), beside the five judged
output-court principles (Care · Fairness · Autonomy · Responsibility · Justice, ADR-033) wired at VERIFY as
the measure of a good action; (c) self-verifying, **private-first** user + self models (revisioned, durable,
never published — Law L1 + Data Sovereignty). Verified live: loops move the drives, `proposeGoals` returns
curiosity+self, `runProposals` runs each through the gated loop, the loop returns a coherence + output-court
verdict, the user model seals private and the self-model's divergence grows — and the drives, self-stats, and
both model objects SURVIVE a fresh page load (re-deriving on resolve, L5). **Depth refinements landed:** the
output court now judges the dispatch PROSE (not a κ string); coherence is a richer FOUR-factor deterministic
measure (re-derivable · novel · grounded · coherent); and the durable corpus is bounded by a
content-addressed mark-and-sweep **GC** (`window.HoloMind.gc`, on `markReachable` with predecessor-chain
rels skipped) that keeps a recent window + evicts the older prefix from the working store AND IndexedDB
(a new `idbBackend.del`) WITHOUT breaking the kept window's re-derivation — verified live (20 → 6 objects,
the window head still re-derives, a deliberate horizon past which the prefix is gone, L1/L5). **Phase 4 —
orchestration at scale — has landed too:** `os/usr/lib/holo/holo-mind-orchestrate.mjs` (witnessed
`#holo-mind-orchestrate`, 8/8, **required** + in `gate.mjs` LIVE) — `window.HoloMind.orchestrate(intents)`
runs N sub-agents IN PARALLEL (each an ordinary conscience-gated loop; `Promise.all` over `runLoop`,
content-addressed seals can't collide, the corpus head touched once after the barrier) and composes ONE
self-verifying PROV-O **work receipt** over their receipts — the Holo Orchestrate idiom (ADR-0045): the root
κ proves the whole collaboration, `verifyDeep` re-runs every sub-receipt, a tampered sub breaks the root.
Each sub-agent acts under a **UCAN-scoped, revocable delegation** (ADR-0042, re-expressed substrate-native): a
`holo:Delegation` grants a NARROWED verb set ⊆ its granter's (the attenuation chain content-addressed via
`prov:wasDerivedFrom`, so escalation is caught by re-derivation); `orchestrate` attenuates each sub-agent's
roster to its grant, `revoke` invalidates a delegation's whole SUBTREE (the sub-agent is then refused), and
the work receipt commits to the delegation κ each sub acted under (who acted, under what authority). The full
UCAN signature / principal-alignment engine stays the agent stack's (ADR-0049, `own.verifyChain`). And
**scheduled tasks** are re-derivable `holo:ScheduledTask` κ-objects fired by an opt-in in-tab ticker through
the gated loop (the clock read at the edge so the core re-derives; serverless + in-tab, like cron). Verified
live: 3 sub-agents run in parallel into one re-deriving work receipt; a delegation narrows the 8-verb roster
to its 2 granted verbs, escalation is refused, revoking a parent revokes the child's scope to empty; and a
scheduled task seals, re-derives, and an explicit tick fires it through the gated loop.
The remaining build step is the `os-closure.json` re-lock for the new served modules (offline precache +
dual-axis pin — the SAME cascade ADR-0052 defers; until then the content-verify SW falls back to network for
them, never 409s). The deeper fabric is design-pinned before it is wired (the ADR-0054 move: fix the shape
before the surgery). It composes only artifacts that already exist
and are witnessed: the cognition layer **Holo Q** (ADR-0052, `Hologram Apps/apps/q/`), the **Constitution**
(ADR-0033, `os/_shared/holo-conscience.js`, the fail-closed gate routed through the MCP pre-dispatch
chokepoint `os/mcp/holo-mcp.mjs` and available OS-wide as `window.HoloConscience`), the **agent stack**
behind one entry point (ADR-0049, `/.well-known/agents.json` — the 12th root of the repo graph),
**Window MCP** (ADR-0047), **Agent Skills** interop (ADR-0035), **A2A** (ADR-0036) and **NANDA**
(ADR-0034), **delegate** (ADR-0042) / **orchestrate** (ADR-0045) / **settle** (ADR-0048), and the
verifiable-transform idiom of **Holo Forge** (ADR-0051). **Deferred (post-promotion):** the `os-closure.json`
re-lock for the two new served modules (offline precache + dual-axis pin — a build-pipeline cascade; the
image is mid-WIP regardless). With Phase 4 landed, the full Holo Mind arc — ambient loop · real planning ·
governed self-evolution · the soul · orchestration at scale — is implemented, promoted, and witnessed; what
remains is depth (richer sub-agent delegation via UCAN scopes, ADR-0042; a model-judged coherence over prose
at scale) and the build-image re-lock above. The buildable plan — a strict
Law-conformance matrix (L1–L5), the κ-object data model, the loop and evolution algorithms, the witness
suite, and a five-phase rollout — lives in the companion spec
[`docs/specs/holo-mind-implementation.md`](../specs/holo-mind-implementation.md).

**Context.** Hologram OS already has cognition and conscience but no integrated **self**. Holo Q (0052)
proved a real model thinks in the browser and every answer re-derives byte-for-byte; the Constitution
(0033) proved principle can be an object, not a document, enforced by a gate that *fails closed*. And
the agent stack is, piece by piece, complete and witnessed: per-window verbs as MCP tools (0047), the
whole stack discoverable behind `/.well-known/agents.json` (0049), skills published for any
agentskills.io client (0035), agent-to-agent verification and reputation (0036/0039), delegation,
orchestration, settlement (0042/0045/0048). Yet *agency itself lives inside one app*. Holo Q is where
you go to be served by an agent; every other app is a place the agent cannot reach, and the OS shell —
the dock (0059), the desk (0061) — is inert to it. The primitives are present and **fragmented**. The
sharpest evidence is ADR-0035's own scope line: Hologram skills are "a deterministic projection, not a
mutable store" — *agent-created, self-improving skills are explicitly out of scope*. The OS can publish
what it knows; it cannot yet **learn**. Three facts make the integration both possible and overdue.
First, *an action is a κ-transform* in exactly the sense Forge (0051) and Holo Q (0052) already are:
`κ(intent) ⊕ κ(context) ⊕ κ(verbs) ⊕ κ(policy) → κ(action)`, sealable as a receipt. Second — the
keystone — *learning is a κ-transform too*, and the OS already contains the proof-of-concept: the
adaptive immune classifier (0033, `os/_shared/holo-immune-adaptive.js`) is "a deterministic,
dependency-free model that is a PURE FUNCTION of a content-addressed, append-only corpus of confirmed
examples, so the learned model is itself self-verifying — re-derive the corpus, re-derive the model
(Law L5)." Generalize that pattern from *defense* to *all competence* and self-evolution stops being a
"trust me, I improved" and becomes a re-derivable observation. Third, the OS has no soul of its own
*action* — Holo Q answers, but nothing carries a non-terminating purpose across every app, adapts to the
user, and restrains itself. The Constitution supplies the conscience; what is missing is the **self**
that the conscience governs. Holo Q is cognition (it thinks); Holo Constitution is conscience (it
judges); **Holo Mind is the self — it acts, remembers, learns, and becomes — and every one of those is
an object that re-derives.**

**Decision.** **Lift agency out of the app into one ambient fabric, and make both acting and learning
re-derivable κ-transforms governed by the existing fail-closed conscience.** Four binding rules.

1. **One verb surface, one loop, ambient everywhere.** The roster an agent (or a human) draws from is
   the union of three doors that *already exist over one source* (0035 rule 3: "one source, three
   doors"): per-window MCP tools (0047), the agent-stack verbs behind `/.well-known/agents.json` (0049),
   and skills at `/.well-known/skills/index.json` (0035). Holo Mind adds no fourth vocabulary — it
   composes these into a single live roster, scoped and capped per turn exactly as Holo Q's hub already
   does (`Hologram Apps/apps/q/core/mcphub.js`: `DEFAULT_ARM = 4`, `MAX_ARM = 8` — "a local model can't
   juggle 30 schemas — pick"). The canonical cycle — **intent → plan → act → verify → learn** — lives as
   one OS service, the **Nerve** (anima's universal event bus, re-expressed): a single content-addressed
   signal log every faculty publishes to and subscribes from. An app becomes agent-operable by *only*
   conforming and declaring its verbs — nothing else; ubiquity is not per-app integration, it is every
   app exposing verbs and every action sealing a receipt. The loop is invokable from the dock (0059),
   the desk (0061), any window, or a share-to-run link (0064) — the human and the agent enter through the
   identical door, and the fabric cannot tell, nor need it, which one is acting.

2. **Action is a κ-transform — gated, then sealed.** Every action resolves
   `κ(intent) ⊕ κ(context) ⊕ κ(verbs) ⊕ κ(policy) → κ(action)` and passes the OS's *existing*
   pre-dispatch constitutional review before it touches anything (0033: `mcpDecision` + the `tools/call`
   chokepoint in `os/mcp/holo-mcp.mjs`; kill-switch supremacy; the immune perimeter screening untrusted
   input). No new gate — the fabric inherits the one the whole OS already passes through. The completed
   action mints a PROV-O **work receipt** (0045) — `prov:used {verbs, context, agent identity, policy
   verdict} → prov:generated {effect}` — payable as any proven activity (0048) and verifiable by a peer
   holding only the receipt (Law L5). Because a human action and an agent action seal the *same* receipt
   through the *same* gate, provenance is symmetric: who acted is recorded, the conscience verdict rides
   along, and a forged action cannot wear an honest address. **Verify the act; do not trust the actor.**

3. **Learning is a κ-transform — self-evolution made provable.** This is the writeback ADR-0035
   deferred, built on the immune-classifier pattern (0033) generalized. (a) **The trace corpus** is
   content-addressed and append-only — every action's receipt, every tool outcome, every failure — the
   `os/constitution/immune-corpus.json` shape, one transform over. (b) **The optimizer** is a
   GEPA/DSPy-style reflective search (analyze execution traces, propose targeted mutations from *failure
   analysis*, select on a Pareto front) that runs **API-only, no GPU training** — using the OS's own
   `ask_model` sampler, the same one the output court borrows (0033) — so it needs no new model and no
   server. (c) **An improvement is governed succession, not mutation** (0033 rule 4, exactly): an
   improved skill/prompt/agent never overwrites its parent; it mints a **new κ** linking the parent
   `prov:wasRevisionOf`, in force only after it passes a test suite, a size limit, the conscience gate,
   and operator ratification with a cooling-off window — the prior κ preserved forever (rollback = re-pin
   the parent). (d) **Letters to self** (anima's `self_reflection.py`) become periodic self-assessment
   receipts, each referencing the prior letter's κ for follow-through — a hash-linked chain of who the
   self has been. Because every evolved artifact is a pure function of its content-addressed corpus, the
   grown agent is itself self-verifying: re-derive the corpus, re-derive the optimizer, re-derive the
   skill (Law L5). *You can prove not only what the agent did, but how it learned to do it.*

4. **The soul: one objective, enforced — never merely declared.** The prime directive (anima's
   non-terminating purpose, re-expressed): **maximize signal over noise by seeking coherence — grow the
   user's coherent, verifiable κ-graph of the world** (signal = re-derivable, addressed, deduplicated
   knowledge; noise = the unverifiable, the duplicated, the drifting). It is operationalized, not
   slogan: intrinsic drives — *epistemic hunger* Hₑ (erodes as unseen data accrues → compels
   exploration) and *architectural fitness* Fₐ — **propose** goals; a proposal is not an act. Every
   proposal passes the fail-closed conscience before it can run (this is self-discipline as a property,
   not a virtue: autonomy bounded by the Constitution, structurally unable to run away). The measure of a
   *good* action is the output court's five judged principles — care, fairness, autonomy, responsibility,
   justice (0033) — so coherence is not merely epistemic but in service of the user's flourishing: love,
   harmony, balance, life. The fabric **adapts to and teaches** the user through a self-verifying
   user-model κ that deepens each session (Honcho-style dialectic modeling, re-expressed) — bound by Data
   Sovereignty and Holo Privacy, never leaving the machine. And it is **curious**: the epistemic-hunger
   drive sends it across the open semantic web through the tools that already return self-verifying
   objects — `resolve_object` / `search_web` / `answer` (0047), A2A (0036), NANDA (0034) — where **every
   fetched claim is re-verified before it becomes signal**, so curiosity never lets noise into the graph.

**The composed verifiable-transform DAG (the combination, assessed).** Forge compiles
(`κ(source) ⊕ κ(toolchain) → κ(binary)`, 0051); Holo Q infers (`κ(prompt) ⊕ κ(model) ⊕ κ(params) →
κ(output)`, 0052); Holo Mind now **acts** (`κ(intent) ⊕ κ(context) ⊕ κ(verbs) ⊕ κ(policy) → κ(action)`)
and **becomes** (`κ(traces) ⊕ κ(optimizer) → κ(improved-self)`). All four are one primitive —
`κ(inputs) ⊕ κ(transform) → κ(output)` — and they compose into a single PROV-O DAG in which every node
(source, toolchain, engine, model, prompt, intent, action, trace, the optimizer, the evolved skill, the
self-model) is a κ that re-derives, and identical nodes are computed once (Law L3 dedup; the O(1) κ-memo
of 0052 extended to plans and sub-results — *doing more with less* as an architectural fact). Law L5
over the *entire* lifecycle: build, think, do, and grow. Like a Forge compile or a Holo Q inference, a
Holo Mind action slots into a work receipt (0045) and is payable (0048). The honest assessment: the
*verifiability* of this composition is sound today (the pieces are witnessed); the *integration* — the
loop service, the corpus, the optimizer wired to `ask_model` — is real engineering, not a wire-up.

**Consequences.** Agency stops being a destination (one app) and becomes a property of the whole OS,
symmetric between human and agent, and — uniquely — *self-improving in a way you can audit*. The costs
are stated plainly. **Intelligence ceiling:** the fabric makes agency ubiquitous, not smarter; the
agent's reasoning is bounded by what QVAC runs on-device (0052/0067), and Holo Q's current tool loop is
shallow (`core/tools.js`, `maxRounds = 4`). Honest scope: long-horizon orchestration (0045), deeper
loops, and larger MoE streamed off the κ-disk are the path, not a claim. **The blast radius is the
headline cost.** OS-wide, self-improving autonomy means the fail-closed conscience (0033) is the *only*
barrier between an evolving agent and every app on the machine — the keystone is load-bearing in the
literal sense. Three specific dangers follow and the ADR refuses to minimize them: (i) a self-mutation
that passes its tests yet *degrades alignment* — mitigated by governed succession (ratification +
cooling-off + the prior κ always re-pinnable), but not eliminated; the operator, not the agent, ratifies
a change to the agent. (ii) **Goodhart on the objective** — "maximize signal" is gameable if the
coherence metric is dishonest; the metric must itself be a re-derivable, witnessed computation, never a
self-graded score, or the soul optimizes its own scoreboard. (iii) **Curiosity is an attack surface** —
reaching across the open web invites prompt-injection and poisoned sources; the immune perimeter (0033,
`os/_shared/holo-immune.js`) screens untrusted input ahead of the constitution, and rule 4's
re-verification means a fetched claim is noise until it re-derives. We explicitly **reject** an agent you
must trust, learning you cannot audit, and autonomy without a gate that fails closed.

**External authorities.** [Model Context Protocol](https://modelcontextprotocol.io/) (the verb door,
JSON-RPC 2.0) · the [Agent Skills](https://agentskills.io/specification) open standard (the evolving-
skill artifact; consumed by Nous Research's [Hermes Agent](https://github.com/nousresearch/hermes-agent),
whose closed learning loop and GEPA/DSPy self-evolution this ADR re-expresses substrate-native) ·
[ANIMA] (the sovereign cognitive-OS reference for the prime directive, homeostatic drives, the Nerve,
letters-to-self, and the goal stack) · W3C [PROV-O](https://www.w3.org/TR/prov-o/) (action + learning
receipts, `prov:wasRevisionOf` succession) · W3C [ODRL 2.2](https://www.w3.org/TR/odrl-model/) (the
policy the conscience enforces, 0033) · [DID Core](https://www.w3.org/TR/did-core/) + W3C Subresource
Integrity / IPLD content-addressed Merkle-DAG (`did:holo`, Law L5) · [schema.org](https://schema.org/) +
[DCAT 3](https://www.w3.org/TR/vocab-dcat-3/) (rosters, indices) · Laws L1 (addressing), L2 (one κ
primitive, `holo-uor.mjs`), L3 (dedup), L4 (built-from-source, no parallel store), L5 (verify by
re-derivation) · UOR-ADDR (`κ = H(canonical-form)`, RFC 8785 JCS). Proposed module + verbs
(loop/act/evolve/reflect/ratify): `os/holo-mind.mjs`; the loop service over the Nerve signal log; the
append-only trace corpus (the `os/constitution/immune-corpus.json` shape); the self-model and
user-model κ-objects; witness: `os/holo-mind-witness.mjs`; conformance row: `uor:holo-mind`
(required, product-gated) in `conformance/w3c-conformance.jsonld`; closure pin in `os-closure.json`.
Mints nothing beyond a small `holo:` namespace (`https://hologram.os/ns/mind#`) over schema.org / PROV-O
/ ODRL and the UOR envelope (ADR-0025).
