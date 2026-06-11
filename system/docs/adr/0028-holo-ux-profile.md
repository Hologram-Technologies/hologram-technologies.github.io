# ADR-028: Holo UX Profile — system UX is one self-verifying, semantic-web object

**Module:** *Holo UX Profile* — `_shared/holo-ux.{js,…}`, the canonical system-UX
parameter object; runtime handle `window.HoloUX`, built atop Holo Theme (ADR-023). One
`<script src="…/holo-ux.js">` resolves the Profile against the device and propagates it
down the holospace tree; downstream objects *bind its κ*, never restate its values.

**Name & layering.** This decision is **Holo UX — the experience layer**: the *what* of
the experience (proportion, voice, capability, performance), defined as one self-verifying
object that apps inherit. It sits **under [ADR-030 Holo UI](0030-holo-ui.md), the control
surface** — the *where you change it* (`window.HoloUI` · `holo-ui.html`). Two layers, one
contract: Holo UX is the experience, Holo UI is its dashboard; both share the `--holo-*`
token contract and the κ substrate. Holo UX keeps its own runtime handle (`window.HoloUX`,
`holo-ux.js`); Holo UI's brand and façade are unchanged.

**Status:** Implemented + witnessed (the Holo UX layer); superseded *in framing only* by
ADR-030, which reconciles it: `holo-phi.css` is the proportion source and
`holo-ux-profile.mjs` (row `A41`) is the semantic (RDF/SHACL/OWL) description, while the v1
runtime stays pure DTCG/JSON. **Five green rows:** proportion (`w3c:A40-holo-phi`), the
Profile object (`w3c:A41-holo-ux-profile`), the plain voice register (`w3c:A42-holo-voice`),
hardware-aware resolution (`w3c:A43-holo-capability`) and the performance budget
(`w3c:A45-holo-perf`). The `holo-ux.js` experience runtime ships with them (its live DOM
propagation is the one remaining browser-witness follow-up). Promotion to *Accepted* awaits
that browser witness and a maintainer's sign-off — conformance is the definition of done,
ADR-024.

**Context.** Holo Theme (ADR-023) made palette, typography, spacing and density a
W3C-native, content-addressed theme that propagates across the nested-holospace tree.
The brief is larger than a theme: **one canonical object that declares every system-wide
UX parameter** — proportion (the golden ratio), full-screen adaptation, mobile, authoring
voice (avoid jargon; *why → how → what*), performance budgets, and hardware-aware
optimization — that **every downstream object ingests**, so an app is beautiful and
correct out of the box. Five facts constrain the design:

- **Everything is a self-verifying object (ADR-025).** The Profile must itself be a UOR
  envelope addressed by κ and re-derived on receipt (Law L5) — not a config file trusted
  by location. No parallel configuration medium (Law L4).
