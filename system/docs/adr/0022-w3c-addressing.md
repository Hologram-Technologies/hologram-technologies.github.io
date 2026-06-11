# ADR-022: Hologram-native addressing is W3C content addressing

**Status:** Accepted. (Extends the κ-label model of Chapter 8 / UOR-ADDR to the
open web; realizes the addressing surface witnessed by the W3C conformance rows.)

**Context.** A holospace's identity is its content address — a κ-label
`<axis>:<hex>` = `H(canonical_form)` (Chapter 8), where an *axis* is a published
canonicalization plus a hash (UOR-ADDR already uses W3C XML-C14N, RFC 8785 JCS,
DER, hashing SHA-256). The native engine added a fast `holo://<κ>` scheme on a
BLAKE3 axis. But `holo://` resolves only inside our runtime, BLAKE3 is outside
the open web's verify-by-hash set, and the trust signal was a bespoke
`X-Holo-Verified` header — so an address could not be **dereferenced or verified
by a stock browser, crawler, or RDF tool**. The architecture's own discipline is
to adopt a *published standard* and witness against it (VirtIO, 9P2000.L, LSP,
DAP, RFC 8628, OCI, Dev Container). Addressing must do the same against the
**W3C open-web + semantic-web stack**, or holospaces is not compatible with the
existing and future open web.

Three facts force the design:

- **Law L1 (identity is content, not location; ADR-001).** The canonical
  identifier must be location-independent — so a bare HTTPS URL cannot be the
  *identity*; a **W3C Decentralized Identifier (DID)** can.
- **Law L5 (verify by re-derivation) at the untrusted Pages gateway.** On the
  open web this invariant **is** Subresource Integrity — recompute the hash,
  refuse a mismatch.
- **Holospaces are "IRI-tagged canonical bytes" (Chapter 5).** That is
  **JSON-LD**, canonicalized by W3C RDF Dataset Canonicalization (RDFC-1.0) /
  RFC 8785 JCS — the semantic-web canonical form.

The κ-label is already **multi-axis**, which dissolves the BLAKE3-vs-SHA-256
split: one canonical form carries *both* labels — SHA-256 for the open web
(SRI / Web Crypto speak it), BLAKE3 for the native fast path.

**Decision.** A holospace's address is its content hash, expressed entirely in
W3C/IETF primitives — no bespoke parts:

- **Canonical form** — a **JSON-LD** descriptor (the holospace's `@context` /
  `id` / `alsoKnownAs` / `relatedResource`), canonicalized JCS (RFC 8785;
  RDFC-1.0 for full RDF).
- **κ (axis)** — `sha256:<hex>` over the canonical manifest. SHA-256 is the
  open-web axis; it *is* a W3C `digestSRI` (`sha256-<b64>`) and `digestMultibase`.
  **BLAKE3 is retained as a second native axis**, carried as `digestMultibase`
  (multihash `0x1e`).
- **Identity** — **`did:holo:sha256:<hex>`**: a self-certifying, content-derived
  DID. Resolution = fetch the canonical form from any peer/gateway, re-derive its
  SHA-256, check it equals the id (Law L5). No ledger, no registry, no host in
  the identity (Law L1, ADR-001).
- **Reach** — the DID `alsoKnownAs` a dereferenceable **HTTPS IRI** (served from
  the Pages gateway) that content-negotiates to the JSON-LD and is verifiable by
  any browser via **SRI**; `holo://<blake3-κ>` remains the native alias. One
  identity, three equivalent names.

`build-holo-site.mjs` emits all of the above per holospace (`<site>.did`,
`<site>.jsonld`, `<site>.sri.json`); `holo://` stays the native runtime scheme.
Witnessed (`addressing-w3c-witness.mjs`) against the W3C/IETF authorities: DID
Core syntax + self-certification, JSON-LD shape, **SRI verification matches a
browser's and a tampered byte is refused**, multibase/multihash encoding, and
the sha256⇄blake3 binding. The native `holo://<κ>` resolution + tamper-refusal is
witnessed separately (`browser-holosite-witness.mjs`).

**Consequences.** Every holospace address is now interoperable and verifiable on
the **existing** open web (SHA-256 + SRI work in every browser today) and stays
**hologram-native** (BLAKE3 `holo://`), from one canonical form — Laws L1/L5 hold
on both axes. It is **future-proof**: new hashes (post-quantum, or BLAKE3 once
SRI admits it) are added as axes without changing the model. It plugs into the
W3C decentralized-identity roadmap (DID Core, Controlled Identifiers, VC Data
Integrity) and the semantic web (JSON-LD, RDFC-1.0) rather than a private scheme.
The cost is carrying a second (SHA-256) digest beside BLAKE3 and a JSON-LD
descriptor per holospace — both derived, both witnessed, neither a new medium.
External authorities: W3C DID Core, Controlled Identifiers, VC Data Integrity
(`digestSRI`/`digestMultibase`), JSON-LD 1.1, RDF Dataset Canonicalization
(RDFC-1.0), Subresource Integrity; IETF RFC 3987 (IRI), RFC 8785 (JCS);
multiformats (multibase/multihash).
