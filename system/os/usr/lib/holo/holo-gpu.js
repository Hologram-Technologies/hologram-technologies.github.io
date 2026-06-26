// holo-gpu.js — the Hologram OS native WebGPU present layer for video.
//
// Renders a decoded <video> through a WebGPU pipeline ZERO-COPY: the frame is
// imported as a `texture_external` (no readback, no CPU copy) and drawn at the
// device's real pixels. Two things make it "native":
//
//   • O(1) compute, the hologram way (github.com/Hologram-Technologies/hologram):
//     the color/tone transform is a function over a FINITE quantized domain (RGB),
//     so we MATERIALIZE it once as a precomputed 32³ 3-D lookup table and DISPATCH
//     it per pixel in O(1) — a single trilinear texture fetch — instead of
//     recomputing transcendental tone math every pixel every frame. The table is
//     "addressed once and reused": it carries a UOR-ADDR κ-label (sha256 of its
//     bytes); an identical grade is the same κ, built once, replayed forever.
//
//   • zero-copy GPU compositing: importExternalTexture keeps the decoder's frame on
//     the GPU; we sample it directly. The holographic overlay (chromatic shimmer,
//     scanlines, bloom, grain) is all in one fragment shader pass.
//
// Degrades cleanly: if `navigator.gpu` is absent, attach() returns null and the
// caller keeps the plain <video> — so it runs in ANY browser. Reusable across
// holospaces (same _shared/ convention as game-frame.js).

