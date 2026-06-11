# ADR-031: Holo Conform — every spec is a self-verifying, byte-pinned UOR object under one κ-rooted index

**Status:** Accepted — witnessed: `holo-conform-witness.mjs` is green and `uor:holo-conform` is a
required, product-gated row in `w3c-conformance.jsonld`. The proof artifact is **IETF RFC 8785**
(JSON Canonicalization Scheme), pinned byte-for-byte; the `pin-all` verb extends byte-level
conformance to every inventory spec with a free single-document authority (62 to date), and `pin-w3c`
byte-pins the canonical **W3C web-standards corpus** (380 of 383 published standards, gzip-vendored)
as a sub-catalog under the same κ-rooted index — 442 standards held by content in all. Governs spec
governance across the OS — the conformance regime of ADR-024, built on the UOR envelope (ADR-025) and
the one κ primitive (Law L2, `holo-uor.mjs`).

**Context.** Hologram OS already declares, witnesses and enforces standards: `specs.json` is a
~160-row DCAT inventory (W3C, IETF/RFC, ISO…), `w3c-conformance.jsonld` is the release-gate catalog,
`w3c-gate.mjs` is the enforcement verb, and a component is "done" only when its row is witnessed
against an external authority (ADR-024). Yet one thing in this OS was still referenced by *location*,
not by *content*: a spec. Every app, theme, layout and even a public-domain book is a self-verifying
`did:holo` κ-object (ADR-025); a spec was a row pointing at an `https://…` URL — trusting the
location, not re-deriving the bytes. Three facts make that the load-bearing gap:

- **A URL is not an authority you can verify.** "Conforms to RFC 8785" pointing at a web address
  trusts whoever serves that address. The normative text can change, vanish, or be tampered, and
  nothing re-derives it — the exact location-trust the substrate exists to abolish (Law L1, Law L5).
- **The OS canonicalizes with RFC 8785 but never pinned it.** `holo-uor.mjs` — the one
  content-addressing primitive every object flows through — *is* RFC 8785 JCS. The substrate's own
  root of trust was cited by link, not held by content: the canonicalization spec that *defines*
  content-addressing was the one thing not content-addressed.
- **Importing a new standard meant hand-editing a catalog.** There was no verb to ingest an RFC,
  pin its bytes, and bind it to the part of the OS it governs — discovery and adoption were manual
  and unverifiable.

**Decision.** **A spec is an object, not a link.** Every standard Hologram OS enforces is sealed as a
self-verifying UOR object whose metadata is a `did:holo` (schema.org / DCAT / Dublin Core), whose
enforcing OS part is a PROV-O influence, and whose *real normative bytes* are pinned by their κ as a
Merkle leaf (Law L5). All spec objects hang under one `dcat:Catalog` **conform index** whose root
`did:holo` commits to every spec — so the OS's whole conformance landscape is one re-derivable
content address. Four binding rules:

1. **Anchor in the substrate, don't reinvent it** (Law L4). Holo Conform is built *from* `specs.json`
   (the editable inventory) and seals it into a content-addressed projection,
   `conform/conform-index.uor.json` — the way `specs.status.json` is the derived status. No parallel
   registry, no second source of truth.
2. **Pin the bytes, re-derive on use** (Law L5). A byte-pinned spec carries a content leaf whose κ ==
   sha-256 of the vendored normative text; `verifyDeep` re-derives the whole index top-to-bottom and
   a single tampered byte is refused — for *every* pin, not just the proof artifact. The `pin-all`
   verb resolves each spec to its canonical single document (IETF RFC → the `.txt`; W3C `/TR/`,
   WHATWG, `*.github.io`, w3id, IPFS, freedesktop, Unicode → the spec page), vendors the real bytes
   in-tree so the witness re-hashes them offline, and writes a `coverage.json` that records every
   skip with its reason (ISO is paywalled, a GitHub URL is a repo landing, a product site has no
   canonical document) — coverage is auditable, never silently partial. The proof artifact is RFC
   8785 itself — the canonicalization spec the substrate is built on, content-addressed by its own
   canonical form (the role *On Liberty* plays for the UOR DAG). For breadth, `pin-w3c` byte-pins the
   **entire canonical W3C web-standards corpus** — W3C's own published list (w3c/browser-specs),
   gzip-vendored to keep the tree small — as its own `dcat:Catalog` sealed into a sub-catalog the
   conform root commits to (Merkle); re-deriving one κ re-derives every W3C standard the OS holds,
   byte-for-byte.
3. **Import is propose-then-approve, deterministic and offline** (Law L2). The
   `import` / `discover` / `monitor` verbs are pure and offline-green: `discover` proposes specs an
   authority publishes but the OS hasn't indexed; a human approves the import; `monitor` detects
   upstream drift by re-hash (identity is content, so a changed byte is a changed κ). Live network
   fetch is opt-in (`--fetch`) and degrades honestly — never a false pass.
4. **Every spec-governance step is witnessed** (ADR-024). `holo-conform-witness.mjs` proves the index
   re-derives, the build is deterministic, RFC 8785's provenance is byte-exact, a tamper is refused,
   the committed index equals a fresh re-derivation (a hand-edit fails the gate), and the catalog
   mints nothing. The `uor:holo-conform` row is required and product-gated; the decision is not done
   until it is green.

**Consequences.** The last location-trust in the OS is gone: a spec is now a verifiable object a peer
re-derives, and the conformance landscape is one shareable `holo://κ`. New standards (RFCs, W3C TRs)
can be discovered, pinned and bound to specific parts of the OS without trusting a server, and
upstream drift is detectable by *content*, not by changelog. The standing cost is one pin per
byte-anchored spec plus one witness — the same construction-guarantee discipline ADR-024 already
pays; the bulk of inventory specs with a free canonical document are byte-pinned (62), the full W3C
web-standards corpus is held by content (380 of 383, gzip-vendored), the rest are metadata-anchored
with an audited skip reason, and `import` / `pin-all` / `pin-w3c --fetch` byte-pin more on
demand. `monitor --fetch` re-pulls a pinned document and re-hashes it, so upstream drift surfaces as
a changed κ. Strict adherence to the engine's declared standards (holospaces, ADR-006)
is preserved: Holo Conform builds only on the canonical-downstream κ primitive, never modifies the
read-only submodule, and treats engine rows as engine-witnessed, not product-gated — exactly as
`w3c-gate.mjs` already does. We explicitly **reject** a second spec registry and any live-network
gating step as substrate-violating.

External authorities: **IETF RFC 8785** (JSON Canonicalization Scheme — the proof artifact);
**rfc-editor.org** (the RFC series); **W3C** DCAT 3, schema.org, DCMI Terms, PROV-O, Subresource
Integrity; **IPLD** (content-addressed Merkle-DAG). Builds on ADR-024 (witnessed conformance),
ADR-025 (the UOR envelope), and Law L2 (the one κ primitive). Witness: `os/holo-conform-witness.mjs`;
module + verbs (index/verify/import/discover/monitor/pin-all/pin-w3c): `os/holo-conform.mjs`; index:
`os/conform/conform-index.uor.json`; pin ledger: `os/conform/pins.json`; W3C corpus catalog:
`os/conform/w3c-standards.json`; coverage reports: `os/conform/coverage.json` +
`os/conform/w3c-coverage.json`; vendored normative bytes (gzip): `os/conform/sources/`; catalog row:
`uor:holo-conform` in `conformance/w3c-conformance.jsonld`.
