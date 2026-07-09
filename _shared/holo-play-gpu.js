// holo-play-gpu.js — WebGPU ambient backdrop for the Play honeycomb (the Living Map).
// A hue-aware, slowly drifting nebula field rendered BEHIND the hex wall, so the map reads as a deep,
// HD, parallaxed space rather than a flat panel. Follows the SAME contract + discipline as the rest of
// the WebGPU render-substrate (holo-cosmos-gpu.js / holo-clouds-gpu.js):
//
//   HoloPlayGPU.start(canvas, { reduced, hue }) -> { setView, setHue, resize, stop } | null   (null ⇒ no GPU)
//
//   • Contract-preserving & sync: a one-time async probe caches a GPUDevice; start() only runs once
//     gpuAvailable() is true, so the caller can keep a pure CSS gradient as the honest fallback (the
//     #room[data-layout=honeycomb] radial-gradient) when this returns null — nothing to re-vendor.
//   • Parallax seam: setView(x,y,z) feeds the live camera so the field drifts UNDER the wall as you pan
//     and breathes with zoom (depth), with no extra rAF coupling — one internal loop owns the clock.
//   • Verifiable (Law L5): renderOnce() reads pixels back via copyTextureToBuffer, mirroring the cosmos
//     witness, so the shader is measurable pixel-for-pixel in CI.

// ── WGSL: a full-screen triangle + an fbm nebula. Uniforms packed into two vec4s to dodge std140 traps:
//    a=(resX,resY,time,reduced)  b=(viewX,viewY,zoom,hue). Kept DARK (max ~0.16) so hexes stay legible. ──
export const WGSL = `
struct U { a: vec4<f32>, b: vec4<f32> };
@group(0) @binding(0) var<uniform> u: U;

fn hash2(p0: vec2<f32>) -> f32 { var p3 = fract(vec3<f32>(p0.x, p0.y, p0.x) * 0.1031); p3 = p3 + dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p); var f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2<f32>(1.0,0.0)), f.x), mix(hash2(i + vec2<f32>(0.0,1.0)), hash2(i + vec2<f32>(1.0,1.0)), f.x), f.y);
}
fn fbm(p0: vec2<f32>) -> f32 { var a = 0.5; var s = 0.0; var p = p0; for (var i: i32 = 0; i < 5; i = i + 1) { s = s + a * noise(p); p = p * 2.02 + vec2<f32>(3.1, 1.7); a = a * 0.5; } return s; }
// hue (0..360) → rgb
fn hue2rgb(h: f32) -> vec3<f32> { let k = (h / 60.0) % 6.0; let x = vec3<f32>(0.0, 2.0, 4.0); return clamp(abs(((k + x) % 6.0) - 3.0) - 1.0, vec3<f32>(0.0), vec3<f32>(1.0)); }

@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) posIn: vec4<f32>) -> @location(0) vec4<f32> {
  let res = u.a.xy; let t = u.a.z; let reduced = u.a.w;
  let viewOff = u.b.xy; let zoom = max(0.15, u.b.z); let hue = u.b.w;
  // normalized, aspect-correct coords centred on the screen
  let uv = (posIn.xy - 0.5 * res) / res.y;
  // parallax: the field drifts UNDER the wall (a fraction of the camera) and breathes with zoom
  let par = uv / mix(1.0, zoom, 0.35) - viewOff / res.y * 0.12;
  let drift = select(t * 0.012, 0.0, reduced > 0.5);

  let h0 = hue2rgb(hue);
  let h1 = hue2rgb(hue + 48.0);
  var col = vec3<f32>(0.010, 0.007, 0.020);                        // the near-black void (rooms pop against it)

  // two soft nebula layers, different scales + speeds → depth. Kept faint + clean.
  let n1 = fbm(par * 1.7 + vec2<f32>(drift, drift * 0.6));
  let n2 = fbm(par * 3.3 - vec2<f32>(drift * 0.7, drift));
  let neb = smoothstep(0.52, 0.98, n1) * 0.060 + smoothstep(0.60, 1.0, n2) * 0.036;
  col = col + mix(h0, h1, n2) * neb;

  // a faint central light-well for a sense of distant glow
  let g = exp(-dot(uv, uv) * 1.3) * 0.030;
  col = col + h0 * g;

  // strong vignette to the edges so the wall floats on darkness
  col = col * mix(0.42, 1.0, smoothstep(1.2, 0.12, length(uv)));
  // a whisper of dither to kill banding on the dark gradient
  col = col + (hash2(posIn.xy + t) - 0.5) * 0.012;
  return vec4<f32>(col, 1.0);
}`;

