// holo-cosmos-gpu.js — WebGPU backend for Holo Cosmos (P2 of the WebGPU render-substrate plan).
// A faithful WGSL port of the WebGL2 raymarcher in holo-cosmos.js, behind the SAME start() contract:
//
//   HoloCosmosGPU.start(canvas, { seed, reduced }) -> { getCam, stop } | null   (null ⇒ no usable GPU)
//
// Design rules (see webgpu-render-substrate-assessment.md / PARITY-REPORT.md):
//   • Contract-preserving: identical signature + return shape to holo-cosmos.js, so mount() can pick a
//     backend with zero app changes. The live cockpit's camera/input/time logic is copied VERBATIM from
//     the WebGL2 version so behaviour matches; only the draw backend differs.
//   • Sync start(): a one-time async probe (requestAdapter/requestDevice) caches a GPUDevice. The
//     selector only routes here once GPU_OK === true, so start() can create the context + pipeline
//     synchronously from the cached device. If the device is somehow absent, returns null → fall back.
//   • Verifiable (Law L5): renderOnce() reads pixels back via copyTextureToBuffer, mirroring the WebGL2
//     readPixels witness, so parity is measurable pixel-for-pixel.
//   • Seed parity: imports seedVec from holo-cosmos.js — one source of truth for seed → floats.

import { seedVec } from "./holo-cosmos.js";

// ── WGSL: a direct port of VERT/FRAG. gl_FragCoord (bottom-left) is emulated by flipping Y, since
//    @builtin(position) is top-left in WebGPU. Uniforms are packed into three vec4s to dodge std140
//    vec3-alignment traps: a=(resX,resY,time,reduced) b=(camXYZ,yaw) c=(seedXYZ,pit). ───────────────
export const WGSL = `
struct U { a: vec4<f32>, b: vec4<f32>, c: vec4<f32> };
@group(0) @binding(0) var<uniform> u: U;

fn h31(p0: vec3<f32>) -> f32 { var p = fract(p0 * 0.1031); p = p + dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
fn h21(p0: vec2<f32>) -> f32 { var p3 = fract(vec3<f32>(p0.x, p0.y, p0.x) * 0.1031); p3 = p3 + dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
fn h33(p0: vec3<f32>) -> vec3<f32> { var p = fract(p0 * vec3<f32>(0.1031, 0.1030, 0.0973)); p = p + dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
fn noise(p: vec3<f32>) -> f32 {
  let i = floor(p); var f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3<f32>(1.0,0.0,0.0)), f.x), mix(h31(i + vec3<f32>(0.0,1.0,0.0)), h31(i + vec3<f32>(1.0,1.0,0.0)), f.x), f.y),
             mix(mix(h31(i + vec3<f32>(0.0,0.0,1.0)), h31(i + vec3<f32>(1.0,0.0,1.0)), f.x), mix(h31(i + vec3<f32>(0.0,1.0,1.0)), h31(i + vec3<f32>(1.0,1.0,1.0)), f.x), f.y), f.z);
}
fn fbm(p0: vec3<f32>) -> f32 { var a = 0.5; var s = 0.0; var p = p0; for (var i: i32 = 0; i < 5; i = i + 1) { s = s + a * noise(p); p = p * 2.03 + vec3<f32>(7.1,3.7,1.3); a = a * 0.5; } return s; }
fn lookMat(a: vec2<f32>) -> mat3x3<f32> {
  let cy = cos(a.x); let sy = sin(a.x); let cp = cos(a.y); let sp = sin(a.y);
  return mat3x3<f32>(vec3<f32>(cy,0.0,sy), vec3<f32>(0.0,1.0,0.0), vec3<f32>(-sy,0.0,cy)) * mat3x3<f32>(vec3<f32>(1.0,0.0,0.0), vec3<f32>(0.0,cp,-sp), vec3<f32>(0.0,sp,cp));
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) posIn: vec4<f32>) -> @location(0) vec4<f32> {
  let uRes = u.a.xy; let uTime = u.a.z; let uReduced = u.a.w;
  let uCam = u.b.xyz; let uLook = vec2<f32>(u.b.w, u.c.w); let uSeed = u.c.xyz;
  let fragCoord = vec2<f32>(posIn.x, uRes.y - posIn.y);   // emulate GL bottom-left gl_FragCoord

  let uv = (fragCoord * 2.0 - uRes) / uRes.y;
  let rd = normalize(lookMat(uLook) * vec3<f32>(uv, 1.45));
  let ro = uCam;
  let colA = 0.55 + 0.45 * cos(6.2831 * (uSeed.x + vec3<f32>(0.0,0.33,0.67)));
  let colB = 0.55 + 0.45 * cos(6.2831 * (uSeed.y + vec3<f32>(0.15,0.45,0.8)));
  var col = mix(vec3<f32>(0.012,0.018,0.04), colA * 0.08, smoothstep(-0.6, 0.8, rd.y));

  for (var L: i32 = 0; L < 3; L = L + 1) {
    let dist = 6.0 + f32(L) * 10.0;
    let sp = ro / dist + rd * (2.0 + f32(L) * 2.0);
    let cell = floor(sp * 7.0);
    let hr = h33(cell + uSeed * 17.0 + f32(L) * 5.0);
    let on = step(0.965 - f32(L) * 0.006, hr.x);
    let d = length(fract(sp * 7.0) - hr);
    let tw = select(0.55 + 0.45 * sin(uTime * (0.6 + hr.y * 3.0) + hr.z * 6.28), 0.85, uReduced > 0.5);
    col = col + on * smoothstep(0.22, 0.0, d) * tw * 1.8 * mix(vec3<f32>(1.0,1.0,1.0), colB, hr.z) * (1.0 - f32(L) * 0.2);
  }

  var neb = vec3<f32>(0.0,0.0,0.0); var t = 0.0;
  for (var i: i32 = 0; i < 20; i = i + 1) {
    let p = ro * 0.04 + rd * t + uSeed * 4.0;
    let dens = smoothstep(0.50, 0.82, fbm(p * 0.5));
    let ec = mix(colA, colB, fbm(p * 0.27 + 2.3));
    neb = neb + dens * ec * 0.105 * exp(-t * 0.05);
    t = t + 0.62;
  }
  col = col + neb;

  let sunDir = normalize(vec3<f32>(cos(uSeed.z * 6.2831), 0.12, sin(uSeed.z * 6.2831)));
  let sd = max(0.0, dot(rd, sunDir));
  col = col + colB * pow(sd, 120.0) * 3.2 + colA * pow(sd, 5.0) * 0.5;

  col = 1.0 - exp(-col * 1.45);
  col = col * mix(0.5, 1.0, smoothstep(1.5, 0.25, length(uv)));
  col = col + (h21(fragCoord + uTime) - 0.5) * 0.02;
  return vec4<f32>(col, 1.0);
}`;

