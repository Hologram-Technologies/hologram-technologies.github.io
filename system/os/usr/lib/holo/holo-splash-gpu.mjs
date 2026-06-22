// holo-splash-gpu.mjs — the κ-Open splash's WebGPU "living light" layer.
//
// When WebGPU is available, render a gentle, ADDITIVE volumetric glow over the sun on the Earth photo: a
// softly breathing core bloom + a faint, slowly-shimmering god-ray field, in the flare's cool blue-white.
// The canvas is screen-blended over the photo, so it only ADDS light — it can never break the image. On any
// doubt (no WebGPU, no adapter, any error) mount() returns null and the caller keeps the CSS bloom fallback.
// Conservative intensities by design (the photo already has a bright flare; this just makes it feel alive).
//
//   import { mount } from "/_shared/holo-splash-gpu.mjs";
//   const ctl = await mount(canvas, { sun: [0.5, 0.44] });   // null ⇒ no WebGPU; keep the CSS bloom
//   ctl && ctl.stop();                                        // on veil fade

const WGSL = `
struct U { res: vec2<f32>, time: f32, _p0: f32, sun: vec2<f32>, _p1: vec2<f32> };
@group(0) @binding(0) var<uniform> u: U;

@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0,-1.0), vec2<f32>(3.0,-1.0), vec2<f32>(-1.0,3.0));
  return vec4<f32>(p[vi], 0.0, 1.0);
}
fn hash(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }

@fragment fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = frag.xy / u.res;
  let asp = u.res.x / max(u.res.y, 1.0);
  let d = (uv - u.sun) * vec2<f32>(asp, 1.0);
  let dist = length(d);
  let ang = atan2(d.y, d.x);
  let t = u.time;

  // a slow, gentle breath on the core bloom — the light feels alive
  let breath = 0.85 + 0.15 * sin(t * 0.85);
  let core = exp(-dist * 7.0) * 0.50 * breath;
  let halo = exp(-dist * 2.6) * 0.16;

  // VERY subtle god-ray shimmer — low amplitude so it complements (never competes with) the photo's rays
  let ray = (0.5 + 0.5 * sin(ang * 16.0 + t * 0.18)) * (0.5 + 0.5 * sin(ang * 9.0 - t * 0.12));
  let rays = ray * exp(-dist * 2.2) * 0.09;

  var glow = core + halo + rays;
  glow = glow + (hash(uv * u.res + vec2<f32>(t, 0.0)) - 0.5) * 0.012;   // faint dither → smooth, no banding
  glow = max(glow, 0.0);

  let col = vec3<f32>(0.62, 0.80, 1.0) * glow;    // cool blue-white, matched to the flare
  return vec4<f32>(col, 1.0);                      // screen-blended canvas → black adds nothing, light adds
}`;

let GPU_OK = null, DEVICE = null, _probe = null;
export function probe() {
  if (_probe) return _probe;
  _probe = (async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.gpu) { GPU_OK = false; return false; }
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) { GPU_OK = false; return false; }
      DEVICE = await adapter.requestDevice();
      GPU_OK = true; return true;
    } catch (e) { GPU_OK = false; return false; }
  })();
  return _probe;
}
export const ready = probe();

export async function mount(canvas, opts = {}) {
  try {
    await ready;
    if (GPU_OK !== true || !DEVICE || !canvas) return null;
    const device = DEVICE;
    const ctx = canvas.getContext("webgpu");
    if (!ctx) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "opaque" });
    const module = device.createShaderModule({ code: WGSL });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    const ubuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }] });

    const sun = opts.sun || [0.5, 0.44];
    const maxScale = opts.maxScale || 2;
    const DPR = () => Math.min(maxScale, (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1);
    const CAP = 2560;
    let W = 0, H = 0, raf = 0, t0 = 0, running = true;
    function resize() {
      const r = canvas.getBoundingClientRect();
      let w = Math.max(2, Math.round((r.width || (typeof innerWidth !== "undefined" ? innerWidth : 1280)) * DPR()));
      let h = Math.max(2, Math.round((r.height || (typeof innerHeight !== "undefined" ? innerHeight : 720)) * DPR()));
      const m = Math.max(w, h); if (m > CAP) { const k = CAP / m; w = Math.round(w * k); h = Math.round(h * k); }
      if (w !== W || h !== H) { W = w; H = h; canvas.width = W; canvas.height = H; }
    }
    function frame(now) {
      if (!running) return;
      try {
        resize();
        if (!t0) t0 = now;
        const t = (now - t0) / 1000;
        device.queue.writeBuffer(ubuf, 0, new Float32Array([W, H, t, 0, sun[0], sun[1], 0, 0]));
        const enc = device.createCommandEncoder();
        const view = ctx.getCurrentTexture().createView();
        const pass = enc.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
        device.queue.submit([enc.finish()]);
      } catch (e) { running = false; return; }   // never let a GPU hiccup spam — the CSS fallback stays
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return { stop() { running = false; try { cancelAnimationFrame(raf); } catch (e) {} } };
  } catch (e) { return null; }
}

export default { mount, probe, ready };
