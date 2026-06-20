// holo-v86-screen.mjs — the Holo v86 WebGPU display: a crisp SHARP-BILINEAR upscale of the v86
// framebuffer canvas PLUS a full CRT shader pass (curvature · scanlines · RGB mask/aperture-grille ·
// phosphor bloom · vignette · monochrome tint · brightness compensation). One fullscreen pass, all
// effects driven by a per-skin "profile" so the same module renders a flat panel or a Trinitron.
// Same device-probe + createScreen contract as holo-screen-gpu.js.
//
//   HoloV86Screen.createScreen(canvas, { srcW, srcH, profile }) ->
//       { setSource, setFit, setProfile(p), markDirty, render, stop } | null
//
// profile: { sharp, curve, scan, mask, maskType(1=grille,2=shadow), bloom, vignette, tintAmt, tint:[r,g,b], bright }

export const WGSL = `
const PI: f32 = 3.14159265;
struct U {
  scale: vec2<f32>, srcRes: vec2<f32>,
  sharp: f32, curve: f32, scan: f32, mask: f32,
  maskType: f32, bloom: f32, vignette: f32, tintAmt: f32,
  bright: f32, _p0: f32, _p1: f32, _p2: f32,
  tint: vec4<f32>,
};
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> u: U;

struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var P = array<vec2<f32>, 6>(
    vec2<f32>(-1.0,-1.0), vec2<f32>( 1.0,-1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>( 1.0,-1.0), vec2<f32>( 1.0, 1.0));
  let xy = P[vi];
  var o: VOut;
  o.pos = vec4<f32>(xy * u.scale, 0.0, 1.0);
  o.uv = (xy + vec2<f32>(1.0, 1.0)) * 0.5;
  return o;
}

// sharp-bilinear: snap the fractional sample toward the texel edge by 'sharp' — crisp pixels, smooth gradients.
fn sharpUV(uv: vec2<f32>, texSize: vec2<f32>, sharp: f32) -> vec2<f32> {
  let texel = uv * texSize;
  let tfloor = floor(texel);
  let s = fract(texel);
  let region = vec2<f32>(0.5 - 0.5 / max(sharp, 1.0));
  let cd = s - vec2<f32>(0.5, 0.5);
  let f = (cd - clamp(cd, -region, region)) * sharp + vec2<f32>(0.5, 0.5);
  return (tfloor + f) / texSize;
}

@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  // barrel curvature about the centre (the glass bulge)
  var p = in.uv * 2.0 - vec2<f32>(1.0, 1.0);
  let warp = vec2<f32>(p.y * p.y, p.x * p.x) * u.curve;
  p = p + p * warp;
  let cuv = p * 0.5 + vec2<f32>(0.5, 0.5);
  let suv0 = vec2<f32>(cuv.x, 1.0 - cuv.y);
  if (suv0.x < 0.0 || suv0.x > 1.0 || suv0.y < 0.0 || suv0.y > 1.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);                 // outside the curved tube → black
  }
  let suv = sharpUV(suv0, u.srcRes, u.sharp);
  var c = textureSampleLevel(tex, samp, suv, 0.0).rgb;

  // phosphor bloom — cheap 4-tap glow of the bright parts
  if (u.bloom > 0.001) {
    let t = vec2<f32>(1.5 / u.srcRes.x, 1.5 / u.srcRes.y);
    var b = textureSampleLevel(tex, samp, suv + vec2<f32>( t.x, 0.0), 0.0).rgb
          + textureSampleLevel(tex, samp, suv + vec2<f32>(-t.x, 0.0), 0.0).rgb
          + textureSampleLevel(tex, samp, suv + vec2<f32>(0.0,  t.y), 0.0).rgb
          + textureSampleLevel(tex, samp, suv + vec2<f32>(0.0, -t.y), 0.0).rgb;
    c = c + max(b * 0.25 - vec3<f32>(0.3), vec3<f32>(0.0)) * u.bloom * 1.6;
  }

  // scanlines — one trough per source row (resolution-independent)
  if (u.scan > 0.001) {
    let line = 0.5 + 0.5 * cos(suv0.y * u.srcRes.y * 2.0 * PI);
    c = c * (1.0 - u.scan + u.scan * line);
  }

  // RGB mask — per source pixel, so it survives supersampling/downscale cleanly
  if (u.mask > 0.001) {
    let sx = i32(floor(suv0.x * u.srcRes.x));
    if (u.maskType < 1.5) {                               // aperture grille (Trinitron): vertical stripes
      let col = ((sx % 3) + 3) % 3;
      var m = vec3<f32>(1.0 - u.mask);
      if (col == 0) { m.r = 1.0; } else if (col == 1) { m.g = 1.0; } else { m.b = 1.0; }
      c = c * m;
    } else {                                              // shadow mask: RGB triad on a brick grid
      let sy = i32(floor(suv0.y * u.srcRes.y));
      let cc = ((((sx + sy) % 3) + 3) % 3);
      var m = vec3<f32>(1.0 - u.mask * 0.6);
      if (cc == 0) { m.r = 1.0; } else if (cc == 1) { m.g = 1.0; } else { m.b = 1.0; }
      c = c * m;
    }
  }

  // monochrome phosphor tint (amber / green)
  if (u.tintAmt > 0.001) {
    let lum = dot(c, vec3<f32>(0.299, 0.587, 0.114));
    c = mix(c, lum * u.tint.rgb, u.tintAmt);
  }

  // vignette (corner falloff)
  if (u.vignette > 0.001) {
    c = c * (1.0 - u.vignette * smoothstep(0.6, 1.5, length(p)));
  }

  c = c * u.bright;                                        // CRT effects darken; compensate
  return vec4<f32>(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}`;

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
export function setDevice(d) { DEVICE = d; GPU_OK = !!d; }
export const ready = probe();

