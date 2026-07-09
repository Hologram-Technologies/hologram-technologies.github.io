// holo-autoprofile.js — map the user's native hardware to a quality config (P5:
// "most use of native specs", zero knobs).
//
// "Serverless, on the user's own silicon" means the experience must scale itself from a
// fanless laptop iGPU to a high-end desktop dGPU with no slider the user ever touches
// (if they touch one, P5 failed). This is a PURE function from probed capabilities to a
// config — deterministic, testable, and MONOTONIC: strictly better hardware never yields
// a worse setting on any axis. The caller probes once at boot:
//   • gpu       — adapter.requestAdapterInfo / a WebGPU micro-bench → "low"|"mid"|"high"
//   • maxTex    — adapter.limits.maxTextureDimension2D  (the 8K cap is real silicon)
//   • refreshHz — estimated from rAF timestamps (the panel's true refresh)
//   • cores     — navigator.hardwareConcurrency
//   • memory64  — WebAssembly.Memory index:"i64" support
//
// Output is consumed by the render worker (output res, SR model, framegen factor,
// present rate) and the scheduler (worker count). Honest by construction: it never
// promises a present rate above the panel, nor a resolution above the GPU's max texture.

const TIER = { low: 0, mid: 1, high: 2 };

export function autoProfile(caps = {}) {
  const gpu = caps.gpu in TIER ? caps.gpu : "low";
  const t = TIER[gpu];
  const maxTex = Math.max(2048, caps.maxTextureDimension2D || 4096);
  const refreshHz = Math.max(30, Math.min(1000, Math.round(caps.refreshHz || 60)));
  const cores = Math.max(2, caps.cores || 4);
  const memory64 = !!caps.memory64;

  // Output resolution: aim higher with GPU tier, but NEVER above the GPU's max texture
  // dim. (longest-edge target; the caller fits it to the panel's aspect.)
  const resTarget = [2560, 5120, 8192][t];                 // low→1440p-class, mid→5K, high→8K
  const outputLongEdge = Math.min(resTarget, maxTex);

  // Super-res model: cheap→sharp→neural as the GPU can afford it.
  const srModel = ["catmull", "cas", "neural"][t];          // holo-render.js → holo-render-sr.js → learned slot

  // Frame-generation factor: how many present frames per sim frame, capped so we never
  // claim to present faster than the panel (present rate ≤ refresh).
  const simHz = 60;
  const maxFactorByPanel = Math.max(1, Math.floor(refreshHz / simHz));
  const factorByGpu = [1, 2, 4][t];                         // low=none, mid=2×, high=4×
  const framegenFactor = Math.max(1, Math.min(factorByGpu, maxFactorByPanel));
  const presentHz = Math.min(refreshHz, simHz * framegenFactor);

  // Reprojection: always on above the floor — it is the biggest felt-latency win and is
  // nearly free. Off only on the weakest tier to protect frame budget.
  const reproject = t >= 1 || refreshHz >= 90;

  // Workers: one for sim, one for present, the rest free for SR/interp tiling. Leave a
  // core for the main thread + audio worklet.
  const renderWorkers = Math.max(1, Math.min(t + 1, cores - 3));

  return {
    gpu, outputLongEdge, srModel, framegenFactor, presentHz, reproject,
    renderWorkers, memory64,
    // a human-readable one-liner for the HUD / docs
    summary: `${gpu} GPU · ${outputLongEdge}px · ${srModel} SR · ${framegenFactor}× framegen → ${presentHz}Hz present · reproject ${reproject ? "on" : "off"} · ${renderWorkers} render worker(s)`,
  };
}

// Convenience: probe what we can from a live browser (the caller passes the WebGPU
// adapter; refreshHz is measured separately from rAF deltas).
export async function probeCaps(adapter, { refreshHz = 60 } = {}) {
  const limits = adapter ? adapter.limits : {};
  let gpu = "low";
  if (adapter) {
    const md = limits.maxTextureDimension2D || 4096;
    const wg = limits.maxComputeWorkgroupStorageSize || 0;
    gpu = md >= 16384 && wg >= 32768 ? "high" : md >= 8192 ? "mid" : "low";
  }
  let memory64 = false;
  try { new WebAssembly.Memory({ initial: 1, maximum: 1, index: "i64" }); memory64 = true; } catch {}
  return {
    gpu,
    maxTextureDimension2D: limits.maxTextureDimension2D || 4096,
    refreshHz,
    cores: (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4,
    memory64,
  };
}
