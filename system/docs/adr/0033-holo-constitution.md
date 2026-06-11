# ADR-033: Holo Constitution — the constitutional core as an immutable, self-verifying, formally-consistent UOR object

**Status:** Accepted — witnessed: `holo-constitution-witness.mjs` is green and `uor:holo-constitution`
is a required, product-gated row in `w3c-conformance.jsonld`. The eight constitutional principles of
**Hologram OS** (*Constitutional AI and Guardrails*, Hologram Technologies) are sealed as
content-addressed `odrl:Rule` objects under one κ-rooted `odrl:Policy` whose root `did:holo` commits to
them all and to a machine-checked consistency proof; the normative source document is byte-pinned as a
Merkle leaf. Builds on the UOR envelope (ADR-025), the one κ primitive (Law L2, `holo-uor.mjs`), the
witnessed-conformance regime (ADR-024), and mirrors the construction of Holo Conform (ADR-031).

**Context.** Hologram OS governs what it asserts, what it does, and what may leave the machine — but it
had no *constitution*: no foundational, enforceable statement of the principles those behaviours must
obey. The Hologram OS reference solves the same problem for a sovereign cognitive platform with eight
principles encoded in formal logic, a Z3 SMT non-contradiction proof, a runtime conscience gate, and an
*immutable, signed* amendment log. Those are file-and-key constructs. Three facts make a more
fundamental encoding both possible and necessary here:

- **Immutability by signature is weaker than immutability by content.** A signed log is only as
  immutable as the key that signs it and the process that guards the log. In this substrate identity
  *is* content (Law L5): an object's id is `did:holo:sha256:H(canonical-form)`. A constitution sealed as
  a κ-object cannot be altered without changing its κ, and a tamper is caught by **re-derivation**, not
  by trusting a key or a server. There is no key to steal and no log to rewrite.
- **A principle must be enforced, not merely declared.** A constitution that is documentation is a
  content filter waiting to be bypassed. The principles have to meet the actual bytes of a decision at
  runtime, through one gate that fails closed, and the build must refuse to ship if the gate is enforcing
  anything other than the canonical, proven-consistent constitution.
- **"Consistent" must be shown, not asserted.** Permissive clauses interact (consent and minimisation
  can be relaxed by a regime; classification never is). With clauses like these you want a *proof* that
  no situation satisfies one principle's permission while violating another's prohibition.

**Decision.** **The constitution is an object, not a document — and a proof, not a promise.** Four
binding rules:

1. **Seal the principles into the substrate** (Law L4/L5). Each of the eight principles is a
   self-verifying `odrl:Rule` UOR object (its governed action an `odrl:action`, its relaxing regimes
   `odrl:constraint`, its enforcing OS part a PROV-O influence). All hang under one `odrl:Policy`
   **constitution root** whose `did:holo` commits to every principle, to the consistency proof, and to
   the byte-pinned normative source — so the whole constitution is one re-derivable content address a
   peer verifies with `verifyDeep` (depth ≥ 2, through the source leaf). Built FROM the in-module
   `PRINCIPLES` (the editable source), no parallel store.
2. **Prove consistency exhaustively, with no solver** (the Z3-free replacement). The world model is ten
   booleans; `proveConsistency` enumerates all `2^10` assignments and machine-checks that the
   constitution is satisfiable, that all 28 principle-pairs are jointly satisfiable (the
   `pairwise_check`, made exhaustive), and that every named proof obligation holds — classification is
   absolute under every regime, minimisation is *not* relaxed by emergency, consent *is*, the kill
   switch is supreme, and no permission forces a prohibited disclosure. Exhaustive enumeration is exact,
   deterministic, and dependency-free, so it **never degrades to a heuristic** the way an absent SMT
   solver would; the proof is sealed into the DAG, so "proven consistent" is a content-addressed fact.
3. **Enforce at runtime through one fail-closed gate** (Law L5). `_shared/holo-conscience.js` is the
   isomorphic conscience gate (browser Web Crypto; also runs in Node for its witness). On load it
   **re-derives** each principle's address and compares it to the canonical κ; if a single byte of a
   rule has been altered the gate **seals shut** and refuses everything rather than enforce a tampered
   constitution. The gate's verdicts (per-principle accept | caveat | block) mirror the Node module
   byte-for-byte. Red-line violations — individual privacy (the dignity hard block), classified
   disclosure, a kill-switch bypass — always block and never downgrade, even under the default
   answer-then-caveat posture; non-red-line violations downgrade to a graded caveat so the system
   answers usefully with its limits stated.
4. **Evolve only by governed succession** (immutable as artifacts). An amendment never mutates a
   principle; it mints a **new** constitution root that links its parent (`prov:wasRevisionOf`) in an
   append-only, hash-linked chain, in force only after operator ratification and a cooling-off window,
   the prior κ preserved forever (rollback = re-pin the parent). The chain is append-only by arithmetic:
   a rewritten past amendment changes its κ and breaks every child. `verifyChain` re-derives the chain
   and refuses an unratified or rewritten amendment.

**Enforcement.** `uor:holo-constitution` is a **required, product-gated** row: the strict W3C gate
(wired into the Pages build) refuses to ship a build where the constitution does not re-derive or is not
proven consistent. This is the keystone — the constitution is foundational because the OS cannot deploy
without it.

