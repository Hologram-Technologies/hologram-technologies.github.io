// holo-canvas.mjs — the universal κ projection envelope for imported experiences.
//
// Any three.js / WebGL / WebGPU app served from κ inherits, with ZERO app changes:
//   • render cheap — the app draws at an INTERNAL resolution chosen for THIS device
//     (a devicePixelRatio shim, injected by the service worker before app scripts run);
//   • project sharp — its canvas is captured every frame and super-res'd (Catmull-Rom
//     upscale + CAS, the same kernel as water-projector.js / holo-render-sr.js) to the
//     display at devicePixelRatio, up to 8K.
//
// HONEST BOUNDARY: the GPU still draws every pixel. Hologram wins AROUND the draw, never
// the solve — fewer pixels drawn (internal-res), detail restored in a cheap upscale pass,
// the second viewer ~free (κ share, future phase). No hero numbers; the HUD shows the real
// internal×output px and measured fps so the win is a number, not a claim.
//
// NO-OP SAFE: no WebGPU adapter, no app canvas, or ?sr=0 ⇒ the app runs untouched.
//
// Pure parts (tierFor / scaleFor / clampOut) are node-testable — see holo-canvas-witness.mjs.

// ── device tiering (generalized from holo-water/water-tier.mjs; weaker GPU ⇒ render cheaper) ──
export const TIERS = Object.freeze({
  low:   { name: "low",   internalScale: 0.50, sharpen: 0.55, srMax: 2, ssaa: 1.0 },
  mid:   { name: "mid",   internalScale: 0.62, sharpen: 0.60, srMax: 3, ssaa: 1.15 },
  high:  { name: "high",  internalScale: 0.74, sharpen: 0.60, srMax: 3, ssaa: 1.3 },
  ultra: { name: "ultra", internalScale: 0.85, sharpen: 0.60, srMax: 4, ssaa: 1.5 },
});

// profile = { maxTextureDimension2D, isFallbackAdapter, maxBufferSize? }  (same signals as water-tier)
export function tierFor(profile) {
  const maxDim = profile?.maxTextureDimension2D ?? 0;
  const fallback = !!profile?.isFallbackAdapter;
  const bigBuf = (profile?.maxBufferSize ?? 0) >= 2 ** 30;       // ≥1 GiB buffers ⇒ a real discrete GPU
  if (fallback || maxDim < 8192) return TIERS.low;
  if (maxDim < 16384) return bigBuf ? TIERS.high : TIERS.mid;
  return bigBuf ? TIERS.ultra : TIERS.high;
}

// the internal render scale the app should use (real dpr × this). Clamped so it is always a real cut.
export function scaleFor(tier) { return Math.max(0.3, Math.min(1, tier?.internalScale ?? 1)); }

// clamp an output dimension to the GPU's max texture size (never request a texture it cannot allocate)
export function clampOut(px, maxDim = 8192) { return Math.max(16, Math.min(maxDim, Math.round(px))); }

// ── compute-memo seam (P3): the REAL O(1) (opκ,inκ)→output memo, L1 RAM + L2 durable (OPFS). ──
// Exposed to every imported experience as window.HoloMemo so deterministic precompute (env maps,
// integration LUTs, BVH) is computed once and recovered O(1) on reload — no recompute, no GPU dispatch.
// Lazy + no-op safe: a missing module path or no-OPFS degrades to null (apps just compute every time).
function makeOpfsL2() {
  let dirP = null;
  const dir = async () => (dirP ||= navigator.storage?.getDirectory?.().then((r) => r.getDirectoryHandle("holo-canvas-memo", { create: true })).catch(() => null));
  return {
    async get(hex) { try { const d = await dir(); if (!d) return null; const fh = await d.getFileHandle(hex).catch(() => null); if (!fh) return null; return new Uint8Array(await (await fh.getFile()).arrayBuffer()); } catch (e) { return null; } },
    async put(hex, bytes) { try { const d = await dir(); if (!d) return; const fh = await d.getFileHandle(hex, { create: true }); const w = await fh.createWritable(); await w.write(bytes); await w.close(); } catch (e) {} },
  };
}
let _memo = null, _memoTried = false;
export async function getSharedMemo() {
  if (_memoTried) return _memo;
  _memoTried = true;
  try {
    const { makeComputeMemo } = await import("/holo-os/system/os/usr/lib/holo/holo-compute-memo.mjs");
    _memo = makeComputeMemo({ l2: makeOpfsL2(), cap: 64 });
  } catch (e) { _memo = null; }   // module path absent (e.g. native-host mount) ⇒ seam off, envelope still skips
  return _memo;
}

