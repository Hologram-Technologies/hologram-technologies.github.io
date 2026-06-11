# ADR-066: Holo Product Manager — the full-cycle PM framework (Pragmatic), wired to the substrate

**Status:** Accepted — implemented and witnessed (`#holo-pm`, `tools/holo-pm-witness.mjs`, 16 checks).
Sits **above** [ADR-065 Holo Product](0065-holo-product.md): Holo Product is the foundation a product
is *built on*; Holo Product Manager is *how you take it full-cycle* — from a real market problem to a
scalable, supported product. Surfaced as the canonical pane (`holo-pm.html`) and exposed through the
[Holo SDK](0050-holo-sdk.md) (`pm()`).

**Context.** Hologram now has the parts to *build* a great product (UI ⊕ UX ⊕ Product) and to *make*
one (the SDK/scaffolder). What was missing is the **discipline that runs the whole cycle** — market,
focus, business, planning, programs, enablement, support — as one coordinated, well-executed
framework, so an idea becomes a scalable, enterprise-grade product that solves a real pain point.
Rather than invent a methodology, adopt the field's most widely-used one: the **Pragmatic
Framework** (pragmaticinstitute.com/product/framework) — *a clear and simple path from great ideas to
great products*, 37 activities ("boxes") in 7 categories. Three facts constrain the design:

- **Strictly adhere (cite, don't fork).** The framework is encoded VERBATIM — the exact 7 categories
  and all 37 boxes, by their official names — and the witness re-derives ours against that authority.
  Mint nothing (ADR-024): `hospm:` mints only the framing terms; the boxes are Pragmatic's.
- **Wire it, don't just describe it.** Every activity Hologram already realizes must bind, by content
  address, to the tool that executes it — so the framework is *run on the substrate*, unified and
  coordinated, not a poster on the wall. The market/business-judgment boxes stay the PM's job (NIHITO
  — *nothing important happens in the office*); the framework is honest about what no tool can own.
- **One self-verifying object (L1/L5).** The framework is a UOR envelope addressed by κ; it
  Merkle-links the Holo Product foundation it manages and every wired tool, and re-derives.

**Decision.** **Holo Product Manager is one content-addressed object — the Pragmatic Framework on the
substrate — that orchestrates the existing tools into one full-cycle PM framework.**

- **One source (`_shared/holo-pm.mjs`).** The 7 categories (Market · Focus · Business · Planning ·
  Programs · Enablement · Support) on the strategic→tactical axis, and the 37 boxes, each with its
  category, a checkable `obligation`, and — where Hologram realizes it — the tool it is `realizedBy`.
  The central principle and the Pragmatic mantras are carried as data.

- **Wired to every relevant tool.** User Personas → Holo UX capability tiers · Use Scenarios /
  Stakeholder Comm. → the plain voice · Requirements / Roadmap / Positioning → Holo Product · Buyer
  Experience → Holo UX · Launch / Awareness / Advocacy → Holo Share-to-Run · Pricing / Revenue /
  Profitability → Holo Own·Settle · Buy-Build-Partner / Innovation → Holo App (build·compose) ·
  Measurement → re-derivation (verify, Law L5) · Operations → the conscience gate · Content / Sales
  Tools → the Holo SDK + scaffolder · Distinctive Competencies / Asset Assessment / Distribution /
  Portfolio → the κ substrate · Atlas · share-by-κ. 25 of 37 boxes execute on the substrate; the
  remaining 12 are the PM's market/business judgment.

- **The sealed framework (`os/etc/holo-pm/pm.uor.json`).** Embeds the categories + boxes + principle
  + mantras + the wiring coverage, and Merkle-links the Holo Product foundation it manages and every
  distinct wired tool. Re-derives (Law L5); built by `tools/seal-pm.mjs`. Vocabulary
  `os/usr/share/ns/pm.jsonld` (mints `hospm:`; the witness refuses drift).

- **The canonical pane + the SDK door.** `holo-pm.html` renders the whole cycle — the 7 categories
  strategic→tactical, every box with its obligation and the tool that realizes it — and is itself a
  Holo Product citizen (loads the engine, token-driven). The SDK exposes `pm()` (the framework, read
  live, with the pane URL), so it can join the Holo SDK and be driven by apps + agents.

- **Conformance.** `tools/holo-pm-witness.mjs` proves the object re-derives and its links re-derive
  (L5); the framework matches the Pragmatic authority EXACTLY (7 categories in order, all 37 boxes by
  name, 5·4·5·7·8·4·4); it links + rests on the Holo Product foundation (which itself re-derives);
  every wired activity points at a present tool; the vocabulary hasn't drifted and cites Pragmatic;
  the plain voice holds; and it is operative (the SDK exposes `pm()`, the pane exists). Row `#holo-pm`.

**Consequences.** The full product cycle is now one coordinated, witnessed framework — "turn an idea
into a scalable product that solves a real pain point" becomes a path you follow with the tools wired
in, not a slogan. It composes ADR-065/062/030/057/064/053/050 and adds zero runtime framework. Costs:
the `hospm:` vocabulary + the seal step (re-run `seal-pm.mjs` after editing the source or a wired
tool, or after the Holo Product foundation re-seals — the witness catches a stale link); wiring is
deliberately to *stable* artifacts (Measurement → the re-derivation primitive, not the hot gate
catalog) to avoid churn; and the honest non-coverage of the market/business-judgment boxes (NIHITO).

**External authorities — product management:** the Pragmatic Framework (pragmaticinstitute.com/
product/framework — 37 boxes / 7 categories; NIHITO; Buyer ≠ User; market-driven), cited verbatim.
**Semantic web:** OWL 2; RDF Schema 1.1; SKOS Reference; JSON-LD 1.1; PROV-O; schema.org; RFC 8785
(JCS). **Identity & regime:** ADR-024 (conformance gate), ADR-025 (UOR envelope), ADR-065 (Holo
Product), ADR-062/030/057 (Holo UX/UI), ADR-064 (Share-to-Run), ADR-053 (Own/Settle), ADR-050 (Holo
SDK). UOR-ADDR (κ = H(canonical_form)); verify by re-derivation (Law L5).
