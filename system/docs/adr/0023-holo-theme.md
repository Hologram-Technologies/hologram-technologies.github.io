# ADR-023: Holo Theme — Hologram OS theming is a W3C-native, browser-level design system

**Module:** *Holo Theme* — `_shared/holo-theme.{css,js}`, runtime handle `window.HoloTheme`.
A self-bundling module: a single `<script src="…/holo-theme.js">` adopts it (it injects
its own stylesheet); the OS shell additionally pre-links the CSS to avoid any flash.

**Component layer:** the *tone* is Holo Theme; the *components* are **Shoelace / Web
Awesome** — a framework-agnostic **W3C Web Components** library (Custom Elements +
Shadow DOM), vendored at `_shared/shoelace/` exactly like `videojs`/`webamp`/`xterm`
(content-addressed, no third-party origin). It is themed *by* Holo Theme, not the other
way round: `_shared/holo-shoelace.css` maps `--holo-*` → `--sl-*` (custom properties
pierce Shadow DOM), and `holo-theme.js` toggles Shoelace's `.sl-theme-dark`. One line —
`<script type="module" src="_shared/holo-ui.js">` — loads the whole system (sets the
base path from its own URL, injects the themes + bridge, starts the autoloader). The
canonical look is defined once in `ui.html` (the design-system reference); every other
holospace conforms to it instead of inventing UI. Gated by `ui-conformance-witness.mjs`.
Chosen over React/Tailwind systems (would violate the no-framework, W3C-vanilla rule)
and over a minimal CSS reset (would still leave complex components to invent).

**Status:** Accepted. (Realizes the global-UX/theming brief as an OS-wide UX kernel
built only on W3C primitives; witnessed by `theme-conformance-witness.mjs`, the
sibling of the addressing and mobile-conformance witnesses.)

**Context.** Hologram OS mounts every app/protocol surface as a holospace — a real
HTML document nested in a full-viewport **iframe** and driven over `postMessage`
(see `home.html` `#hf-frame`; infinite nesting). The OS needs one visual language —
palette, typography, spacing, density — that propagates across all surfaces, switches
live, and lets the user enlarge text or force dark mode everywhere. Three facts
constrain the design:

- **Surfaces are separate documents (iframes), not one DOM.** CSS custom properties
  and `@layer` ordering **do not cross the iframe boundary**, so "set `:root` vars
  once, they propagate everywhere" is false here. Propagation needs a *protocol*, not
  inheritance.
- **The discipline is "adopt a ratified standard, witness it"** (ADR-022). So the
  theme must be expressed in W3C Recommendation/standards-track features — **not** a
  proprietary framework, and **not** the Design Tokens (DTCG) JSON format, which is a
  Community-Group draft, *not* a W3C Recommendation. DTCG may be an optional export;
  it is never the source of truth.
- **Some surfaces have no CSS at all** — QEMU/OS guests, Webamp/video.js canvases.
  CSS theming can reach their chrome, never their pixels. The model must say so.

**Decision.** A theme is content (ADR-022) and its language is the W3C CSS platform.
No framework, no compiler is canonical.

- **Token schema + values — standards-track CSS only.** `_shared/holo-theme.css`
  declares typed tokens with **CSS Properties & Values API** (`@property` → type,
  inheritance, initial value — the schema, no JSON), holds values in **CSS Custom
  Properties L1**, carries light *and* dark in one value via **`light-dark()` / Color
  Adjustment L1**, and derives tints with **Color 4 `color-mix()`**.
- **Precedence — CSS Cascade Layers L5** (`@layer hos-base, hos-os, app, hos-user`).
  An app's *unlayered* rules beat the OS layer, so an app keeps its look by declaring
  its own values (**own**); a token it omits falls through to the OS value (**adopt**).
- **User always wins for accessibility.** `holo-theme.js` applies font-scale and
  density as **inline custom properties on `:root`** (author inline beats stylesheets);
  **enforce-os** adds `!important` so the user beats app `!important` too.
- **Typography is the OS text system.** One lever, `--holo-font-scale`, drives the
  **root `font-size`**; the `--holo-text*` ramp (holo-mobile.css) is authored in `rem`,
  so the whole scale moves together with no double-scaling. `--holo-font-sans` /
  `-serif` / `-mono` set the typeface. Both are live-settable in Settings › Display.
- **Two orthogonal axes, not three palettes:** *palette* (`auto|light|dark`, via the
  `data-holo-palette` attribute + `color-scheme`) and *presentation*
  (`standard|immersive`, via `data-holo-presentation` → density). Initial palette
  resolves: saved choice → else **`prefers-color-scheme`** (Media Queries L5) → else OS
  default. Motion honors `prefers-reduced-motion`.
- **Propagation — the HTML Standard's `postMessage`** down the nested-holospace tree.
  `holo-theme.js` broadcasts `{type:"holo-theme", state}` to child iframes; a mounting
  child sends `holo-theme-hello` and the parent replies — instant, no rebuild/restart.