// frame-coherence gate (delta-render): a frame is NOVEL unless the app issued ZERO draws since the last
// one (same draw-seq ⇒ the canvas is byte-identical ⇒ skip the super-res pass entirely). Pure → witnessed.
// seq === null ⇒ no draw-counter (e.g. a WebGPU app) ⇒ always novel (safe: never wrongly skips).
export function frameNovel(seq, lastSeq) { return seq == null || seq !== lastSeq; }

// browser: read the real adapter, then tier. No-op safe (returns null tier with no WebGPU).
export async function detectGPU() {
  if (typeof navigator === "undefined" || !navigator.gpu) return { ok: false, reason: "no-webgpu" };
  // Dawn can need a beat to enumerate its adapter on a freshly-navigated document (the GPU process inits its
  // D3D/Vulkan backend lazily) — a single early requestAdapter() may return null and WRONGLY drop us to the
  // WebGL2 path. Retry a few times so the best path (WebGPU) reliably wins the race when an adapter exists.
  // A short retry catches the quick adapter race without delaying the first paint; a slow Dawn backend init
  // (seconds, on a freshly-navigated doc) is handled by the caller upgrading from WebGL2→WebGPU when it warms.
  let adapter = null;
  for (let i = 0; i < 3 && !adapter; i++) {
    try { adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }); } catch (e) {}
    if (!adapter) await new Promise((r) => setTimeout(r, 250));
  }
  if (!adapter) return { ok: false, reason: "no-adapter" };
  const profile = {
    maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
    maxBufferSize: Number(adapter.limits.maxBufferSize ?? 0),
    isFallbackAdapter: !!adapter.isFallbackAdapter,
  };
  return { ok: true, reason: "probed", adapter, profile, tier: tierFor(profile) };
}

// ── the super-res kernel (identical WGSL to holo-render-sr.js: Catmull-Rom upscale → CAS sharpen) ──
const VS = `
struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>,3>(vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
  var o: VSOut; o.pos = vec4<f32>(p[i], 0.0, 1.0);
  o.uv = vec2<f32>((p[i].x+1.0)*0.5, (1.0-p[i].y)*0.5); return o;
}`;
const FS_UPSCALE = VS + `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
fn cr(x: f32) -> f32 { let a=-0.5; let ax=abs(x);
  if (ax<1.0){return (a+2.0)*ax*ax*ax-(a+3.0)*ax*ax+1.0;} if (ax<2.0){return a*ax*ax*ax-5.0*a*ax*ax+8.0*a*ax-4.0*a;} return 0.0; }
@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let dim=vec2<f32>(textureDimensions(src)); let inv=1.0/dim;
  let c=in.uv*dim-0.5; let base=floor(c); let f=c-base;
  var col=vec4<f32>(0.0); var ws=0.0;
  for (var m=-1;m<=2;m=m+1){ let wy=cr(f.y-f32(m));
    for (var n=-1;n<=2;n=n+1){ let w=cr(f.x-f32(n))*wy; col=col+w*textureSampleLevel(src,samp,(base+vec2<f32>(f32(n),f32(m))+0.5)*inv,0.0); ws=ws+w; } }
  return vec4<f32>((col/ws).rgb, 1.0);
}`;
const FS_CAS = VS + `
@group(0) @binding(0) var img: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> sharp: f32;
@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let dim=vec2<f32>(textureDimensions(img)); let px=1.0/dim;
  let c=textureSampleLevel(img,samp,in.uv,0.0).rgb;
  let u=textureSampleLevel(img,samp,in.uv+vec2<f32>(0.0,-px.y),0.0).rgb;
  let d=textureSampleLevel(img,samp,in.uv+vec2<f32>(0.0, px.y),0.0).rgb;
  let l=textureSampleLevel(img,samp,in.uv+vec2<f32>(-px.x,0.0),0.0).rgb;
  let r=textureSampleLevel(img,samp,in.uv+vec2<f32>( px.x,0.0),0.0).rgb;
  let mn=min(c,min(min(u,d),min(l,r))); let mx=max(c,max(max(u,d),max(l,r)));
  let amp=sqrt(clamp(min(mn, vec3<f32>(1.0)-mx)/max(mx, vec3<f32>(1e-4)), vec3<f32>(0.0), vec3<f32>(1.0)));
  let w=-amp*mix(0.1,0.25,clamp(sharp,0.0,1.0));
  let res=(c+(u+d+l+r)*w)/(vec3<f32>(1.0)+4.0*w);
  return vec4<f32>(clamp(res, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}`;

