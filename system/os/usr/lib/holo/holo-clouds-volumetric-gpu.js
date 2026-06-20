// holo-clouds-volumetric-gpu.js — a TRUE volumetric cloud sky on WebGPU (P8). Net-new art (no parity
// baseline): a raymarched "cloud sea" with single-scattering lighting (Beer–Lambert extinction toward
// the sun, Henyey–Greenstein forward-scatter for silver linings, Beer-powder for cauliflower depth),
// over a dark-zenith sky with a sun glow, finished with an ACES tonemap + vignette + blue-noise dither.
//
//   HoloCloudsVolumetricGPU.createBackground(canvas, opts) -> { resize, setSpeed, stop, painted, errored } | null
//   HoloCloudsVolumetricGPU.renderOnce(canvas, params) -> { w,h,rgba }   (witness/tuning; accepts look params)
//
// Same start() contract as holo-clouds-gpu.js so it slots into the boot-screen selection chain
// (volumetric → CLOUDS2-WGSL → Vanta). Single render pass (scene + tonemap); no textures (analytic
// noise) to keep the pipeline minimal. Look params are uniforms so they can be swept without recompiling.

export const DEFAULTS = {
  exposure: 1.15,
  sun: [0.42, 0.16, -0.89],            // sun direction (normalized in-shader); near horizon, slightly right, ahead
  coverage: 0.42,                      // higher ⇒ more/denser clouds
  tilt: 0.04,                          // horizon placement; higher ⇒ horizon lower ⇒ more dark sky on top (0.20≈26% dark, 0.04≈13%)
  densityScale: 7.0,                   // extinction strength
  zenith: [0.015, 0.04, 0.11],         // dark sky at top
  horizon: [0.55, 0.70, 0.92],         // sky toward the horizon
  sun_col: [1.25, 1.05, 0.85],         // warm sunlight
  renderScale: 0.7,                    // clouds are soft → render below native and upscale (perf)
};

