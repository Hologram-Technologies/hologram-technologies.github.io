// holo-render.js — the κ-streaming WebGPU super-res compositor (the "magic" display tier).
//
// A guest framebuffer is presented SUPER-SHARP at the device's full (retina/8K-class)
// resolution and high FPS, on the user's GPU, with the heavy work content-addressed:
//   • tile-κ      — the frame is split into tiles; each is a κ. Only CHANGED tiles re-upload
//                   to the GPU (O(1) rebind for the rest); a static screen costs ~0 work.
//   • super-res   — a WebGPU **Catmull-Rom bicubic** upscaler (sharp, edge-preserving, with a
//                   light unsharp pass) renders crisply to full res. (The slot where
//                   hologram-backend's learned kernels drop in for true neural super-res.)
//   • retina/8K   — the output renders at devicePixelRatio × CSS size, capped at the GPU's
//                   max texture dim (≈8K), so it's pixel-crisp on high-DPI displays.
//
// Engine-agnostic: feed it any RGBA framebuffer (v86 canvas, qemu virtio-gpu scanout, …).

const WGSL = `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;          // nearest — we do the interpolation ourselves
@group(0) @binding(2) var<uniform> sharpen: f32;
struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>,3>(vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
  var o: VSOut; o.pos = vec4<f32>(p[i], 0.0, 1.0);
  o.uv = vec2<f32>((p[i].x+1.0)*0.5, (1.0-p[i].y)*0.5); return o;
}
// Catmull-Rom (a = -0.5): interpolating + slight negative lobes ⇒ SHARP, no blur.
fn cr(x: f32) -> f32 {
  let a = -0.5; let ax = abs(x);
  if (ax < 1.0) { return (a+2.0)*ax*ax*ax - (a+3.0)*ax*ax + 1.0; }
  if (ax < 2.0) { return a*ax*ax*ax - 5.0*a*ax*ax + 8.0*a*ax - 4.0*a; }
  return 0.0;
}
fn tap(uv: vec2<f32>) -> vec4<f32> { return textureSampleLevel(src, samp, uv, 0.0); }
@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let dim = vec2<f32>(textureDimensions(src));
  let inv = 1.0/dim;
  let c = in.uv*dim - 0.5;
  let base = floor(c);
  let f = c - base;
  var col = vec4<f32>(0.0); var wsum = 0.0;
  for (var m = -1; m <= 2; m = m + 1) {
    let wy = cr(f.y - f32(m));
    for (var n = -1; n <= 2; n = n + 1) {
      let w = cr(f.x - f32(n)) * wy;
      let p = (base + vec2<f32>(f32(n), f32(m)) + 0.5) * inv;
      col = col + w * tap(p); wsum = wsum + w;
    }
  }
  col = col / wsum;
  // light unsharp mask: pull away from a 1-texel box blur for extra crispness on text/edges.
  if (sharpen > 0.0) {
    let b = (tap((base+vec2<f32>(0.5,0.5))*inv) + tap((base+vec2<f32>(1.5,0.5))*inv)
           + tap((base+vec2<f32>(0.5,1.5))*inv) + tap((base+vec2<f32>(1.5,1.5))*inv)) * 0.25;
    col = clamp(col + (col - b) * sharpen, vec4<f32>(0.0), vec4<f32>(1.0));
  }
  return vec4<f32>(col.rgb, 1.0);
}`;

export class KappaCompositor {
  constructor(canvas, { tile = 32, sharpen = 0.6, maxDim = 8192 } = {}) {
    this.canvas = canvas; this.tile = tile; this.sharpenAmt = sharpen; this.maxDim = maxDim;
    this.device = null; this.ctx = null; this.tex = null;
    this.w = 0; this.h = 0; this.cols = 0; this.rows = 0; this.tileHash = null;
    this.stats = { frames: 0, dirtyTiles: 0, totalTiles: 0, dedupPct: 0, fps: 0, outW: 0, outH: 0 };
    this._last = 0;
  }