- **Mint nothing (ADR-024 A6).** UX parameters must be expressed in ratified vocabulary.
  The semantic layer is therefore the **open W3C Semantic Web stack** — RDF, RDF Schema,
  OWL 2, SKOS, SHACL, SPARQL, JSON-LD — strictly adhered to per
  [w3.org](https://www.w3.org/) — not a bespoke schema.
- **DTCG is interchange, not source of truth (ADR-023).** The *runtime* stays CSS Custom
  Properties (Rec-track); the *semantic* description and constraints are RDF; DTCG JSON
  remains the optional share/import form. The Profile must keep these three roles distinct.
- **Duplication is the enemy (Law L2).** There must be exactly **one** Profile; every
  surface binds its κ, none copies its values — change the κ, the whole system changes.
- **Some surfaces have no CSS** (QEMU/OS guests, canvas/video). The model reaches their
  chrome, never their pixels, and must say so (inherited honestly from ADR-023).

**Decision.** The system UX is **one content-addressed object — the Holo UX Profile** —
typed and constrained in the W3C Semantic Web stack, compiled to the CSS runtime,
resolved against detected hardware, and propagated to every holospace.

- **One object, one identity (L1/L2).** The Profile is a UOR envelope (ADR-025): a
  **JSON-LD 1.1** document whose identity is minted by the canonical envelope
  (`holo-object.mjs`, consumed by reference — **RFC 8785 JCS**; RDFC-1.0 is the RDF-graph
  canon at the addressing layer, catalog A3), addressed `did:holo:sha256:…`, verified by
  re-derivation (L5). It **Merkle-links the canonical token-group files** (φ, theme, mobile)
  by content address, so a change to any group derives a new Profile κ. Theme, φ scale,
  voice, budgets and the capability map are token *groups within the one Profile*; the
  default values (the "Holo Theme" bundle) ship as one κ, and every downstream holospace
  binds that κ as a *slot* rather than restating values.

- **Semantic-web typing and constraint (mint nothing).** The Profile is scoped by an
  `owl:Ontology`: its classes and properties come from **RDF Schema 1.1** + **OWL 2**;
  its controlled vocabularies (palette modes, density presets, capability tiers, tone
  register) are a **SKOS** concept scheme; its validity is enforced by a **SHACL** shape
  (`_shared/holo-ux-shape.jsonld`) — a Profile that fails the shape is refused *before* it
  can mint a κ. (The first witness validates the shape's core constraints in pure Node, per
  the repo's zero-dependency discipline; a vendored SHACL engine is the upgrade path — the
  shape file is real, standards-valid SHACL either way.) Descriptive metadata reuses
  **schema.org** + **DCMI Terms** + **PROV-O** (authorship, derivation) + **DCAT** (a Profile
  is a catalog entry, like a theme); being RDF, it is **SPARQL 1.1**-queryable. The
  genuinely novel UX terms (a φ ratio, a tier, a voice register) live in a dereferenceable
  **OWL ontology** published at a second, scoped minted namespace — `hosux:`
  (`ns/ux.jsonld`), distinct from the conformance `hosc:` and held to the same mint-nothing
  discipline (a near-equivalent declares `skos:closeMatch`) — *defined with* rdfs/owl/skos,
  extending the standards, never forking them.

- **Proportion — the golden ratio (φ).** One canonical φ token group, generated from a
  single source (`_shared/holo-phi.mjs` → `holo-phi.css`): `--holo-phi: 1.618` and a
  geometric `--holo-size-*` ramp of powers of φ (φ⁻³…φ⁵). The 8px grid of ADR-023 is
  retained for spacing *rhythm*: **φ governs the proportion of objects, the grid governs
  spacing** — two complementary token groups, no overlap. This supersedes the per-app φ
  reinventions that had drifted (`etherscan`, `browser`, `btc`): the φ⁻³…φ³ core equals
  their de-facto values exactly, so apps converge onto one source with no visual churn
  (Law L2). Witnessed by `holo-phi-witness.mjs` (the ramp is geometric with ratio φ, the
  CSS is the module's faithful materialization — a hand-edit fails the gate — and the app
  convention is preserved).

- **The whole screen, every screen.** Layout fills the viewport and adapts *by container,
  not by device guess*: **CSS Container Queries L3** (`@container`), `clamp()` fluid type
  (already in `holo-mobile.css`), `dvh` + safe-area `env()`, `light-dark()`. Mobile is not
  a branch but the same tokens — the tap floor (48px, **WCAG 2.5.8**), safe-area insets and
  16px input floor are carried by the Profile. Desktop-native feel is a *budget*, below.

- **Voice — avoid jargon; why → how → what.** An object description is data with a shape.
  A **SHACL** shape requires the `why → how → what` ordering and a concision ceiling; a
  **SKOS** taxonomy marks register so any jargon term carries a plain-language
  `skos:prefLabel`. `holo-voice-witness.mjs` lints every shipped object description and app
  `summary` against the shape and the jargon list — "concise, clear, self-disciplined"
  becomes gated, not aspirational. *First-principles thinking and radical transparency are
  structural here*: the Profile and every value it sets are inspectable, addressed and
  witnessed; nothing hides behind a framework.

- **Performance is a declared budget (lean, fast, native-feeling).** The Profile carries
  explicit numbers — memory footprint, cold-start, interaction latency, bytes-per-surface,
  motion (honoring `prefers-reduced-motion`). "Less is more / keep it lean / low latency"
  become values in the object, witnessed by Lighthouse (already bundled `accessible-mobile`)
  plus a memory probe — not a vibe.

- **Hardware-aware resolution (auto-detect, optimize).** At boot a capability probe —
  **Device Memory**, **Network Information**, `navigator.hardwareConcurrency`, the WebGPU
  adapter (via `holo-gfx.js`), DPR, and the `prefers-*` Media Queries L5 — resolves the
  Profile to a tier (`lean | standard | rich`), producing a *derived* profile that is
  itself canonicalized and content-addressed: a deterministic function `base-κ + probe
  vector → derived-κ`. The optimization is thus reproducible and verifiable, not opaque.
  The probe degrades honestly when headless (`holo-capability-witness.mjs`).

- **Propagation — one bundle, every surface ingests it.** Extends ADR-023's HTML-Standard
  `postMessage` tree: `holo-ux.js` broadcasts the resolved Profile and its κ down the
  nested-holospace iframes; a mounting child sends hello and inherits. Downstream objects
  ingest by binding the κ, so "wire every downstream object to dynamically ingest the
  custom settings" is the *default*, and switching the Holo Theme (or any token group)
  re-flows the whole system live. The adopt / own / enforce-os resolution of ADR-023
  carries unchanged.

**Consequences.** One Semantic-Web-native, content-addressed object defines all system
UX. Apps are beautiful out of the box because they bind a κ rather than re-implement UX;
the golden ratio, the voice, the budgets and the hardware adaptation are each witnessed,
so "magical, and it just works" is the *gate*, not a hope. It composes with ADR-022/023/
024/025 and adds **zero runtime framework**. Costs: a SHACL shape and the `hosux:` OWL
ontology to maintain; a derived-profile resolution step at boot; and the same honest
non-coverage of pixel-only surfaces (VM/canvas) inherited from ADR-023. The decision is
not done until it is witnessed (ADR-024). **Shipped + witnessed now:** row `w3c:A40-holo-phi`
(witness `holo-phi-witness.mjs`, module `_shared/holo-phi.{mjs,css}`) and row
`w3c:A41-holo-ux-profile` (witness `holo-ux-profile-witness.mjs`, builder
`holo-ux-profile.mjs`, ontology `ns/ux.jsonld`, shape `_shared/holo-ux-shape.jsonld`) — the
Profile self-verifies + its token links re-derive (L5), is deterministic + tamper-refused,
and passes its SHACL shape. Row `w3c:A42-holo-voice` (witness `holo-voice-witness.mjs`,
linter `_shared/holo-voice.mjs`, SKOS lexicon `_shared/holo-voice-lexicon.jsonld`, SHACL
shape `_shared/holo-voice-shape.jsonld`) — the linter detects jargon and enforces the
why→how→what order + a concision ceiling, the canonical descriptions practice the register,
and shipped app summaries are reported (not gated). Row `w3c:A43-holo-capability` (witness
`holo-capability-witness.mjs`, module `_shared/holo-capability.mjs`, runtime
`_shared/holo-ux.js`) — the tier resolution is pure + conservative, the headless probe
degrades honestly, and the derived profile is deterministic in `base-κ + probe`,
self-verifying, and `prov:wasDerivedFrom`-linked to the base. Row `w3c:A45-holo-perf`
(witness `holo-perf-witness.mjs`, budget `_shared/holo-perf-budget.json`) — a tier-aware
performance budget with interaction latency held ≤ 100ms on every tier (RAIL), resource
headroom monotonic by capability, `maxDpr` single-sourced with the capability tiers, and
Merkle-linked into the Profile (A41 carries it). **The Holo UX row-set is therefore
`A40 · A41 · A42 · A43 · A45`** — proportion, the object, voice, capability, performance.
**To follow:** a browser witness for `holo-ux.js`'s live DOM propagation; and a
`delightful-by-default` bundle — deferred because the bundle registry lives in the Holo UI
maintainer's `os/specs.json` (a different catalog from these `w3c-conformance.jsonld` rows),
so grouping them there is a Holo-UI-side integration, not a Holo UX change.

External authorities — **W3C Semantic Web:** RDF 1.1 (Concepts & Abstract Syntax;
Semantics); RDF Schema 1.1; OWL 2 Web Ontology Language; SKOS Reference; Shapes
Constraint Language (SHACL); SPARQL 1.1; JSON-LD 1.1; RDF Dataset Canonicalization
(RDFC-1.0); PROV-O; DCAT; DCMI Metadata Terms; schema.org; Verifiable Credentials Data
Integrity (the re-derivation). **W3C CSS / platform:** CSS Containment & Container
Queries L3; Custom Properties L1; Properties & Values API L1 (`@property`); Values 4
(`clamp()`); Color 4 / Color Adjustment L1 (`light-dark()`); Media Queries L5
(`prefers-*`); Device Memory; Network Information; WebGPU; HTML Standard (cross-document
messaging). **Accessibility:** WCAG 2.2 (§1.4.4 Resize Text, §1.4.10 Reflow, §2.3.3
Animation from Interactions, §2.5.8 Target Size). Identity & regime: ADR-022 (W3C content
addressing), ADR-023 (Holo Theme), ADR-024 (conformance gate), ADR-025 (UOR envelope).
