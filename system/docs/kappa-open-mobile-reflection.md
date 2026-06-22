# κ-Open welcome — mobile reflection (Phase 0)

Measured 2026-06-22 on the live splash (`holospace.html #holo-loader`). Verdict per seam:

## 1. Wordmark overflow — **BREAKS** (the one real fault)
`#holo-loader-word` = `HOLOGRAM OS`, `clamp(2.4rem, 5.6vw, 4rem)`, `letter-spacing .2em`, `white-space nowrap`.
The clamp **floor (2.4rem ≈ 38px) never shrinks below 38px**, so the word is a fixed ~346px wide on every
phone. Measured (canvas `measureText` + the letter-spacing/indent it ignores) vs the `vw − 64px` content box:

| viewport | word px | container px | overflow |
|---|---|---|---|
| 320 | 346 | 256 | **+90** |
| 360 | 346 | 296 | **+50** |
| 390 | 346 | 326 | **+20** |
| 430 | 346 | 366 | fits (−20) |

So it clips/touches edges on every phone except the 430 Pro Max. **Fix in Phase 1.**

## 2. Background framing — **fine**
`splash.jpg` (8K) and `splash-fallback.jpg` (2560) are the **same** Earth-sunrise, both 1.60:1 (confirmed —
the fallback is NOT the old 16:9 galaxy; the device-picker serves the same image, just lower-res on mobile).
The composition is **vertically stacked** (stars top · sun-flare ~44% · Earth limb bottom), so `cover` on a
tall portrait phone crops the **sides** and keeps the vertical axis → sun + Earth survive centered. The bloom
`#holo-loader-bloom` / GPU `#holo-loader-fx` at `50% 44%` still aligns (cover preserves vertical mapping).
Optional: a tiny portrait `background-position` nudge, but it already reads well. No real break.

## 3. Device image / decode latency — **fine**
Inline picker serves `splash-fallback.jpg` (2560, 0.36MB) when `max(screen)·dpr ≤ 2600` (all phones), `splash.jpg`
(8K) only on 4K+/retina. Mobile gets the fast-decoding 2.5K rendition + `decode()` paint. Good.

## 4. Viewport units & safe area — **fine, harden lightly**
Veil `#holo-loader` and mounted `#frame` are `position: fixed; inset: 0` → fill the viewport; no `100vh`
anywhere, so no URL-bar jump. Content `#holo-loader-center` is **centered**, far from notch/home-bar, so
safe-area is non-critical — but add `env(safe-area-inset-*)` to its padding as cheap insurance.

## 5. Perf — **fine**
2.5K image on mobile; `holoDrift`/`holoBreath`/grain/`saturate-contrast` are cheap; the GPU bloom is gated by
the device-tier / reduced-motion (`holo-splash-gpu` honours `reduceFx`). No change.

## Phase 1 plan (CSS-only, desktop untouched)
- **Responsive wordmark** (the fix): `@media (max-width: 460px)` → `--logo: clamp(1.5rem, 7.6vw, 2.5rem)` +
  `letter-spacing/text-indent .12em`. Because `--spin` and `--gap` derive from `--logo ÷ φ`, the whole golden
  type scale shrinks together — **φ preserved**. Recomputed widths fit with ≥50px margin at 320–460.
- **Safe-area**: `#holo-loader-center` padding → `max(2rem, env(safe-area-inset-*))`.
- **Golden ratio throughout**: `--phi` stays the single governing constant (type scale + gap + the scrim's
  38.2%/61.8% stops); composition stays optically centered (scrim handles the bright-sun legibility).
- Preserve everything else (reveal-together, 5s-from-visible, decode, DNA spinner, fallback, fail-closed Terms).
Then reseal + `reseal --check`.