  async init() {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    this.maxDim = Math.min(this.maxDim, adapter.limits.maxTextureDimension2D);
    this.device = await adapter.requestDevice();
    this.ctx = this.canvas.getContext("webgpu");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.format, alphaMode: "opaque" });
    this.sampler = this.device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
    this.ubo = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.ubo, 0, new Float32Array([this.sharpenAmt]));
    const mod = this.device.createShaderModule({ code: WGSL });
    this.pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module: mod, entryPoint: "vs" },
      fragment: { module: mod, entryPoint: "fs", targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list" },
    });
    this.resizeToDisplay();
    return this;
  }

  // Size the output backing store to PHYSICAL pixels (retina/8K-crisp), capped at the GPU max.
  resizeToDisplay(dpr = (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1) {
    const cssW = this.canvas.clientWidth || 1024, cssH = this.canvas.clientHeight || 768;
    this.canvas.width = Math.min(this.maxDim, Math.round(cssW * dpr));
    this.canvas.height = Math.min(this.maxDim, Math.round(cssH * dpr));
    this.stats.outW = this.canvas.width; this.stats.outH = this.canvas.height;
  }

  // Explicit output size — for an OffscreenCanvas in a Worker (no DOM/devicePixelRatio).
  setOutputResolution(w, h) {
    this.canvas.width = Math.min(this.maxDim, Math.round(w));
    this.canvas.height = Math.min(this.maxDim, Math.round(h));
    this.stats.outW = this.canvas.width; this.stats.outH = this.canvas.height;
  }

  setSource(w, h) {
    this.w = w; this.h = h;
    this.cols = Math.ceil(w / this.tile); this.rows = Math.ceil(h / this.tile);
    this.tileHash = new Uint32Array(this.cols * this.rows).fill(0xffffffff);
    this.tex = this.device.createTexture({
      size: [w, h], format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.bind = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.tex.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.ubo } },
      ],
    });
  }

  setSharpen(amt) { this.sharpenAmt = amt; this.device.queue.writeBuffer(this.ubo, 0, new Float32Array([amt])); }

  _tileKappa(src, tx, ty) {
    let h = 2166136261 >>> 0;
    const x0 = tx * this.tile, y0 = ty * this.tile;
    const xe = Math.min(x0 + this.tile, this.w), ye = Math.min(y0 + this.tile, this.h);
    for (let y = y0; y < ye; y++) {
      let o = (y * this.w + x0) * 4;
      for (let x = x0; x < xe; x++) { h ^= src[o] ^ (src[o + 1] << 8) ^ (src[o + 2] << 16); h = Math.imul(h, 16777619); o += 4; }
    }
    return h >>> 0;
  }

  present(src) {
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (this._last) { const inst = 1000 / Math.max(0.001, now - this._last); this.stats.fps = this.stats.fps ? this.stats.fps * 0.9 + inst * 0.1 : inst; }
    this._last = now;

    let dirty = 0;
    for (let ty = 0; ty < this.rows; ty++) for (let tx = 0; tx < this.cols; tx++) {
      const k = this._tileKappa(src, tx, ty);
      const idx = ty * this.cols + tx;
      if (k !== this.tileHash[idx]) {
        this.tileHash[idx] = k;
        const x0 = tx * this.tile, y0 = ty * this.tile;
        const tw = Math.min(this.tile, this.w - x0), th = Math.min(this.tile, this.h - y0);
        const region = new Uint8Array(tw * th * 4);
        for (let y = 0; y < th; y++) region.set(src.subarray(((y0 + y) * this.w + x0) * 4, ((y0 + y) * this.w + x0) * 4 + tw * 4), y * tw * 4);
        this.device.queue.writeTexture({ texture: this.tex, origin: [x0, y0] }, region, { bytesPerRow: tw * 4, rowsPerImage: th }, [tw, th]);
        dirty++;
      }
    }

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.bind); pass.draw(3); pass.end();
    this.device.queue.submit([enc.finish()]);

    this.stats.frames++; this.stats.dirtyTiles = dirty; this.stats.totalTiles = this.cols * this.rows;
    this.stats.dedupPct = Math.round(100 * (1 - dirty / this.stats.totalTiles));
    return this.stats;
  }
}
