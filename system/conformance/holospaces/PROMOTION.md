# Promotion — staging → holospaces `vv/`

This bundle stages five Semantic-Web → Agentic-Web conformance rows for upstream into the
[holospaces](https://github.com/Hologram-Technologies/holospaces) repo (`vv/`).

**STATUS: submitted — [PR #33](https://github.com/Hologram-Technologies/holospaces/pull/33)** (branch
`cc51-55-semantic-web-substrate`), assigned **CC-51…CC-55** (the repo's max was CC-50). The PR adds the five
`vv/suites/cc5{1..5}-*.sh`, the `vv/PROVENANCE.md` subsection, and the arc42 ch.10 catalog rows. Remaining for
merge: set the HOLOGRAM pin (`HOLO_SYSTEM` / a `vv/artifacts/cc51-55/` snapshot) — marked _TBD_ in PROVENANCE.
Local reference clone: `C:\Users\pavel\Desktop\_holospaces_ref`.

## What ships

| Proposed | Suite (here) | → holospaces `vv/suites/` | Carries catalog rows |
|---|---|---|---|
| CC-51 | `suites/cc-render.sh` | `cc51-semantic-render.sh` | CC-51 |
| CC-52 | `suites/cc-linkeddata.sh` | `cc52-linked-data.sh` | CC-52 |
| CC-53 | `suites/cc-sparql.sh` | `cc53-sparql.sh` | CC-53 |
| CC-54 | `suites/cc-reasoning.sh` | `cc54-reasoning.sh` | CC-54 (+ a SHACL sub-claim) |
| CC-55 | `suites/cc-agentic.sh` | `cc55-agentic-trust.sh` | CC-55 (OWL + DID + VC) |

CC numbers **assigned CC-51…CC-55** (next free above the repo's CC-50).

## Why these land in `suites/` (not `targets/`)

holospaces is target-first: a RED behavioral spec goes to `vv/targets/`, then is promoted to `vv/suites/` once
green. These witnesses were authored test-first in HOLOGRAM and are **already green**, so they import directly
into `vv/suites/` with full provenance — the same end state promotion produces. (`vv/run.sh` auto-globs
`vv/suites/*.sh`, so dropping the files in registers them; no manual wiring.)

## Steps

1. **Pin the witness closure.** The suites run Node witnesses in the HOLOGRAM `holo-os/` tree (see
   `PROVENANCE.md` → "Witness closure"). Choose one:
   - (a) record the HOLOGRAM commit/release in `vv/PROVENANCE.md` and `export HOLO_SYSTEM=<that checkout>/holo-os/system` in `vv/run.sh`; or
   - (b) vendor a snapshot of the closure into `vv/artifacts/cc49-53/` and point `HOLO_SYSTEM` there.
   Each suite already honours `$HOLO_SYSTEM` (falls back to its in-repo relative path) and SKIPs (exit 127) if
   `node` is absent — matching the existing `cargo`-absent SKIP in `cc1-kappa-addressing.sh`.
2. **Copy the suites** to `vv/suites/` under the numbered names above.
3. **Vendor the engine artifact:** copy `os/usr/lib/holo/vendor/n3/{n3.min.js,SEAL.json,LICENSE.md}` into the
   pinned closure (or `vv/artifacts/`); its κ is recorded in `PROVENANCE.md`.
4. **Append provenance:** merge the rows from this folder's `PROVENANCE.md` into `vv/PROVENANCE.md`.
5. **Append the catalog rows:** paste `catalog-rows.adoc` into
   `docs/src/arc42/adoc/10_quality_requirements.adoc` (assign final CC numbers).
6. **Verify:** `bash vv/run.sh` (or `just vv`) — the five rows run and report green; absent node, they SKIP
   (non-gating), never RED.

## Honest scope (state it in the rows)

Witnessed against the W3C specs as authorities **plus Law L5**, via deterministic Node witnesses — not yet
against the official W3C machine test suites. Subsets: SPARQL = Basic Graph Pattern (not full DAWG); OWL = RL
profile; SHACL = Core. Those full suites (JSON-LD/RDF/SPARQL-DAWG/SHACL/OWL/DID/VC) attach as each row is
hardened post-import. The κ-substrate guarantees (provenance + re-derivation) are fully witnessed today.

## Not done here

No write/commit/PR into the holospaces repo — that is an outward action left for explicit go-ahead. On request:
stage the renamed files + provenance + catalog edits into a branch of `_holospaces_ref` and open a PR.
