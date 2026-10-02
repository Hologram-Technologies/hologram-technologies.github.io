// holo-device-tier.mjs — Holo Device Tier: the ONE adaptive-quality authority for κ-Open.
//
// Probes the viewer's hardware ONCE at boot and returns a capability profile that every downstream stage
// (loader render path, DPR cap, effect gates, frame budget) reads. The rule is: detect, then deliver the
// device's CEILING — a Pro laptop on mains power gets hyper-real full-DPR WebGPU HDR; a throttled phone on
// Save-Data gets an instant, gorgeous static poster. Both feel intentional, neither is a lowest-common bar.
//
//   await HoloDeviceTier.probe()  -> Profile          (async: refines GPU adapter, refresh, battery)
//   HoloDeviceTier.get()          -> Profile | null   (sync: cached profile, or a sync best-guess)
//   HoloDeviceTier.sampleRefresh()-> Promise<number>  (Hz, from a short rAF cadence sample)
//   HoloDeviceTier.makeScaler(targetFps) -> (dtMs)=>scale   (dynamic resolution: scale the backing store)
//
// Profile shape:
//   {
//     tier: "ultra"|"high"|"balanced"|"lite",
//     renderPath: "webgpu"|"webgl2"|"static",   // which loader backend to mount
//     dprCap: number,                            // cap devicePixelRatio to this (full native up to the cap)
//     effects: { hdr, bloom, depth, spatial, particles, animate },
//     targetFps: number, frameBudgetMs: number,
//     gpu: { kind, fallback, adapter, vendor, architecture },
//     display: { dpr, w, h, hdr, p3, hz },
//     compute: { cores, memGB, saveData, effectiveType },
//     prefs: { reducedMotion, dark, highContrast },
//     power: { battery, charging, level },
//     synthetic: boolean                         // true while only the sync guess is known (pre-probe)
//   }
//
// HONEST + SAFE:
//   • NO network — every probe is local (Law: 100% serverless on the open path).
//   • Caches ONLY the capability profile to sessionStorage — never identity (identity boundary, do not widen).
//   • The GPU adapter is async; get() returns a sound SYNC guess immediately so the loader can paint NOW,
//     then probe() refines it (and re-caches) without blocking first paint.
//   • Every probe is wrapped — on any doubt we degrade DOWN a tier, never throw.

const W = window, NAV = navigator;
const CACHE_KEY = "holo.device.tier.v1";        // capability profile only — never identity

// ── tiny safe helpers ───────────────────────────────────────────────────────────────────────────
const mm = (q) => { try { return W.matchMedia && W.matchMedia(q).matches; } catch (e) { return false; } };
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

// ── synchronous probes (everything available without awaiting) ───────────────────────────────────
function prefs() {
  return {
    reducedMotion: mm("(prefers-reduced-motion: reduce)"),
    dark: mm("(prefers-color-scheme: dark)"),
    highContrast: mm("(prefers-contrast: more)"),
  };
}
function display() {
  let hz = 60;
  return {
    dpr: num(W.devicePixelRatio, 1),
    w: num(W.screen && W.screen.width, 0),
    h: num(W.screen && W.screen.height, 0),
    hdr: mm("(dynamic-range: high)"),
    p3: mm("(color-gamut: p3)"),
    hz,                                         // refined async by sampleRefresh()
  };
}
function compute() {
  const c = (NAV.connection || {});
  return {
    cores: num(NAV.hardwareConcurrency, 0),
    memGB: num(NAV.deviceMemory, 0),            // coarse (2/4/8); 0 ⇒ unknown
    saveData: !!c.saveData,
    effectiveType: c.effectiveType || "",       // "4g" | "3g" | "slow-2g" | ""
  };
}
// GPU kind WITHOUT awaiting an adapter: WebGPU presence, else WebGL2/WebGL context probe, else 2d.
function gpuSync() {
  try {
    if (NAV.gpu && typeof NAV.gpu.requestAdapter === "function") return { kind: "webgpu", fallback: false, adapter: null, vendor: "", architecture: "" };
  } catch (e) {}
  try {
    const cv = document.createElement("canvas");
    if (cv.getContext("webgl2")) return { kind: "webgl2", fallback: false, adapter: null, vendor: "", architecture: "" };
    if (cv.getContext("webgl") || cv.getContext("experimental-webgl")) return { kind: "webgl", fallback: false, adapter: null, vendor: "", architecture: "" };
  } catch (e) {}
  return { kind: "2d", fallback: false, adapter: null, vendor: "", architecture: "" };
}

