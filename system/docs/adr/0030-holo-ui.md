# ADR-030: Holo UI — one UI subsystem, one control surface (supersedes ADR-028)

**Status:** Accepted — Phase 1 (foundation) implemented and witnessed. Ships the `window.HoloUI`
façade (`_shared/holo-ui-kernel.js`), the single control surface (`holo-ui.html`), the brand fold
(`holo-theme-launch.js` + the settings header now read "Holo UI"; `theme.html` / `themes.html`
redirect), and two STAGED gates that now actually measure — `w3c:A44-holo-ui-adoption`
(`holo-ui-adoption-witness.mjs`) and `w3c:C2-mobile` (`mobile-conformance-witness.mjs`, whose
latent path bug had silently disabled it). **Supersedes/absorbs ADR-028 (Holo UX Profile)** and
subsumes the UI portion of ADR-023. Later phases (κ profile sharing, Lighthouse + rendered-mobile
gates, adoption burn-down) promote the staged rows to `required` (ADR-024 discipline).

**Context.** Hologram OS's UI knobs were scattered: "Holo Theme" owned palette/typography/
density/accent + a settings panel; proportion lived in `holo-phi.css`, platform feel in
`holo-platform.js`, window layout in `holo-zones.js`, keyboard in `holo-keys.js`, icons/decoration
in the KDE look-and-feel block, and the surfaces were two pages (`theme.html`, `themes.html`). The
goal is **one subsystem and one place — Holo UI — that replaces the "Holo Theme" brand** and manages
every UI parameter, designed to UI-design fundamentals (clarity, hierarchy, consistency, feedback,
progressive disclosure, direct manipulation, aesthetic-usability), intuitive for anyone, beautiful
and delightful, mobile-first, 100% in-browser/serverless, anchored in the UOR κ substrate — with
mobile + WCAG + Lighthouse enforced as gates, not aspirations. Two facts constrain the design:

- **Zero breakage.** The `--holo-*` CSS token contract, `holo-theme.css`, the `postMessage`
  protocol (`holo-theme`/`-tokens`/`-fonts`/`-hello`) and the `localStorage holo.theme.*` keys are
  load-bearing across 54+ pages and every `theme-*` witness. They must not change.
- **No parallel medium, re-derive everything (Laws L4/L5).** No runtime framework; the unified
  config must content-address like any artifact.

**Decision.** **Holo UI is the single UI subsystem; `holo-ui.html` is the single control surface; it
replaces the "Holo Theme" brand.** `window.HoloUI` is the unified runtime API.

- **A façade, not a rewrite.** `holo-ui-kernel.js` aggregates the engines that already exist
  (`HoloTheme` · `HoloPlatform` · `HoloZones`) and adds the parameters they lacked — shape/radius,
  golden-ratio proportion tier, window layout, icons, window decoration, platform-feel seeding —
  each reusing existing plumbing (the DTCG `radius` group; the `data-holo-*` attributes
  `applyLookAndFeel` already sets), so there is **no new transport and zero breakage**.
  `window.HoloTheme` stays live as a back-compat alias; `holo-ui.js` (the Shoelace loader) is
  untouched — the kernel is the new `holo-ui-kernel.js` (the name clash, resolved by not reusing it).
- **One control surface, designed.** `holo-ui.html` is the ONE place: mobile-first progressive
  disclosure (`<details>` accordions), a golden-ratio split (controls : preview = 1 : φ) on wider
  containers, a live preview, built on the Shoelace component layer so it is accessible and on-brand
  by construction. Sections: Appearance · Color · Typography · Shape & density · Proportion (φ) ·
  Layout & zones · Icons & decoration · Platform feel · Keyboard · Apply-to-apps · Themes & Global
  Themes · Share/Export/Reset. `theme.html` and `themes.html` redirect here; the universal palette
  launcher opens it.
- **One content-addressed object.** The whole UI serialises to one **W3C Design-Tokens (DTCG)** theme
  plus `$extensions` (`org.hologram.theme` · `org.hologram.lookandfeel` · the new `org.hologram.ui`),
  which content-addresses to a **`holo://κ`** (Law L5, via Web Crypto over canonical JSON) — share
  your entire look as a link; export the bytes as `.tokens.json`. This **reconciles ADR-028**: the
  Holo UX Profile (`holo-ux-profile.mjs`, row `A41`) is the *semantic* description (RDF/SHACL/OWL),
  validated in the node witness; the v1 runtime stays pure DTCG/JSON with no framework (Law L4). Full
  omnibox resolution of a pasted `holo://κ` profile is Phase 3.
- **Mobile + WCAG + Lighthouse are gates, staged.** `mobile-conformance-witness.mjs` is fixed (it had
  read a phantom `apps/_shared/` path and silently skipped) and now measures both page layouts;
  `holo-ui-adoption-witness.mjs` proves Holo UI citizenship (runtime + mobile layer + device-width
  viewport + token-driven palette). Both ship as `target`/`required:false` with an honest migration
  worklist, promoted to `required` once burned down — the staged discipline the user chose.

**Consequences.** One place, beautiful by construction (component-driven, golden-ratio, live preview,
progressive disclosure, AA-by-default), intuitive, and magical: your whole UI is a self-verifying,
serverless, shareable κ-object. Zero breakage — every existing `theme-*` witness stays green and the
`--holo-*` contract is untouched. The two new gates make "single UI subsystem" and "works on mobile"
*measurable* immediately (the mobile gate was silently off before), and the worklists name exactly
what remains — the desktop/VM shells (`os`/`plasma`/`qemu`/`vm`/`world`) and a few app pages — to make
mobile a hard `required` gate. Cost: a façade + a surface + two staged witnesses now; the page
burn-down, the κ profile-share omnibox path, and the Lighthouse + rendered-mobile gates are the named
later phases. The next adopt step (ADR-029) is the **Breeze icon theme** feeding `data-holo-icons` so
icons render.

External authorities: **W3C** Design Tokens (DTCG) · CSS Custom Properties L1 · Properties & Values
API L1 · Color 4 (`light-dark()`) · Container Queries L3 · Media Queries L5 (`prefers-*`) · HTML
`postMessage` · Web Cryptography API; **WCAG 2.2** (§1.4.3 Contrast · §1.4.4 Resize Text · §1.4.10
Reflow · §2.5.8 Target Size); **Lighthouse** (mobile quality). Supersedes ADR-028 (Holo UX Profile);
subsumes the UI portion of ADR-023 (Holo Theme); builds on ADR-024 (witnessed conformance), ADR-025
(UOR envelope), ADR-029 (adopt-don't-run). Witnesses: `holo-ui-adoption-witness.mjs` (A44),
`mobile-conformance-witness.mjs` (C2); modules: `_shared/holo-ui-kernel.js`, `holo-ui.html`.
