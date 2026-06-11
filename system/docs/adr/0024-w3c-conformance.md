# ADR-024: W3C conformance is a declared, witnessed, enforced product gate

> **Update (2026-06-10, lean OS2 image):** the enforcing gate is now **`tools/gate.mjs`**
> over **`os/etc/conformance.jsonld`** (`npm run gate`). The original ~95-row
> `w3c-conformance.jsonld` + `w3c-gate.mjs` were **retired** in OS2: their witnesses live in
> the full hologram-os product's `os/`, not in this lean image, so the catalog pointed at
> witnesses OS2 does not carry. The principle below is unchanged — every required row is
> witnessed against an external authority and the gate fails closed; only the catalog/verb
> file paths moved. References to `w3c-conformance.jsonld` in this and other ADRs are historical.

**Status:** Accepted — implemented. The catalog (`w3c-conformance.jsonld`), the
strict gate (`w3c-gate.mjs`, wired into the Pages build), and the witnessed rows
A1–A11 are live; the descriptor mints no bespoke vocabulary, `specs.json` projects
to DCAT/schema.org, the gate emits an EARL report, and `did:holo` has a method spec
(`DID-METHOD-HOLO.md`). Remaining targets: A7 (VC), C1 (a real WCAG fix, tracked),
E2/F1/F2/B4 (planned), and registering `did:holo` upstream. Extends ADR-022's W3C
addressing to an OS-wide enforced regime; consumes the engine unmodified (ADR-006).

**Context.** Hologram OS already expresses identity and linked data in W3C
primitives (ADR-022) and carries individual W3C witnesses —
`addressing-w3c-witness.mjs` (DID Core, SRI, multibase, JSON-LD), the engine's
`vv/` suite `cc63-manifest-jsonld` (validated by the W3C **reference** JSON-LD
processor), `axe-witness.mjs` (WCAG / WAI-ARIA), `browser-wpt-witness.mjs` (the
Web Platform Tests). But three gaps keep this short of *enforced strict
conformance* across the OS and all its components:

- **There is no single declaration of what "W3C-conformant" means here.** The
  categories live implicitly across 53 product witnesses. Nothing maps, diffably,
  a W3C spec → its external authority → the witness that proves it → required-or-not.
- **A SKIP is silently a pass.** Witnesses honestly SKIP when a prerequisite is
  absent (e.g. `HOLO_B3` unset ⇒ the addressing witness does not run). Nothing
  forbids shipping a release in which a *required* W3C row never actually ran.
  Strict conformance requires SKIP ≠ pass for the required set.
- **New holospaces are not conformant by construction.** Accessibility (WCAG),
  Content Security Policy, and semantic-vocabulary interop are per-app properties;
  nothing gates an app's admission to the OS on them.

The engine's own discipline already names the fix: *adopt a published standard,
witness against its external authority, refuse on mismatch (Law L5).* W3C specs
**are** external authorities — so W3C conformance is not a second regime bolted
on, it is the engine's regime pointed at W3C. Enforcing W3C conformance and
staying holospaces-conformant are therefore the **same act**, not a trade-off.
The product carries this itself; the engine submodule stays unmodified (ADR-006).

**Scope on the semantic-web stack.** On the Semantic Web "layer cake", Hologram OS
changes exactly two things and leaves everything else *literally* unchanged. (1)
The base **URI** slot is *filled* by a self-certifying, content-derived **IRI** —
a `did:holo` address — not *replaced*: RDF is defined over IRIs, so the identifier
*concept* must remain; only the provenance of its bytes changes (derived from
content via UOR, not assigned by a host). (2) The **Digital Signature** vertical
*splits*: its **integrity** role is absorbed by the address (re-derive the hash,
refuse a mismatch — Law L5 *is* SRI), and only its **authenticity** role survives,
as a Verifiable Credential binding a DID to a κ *across a trust boundary*. Unicode,
XML / JSON-LD, RDF / RDFS, the ontology, logic, proof, and the **Trust** layer are
untouched. The single novelty is **UOR vs URI** — the bytes of one identifier, and
half of one box. Claiming more (that content addressing removes signatures outright)
is false: a hash proves *what* the bytes are, never *who* asserted them.

