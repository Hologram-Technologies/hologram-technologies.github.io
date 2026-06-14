# ADR-077: Holo Suspend — dehydrate ↔ rehydrate a live run to a content-addressed checkpoint

**Status:** Proposed — **spiked and witnessed**: `tools/holo-suspend-witness.mjs` is green (7/7) over
`os/usr/lib/holo/holo-suspend.mjs`. Not yet a conformance row and not gate-wired (the witness runs
standalone); the module is unreferenced by served code, so it is correctly *outside* `os-closure.json`.
Promotion (a `#suspend-resume` row, the witness in `gate.mjs` LIVE, a durable κ-store adapter, a real
executor) is listed under *Consequences → Scope*. Builds on the UOR envelope + `verifyDeep` (ADR-025) and
W3C PROV-O; it is the resumable counterpart of Holo Orchestrate's finished work receipt (ADR-045).

**Context.** Holo Orchestrate (ADR-045) makes a *finished* multi-agent computation a content-addressed
execution DAG — a work receipt you re-derive after the fact. But a real collaboration is not always run to
completion in one breath. An agent run pauses for a human approval, hits a budget ceiling, migrates to
another device, or is parked for hours and resumed. Today there is **no way to stop a run in flight and
continue it later** without trusting whatever blob some orchestrator wrote to disk: the paused state is
off-substrate, unverifiable, and host-bound. You can prove what a run *produced*; you cannot prove what a
run *is, mid-flight*, nor that resuming it continued the same computation rather than a forged one. That is
the gap between a receipt and a **resumable process**.

**Decision.** **A paused run is a content-addressed checkpoint — one self-verifying UOR object whose κ is
the frozen process.** `dehydrate(state)` seals it; `rehydrate(κ)` restores it exactly. Four binding rules:

1. **The checkpoint commits to the whole run state — the provenance *and* the frontier**
   (`holo-suspend.mjs`, `dehydrate`). One `prov:Entity` (`hosus:Suspension`) commits, by content, to: the
   **program** κ (the plan), the **cursor** (where execution paused), the **frontier** (every live output
   that feeds the next step, verbatim), the completed **step chain** (the κ list of step receipts), and the
   authority **context** κ it ran under. It carries a Merkle link (`prov:wasDerivedFrom`) to the chain head,
   so the frozen DAG hangs off the checkpoint and re-derives with it.

2. **Restore is verify-by-re-derivation; a tampered checkpoint never resumes** (Law L5). `rehydrate`
   `verifyDeep`s the whole frozen DAG before reconstructing anything — flip a byte in the checkpoint or in
   any frozen step it commits to and restore is **refused**, not silently resumed from a corrupted state.

3. **Resume is invisible in the proof.** Step receipts are **timestamp-free**, a pure function of
   `(name, cursor, output, prior, program)`. So a run suspended at step *k* and resumed seals byte-identical
   receipts and reaches the **same final receipt κ** as a run that never paused — across machines, since a κ
   is a function of content, not of host. A model (non-deterministic) step's output is **frozen** into the
   checkpoint, so resume continues *from* it rather than re-running it: you never recompute the past, only
   the future — correct for stochastic steps too.

4. **Resume cannot widen scope, and mint nothing.** The checkpoint commits to its program κ and context κ,
   so `rehydrate` refuses a swapped plan or a different authority — a pause is not a privilege-escalation
   seam. Code (the step functions) is out-of-band, referenced by the program κ exactly as Holo Forge
   references source by κ (ADR-051); the caller re-supplies the ops. The vocabulary is W3C PROV-O +
   schema.org — a checkpoint is, literally, a PROV entity derived from the step activities.

**Consequences.**

- **A run you can stop, move, and continue — provably.** Suspend on one device, fetch the checkpoint κ (and
  the step κs it commits to) from wherever the bytes live — durable store · peers · IPFS · origin — and
  resume on a device that never started the run. It composes with the healer/resolver: the same
  torrent-style, origin-agnostic recovery (ADR-026, the `#self-heal` row), now applied to live process state.
- **The checkpoint is a first-class object.** Being a κ, it flows into everything κ flows into — Own
  (ADR-053), Settle (ADR-048), Orchestrate (ADR-045) — and is recoverable, shareable, and ownable for free.
- **Witnessed.** `holo-suspend-witness.mjs` proves: the state round-trips exactly (cursor + frontier +
  step-chain + program); the checkpoint is content-addressed (same state ⇒ same κ, one more step ⇒ a
  different κ); **resume equals uninterrupted** (same final κ straight vs suspend@k+resume, across separate
  stores); a tampered checkpoint *or* a tampered frozen step is refused; it **migrates** to a fresh store
  (the resuming machine lacked the answer and had to compute it) to the same final κ; a swapped program or
  context κ is refused; and the frozen DAG re-derives with `verifyDeep` (depth ≥ steps completed).
- **Scope (spike → production).** The spike uses a `Map` UOR store and deterministic demo ops (double →
  inc → render). To promote: (1) write the `#suspend-resume` conformance row and add the witness to
  `gate.mjs` LIVE; (2) swap the `Map` for a durable `holo-kstore` adapter (async `kget`/`kput`) so a
  checkpoint survives a closed tab; (3) point `ops` at the real A2A/MCP dispatch so a step is a delegated
  agent call, not a pure function; (4) the data model is already production-shaped (PROV-O over the UOR
  envelope). Frontier outputs must be JSON/JCS-canonicalizable; a binary frontier needs DAG-JSON.

**External authorities.** W3C [PROV-O](https://www.w3.org/TR/prov-o/) (a checkpoint is a `prov:Entity`
`wasDerivedFrom` the step activities) + [Decentralized Identifiers](https://www.w3.org/TR/did-core/)
(`did:holo` content id) + [Subresource Integrity](https://www.w3.org/TR/SRI/) (the Merkle link digests) +
[schema.org](https://schema.org/); IETF [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (JCS — the
canonical bytes a κ commits to); holospaces Laws L1/L3/L5 (identity is content · dedup by content · verify
by re-derivation); ADR-025 (UOR envelope), ADR-045 (Holo Orchestrate).