// ── one-time device probe (cached). gpuAvailable() gates start() so it stays sync. ──────────────────
let GPU_OK = null, DEVICE = null, _probe = null;
export function probe() {
  if (_probe) return _probe;
  _probe = (async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.gpu) { GPU_OK = false; return false; }
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "low-power" });
      if (!adapter) { GPU_OK = false; return false; }
      DEVICE = await adapter.requestDevice();
      GPU_OK = true; return true;
    } catch { GPU_OK = false; return false; }
  })();
  return _probe;
}
export function gpuAvailable() { return GPU_OK === true; }
export const ready = probe();

function buildPipeline(device, format) {
  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const ubuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }] });
  return { pipeline, ubuf, bind };
}
function pack(W, H, time, view, hue, reduced) {
  return new Float32Array([W, H, time, reduced ? 1 : 0, view[0] || 0, view[1] || 0, view[2] || 1, hue == null ? 200 : hue]);
}

// ── LIVE backend: one internal rAF owns the clock; the caller only feeds camera + hue ────────────────
export function start(canvas, opts = {}) {
  if (!DEVICE) return null;
  const device = DEVICE;
  const ctx = canvas.getContext("webgpu");
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });
  const { pipeline, ubuf, bind } = buildPipeline(device, format);

  const reduced = !!opts.reduced;
  let hue = opts.hue == null ? 200 : opts.hue;
  const view = [0, 0, 1];
  const DPR = () => Math.min(opts.maxScale || 2, (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1);
  const CAP = 2560;
  let W = 0, H = 0;
  function resize() {
    const r = canvas.getBoundingClientRect();
    let w = Math.max(2, Math.round((r.width || canvas.clientWidth || 320) * DPR())), h = Math.max(2, Math.round((r.height || canvas.clientHeight || 200) * DPR()));
    const m = Math.max(w, h); if (m > CAP) { const k = CAP / m; w = Math.round(w * k); h = Math.round(h * k); }
    if (w !== W || h !== H) { W = w; H = h; canvas.width = W; canvas.height = H; }
  }

  let raf = 0, t0 = 0, running = true;
  function draw(now) {
    if (!running) return;
    resize();
    if (!t0) t0 = now;
    const t = (now - t0) / 1000;
    device.queue.writeBuffer(ubuf, 0, pack(W, H, t, view, hue, reduced));
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
    device.queue.submit([enc.finish()]);
    if (reduced) { running = false; return; }   // static one-shot under reduced-motion
    raf = requestAnimationFrame(draw);
  }
  const onVis = () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf), raf = 0; } else if (running && !reduced && !raf) raf = requestAnimationFrame(draw); };
  document.addEventListener("visibilitychange", onVis);
  draw(typeof performance !== "undefined" && performance.now ? performance.now() : 0);

  return {
    setView(x, y, z) { view[0] = x; view[1] = y; view[2] = z; if (reduced && !raf) { running = true; draw(performance.now()); } },   // re-draw once if static
    setHue(h) { if (h != null) { hue = h; if (reduced && !raf) { running = true; draw(performance.now()); } } },
    resize,
    stop() { running = false; if (raf) cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis); try { ubuf.destroy(); } catch {} },
  };
}

// ── WITNESS: a deterministic single frame, read back RGBA8 top-left (mirrors cosmos.renderOnce) ───────
export async function renderOnce(canvas, params = {}) {
  await ready;
  if (!DEVICE) return null;
  const device = DEVICE;
  const W = Math.max(1, params.width | 0 || 256), H = Math.max(1, params.height | 0 || 256);
  const view = params.view || [0, 0, 1], hue = params.hue == null ? 200 : params.hue;
  const tex = device.createTexture({ size: [W, H], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const { pipeline, ubuf, bind } = buildPipeline(device, "rgba8unorm");
  device.queue.writeBuffer(ubuf, 0, pack(W, H, params.time || 0, view, hue, !!params.reduced));
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
  try { tex.destroy(); ubuf.destroy(); readBuf.destroy(); } catch {}
  return { w: W, h: H, rgba };
}

export default { start, renderOnce, probe, ready, gpuAvailable, WGSL };
