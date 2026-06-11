# ADR-0059: Holo Dock — the native-feel, OS-adaptive, translucent bottom dock

**Status:** Accepted — implemented and witnessed (`#holo-dock`, `tools/holo-dock-witness.mjs`,
required). Builds on ADR-0029 (adopt OSS desktop standards as κ-objects, never run a foreign
runtime), ADR-0030 (Holo UI — one look & feel over HoloTheme · HoloPlatform · HoloZones), ADR-0057
(the readability floor), and the golden-ratio token system (`holo-phi.css`). Adopts two external
component specs the same way Holo Files / Wallet / Workspace reproduce upstream UX: as content, not
as a running foreign binary.

**Context.** Hologram OS2's desktop shell (`os/usr/share/frame/home.html`) opened every holospace
into one full-viewport frame (`#holoframe`) reached through a search bar and a table — there was no
persistent launcher. Every desktop OS has the familiar bottom bar (Windows taskbar, macOS dock) as
first-class chrome. The brief: a lean, beautiful, persistent bottom dock that feels native on the
host OS (Windows · macOS · Android · iOS · Linux), is translucent, golden-ratio-proportioned, makes
pin/rearrange/unpin/delete effortless, links to the canonical Holo UI/UX parameters, and — crucially
— is **built from the supplied component libraries rather than hand-invented**, with every part a
substrate-native object editable in the IDE like any other.

The supplied libraries are [zebar](https://github.com/glzr-io/zebar) (a Rust/Tauri desktop-widget
bar) and [TranslucentTB](https://github.com/TranslucentTB/TranslucentTB) (a C++/Win32 taskbar
translucency tool). Neither can run in the browser substrate, and ADR-0029 forbids running a foreign
runtime regardless. So "adhere to the specs / avoid handwriting new code" is honored the only way the
substrate allows: **adopt their contracts as byte-pinned, content-addressed κ-objects and render
natively over them.**

**Decision.**

1. **Adopt, don't run.** Two vendored κ-objects under `os/usr/lib/holo/`:
   `holo-zpack-schema.json` (zebar's widget-pack schema, verbatim) and `holo-translucenttb-accents.json`
   (TranslucentTB's `TaskbarAppearance` accent model distilled). The dock's configuration is a **valid
   zebar zpack instance**, and its translucency is **TranslucentTB's accent-state model**. The witness
   proves the config validates against the adopted schema and the accent model is faithfully wired.

2. **The dock is OS chrome, its content is an editable object.** The engine
   (`os/usr/lib/holo/holo-dock.{js,css}`) mounts as a fixed overlay in `home.html`, above `#holoframe`,
   so the bar persists over whatever holospace is open — yet every file lives in the FHS graph and is
   editable in Holo Workspace. The dock's content (pinned app ids, order, glass mode, magnify, clock)
   is a separate editable κ-object, `holo-dock-config.json` (a valid zpack + a `holo` block), with a
   writable **OPFS user override** (`holo.dock.config.json`) layered on top — matching FHS (`/usr`
   read-only, `/home` writable). Pin/rearrange (drag)/unpin/delete operate on that object and persist.

3. **Translucency as tokens.** TranslucentTB's `opaque/clear/blur/acrylic` map to `--holo-glass-*`
   tokens in `holo-theme.css` (CSS `backdrop-filter` blur/saturate + tint; blur px = `blur_radius/3`,
   TranslucentTB's own divisor). A surface selects a state via `[data-glass]`. Lean device tier /
   reduced motion (HoloUX) drop live blur to opaque for performance and comfort.

4. **Native feel per host OS.** `HoloPlatform.profileFor()` stamps `data-holo-platform` (all 7 values)
   and the CSS reskins: Windows/Linux/ChromeOS → full-width edge-to-edge taskbar; macOS/iPadOS →
   centered floating **magnifying** dock (acrylic); iOS/Android → full-width dock with home-indicator
   safe-area, no hover magnification. Magnification engages only on a precise pointer at full tier.

5. **Golden ratio throughout.** Every dimension is a `holo-phi` token (tile `--holo-size-l`, icon
   `--holo-size-m`, gap `--holo-size-2xs`, magnify factor `--holo-phi`); no magic px (1px hairlines
   excepted). All text flows through the `--holo-text*` tokens, never below the ADR-0057 floor.

6. **Conformance.** `tools/holo-dock-witness.mjs` (pure-Node static analysis, in the gate LIVE set;
   row `#holo-dock`, required) asserts: the five κ-objects exist; the config validates against the
   adopted zpack schema; the schema is structurally faithful + pinned; the glass tokens are wired; φ
   sizing with no raw px; all seven OS variants present and stamped; the dock is mounted in the shell;
   no sub-16px font; the accent model is faithfully adopted.

**Consequences.** A first launcher exists, and a discoverable "show desktop" affordance (the dock home
button reveals the Platform Manager — previously only reachable via Esc / `?manage`). The dock is
serverless, content-addressed, OS-native-feeling, and fully customizable as separate objects. Editing
`home.html` + `holo-theme.css` drifts their `os-closure.json` pins, so `tools/reseal-drift.mjs` reseals
them (the content-verify SW 409s a stale pin otherwise); the five new `_shared/holo-dock*` files are
added to the closure so they are content-verified like every other engine. Follow-ups (out of scope):
live zebar providers beyond a clock (cpu/battery/media/systray), and mounting the dock inside the bare
`holospace.html` projection (the `home.html` overlay already covers the persistent case).
