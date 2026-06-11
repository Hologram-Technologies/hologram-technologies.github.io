# ADR-042: Holo Delegate — verifiable, content-addressed capability chains (UCAN ⊕ UOR)

**Status:** Accepted — witnessed: `delegate-witness.mjs` is green and `w3c:A54-holo-delegate` is a row in
`w3c-conformance.jsonld`; the two spec rows (`ucan-delegation`, `holo-delegate`) are in `specs.json`; the
canonical UCAN delegation spec is vendored byte-faithfully and κ-pinned into the conform index; the
delegation index is the 9th root of the repository graph. Builds on the UOR envelope + `verifyDeep`
(ADR-025), the signature/attribution layer (`holo-vc.mjs`, eddsa-jcs-2022), and the agent stack
(NANDA 034 · Skills 035 · A2A 036 · AgentTrust 039).

**Context.** The agent stack can now *discover* an agent (NANDA), *describe* and *call* it (A2A/Skills),
and *know whether to trust* it (AgentTrust). The missing layer is **authorization**: when agent A asks
agent B to act on A's behalf — read a balance, spend a budget, query a record — B needs a **scoped,
revocable, provable grant of authority**, and the resource owner needs to verify it *without trusting an
orchestrator*. This is also the enabling sub-layer for verifiable multi-agent orchestration: a work
receipt records, per step, the delegation each agent acted under.

The right model is **UCAN** (User-Controlled Authorization Networks, ucan-wg) — decentralized, did-keyed,
**attenuating** capability chains that already reference their proofs by content. A UCAN delegation
carries `iss` (granter), `aud` (grantee), `sub` (the subject the chain is about), `cmd` (the command),
`pol` (a policy over invocation arguments), `nonce`, and `exp`; the chain must satisfy **principal
alignment** (each proof's `aud` equals the next delegation's `iss`) and root in the subject, and a
delegation may only **narrow** its proof. UCAN-as-JWT and W3C ZCAP-LD both express this, but verification
still walks a chain of *signatures*.

**Decision.** **A capability delegation is a self-verifying object; escalation is caught by
re-derivation, not by trusting the issuer.** Three binding rules:

1. **One delegation, three identities** (`holo-delegate.mjs`). Each delegation is, on the same bytes, a
   valid UCAN delegation, a self-verifying UOR object (`id = did:holo:sha256(content)`), and a W3C
   Verifiable Credential (an `eddsa-jcs-2022` proof — and per UCAN the signature **must bind to `iss`**).
   It references its parent capability by **content address** (`prov:wasDerivedFrom` Merkle link), so the
   whole proof chain is a UOR Merkle-DAG that `verifyChain`/`verifyDeep` re-derives end-to-end (Law L5).
2. **Two escalation guards, verifiable by re-derivation.** **Principal alignment** — `verifyChain`
   requires each proof's `aud` to equal the child's `iss` and the chain to root in `iss === sub`, so you
   can only re-delegate what was granted to you. **Attenuation** — a child's `cmd` must be nested under
   its parent's, and the *effective* policy and expiry at invocation are the **conjunction / minimum**
   over the whole chain, so a child can only narrow. A forged broader capability fails the chain; a child
   that drops a parent's policy gains nothing (the parent's predicate still applies). A small UCAN policy
   engine (`==, !=, <, <=, >, >=, like, and, or, not`) scopes the invocation's arguments.
3. **Revocation is content-addressed and irreversible.** A revocation is an append-only signed object
   naming a capability's κ; revoking it invalidates its **whole subtree** (every chain through that κ)
   and cannot be un-said — the same property AgentTrust gives a reputation, applied to authority.

**Consequences.**

- **Scoped, provable agent authority.** `node holo-delegate.mjs build` emits a demo chain (owner → A → B)
  + the κ-rooted index. The verifier (`authorize`) grants an invocation only if the chain re-derives,
  roots in *its* authority, the invoker is the leaf's `aud`, the command is in scope, and the args
  satisfy the chain's effective policy.
- **The UOR edge.** Each attack is refused by **re-derivation**, witnessed: principal misalignment,
  command escalation, out-of-scope / policy-violating invocation, a chain rooted in the wrong authority,
  a revoked subtree, an expired link, a tampered byte (Law L5), and an impersonated signature.
- **Composes with the stack.** A delegation's `iss`/`aud`/`sub` are the same did:keys the AgentFacts/
  AgentTrust use; the A2A bridge can check a capability before dispatching an MCP tool; the (next)
  orchestration receipt records the delegation each step acted under. It also dovetails with the existing
  Holo Terms / Holo Privacy default-deny capability sandbox (ADR-028/privacy) — UCAN policies can carry
  DPV purposes / ODRL constraints.
- **Mint nothing.** UCAN's own vocabulary + W3C DID/VC + PROV-O; the directory is DCAT.

**External authorities.** [UCAN delegation](https://github.com/ucan-wg/delegation) (ucan-wg); W3C
[Decentralized Identifiers](https://www.w3.org/TR/did-core/) + [VC Data Integrity](https://www.w3.org/TR/vc-data-integrity/)
(eddsa-jcs-2022) + [PROV-O](https://www.w3.org/TR/prov-o/) + [DCAT](https://www.w3.org/TR/vocab-dcat-3/);
Law L5 (verification by re-derivation).
