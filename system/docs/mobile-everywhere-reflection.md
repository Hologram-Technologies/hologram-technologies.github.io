# Every holo app — mobile-fast, O(1), magical — Phase 0 assessment

Verified 2026-06-22 against the live tree. The headline: **the superpowers all exist, but they are siloed —
and the one frame every app passes through applies none of them.**

## The leverage point — the projection injects nothing
`holospace.html` is the single door: every standalone app now opens through it (default), mounted in a
sandboxed iframe. Grep for `holo-gpu | holo-screen-gpu | prefetch | warm | preload | holo-fidelity` in it →
**zero hits**. So the mounted app inherits: no fidelity policy, no GPU present, no prefetch, no warm-mount.
**This is the highest-leverage change** — wire the baseline here once, all ~50 apps inherit it.

## Lever-by-lever — exists vs wired

| Lever | Exists? | Wired where | Gap |
|---|---|---|---|
| **WebGPU Lanczos present** (`holo-gpu.js`) | Yes — real 16-tap Lanczos-2 super-res | **VIDEO only** ("native WebGPU present layer for video"; 4K/8K reconstruction of `<video>`) | NOT a generic per-app surface present. "render lean → reconstruct to maxDim" is real for video, **aspirational for app DOM/canvas**. |
| **Adaptive fidelity** (`holo-fidelity.mjs`) | Yes — tiers, renderScale, effect budgets, CSS vars, `data-holo-fidelity` | **Only `shell.html` + `homepage.html`** read it | The projection + every mounted app do NOT read it → effects/anim aren't budgeted on mobile/battery. |
| **Device-tier** (`holo-device-tier.mjs`) | Yes — hardware probe | **Splash only** (`holo-loader.mjs`) | Not used by the projection or apps. |
| **O(1) κ-cache** (`holo-fhs-sw.js`) | Yes — κ-keyed CacheStorage, 2nd open network-free, deduped, L5-verified | Delivery path | **Cache-on-demand only** — no *predictive* prefetch (grep: 0 prefetch/precache/predict). A κ warms only after it's first fetched. |
| **Warm-mount** | Yes | **Play map only** (`holo-play-ui`: "mounts once, stays warm") | No per-app warm-mount; a honeycomb tap opens the app **cold** through the projection. |
| **The magical open** (κ-Open splash) | Yes — done, sealed, mobile-tuned this session | `holospace.html` | The one piece already wired into the projection. ✓ |

## Where mobile latency actually goes (reasoned; live per-app phone profiling still TODO)
- **Cold open**: tap → projection boot → resolve κ → Terms → mount iframe → app's own boot. No warm-mount, no
  neighbor prefetch → every open pays full cost. The κ-cache helps the **2nd** open, nothing the 1st.
- **Battery-saver** (hit live this session, 18–23%): forces `prefers-reduced-motion` + throttles rAF. Nothing
  reads fidelity at the app layer, so heavy blend-modes / drift / big blurred shadows keep running ungated →
  jank (we just hand-fixed this for the splash spinner; every app needs the same discipline, automatically).
- **Sharpness vs cost**: no generic lean-render+Lanczos-present for apps → an app either renders full-DPR
  (costly on a mobile GPU) or not (soft). The video pipeline solves this for video; canvas/DOM apps don't get it.

## Per-app reality (~50)
- **GPU-heavy** (need per-app render-scale + effect budgets): Holo Spaces (WebGPU honeycomb), Holo 3D, Play
  (the map), cosmos, Holo Amp (audio viz).
- **Video/media** (already have `holo-gpu` video present — verify it's mobile-tuned + fidelity-gated): Holo
  Tube, Hologram Meet, Holo Jupyter.
- **DOM-heavy** (inherit the baseline cheaply; just need fidelity CSS vars + touch + dvh + prefetch/warm):
  Notepad/Notepad++, Docs, Scan, Atlas, Control, Forge, Code Desktop, Guide, On Liberty, Hub, miners.
Most apps are DOM → the baseline gets them most of the way; the GPU/video handful need targeted passes.

## The single highest-leverage change
**Make the projection the place the stack's superpowers are applied.** Inject, in `holospace.html`, for every
mounted app: (1) `holo-fidelity` policy + `data-holo-fidelity` + CSS vars piped into the frame; (2) device-tier;
(3) predictive **prefetch-by-κ** of likely-next apps (honeycomb neighbors / recents) into the κ-cache; (4)
**warm-mount** so a tap paints instantly; (5) the generic **WebGPU lean-render + Lanczos present** for surfaces
that opt in (start with video — already built — then canvas). Everything degrades by tier/battery; progress
indicators keep moving (the reduced-motion exception). The splash already lives here, so the door is the design.

## Phase 1 sequence (proposed, pending go-ahead)
1. **Fidelity into the projection** (biggest win, lowest risk): read `holo-fidelity`, set `data-holo-fidelity`
   + CSS vars on the host AND pass them into the mounted frame; effects/anim gate on the budget. Auto-fixes the
   battery-saver jank for ALL apps, no per-app edits.
2. **O(1) instant-open**: predictive prefetch-by-κ (neighbors/recents) + per-app warm-mount on the projection.
3. **WebGPU present, generalized**: lean-render + Lanczos present, opt-in per surface (video first).
4. **Per-app passes**: the GPU-heavy handful.
Measure on a real phone (incl. battery-saver) at each step: TTI, input delay, sustained fps, 2nd-open network-free.

## Honest gaps in THIS assessment
- I have **not** yet run live per-app profiling on the phone (TTI/FID/fps numbers). The latency analysis above
  is reasoned from the architecture + what we observed (battery-saver jank). Real numbers need the tunnel +
  instrumented runs per app — that's the first thing Phase 1 should baseline.
