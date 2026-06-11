# Contributing to Hologram OS

Thanks for helping build an internet computer. This repo is small on purpose: it carries
only *product* on top of the [holospaces](https://github.com/Hologram-Technologies/holospaces)
engine (a pinned, unmodified submodule). Read [AGENTS.md](AGENTS.md) and
[README.md](README.md) first.

## Principles

- **Conformance is the definition of done.** A change is complete only when a witness
  proves it against an *external authority* (W3C, IETF, IPLD, schema.org). Add the witness
  with the code, and keep the strict gate green:
  `node conformance/w3c-gate.mjs --strict`.
- **Mint nothing.** Reuse W3C / schema.org / Dublin Core / PROV-O / EARL terms; never a
  private vocabulary where a standard term exists (ADR-024 A6).
- **Verify by re-derivation (Law L5).** Identity is content; trust is re-hashing, not a
  server. Hold this at every level.
- **The engine is read-only.** Engine-level work goes upstream in holospaces, never as a
  fork here (ADR-006).

## Workflow

1. Branch from `main`.
2. Make the change *and* its witness. Run, from `os/`:
   - `node --test *.test.mjs` (host unit tests)
   - `node <name>-witness.mjs` (your component's witness)
   - `node ../conformance/w3c-gate.mjs --strict` (the release gate — must pass)
3. For an architectural decision, add an ADR under [`docs/adr/`](docs/adr/) (`NNNN-title.md`)
   and, if it adds a conformance obligation, a row in `w3c-conformance.jsonld`.
4. Commit with an imperative message that explains the *why*; name the catalog row if a
   conformance change. Open a PR.

## Style

Match the surrounding code: its comment density, naming, and idiom. Witnesses are pure
Node where possible (green in CI); browser-only checks say so and degrade honestly — never
a false pass.
