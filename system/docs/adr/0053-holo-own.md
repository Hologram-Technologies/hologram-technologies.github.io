# ADR-053: Holo Own — verifiable, self-sovereign ownership on the content-addressable substrate (the "Own" era, without the casino)

**Status:** Accepted — witnessed: `tools/holo-own-witness.mjs` is green (12/12, with **real WebCrypto
Ed25519/ECDSA** signatures via `holo-identity`) and `#own` is a required row in
`os/etc/conformance.jsonld`; `node system/tools/gate.mjs` → **PASS 14/14**. Implemented in
`os/usr/lib/holo/holo-own.mjs`. It composes, by reference, the Constitution (ADR-033), NANDA identity
(ADR-034), AgentTrust (ADR-039), Delegate / UCAN (ADR-042), Orchestrate (ADR-045) and Settle (ADR-048),
on top of `holo-identity.mjs` (self-sovereign key → `did:holo`), the content-addressing σ-axis now proven
byte-identical to the hologram substrate (`#kappa-parity`, BLAKE3), and the self-editable read/write
substrate (`#read-write`: `holo-realization.mjs` · `holo-store.js` · `holo-world-rw.mjs`). The economic /
anchoring layer is consumed from the existing chain kit (`prism-btc`, `holo-eth`/`holo-evm`, `holo-solana`,
`wdk`, `holo-wallet-bridge`) — never re-implemented (Law L4, ADR-006).

**Context.** Hologram OS can now **Read** (resolve any identifier → a self-verifying object) and **Write**
(every component is a durable, content-addressed object that splits into smaller κ-objects or fuses into
larger ones). Chris Dixon's *Read Write Own* names the next era: **Own** — true digital property rights,
economic ownership, and community/network governance, shifting value from platform rents back to users,
creators, developers, and **AI agents** at the edges. Dixon's mechanism is the blockchain. Ours cannot be:
**Law L1** (identity is content, never a host/URL), **Law L4** (no parallel memory/storage/network/runtime —
holospaces is a thin layer over the substrate, it adds no second infrastructure), and the cardinal
discipline *"external systems are referenced by hyperlink, never restated"* forbid Hologram from **becoming**
or **minting** a chain. The question this ADR answers: **what is "Own" when the substrate is UOR content-
addressing rather than a global consensus ledger?**

The unlock that makes the question answerable landed in `#kappa-parity`: an OS2 object's κ is now
byte-identical to the substrate's (`blake3:` + BLAKE3 of its canonical SPINE-2 bytes), so an owned object is
**portable across the shared network** — and you cannot *own* a share of a network your objects cannot
*resolve onto*. Portability is the precondition for ownership.

**Decision.** Separate the two things a blockchain conflates — **title** (who controls a thing) and
**scarcity** (global ordering that prevents double-spending a unique thing). Content-addressing solves the
first natively and self-verifyingly; it provably **cannot** solve the second alone, so the second is
*anchored by reference*, never rebuilt. Five binding rules:

1. **A Title is a content-addressed, signed claim — not a ledger entry** (`holo-own.mjs`, `Title`). A Title
   is a `holo-realization.mjs` Realization whose operand κ-refs are the **owner** (a principal's σ-axis
   κ — the same key address `holo-identity.mjs` mints, written bare as `sha256:<hex>` in the SPINE-2 frame
   and projected as `did:holo:sha256:<hex>` in the W3C/JSON-LD view), the **owned object** (`blake3:<hex>`),
   and the **prior Title** (lineage); its payload carries the rights (W3C **ODRL 2.2**) and terms. The
   Title's identity is its κ; the **head** κ of the chain is the current title. History is an append-only,
   hash-linked PROV-O chain (`prov:wasRevisionOf` → prior Title) — **one head κ proves the whole ownership
   history**. A Title is a **W3C Verifiable Credential** (VC Data Integrity): issuer = the transferring
   owner, subject = the new owner, credentialSubject = the owned κ + rights. Every link self-verifies by
   re-derivation (Law L5). *Ownership is a verifiable claim, not a consensus problem.*

