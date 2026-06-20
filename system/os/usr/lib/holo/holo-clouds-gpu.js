// holo-clouds-gpu.js — WebGPU backend for the boot-screen cloud sky (P7 of the WebGPU render-substrate
// plan). A faithful WGSL port of the Vanta CLOUDS2 fragment shader (vendored
// system/vendor/vanta/vanta.clouds2.min.js) — a 100-step noise-texture cloud raymarch — so the index
// boot screen can render its clouds natively on WebGPU, with the Vanta/WebGL effect as the fallback.
//
//   HoloCloudsGPU.createBackground(canvas, opts) -> { resize, setSpeed, stop } | null     (live, drives iTime)
//   HoloCloudsGPU.renderOnce(canvas, { width, height, iTime, speed, horizon, noise }) -> { w,h,rgba }
//
// "Match the implementation" = the same shader math + uniforms (default CLOUDS2 colors, speed 1, the
// page's patched horizon 0.52) sampling the SAME noise.png. Parity vs the extracted GLSL is witnessed
// pixel-for-pixel in clouds-parity.html. The original GLSL (verbatim) for reference:
//
//   vec4 p, d = vec4(0.8, 0, coord / iResolution.y - 0.65);
//   vec3 out1 = skyColor - d.w;
//   float s, f, t = 200.0 + sin(dot(coord,coord));
//   for (i=1..100){ t-=2; if(t<0)break; p=0.05*t*d; p.xz+=iTime*0.5*speed; p.x+=sin(iTime*0.25*speed)*0.25;
//                   s=2; f=p.w+1-T-T-T-T; if(f<0){ out1=mix(out1, mix(lightColor,cloudColor,-f), -f*0.4);} }
//   #define T texture2D(iTex, fract((s*p.zw + ceil(s*p.x)) / 200.0)).y / (s += s) * 4.0

// CLOUDS2 defaults (the boot screen overrides none of these): 0x5CA6CA / 0x334D80 / 0xFFFFFF.
export const DEFAULTS = {
  sky: [0x5c / 255, 0xa6 / 255, 0xca / 255],
  cloud: [0x33 / 255, 0x4d / 255, 0x80 / 255],
  light: [1, 1, 1],
  speed: 1.0,
  horizon: 0.52,   // the page's tuned value (stock Vanta = 0.65); lower ⇒ lower horizon / more sky
};

export const WGSL = `
struct U { a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, d: vec4<f32> };
// a=(iResX,iResY,iTime,speed) b=(sky.rgb,horizon) c=(cloud.rgb,_) d=(light.rgb,_)
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var iTex: texture_2d<f32>;

// one octave tap of the CLOUDS2 #define T = texture(iTex, fract((s*p.zw+ceil(s*p.x))/200)).y/(s+=s)*4.
// Witnessed semantics (clouds-parity.html, max 6/255): the texture COORD uses the pre-doubling s
// (2,4,8,16) and the DIVISOR uses the post-doubling s (=2·s → 4,8,16,32). Caller taps THEN doubles.
fn tap(p: vec4<f32>, sc: f32) -> f32 {
  let uv = fract((sc * p.zw + ceil(sc * p.x)) / 200.0);
  return textureSampleLevel(iTex, samp, uv, 0.0).y / (sc * 2.0) * 4.0;
}

struct VOut { @builtin(position) pos: vec4<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var P = array<vec2<f32>, 3>(vec2<f32>(-1.0,-1.0), vec2<f32>(3.0,-1.0), vec2<f32>(-1.0,3.0));
  var o: VOut; o.pos = vec4<f32>(P[vi], 0.0, 1.0); return o;
}

@fragment fn fs(@builtin(position) posIn: vec4<f32>) -> @location(0) vec4<f32> {
  let iRes = u.a.xy; let iTime = u.a.z; let speed = u.a.w;
  let sky = u.b.xyz; let horizon = u.b.w; let cloud = u.c.xyz; let light = u.d.xyz;
  let coord = vec2<f32>(posIn.x, iRes.y - posIn.y);   // emulate GL bottom-left gl_FragCoord

  let dz = coord.x / iRes.y - horizon;
  let dw = coord.y / iRes.y - horizon;
  let D = vec4<f32>(0.8, 0.0, dz, dw);
  var out1 = sky - vec3<f32>(dw, dw, dw);             // sky gradient
  var t = 200.0 + sin(dot(coord, coord));
  for (var i = 0.0; i <= 100.0; i = i + 1.0) {
    t = t - 2.0; if (t < 0.0) { break; }
    var p = 0.05 * t * D;
    let mv = iTime * 0.5 * speed;
    p.x = p.x + mv + sin(iTime * 0.25 * speed) * 0.25;   // p.xz += mv ; p.x += sin(...)
    p.z = p.z + mv;
    var s = 2.0;
    var f = p.w + 1.0;
    f = f - tap(p, s); s = s + s;   // coord 2, divisor 4
    f = f - tap(p, s); s = s + s;   // coord 4, divisor 8
    f = f - tap(p, s); s = s + s;   // coord 8, divisor 16
    f = f - tap(p, s); s = s + s;   // coord 16, divisor 32
    if (f < 0.0) {
      let shade = mix(light, cloud, vec3<f32>(-f, -f, -f));
      out1 = mix(out1, shade, vec3<f32>(-f * 0.4, -f * 0.4, -f * 0.4));
    }
  }
  return vec4<f32>(out1, 1.0);
}`;