// ── one-time device probe (cached). The selector gates on gpuAvailable() so start() stays sync. ─────
let GPU_OK = null;          // null = unknown/pending, true = device cached, false = unsupported/failed
let DEVICE = null;
let _probe = null;
export function probe() {
  if (_probe) return _probe;
  _probe = (async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.gpu) { GPU_OK = false; return false; }
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) { GPU_OK = false; return false; }
      DEVICE = await adapter.requestDevice();
      GPU_OK = true; return true;
    } catch { GPU_OK = false; return false; }
  })();
  return _probe;
}
export function gpuAvailable() { return GPU_OK === true; }
export const ready = probe();   // kick the probe off at import so the selector has an answer ASAP

// ── shared pipeline builder (live + witness use the same shader/pipeline) ────────────────────────────
function buildPipeline(device, format) {
  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const ubuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }] });
  return { module, pipeline, ubuf, bind };
}
function packUniforms(W, H, time, cam, look, seed, reduced) {
  return new Float32Array([
    W, H, time, reduced ? 1 : 0,
    cam[0], cam[1], cam[2], look[0],
    seed[0], seed[1], seed[2], look[1],
  ]);
}

// ── LIVE backend: identical camera/input/time loop to holo-cosmos.js, WebGPU draw ───────────────────
export function start(canvas, opts = {}) {
  if (!DEVICE) return null;                         // selector should only route here when gpuAvailable()
  const device = DEVICE;
  const ctx = canvas.getContext("webgpu");
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });
  const { pipeline, ubuf, bind } = buildPipeline(device, format);

  const seed = seedVec(opts.seed);
  const reduced = !!opts.reduced;

  const DPR = () => Math.min(opts.maxScale || 2, (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1);
  const CAP = 2560;
  let W = 0, H = 0;
  function resize() {
    const r = canvas.getBoundingClientRect();
    let w = Math.max(2, Math.round((r.width || canvas.clientWidth || 320) * DPR())), h = Math.max(2, Math.round((r.height || canvas.clientHeight || 200) * DPR()));
    const m = Math.max(w, h); if (m > CAP) { const k = CAP / m; w = Math.round(w * k); h = Math.round(h * k); }
    if (w !== W || h !== H) { W = w; H = h; canvas.width = W; canvas.height = H; }
  }

  // cockpit (verbatim from holo-cosmos.js so motion matches)
  let yaw = 0, pit = 0, tyaw = 0, tpit = 0, throttle = 0, thrT = 0;
  const cam = [0, 0, 0];
  const onPtr = (e) => { tyaw = (e.clientX / (innerWidth || 1) - 0.5) * 1.1; tpit = -(e.clientY / (innerHeight || 1) - 0.5) * 0.7; };
  const onTilt = (e) => { if (e.gamma != null) { tyaw = Math.max(-1, Math.min(1, e.gamma / 35)); tpit = Math.max(-0.6, Math.min(0.6, -(e.beta - 45) / 45)); } };
  const onWheel = (e) => { thrT = Math.max(-0.5, Math.min(4, thrT - e.deltaY * 0.002)); };
  if (!reduced) { window.addEventListener("pointermove", onPtr, { passive: true }); window.addEventListener("deviceorientation", onTilt, { passive: true }); window.addEventListener("wheel", onWheel, { passive: true }); }

  let raf = 0, t0 = 0, last = 0, running = true;
  function frame(now) {
    if (!running) return;
    resize();
    if (!t0) { t0 = now; last = now; }
    const t = (now - t0) / 1000, dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    yaw += (tyaw - yaw) * 0.05; pit += (tpit - pit) * 0.05; throttle += (thrT - throttle) * 0.04;
    const dyaw = reduced ? 0 : Math.sin(t * 0.05) * 0.08, dpit = reduced ? 0 : Math.cos(t * 0.037) * 0.04;
    const cy = Math.cos(yaw + dyaw), sy = Math.sin(yaw + dyaw), cp = Math.cos(pit + dpit), sp = Math.sin(pit + dpit);
    const fwd = [sy * cp, sp, cy * cp];
    const speed = (reduced ? 0.0 : 2.2) + throttle * 3.0;
    cam[0] += fwd[0] * speed * dt; cam[1] += fwd[1] * speed * dt; cam[2] += fwd[2] * speed * dt;

    device.queue.writeBuffer(ubuf, 0, packUniforms(W, H, t, cam, [yaw + dyaw, pit + dpit], seed, reduced));
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
    device.queue.submit([enc.finish()]);

    if (reduced) { running = false; return; }
    raf = requestAnimationFrame(frame);
  }
  const onVis = () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf), raf = 0; } else if (running && !reduced && !raf) raf = requestAnimationFrame(frame); };
  document.addEventListener("visibilitychange", onVis);
  frame(typeof performance !== "undefined" && performance.now ? performance.now() : 0);

  return {
    getCam: () => [cam[0], cam[1], cam[2]],
    stop() {
      running = false; if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPtr); window.removeEventListener("deviceorientation", onTilt); window.removeEventListener("wheel", onWheel);
      document.removeEventListener("visibilitychange", onVis);
      try { ubuf.destroy(); } catch {}
    },
  };
}

