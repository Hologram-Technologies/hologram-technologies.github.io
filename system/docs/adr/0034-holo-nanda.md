# ADR-034: Holo NANDA — agent discovery interoperability as a content-addressed projection

**Status:** Accepted — witnessed: `nanda-witness.mjs` is green and `w3c:A48-nanda-interop` is a
product row in `w3c-conformance.jsonld`; the three spec rows (`agentfacts`, `nanda-index`,
`nanda-interop`) are in `specs.json`, and the upstream **AgentFacts JSON Schema** is vendored
byte-faithfully and κ-pinned into the Holo Conform index (ADR-031). Builds on the UOR envelope
(ADR-025), the one κ primitive (Law L2, `holo-uor.mjs`), the signature/attribution layer
(`holo-vc.mjs`, W3C row A7), the witnessed-conformance regime (ADR-024), and the κ↔CIDv1 law
(`os-peers`, ADR-026).

**Context.** [Project NANDA](https://github.com/projnanda/projnanda) (Networked AI Agents in
Decentralized Architecture; MIT) is building the discovery layer for the Internet of AI Agents: a
lean **NANDA Index** (the phone book — `AgentName → record → AgentFacts URL → endpoint`) and an
**AgentFacts** document (verifiable agent metadata: identity, provider, endpoints, capabilities,
skills, certification). Hologram OS already exposes every holospace to agents over MCP, with
`did:holo` identity and W3C linked data — but it was **invisible** to NANDA: no AgentFacts, no Index
record, no `@`-handle. The two projects solve adjacent halves of the same problem and should
interoperate.

They differ on one axis, and that difference is the whole design. NANDA is **DNS-shaped**: records
are mutable rows with a TTL and a *signature*, trusted because a key signed them and they live at a
URL. This substrate is the inverse — **identity is content** (Law L5): an object's id is
`did:holo:sha256:H(canonical-form)`, trusted because it *re-derives*, with no key and no server. We
will not abandon that invariant to become a native NANDA registry. But we do not have to. Three
facts make a projection both possible and better than a bridge:

- **An AgentFacts document can BE a self-verifying object.** Nothing in NANDA's schema forbids extra
  fields. So one document can be, on the same bytes, a valid AgentFacts record *and* a UOR object
  whose `id` is the content address of its own facts. "Your facts are your id."
- **The two trust models compose; they do not conflict.** Sign the facts with a `did:key`
  (`eddsa-jcs-2022`), attach the proof, then content-address the whole thing — the hash commits to
  the signature too. A vanilla NANDA resolver verifies the signature **today**; a UOR-native one
  re-derives the content address. Dual trust, one document.
- **A κ already speaks IPFS.** A sha-256 κ *is* a CIDv1 (the witnessed `os-peers` law), so NANDA's
  `PrimaryFactsURL`/`PrivateFactsURL` are just `holo://κ` and `ipfs://<cid>` over the same κ — the
  facts self-resolve from any neutral host, no agent server required.

**Decision.** **NANDA interoperability is a deterministic projection of what already exists, not a
new registry.** Five binding rules:

1. **One document, three identities** (`holo-nanda.mjs`, `buildAgentFacts`). Every holospace projects
   to an AgentFacts doc that is simultaneously (a) a valid NANDA AgentFacts record — all nine
   required fields, right shapes; (b) a **self-verifying UOR object** — `id = did:holo:sha256:H({facts
   + proof})`, re-derivable (Law L5); (c) a **W3C Verifiable Credential** — a `DataIntegrityProof`
   (`eddsa-jcs-2022`) by the issuer `did:key`. Order: sign the facts → attach the proof → address the
   whole → stamp the id, so `verify()` and `verifyProof()` both hold on the final bytes.
2. **Content-addressed discovery** (`buildRecord`, `project`). The NANDA Index records point at
   content addresses (`primary_facts_url = holo://κ`, `private_facts_url = ipfs://<cidv1>` over the
   same κ), and every AgentFacts is Merkle-linked under one κ-rooted `dcat:Catalog` index whose root
   `did:holo` commits to the whole Internet-of-Agents catalogue (`verifyDeep`).
3. **Dual trust, never less.** A record carries an `eddsa-jcs-2022` signature *and* a content-address
   pointer. Today the signature does the work; the day NANDA adopts the substrate, the signature
   becomes attribution and the hash becomes the trust — no migration, the same bytes.
4. **Built FROM what exists, no parallel store** (Law L4). The per-app `did:holo` + metadata come from
   `apps/index.jsonld`; skills come from each app's `holospace.json` `tools` and the OS endpoint's
   `.well-known/mcp.json`. The projection is a pure, deterministic function of content
   (build-twice-equal).
5. **Mint nothing** (ADR-024 A6). The doc is valid JSON-LD whose `@context` maps NANDA fields onto
   schema.org where a term exists (`label`→`schema:name`, …) and uses NANDA's **own published**
   `af:` vocabulary (`agentfacts.org/schema/v1#`) for the rest — never a Hologram-minted term. The
   catalogue is `dcat:Catalog`; identity is W3C DID; attribution is W3C VC.

The upstream `agentfacts_schema.json` is vendored byte-faithfully and κ-pinned (the proof artifact —
we validate against *the* NANDA schema, byte-for-byte; drift is one re-hash away, ADR-031).

**Consequences.**

- **Real connectivity today.** `node holo-nanda.mjs build` emits `.well-known/agent-facts.json` (the
  OS MCP agent), `nanda/index.jsonld` (the κ-rooted index + lean records), and per-app AgentFacts
  under `nanda/agents/`. A NANDA resolver can consume them unchanged: 28 agents (1 OS endpoint + 27
  holospaces), each signed, each discoverable.
- **Native-ready.** When NANDA adopts content addressing, nothing here changes shape — the facts are
  already self-verifying objects, the index records already point at κ. The advantage NANDA gains by
  going native (verification with no trusted server) is demonstrated, not asserted.
- **Witnessed.** `nanda-witness.mjs` proves, against the byte-pinned schema and the substrate's laws:
  schema validity for all 28, self-verification (Law L5), proof verification (dual trust), index
  re-derivation, **dual** tamper-refusal (one mutated byte breaks *both* the content address and the
  signature), κ⇆CIDv1 equivalence, determinism, and mint-nothing.
- **Sovereignty preserved.** We emit and sign the projection; we do not POST to a public registry. The
  records are ready to register, but registration is an operator choice, not a dependency — the facts
  resolve content-addressed with no NANDA server in the trust path.
- **Scope.** This is discovery interop (AgentFacts + Index). A2A is out of scope — the OS is
  MCP-complete and MCP is already a first-class NANDA protocol bridge.

**External authorities.** Project NANDA AgentFacts schema
([projnanda/agentfacts-format](https://github.com/projnanda/agentfacts-format)) and Index
(*Beyond DNS: Unlocking the Internet of AI Agents*, arXiv:2507.14263); W3C
[Decentralized Identifiers](https://www.w3.org/TR/did-core/) +
[VC Data Integrity](https://www.w3.org/TR/vc-data-integrity/) (`eddsa-jcs-2022`) +
[schema.org](https://schema.org/) + [DCAT](https://www.w3.org/TR/vocab-dcat-3/); IETF
[RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785); IPLD/multiformats CIDv1; Law L5
(verification by re-derivation).