// HoloCanvas — owns its own WebGPU device, samples an external (iframe) canvas, projects to `outCanvas`.
export class HoloCanvas {
  constructor(outCanvas, { sharpen = 0.6, maxDim = 8192 } = {}) {
    this.canvas = outCanvas; this.sharpenAmt = sharpen; this.maxDim = maxDim;
    this.stats = { fps: 0, outW: 0, outH: 0, srcW: 0, srcH: 0, mode: "sr" }; this._last = 0;
  }
  async init(adapter) {
    adapter = adapter || await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("no WebGPU adapter");
    this.maxDim = Math.min(this.maxDim, adapter.limits.maxTextureDimension2D);
    this.device = await adapter.requestDevice();
    this.fmt = navigator.gpu.getPreferredCanvasFormat();
    this.ctx = this.canvas.getContext("webgpu");
    this.ctx.configure({ device: this.device, format: this.fmt, alphaMode: "opaque" });
    this.samp = this.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    this.ubo = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.ubo, 0, new Float32Array([this.sharpenAmt]));
    const mk = (code, fmt) => this.device.createRenderPipeline({ layout: "auto",
      vertex: { module: this.device.createShaderModule({ code }), entryPoint: "vs" },
      fragment: { module: this.device.createShaderModule({ code }), entryPoint: "fs", targets: [{ format: fmt }] },
      primitive: { topology: "triangle-list" } });
    this.pUpscale = mk(FS_UPSCALE, "rgba8unorm");   // pass 1 → intermediate texA
    this.pCas = mk(FS_CAS, this.fmt);               // pass 2 (sharpen) → canvas
    this.pBicubic = mk(FS_UPSCALE, this.fmt);       // A/B baseline: bicubic-only → canvas
    return this;
  }
  setOutput(w, h) {
    const W = clampOut(w, this.maxDim), H = clampOut(h, this.maxDim);
    if (W === this.stats.outW && H === this.stats.outH && this.texA) return;
    this.stats.outW = this.canvas.width = W; this.stats.outH = this.canvas.height = H;
    this.texA = this.device.createTexture({ size: [W, H], format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    this._rebindCas();
  }
  _rebindCas() {
    if (!this.texA) return;
    this.bCas = this.device.createBindGroup({ layout: this.pCas.getBindGroupLayout(0), entries: [
      { binding: 0, resource: this.texA.createView() }, { binding: 1, resource: this.samp },
      { binding: 2, resource: { buffer: this.ubo } }] });
  }
  _setSource(w, h) {
    this.stats.srcW = w; this.stats.srcH = h;
    this.srcTex = this.device.createTexture({ size: [w, h], format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    this.bUpscale = this.device.createBindGroup({ layout: this.pUpscale.getBindGroupLayout(0), entries: [
      { binding: 0, resource: this.srcTex.createView() }, { binding: 1, resource: this.samp }] });
  }
  _draw(pipeline, bind, view) {
    const e = this.device.createCommandEncoder();
    const p = e.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
    p.setPipeline(pipeline); p.setBindGroup(0, bind); p.draw(3); p.end();
    this.device.queue.submit([e.finish()]);
  }
  // capture a live (same-origin) canvas and project it. mode: "sr" | "bicubic" | "off"(=bicubic 1:1).
  present(srcCanvas, mode = "sr") {
    const now = performance.now();
    if (this._last) { const i = 1000 / Math.max(0.001, now - this._last); this.stats.fps = this.stats.fps ? this.stats.fps * 0.9 + i * 0.1 : i; }
    this._last = now; this.stats.mode = mode;
    const w = srcCanvas.width || srcCanvas.videoWidth || 0, h = srcCanvas.height || srcCanvas.videoHeight || 0;
    if (!w || !h || !this.texA) return this.stats;
    if (w !== this.stats.srcW || h !== this.stats.srcH) this._setSource(w, h);
    try { this.device.queue.copyExternalImageToTexture({ source: srcCanvas, flipY: false }, { texture: this.srcTex }, [w, h]); }
    catch (e) { this.stats.captureErr = String(e?.message || e).slice(0, 80); return this.stats; }
    if (mode === "bicubic") this._draw(this.pBicubic, this.bUpscale, this.ctx.getCurrentTexture().createView());
    else { this._draw(this.pUpscale, this.bUpscale, this.texA.createView()); this._draw(this.pCas, this.bCas, this.ctx.getCurrentTexture().createView()); }
    return this.stats;
  }
  setSharpen(a) { this.sharpenAmt = a; this.device.queue.writeBuffer(this.ubo, 0, new Float32Array([a])); }
  destroy() { try { this.device?.destroy?.(); } catch (e) {} }
}

// ── the drop-in: wrap an <iframe> running an imported app. Returns a controller (no-op safe). ──
// opts: { sr?: HoloCanvas-config, query?: URLSearchParams, onStats?: fn }  — `gpu` from detectGPU().
export function mountEnvelope({ iframe, outCanvas, gpu, query, onStats } = {}) {
  const off = { active: false, reason: "", stop() {}, setMode() {}, stats: null };
  if (!gpu?.ok) { off.reason = gpu?.reason || "no-gpu"; return off; }
  if (query && query.get("sr") === "0") { off.reason = "disabled"; return off; }

  const dpr = Math.min((typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1), 2);
  const tier = gpu.tier;
  // SSAA — the GPU is vsync-capped (it coasts well under its ceiling), so spend that headroom on QUALITY: render
  // the super-res output ABOVE the display size and let the canvas downscale to the window = supersampled
  // anti-aliasing (cleaner edges on high-contrast detail: fractal filaments, sphere rims, water lines). The
  // app's cheap internal render is unchanged; only the projection target grows. ?ss=<f> overrides the tier.
  const ssaa = Math.max(1, Math.min(2, parseFloat(query && query.get("ss")) || tier.ssaa || 1));
  let mode = (query && query.get("mode")) || "sr";
  let comp = null, raf = 0, stopped = false, appCanvas = null, poll = 0;

  let _cap = null, _capCtx = null;
  const ctl = {
    active: true, reason: "projecting", tier, dpr, stats: null, appCanvas: null,
    setMode(m) { mode = m; },
    toggle() { mode = mode === "sr" ? "bicubic" : mode === "bicubic" ? "off" : "sr"; return mode; },
    // capture the app's current frame as RGBA (downscaled so max side ≤ maxDim) — the share producer's source
    capture(maxDim = 720) {
      try {
        const cv = appCanvas; if (!cv || !cv.width) return null;
        const s = Math.min(1, maxDim / Math.max(cv.width, cv.height));
        const w = Math.max(1, Math.round(cv.width * s)), h = Math.max(1, Math.round(cv.height * s));
        if (!_cap || _cap.width !== w || _cap.height !== h) { _cap = new OffscreenCanvas(w, h); _capCtx = _cap.getContext("2d", { willReadFrequently: true }); }
        _capCtx.drawImage(cv, 0, 0, w, h);
        return { rgba: new Uint8Array(_capCtx.getImageData(0, 0, w, h).data.buffer), w, h };
      } catch (e) { return null; }
    },
    stop() { stopped = true; cancelAnimationFrame(raf); clearInterval(poll); comp?.destroy(); ctl.active = false; },
  };

  // the iframe ELEMENT bg is opaque by default — clear it so the SR canvas behind shows through
  try { iframe.style.background = "transparent"; } catch (e) {}

  (async () => {
    comp = await new HoloCanvas(outCanvas, { sharpen: tier.sharpen, maxDim: gpu.profile.maxTextureDimension2D }).init(gpu.adapter);
    // Match the SR output canvas to the APP canvas's on-screen rect (position + size), so the projection
    // overlays the app EXACTLY — same aspect, same position. Without this, an app that doesn't fill the window
    // (e.g. a sim that sizes its canvas to < window to leave room for a side UI panel) gets STRETCHED to the
    // window, which distorts the image AND breaks interaction: clicks on the visible scene then map to the
    // wrong app-canvas coordinate and raycasts miss. A full-window app (canvas == window) is unaffected.
    const sizeOut = () => {
      let left = 0, top = 0, W = window.innerWidth || 16, H = window.innerHeight || 16;
      if (appCanvas) {
        try { const ir = iframe.getBoundingClientRect(), r = appCanvas.getBoundingClientRect();
          left = ir.left + r.left; top = ir.top + r.top; W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height)); } catch (e) {}
      }
      outCanvas.style.position = "fixed"; outCanvas.style.left = left + "px"; outCanvas.style.top = top + "px";
      outCanvas.style.right = "auto"; outCanvas.style.bottom = "auto"; outCanvas.style.width = W + "px"; outCanvas.style.height = H + "px";
      comp.setOutput(W * dpr * ssaa, H * dpr * ssaa);   // backing > display size ⇒ the canvas downscales = SSAA
      comp.stats.ssaa = ssaa;
    };
    sizeOut();
    window.addEventListener("resize", sizeOut);

    // find the imported app's main canvas (same-origin: served by our SW), then project it every frame.
    poll = setInterval(() => {
      let cv = null; try { cv = iframe.contentDocument?.querySelector("canvas"); } catch (e) {}
      if (cv && cv.width > 2 && cv.height > 2) {
        clearInterval(poll); appCanvas = cv; ctl.appCanvas = cv;
        // keep the app canvas interactive + rendering, but invisible: the SR canvas behind shows the
        // sharp result; opacity:0 still hit-tests (interactions intact) and still renders (capturable).
        try {
          appCanvas.style.opacity = "0";
          const doc = iframe.contentDocument;
          doc.documentElement.style.background = "transparent";
          if (doc.body) doc.body.style.background = "transparent";
        } catch (e) {}
        sizeOut();   // now that the app canvas exists, overlay the SR onto its exact rect (not the whole window)
        try { const _ro = new ResizeObserver(() => sizeOut()); _ro.observe(appCanvas); } catch (e) {}   // track the app resizing its canvas
        // expose the O(1) compute-memo seam to the imported app (window.HoloMemo + resolve its ready promise)
        getSharedMemo().then((m) => { ctl.memo = m; try { const w = iframe.contentWindow; if (w) { w.HoloMemo = m; w.__holoMemoResolve?.(m); } } catch (e) {} });
        // frame-coherence loop: skip the super-res pass on frames the app didn't redraw (idle/paused = 0 GPU)
        let lastSeq = -1, presented = 0, skipped = 0;
        const readSeq = () => { try { const v = iframe.contentWindow?.__holoSeq; return typeof v === "number" ? v : null; } catch (e) { return null; } };
        const loop = () => {
          if (stopped) return;
          const seq = readSeq();
          if (frameNovel(seq, lastSeq)) { try { comp.present(appCanvas, mode); } catch (e) {} lastSeq = seq; presented++; }
          else skipped++;
          ctl.stats = comp.stats; ctl.stats.presented = presented; ctl.stats.skipped = skipped;
          onStats?.(ctl.stats, tier, mode);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      }
    }, 60);
    setTimeout(() => clearInterval(poll), 25000);
  })().catch((e) => { ctl.reason = "init-failed: " + (e?.message || e); ctl.active = false; });

  return ctl;
}