**Decision.** W3C conformance becomes a product-level — declared, witnessed,
enforced — gate, in three parts. No new framework: only the catalog idea (from
the engine's `vv/`) and the existing `*-witness.result.json` machinery.

- **A catalog, dogfooded** — `web/w3c-conformance.jsonld`, itself valid JSON-LD
  (it conforms to the standard it governs). One row per category:
  `{ category, spec, specVersion, authority (URL), layer, witness, required,
  status }`. It is the single source of truth for "the W3C categories Hologram OS
  conforms to" and the input the gate reads. Categories span addressing /
  linked-data (A1–A7), the web-platform runtime (B1–B4), accessibility (C1),
  media + realtime (D1–D2), crypto + security (E1–E2), and federation + interop
  (F1–F2). See that file for the rows and per-category authority URLs.
- **A strict gate** — `web/w3c-gate.mjs` (to be built on approval) joins every
  `*-witness.result.json` to the catalog and **exits non-zero if any
  `required:true` row is not `witnessed:true`**, counting SKIP as failure in a
  release build. Wired into the Pages deploy / `just` so a non-conformant build
  **cannot ship**. This single exit code is the whole "enforce" verb (~60 lines).
- **Conformance by construction, at the Hub** — `build-holo-site.mjs` already
  emits a JSON-LD descriptor per holospace; it is reworked to **mint no bespoke
  vocabulary**: a holospace becomes a `schema:SoftwareApplication`, its files
  `schema:MediaObject` + `dcterms:*`, its build edges **PROV-O**
  (`prov:wasGeneratedBy` / `prov:wasDerivedFrom`) — retiring the private
  `type:"Holospace"` and `…/ns/v1` namespace. The App Hub (and this catalog)
  become a `dcat:Catalog`; every witness emits an `earl:Assertion`. A green
  WCAG (axe) + CSP row becomes a **precondition for App Hub listing** — Law L5
  "refuse on mismatch" applied to admission, covering *all components* without
  per-app work.

**Ontology alignment (mint nothing).** The Hologram OS conceptual model maps onto
existing W3C / community vocabulary term-for-term; the only thing new is the
*address* itself.

| Hologram OS concept | W3C / standard term | Vocabulary |
|---|---|---|
| Identifier of any resource | **IRI** (the cake's "URI"), bytes content-derived | RFC 3987 |
| Holospace identity | **DID** `did:holo:sha256:…` | DID Core, Controlled Identifiers |
| κ digest | `digestMultibase` / `digestSRI` (multihash) | Multiformats, SRI, VC Data Integrity |
| Holospace (the app) | `schema:SoftwareApplication` / `WebApplication` | schema.org |
| File / asset | `schema:MediaObject` + `dcterms:*` | schema.org, Dublin Core |
| Realization / build artifact | `prov:Entity` ← `prov:wasGeneratedBy` `prov:Activity` | PROV-O |
| Derivation (parent / kernel / disk edges) | `prov:wasDerivedFrom`, `prov:wasGeneratedBy` | PROV-O |
| Author / controller / issuer | `prov:Agent` / DID controller / VC issuer | PROV-O, DID, VC |
| Witness / conformance result | `earl:Assertion` + `earl:outcome` | EARL |
| App Hub / this catalog | `dcat:Catalog` of `schema:SoftwareApplication` | DCAT |
| Attestation across a trust boundary | Verifiable Credential + Data Integrity proof | VC, Data Integrity |
| Self-describing document | JSON-LD `@context` | JSON-LD 1.1 |

Content addressing names only **immutable bytes**. Where W3C names a *mutable* or
*abstract* resource (a person, a property such as `rdf:type`) it keeps its ordinary
IRI — never re-minted; reuse is the goal. A mutable thing is a stable **DID** whose
successive **states** are κ-addressed (the sealed-delta CvRDT pattern).

`required:true` rows are the categories with a live witness today (A1–A5, B1–B4,
C1, D1, E1). `target` / `planned` rows carry their authority and an expected-RED
witness now, and are promoted to `required` when green — the same target → live
promotion the engine's `vv/` uses (its behavioral V&V is written first). The
**load-bearing** one is **A6** — project every descriptor to schema.org / PROV-O /
DCAT and retire the bespoke type + namespace; this is what makes an outside human
or AI agent understand a holospace *without learning anything Hologram-specific*.
The rest: **A8** (EARL — witnesses as linked data), **A7** (Verifiable Credentials
— the **bounded residual** of the signature layer: attribution only, since
integrity is the address), **E2** (per-app CSP), **F1** (ActivityPub federation
over the substrate), **D2** (live WebXR), **F2** (Trace Context).

**Consequences.** "W3C-conformant" becomes one diffable file and one gate exit
code, not tribal knowledge; a regression in any required surface fails the
deploy. Every holospace is interoperable, dereferenceable, and verifiable by a
stock browser, crawler, or RDF tool — *and* stays hologram-native: one
content-addressed canonical form, both axes (ADR-022). **UOR does the heavy
lifting**: the κ-hash *is* the DID and the SRI digest (self-certifying — no
registry, no ledger), one canonical form carries the open-web (SHA-256) and
native (BLAKE3) axes at once (low-latency native, open-web-verifiable
simultaneously), descriptors are themselves content-addressed (cacheable,
offline-verifiable, dedup/migrate across peers), and the content-blind pub/sub
substrate is the ready transport for the federation categories (VC exchange,
ActivityPub) with no server. Because the ontology is **W3C's own**, an outside
human or AI agent already knows the shape of a holospace, the App Hub, and a
conformance result — nothing bespoke to learn — and the signature layer thins to
attribution-only, since integrity is intrinsic to the address. The cost is one
catalog + one gate to maintain and a per-holospace a11y / CSP bar — all derived,
all witnessed, none a new medium, none a fork of the engine.

External authorities: W3C DID Core, JSON-LD 1.1, RDF Dataset Canonicalization
(RDFC-1.0), Subresource Integrity, Verifiable Credentials / VC Data Integrity,
Web App Manifest, Service Workers, WCAG 2.2, WAI-ARIA 1.2, WebRTC, WebXR, Web
Cryptography, CSP Level 3, ActivityPub, Trace Context; the **Web Platform Tests**
project; schema.org, DCMI Terms, PROV-O, DCAT, EARL; IETF RFC 3987 (IRI),
RFC 8785 (JCS), RFC 9420 (MLS); multiformats (multibase / multihash). Per-category
authority URLs live in `web/w3c-conformance.jsonld`.
