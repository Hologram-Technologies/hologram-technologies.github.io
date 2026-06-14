# ADR-0080: Holo Cosmos — real-time, navigable, infinitely-detailed environments streamed as κ-objects

**Status:** Proposed (architecture; not yet implemented). Captures the decision *before* engine code so
the build is deliberate. Supersedes nothing; extends the wallpaper work (the living-wallpaper engine in
`shell.html`) into a navigable render substrate. Witness + conformance row land per stage (see *Rollout*).

**Context.** The product objective is a *fully immersive experience*: real-time-rendered, infinitely
detailed visual environments, navigable natively inside **every** holospace — "a cockpit of a spaceship
exploring infinite space" — enabled by streaming κ-addressed objects. The proximate idea on the table
was **AI super-resolution** for "genuine added detail." Investigation found:

- **Real AI SR already exists in-tree.** `tools/develop-sr.mjs --method realesrgan` runs **Real-ESRGAN
  x4 (GAN, ONNX)** from `_nsr/resrgan.onnx` (κ-pinned), tiled to any size, sealing a **PROV-O receipt**
  `source κ → [transform] → output κ` with the model itself content-addressed. (Only `onnxruntime` is
  uninstalled; Python 3.11 + the 67 MB model are present.)
- **The GPU + AI + streaming spine already exists.** `holo-gpu.js` is a zero-copy WebGPU present layer
  (`texture_external`, a κ-labelled 3-D LUT, one-pass bloom/grain). `holo-qvac` (ADR-0067) is an
  in-browser AI engine over WASM+WebGPU with sealed receipts. `holo-sources.mjs`/`holo-resolver.mjs`
  (ADR-026) are the verified κ source chain (cache → peers → origin, **every byte re-derived**, L5).
  Three.js is vendored.

**The correction this ADR records:** *AI super-resolution is not the path to the objective.* SR invents
plausible detail for a **fixed 2-D image**; it cannot produce infinite navigable real-time worlds.
Those are a different problem class. Conflating them would point the build down the wrong road. SR is
**one tile** — offline asset detail, and a real-time render-resolution amplifier — not the engine.

**Decision.** Build **Holo Cosmos**, a layered render substrate where a *universe is a κ* and detail is
*generated and streamed on demand*, never pre-stored whole. Each layer is content-addressed, re-derivable
(L1 content-not-location, L5 verify-by-re-derivation) and maps to a part the OS already has.

- **L0 — Substrate (have it).** Scenes, chunks and assets are κ-objects pulled through the existing
  source chain (`holo-sources`/`holo-resolver`): fastest source wins, every byte re-derived before
  acceptance. This *is* "streaming κ-addressed objects" — gateway-free, peer-fed, verified (ADR-026/027).
- **L1 — Procedural infinite detail (build).** A WebGPU SDF-raymarch / fractal-noise field driven by a
  tiny κ **seed** (~32 bytes) expands deterministically to unbounded detail. **Same seed κ → the same
  universe on every device**, re-derivable (L5). This is the only honest source of "infinite": detail is
  *computed*, not stored. The seed — and any hand-authored deltas over it — are κ-objects.
- **L2 — Photoreal captured places (build).** A WebGPU **3-D Gaussian-Splatting / NeRF** renderer for
  real locations you fly into. Splat scenes are chunked and LOD-streamed by κ (L0). AI (L4) densifies
  sparse captures **offline → κ**.
- **L3 — Real-time present (extend `holo-gpu.js`).** The zero-copy WebGPU compositor graduates from
  "present a video frame" to "present the rendered scene," keeping the holographic post (bloom, grain,
  tone-LUT). The living-wallpaper engine in `shell.html` is its Canvas2D rehearsal and the first scene.
- **L4 — Neural amplification (have model + engine).** Render internal at low resolution; **upscale
  per-frame** (DLSS-style temporal/spatial) via `holo-qvac`/ONNX on WebGPU. **This is AI SR in its
  correct place** — a frame amplifier, not a wallpaper sharpener. The same `_nsr` model also serves the
  offline asset path (still images, splat densification) with the existing `develop-sr` receipt shape.