// A neutral, flat-panel default; skins override via setProfile.
export const FLAT_PROFILE = { sharp: 4, curve: 0, scan: 0, mask: 0, maskType: 2, bloom: 0.1, vignette: 0, tintAmt: 0, tint: [1, 1, 1], bright: 1 };

export function createScreen(canvas, opts = {}) {
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
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
  const ubuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  let bind = null, tex = null, srcW = opts.srcW || 1, srcH = opts.srcH || 1, src = null;
  let scaleX = 1, scaleY = 1, dirty = true;
  let pr = Object.assign({}, FLAT_PROFILE, opts.profile || {});

  function ensureTex(w, h) {
    if (tex && srcW === w && srcH === h) return;
    if (tex) try { tex.destroy(); } catch {}
    srcW = w; srcH = h;
    tex = device.createTexture({ size: [w, h], format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: tex.createView() }, { binding: 2, resource: { buffer: ubuf } }] });
  }
  function pack() {
    const t = pr.tint || [1, 1, 1];
    return new Float32Array([
      scaleX, scaleY, srcW, srcH,
      pr.sharp, pr.curve, pr.scan, pr.mask,
      pr.maskType, pr.bloom, pr.vignette, pr.tintAmt,
      pr.bright, 0, 0, 0,
      t[0], t[1], t[2], 0]);
  }
  return {
    setSource(c) { src = c; ensureTex(c.width, c.height); dirty = true; },
    setFit(sx, sy) { scaleX = sx; scaleY = sy; dirty = true; },
    setProfile(p) { if (p) { pr = Object.assign({}, FLAT_PROFILE, p); dirty = true; } },
    markDirty() { dirty = true; },
    render() {
      if (!src || !bind || !dirty) return false;
      device.queue.copyExternalImageToTexture({ source: src, flipY: false }, { texture: tex }, [srcW, srcH]);
      device.queue.writeBuffer(ubuf, 0, pack());
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
      device.queue.submit([enc.finish()]);
      dirty = false; return true;
    },
    stop() { try { tex && tex.destroy(); ubuf.destroy(); } catch {} },
  };
}

export default { createScreen, probe, ready, gpuAvailable, setDevice, WGSL, FLAT_PROFILE };
