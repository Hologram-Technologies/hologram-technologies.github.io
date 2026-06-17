# Imported validation artifacts — provenance (Semantic-Web → Agentic-Web rows)

Staged rows for upstream into holospaces `vv/PROVENANCE.md`, in its table shape. Every authority is external,
imported, and pinned; verification is by re-derivation (Law L5) and/or the authority's own conformance shape.
These cover the Semantic-Web substrate (render → linked data → SPARQL → reasoning → OWL/DID/VC) implemented in
the HOLOGRAM `holo-os/` tree and witnessed by the Node witnesses referenced from each `cc-*.sh` suite.

## Component conformance (`CC-*`) — proposed CC-51 … CC-55

| Artifact | Authority | Source | Pin | Verified by |
|---|---|---|---|---|
| IANA media types | IANA Media Types registry | https://www.iana.org/assignments/media-types | registry (stable identifiers) | CC-51: a served object's Content-Type is the type it DECLARES; dispatch is a pure view over re-derived bytes (Law L5) |
| schema.org `encodingFormat` | schema.org | https://schema.org/encodingFormat | vocabulary term | CC-51: the render contract is interpretable linked data |
| Linked Data principles | W3C / TimBL | https://www.w3.org/DesignIssues/LinkedData.html | design note (stable) | CC-52: a URI dereferences to data; each hop re-derives (Law L5) |
| CIDv1 (multiformats) | multiformats | https://github.com/multiformats/cid | spec (stable) | CC-52: κ⇄CID⇄ipfs:// bijection; the κ⇄CID transform shares the CC-1 σ-axis |
| RDF 1.1 N-Quads | W3C Recommendation (2014-02-25) | https://www.w3.org/TR/n-quads/ | dated REC | CC-53: serialize+re-parse preserves every quad (interop) |
| SPARQL 1.1 Query — Basic Graph Patterns | W3C Recommendation (2013-03-21) | https://www.w3.org/TR/sparql11-query/#BasicGraphPatterns | dated REC | CC-53: BGP SELECT join, provably equivalent to `SELECT WHERE { …bgp… }` |
| RDF/JS Data Model | W3C Community Group | http://rdf.js.org/data-model-spec/ | CG report | CC-53: term model, via the vendored engine |
| N3.js (RDF/JS impl) | rdfjs/N3.js | https://github.com/rdfjs/N3.js (npm `n3`) | **v2.0.3**, κ `did:holo:sha256:0fa509e7298c…` (`os/usr/lib/holo/vendor/n3/SEAL.json`) | re-derive the vendored `n3.min.js` to its sealed κ (Law L5) |
| RDF 1.1 Semantics — RDFS entailment | W3C Recommendation (2014-02-25) | https://www.w3.org/TR/rdf11-mt/ §9.2.1 | dated REC | CC-54: rdfs2/3/5/7/9/11 as a forward-chaining fixpoint; derived ≠ asserted |
| SHACL (Core) | W3C Recommendation (2017-07-20) | https://www.w3.org/TR/shacl/ | dated REC | CC-54: node-shape validation (targetClass, minCount, datatype, class) |
| OWL 2 Profiles — RL rules | W3C Recommendation (2012-12-11) | https://www.w3.org/TR/owl2-profiles/#OWL_2_RL | dated REC | CC-55: TransitiveProperty/SymmetricProperty/inverseOf/equivalentClass via the same proof-carrying fixpoint |
| DID Core 1.0 | W3C Recommendation (2022-07-19) | https://www.w3.org/TR/did-core/ | dated REC | CC-55: the did:holo method resolves a κ to a structurally valid DID Document |
| VC Data Model 2.0 | W3C Recommendation | https://www.w3.org/TR/vc-data-model-2.0/ | dated REC | CC-55: issued credential structure + bound trust face |
| VC Data Integrity — eddsa-jcs-2022 | W3C Recommendation | https://www.w3.org/TR/vc-di-eddsa/ | dated REC | CC-55: JCS canonicalization (= Law L2) + ed25519; tamper/wrong-key refused |

## Witness closure (the HOLOGRAM modules each suite runs)

The suites invoke Node witnesses under `holo-os/system/tools/holo-*-witness.mjs`. Their module closure
(`os/sbin/holo-{render-contract,renderable,uri,graph,rdf,reason,did,vc}.mjs`, `os/usr/lib/holo/holo-{object,
uor,ipfs}.{mjs,js}`, and the vendored `vendor/n3/n3.min.js`) must be present at a **pinned HOLOGRAM tree**.
Pin it the holospaces way: either (a) record the HOLOGRAM commit/release here and point `HOLO_SYSTEM` at that
checkout in `vv/run.sh`, or (b) vendor a snapshot of the closure into `vv/artifacts/cc51-55/` and record its
κ. The substrate is self-verifying (every object re-derives, Law L5), so a snapshot's integrity is checkable.