export const WGSL = `
struct U {
  a: vec4<f32>,   // resX, resY, time, exposure
  b: vec4<f32>,   // sun.xyz, coverage
  c: vec4<f32>,   // tilt, densityScale, _, _
  d: vec4<f32>,   // zenith.rgb, _
  e: vec4<f32>,   // horizon.rgb, _
  f: vec4<f32>,   // sunCol.rgb, _
};
@group(0) @binding(0) var<uniform> u: U;

const PI = 3.14159265;
const SLAB_BOT = 0.0;
const SLAB_TOP = 620.0;
const CAM_Y = 1000.0;

fn hash13(p3i: vec3<f32>) -> f32 { var p = fract(p3i * 0.1031); p = p + dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
fn vnoise(x: vec3<f32>) -> f32 {
  let i = floor(x); var f = fract(x); f = f * f * (3.0 - 2.0 * f);
  let n000 = hash13(i + vec3<f32>(0.,0.,0.)); let n100 = hash13(i + vec3<f32>(1.,0.,0.));
  let n010 = hash13(i + vec3<f32>(0.,1.,0.)); let n110 = hash13(i + vec3<f32>(1.,1.,0.));
  let n001 = hash13(i + vec3<f32>(0.,0.,1.)); let n101 = hash13(i + vec3<f32>(1.,0.,1.));
  let n011 = hash13(i + vec3<f32>(0.,1.,1.)); let n111 = hash13(i + vec3<f32>(1.,1.,1.));
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
             mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}
fn fbm(p0: vec3<f32>) -> f32 { var a = 0.5; var s = 0.0; var p = p0; for (var i = 0; i < 5; i = i + 1) { s = s + a * vnoise(p); p = p * 2.02 + vec3<f32>(11.3, 7.1, 5.7); a = a * 0.5; } return s; }

fn density(p: vec3<f32>, time: f32, coverage: f32) -> f32 {
  let hf = (p.y - SLAB_BOT) / (SLAB_TOP - SLAB_BOT);
  if (hf < 0.0 || hf > 1.0) { return 0.0; }
  let grad = smoothstep(0.0, 0.22, hf) * smoothstep(1.0, 0.55, hf);   // rounded base, softer top
  var q = p * 0.0016; q.x = q.x + time * 0.020; q.z = q.z + time * 0.011;
  var d = fbm(q) * grad;
  d = smoothstep(coverage, coverage + 0.34, d);
  d = d - 0.10 * fbm(p * 0.010 + vec3<f32>(time * 0.05, 0.0, 0.0));   // erosion
  return clamp(d, 0.0, 1.0);
}
fn hg(c: f32, g: f32) -> f32 { let g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var P = array<vec2<f32>, 3>(vec2<f32>(-1.,-1.), vec2<f32>(3.,-1.), vec2<f32>(-1.,3.));
  return vec4<f32>(P[vi], 0.0, 1.0);
}

@fragment fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let res = u.a.xy; let time = u.a.z; let exposure = u.a.w;
  let sun = normalize(u.b.xyz); let coverage = u.b.w;
  let tilt = u.c.x; let densityScale = u.c.y;
  let zenith = u.d.xyz; let horizonC = u.e.xyz; let sunCol = u.f.xyz;

  let uv = vec2<f32>((pos.x * 2.0 - res.x) / res.y, (res.y - pos.y * 2.0) / res.y);   // y up
  let ro = vec3<f32>(0.0, CAM_Y, 0.0);
  let rd = normalize(vec3<f32>(uv.x, uv.y * 0.62 + tilt, -1.0));

  // sky: dark zenith → bright horizon, plus sun glow
  let upf = clamp(rd.y, 0.0, 1.0);
  var sky = mix(horizonC, zenith, smoothstep(0.0, 0.5, upf));
  let csun = max(dot(rd, sun), 0.0);
  sky = sky + sunCol * (pow(csun, 800.0) * 12.0 + pow(csun, 12.0) * 0.45);   // disk + broad glow
  var col = sky;

  // clouds: only where the ray descends into the slab (below the camera)
  if (rd.y < -0.002) {
    let tTop = (SLAB_TOP - ro.y) / rd.y;
    let tBot = (SLAB_BOT - ro.y) / rd.y;
    var tEnter = max(min(tTop, tBot), 0.0);
    let tExit = max(tTop, tBot);
    let span = tExit - tEnter;
    if (span > 0.0) {
      let STEPS = 64;
      let stepLen = min(span / f32(STEPS), 26.0);
      let jitter = hash13(vec3<f32>(pos.xy, time));
      var t = tEnter + stepLen * jitter;
      var trans = 1.0;
      var scattered = vec3<f32>(0.0, 0.0, 0.0);
      let phase = mix(hg(csun, 0.5), hg(csun, -0.15), 0.4);
      for (var i = 0; i < STEPS; i = i + 1) {
        if (t > tExit || trans < 0.02) { break; }
        let p = ro + rd * t;
        let dens = density(p, time, coverage);
        if (dens > 0.003) {
          let sampleExt = dens * densityScale * stepLen * 0.02;
          // light march toward the sun
          var ld = 0.0;
          for (var j = 1; j <= 5; j = j + 1) {
            let lp = p + sun * (f32(j) * 22.0);
            ld = ld + density(lp, time, coverage) * 22.0;
          }
          let sunTrans = exp(-ld * densityScale * 0.02 * 0.85);
          let powder = 1.0 - exp(-sampleExt * 2.0);
          let ambient = mix(horizonC, vec3<f32>(1.0,1.0,1.0), 0.25) * 0.35;
          let inscat = sunCol * sunTrans * phase * 2.2 + ambient;
          let absorb = 1.0 - exp(-sampleExt);
          scattered = scattered + trans * absorb * inscat;
          trans = trans * exp(-sampleExt);
        }
        t = t + stepLen;
      }
      col = sky * trans + scattered;
    }
  }

  // ACES tonemap + vignette + blue-noise dither
  let x = col * exposure;
  var mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  mapped = clamp(mapped, vec3<f32>(0.0), vec3<f32>(1.0));
  mapped = mapped * mix(0.55, 1.0, smoothstep(1.5, 0.25, length(uv)));
  mapped = mapped + (hash13(vec3<f32>(pos.xy, time + 1.0)) - 0.5) / 255.0;
  return vec4<f32>(mapped, 1.0);
}`;

// ── device probe (cached), shared pattern ────────────────────────────────────────────────────────
let GPU_OK = null, DEVICE = null, _probe = null;
export function probe() {
  if (_probe) return _probe;
  _probe = (async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.gpu) { GPU_OK = false; return false; }
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) { GPU_OK = false; return false; }
      DEVICE = await adapter.requestDevice(); GPU_OK = true; return true;
    } catch { GPU_OK = false; return false; }
  })();
  return _probe;
}
export function gpuAvailable() { return GPU_OK === true; }
export function setDevice(dv) { DEVICE = dv; GPU_OK = !!dv; }
export const ready = probe();

