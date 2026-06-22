// holo-device-tier-witness.mjs — witness for usr/lib/holo/holo-device-tier.mjs (κ-Open Phase 1).
//
// The module reads browser globals (window/navigator/document/matchMedia/requestAnimationFrame). We install
// MUTABLE mocks on globalThis ONCE, import the module once, then drive scenarios by mutating the mock state —
// guess()/probe() read the globals live, so each scenario is a fresh classification. No network, no DOM.
//
//   node system/tools/holo-device-tier-witness.mjs    → prints PASS/FAIL, exits 0 (all pass) / 1 (any fail).

// ── mutable mock state ────────────────────────────────────────────────────────────────────────────
const state = {
  media: {},                 // query → matches
  gl: {},                    // "webgl2"|"webgl" → present
  raf: { dt: 1000 / 120 },   // synthetic frame delta for sampleRefresh
};

globalThis.window = globalThis;
globalThis.screen = { width: 2560, height: 1440 };
globalThis.devicePixelRatio = 2;
globalThis.matchMedia = (q) => ({ matches: !!state.media[q] });
globalThis.requestAnimationFrame = (cb) => { let t = (globalThis.__t = (globalThis.__t || 0) + state.raf.dt); return setTimeout(() => cb(t), 0); };
globalThis.document = { createElement: () => ({ getContext: (type) => (state.gl[type] ? {} : null) }) };
globalThis.sessionStorage = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })();
// navigator is a read-only built-in in Node 22 — redefine it as a mutable mock.
Object.defineProperty(globalThis, "navigator", { value: { hardwareConcurrency: 16, deviceMemory: 16, connection: { saveData: false, effectiveType: "4g" }, gpu: undefined, getBattery: undefined }, writable: true, configurable: true });

function setDevice({ gpu, fallback, mem, cores, saveData, effType, hdr, p3, dpr, reducedMotion, battery, charging, level, gl }) {
  state.media = {};
  if (hdr) state.media["(dynamic-range: high)"] = true;
  if (p3) state.media["(color-gamut: p3)"] = true;
  if (reducedMotion) state.media["(prefers-reduced-motion: reduce)"] = true;
  state.gl = gl || {};
  globalThis.devicePixelRatio = dpr == null ? 2 : dpr;
  const nav = globalThis.navigator;
  nav.hardwareConcurrency = cores == null ? 16 : cores;
  nav.deviceMemory = mem == null ? 16 : mem;
  nav.connection = { saveData: !!saveData, effectiveType: effType || "4g" };
  nav.gpu = gpu ? { requestAdapter: async () => (gpu === "noadapter" ? null : { isFallbackAdapter: !!fallback, info: { vendor: "test", architecture: "test" } }) } : undefined;
  nav.getBattery = battery ? (async () => ({ charging: !!charging, level: level == null ? 1 : level })) : undefined;
}

// ── assertions ────────────────────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
};

const { HoloDeviceTier } = await import("../os/usr/lib/holo/holo-device-tier.mjs");

// ── scenarios (guess() = sync; classification is the same path probe() uses) ───────────────────────
console.log("# guess() classification");

setDevice({ gpu: "webgpu", fallback: false, mem: 16, cores: 16, hdr: true, p3: true, dpr: 2 });
let p = HoloDeviceTier.guess();
eq("ultra · tier", p.tier, "ultra");
eq("ultra · renderPath", p.renderPath, "webgpu");
eq("ultra · dprCap", p.dprCap, 3);
eq("ultra · hdr effect", p.effects.hdr, true);
eq("ultra · bloom", p.effects.bloom, true);

setDevice({ gpu: "webgpu", fallback: false, mem: 4, cores: 8, dpr: 2 });
p = HoloDeviceTier.guess();
eq("high (mem<8) · tier", p.tier, "high");
eq("high · renderPath", p.renderPath, "webgpu");
eq("high · dprCap", p.dprCap, 2);

setDevice({ gpu: undefined, gl: { webgl2: true }, mem: 8, cores: 8 });
p = HoloDeviceTier.guess();
eq("webgl2-only · tier", p.tier, "balanced");
eq("balanced · renderPath", p.renderPath, "webgl2");
eq("balanced · dprCap", p.dprCap, 1.5);
eq("balanced · spatial on", p.effects.spatial, true);

setDevice({ gpu: "webgpu", fallback: false, mem: 16, cores: 16, saveData: true });
p = HoloDeviceTier.guess();
eq("saveData · tier (demote to lite)", p.tier, "lite");
eq("lite · renderPath static", p.renderPath, "static");
eq("lite · dprCap", p.dprCap, 1);
eq("lite · animate off", p.effects.animate, false);

setDevice({ gpu: undefined, gl: { webgl: true }, mem: 4, cores: 4 });
p = HoloDeviceTier.guess();
eq("webgl-only · tier", p.tier, "lite");

setDevice({ gpu: "webgpu", fallback: false, mem: 16, cores: 16, reducedMotion: true, hdr: true });
p = HoloDeviceTier.guess();
eq("reduced-motion · tier stays ultra", p.tier, "ultra");
eq("reduced-motion · renderPath unchanged", p.renderPath, "webgpu");
eq("reduced-motion · animate off", p.effects.animate, false);

setDevice({ gpu: "webgpu", fallback: true, mem: 16, cores: 16 });
p = HoloDeviceTier.guess();
eq("software-webgpu (fallback adapter sync=webgpu kind) · still picks a path", typeof p.renderPath, "string");

setDevice({ gpu: "webgpu", fallback: false, mem: 2, cores: 2 });
p = HoloDeviceTier.guess();
eq("2GB/2core · demote to balanced", p.tier, "balanced");

// ── probe(): async GPU adapter + low-battery demotion ──────────────────────────────────────────────
console.log("# probe() async refinements");
setDevice({ gpu: "webgpu", fallback: true, mem: 16, cores: 16, battery: true, charging: false, level: 0.1 });
const pr = await HoloDeviceTier.probe();
eq("fallback adapter · gpu.fallback true", pr.gpu.fallback, true);
eq("software webgpu → balanced base", ["balanced", "lite"].includes(pr.tier), true);
eq("probe · synthetic false", pr.synthetic, false);
eq("probe · cached on sessionStorage", typeof globalThis.sessionStorage.getItem(HoloDeviceTier.CACHE_KEY), "string");
eq("probe · cache drops live adapter", JSON.parse(globalThis.sessionStorage.getItem(HoloDeviceTier.CACHE_KEY)).gpu.adapter, undefined);

// ── makeScaler: degrades under load, recovers when fast ─────────────────────────────────────────────
console.log("# makeScaler dynamic resolution");
const scaler = HoloDeviceTier.makeScaler(60);
let s = 1;
for (let i = 0; i < 9; i++) s = scaler(40);     // 3 slow runs of 3 → ~3 steps down
eq("scaler degrades under load (<1)", s < 1, true);
for (let i = 0; i < 60; i++) s = scaler(5);     // many fast frames → recover toward 1
eq("scaler recovers when fast (>start)", s > 0.5, true);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} ok, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