(function () {
  "use strict";
  const W = window;
  if (W.HoloGPU) return;

  // ── the precomputed, content-addressed color grade (the O(1) LUT) ────────────
  // A 32³ RGBA8 table: filmic tone (ACES approx) + a gentle teal/orange cinematic
  // split. Built ONCE on the CPU, hashed (κ), uploaded as a 3-D texture, then every
  // pixel of every frame is one fetch. This IS the hologram "finite-domain function
  // → table → O(1) dispatch" idea, applied to pixels.
  const N = 32;
  function buildLUT() {
    const data = new Uint8Array(N * N * N * 4);
    const aces = (x) => { const v = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); return v < 0 ? 0 : v > 1 ? 1 : v; };
    const c255 = (x) => (x < 0 ? 0 : x > 1 ? 255 : (x * 255 + 0.5) | 0);
    let i = 0;
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      let R = aces(r / (N - 1)), G = aces(g / (N - 1)), B = aces(b / (N - 1));
      const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;        // tasteful split-tone
      const warm = lum, cool = 1 - lum;
      R = R * (1 + 0.07 * warm - 0.035 * cool);
      G = G * (1 + 0.015 * warm);
      B = B * (1 + 0.07 * cool - 0.035 * warm);
      const sat = 1.12, m = 0.2126 * R + 0.7152 * G + 0.0722 * B; // gentle saturation
      R = m + (R - m) * sat; G = m + (G - m) * sat; B = m + (B - m) * sat;
      data[i++] = c255(R); data[i++] = c255(G); data[i++] = c255(B); data[i++] = 255;
    }
    return data;
  }
  async function kappaOf(u8) {
    try { const d = await crypto.subtle.digest("SHA-256", u8);
      return "sha256:" + Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join(""); }
    catch { return ""; }
  }

  const WGSL = `
struct U { res: vec2f, time: f32, fx: f32, grade: f32, sr: f32, src: vec2f };
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var frame: texture_external;
@group(0) @binding(2) var lut: texture_3d<f32>;
@group(0) @binding(3) var lutSamp: sampler;
@group(0) @binding(4) var<uniform> u: U;

struct VsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  var p = array<vec2f,3>(vec2f(-1.0,-1.0), vec2f(3.0,-1.0), vec2f(-1.0,3.0));
  var o: VsOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv  = p[i] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return o;
}
fn frm(uv: vec2f) -> vec3f { return textureSampleBaseClampToEdge(frame, samp, uv).rgb; }
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }

// ── GPU super-resolution: real Lanczos-2 reconstruction + edge-directed detail ──
// When the source rendition (u.src) is smaller than the present canvas (u.res), a
// 16-tap windowed-sinc (Lanczos a=2) reconstructs the frame toward native pixels —
// far more faithful than the GPU's bilinear default. The edge-directed step then
// emphasizes exactly the high-frequency detail Lanczos recovered over bilinear
// (l - b), so edges sharpen without ringing the flats. 1080p → 4K, on the GPU.
fn sinc(x: f32) -> f32 { if (abs(x) < 1e-6) { return 1.0; } let p = 3.14159265359 * x; return sin(p) / p; }
fn lw(x: f32) -> f32 { if (abs(x) >= 2.0) { return 0.0; } return sinc(x) * sinc(x * 0.5); }
fn lanczos(uv: vec2f) -> vec3f {
  let tex = max(u.src, vec2f(1.0, 1.0));
  let coord = uv * tex - vec2f(0.5, 0.5);
  let base = floor(coord);
  let f = coord - base;
  var acc = vec3f(0.0, 0.0, 0.0);
  var wsum = 0.0;
  for (var j: i32 = -1; j <= 2; j = j + 1) {
    let wy = lw(f.y - f32(j));
    for (var i: i32 = -1; i <= 2; i = i + 1) {
      let w = lw(f.x - f32(i)) * wy;
      let suv = (base + vec2f(f32(i), f32(j)) + vec2f(0.5, 0.5)) / tex;
      acc = acc + frm(suv) * w;
      wsum = wsum + w;
    }
  }
  return acc / max(wsum, 1e-4);
}
fn srSample(uv: vec2f) -> vec3f {
  if (u.sr < 0.5) { return frm(uv); }
  let l = lanczos(uv);
  let b = frm(uv);
  return clamp(l + (l - b) * 0.6, vec3f(0.0, 0.0, 0.0), vec3f(1.0, 1.0, 1.0));
}

@fragment fn fs(in: VsOut) -> @location(0) vec4f {
  let uv = in.uv;
  let fx = u.fx;
  var col = srSample(uv);
  if (fx > 0.001) {
    // zero-copy chromatic aberration — grows toward the edges (lens feel)
    let c = uv - vec2f(0.5);
    let amt = (0.0012 + 0.0040 * fx) * (0.35 + dot(c, c) * 2.2);
    let dir = normalize(c + vec2f(1e-5, 1e-5));
    col = vec3f(srSample(uv + dir * amt).r, col.g, srSample(uv - dir * amt).b);
  }
  // O(1) color-grade: ONE trilinear fetch into the precomputed 3-D table.
  let graded = textureSample(lut, lutSamp, clamp(col, vec3f(0.0), vec3f(1.0))).rgb;
  col = mix(col, graded, u.grade);
  if (fx > 0.001) {
    let sl = 0.5 + 0.5 * sin(uv.y * u.res.y * 1.4 - u.time * 7.0);    // scanlines
    col *= (1.0 - 0.09 * fx) + 0.09 * fx * sl;
    let lum = dot(col, vec3f(0.2126, 0.7152, 0.0722));               // bloom on highlights
    col += fx * 0.22 * smoothstep(0.72, 1.0, lum) * vec3f(0.35, 0.65, 1.0);
    let c2 = uv - vec2f(0.5);                                        // vignette
    col *= 1.0 - fx * 0.45 * dot(c2, c2);
    col += (hash(uv * u.res + vec2f(u.time, u.time)) - 0.5) * 0.035 * fx; // grain
  }
  return vec4f(col, 1.0);
}`;

  // ── attach(video, canvas, opts) → controller | null (null ⇒ no WebGPU) ───────
  async function attach(video, canvas, opts) {
    opts = opts || {};
    if (!navigator.gpu) return null;
    let adapter, device;
    try {
      adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) return null;
      device = await adapter.requestDevice();
    } catch { return null; }

    const ctx = canvas.getContext("webgpu");
    if (!ctx) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "opaque" });

    // Robustness: a heavy super-res frame can lose the device (Dawn/D3D12 TDR). Catch it so it
    // DEGRADES instead of crashing — the caller's onLost falls back to the plain <video>. Errors are
    // also stashed on window so a poll can read the cause even if the host dies before console flushes.
    let lost = false;
    try {
      device.lost.then((info) => {
        lost = true;
        try { W.__holoGpuLost = { reason: (info && info.reason) || "unknown", message: (info && info.message) || "" }; } catch {}
        console.error("[holo-gpu] DEVICE LOST:", info && info.reason, info && info.message);
        try { opts.onLost && opts.onLost(info); } catch {}
      });
    } catch {}
    try {
      device.addEventListener("uncapturederror", (e) => {
        const msg = (e && e.error && e.error.message) || String(e);
        try { W.__holoGpuErr = msg; } catch {}
        console.error("[holo-gpu] uncaptured GPU error:", msg);
      });
    } catch {}

    const module = device.createShaderModule({ code: WGSL });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });

    const samp = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    const lutSamp = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", addressModeW: "clamp-to-edge" });

    const lutData = buildLUT();
    const lutKappa = await kappaOf(lutData);          // the transform's UOR-ADDR κ-label
    const lutTex = device.createTexture({
      dimension: "3d", size: [N, N, N], format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: lutTex }, lutData, { bytesPerRow: N * 4, rowsPerImage: N }, [N, N, N]);
    const lutView = lutTex.createView({ dimension: "3d" });

    const ubo = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const u = new Float32Array(8);

    const state = { fx: opts.fx || 0, grade: opts.grade == null ? 0.4 : opts.grade, sr: opts.sr ? 1 : 0, alive: true, frames: 0, t0: performance.now() };
    // Device-native target: reconstruct at the display's TRUE pixels (up to maxDpr) so a
    // 4K/8K panel gets a genuine 4K/8K Lanczos reconstruction — then auto-throttle to keep
    // it smooth (drop the scale if the GPU can't sustain ~60fps, climb back when it can).
    // The caller (player) sets maxDpr per device class (desktop high · mobile/Save-Data low).
    let maxDpr = Math.max(1, opts.maxDpr || 3);
    let scale = 1;                                     // adaptive 0.5..1, driven by measured fps
    const targetDpr = () => Math.min(window.devicePixelRatio || 1, maxDpr) * scale;
    // Super-res is a 16-tap external-texture reconstruction PER output pixel; at a large backing it can
    // exceed the GPU's frame-time budget and trigger a TDR/device-loss that takes the process down. Cap
    // the super-res OUTPUT to a safe pixel budget (≈1920×1200; tune via opts.srMaxPx) so the cost stays
    // bounded regardless of window/display size. Without super-res the fragment is one fetch → no cap.
    const SR_MAX_PX = Math.max(262144, +opts.srMaxPx || 2304000);
    function size() {
      let w = Math.max(1, Math.round(canvas.clientWidth * targetDpr()));
      let h = Math.max(1, Math.round(canvas.clientHeight * targetDpr()));
      if (state.sr && w * h > SR_MAX_PX) {
        const k = Math.sqrt(SR_MAX_PX / (w * h));      // scale both dims to fit the budget
        w = Math.max(1, Math.round(w * k));
        h = Math.max(1, Math.round(h * k));
      }
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }
    const ro = new ResizeObserver(size); ro.observe(canvas); size();
    let winF = 0, winT = performance.now(), winFps = 60, lowSecs = 0, srEased = false;
    function throttle() {                              // rolling-fps adaptive resolution + escalating fallback
      winF++; const now = performance.now(), dt = now - winT;
      if (dt < 1000) return;
      winFps = winF * 1000 / dt; winF = 0; winT = now;
      if (winFps < 45 && scale > 0.5) scale = Math.max(0.5, scale * 0.85);
      else if (winFps > 57 && scale < 1) scale = Math.min(1, scale * 1.08);
      // Escalating fallback: scaling the backing isn't enough if the GPU can't sustain the 16-tap super-res loop
      // — a stuttering enhanced canvas over a SMOOTH <video> reads as "laggy". So when fps stays low at the scale
      // floor, EASE OFF super-res (the fragment becomes a single fetch — cheap), and if it is STILL low, hand back
      // to the plain <video> entirely. Persist the ease-off PER GPU (holo.sr.laggy) so the NEXT play starts smooth
      // — exactly one laggy play on a weak GPU, then never again. A capable GPU never trips this and keeps super-res.
      if (winFps < 42) {
        lowSecs++;
        if (state.sr && !srEased && lowSecs >= 3) {
          state.sr = 0; srEased = true; scale = 1;
          try { localStorage.setItem("holo.sr.laggy", "1"); } catch {}
          if (opts.onSrEased) try { opts.onSrEased(); } catch {}
        } else if (lowSecs >= 7 && opts.onLost) {
          try { opts.onLost(); } catch {}
        }
      } else if (winFps > 50) { lowSecs = 0; }
    }

    function drawFrame() {
      if (lost) return false;                           // device gone → the caller's <video> plays on
      size();                                           // self-heal backing ↔ CSS each frame
      if (video.readyState < 2) return false;           // no frame to import yet
      let ext;
      try { ext = device.importExternalTexture({ source: video }); } catch { return false; }
      u[0] = canvas.width; u[1] = canvas.height;
      u[2] = (performance.now() - state.t0) / 1000;
      u[3] = state.fx; u[4] = state.grade;
      u[5] = state.sr;                                  // super-resolution on/off
      u[6] = video.videoWidth || canvas.width;         // source rendition size (for Lanczos)
      u[7] = video.videoHeight || canvas.height;
      device.queue.writeBuffer(ubo, 0, u);
      // External textures expire after submit → rebuild the bind group each frame.
      const bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: samp },
          { binding: 1, resource: ext },
          { binding: 2, resource: lutView },
          { binding: 3, resource: lutSamp },
          { binding: 4, resource: { buffer: ubo } },
        ],
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
      device.queue.submit([enc.finish()]);
      state.frames++; throttle();
      return true;
    }
    function render() { if (!state.alive) return; requestAnimationFrame(render); drawFrame(); }
    requestAnimationFrame(render);

    return {
      lutKappa, lutSize: N, adapter: (adapter.info || {}),
      renderNow: () => drawFrame(),                     // force one frame (testing / snapshot)
      setFx: (v) => { state.fx = Math.max(0, Math.min(1, +v || 0)); },
      setGrade: (v) => { state.grade = Math.max(0, Math.min(1, +v || 0)); },
      setSR: (on) => { state.sr = on ? 1 : 0; },
      setMaxDpr: (v) => { maxDpr = Math.max(1, +v || 3); scale = 1; size(); },
      get fx() { return state.fx; }, get grade() { return state.grade; }, get sr() { return state.sr; },
      get srcSize() { return [video.videoWidth || 0, video.videoHeight || 0]; },
      get target() { return [canvas.width, canvas.height]; },   // effective reconstructed output pixels
      get winFps() { return Math.round(winFps); }, get scale() { return +scale.toFixed(2); }, get maxDpr() { return maxDpr; },
      get frames() { return state.frames; },
      get fps() { return state.frames / Math.max(0.001, (performance.now() - state.t0) / 1000); },
      dispose: () => { state.alive = false; try { ro.disconnect(); } catch {} try { device.destroy(); } catch {} },
    };
  }

  W.HoloGPU = { attach, available: () => !!navigator.gpu, lutSize: N };
})();
