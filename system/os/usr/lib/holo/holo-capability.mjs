// holo-capability.mjs — hardware-aware resolution for the Holo UX Profile (ADR-028).
// At boot a probe reads the device's capabilities and the Profile resolves to a TIER
// (lean | standard | rich); the resolution is a PURE, deterministic function, so the
// derived profile is itself content-addressable (base-κ + probe → derived-κ) — the
// optimization is reproducible and verifiable, never opaque. Pure + isomorphic: the tier
// math runs anywhere; only probe() touches the browser, and it degrades honestly headless.

export const TIERS = ["lean", "standard", "rich"];

// resolveTier(probe) → a tier. Conservative: unknown (null) capabilities never fabricate a
// higher tier — they fall to "standard". Only explicit low signals drop to "lean"; only
// explicit high signals across memory + CPU + GPU reach "rich".
export function resolveTier(p = {}) {
  const lean = p.saveData === true
    || (p.deviceMemory != null && p.deviceMemory <= 2)
    || (p.cpu != null && p.cpu <= 2)
    || ["slow-2g", "2g", "3g"].includes(p.effectiveType);
  if (lean) return "lean";
  const rich = p.deviceMemory != null && p.deviceMemory >= 8
    && p.cpu != null && p.cpu >= 8
    && p.gpu === "webgpu";
  if (rich) return "rich";
  return "standard";
}

// tierSettings(tier) → the resolved UX knobs. maxDpr respects holo-gfx's 3× cap; motion
// maps to prefers-reduced-motion; density maps to the holo-theme presets (ADR-023).
export function tierSettings(tier) {
  switch (tier) {
    case "lean": return { density: "standard", motion: "reduced", maxDpr: 1.5, animations: false, blur: false };
    case "rich": return { density: "immersive", motion: "full", maxDpr: 3, animations: true, blur: true };
    default:     return { density: "standard", motion: "full", maxDpr: 2, animations: true, blur: true };
  }
}

// headlessProbe() — an honest, all-unknown probe (no fabricated capabilities). Used in
// Node/CI and any context without the browser APIs; it deterministically resolves "standard".
export const headlessProbe = () => ({
  deviceMemory: null, cpu: null, saveData: false, effectiveType: null, gpu: null, dpr: null, reducedMotion: false,
});

// probe() — read the live device. In the browser uses Device Memory, Network Information,
// navigator.hardwareConcurrency, the WebGPU adapter hint, DPR and prefers-reduced-motion;
// anywhere else degrades to headlessProbe() (never a false "rich").
export function probe() {
  if (typeof navigator === "undefined" || typeof globalThis.matchMedia === "undefined") return headlessProbe();
  const nav = navigator, conn = nav.connection || {};
  return {
    deviceMemory: nav.deviceMemory ?? null,
    cpu: nav.hardwareConcurrency ?? null,
    saveData: conn.saveData === true,
    effectiveType: conn.effectiveType ?? null,
    gpu: ("gpu" in nav) ? "webgpu" : (probeWebgl2() ? "webgl2" : "canvas2d"),
    dpr: globalThis.devicePixelRatio ?? null,
    reducedMotion: globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}
function probeWebgl2() {
  try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; }
}

// deriveDescriptor(baseDid, probe) → the PURE derived-profile fields (no hashing here; the
// caller seals them through the canonical envelope to mint derived-κ). Deterministic in
// (baseDid, probe), so the same device always derives the same κ.
export function deriveDescriptor(baseDid, p = {}) {
  const tier = resolveTier(p);
  const s = tierSettings(tier);
  return { tier, "hosux:capabilityTier": tier, "hosux:densityPreset": s.density, "prov:wasDerivedFrom": baseDid, settings: s };
}

if (typeof globalThis !== "undefined") globalThis.HoloCapability = { TIERS, resolveTier, tierSettings, headlessProbe, probe, deriveDescriptor };
