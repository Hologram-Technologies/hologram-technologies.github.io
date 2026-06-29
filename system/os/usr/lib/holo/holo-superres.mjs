// holo-superres.mjs — the LENS super-resolution pass: SHARPNESS COMES FROM THE PROJECTOR, NOT THE PRODUCER.
// A low-res κ tile (a 240p game frame, a VM framebuffer, a downscaled web capture) is upscaled to the
// device-native resolution AT THE LENS — so one low-res κ projects sharp at 1080p, 4K, or 8K (resolution
// independence). The upscaled tile is itself content-addressed and κ-cached, so a re-seen tile is
// reconstructed O(1), never re-upscaled — "work ∝ novelty" applied to sharpening.
//
// The KERNEL is pluggable (the engine is swappable, the substrate is reused): bilinear here is the honest
// baseline AND the CPU oracle the GPU path is validated against; a learned kernel (an ESRGAN-class WebGPU
// model) drops into the same seam with no change to the cache or the lens. The GPU path is a hardware
// linear-sampled render pass — the upscale is ~free on the metal (WebGPU → Vulkan/Metal/D3D12).
//
// node-/DOM-safe for the CPU path + cache; the GPU path needs a WebGPU device. Imports only the κ primitive.
import { kappaOf } from "./holo-kappa-stream.mjs";

const hexOf = (k) => String(k).split(":").pop();
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// pure bilinear upscale (the reference oracle + CPU fallback). src = RGBA sw×sh; returns RGBA (sw·s)×(sh·s).
// Maps each destination pixel CENTER back into source space ((x+0.5)/s - 0.5) — the same convention a GPU
// linear sampler uses, so the GPU path matches this within unorm rounding.
export function upscaleBilinear(src, sw, sh, s, out = null) {
  const dw = sw * s, dh = sh * s;
  out = out || new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) / s - 0.5, by = Math.floor(sy), ty = sy - by;
    const y0 = clamp(by, 0, sh - 1), y1 = clamp(by + 1, 0, sh - 1);
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) / s - 0.5, bx = Math.floor(sx), tx = sx - bx;
      const x0 = clamp(bx, 0, sw - 1), x1 = clamp(bx + 1, 0, sw - 1);
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = src[(y0 * sw + x0) * 4 + c], p10 = src[(y0 * sw + x1) * 4 + c];
        const p01 = src[(y1 * sw + x0) * 4 + c], p11 = src[(y1 * sw + x1) * 4 + c];
        const top = p00 + (p10 - p00) * tx, bot = p01 + (p11 - p01) * tx;
        out[o + c] = (top + (bot - top) * ty + 0.5) | 0;
      }
    }
  }
  return { bytes: out, w: dw, h: dh };
}

// makeSuperRes({ scale, kernel, cache }) — a κ-caching upscaler. upscale() addresses the source tile, and on
// a cache MISS runs the kernel and addresses the result; a HIT returns the cached upscaled tile with no work.
export function makeSuperRes({ scale = 4, kernel = upscaleBilinear, cache = new Map() } = {}) {
  let dispatches = 0;
  async function upscale(src, sw, sh, { scale: s = scale } = {}) {
    const u = src instanceof Uint8Array ? src : new Uint8Array(src);
    const key = hexOf(await kappaOf(u)) + ":" + s;            // (source κ, scale) — the cache identity
    if (cache.has(key)) return { ...cache.get(key), cached: true };
    dispatches++;                                            // a real kernel run (GPU dispatch / CPU pass)
    const r = kernel(u, sw, sh, s);
    const entry = { bytes: r.bytes, w: r.w, h: r.h, kappa: await kappaOf(r.bytes) };
    cache.set(key, entry);
    return { ...entry, cached: false };
  }
  return { upscale, dispatches: () => dispatches, cache };
}

// GPU path — a hardware linear-sampled fullscreen pass. Validated against upscaleBilinear (within ±unorm).
const WGSL = `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f,3>(vec2f(-1.0,-1.0), vec2f(3.0,-1.0), vec2f(-1.0,3.0));
  var o: VOut; o.pos = vec4f(p[i], 0.0, 1.0); o.uv = p[i] * vec2f(0.5,-0.5) + vec2f(0.5,0.5); return o;
}
@fragment fn fs(in: VOut) -> @location(0) vec4f { return textureSample(tex, samp, in.uv); }`;

export async function upscaleGPU(device, src, sw, sh, s) {
  const dw = sw * s, dh = sh * s;
  const tex = device.createTexture({ size: [sw, sh], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: tex }, src, { bytesPerRow: sw * 4, rowsPerImage: sh }, { width: sw, height: sh });
  const target = device.createTexture({ size: [dw, dh], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const samp = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  const mod = device.createShaderModule({ code: WGSL });
  const pipe = device.createRenderPipeline({ layout: "auto", vertex: { module: mod, entryPoint: "vs" }, fragment: { module: mod, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] }, primitive: { topology: "triangle-list" } });
  const bind = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: samp }, { binding: 1, resource: tex.createView() }] });
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
  pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
  const bpr = dw * 4;                                         // 256-aligned for sane (sw·s) (e.g. 64·4=256 → 1024)
  const buf = device.createBuffer({ size: bpr * dh, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  enc.copyTextureToBuffer({ texture: target }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: dh }, { width: dw, height: dh });
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const out = new Uint8Array(buf.getMappedRange()).slice(); buf.unmap(); buf.destroy();
  return { bytes: out, w: dw, h: dh };
}

export default { upscaleBilinear, makeSuperRes, upscaleGPU };