function makePipeline(device, format) {
  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({ layout: "auto",
    vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" } });
  const ubuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  return { pipeline, ubuf };
}
function packU(W, H, time, o) {
  o = o || {};
  const pick = (k) => (o[k] != null ? o[k] : DEFAULTS[k]);
  const sun = pick("sun"), zen = pick("zenith"), hor = pick("horizon"), sc = pick("sun_col");
  return new Float32Array([
    W, H, time, pick("exposure"),
    sun[0], sun[1], sun[2], pick("coverage"),
    pick("tilt"), pick("densityScale"), 0, 0,
    zen[0], zen[1], zen[2], 0,
    hor[0], hor[1], hor[2], 0,
    sc[0], sc[1], sc[2], 0,
  ]);
}

export function createBackground(canvas, opts = {}) {
  if (!DEVICE) return null;
  const device = DEVICE;
  const ctx = canvas.getContext("webgpu");
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });
  const { pipeline, ubuf } = makePipeline(device, format);
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }] });
  const look = {}; for (const k of ["exposure","sun","coverage","tilt","densityScale","zenith","horizon","sun_col"]) if (opts[k] != null) look[k] = opts[k];
  const rscale = opts.renderScale != null ? opts.renderScale : DEFAULTS.renderScale;

  const CAP = 1800, DPR = () => Math.min(opts.maxScale || 2, (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1);
  let W = 0, H = 0;
  function resize() {
    const r = canvas.getBoundingClientRect();
    let w = Math.max(2, Math.round((r.width || canvas.clientWidth || 320) * DPR() * rscale));
    let h = Math.max(2, Math.round((r.height || canvas.clientHeight || 200) * DPR() * rscale));
    const m = Math.max(w, h); if (m > CAP) { const k = CAP / m; w = Math.round(w * k); h = Math.round(h * k); }
    if (w !== W || h !== H) { W = w; H = h; canvas.width = W; canvas.height = H; }
  }

  let raf = 0, t0 = 0, running = true, painted = false, errored = false, speed = opts.speed != null ? opts.speed : 1.0;
  const reduced = !!opts.reduced;
  function frame(now) {
    if (!running) return;
    resize();
    if (!t0) t0 = now;
    const time = reduced ? 8.0 : ((now - t0) / 1000) * speed;
    try {
      device.queue.writeBuffer(ubuf, 0, packU(W, H, time, look));
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
      device.queue.submit([enc.finish()]);
      painted = true;
    } catch (e) { if (!errored) { errored = true; try { console.warn("holo-clouds-volumetric frame error:", e); } catch {} } }
    if (reduced && painted) { running = false; return; }
    raf = requestAnimationFrame(frame);
  }
  const onVis = () => { if (typeof document !== "undefined") { if (document.hidden) { if (raf) cancelAnimationFrame(raf), raf = 0; } else if (running && !raf) raf = requestAnimationFrame(frame); } };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
  raf = requestAnimationFrame(frame);

  return { resize, setSpeed: (v) => { speed = v; }, painted: () => painted, errored: () => errored,
    stop() { running = false; if (raf) cancelAnimationFrame(raf); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis); try { ubuf.destroy(); } catch {} } };
}

export async function renderOnce(canvas, params = {}) {
  await ready;
  if (!DEVICE) return null;
  const device = DEVICE;
  const W = Math.max(1, params.width | 0 || 320), H = Math.max(1, params.height | 0 || 200);
  const tex = device.createTexture({ size: [W, H], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const { pipeline, ubuf } = makePipeline(device, "rgba8unorm");
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }] });
  device.queue.writeBuffer(ubuf, 0, packU(W, H, params.time || 0, params));
  const bytesPerRow = Math.ceil((W * 4) / 256) * 256;
  const readBuf = device.createBuffer({ size: bytesPerRow * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: readBuf, bytesPerRow }, { width: W, height: H });
  device.queue.submit([enc.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const padded = new Uint8Array(readBuf.getMappedRange());
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) rgba.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + W * 4), y * W * 4);
  readBuf.unmap();
  try { tex.destroy(); ubuf.destroy(); readBuf.destroy(); } catch {}
  return { w: W, h: H, rgba };
}

export default { createBackground, renderOnce, probe, ready, gpuAvailable, setDevice, WGSL, DEFAULTS };
