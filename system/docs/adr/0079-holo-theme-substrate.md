# ADR-0079: Holo Theme substrate — themes as κ-addressed, self-verifying objects, so the whole OS is dynamically customizable through one token source

**Status:** Accepted — built and witnessed (2026-06-13). Five κ-addressed DTCG theme objects ship in
`os/usr/lib/holo/themes/`; the engine swaps by κ with re-derivation (Law L5); a Themes studio in the
Holo UI gallery picks/customizes/imports/forks live. Gates green: `holo-ui-conformance`, `holo-product`
(re-sealed). Builds on ADR-0078 (the Chakra-derived token foundation).

## Context

Three things looked like separate systems: the **Chakra-like token system** (ADR-0078), **Holo Theme**
(the `--holo-*` kernel + `holo-theme.js` engine), and **Holo UI** (the component catalog). They are not
three systems — they are one substrate seen from three angles. The fragmentation was that a "theme" was
just a CSS file: you couldn't swap it, fork it, import one, or verify it. Yet the engine *already* spoke
**W3C Design Tokens (DTCG)** — `HoloTheme.importTheme()` validates a token document, compiles it to
`light-dark()` CSS variables, applies it live, and propagates it across the nested-holospace tree.

## Decision

**Make the theme itself a κ-addressed, self-verifying UOR object.** The three angles collapse into two
tiers, and the "Chakra-like system" becomes simply the *default theme object* plus the *first importer*.

1. **A theme is a κ-addressed DTCG object.** Each theme is a W3C Design Tokens document; its identity is
   `κ = sha256(canonical bytes)`, `did:holo:sha256:κ`. Stored in `os/usr/lib/holo/themes/` with an
   `index.json` catalog. Five ship today (`Holo` default + `Violet`/`Emerald`/`Rose`/`Amber` accent
   variants over the shared Chakra-derived foundation).
2. **The compiler is in the substrate** (`os/usr/lib/holo/holo-theme.mjs`, promoted from the ADR-0078
   harvester). It extracts the default core palette from the kernel (so kernel default ≡ default theme
   object by construction) and emits the κ-addressed DTCG themes. It is also the import path: any source
   (Chakra config, W3C tokens, hand-authored) → a canonical theme object.
3. **The engine swaps by κ** (`holo-theme.js`): `listThemes()` reads the catalog; `setThemeByKappa(κ)`
   fetches the theme, **re-derives sha256 and refuses on mismatch (Law L5)**, then applies it via the
   existing `importTheme` path — live, OS-wide, 100% client-side, zero rebuild. Applying a theme hands
   aesthetic governance to it (ad-hoc accent/typeface overrides are cleared; accessibility is kept).
4. **The DTCG format covers the full surface.** `holo-theme-format.js` passes through any
   `color.light/dark.*` (ramps) and a `scale.*` group (spacing/radii/weights), so a theme can carry the
   complete `--holo-*` token set, not just the 11-color core. The default **Holo** theme embeds the full
   surface (ramps + scales), and **Holo Slate** demonstrates it — a theme that redefines the neutral ramp
   (cool slate vs zinc) + core neutrals + a sky accent (verified live: it shifts bg/surface/gray-500/accent,
   not merely the accent). Accent variants stay lean deltas; ramps/scales then inherit the kernel.
5. **The studio is in Holo UI.** A Themes view in the gallery: pick a theme (live), customize
   accent/radius/typeface live, import a DTCG file, fork/export the current theme. Every change re-themes
   the whole gallery — and the whole OS — instantly, because everything resolves one `--holo-*` source.

## Consequences

- **One canonical implementation, three intuitive surfaces:** the token kernel (mechanics), the
  κ-addressed theme objects (data), and the studio (authoring). Holo UI consumes them unchanged.
- **Complete dynamic customization via κ-addressed tokens** — swap, fork, import, or build a theme; the
  whole app ecosystem follows from one source. Verified live: picking a theme cycles `--holo-accent`
  across every component (violet → emerald → rose → blue); the studio's accent/radius/typeface controls
  re-theme in real time.
- **Serverless + self-verifying:** themes are content-addressed and re-derived on load; rendering stays
  the lean κ→mount path (ADR-0078); no runtime beyond the engine.
- **Standards-track + portable:** themes are W3C Design Tokens, so they interoperate with the wider
  design-token ecosystem while gaining κ-identity.
- **Maintenance:** editing `holo-theme.{css,js}` requires `seal-product.mjs` (product Merkle-links them);
  regenerate themes with `node holo-theme.mjs` (touches only the compiler + theme JSON — both outside
  sealed/locked closures and self-verifying, so no reseal/relock). `make-dist` already bundles `themes/`
  + `holo-theme-format.js` via its recursive `usr/lib/holo → _shared` projection (`holo-theme.mjs` is a
  build-time compiler, not runtime-fetched).

## Holo Control — the unified appearance panel

The theme studio, the engine settings modal, and the theme gallery were three doors to one job. They are
unified into **one canonical Appearance control panel** (the Holo UI app's **Appearance** tab): theme
cards (live κ-swap) · a live component preview · Mode/accent/text-size/typeface basics · an *Advanced &
accessibility* section (presentation, corner radius, minimum-size floor, enforce-on-apps) behind
progressive disclosure · import/fork. The **Components** catalog is a sibling tab (a different job —
developer reference — not flattened into settings). Best-practice UX: live preview, progressive
disclosure, accessibility surfaced, one design language, hash deep-links (`#appearance` / `#components`).
The engine's quick settings modal (`HoloTheme.openSettings`, reachable from any surface) stays for fast
in-place tweaks and now launches Holo Control (`/apps/ui/index.html#appearance`) as the full surface.

## How to use it

- **Open the panel:** the Holo UI app → Appearance tab, or any surface's settings → "Open Holo Control".
- **Swap:** `HoloTheme.setTheme("Holo Emerald")` or `setThemeByKappa("sha256:…")`.
- **Customize:** the gallery Themes studio, or `HoloTheme.setAccent` / `setVar` / `setFontFamily`.
- **Import:** drop a DTCG `.json` in the studio, or `HoloTheme.importTheme(json)`.
- **Build:** author a DTCG document (or run the compiler over a source) → a new κ-addressed theme.