- **L5 — LOD streaming (build).** A quadtree/clipmap that requests only the detail chunks visible from
  the current viewpoint, by κ, through L0 — so "infinite" stays O(view), not O(world).
- **L6 — Navigate everywhere (build).** A `holo-space3d` module (sibling to `holo-gfx`/`holo-gpu`,
  `window.HoloSpace`) that any holospace mounts: a camera = the *cockpit*, unified input
  (pointer · device-tilt · gamepad · WASD), and the scene addressed by one κ. The wallpaper is the
  trivial scene (2.5-D parallax); the same component scales to full 3-D in every holospace.

**The κ-seed principle.** Procedural generation + content addressing are a natural pair: a finite seed
re-derives infinite, identical detail anywhere, with zero storage and L5 verification for free. A whole
explorable cosmos ships as one shareable `holo://κ`. This is the architectural heart — not SR.

**Conformance.** Per ADR-024, each shipped stage adds a witness and a `conformance.jsonld` row
(`#holo-cosmos` / `#holo-space3d`): the seed re-derives its universe deterministically (L5), the splat/
asset chunks re-derive to their κ, the neural transform seals a PROV-O receipt (as `develop-sr` already
does), and the renderer degrades cleanly to Canvas2D / static image where WebGPU is absent (as
`holo-gpu`/the wallpaper already do).

**Consequences.**
- *Positive.* Reuses the substrate, GPU layer, AI engine and SR model already in the tree — not from
  scratch. Every layer ships independent value (the wallpaper already proves L3). "Infinite" is honest
  (computed from a seed), shareable (one κ) and verifiable (L5). AI SR keeps a real role, correctly scoped.
- *Negative / honest limits.* L1–L2 and L4–L6 are progressively heavy R&D; the full "infinite photoreal,
  navigable everywhere" is a multi-month engine, not a feature. WebGPU is required for the high tiers
  (degrades, but the wow needs it). Real-ESRGAN is CPU-slow offline and **hallucinates** detail (plausible,
  not true) — fine for assets, never to be sold as ground truth. Splat/NeRF assets are large; LOD streaming
  (L5) is load-bearing, not optional.
- *Neutral.* Three.js is vendored but a bespoke WebGPU path (extending `holo-gpu`) is likely preferred for
  the present/raymarch layers; Three is the fallback/splat-viewer option.

**Rollout (each stage ships + witnesses on its own).**
1. **AI-SR the wallpaper (hours).** Install `onnxruntime`; run `_nsr` Real-ESRGAN on the master, κ-pin
   with a PROV-O receipt, swap in. Genuine added detail; proves the L4 offline path end-to-end.
2. **Cockpit 2.5-D (days).** Promote the wallpaper onto `holo-gpu` (WebGPU) + a depth map → navigable
   parallax: "out the cockpit window."
3. **κ-seed raymarched space (weeks).** WebGPU SDF/noise field from a seed κ → genuine infinite navigable
   space (L1) — the cockpit core.
4. **κ-LOD streaming (L5)** of finer chunks as you move.
5. **Gaussian-splat destinations (L2)** + the per-frame neural upscaler (L4).
6. **`holo-space3d` (L6)** — factor the camera/input/scene-κ surface so every holospace hosts a
   navigable scene.

**References.** ADR-026 (sovereign κ delivery), ADR-027 (offline/mesh), ADR-0067 (Holo QVAC, in-browser
AI), ADR-0061 (Holo Desk / wallpaper surface). Modules: `holo-gpu.js`, `holo-gfx.js`, `holo-qvac.*`,
`holo-sources.mjs`, `holo-resolver.mjs`, `tools/develop-sr.mjs`, `_nsr/`. Laws: L1, L2, L3, L5.
