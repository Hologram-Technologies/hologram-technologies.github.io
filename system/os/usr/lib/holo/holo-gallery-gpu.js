// holo-gallery-gpu.js — a WebGPU "deep-substrate" backdrop for the Holo v86 god-view.
//
// A calm, full-bleed animated field: drifting aurora light + a faint receding κ-lattice + vignette —
// the feeling of floating inside the content-addressed substrate, with the machines glowing in front.
// One fullscreen pass, a single time uniform. Self-probing device (mirrors holo-screen-gpu); if WebGPU
// is unavailable it returns null and the caller keeps its CSS gradient — purely additive.
//
//   const bg = HoloGalleryGPU.createBackdrop(canvas) -> { start(), stop() } | null

export const WGSL = `
struct U { res: vec2<f32>, time: f32, _p: f32 };
@group(0) @binding(0) var<uniform> u: U;
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var P = array<vec2<f32>,6>(vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
  var o: VOut; let xy = P[vi]; o.pos = vec4<f32>(xy, 0., 1.); o.uv = (xy + vec2(1.,1.)) * 0.5; return o;
}
fn hash21(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  let ar = u.res.x / max(u.res.y, 1.0);
  let p = (in.uv - vec2(0.5, 0.5)) * vec2(ar, 1.0);
  let t = u.time;
  var col = vec3<f32>(0.015, 0.022, 0.038);                       // deep substrate base
  // drifting aurora — three soft blue glows wandering slowly
  for (var i = 0; i < 3; i = i + 1) {
    let fi = f32(i);
    let c = vec2<f32>(sin(t * 0.06 + fi * 2.1) * 0.55, cos(t * 0.045 + fi * 1.7) * 0.32);
    let d = length(p - c);
    col = col + exp(-d * d * 6.0) * mix(vec3(0.10, 0.22, 0.46), vec3(0.05, 0.10, 0.28), fi / 3.0) * 0.45;
  }
  // faint κ-lattice, slowly receding upward
  let gp = p * 7.0 + vec2(0.0, t * 0.08);
  let g = abs(fract(gp) - vec2(0.5, 0.5));
  let node = smoothstep(0.46, 0.5, max(g.x, g.y));
  col = col + vec3(0.05, 0.09, 0.18) * node * 0.12;
  // sparse drifting motes
  let sp = floor(p * 14.0 + vec2(0.0, t * 0.3));
  let star = step(0.985, hash21(sp));
  col = col + vec3(0.4, 0.6, 1.0) * star * (0.5 + 0.5 * sin(t * 2.0 + hash21(sp) * 30.0)) * 0.25;
  col = col * (1.0 - 0.55 * length(p));                           // vignette
  return vec4<f32>(col, 1.0);
}`;

let GPU_OK = null, DEVICE = null, _probe = null;
export function probe() {
  if (_probe) return _probe;
  _probe = (async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.gpu) { GPU_OK = false; return false; }
      const a = await navigator.gpu.requestAdapter({ powerPreference: "low-power" });
      if (!a) { GPU_OK = false; return false; }
      DEVICE = await a.requestDevice(); GPU_OK = true; return true;
    } catch { GPU_OK = false; return false; }
  })();
  return _probe;
}
export function gpuAvailable() { return GPU_OK === true; }
export const ready = probe();

export function createBackdrop(canvas) {
  if (!DEVICE) return null;
  const device = DEVICE;
  const ctx = canvas.getContext("webgpu");
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });
  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({ layout: "auto",
    vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" } });
  const ubuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }] });
  let raf = 0, t0 = performance.now(), running = false;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);       // backdrop doesn't need full res
  function size() { const w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } }
  function frame() {
    if (!running) return;
    size();
    device.queue.writeBuffer(ubuf, 0, new Float32Array([canvas.width, canvas.height, (performance.now() - t0) / 1000, 0]));
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
    device.queue.submit([enc.finish()]);
    raf = requestAnimationFrame(frame);
  }
  return { start() { if (!running) { running = true; t0 = performance.now(); frame(); } },
           stop() { running = false; cancelAnimationFrame(raf); } };
}

export default { createBackdrop, probe, ready, gpuAvailable, WGSL };
