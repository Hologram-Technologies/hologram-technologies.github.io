# Holo Mind — Implementation Specification (companion to ADR-0081)

This is the buildable spec for [ADR-0081: Holo Mind](../adr/0081-holo-mind.md). The ADR records the
*decision*; this records *how it is built without violating a single substrate law*, and the witness
suite that proves it. It is written to be implemented in phases, each one shippable and witnessed before
the next begins (ADR-0024: a decision is not done until it is witnessed).

Authoritative law text is quoted verbatim from the holospaces engine docs (submodule pinned at
`bb742bb538fded40bcc698f97e6fb4c900fcb4ad`, `docs/12-Glossary.md` / `docs/08-Concepts.md`). Nothing here
is built until it passes the conformance matrix in §1.

---

## 1. Law conformance matrix — strict adherence, with the tensions named

The five invariants (holospaces `docs/12-Glossary.md`, verbatim) and exactly how Holo Mind obeys each.
A claim is only listed as *adhered* if a witness in §8 can prove it.

| Law | Verbatim statement | How Holo Mind adheres | The tension, stated honestly |
|---|---|---|---|
| **L1** | "identity is content not location" | Every Mind artifact — intent, plan, action receipt, trace entry, skill revision, letter, user-model, self-model — is named by its `κ = H(canonical_form)`, never by a path or a server. The loop addresses verbs, context, and policy by κ; "where" the agent ran is never part of identity. The user-model is private-first: it is a κ-object that lives only in the on-device store and is never published (a location-bound secret would break L1's spirit and Data Sovereignty both). | None. Mind mints no location-bound identifiers. |
| **L2** | "canonical forms only" | Every artifact is serialized to one canonical form (RFC 8785 JCS, the OS's existing `holo-uor.mjs` `kappa()`), then sealed. No artifact exists in a non-canonical "draft" the substrate operates on. The trace corpus and skill revisions are canonical JSON-LD, not free text. | The *prompts and traces* contain natural-language bytes (model I/O). Those bytes are still wrapped in a canonical envelope and addressed by κ — the NL is *content inside* a canonical form, not a second representation. No tension once wrapped. |
| **L3** | "the store is the memory" | The trace corpus, the κ-memo of plans/sub-results, and every revision are content-keyed in the durable κ-store; identical content is stored once (dedup). The loop's "do more with less" is L3 made operational: an identical plan/sub-result is an O(1) memo hit, not recomputed (the Holo Q κ-memo, ADR-0052, extended from answers to plans). | A long-running agent generates a large corpus. Mitigation: the corpus is append-only and content-keyed, so duplicate observations dedup automatically; pruning is a *governed* operation that mints a new corpus root (never an in-place delete — see L5). |
| **L4** | "everything through the substrate" | Mind adds **no parallel store, no new transport, no new trust root.** The verb roster is the *existing* MCP/agents/skills doors (ADR-0047/0049/0035). Action goes through the *existing* conscience chokepoint (`os/mcp/holo-mcp.mjs`). Receipts are the *existing* PROV-O work-receipt shape (ADR-0045). Curiosity reaches the web through the *existing* `resolve_object`/`search_web` tools (ADR-0047) and the healer's `holo-web` transport (ADR-0076). The optimizer calls the *existing* `ask_model` sampler. | The evolution engine is genuinely new code, but it introduces no new *substrate* — it is a transform over the existing κ-store using the existing sampler. Witnessed by "no-new-root" (§8). |
| **L5** | "verify by re-derivation" | Every action receipt re-derives `κ(action)` from its body; a flipped field no longer re-derives and is refused. Every skill revision is a pure function of its content-addressed corpus + the canonical proposal, so `re-derive(corpus) → re-derive(revision)` holds. The user/self-model re-derive. Curiosity admits an external claim only after it re-derives (ADR-0047 objects). | **The sharpest tension in the whole ADR, named in full:** the GEPA/DSPy optimizer's *proposal* step calls a stochastic LLM (`ask_model`), so the *search that produced* a revision is **not** reproducible — exactly the "creative sampling is a non-verifiable mode" honesty of ADR-0052. What re-derives is therefore the **provenance and acceptance**, not the generation: the revision's κ commits to (corpus κ ⊕ parent κ ⊕ the exact proposed bytes ⊕ the test results ⊕ the conscience verdict ⊕ the ratification), so any peer re-derives *that this revision lawfully descended from this corpus and passed these gates* (the AgentTrust idiom, ADR-0039: "re-derive = verify across time"), even though they cannot reproduce the LLM mutation that suggested it. The deterministic learner that IS fully re-derivable — the adaptive immune classifier (ADR-0033, Naive-Bayes, a pure function of its corpus) — is the gold standard; the LLM optimizer is the honest, weaker case and is labelled as such wherever it appears. |

**Verdict.** ADR-0081's law citations are consistent with the upstream statements and the OS house gloss
(L2 = the one κ primitive `holo-uor.mjs`; L4 = built-from-source / no parallel store). The single place
strict L5 cannot be claimed for *generation* is the LLM optimizer; the spec confines that to the proposal
step and proves L5 over the *audit trail* instead. This is recorded as a non-goal, not hidden.

---

## 2. Spec conformance (beyond the five laws)

- **UOR envelope (ADR-0025).** Every artifact is a UOR object: `@context`, `type` (schema.org + PROV-O +
  ODRL), `id` = `did:holo:sha256:…`, Merkle links to its inputs. Built via the existing `holo-uor.mjs`.
- **Witnessed conformance (ADR-0024).** No phase ships without its witness green and its row in
  `conformance/w3c-conformance.jsonld` (or `os/etc/conformance.jsonld` for OS-internal rows). The
  required, product-gated row is `uor:holo-mind`; sub-rows per phase (§8).
- **Mint nothing reusable (ADR-0024 A6).** Vocabulary is schema.org / PROV-O / ODRL / DCAT. The only new
  term-space is a small non-reusable `holo:` namespace `https://hologram.os/ns/mind#` for the handful of
  Mind-specific classes (`holo:Intent`, `holo:Plan`, `holo:Trace`, `holo:SkillRevision`, `holo:Letter`,
  `holo:UserModel`, `holo:SelfModel`). Reuse before mint, every time.
- **Canonical form / JCS (RFC 8785).** All sealing goes through the one κ primitive; no bespoke hashing.
- **Determinism boundary (RT2 / `run_holo`, ADR-008; Holo Q, ADR-0052).** Re-derivable steps use greedy/
  seeded decode; the stochastic optimizer is fenced off in §6 and excluded from L5-generation claims.
- **Closure (ADR-0026).** Served Mind code is pinned in `os-closure.json`; the trace corpus and
  user/self-model are *runtime* objects in the durable κ-store (like Holo Suspend's checkpoint), correctly
  **outside** the served closure — they are user data, not OS image.

---

## 3. Architecture — four faculties over one bus

Holo Mind is one OS service, `os/holo-mind.mjs`, exposing verbs `loop · act · evolve · reflect · ratify`,
mounted into the existing MCP server (so humans and agents reach it through the same door, ADR-0049). It
composes four faculties, each mapped to something that already exists.

1. **The Nerve — one signal log** (anima's event bus, re-expressed substrate-native). A single
   append-only, content-keyed log of typed signals (`PERCEPTION · COGNITION · ACTION · MEMORY ·
   CURIOSITY · GOAL · ALERT`). Every faculty publishes and subscribes. It is *not* a new transport — it is
   a κ-keyed table in the durable store with a `BroadcastChannel` fan-out (the same same-origin mesh
   primitive ADR-0027 already uses). Signals are the raw material the trace corpus is built from.

2. **The verb roster — one surface, three doors.** At loop start, Mind assembles the active roster as the
   union of: per-window MCP tools (ADR-0047), the agent-stack verbs behind `/.well-known/agents.json`
   (ADR-0049), and skills at `/.well-known/skills/index.json` (ADR-0035). Scoped and capped exactly as Holo
   Q's hub already does (`Hologram Apps/apps/q/core/mcphub.js`: `DEFAULT_ARM = 4`, `MAX_ARM = 8`). An app
   opts in by *only* conforming and declaring its verbs — no Mind-specific code per app.

3. **The loop service — intent → plan → act → verify → learn** (§5).

4. **The evolution engine — corpus → optimizer → governed revision** (§6).

The **soul** (§4.7, §4.8) is not a fifth faculty but the objective function and the governance that bind
all four: the prime directive as utility, the drives as goal *proposers*, the conscience as the gate every
proposal must pass.

---

## 4. Data model — the κ-objects

All are UOR objects (ADR-0025). Skeletons below show structure, not the full canonical form; `id` is
always `did:holo:sha256:H(canonical_form)`.

### 4.1 `holo:Intent`
```jsonc
{ "@context": [ "https://schema.org", {"prov":"http://www.w3.org/ns/prov#"},
                {"holo":"https://hologram.os/ns/mind#"} ],
  "type": ["holo:Intent","prov:Entity"],
  "holo:utterance": "<the user/agent ask, verbatim bytes>",
  "holo:source": "user" ,            // user | self | curiosity | environment  (anima's GoalStack sources)
  "holo:contextKappa": "did:holo:sha256:…",  // the conversation/app context it arose in
  "id": "did:holo:sha256:…" }
```

### 4.2 `holo:Plan`
```jsonc
{ "type": ["holo:Plan","prov:Plan"],
  "prov:wasDerivedFrom": "<intent κ>",
  "holo:steps": [ { "verb":"resolve_object", "argsKappa":"did:holo:…", "rationale":"…" }, … ],
  "holo:memoKey": "did:holo:sha256:H(intentκ ⊕ contextκ ⊕ rosterκ)",  // L3 memo key
  "id": "did:holo:sha256:…" }
```
A plan with a known `memoKey` is an O(1) store hit (L3) — the agent does not re-plan what it has planned.

### 4.3 `holo:ActionReceipt` — the existing PROV-O work receipt (ADR-0045), one transform over
```jsonc
{ "type": ["holo:ActionReceipt","prov:Activity"],
  "prov:used": { "verbsKappa":"…", "contextKappa":"…", "agentIdentity":"<NANDA/passport κ>",
                 "policyVerdict":"<conscience verdict κ>", "delegationKappa":"<UCAN κ, ADR-0042>" },
  "prov:generated": { "effectKappa":"…" },
  "holo:actor": "human" ,            // human | agent — SAME shape either way (symmetry requirement)
  "prov:wasAssociatedWith":"<identity κ>",
  "id": "did:holo:sha256:…" }        // re-derives; a flipped field is refused (L5)
```

### 4.4 `holo:Trace` — one append-only corpus entry
```jsonc
{ "type": ["holo:Trace","prov:Entity"],
  "holo:intentKappa":"…", "holo:planKappa":"…", "holo:receiptKappa":"…",
  "holo:outcome": "success" ,        // success | failure | refused
  "holo:failureKind": "…",           // populated on failure — the optimizer's signal (GEPA failure analysis)
  "prov:wasInfluencedBy":"<prior trace κ>",   // append-only hash-link (the AgentTrust chain idiom, ADR-0039)
  "id": "did:holo:sha256:…" }
```
The corpus root is a κ-rooted `dcat:Catalog` (like the immune-corpus, ADR-0033) whose head κ commits to
every trace; appending mints a new head linking the prior (`prov:wasRevisionOf`). Pruning is governed
succession, never in-place deletion (L5: a rewritten past breaks every child).

### 4.5 `holo:SkillRevision` — the learning output, governed succession (mirrors ADR-0033 rule 4)
```jsonc
{ "type": ["holo:SkillRevision","prov:Entity","schema:HowTo"],
  "prov:wasRevisionOf":"<parent skill κ>",
  "prov:wasDerivedFrom": [ "<corpus head κ>", "<optimizer κ>" ],
  "holo:proposalBytes":"<the exact mutated SKILL.md bytes>",   // sealed verbatim — provenance, not reproduced
  "holo:gate": { "testsKappa":"…", "sizeOk":true, "conscienceVerdict":"accept",
                 "ratifiedBy":"<operator>", "coolingOffUntil":"<iso8601>" },
  "holo:inForce": false,             // flips true ONLY after the whole gate passes (§6)
  "id": "did:holo:sha256:…" }
```
The bytes remain a valid Agent Skill `SKILL.md` (ADR-0035 rule 1) — the writeback ADR-0035 deferred.

### 4.6 `holo:Letter` — re-derivable self-assessment (anima's letters-to-self)
```jsonc
{ "type":["holo:Letter","prov:Entity"],
  "holo:narrative":"…", "holo:improvementAreas":[…], "holo:goalsProposed":[…],
  "prov:wasRevisionOf":"<prior letter κ>",        // hash-linked chain → follow-through is verifiable
  "holo:followThrough":"<assessment of the prior letter's goals>",
  "id":"did:holo:sha256:…" }
```

### 4.7 `holo:UserModel` — adapts to, learns from, and teaches the user
A private-first κ-object (durable store only, never published — L1 + Data Sovereignty). Holds the deepening
dialectic model (Honcho-style) as canonical facts. Each session mints a new revision linking the prior; the
*teaching* signal is a first-class field (`holo:explanationsReturned`) so "learn from + teach" is symmetric
and measurable.

### 4.8 `holo:SelfModel` — persistent identity (anima's SelfModel + divergence)
Survives restart as a κ-object: skills created, revisions accepted/rejected, hypotheses tested,
letters chain head, uptime. Its existence is what makes "the agent that grows with you" a *verifiable
history* rather than a feeling — re-derive the chain, see exactly who it became.

---

## 5. The loop algorithm

```
loop(intent):
  1. PERCEIVE  — seal holo:Intent; publish to the Nerve.
  2. ORIENT    — load user-model κ + relevant memory (κ-memo, dedup); assemble verb roster (≤ MAX_ARM).
  3. PLAN      — memoKey = H(intentκ ⊕ contextκ ⊕ rosterκ);
                 if store has plan(memoKey) → O(1) hit (L3); else generate plan, seal holo:Plan.
  4. ACT       — for each step:
                   a. conscience PRE-DISPATCH gate (ADR-0033, os/mcp/holo-mcp.mjs) — kill-switch supreme,
                      immune perimeter screens untrusted input, verdict recorded;
                   b. if accepted → dispatch verb; else → refuse, record, surface caveat;
                   c. if the step fetches the open web → the result must re-derive (ADR-0047) before it
                      becomes context (no unverified noise enters the graph);
                   d. seal holo:ActionReceipt (PROV-O work receipt, ADR-0045), payable (ADR-0048).
  5. VERIFY    — output court (ADR-0033 nine principles; five judged via ask_model) scores the result for
                 coherence + the care/fairness/autonomy/responsibility/justice measure; verdict on receipt.
  6. LEARN     — append holo:Trace (success|failure|refused) to the corpus; update user-model revision;
                 if a complex task completed → enqueue an evolution proposal (§6, async, gated).
  return the result + its receipt κ.
```

Determinism: steps 1–4d and 6 are deterministic given their inputs (re-derivable receipts, L5). Step 3's
*generation* and step 5's *judged* principles call the model; per ADR-0052/0033 the greedy/seeded path is
re-derivable, the sampled path is an explicitly non-verifiable mode and is labelled on the receipt.

## 6. The evolution κ-transform (the heart of "self-evolving")

```
evolve(corpus_head_κ):
  1. SELECT   — read failure traces since the last accepted revision (deterministic query over the corpus).
  2. PROPOSE  — GEPA/DSPy reflective search: ask_model analyses traces+failures and proposes targeted
                mutations to a skill/prompt (API-only, NO GPU training).  ⚠ STOCHASTIC — not re-derivable.
  3. SEAL     — wrap the exact proposed bytes in a holo:SkillRevision (prov:wasRevisionOf parent,
                prov:wasDerivedFrom [corpus_head_κ, optimizerκ]).  ← from here on, fully re-derivable.
  4. GATE (governed succession — mirrors ADR-0033 rule 4, all must pass, fail-closed):
        (a) tests       — the skill's own verification steps run green;
        (b) size limit  — bytes ≤ ceiling (no runaway prompt growth);
        (c) conscience  — the revision passes the constitutional gate;
        (d) ratify      — operator approves (the operator ratifies a change to the AGENT, never the agent);
        (e) cooling-off — a window elapses; the parent κ stays re-pinnable forever (rollback = re-pin parent).
  5. PROMOTE  — only now holo:inForce = true; the new κ joins the live skill set; the prior κ is preserved.
```

What a peer can re-derive (L5): that revision R has `prov:wasRevisionOf` parent P, `prov:wasDerivedFrom`
corpus C, carries proposal bytes B, and that B passed gate G with the recorded verdicts — i.e. *R lawfully
descended from C and was ratified*. What a peer cannot reproduce: the stochastic search in step 2. This is
the exact, honest boundary (see §1, L5).

## 7. Enforcement — the conscience is the only barrier, so it is load-bearing by design

- **One chokepoint.** Every action and every promotion routes through the existing pre-dispatch gate in
  `os/mcp/holo-mcp.mjs` (`mcpDecision` + `tools/call`). Mind adds no second gate and no bypass.
- **Kill-switch supremacy (P7).** A halted OS refuses every Mind verb, including `evolve`.
- **Immune perimeter (ADR-0033).** Curiosity's open-web input is screened for attack shape before it can
  influence a plan; a fetched claim is *noise until it re-derives* (§5, step 4c).
- **The drives propose, they do not act.** Epistemic-hunger Hₑ and fitness Fₐ raise `holo:Intent` with
  `source: "curiosity"|"self"`; each runs the full loop and its gate. Self-discipline is therefore a
  *structural property*, not a virtue: there is no path from a drive to an effect that skips the conscience.

## 8. Witness suite, conformance rows, closure

Per ADR-0024, each phase ships its witness green before the row is added.

| Witness (proposed) | Named checks | Row |
|---|---|---|
| `os/holo-mind-witness.mjs` | roster-union (three doors → one capped roster) · action-receipt-re-derives · receipt-symmetry (human≡agent shape) · refuse-on-tamper · no-new-root (L4) · memo-hit (L3 dedup) | `uor:holo-mind` (required, product-gated) |
| `os/holo-mind-evolve-witness.mjs` | revision-re-derives · provenance-chain (R→C, R→P) · gate-fail-closed (any of tests/size/conscience/ratify missing ⇒ not in force) · rollback (re-pin parent) · corpus-append-only (rewritten past breaks children) | `uor:holo-mind-evolve` |
| `os/holo-mind-soul-witness.mjs` | drive-proposes-never-acts (no drive→effect path skips the gate) · output-court-on-every-result · user-model-private (never published) · curiosity-claim-reverifies | `uor:holo-mind-soul` |

Closure (ADR-0026): served code (`os/holo-mind.mjs` + the loop UI surface) is pinned in `os-closure.json`;
the trace corpus, user-model, and self-model are runtime κ-objects in the durable store, correctly outside
the served closure (they are user data, like Holo Suspend's checkpoint, ADR-0077).

## 9. Phasing — each phase shippable and witnessed

- **Phase 0 — the ambient loop, no learning.** `os/holo-mind.mjs` with `loop · act`; the Nerve as a κ-keyed
  table; roster union over the three existing doors; action receipts through the existing gate. Ships the
  `uor:holo-mind` row. ~1 new module + the roster composition; reuses MCP, conscience, receipts wholesale.
  *Proves: agency is ambient, symmetric, gated, and sealed — with zero new substrate.*
- **Phase 1 — the trace corpus + letters.** Append `holo:Trace` per loop; the corpus as a κ-rooted catalog;
  periodic `holo:Letter`. No optimizer yet. *Proves: experience is captured, append-only, re-derivable.*
- **Phase 2 — governed self-evolution.** The `evolve` verb + the full gate (§6); the skill writeback
  ADR-0035 deferred. Ships `uor:holo-mind-evolve`. *Proves: the agent improves, and you can audit how.*
- **Phase 3 — the soul, fully wired.** Drives as goal-proposers, the output-court coherence measure, the
  deepening user-model, curiosity over the open web. Ships `uor:holo-mind-soul`.
- **Phase 4 — orchestration at scale.** Parallel sub-agents (ADR-0042/0045) and scheduled tasks; honest
  about the on-device model ceiling and the loop depth (the path is larger MoE off the κ-disk + deeper
  loops, not a claim).

## 10. Honest risks & non-goals (carried from ADR-0081, sharpened)

- **Intelligence ceiling.** Ubiquity ≠ intelligence. Reasoning is bounded by what QVAC runs on-device
  (ADR-0052/0067); the current tool loop is shallow (`Hologram Apps/apps/q/core/tools.js`, `maxRounds = 4`).
- **Blast radius.** OS-wide self-improving autonomy makes the fail-closed conscience the *only* barrier;
  the gate's correctness is load-bearing. Mitigations are structural (one chokepoint, kill-switch, operator
  ratification, re-pinnable parent), not eliminative.
- **Goodhart.** "Maximize signal" is gameable if the coherence metric is self-graded. The metric MUST be a
  witnessed, re-derivable computation — never a score the agent assigns itself.
- **Curiosity as attack surface.** Reaching the open web invites injection/poisoning; the immune perimeter
  screens, and re-verification (L5) means a fetched claim is noise until it re-derives.
- **Non-goal: reproducible LLM search.** The optimizer's proposal step is stochastic; the spec proves L5
  over the audit trail, not the generation. We do not claim otherwise.
- **Non-goal: a second store/transport/trust root.** Forbidden by L4; witnessed by `no-new-root`.
```
