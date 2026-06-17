#!/usr/bin/env bash
# cc-reasoning.sh — Component conformance: RDFS entailment + SHACL-core, with proofs tracing to L5 (S5).
# (Carries both catalog rows CC-reasoning and CC-shacl — the same witness exercises both rungs.)
#
# AUTHORITY (external, per holospaces vv/ discipline):
#   · W3C RDF 1.1 Semantics — the RDFS entailment rules (§9.2.1: rdfs2/3/5/7/9/11) applied as a forward-
#     chaining fixpoint (https://www.w3.org/TR/rdf11-mt/). A derived triple is entailed, not asserted.
#   · W3C SHACL (Core) — node-shape validation (sh:targetClass, sh:minCount, sh:class)
#     (https://www.w3.org/TR/shacl/). Full SHACL test suite attaches at promotion.
#   · Law L5 — the "proof" rung: every derived triple's proof chain resolves to SOURCE OBJECT κ that
#     re-derive; entailment over verified content, with provenance.
#
# This wraps the deterministic Node witness, which IS the behavioral definition of these rows.
# Upstreams to: holospaces  vv/suites/cc-reasoning.sh   (catalog rows CC-reasoning, CC-shacl; arc42 ch.10).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEM="${HOLO_SYSTEM:-$(cd "$HERE/../../.." && pwd)}"   # holospaces vv/: export HOLO_SYSTEM=<pinned HOLOGRAM>/holo-os/system
command -v node >/dev/null 2>&1 || { echo "CC-reasoning: SKIP — node not available in this environment" >&2; exit 127; }
echo "CC-reasoning — RDFS entailment + SHACL-core with L5 proofs (W3C RDF Semantics §9.2.1 · SHACL Core · Law L5)"
WITNESS="$SYSTEM/tools/holo-reason-witness.mjs"
[ -f "$WITNESS" ] || { echo "CC-reasoning: SKIP — witness not found (set HOLO_SYSTEM to a HOLOGRAM holo-os/system checkout)" >&2; exit 127; }
node "$WITNESS"
