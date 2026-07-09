// holo-fidelity-stream.mjs — ADAPTIVE QUALITY, ANY BROWSER. The thin binder that maps the existing
// holo-fidelity policy (tier · renderScale · effects · targetFps · gpu — already witnessed) onto the
// STREAMING knobs: the scheduler's frame budget, the transform substrate (WebGPU vs CPU/WASM), which
// quality passes run, and κ-prefetch aggressiveness. The point: the SAME κ stream (same input content κ)
// reconstructs at DIFFERENT quality per device — full on a workstation, lean on a weak phone — while the
// frame rate is HELD, because per-region work scales with renderScale² so a weak tier simply does less and
// still fits its budget. Quality degrades; the experience does not. Pure (node-testable); no DOM. The
// `qualityOp` makes a region's OUTPUT κ depend on the tier, while its INPUT content κ stays identical — so
// one stream serves every device, each reconstructing its own view (the display twist on "only you travels").

import { kappaOf } from "./holo-kappa-stream.mjs";

// streamConfig(f) — fidelity policy → streaming knobs.
export function streamConfig(f) {
  f = f || {};
  const e = f.effects || {};
  const targetFps = f.targetFps || 60;
  return {
    tier: f.tier,
    targetFps,
    budgetMs: +(1000 / targetFps).toFixed(2),     // → the scheduler's per-tick budget
    renderScale: f.renderScale || 1,              // → internal resolution (work ∝ renderScale²)
    useGpu: !!f.gpu,                               // → WebGPU transform driver vs CPU/WASM
    motion: f.motion || "full",
    prefetch: f.prefetch || "lazy",               // → κ-prefetch aggressiveness
    effects: {                                    // → which quality passes the transform runs
      bloom: !!e.bloom,
      grain: !!e.grain,
      blur: e.blur == null ? 1 : e.blur,
      parallax: e.parallax == null ? 1 : e.parallax,
    },
  };
}

// qualityOp(baseOpκ, config) — derive the tier-specific transform op κ. Same content, different op ⇒ the
// rendered output is content-addressed PER QUALITY, so caches never confuse a lean frame for a full one,
// and the input content κ (the stream) is untouched.
export async function qualityOp(baseOpKappa, config) {
  const desc = {
    base: String(baseOpKappa),
    s: config.renderScale,
    gpu: !!config.useGpu,
    fx: { bloom: !!config.effects.bloom, blur: config.effects.blur, grain: !!config.effects.grain, parallax: config.effects.parallax },
  };
  return kappaOf(new TextEncoder().encode(JSON.stringify(desc)));
}

// adaptiveCost(config, base) — model the per-region cost: ∝ renderScale² × (1 + enabled effect passes).
// A weak tier (smaller scale, fewer effects) costs less, which is HOW it holds its frame budget.
export function adaptiveCost(config, base = 1) {
  const e = config.effects;
  const fx = (e.bloom ? 1 : 0) + (e.grain ? 1 : 0) + (e.parallax > 0 ? 1 : 0) + (e.blur > 0 ? 1 : 0);
  return base * config.renderScale * config.renderScale * (1 + 0.2 * fx);
}

export default { streamConfig, qualityOp, adaptiveCost };
