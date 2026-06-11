# ADR-025: Everything is a self-verifying linked-data object

**Status:** Accepted — implemented (product layer). The UOR object envelope
(`holo-object.mjs`), its witness (`holo-object-witness.mjs`), host tests, and the
catalog row A12 are live. Builds on ADR-022 (W3C content addressing) and ADR-024
(the enforced W3C regime); consumes the engine unmodified (ADR-006).

**Context.** ADR-022/024 made each *holospace* a content-addressed, W3C-native
resource. The next step is to make that true of **every object** — a file, a track,
a git commit, a sub-component — and to let objects **compose**: link to one another
and nest without bound, while staying self-verifying. Two existing worlds each hold
half of what this needs and neither holds both:

- **Content addressing alone** (raw IPFS) gives a DAG of *opaque blobs* —
  self-verifying but meaningless; a machine can walk the pointers but not reason
  over them.
- **RDF / the semantic web alone** gives *meaning* (interpretable linked data) but,
  on today's web, it is unverifiable and server-bound — an IRI is a promise, not a
  proof.

UOR (content addressing) is the missing **structural** piece — self-verifying
identity + composition. W3C linked data is the missing **semantic** piece —
interpretable meaning. The thesis of this ADR is that they belong on the *same
object*, and that doing so yields what none of web2 / web3 / AI has alone: a
**self-verifying, interpretable, serverless object graph**. The hashes do not unite
anything by themselves — it is the **typed links** that let an agent reason over the
DAG instead of walking blind pointers.

**Decision.** Define one **UOR object envelope** and make every object an instance:

- **Identity is content.** An object's id is `did:holo:sha256:H(content)`, where
  `content` is its canonical form (RFC 8785 JCS) with its own `id` removed — it is
  *addressed by its self-verifying attributes* (Law L1). Verify = re-derive and
  compare (Law L5 = W3C SRI). Self-certifying; no ledger, no registry.
- **Composition is content-addressed.** An object's `links` are typed edges
  (`rel` + the target's `did:holo` + `digestSRI`/`digestMultibase`) to other UOR
  objects. Because the parent's hash commits to its links, a child's address is part
  of the parent's address — a **Merkle-DAG**, **acyclic by construction** (a cycle
  would need an object's hash to depend on itself — pre-image-impossible).
- **Verification is recursive.** `verifyDeep` resolves every link, re-derives every
  object, and checks every link digest, top-to-bottom — so a tampered byte *anywhere*
  is refused and the refusal propagates to the root. Infinite nesting, self-verifying
  at every level.
- **One object, many vocabularies.** `@type` and `@context` are arrays: a track is, on
  one content-addressed identity, *both* a `schema:MusicRecording` (web3 + AI) *and* a
  `subsonic:Song` (web2 drop-in) — zero loss. Domain internals stay ecosystem-native;
  the W3C projection is *added*, lazily, only where it faces the open web (ADR-024 A6).
- **Interpretable.** The envelope is JSON-LD; it expands to schema.org / PROV RDF via
  the W3C reference processor, minting nothing bespoke — so a human or AI agent reads
  the graph with no Hologram-specific knowledge.

Witnessed (`holo-object-witness.mjs`) by building a nested multi-vocabulary κ-DAG
(album → tracks → audio, each schema.org **and** Subsonic) and proving: every object
self-verifies, the whole DAG resolves + re-derives through ≥2 levels, a tampered byte
is refused, the addressing is deterministic + Merkle, and it expands to schema.org RDF.
Row **A12** in the W3C catalog; the strict gate enforces it.

**Consequences.** "Everything is an object, addressed by its self-verifying attributes"
becomes a witnessed property, not a slogan. It is the substrate for atomic
composability, serverless self-verified applications and protocols, and an
internet-native, machine-interpretable object graph — *the Internet as the
supercomputer, accessed via Hologram*. The split keeps it honest: the envelope is a
**product-level** prototype over the engine's existing κ-addressing (W3C
canonicalization already: JCS/C14N/SHA-256). Pushing composability *below* the
holospace — sub-κ object authoring inside the engine — is engine work and belongs
**upstream in holospaces** as a conformance-witnessed PR (ADR-006), not forked here.
The cost is one envelope module + one witness; no new medium, no bespoke vocabulary.

External authorities: **IPLD** (content-addressed linked-data DAG); W3C DID Core,
Controlled Identifiers, JSON-LD 1.1, RDF Dataset Canonicalization, Subresource
Integrity, VC Data Integrity; schema.org, PROV-O; IETF RFC 8785 (JCS); multiformats
(multihash). Witness: `holo-object-witness.mjs`; envelope: `holo-object.mjs`.
