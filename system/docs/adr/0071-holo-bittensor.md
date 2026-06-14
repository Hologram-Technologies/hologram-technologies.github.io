# ADR-0071: Holo Bittensor — the decentralized intelligence market as a content-addressed projection: every neuron is a self-verifying NANDA agent, every subnet a κ-rooted catalogue, every inference a re-derivable receipt, settled in TAO only against proven work

**Status:** Accepted — witnessed: `holo-bittensor-witness.mjs` (27/27) and `holo-bittensor-mcp-witness.mjs`
(15/15) are green, and `#holo-bittensor` + `#holo-bittensor-mcp` are required rows in
`os/etc/conformance.jsonld` (re-run live by the gate). The engine (`os/usr/lib/holo/holo-bittensor.mjs`),
the `bt:` ontology (`os/usr/share/ns/bittensor.jsonld`), the four MCP tools (`bittensor_snapshot` ·
`bittensor_agentfacts` · `bittensor_infer` · `bittensor_settle`, advertised in `/.well-known/mcp.json`), and a
human pane (`holo-bittensor.html`, in-tab Law-L5 re-derivation) ship; every projected object is dual-axis
substrate-anchored (`sealDual`: `did:holo:sha256` ⊕ `did:holo:blake3` ≡ hologram's `kappa()`). Builds on
**Holo NANDA** (ADR-034, the agent-discovery projection this generalizes),
**Holo AgentTrust** (ADR-039, reputation as a content-addressed chain), **Holo Orchestrate** (ADR-045, the
PROV-O work receipt), **Holo Settle** (ADR-048, pay against proven work), **Holo Q** (ADR-0052, inference as
a re-derivable receipt), the UOR envelope (ADR-025), the signature/attribution layer (`holo-vc`, W3C VC), the
witnessed-conformance regime (ADR-024), Holo Conform (ADR-031, specs as κ-pinned objects), the κ⇄CIDv1 law
(`os-peers`, ADR-026), and Laws L1/L2/L4/L5.

**Context.** [Bittensor](https://docs.learnbittensor.org/sdk/bt-api-ref) is the largest live **decentralized
market for machine intelligence**: a chain (Subtensor) of **subnets**, each a population of **miners** and
**validators** (neurons), each neuron a **hotkey** identity serving an **axon** endpoint, scored by **Yuma
consensus** — a stake-weighted, capital-backed agreement on which outputs are worth paying for — and settled in
**TAO**. The `bt` SDK exposes exactly the primitives an integrator needs: `Subtensor` (chain gateway),
`Metagraph` (network state), `Dendrite`/`Axon`/`Synapse` (neuron-to-neuron query), and the weight/stake/transfer
extrinsics. This is the **supply side** the OS agent stack (034·036·039·042·045·048·049) was built to consume but
never had: thousands of live, economically-secured AI agents, with no central operator.

The naive integration — embed the `bt` SDK and call miners live — **violates the laws and must not be built.**
Bittensor addresses neurons by axon IP/port (against L1, content-not-location), runs its own libp2p/websocket
fabric (against L4, everything through the substrate), and its trust is **economic** — stake and consensus —
rather than **re-derivation** (against L5). And the SDK is Python: it cannot run in the browser-native WASM peer.

But the same difference that makes a bridge wrong makes a **projection** both possible and *better than a bridge*
— exactly as it did for NANDA (ADR-034). Bittensor and the substrate answer the **same** question — *"which output
do I trust?"* — by **opposite** means: Bittensor by stake (it proves *who* computed and how much capital backs
them, but never *what* was computed is correct); the substrate by re-derivation (it proves *what the bytes are*,
but has no market and no live supply of providers). They are complements. And structurally, **a Bittensor subnet
is already a NANDA registry**: `hotkey → neuron → axon endpoint → subnet task` is precisely NANDA's
`AgentName → record → AgentFacts URL → endpoint → capability`. Three facts make the projection real:

- **A neuron IS an AgentFacts object.** The hotkey (ss58) is a `did:key`; the axon endpoint is the NANDA
  endpoint; the subnet's task is the capability/skill set. Nothing in NANDA's schema forbids extra fields, so one
  document is, on the same bytes, a valid AgentFacts record, a **self-verifying UOR object** (`id =
  did:holo:sha256(facts+proof)`), and a **W3C VC** (the neuron's on-chain hotkey signature attached as a
  `DataIntegrityProof`). *Your facts are your id.*
- **The chain is already content-addressed.** Subtensor block hashes are Merkle roots. "Subnet *N* at block *B*"
  canonicalizes to a κ-rooted `dcat:Catalog` of neuron AgentFacts whose root `did:holo` commits to the whole
  subnet's state — a NANDA Index projection of an entire subnet **that re-derives**. The metagraph snapshot is the
  bridge artifact, and Bittensor's own Merkle chain is what makes it honest.
- **Stake-weighting is an external reputation oracle.** Yuma consensus is a Sybil-resistant, capital-backed
  signal — exactly what AgentTrust (ADR-039) wants but cannot mint from nothing. Folded in as a dual-trust
  attestation, Bittensor *secures* reputation with capital the substrate does not have to print.

**Decision.** **Bittensor interoperability is a deterministic projection of the live chain into the substrate's
agent fabric — not a parallel runtime, not a registry, not a server.** Engine `holo-bittensor.mjs`
(`os/usr/lib/holo/`), ontology `ns/bittensor.jsonld`, witness `holo-bittensor-witness.mjs`, conformance row
`#holo-bittensor`. Eight binding rules:

1. **The metagraph snapshot is a self-verifying UOR object** (`snapshotSubnet`). Read subnet *N* at block *B* at the
   **ingest boundary** — Subtensor's *public, decentralized* JSON-RPC, one of many endpoints, never one we run —
   canonicalize (RFC 8785 JCS), pin the block hash, and seal to `did:holo`. "Subnet *N* @ block *B*" re-derives and
   commits to chain state; thereafter the system holds the **κ**, never a live RPC object (L2).
2. **One neuron, three identities** (`buildAgentFacts`) — mirroring ADR-034 exactly. Sign the facts → attach the
   neuron's hotkey proof → content-address the whole → stamp the id, so a vanilla NANDA resolver verifies the
   signature **today** and a UOR-native peer re-derives the address **forever**. Dual trust, one document.
3. **Content-addressed discovery, no new registry** (`project`, Law L4). The snapshot is a κ-rooted `dcat:Catalog`
   Merkle-linked under one `did:holo`, registered into the **existing** Holo NANDA Index projection. Bittensor's
   thousands of neurons become natively discoverable in the same Internet-of-Agents catalogue OS already emits,
   self-resolving content-addressed (`holo://κ`, `ipfs://<cidv1>` over the same κ — the `os-peers` law) with **no
   Bittensor server in the trust path**.
4. **Stake is reputation** (`attest`). Project each neuron's Yuma weights, stake, incentive, and dividends at block
   *B* into an AgentTrust attestation (ADR-039): dual-trust, capital-backed, Sybil-resistant, folded into
   `agent_passport`. Bittensor gives the substrate an un-gameable reputation oracle; the substrate gives Bittensor a
   portable, off-chain-verifiable passport.
5. **Inference is a re-derivable receipt behind the brain seam** (`queryNeuron` → Holo Q receipt, ADR-0052).
   Querying a miner (a text/chat/embedding subnet) is an ingest boundary: the response plus `(prompt, params, neuron
   hotkey, subnet, block)` seals to a PROV-O **inference receipt**. **Honest scope:** a stochastic LLM output is
   *not* re-derivable — L5 binds the **receipt** (the immutable, signed record of what was asked, what returned, by
   whom, at which block), not reproduction of the inference. The miner's signature over the response is verified;
   tamper → refuse. This is the same boundary Holo Q already lives with.
6. **Proven work, settled in TAO** (ADR-045/048). A Bittensor query slots into an Orchestrate work receipt (PROV-O
   DAG) as any other proven step; settlement releases a TAO voucher per neuron **only if** the receipt re-derives,
   the neuron's signature verifies, **and** the conscience gate (ADR-033) accepts. Tampered work pays nothing.
   **Honest scope:** TAO is real money on mainnet — designed here, **testnet-gated**, with no live mainnet
   settlement without explicit operator authorization.
7. **Mint nothing** (ADR-024). AgentFacts reuses NANDA's published `af:` vocabulary + schema.org; reputation reuses
   the AgentTrust model; receipts are PROV-O; the catalogue is `dcat:Catalog`; identity is W3C DID; attribution is
   W3C VC. Bittensor's own terms (subnet, neuron, hotkey, stake, incentive, dividend, emission) map onto a small
   **published** `bt:` namespace (`ns/bittensor.jsonld`) **only** where no W3C/community equivalent exists, each
   declaring `skos:closeMatch` to its nearest standard term.
8. **The integration surface is byte-pinned** (ADR-031). The Bittensor primitives depended on — the `bt-api-ref`
   surface, the Subtensor JSON-RPC method set / SCALE types, and the subnet protocol (Synapse) schema — are vendored
   byte-faithfully and κ-pinned into the Holo Conform index. *Which* Bittensor we read is content, not a moving
   target; drift is one re-hash away.

**Serverless · decentralized · open-semantic-web — made explicit (the three demands on this ADR).**

- **100% serverless.** The projection is a pure deterministic function of chain content (build-twice-equal). The
  only I/O is the ingest read against Subtensor's *public, decentralized* RPC and re-derivation — **no Hologram
  server, no agent server, no parallel store** (L4). The chain read is an ingest boundary exactly like Holo Resolve
  fetching the open web: foreign network allowed at the *edge as a source*, everything crossing in immediately
  canonicalized and κ'd, thereafter moving only through the substrate.
- **100% decentralized.** Subtensor is itself a decentralized chain; we add **no** central index. The catalogue is
  content-addressed and self-resolves from any mirror or IPFS. Discovery, reputation, receipts, and vouchers are all
  objects that re-derive — there is no privileged host anywhere in the trust path.
- **W3C open semantic web.** Every artifact is valid JSON-LD: **DID Core** (`did:holo`, `did:key`), **VC Data
  Integrity** (`eddsa-jcs-2022`), **PROV-O** (receipts), **DCAT** (catalogues), **schema.org**, and **EARL** (the
  witness row). The whole projection is queryable as linked data.

**The Python problem, answered honestly.** The `bt` SDK is Python; the peer is browser-native WASM. We **do not run
it.** The neuron query and chain read go over Subtensor's JSON-RPC/websocket directly from a light JS Substrate
client (the L4-honest path), or via **offline snapshot-and-seal** for the metagraph object (most conformant, least
live — ships first). The `bt-api-ref` defines the *surface we mirror*, not a runtime we embed.

**Consequences.**

- **Real connectivity.** `node holo-bittensor.mjs snapshot <netuid> <block>` emits the subnet `dcat:Catalog` and
  per-neuron AgentFacts under `nanda/agents/`, each signed and self-verifying; a NANDA resolver consumes them
  unchanged. The OS agent stack finally points at a live network of thousands of economically-secured agents.
- **Bittensor gains verifiability.** Every neuron interaction becomes a UOR object — AgentFacts, trust attestation,
  inference receipt, settlement voucher — re-derivable with no trusted server. This closes Bittensor's structural
  gap: it can prove *who* computed and *how much stake backs them*, but not *what* was computed; the substrate
  supplies the missing half.
- **Witnessed** (`holo-bittensor-witness.mjs`, row `#holo-bittensor`): snapshot re-derivation against the pinned
  block hash; AgentFacts schema validity + self-verification (L5) + dual-trust proof (one mutated byte breaks *both*
  the content address and the signature); catalogue re-derivation; stake→AgentTrust attestation; inference-receipt
  integrity + tamper-refusal; settlement releases *only* on a re-deriving, signature-valid, conscience-accepted
  receipt; κ⇄CIDv1 equivalence; determinism; mint-nothing.
- **Sovereignty preserved.** We project and sign; we POST to no registry and run no miner. Registration, live
  querying, and TAO settlement are operator choices, not dependencies — the artifacts resolve content-addressed
  with no Bittensor server in the trust path.
- **Costs, stated plainly.** Stochastic outputs are *receipt-verifiable, not reproducible*; TAO settlement is
  testnet-gated until explicitly authorized; live axon querying is an ingest boundary, not a persistent parallel
  network; and the deepest path (a full in-browser Substrate client) is real engineering — the snapshot-and-seal
  path is the tractable first move, exactly as Holo Q shipped the coarse κ-memo before the κ-graph north star.

**External authorities.** [Bittensor SDK (`bt-api-ref`)](https://docs.learnbittensor.org/sdk/bt-api-ref), Subtensor
JSON-RPC, Yuma consensus / subnet (Synapse) protocol, ss58 addressing; [Project NANDA AgentFacts +
Index](https://github.com/projnanda) (*Beyond DNS: Unlocking the Internet of AI Agents*, arXiv:2507.14263); W3C
[DID Core](https://www.w3.org/TR/did-core/) + [VC Data Integrity](https://www.w3.org/TR/vc-data-integrity/)
(`eddsa-jcs-2022`) + [PROV-O](https://www.w3.org/TR/prov-o/) + [DCAT](https://www.w3.org/TR/vocab-dcat-3/) +
[schema.org](https://schema.org/) + [EARL](https://www.w3.org/TR/EARL10-Schema/); IETF
[RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785); IPLD/multiformats CIDv1 (κ⇄CIDv1, `os-peers`); Laws
L1/L2/L4/L5. Mints nothing beyond a small `bt:` namespace (`https://hologram.os/ns/bittensor#`) over schema.org /
PROV-O where Bittensor terms have no W3C equivalent.
