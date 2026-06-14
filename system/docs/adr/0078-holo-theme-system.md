# ADR-0078: Holo Theme System — a Chakra-derived token foundation so every holo-native app looks incredible by default

**Status:** Accepted — built and witnessed (2026-06-13). The Chakra-derived `--holo-*` foundation is live
in the canonical theme kernel (`os/usr/lib/holo/holo-theme.css`), proven to cascade OS-wide, and the
ergonomic primitives ship as a content-addressed UOR object. Gates green: `holo-ui-conformance`,
`holo-product` (re-sealed), `holo-dock`, `holo-app-token`, `holo-app-ui-conformance`.

## Context

Holo UI already vendors the full shadcn/ui + Magic UI catalog (466 elements) as content-addressed UOR
objects, themed by ONE canonical token source (`--holo-*` in holo-theme.css) across light · dark ·
immersive. What was thin was the **depth and tuning of the default tokens**: the kernel carried a
handful of semantic colors and almost no scale system (spacing, radii, type, elevation, ramps). "Apps
look incredible right away, no fixing ugly UI" is fundamentally a *theming* problem — a professionally
tuned token system + good primitives — not a need for more components.

Chakra UI (chakra-ui/chakra-ui, MIT) is the reference for exactly that: a deeply-tuned design-token
architecture (full color ramps, semantic tokens, recipes) that, in v3, compiles to plain CSS variables.
The temptation is to vendor Chakra as a second component library. That would be a mistake — it ships a
second runtime (its own `createSystem`/provider/style engine), a second token namespace (`--chakra-*`),
and a second visual language next to shadcn. The result is the *opposite* of the consistency we want,
and it breaks the lean content-addressed render model (κ → fast faithful mount, no runtime).

## Decision

**Harvest Chakra's theme system into the one canonical `--holo-*` source; do not ship Chakra's runtime.**

1. **Token harvest (deterministic).** `defaultConfig` from `@chakra-ui/react@3` is introspected and its
   token VALUES transpiled into `--holo-*` CSS variables (`gen-foundation.mjs`):
   - **Color ramps** — 12 hues × 50–950 + white/black/alpha → `--holo-<hue>-<step>`.
   - **Scales** — spacing (34 steps, rem), radii (`2xs…4xl,full`), font weights, line-heights, letter
     spacings, plus a synthesized neutral **elevation** scale (`--holo-shadow-{xs…xl}`).
   - **Core neutrals REBASED** onto Chakra's zinc ramp — the palette the vendored shadcn/Magic UI
     components were designed against — so they render "correct" by default. Roles are chosen to keep
     bg↔surface contrast (light: `gray.50` canvas / white surface; dark: `#09090b` canvas / `#111111`
     surface), so cards pop in both modes.
   - **Semantic layer ENRICHED** — `surface-2/-emphasized`, `border-subtle/-emphasized`,
     `ink-dim/-subtle` — the part that makes a theme cohere.
   - **Brand preserved** — the Holo accent (`#3b5bdb` / `#5b8cff`) is unchanged; status colors aligned
     to Chakra green/orange/red for harmony.
   No Chakra runtime is shipped — only its tuned values, as standards-track CSS custom properties.

2. **Ergonomic primitives (Chakra-style API, Hologram-native).** A token-driven layout kit —
   `Box · Flex · Stack · HStack · VStack · Grid · SimpleGrid · Container · Center · Spacer` — hand-authored
   (MIT) so `<Box p={4} bg="surface" rounded="lg">` resolves every style prop to a `--holo-*` token (the
   foundation above). Encoded as a content-addressed UOR object (`box`, tier `primitive`, library `holo`,
   category `Primitives`) by the same `build-catalog.mjs` pipeline as every other element — addressable by
   κ, rendered by the canonical κ→render path, themed live by the one source.

## Consequences

- **All 466 components upgrade for free** — they read `--holo-*` through the shadcn↔holo bridge, which
  references the tokens live; the moment the foundation became Chakra-grade, every component (and every
  future app) inherited it with zero per-app work. Verified OS-wide: a real app (etherscan) renders on
  the new canvas; shadcn `Card` is `#111111` on `#09090b` (dark) and white on `#fafafa` (light).
- **One source of truth, one visual language** — consistency is preserved, not fractured.
- **No new runtime, no second namespace** — the lean κ-render model is intact.
- **The kernel is verified by structure, not byte-seal** in `holo-ui-conformance` (`@property
  --holo-font-min` + the font-size floor), so additive edits are safe; the `holo-product` seal
  Merkle-links holo-theme.css and was re-pinned via `seal-product.mjs`. Determinism held: relock added
  only the new `box` object — zero churn to the 466.
- **How to use it:** apps get the professional theme automatically by reaching for `--holo-*` tokens (or
  the vendored components, which already do). For prop-based authoring, import the primitives by κ. One
  token change in Holo UI re-themes the whole OS.

## Alternatives rejected

- **Vendor Chakra as a parallel component library** — two runtimes, two namespaces, two visual languages;
  breaks consistency and the content-addressed render model.
- **Ship Chakra's `createSystem`/provider per app** — a second live theming engine competing with the
  `--holo-*` cascade.