// ── async refinements ────────────────────────────────────────────────────────────────────────────
// A real WebGPU adapter tells us fallback-vs-real and (where exposed) vendor/architecture. Absence of an
// adapter despite navigator.gpu ⇒ demote to webgl2.
async function gpuAsync() {
  const sync = gpuSync();
  if (sync.kind !== "webgpu") return sync;
  try {
    const adapter = await NAV.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {                              // GPU process blocked / no device → fall back honestly
      const cv = document.createElement("canvas");
      return cv.getContext("webgl2")
        ? { kind: "webgl2", fallback: false, adapter: null, vendor: "", architecture: "" }
        : { kind: "webgl", fallback: false, adapter: null, vendor: "", architecture: "" };
    }
    let info = {};
    try { info = (adapter.info) || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {}) || {}; } catch (e) {}
    return {
      kind: "webgpu",
      fallback: !!adapter.isFallbackAdapter,
      adapter,
      vendor: info.vendor || "",
      architecture: info.architecture || "",
    };
  } catch (e) {
    return { kind: "webgl2", fallback: false, adapter: null, vendor: "", architecture: "" };
  }
}
// Refresh rate from a short rAF cadence sample (cheap, ~16 frames). Defaults to 60 if it can't measure.
function sampleRefresh(frames = 16) {
  return new Promise((resolve) => {
    if (!W.requestAnimationFrame) return resolve(60);
    let n = 0, t0 = 0, last = 0, acc = 0;
    const tick = (t) => {
      if (!t0) { t0 = last = t; return W.requestAnimationFrame(tick); }
      acc += t - last; last = t;
      if (++n >= frames) {
        const hz = acc > 0 ? Math.round((n * 1000) / acc) : 60;
        // snap to the common panel rates so a noisy sample doesn't pick 58/119
        const snap = [60, 75, 90, 120, 144, 165].reduce((b, r) => Math.abs(r - hz) < Math.abs(b - hz) ? r : b, 60);
        return resolve(snap);
      }
      W.requestAnimationFrame(tick);
    };
    W.requestAnimationFrame(tick);
  });
}
async function power() {
  try {
    if (NAV.getBattery) {
      const b = await NAV.getBattery();
      return { battery: true, charging: !!b.charging, level: num(b.level, 1) };
    }
  } catch (e) {}
  return { battery: false, charging: true, level: 1 };    // no battery API ⇒ treat as mains
}

// ── classification: the ceiling, then demote for real constraints ─────────────────────────────────
function classify({ gpu, display: disp, compute: comp, prefs: pf, power: pw }) {
  // Start from the GPU ceiling.
  let tier =
    gpu.kind === "webgpu" && !gpu.fallback ? "ultra" :
    gpu.kind === "webgpu" &&  gpu.fallback ? "balanced" :  // software WebGPU ≈ a good WebGL2
    gpu.kind === "webgl2"                   ? "balanced" :
    gpu.kind === "webgl"                    ? "lite" :
                                              "lite";
  const order = ["lite", "balanced", "high", "ultra"];
  const idx = (t) => order.indexOf(t);
  const demoteTo = (t) => { if (idx(t) < idx(tier)) tier = t; };

  // Memory / cores gate the top: ultra needs real headroom; otherwise it's "high".
  if (tier === "ultra") {
    const mem = comp.memGB, cores = comp.cores;
    if ((mem && mem < 8) || (cores && cores < 8)) tier = "high";
    if ((mem && mem <= 2) || (cores && cores <= 2)) demoteTo("balanced");
  }
  // Hard constraints demote regardless of GPU.
  if (comp.saveData) demoteTo("lite");                                   // user asked to save data → static
  if (comp.effectiveType && /(^|\b)(slow-2g|2g)$/.test(comp.effectiveType)) demoteTo("lite");
  if (comp.memGB && comp.memGB <= 1) demoteTo("lite");
  if (pw.battery && !pw.charging && pw.level <= 0.2) demoteTo("balanced"); // low battery, unplugged → ease off

  return tier;
}

