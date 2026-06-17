# holospaces conformance (staging)

New `CC-*` rows for the Semantic-Web substrate, authored in the holospaces V&V shape and **staged here for
upstream** to the [holospaces](https://github.com/Hologram-Technologies/holospaces) repo's `vv/`.

holospaces discipline (`vv/README.md`): a component is complete only when its `CC-*` row is **witnessed
against its external authority**; work begins as an **expected-RED target** in `vv/targets/`, is built to
green, then **promoted** to `vv/suites/` with its catalog row (arc42 ch.10) flipped live. A green suite left
in `targets/` is a placement defect. Each row imports its authority verbatim and pinned — never hand-authored.

This stack is implemented in JavaScript (`holo-os/`), so each suite is a `.sh` that runs a Node witness
(`holo-os/system/tools/holo-*-witness.mjs`) — the witness is the behavioral definition. The same witness runs
fast in the HOLOGRAM dev loop; the `.sh` is what `vv/run.sh` invokes once upstreamed.

## Rows

| Row | Status | Suite | External authority |
|---|---|---|---|
| `CC-render` | live (green) | `suites/cc-render.sh` | IANA media types; `schema:encodingFormat`; Law L5 (dispatch is a view over re-derived bytes) |
| `CC-linkeddata` | live (green) | `suites/cc-linkeddata.sh` | W3C Linked Data principles; multiformats CIDv1 (κ⇄CID bijection); Law L5 (every hop re-derives). Carries the S2 latency property (warm traversal is network-free) |
| `CC-sparql` | live (green) | `suites/cc-sparql.sh` | W3C RDF 1.1 N-Quads; SPARQL 1.1 Basic Graph Pattern; RDF/JS Data Model (vendored κ-sealed N3.js); Law L5 (provenance + sealed engine). Full DAWG suite attaches at promotion |
| `CC-reasoning`, `CC-shacl` | live (green) | `suites/cc-reasoning.sh` | W3C RDF 1.1 Semantics (RDFS entailment §9.2.1); W3C SHACL Core; Law L5 (proof chain traces to source κ). Full SHACL/entailment test suites attach at promotion |
| `CC-owl`, `CC-did`, `CC-vc` | live (green) | `suites/cc-agentic.sh` | W3C OWL 2 RL profile; W3C DID Core (did:holo method); W3C VC Data Model 2.0 + VC-DI eddsa-jcs-2022 (ed25519 + JCS = Law L2); Law L5 (proofs + doubly-protected bound credentials). Full OWL/DID/VC suites attach at promotion |

Vendored, κ-sealed engines: `os/usr/lib/holo/vendor/n3/` (N3.js — RDF term model, store, N-Quads, reasoner; `SEAL.json`).

All six staged rows are live/green — the W3C Semantic-Web → Agentic-Web stack (render · linked data · SPARQL ·
reasoning · OWL/DID/VC) realized on the κ-substrate, each witnessed against its external authority + Law L5.
The official W3C test suites (JSON-LD/RDF/SPARQL-DAWG/SHACL/OWL/DID/VC) attach as each row is promoted upstream.

## Upstream

Copy `suites/cc-render.sh` → holospaces `vv/suites/`, add the `CC-render` row to the arc42 ch.10 conformance
catalog, and record any imported authority artifact in `vv/PROVENANCE.md`. Adjust `SYSTEM=` path resolution
in the suite to the holospaces layout if the Node witnesses are vendored rather than referenced.