// ── WITNESS: deterministic single frame, read back as RGBA8 top-left (mirrors holo-cosmos.renderOnce) ─
export async function renderOnce(canvas, params = {}) {
  await ready;
  if (!DEVICE) return null;
  const device = DEVICE;
  const W = Math.max(1, params.width | 0 || 256), H = Math.max(1, params.height | 0 || 256);
  const seed = Array.isArray(params.seed) ? params.seed : seedVec(params.seed);
  const cam = params.cam || [0, 0, 0], look = params.look || [0, 0];

  const tex = device.createTexture({ size: [W, H], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const { pipeline, ubuf, bind } = buildPipeline(device, "rgba8unorm");
  device.queue.writeBuffer(ubuf, 0, packUniforms(W, H, params.time || 0, cam, look, seed, !!params.reduced));

  const bytesPerRow = Math.ceil((W * 4) / 256) * 256;   // WebGPU requires 256-byte row alignment
  const readBuf = device.createBuffer({ size: bytesPerRow * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
  enc.copyTextureToBuffer({ texture: tex }, { buffer: readBuf, bytesPerRow }, { width: W, height: H });
  device.queue.submit([enc.finish()]);

  await readBuf.mapAsync(GPUMapMode.READ);
  const padded = new Uint8Array(readBuf.getMappedRange());
  const rgba = new Uint8Array(W * H * 4);   // rgba8unorm + copyTextureToBuffer is already top-left, row-major
  for (let y = 0; y < H; y++) rgba.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + W * 4), y * W * 4);
  readBuf.unmap();
  try { tex.destroy(); ubuf.destroy(); readBuf.destroy(); } catch {}
  return { w: W, h: H, rgba };
}

export default { start, renderOnce, probe, ready, gpuAvailable, WGSL, seedVec };
