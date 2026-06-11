# ADR-039: Holo AgentTrust — verifiable, portable, tamper-evident agent reputation as a content-addressed chain

**Status:** Accepted — witnessed: `agenttrust-witness.mjs` is green and `w3c:A52-agent-trust` is a row
in `w3c-conformance.jsonld`; the three spec rows (`agent-trust`, `agent-reputation`,
`agent-audit-trail`) are in `specs.json`; the AgentTrust index is the 8th root of the repository graph
(`codemeta.json`). Builds on the UOR envelope + `verifyDeep` (ADR-025), the signature/attribution layer
(`holo-vc.mjs`, eddsa-jcs-2022), Holo NANDA (ADR-034), and the κ↔CIDv1 law (ADR-026).

**Context.** Having projected every holospace into NANDA (ADR-034), Agent Skills (035) and A2A (036),
the remaining question is the one the NANDA papers and community flag but do not solve: **why should
anyone trust an agent's facts?** The pain is documented and concrete:

- *Self-advertising metadata enables unverifiable claims* (NANDA "Beyond DNS", arXiv:2507.14263) —
  uptime/latency/throughput in AgentFacts are **self-reported**, with "no telemetry or reputation
  mechanism to prevent gaming" (the project FAQ).
- *The "freshly minted" fraud* — the **BasisOS** incident (Nov 2025, $531K) had "no history showing
  the identity was freshly minted." A brand-new identity looks identical to a long-standing one.
- *Audit-trail gaps* — the AgentFacts schema has an `evaluations.auditTrail` field, yet "no audit
  architecture is specified."
- *Sybil* — Cheng & Friedman proved reputation mechanisms are inherently Sybil-vulnerable; fake
  identities are cheap.
- *Portable reputation* — reputation does not survive registry/platform churn (the "35% problem").

NANDA's answer is **signatures** (W3C VC v2, cross-signing trust zones). A signature proves *who*
asserts a fact *now*. It does **not** prove the fact's **history wasn't rewritten**, the identity's
**age**, or that a claimed number **matches reality over time**. That is a gap content addressing
closes exactly.

**Decision.** **An agent's reputation is a content-addressed, append-only, hash-linked chain — one κ
commits to its whole history.** Four binding rules:

1. **Each attestation is a self-verifying UOR object** (`holo-agenttrust.mjs`, `append`). Genesis,
   uptime measurement, accredited certification, peer review, revocation — each is a `did:holo` over
   its own content, carrying its **issuer's** W3C Data Integrity proof (eddsa-jcs-2022, so *who*
   attested is provable) and a `prov:wasDerivedFrom` **Merkle link to the previous head**. The head κ
   therefore commits, transitively, to the entire history.
2. **Verification across TIME, by re-derivation** (Law L5). `verifyDeep(head)` walks the prev-links and
   re-derives every entry to genesis. Change a single byte of any past entry and its κ changes,
   breaking the next entry's link digest — **the head no longer re-derives**. You cannot rewrite the
   past, fabricate a track record, or hide that an identity was minted minutes ago.
3. **Numbers are RECOMPUTED, not trusted** (`summarize`). The reputation summary — age, mean uptime,
   distinct-issuer count (a Sybil signal), review mean, revocation status, freshly-minted flag — is a
   deterministic function of the chain. A claimed `availability90d` that the recorded measurements
   don't support is caught. Telemetry can't be gamed.
4. **Close the NANDA loop, mint nothing** (`evaluationsFrom`). The AgentFacts `evaluations.auditTrail`
   becomes a real `holo://κ` that **resolves** to this chain, and `availability90d` / `performanceScore`
   / `lastAudited` are recomputed from it — the enriched AgentFacts still validates against the
   byte-pinned upstream schema. Vocab is schema.org (Review/Rating/Certification/Observation) + W3C VC +
   PROV-O + NANDA's own `af:` telemetry terms; the directory is DCAT.

**Consequences.**

- **The UOR edge, demonstrated.** Each problem above maps to a witnessed property: tamper-evident
  history; freshly-minted detection (genesis-only ⇒ flagged); un-gameable telemetry (recompute vs
  claim); real audit trail (auditTrail resolves); self-vs-third-party (per-entry signer); irreversible
  revocation (committed into the head κ); **portable** reputation (the head κ *is* a CIDv1 — the same
  object in every registry and on IPFS). No CA, no blockchain, no registry in the trust path.
- **Sybil-resistant issuer reputation (implemented; `holo-agenttrust-rank.mjs`, row A53).** The chain
  proves an agent's history is un-*rewritable*; weighting each attestation by its **issuer's** trust makes
  it un-*floodable*. Issuer trust is a Personalized PageRank (HoloRank) from a seed the relying party
  trusts, over the issuer **endorsement** graph, with two guards: **authorization** — an endorsement
  counts only if the endorser signed it (`by === from` + a verifying proof), so you cannot forge "the
  root endorses me"; and **personalization** — trust flows only from the seed, so a self-endorsing Sybil
  clique is unreachable and scores 0. An unendorsed Sybil scores **exactly 0**, so flooding a chain with
  validly-signed Sybil attestations leaves the trust-weighted reputation unchanged — the Cheng & Friedman
  result (counting work is exploitable; personalized trust is the escape) made concrete and re-derivable.
  Witnessed by `agenttrust-rank-witness.mjs`: +120 Sybil reviews → the trust-weighted reputation is
  exactly unchanged while raw/distinct-issuer counts explode; the forged-endorsement guard is shown
  load-bearing.
- **Artifacts.** `node holo-agenttrust.mjs build` emits `agenttrust/hologram-os.chain.json` (the OS
  agent's full chain), `agenttrust/index.jsonld` (every agent's head κ + recomputed summary), and
  `agenttrust/agent-facts.enriched.json` (the closed loop). Deterministic; one demo agent is revoked to
  exercise revocation.
- **Scope.** The chains here are seeded, realistic histories that prove the model; in production, real
  measurers and auditors append real signed attestations (the operator's probe, an accredited auditor's
  certification, peer reviews). The data model and verification are production-shaped.

**External authorities.** Project NANDA "Beyond DNS" (arXiv:2507.14263) AgentFacts
evaluations/auditTrail/certification; W3C [VC Data Integrity](https://www.w3.org/TR/vc-data-integrity/)
(eddsa-jcs-2022) + [schema.org](https://schema.org/) (Review/Rating/Certification/Observation) +
[PROV-O](https://www.w3.org/TR/prov-o/); IPLD/multiformats CIDv1; the byte-pinned AgentFacts JSON
Schema; Law L5 (verification by re-derivation).
