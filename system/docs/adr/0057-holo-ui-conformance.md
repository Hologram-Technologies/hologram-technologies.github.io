# ADR-0057: Holo UI — minimum text size + strict canonical conformance

**Status:** Accepted — implemented and witnessed (`#holo-ui-conformance`,
`tools/holo-ui-conformance-witness.mjs`, required). Extends ADR-0030 (Holo UI, the single UI
subsystem) and ADR-0023 (the `--holo-*` token contract). Holo UX (device-tier propagation,
`holo-ux.js`) is intentionally out of scope — same pattern, a separate change.

**Context.** Holo UI is already the single canonical source of UI parameters: one engine
(`holo-theme.js`, state `holo.theme.v1`) drives the `--holo-*` design tokens, and propagates them
to every nested holospace over the `postMessage` tree. But there was no *absolute floor* on text
size. `--holo-font-scale` is multiplicative; the type ramp's small end (`--holo-text-sm` ≈ 13px)
and any app that hardcodes small px could still render text too small to read — the readability
problem the brief names directly. Two things were missing: a canonical **minimum text size**
parameter, and an enforcement that nobody silently bypasses it.

**Decision.**

1. **`--holo-font-min` is a first-class accessibility lever** (default **16px**; `0` = off),
   alongside `fontScale`/`density` in the engine. `apply()` sets it as an inline custom property on
   `:root` with the same priority as font-scale, so it rides every surface — even apps that own
   their theme — and `enforce` makes it `!important`. Surfaced in the one "Holo UI" settings panel
   as a "Minimum text size" segmented control (Off / 14 / 16 / 18 / 20) and carried in the
   content-addressed Holo UI profile (`org.hologram.ui`), so a shared look round-trips the floor.

2. **The floor lives in the token layer, expressed with `max()`** so it cannot be bypassed by the
   cascade: `holo-theme.css` floors the root font-size
   (`max(var(--holo-font-min,16px), calc(100% * var(--holo-font-scale,1)))`), and `holo-mobile.css`
   floors the sub-1rem ramp (`--holo-text-sm`, `--holo-text`) and form controls. `-lg`/`-xl` already
   exceed the floor, so the hierarchy above it is preserved. Any surface that renders text through
   the tokens (the bulk of the OS) honors the floor automatically; "Off" restores the raw ramp.

3. **Strict conformance is a gate witness, not a hope.** `holo-ui-conformance-witness.mjs` proves
   (a) the token layer actually clamps up to the floor, and (b) no first-party UI
   (`os/usr/lib/holo/*.{css,js}` + `os/usr/share/frame/*.html`) hardcodes a sub-floor px
   `font-size` that would bypass it. First-party offenders were routed to `--holo-text-sm`; the only
   exemptions are **verbatim upstream reproductions** (the SDDM greeter, the Plymouth splash), whose
   type is pinned to spec and must not be re-typed. The witness is `required` in the gate.

**Consequences.**

- Default-on at 16px lifts `--holo-text-sm` to the floor across the OS — that is the point.
- The floor reaches every app through the tokens + `postMessage` propagation, and is now also
  **enforced** across every app: `holo-app-ui-conformance-witness.mjs` (row `#app-ui-conformance`,
  required) is a **ratchet** over the served app repo — it fails if any app's authored `index.html`
  gains a sub-floor px font declaration (`font-size` or `font:` shorthand) beyond its committed
  baseline (`holo-app-ui-baseline.json`, 461 across 28 apps). No native application can introduce new
  too-small text; the baseline is the visible burn-down, and burning it down (routing px →
  `--holo-text-sm` via `burndown-app-fontmin.mjs`) only ever passes. **The whole corpus is now burned
  down to 0** — all 461 declarations across 32 apps routed to the token, a diverse sample (incl.
  Monaco/webamp-vendored apps) rendered-verified with no breakage.
