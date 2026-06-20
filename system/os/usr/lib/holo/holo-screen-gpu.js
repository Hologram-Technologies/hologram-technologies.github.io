// holo-screen-gpu.js — WebGPU backend for the holo-3d "OS framebuffer screen" (P4 of the WebGPU
// render-substrate plan). A thin native port of holo-3d's Three.js render: ONE aspect-fit textured
// quad + a 4-tap unsharp-mask sharpen, sampling the emulator framebuffer canvas.
//
// Why native WGSL, not a WebGPU-capable Three.js: holo-3d uses Three.js for exactly one quad and one
// trivial post shader (apps/holo-3d/index.html:148-160). Re-vendoring r160+ (huge, different API, needs
// network) to replace ~15 lines is the wrong trade; this module is the whole surface, seals inline, and
// matches the shader byte-for-meaning. The unsharp math is copied VERBATIM from that ShaderMaterial.
//
//   const screen = HoloScreenGPU.createScreen(canvas, { srcW, srcH }) -> {
//       setSource(srcCanvas), setQuality({ sharpen, filter, scale }), setFit(scaleX, scaleY),
//       markDirty(), render(), stop() } | null
//   HoloScreenGPU.renderOnce(canvas, { source, sharpen, filter }) -> { w,h,rgba } | null   (witness)

// ── WGSL: faithful port of holo-3d's vertex+fragment. The GLSL flips uv.y (uv = vec2(x, 1-y)); kept.
//    Uses textureSampleLevel so the neighbour taps inside the `if` stay uniformity-legal. ────────────
export const WGSL = `
struct U { texel: vec2<f32>, sharpen: f32, _pad0: f32, scale: vec2<f32>, _pad1: vec2<f32> };
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> u: U;

struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  // a quad as two triangles in [-1,1], uv 0..1 with v up (like PlaneGeometry); scaled for letterbox
  var P = array<vec2<f32>, 6>(
    vec2<f32>(-1.0,-1.0), vec2<f32>( 1.0,-1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>( 1.0,-1.0), vec2<f32>( 1.0, 1.0));
  let xy = P[vi];
  var o: VOut;
  o.pos = vec4<f32>(xy * u.scale, 0.0, 1.0);
  o.uv = (xy + vec2<f32>(1.0, 1.0)) * 0.5;
  return o;
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  let uv = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
  var c = textureSampleLevel(tex, samp, uv, 0.0).rgb;
  if (u.sharpen > 0.001) {
    let n = textureSampleLevel(tex, samp, uv + vec2<f32>(0.0, -u.texel.y), 0.0).rgb;
    let s = textureSampleLevel(tex, samp, uv + vec2<f32>(0.0,  u.texel.y), 0.0).rgb;
    let e = textureSampleLevel(tex, samp, uv + vec2<f32>( u.texel.x, 0.0), 0.0).rgb;
    let w = textureSampleLevel(tex, samp, uv + vec2<f32>(-u.texel.x, 0.0), 0.0).rgb;
    c = clamp(c * (1.0 + 4.0 * u.sharpen) - (n + s + e + w) * u.sharpen, vec3<f32>(0.0), vec3<f32>(1.0));
  }
  return vec4<f32>(c, 1.0);
}`;

// ── one-time device probe (cached), mirroring holo-cosmos-gpu.js so start paths stay sync ───────────
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
export function setDevice(d) { DEVICE = d; GPU_OK = !!d; }   // OS may inject a shared device to avoid a 2nd one
export const ready = probe();