// ── one-time device probe (cached), mirroring the other WebGPU backends ──────────────────────────────
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

// noise.png → an rgba8 GPU texture (repeat + linear, as CLOUDS2 tiles it via fract()).
// Accepts raw bytes ({data,width,height}) — the path used for byte-identical parity with a WebGL
// baseline — an ImageBitmap, a Blob, or a URL.
async function makeNoise(device, source) {
  let w, h, data = null, bmp = null;
  if (source && source.data && source.width) { w = source.width; h = source.height; data = source.data; }
  else { bmp = source instanceof ImageBitmap ? source : await createImageBitmap(source instanceof Blob ? source : await (await fetch(source)).blob()); w = bmp.width; h = bmp.height; }
  const tex = device.createTexture({ size: [w, h], format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  if (data) device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h });
  else device.queue.copyExternalImageToTexture({ source: bmp, flipY: false }, { texture: tex }, [w, h]);
  return tex;
}
function makePipeline(device, format) {
  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({ layout: "auto",
    vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" } });
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });
  const ubuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  return { pipeline, sampler, ubuf };
}
function packU(W, H, iTime, o) {
  o = o || {};
  // pick each field, ignoring undefined/null overrides (a spread of {sky:undefined} would otherwise
  // clobber the default and then c.sky[0] throws — the bug that black-screened the live loop).
  const pick = (k) => (o[k] != null ? o[k] : DEFAULTS[k]);
  const sky = pick("sky"), cloud = pick("cloud"), light = pick("light");
  return new Float32Array([W, H, iTime, pick("speed"), sky[0], sky[1], sky[2], pick("horizon"),
    cloud[0], cloud[1], cloud[2], 0, light[0], light[1], light[2], 0]);
}

// ── LIVE: mount the cloud sky onto a canvas; drives iTime from elapsed seconds (× speed) ─────────────
export function createBackground(canvas, opts = {}) {
  if (!DEVICE) return null;
  const device = DEVICE;
  const ctx = canvas.getContext("webgpu");
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });
  const { pipeline, sampler, ubuf } = makePipeline(device, format);
  let bind = null, speed = opts.speed != null ? opts.speed : DEFAULTS.speed;
  const colors = { sky: opts.sky, cloud: opts.cloud, light: opts.light, horizon: opts.horizon };

  const CAP = 2560, DPR = () => Math.min(opts.maxScale || 2, (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1);
  let W = 0, H = 0;
  function resize() {
    const r = canvas.getBoundingClientRect();
    let w = Math.max(2, Math.round((r.width || canvas.clientWidth || 320) * DPR())), h = Math.max(2, Math.round((r.height || canvas.clientHeight || 200) * DPR()));
    const m = Math.max(w, h); if (m > CAP) { const k = CAP / m; w = Math.round(w * k); h = Math.round(h * k); }
    if (w !== W || h !== H) { W = w; H = h; canvas.width = W; canvas.height = H; }
  }

  makeNoise(device, opts.noise || opts.noiseURL || "system/vendor/vanta/noise.png").then((tex) => {
    bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: sampler }, { binding: 2, resource: tex.createView() }] });
  }).catch(() => {});

  let raf = 0, t0 = 0, running = true, painted = false, errored = false;
  const reduced = !!opts.reduced;
  function frame(now) {
    if (!running) return;
    resize();
    if (!t0) t0 = now;
    const iTime = reduced ? 0 : ((now - t0) / 1000) * speed;
    if (bind) {
      try {
        device.queue.writeBuffer(ubuf, 0, packU(W, H, iTime, colors));
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
        device.queue.submit([enc.finish()]);
        painted = true;
      } catch (e) { if (!errored) { errored = true; try { console.warn("holo-clouds-gpu frame error:", e); } catch {} } }
    }
    if (reduced && bind) { running = false; return; }
    raf = requestAnimationFrame(frame);
  }
  const onVis = () => { if (typeof document !== "undefined") { if (document.hidden) { if (raf) cancelAnimationFrame(raf), raf = 0; } else if (running && !raf) raf = requestAnimationFrame(frame); } };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
  raf = requestAnimationFrame(frame);

  return {
    resize,
    setSpeed: (v) => { speed = v; },
    painted: () => painted,         // page can fall back to Vanta if no frame ever painted
    errored: () => errored,
    stop() { running = false; if (raf) cancelAnimationFrame(raf); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis); try { ubuf.destroy(); } catch {} },
  };
}

// ── WITNESS: deterministic single frame, RGBA8 top-left readback ─────────────────────────────────────
export async function renderOnce(canvas, params = {}) {
  await ready;
  if (!DEVICE || !params.noise) return null;
  const device = DEVICE;
  const W = Math.max(1, params.width | 0 || 320), H = Math.max(1, params.height | 0 || 200);
  const tex = device.createTexture({ size: [W, H], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const noiseTex = await makeNoise(device, params.noise);
  const { pipeline, sampler, ubuf } = makePipeline(device, "rgba8unorm");
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: sampler }, { binding: 2, resource: noiseTex.createView() }] });
  device.queue.writeBuffer(ubuf, 0, packU(W, H, params.iTime || 0, params));

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
  try { tex.destroy(); noiseTex.destroy(); ubuf.destroy(); readBuf.destroy(); } catch {}
  return { w: W, h: H, rgba };
}

export default { createBackground, renderOnce, probe, ready, gpuAvailable, setDevice, WGSL, DEFAULTS };