2. **Transfer is a capability operation; authority only attenuates** (`transfer`). A transfer mints a new
   Title (prior = the current head) and is admitted **only if** the actor is the current owner **or** holds
   a Delegate/UCAN chain (ADR-042) from the current owner whose attenuation covers the transfer, the new
   Title is **signed** by that authority (`holo-identity` Ed25519/ECDSA), and the Constitution conscience
   gate accepts it (ADR-033). A transfer from a non-owner, or one that **escalates** beyond a delegation's
   scope, is **refused — never silently applied** (SEC-2 attenuate-only; SEC-6 verify-before-accept). A
   revoked delegation invalidates every Title minted under it from the revocation point (re-derivation
   catches it — Delegate's subtree-invalidation, ADR-042).

3. **Scarcity is anchored, never minted** (`anchor`). Global uniqueness — proving an owner did **not** also
   transfer the same unique Title elsewhere — requires global ordering, which a content address cannot
   supply. Two valid Titles sharing one prior is a **fork**, and forks are **detected natively** by chain
   re-derivation. Resolution is by policy: (a) **un-anchored** Titles (data, identity, reputation, a
   creator's evolving work, governance over *your own* holospaces — the common case) need no global order;
   a detected fork is surfaced, not silently merged. (b) **Scarce** Titles (a unique transferable asset)
   **anchor the head κ to an existing consensus layer by reference** — BTC / ETH / Solana via the chain kit
   (`prism-btc` · `holo-eth`/`holo-evm` · `holo-solana` · `wdk`) — and *anchor wins*: the head committed
   on-chain is canonical. Hologram **never operates a chain** (Law L4); it commits a κ to one that already
   exists and re-derives the commitment (Law L5).

4. **Value settles against proven title + proven work** (`settle`, ADR-048). A paid transfer is a
   payer-signed `schema:Order` that commits, by content address, to the Title chain (and, for a service,
   the Orchestrate work receipt ADR-045); the voucher releases **only if** the Title chain re-derives, the
   transfer was authorized (rule 2), and conscience-accepted (rule 2) — *pay against proven ownership, not
   claimed ownership*. The rail (NANDA x402-NP, Lightning L402, or an on-chain transfer through the
   default-deny `holo-wallet-bridge` signing seam) is consumed by reference. **Tokens are optional** — the
   primitive is the Title; this is the *computer*, not the *casino*.

5. **Community / network ownership is a multi-principal Title** (`holo-own.mjs` + ADR-042 + ADR-033). A
   collectively-owned holospace, protocol, or work is a Title whose owner is **not one key but a capability
   set** — an `m-of-n` principal expressed as a Delegate chain — and whose governance (who may transfer,
   amend rights, or admit members) is the Constitution's ODRL policy over that Title. Governance is
   exercised by capability, recorded as PROV-O, settled (if it carries value) by Settle. A community owns
   the κ; no corporation holds the database.

**Consequences.**

- **Dixon's "Own", realized on content-addressing — each pillar, mapped:**
  - *True property rights* → the Title: cryptographic (your key signs), portable (a κ that resolves on the
    shared substrate), self-verifying (re-derivation, no registry to trust).
  - *Economic ownership* → Settle (ADR-048): value releases only against proven title/work; governance and
    revenue rights ride as ODRL/VC and capabilities.
  - *Community/network ownership* → multi-principal Titles + Constitution governance (rule 5).
  - *Beyond speculation* → ownership is the primitive; chains and tokens are **optional anchors**, invoked
    only when an asset genuinely needs global scarcity. The substrate's value is verifiable participation,
    not a casino.
  - *AI agents as owners* → an agent **is** a principal (a `holo-identity` key / NANDA identity, ADR-034).
    It holds Titles, transfers them under UCAN attenuation (ADR-042), earns via Settle (ADR-048), carries
    AgentTrust reputation (ADR-039) and Orchestrate receipts (ADR-045), and is bounded by the Constitution
    (ADR-033). Agents become **economically sovereign actors on neutral infrastructure their owner controls**
    — Dixon's "your agents work *for you*, on infrastructure you own."

- **Web2 ⊕ Web3 ⊕ AI, united in one self-verifying substrate.** *Web2*: the rich apps and open APIs OS2
  already federates and resolves (the World shell, the app catalog, `holo-resolve`/`holo-federate`) — the
  experience layer. *Web3*: verifiable ownership (Title) + optional chain anchoring (the chain kit) +
  trustless payment (Settle) — the ownership layer, **without** the rents or the casino. *AI*: agents as
  first-class owners and counterparties — the autonomy layer. All three are the **same κ** — content-
  addressed, self-verifying, byte-identical to the shared substrate — so an object owned in one is owned in
  all. This is the thing a blockchain-only or a platform-only stack cannot be: one substrate where a web
  page, a model, an agent, a payment, and a deed are the same kind of self-verifying object.

- **What the witness proves** (`tools/holo-own-witness.mjs`, pure-Node, the chain rail mocked offline): a
  Title re-derives to its κ; mint → transfer → resolveOwner returns the correct current owner; a transfer
  by a non-owner is refused; a transfer under a UCAN delegation succeeds within scope and is refused when it
  **escalates** beyond it; a revoked delegation invalidates its subtree; a **double-transfer fork is
  detected**; an anchored head verifies against the (mocked) chain commitment and *anchor-wins* resolves the
  fork; a paid transfer settles only on a re-derivable Title (composing ADR-048); tamper anywhere is refused
  (Law L5). The browser/chain tier proves a real anchor through the wallet seam.

- **Negative / risks.** Un-anchored Titles offer *fork detection*, not *fork prevention* — correct for the
  common case but unsuitable for a bearer asset, which **must** anchor (rule 3); the ADR makes the choice
  explicit per Title rather than forcing global consensus on everything. Anchoring inherits the latency,
  cost, and trust assumptions of the chosen chain — by design contained to the assets that need it. Key
  loss is owner-fatal (self-sovereign = self-responsible, SEC threat model); social recovery is a
  multi-principal Title (rule 5), not a custodial backdoor.

**Considered alternatives.**
- *Become / mint a blockchain.* Rejected: violates Law L4 (parallel infrastructure) and Law L1, and is the
  one thing the holospaces discipline forbids restating. Anchoring **to** existing chains gives the same
  global-ordering guarantee with none of the parallel-infrastructure cost.
- *A custodial / server ownership registry.* Rejected: a host-keyed database is exactly the centralization
  Law L1 and ADR-001 forbid, and reintroduces the platform gatekeeper "Own" exists to remove.
- *Ownership as a pure CRDT* (extend the World scene-graph CvRDT). Rejected as the title primitive: CRDTs
  converge state but cannot, alone, distinguish a legitimate single transfer from a double-transfer of a
  bearer asset; they merge both. Fork *detection* over a signed hash-linked chain is the honest primitive,
  with anchoring for the cases that need prevention.
- *Chosen:* the self-verifying **Title** (native, default) + **optional anchor by reference** (only for
  scarce assets) — maximal self-sovereignty, minimal trust, zero parallel infrastructure.

**External authorities.** W3C [DID Core](https://www.w3.org/TR/did-core/) (owner identity) ·
[Verifiable Credentials](https://www.w3.org/TR/vc-data-model/) + [VC Data Integrity](https://www.w3.org/TR/vc-data-integrity/)
(the Title) · [UCAN](https://github.com/ucan-wg/spec) (transfer capability, via ADR-042) ·
[ODRL 2.2](https://www.w3.org/TR/odrl-model/) (rights/policy) · [PROV-O](https://www.w3.org/TR/prov-o/)
(ownership lineage) · [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/) (serialization) · UOR-ADDR
(κ = H(canonical_form); the BLAKE3 σ-axis, ADR-052, now byte-identical per `#kappa-parity`) · the BTC /
ETH / Solana consensus layers, consumed **by reference** for anchoring and settlement · Bitcoin / Lightning
(L402) and Project NANDA payments ([x402-NP](https://github.com/projnanda/nanda-payments)) for the rail ·
holospaces Laws L1/L2/L4/L5 and the SEC-2 (attenuate-only) / SEC-6 (verify-before-accept) model.
