# The `did:holo` DID Method

**Status:** Draft method specification (ADR-024 A9). Conformance witnessed by
`did-holo-witness.mjs`. Intended for submission to the W3C
[DID Specification Registries](https://www.w3.org/TR/did-spec-registries/) so a
stock universal resolver can dereference it.

## Abstract

`did:holo` is a **self-certifying, content-derived** DID method: a holospace's
identifier *is* the hash of its canonical form, so it is verifiable by
re-derivation (Law L5 = W3C Subresource Integrity) with **no ledger, registry, or
trusted resolver**. It conforms to [DID Core](https://www.w3.org/TR/did-core/) and
the [Controlled Identifiers](https://www.w3.org/TR/cid-1.0/) model; identity is
location-independent (Law L1, ADR-001) and the canonical form is a JSON-LD
descriptor (ADR-022 / ADR-024).

## 1. Method name

The method name is `holo`. A DID using this method MUST begin `did:holo:`.

## 2. Method-specific identifier

```
did-holo        = "did:holo:" axis ":" hexhash
axis            = "sha256" / "blake3"          ; a published canonicalization+hash (the κ axis)
hexhash         = 64*HEXDIGLOWER                ; lowercase hex of H(canonical-form)
```

- The identifier is the **content address** (κ-label) of the holospace's canonical
  JSON-LD descriptor. `sha256` is the open-web axis (Web Crypto / SRI speak it);
  `blake3` is the native fast axis. One canonical form carries both — the same
  identity, different axes (ADR-022).
- Example: `did:holo:sha256:e3e35f3fcf316e74a53ccafebb3f6da975389c97b8e05f7a34daba4bc5b4ba94`

## 3. CRUD operations

**Create.** Canonicalize the holospace descriptor (RFC 8785 JCS / RDFC-1.0),
compute `H(form)` on the chosen axis, and publish the form to any
content-addressed store or HTTPS gateway. The DID is `did:holo:<axis>:<hex>`. No
registration step exists — creation is purely local.

**Read (Resolve).** Fetch the canonical form from any peer or gateway (the DID's
`alsoKnownAs` HTTPS IRI is one such location), **re-derive** `H(form)` on the axis,
and verify it equals `<hex>`. On match, return the form as the DID document; on
mismatch, **refuse** (Law L5). Resolution is therefore trustless and
location-independent — any host serving the bytes is acceptable because the bytes
prove themselves.

**Update / Deactivate.** Not applicable. The identifier is the content hash, so a
changed document is a *different* DID. Mutable resources are modeled as a stable
controller DID whose successive states are each their own `did:holo` (the
sealed-delta CvRDT pattern), not by mutating a DID in place.

## 4. DID document

A `did:holo` document is the canonical JSON-LD descriptor: `@context` includes
`https://www.w3.org/ns/did/v1`, `id` equals the DID, and `alsoKnownAs` lists the
equivalent HTTPS IRI and `holo://<κ>/` native alias. Because the method is
content-integrity, not key-authentication, a document MAY omit
`verificationMethod`; authentication of *assertions about* a holospace is carried
separately by Verifiable Credentials (ADR-024 A7), not by the address.

## 5. Security and privacy considerations

- **Integrity is intrinsic**: tampering changes the hash, so resolution refuses it
  (no signature needed for integrity).
- **No phone-home**: resolution can run fully offline against a local store; there
  is no registry to leak lookups to.
- **No authority binding**: a `did:holo` says *what* the bytes are, never *who*
  authored them — attribution requires a VC over the κ. This is by design (the
  address replaces the integrity half of the signature layer, not the authenticity
  half).
- **Axis agility**: a new hash (post-quantum, or BLAKE3 once SRI admits it) is
  added as a new `axis` without changing the model.

External authorities: W3C DID Core, Controlled Identifiers, Subresource Integrity,
JSON-LD 1.1, RDF Dataset Canonicalization (RDFC-1.0); IETF RFC 8785 (JCS);
multiformats (multihash). Witness: `did-holo-witness.mjs`.
