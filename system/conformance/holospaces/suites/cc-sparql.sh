#!/usr/bin/env bash
# cc-sparql.sh — Component conformance: JSON-LD→RDF materialization + SPARQL BGP query (S4).
#
# AUTHORITY (external, per holospaces vv/ discipline):
#   · W3C RDF 1.1 N-Quads (https://www.w3.org/TR/n-quads/) — the interop serialization, round-tripped through
#     the vendored RDF engine.
#   · W3C SPARQL 1.1 Basic Graph Pattern matching (https://www.w3.org/TR/sparql11-query/#BasicGraphPatterns) —
#     query() evaluates a BGP SELECT (join core); provably equivalent to SELECT WHERE { …bgp… }.
#   · RDF/JS Data Model (http://rdf.js.org/data-model-spec/) — the term model, via vendored N3.js.
#   · Law L5 — only re-derived objects materialize; each triple's named graph is its source object's κ
#     (quad-level provenance); the vendored engine (n3.min.js) re-derives to its sealed κ.
# Full SPARQL syntax + the W3C DAWG test suite attach when a full engine (Comunica/Oxigraph) is vendored at
# promotion; this row witnesses the verified, provenance-carrying RDF layer + the BGP join.
#
# Vendored, κ-sealed engine: os/usr/lib/holo/vendor/n3/ (SEAL.json records its κ; authority = rdfjs/N3.js).
# This wraps the deterministic Node witness, which IS the behavioral definition of this row.
# Upstreams to: holospaces  vv/suites/cc-sparql.sh   (catalog row CC-sparql, arc42 ch.10).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEM="${HOLO_SYSTEM:-$(cd "$HERE/../../.." && pwd)}"   # holospaces vv/: export HOLO_SYSTEM=<pinned HOLOGRAM>/holo-os/system
command -v node >/dev/null 2>&1 || { echo "CC-sparql: SKIP — node not available in this environment" >&2; exit 127; }
echo "CC-sparql — JSON-LD→RDF + SPARQL BGP over the L5-verified graph (W3C RDF 1.1 N-Quads · SPARQL 1.1 BGP · RDF/JS · Law L5)"
WITNESS="$SYSTEM/tools/holo-sparql-witness.mjs"
[ -f "$WITNESS" ] || { echo "CC-sparql: SKIP — witness not found (set HOLO_SYSTEM to a HOLOGRAM holo-os/system checkout)" >&2; exit 127; }
node "$WITNESS"