function makePipeline(device, format, filter) {
  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const sampler = device.createSampler({ magFilter: filter, minFilter: filter, addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
  const ubuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  return { module, pipeline, sampler, ubuf };
}
function packU(texelX, texelY, sharpen, scaleX, scaleY) {
  return new Float32Array([texelX, texelY, sharpen, 0, scaleX, scaleY, 0, 0]);
}

// ── LIVE screen (drop-in for holo-3d's initGL/renderLoop, WebGPU draw) ───────────────────────────────
export function createScreen(canvas, opts = {}) {
  if (!DEVICE) return null;
  const device = DEVICE;
  const ctx = canvas.getContext("webgpu");
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });

  let filter = opts.filter === "nearest" ? "nearest" : "linear";
  let { pipeline, sampler, ubuf } = makePipeline(device, format, filter);
  let bind = null, tex = null, srcW = opts.srcW || 1, srcH = opts.srcH || 1, src = null;
  let sharpen = opts.sharpen != null ? opts.sharpen : 0.35, scaleX = 1, scaleY = 1, dirty = true;

  function ensureTex(w, h) {
    if (tex && srcW === w && srcH === h) return;
    if (tex) try { tex.destroy(); } catch {}
    srcW = w; srcH = h;
    tex = device.createTexture({ size: [w, h], format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: tex.createView() }, { binding: 2, resource: { buffer: ubuf } }] });
  }
  function setSource(c) { src = c; ensureTex(c.width, c.height); dirty = true; }
  function setFit(sx, sy) { scaleX = sx; scaleY = sy; dirty = true; }
  function setQuality(q = {}) {
    if (q.sharpen != null) sharpen = q.sharpen;
    if (q.filter && q.filter !== filter) { filter = q.filter === "nearest" ? "nearest" : "linear";
      ({ pipeline, sampler, ubuf } = makePipeline(device, format, filter)); if (src) { const c = src; tex = null; setSource(c); } }
    dirty = true;
  }
  function render() {
    if (!src || !bind || !dirty) return false;
    device.queue.copyExternalImageToTexture({ source: src, flipY: false }, { texture: tex }, [srcW, srcH]);
    device.queue.writeBuffer(ubuf, 0, packU(1 / srcW, 1 / srcH, sharpen, scaleX, scaleY));
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
    device.queue.submit([enc.finish()]);
    dirty = false; return true;
  }
  return { setSource, setFit, setQuality, markDirty: () => { dirty = true; }, render,
    stop() { try { tex && tex.destroy(); ubuf.destroy(); } catch {} } };
}

// ── WITNESS: deterministic single frame, read back RGBA8 top-left (mirror of the GL baseline) ────────
export async function renderOnce(canvas, params = {}) {
  await ready;
  if (!DEVICE || !params.source) return null;
  const device = DEVICE;
  const src = params.source, W = src.width, H = src.height;
  const filter = params.filter === "nearest" ? "nearest" : "linear";
  const sharpen = params.sharpen != null ? params.sharpen : 0.35;

  const out = device.createTexture({ size: [W, H], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const inTex = device.createTexture({ size: [W, H], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  const { pipeline, sampler, ubuf } = makePipeline(device, "rgba8unorm", filter);
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: inTex.createView() }, { binding: 2, resource: { buffer: ubuf } }] });
  device.queue.copyExternalImageToTexture({ source: src, flipY: false }, { texture: inTex }, [W, H]);
  device.queue.writeBuffer(ubuf, 0, packU(1 / W, 1 / H, sharpen, 1, 1));

  const bytesPerRow = Math.ceil((W * 4) / 256) * 256;
  const readBuf = device.createBuffer({ size: bytesPerRow * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: out.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
  pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
  enc.copyTextureToBuffer({ texture: out }, { buffer: readBuf, bytesPerRow }, { width: W, height: H });
  device.queue.submit([enc.finish()]);

  await readBuf.mapAsync(GPUMapMode.READ);
  const padded = new Uint8Array(readBuf.getMappedRange());
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) rgba.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + W * 4), y * W * 4);
  readBuf.unmap();
  try { out.destroy(); inTex.destroy(); ubuf.destroy(); readBuf.destroy(); } catch {}
  return { w: W, h: H, rgba };
}

export default { createScreen, renderOnce, probe, ready, gpuAvailable, setDevice, WGSL };