- **Every app is wired to upstream Holo UI** — `holo-app-wired-witness.mjs` (row `#app-ui-wired`,
  required) proves each served app loads the Holo UI ENGINE (`holo-theme.js`, directly or via the
  `holo-ui-kernel.js`/`holo-ui.js` façades), so the shell's canonical parameters actually reach +
  persist on every instance (forwarder stubs like `search`→`search.html` are checked at their target).
  This is what makes "the parameters are defined in the shell and persist for every app instance"
  enforceable rather than aspirational: an app that doesn't load the engine is an island, and the gate
  refuses it. `atlas96` was the one island; wired it.
- Editing the canonical `_shared` libs drifts their κ; an app pins the lib by content address, so the
  content-verify SW refuses the new bytes until the app refs are re-pinned. `reseal-drift.mjs`
  (os-closure ← current bytes) + `repin-shared-refs.mjs` (app refs ← current κ, driven by the
  `data-holo-shared` hints) is the fix — run together (both derive from the same bytes). This is no
  longer deferrable once os-closure is resealed: a reseal without a re-pin 404s every app's engine.
  The remaining deferred step is integrity-only: relocking each app's `holospace.lock.json` + the
  os-closure-root → catalog → atlas regen (heavy, cross-repo, NOT gate-blocking).
- Both the `font-size` property AND the `font:` shorthand's size are enforced (the size is the only
  px before the family / `/line-height`). Relative units (em/rem/%) that *compute* below the floor are
  inherently outside a static lint (the computed px depends on the full cascade); they are floored
  where they route through the tokens and fixed case-by-case otherwise (e.g. notepad's `.subl`).
- **Conformance extends from text size to COLOR + SHAPE, but the mechanism differs because the
  parameters differ.** Text size has one correct answer (the 16px floor), so it is force-conformed.
  Color is IDENTITY — apps and the faithful reproductions (MetaMask wallet, VS Code workspace, …)
  legitimately keep their own colors under the adopt-vs-own model (ADR-0023); force-rewriting every
  hardcoded hex would flatten them and break the reproductions in light mode. So `#app-ui-tokens`
  (`holo-app-token-witness.mjs`, required) is a **no-regression ratchet**: an app may not add a
  hardcoded hex color or px `border-radius` beyond its committed baseline
  (`holo-app-token-baseline.json` — 1769 across 32 apps), so the corpus only ever gets MORE
  token-conformant and new code is pushed to the tokens, without a destructive flag-day. Radius is the
  exception that IS safely force-conformable: the 150 exact-match radii (8/12/16px) were adopted as
  `--holo-radius-sm/-/-lg` pixel-for-pixel (`burndown-app-radius.mjs`, same-px fallback). The deeper
  burn-down of hardcoded colors is a deliberate per-surface choice (the OS chrome first, where adopting
  the palette is the goal), not a corpus-wide rewrite.
- **The OS-chrome SHELL FRAMES adopt the palette (the deliberate burn-down, started).** Forcing color
  conformance IS right for the canonical shell (it should follow light/dark, not hardcode dark).
  `home.html` was reskinned — its GitHub-dark hardcoded palette (74 hex) routed to the `--holo-*`
  tokens via a local-alias `:root` (each holo token's value as the fallback, so dark is ~identical),
  and `color-scheme: dark` → `light dark`. `find.html` referenced NON-EXISTENT tokens (`--holo-fg`,
  `--holo-fg-dim`, `--holo-font`) that silently fell back and never followed the palette — fixed to
  the real names (`--holo-ink`, `--holo-ink-dim`, `--holo-font-sans`). Both verified in Chromium:
  `home.html` flips dark↔light with correct contrast both ways (dark bg rgb(11,13,16) / light bg
  rgb(245,247,250)); the boot-intro + the transient brand-purple `holospace.html` loader are left as
  intentional aesthetic chrome (like the SDDM/Plymouth exemption). The injected panel libs
  (privacy/terms/manage/own-ui/scaffold/…) are the continuation — they need per-panel role-aware
  mapping (the same hex serves border + surface) + triggered dual-mode render verification.