function effectsFor(tier, disp, pf) {
  const animate = !pf.reducedMotion;             // reduced-motion ⇒ a still frame, not a frozen animation
  return {
    ultra:    { hdr: disp.hdr, bloom: true,  depth: true,  spatial: true,  particles: 1.0, animate },
    high:     { hdr: disp.hdr, bloom: true,  depth: true,  spatial: true,  particles: 0.6, animate },
    balanced: { hdr: false,    bloom: false, depth: false, spatial: true,  particles: 0.3, animate },
    lite:     { hdr: false,    bloom: false, depth: false, spatial: false, particles: 0.0, animate: false },
  }[tier];
}
const RENDER_PATH = { ultra: "webgpu", high: "webgpu", balanced: "webgl2", lite: "static" };
const DPR_CAP     = { ultra: 3, high: 2, balanced: 1.5, lite: 1 };     // full native res up to the cap

function assemble(parts) {
  const tier = classify(parts);
  const effects = effectsFor(tier, parts.display, parts.prefs);
  const targetFps = parts.display.hz || 60;
  return {
    tier,
    // Reduced-motion keeps the SAME render path but renders a still frame (effects.animate=false below).
    renderPath: RENDER_PATH[tier],
    dprCap: DPR_CAP[tier],
    effects,
    targetFps,
    frameBudgetMs: 1000 / targetFps,
    gpu: { kind: parts.gpu.kind, fallback: parts.gpu.fallback, adapter: parts.gpu.adapter, vendor: parts.gpu.vendor, architecture: parts.gpu.architecture },
    display: parts.display,
    compute: parts.compute,
    prefs: parts.prefs,
    power: parts.power,
    synthetic: !!parts.synthetic,
  };
}

// ── cache (profile only; the live GPUDevice/adapter is never serialized) ──────────────────────────
function readCache() {
  try { const v = W.sessionStorage.getItem(CACHE_KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function writeCache(profile) {
  try {
    const { adapter, ...gpu } = profile.gpu;     // drop the live handle before serializing
    W.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...profile, gpu }));
  } catch (e) {}
}

let RESOLVED = null;     // full profile after probe()
let PROBING = null;      // in-flight probe promise (dedupe)

// Sync best-guess: everything but the async adapter/refresh/battery. Good enough to paint the loader NOW.
function guess() {
  const parts = { gpu: gpuSync(), display: display(), compute: compute(), prefs: prefs(), power: { battery: false, charging: true, level: 1 }, synthetic: true };
  return assemble(parts);
}

function get() {
  if (RESOLVED) return RESOLVED;
  const cached = readCache();
  if (cached) return cached;                     // a prior probe this session — instant
  return guess();
}

async function probe() {
  if (RESOLVED) return RESOLVED;
  if (PROBING) return PROBING;
  PROBING = (async () => {
    const [gpu, pw] = await Promise.all([gpuAsync().catch(() => gpuSync()), power().catch(() => ({ battery: false, charging: true, level: 1 }))]);
    const disp = display();
    try { disp.hz = await sampleRefresh(); } catch (e) {}
    const parts = { gpu, display: disp, compute: compute(), prefs: prefs(), power: pw, synthetic: false };
    RESOLVED = assemble(parts);
    writeCache(RESOLVED);
    return RESOLVED;
  })();
  return PROBING;
}

// Dynamic resolution: feed it the last frame's delta; it nudges a backing-store scale toward the fps target.
// Scale the canvas backing store with this — NEVER the layout (per the κ-Open plan).
function makeScaler(targetFps, { min = 0.5, max = 1, step = 0.05 } = {}) {
  const budget = 1000 / (targetFps || 60);
  let scale = max, slow = 0, fast = 0;
  return (dtMs) => {
    if (dtMs > budget * 1.25) { if (++slow >= 3) { scale = Math.max(min, +(scale - step).toFixed(3)); slow = 0; } fast = 0; }
    else if (dtMs < budget * 0.7) { if (++fast >= 12) { scale = Math.min(max, +(scale + step).toFixed(3)); fast = 0; } slow = 0; }
    return scale;
  };
}

export const HoloDeviceTier = { probe, get, guess, sampleRefresh, makeScaler, CACHE_KEY };
export { probe, get, guess, sampleRefresh, makeScaler };

// Also expose globally for classic (non-module) consumers injected into app frames (mirrors holo-sound).
try { if (!W.HoloDeviceTier) W.HoloDeviceTier = HoloDeviceTier; } catch (e) {}

export default HoloDeviceTier;
