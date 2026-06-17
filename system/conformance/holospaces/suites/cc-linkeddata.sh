#!/usr/bin/env bash
# cc-linkeddata.sh — Component conformance: URI⇄κ binding + L5 link-dereference traversal (S3).
#
# AUTHORITY (external, per holospaces vv/ discipline):
#   · W3C Linked Data principles — a URI names a thing and DEREFERENCES to useful data
#     (https://www.w3.org/DesignIssues/LinkedData.html); a κ is expressible as a W3C URI (a did:* DID).
#   · multiformats CIDv1 — a sha2-256 κ IS a CIDv1 sha2-256, so κ⇄CID⇄ipfs://⇄/ipfs/ is a bijection
#     (https://github.com/multiformats/cid). The κ⇄CID transform is checked against holo-ipfs (CC-1 axis).
#   · Law L5 — every dereferenced hop re-derives or is refused; a tampered target cannot propagate.
# The full W3C JSON-LD 1.1 / RDF 1.1 / SPARQL test suites attach at the NEXT slice (CC-sparql), once the
# graph's triples are materialized; this row witnesses the navigable, verifiable LINK layer beneath them.
# Also carries the S2 latency property: a warm re-traversal is network-free (zero source fetches).
#
# This wraps the deterministic Node witness, which IS the behavioral definition of this row.
# Upstreams to: holospaces  vv/suites/cc-linkeddata.sh   (catalog row CC-linkeddata, arc42 ch.10).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEM="$(cd "$HERE/../../.." && pwd)"
echo "CC-linkeddata — URI⇄κ binding + L5 link-dereference traversal (W3C Linked Data · multiformats CID · Law L5)"
node "$SYSTEM/tools/holo-linkeddata-witness.mjs"