- **Identity — a κ artifact.** holo-theme.css is content-addressed by
  `build-holo-site.mjs` like every file: `sha256` + `did:holo:` + SRI + JSON-LD. The
  OS theme, an app theme, and a user theme are the *same kind* of object; switching is
  choosing which κ binds in which slot.

**Portable format (themes as shareable artifacts).** A theme is a **W3C Design Tokens
(DTCG)** file — `$value`/`$type`/`$description`, group `$type` inheritance, `{alias}`
references — the format the open-source community publishes. `_shared/holo-theme-format.js`
compiles DTCG ⇄ CSS custom properties: `color.light.*`/`color.dark.*` groups emit
`light-dark(l, d)` (Color 4). `HoloTheme.importTheme(json)` validates → compiles →
injects a `<style id="holo-theme-tokens">` (unlayered, beats the layered defaults; the
engine's inline user overrides still win) → persists → broadcasts down the iframe tree;
`HoloTheme.exportTheme()` reverses it. The default theme is authored as
`_shared/themes/hologram.tokens.json` (the fork-me template). This keeps CSS custom
properties as the *runtime* (Rec-track) while DTCG JSON is the *interchange* form —
resolving "DTCG is a CG draft, not a Rec": JSON to author/share, CSS to run. Gated by
`theme-format-witness.mjs` (validates, compiles to `light-dark()`, round-trips losslessly).
A theme being a DTCG file + κ artifact is what lets Holo Hub discover/install/review/share
themes like any app (ADR-022 + Hub's AppStream/ODRS model).

**Fonts are first-class, content-addressed citizens.** A theme already ships a typeface
(`font.face` → `@font-face`, `font.family` → `--holo-font-sans`); the runtime makes fonts
independently importable and selectable (Settings › Display). The user can **drop in any
WOFF2/WOFF/TTF/OTF** or one-click a face from the κ-pinned **font library**
(`_shared/fonts/index.json`). An imported font's bytes ride inline as a **`data:` URL**
(RFC 2397) inside its `@font-face`, so the rule is self-contained and propagates verbatim
across the isolated-holospace tree (the `holo-fonts` postMessage — transitive, plus the
hello/late-mount handshakes); every separate document loads it locally — no CDN, no
cross-origin fetch. Content-addressing already gives integrity, permanent cache, and
dedup, so there is no cache-busting layer and SRI is just the *W3C expression* of the κ
(emitted by the build, not a delivery chore). Coverage is **segmented** with `unicode-range`
(CSS Fonts L4), never subset away — an OS must render arbitrary content without tofu. The
active face is **preloaded** (`<link rel=preload as=font>`) so local κ fonts paint without
the `font-display:swap` flash. Variable WOFF2 is the house rule (one file spans the weight
range). Gated by `theme-fonts-witness.mjs` (library faces resolve to non-trivial variable
woff2; an import compiles to a self-contained `data:`-URL `@font-face`; registry +
cross-frame propagation wired) and proven live across a nested holospace.

**Adopt / own / enforce (the resolution).** App declares `<meta name="holo-theme-policy">`
(`adopt` default | `own`); user sets one switch (`respect` default | `enforce-os`).

| user ↓ \ app → | adopt | own |
|---|---|---|
| respect | OS theme | app theme |
| enforce-os | OS theme | OS theme\* |

\* CSS/DOM surfaces that use the `--holo-*` tokens. Canvas/VM surfaces and apps using
private var names resist until migrated — an inherent, stated limit (you can theme
their chrome, not their pixels). Accessibility (text size, density, motion) applies
to *all* surfaces regardless of policy.

**Consequences.** One W3C-native source of truth for all UI, coherent across
heterogeneous holospaces and every device (the type ramp + safe-area + tap floors of
holo-mobile.css carry mobile/tablet/desktop uniformly), switchable in real time with
no framework dependency. Adoption is one line per page (`holo-theme.css` +
`holo-theme.js`) and is tracked by the witness, so rollout is visible and gated. Cost:
a second shared file every page links, and the honest non-coverage of pixel surfaces.

External authorities: W3C CSS Custom Properties for Cascading Variables L1; CSS
Properties and Values API L1 (`@property`); CSS Cascading & Inheritance L5 (Cascade
Layers); CSS Color 4 (`color-mix()`); CSS Color Adjustment L1 (`color-scheme`,
`light-dark()`); Media Queries L5 (`prefers-color-scheme`, `prefers-contrast`,
`prefers-reduced-motion`); CSS Fonts Module L4 (`@font-face`, `font-display`, variable
weight ranges, `unicode-range`); data: URL (RFC 2397); HTML Standard (cross-document messaging); WCAG 2.2
(§1.4.4 Resize Text, §1.4.10 Reflow, §2.3.3 Animation from Interactions). Identity:
ADR-022 (W3C content addressing).