**Consequences.** Hologram OS now has a constitutional core that is immutable (by content, not by key),
self-verifying (re-derived, not trusted), formally consistent (proven exhaustively, not asserted), and
enforced (a fail-closed gate plus a release gate that blocks a non-conformant build). The standing cost
is one module, one byte-pinned source, one witness, and one gate row — the construction-guarantee
discipline ADR-024 already pays. The runtime gate is available OS-wide as `window.HoloConscience` and is
routed through the OS's two real chokepoints — the **MCP tool dispatch** (a pre-dispatch autonomy
guardrail in `mcp/holo-mcp.mjs`: kill-switch supremacy, audit/provenance, with personal-data calls
falling through to the Holo Privacy gate) and the **Holo UI control surface** (`installToSurface`,
fail-closed) — witnessed by the required, product-gated `uor:holo-constitution-enforce` row.
**Per-app closure binding** has landed: every holospace carries the conscience gate in its
content-addressed closure as a mandatory baseline (`tools/build-app.mjs` `computeApp`), so an app's
`did:holo` identity commits to the gate that embeds + self-verifies the constitution root κ — and the
required `w3c:A26-app-package` row (`apps-witness.mjs`) proves every shipped app re-derives carrying
exactly the canonical constitution, so no app ships without it. The **output court** — the nine-principle
gate on the answer (source §5), four checked deterministically (Truth, Transparency, Proportionality,
and the Dignity red line) and the **five judged principles** (care, fairness, autonomy, responsibility,
justice) evaluated by an injected model (the MCP `ask_model` sampler — the OS borrowing the agent's own
model) — has landed: flag-gated (`lucida_constitutional_llm`, default off) with an honest fallback to
recorded caveats, the nine principles sealed as immutable κ-objects, witnessed by `uor:holo-output-court`.
The **perimeter / immune layer** (source §8.1) has landed too — the first defence layer, ahead of the
constitution: an innate, training-free scorer of untrusted input for attack shape plus a regulatory gate
that caps false positives (a review band) and observes by default (never auto-blocks — so it can't
become a DoS; blocking is a deliberate enforce act), with the detector ruleset sealed as immutable
κ-objects and wired at the MCP input boundary; witnessed by `uor:holo-immune`. The source's **adaptive**
classifier — the detector that learns from confirmed attacks (staged for a later phase in the reference design) — is
realised too: a deterministic, dependency-free Naive-Bayes model that is a PURE FUNCTION of a
content-addressed, append-only corpus of confirmed examples, so the learned model is itself
self-verifying (re-derive the corpus, re-derive the model, Law L5), abstains honestly when under-trained,
learns from each confirmed attack, and is off by default; witnessed by `uor:holo-immune-adaptive`. All
six layers of the source document — and the adaptive tier the source itself defers — are now realised
natively. We explicitly **reject** a
constitution held as documentation, an immutability that rests on a signature, and a consistency that is
claimed rather than proven.

External authorities: **W3C ODRL 2.2** (the policy/permission/prohibition/duty model); **schema.org**,
**W3C DCAT 3**, **DCMI Terms**, **W3C PROV-O** (metadata, cataloguing, provenance, derivation); **W3C
Subresource Integrity** / **IPLD** content-addressed Merkle-DAG (Law L5); the **Hologram OS**
constitution (the byte-pinned normative source). Module + verbs (build/verify/prove/evaluate/amend):
`os/holo-constitution.mjs`; runtime gate: `os/_shared/holo-conscience.js`; committed artifacts:
`os/constitution/constitution.uor.json` (the κ-rooted DAG), `os/constitution/proof.json` (the consistency
proof), `os/constitution/amendments.uor.json` (the genesis chain), `os/constitution/pins.json` +
the byte-pinned human-readable text (`os/etc/constitution/CONSTITUTION.md`, pinned as `hologram-constitution` in `pins.json`); witness:
`os/holo-constitution-witness.mjs`; catalog row: `uor:holo-constitution` in
`conformance/w3c-conformance.jsonld`. Enforcement wiring: the MCP pre-dispatch gate in
`os/mcp/holo-mcp.mjs` (`mcpDecision` + the `tools/call` chokepoint) and the Holo UI control-surface gate
(`installToSurface` in `os/_shared/holo-conscience.js`, called from `os/_shared/holo-ui-kernel.js`),
witness `os/holo-constitution-enforce-witness.mjs`, catalog row `uor:holo-constitution-enforce`. Output
court (source §5): the nine principles + `judgeOutput` in `os/_shared/holo-conscience.js`, sealed by
`buildOutputCourt` in `os/holo-constitution.mjs` to `os/constitution/output-court.uor.json`, witness
`os/holo-output-court-witness.mjs`, catalog row `uor:holo-output-court`. Per-app closure binding: the
mandatory constitutional baseline in `os/tools/build-app.mjs` (`computeApp`), enforced by
`os/apps-witness.mjs` (the required `w3c:A26-app-package` row). Perimeter / immune layer (source §8.1):
the innate scorer + regulatory gate in `os/_shared/holo-immune.js`, sealed by `buildImmune` in
`os/holo-constitution.mjs` to `os/constitution/immune.uor.json`, wired at the MCP perimeter
(`os/mcp/holo-mcp.mjs`), witness `os/holo-immune-witness.mjs`, catalog row `uor:holo-immune`. Adaptive
classifier: the learn-from-confirmed-attacks model in `os/_shared/holo-immune-adaptive.js`, its corpus
`os/constitution/immune-corpus.json`, sealed by `buildAdaptive` in `os/holo-constitution.mjs` to
`os/constitution/immune-adaptive.uor.json`, witness `os/holo-immune-adaptive-witness.mjs`, catalog row
`uor:holo-immune-adaptive`.
