# ADR-045: Holo Orchestrate — the verifiable multi-agent work receipt (a content-addressed execution DAG)

**Status:** Accepted — witnessed: `orchestrate-witness.mjs` is green and `w3c:A56-holo-orchestrate` is a
row in `w3c-conformance.jsonld`; the `holo-orchestrate` spec row is in `specs.json`; the work-receipt
index is the 10th root of the repository graph. The keystone of the agent stack — it composes NANDA
(034), AgentTrust (039), and Holo Delegate (042) by content address. Builds on the UOR envelope +
`verifyDeep` (ADR-025), the signature layer (`holo-vc.mjs`), and W3C PROV-O.

**Context.** The agent stack can now *discover* an agent (NANDA), *describe and call* it (A2A/Skills),
know whether to *trust* it (AgentTrust), and *authorize* it for a scoped task (Delegate). What it could
not do is the thing the whole "Internet of Agents" is *for*: **verify what a multi-agent collaboration
produced.** When agent A delegates to B delegates to C and you receive an answer assembled from ten
agents — each calling tools, each delegating further — you have **zero verifiable visibility into how it
was produced.** This black-box-orchestration problem is the looming trust (and provenance/regulatory)
crisis of the agentic web. NANDA's signatures sign individual *messages*; nothing binds a whole
*computation* into one re-derivable proof. You are back to trusting the orchestrator.

**Decision.** **A multi-agent computation is a content-addressed execution DAG — a "work receipt" — whose
root κ is self-verifying proof of the whole collaboration.** Three binding rules:

1. **Every step is a self-verifying provenance object** (`holo-orchestrate.mjs`, `runStep`). Each step is
   a W3C **PROV-O** `prov:Activity` (a `did:holo` over its content, signed by the acting agent's
   operational key) that links, by content address, to: the agent's **identity** (its NANDA AgentFacts
   κ, `prov:wasAssociatedWith`), the agent's **reputation** (its AgentTrust chain head κ, `schema:agent`),
   the **delegation** it acted under (a UCAN capability, `prov:qualifiedDelegation`), and its **inputs**
   (`prov:used` → prior steps' outputs — the DAG edges). One object ties together every layer of the
   stack.
2. **The answer's κ commits to the whole computation; verify by re-derivation** (Law L5). The final
   step's κ commits, transitively through `prov:used`, to every prior step and its delegation chain.
   `verifyDeep(receipt)` re-derives the entire DAG. Tamper any intermediate step and the root κ no longer
   re-derives — **you cannot fake what an agent produced.** Deterministic steps **replay** to the same κ;
   non-deterministic (model) steps are **sealed** with their attestation — tamper-evident, attributable,
   replayable-for-audit even when not re-computable.
3. **Compose, don't re-implement, and mint nothing.** Identity, reputation, and authorization are the
   *existing* objects (ADR-034/039/042), referenced by κ; the witness independently resolves and verifies
   each. The vocabulary is W3C PROV-O + schema.org — a work receipt is, literally, a verifiable PROV
   provenance bundle.

**Consequences.**

- **The answer carries its own proof of provenance.** `node holo-orchestrate.mjs build` runs a 3-agent
  demo pipeline (read a balance → assess it → compose the answer) and emits the receipt + κ-rooted index.
  Re-derive the receipt κ and you see precisely which agents (and how reputable, and under what authority)
  produced each part; flip any byte and it refuses.
- **The UOR edge, witnessed.** Over plain PROV (RDF claims you must trust) and signed message logs (which
  sign messages, not computations): verification across the *whole* DAG by re-derivation. The witness
  proves the receipt re-derives (depth ≥ 3); every step composes a resolving+verifying identity κ, a
  resolving+verifying reputation head κ, a delegation, and its declared inputs; every step is authorized
  (an out-of-scope step is refused); deterministic steps replay; the model step is sealed; the data flow
  is honest (no smuggled inputs); a mutated step breaks the receipt; the trust-weighted confidence is
  bounded by the least-reputable agent.
- **Constitutional provenance per step (implemented; row A57).** Every step carries a re-derivable
  **conscience verdict** judged against the canonical Holo Constitution κ (ADR-033), sealed as a UOR
  object linked into the step (`prov:wasInformedBy`) — so re-deriving the answer's κ *also* proves
  **every step passed the conscience gate.** The receipt is itself an audit object (P2 Provenance holds
  by construction) and the kill switch (P7) is supreme: a red-line block or a tripped kill switch
  hard-refuses and the whole orchestration **halts** (fail-closed). The verdict is committed into the
  receipt κ, so a tampered verdict breaks re-derivation. The answer now proves not just *who* acted,
  *how reputable*, and *under what authority*, but that every step was **constitutionally permitted.**
- **The trustless agent economy.** Output you can verify is the precondition for paying for it: NANDA
  payments and verifiable settlement ride on the receipt — settle against *proven* work, not *claimed*
  work.
- **Scope.** The demo steps are deterministic pure ops plus one sealed model step; in production the
  executor delegates each step to the real A2A bridge / MCP dispatch, and the model step's attestation is
  the model's signed output. The data model and verification are production-shaped.

**External authorities.** W3C [PROV-O](https://www.w3.org/TR/prov-o/) +
[Decentralized Identifiers](https://www.w3.org/TR/did-core/) +
[VC Data Integrity](https://www.w3.org/TR/vc-data-integrity/) (eddsa-jcs-2022) +
[schema.org](https://schema.org/); Project NANDA AgentFacts; UCAN delegation; Law L5 (verification by
re-derivation).
