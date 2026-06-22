// holo-asanoha-gpu.js — WebGPU wallpaper: the asanoha (Japanese hemp-leaf) lattice, rendered as an
// ANALYTIC signed-distance field (no texture, no raster). Because the geometry is solved per-pixel from
// the triangular lattice, it is razor-sharp at ANY DPR / zoom — never aliases, never blurs. The style is
// tuned to the Vector-Equilibrium reference: uniform monoline strokes, point-up stars, a flat clean field,
// a node centered on screen. Light pulses subtly outward from each star center; a sparse few intersections
// flare with thin-film iridescence. Precise, beautiful, immersive — boots instantly (zero assets ⇒ tiny κ).
//
// Mirrors the render-substrate module contract (see holo-clouds-gpu.js):
//   HoloAsanohaGPU.createBackground(canvas, opts) -> { resize, setSpeed, setPointer, painted, errored, stop } | null
//   HoloAsanohaGPU.renderOnce(canvas, { width, height, iTime, ...overrides }) -> { w, h, rgba }   (witness)
//   probe() / ready / gpuAvailable() / setDevice(dv)   — shares the shell's GPUDevice
//
// GEOMETRY — the lattice is folded into one equilateral cell with the 2-D simplex skew (F2/G2), giving
// per-pixel barycentric coords (u,v,w). From those three scalars the whole motif is exact:
//   edges  = min(u,v,w)              → the triangular grid (the spokes BETWEEN star centers)
//   medians= min(|u-v|,|v-w|,|w-u|)  → the three altitudes per triangle (the hemp-leaf interior lines)
//   node   = 1 - max(u,v,w)          → 0 at a lattice vertex (a six-pointed star center)
// Lines are anti-aliased in screen space via fwidth() of those fields — that derivative is what keeps the
// linework crisp regardless of resolution, where a baked image would shimmer. The lattice is rotated 90°
// so a vertical spoke runs through each star (point-up), matching the facade / VE orientation.

export const DEFAULTS = {
  base:  [0x1c / 255, 0x1f / 255, 0x24 / 255], // matte charcoal-graphite field
  gold:  [0xc9 / 255, 0xa9 / 255, 0x6a / 255], // (unused in the minimal single-tone build)
  plat:  [0xd8 / 255, 0xdd / 255, 0xe3 / 255], // cool platinum lines
  density: 9.0,    // lattice cells across the short dimension — bigger ⇒ finer mesh
  line: 0.008,     // line half-width in barycentric units (AA widens it by one screen pixel) — thin & uniform
  glow: 0.8,       // emissive strength of the flowing light + node flares (kept calm for a clean read)
  irid: 0.45,      // thin-film iridescence amount at the sparse flaring intersections
  vignette: 0.18,  // faint corner darkening for depth — kept low so the panel reads flat & clean
  speed: 1.0,      // (retained for API; the lattice is static)
  rot: 0.0,   // lattice rotation in radians (axis-aligned / horizontal-edge) — live-tunable via setRotation()
};

export const WGSL = `
struct U { a: vec4<f32>, b: vec4<f32>, c: vec4<f32>, d: vec4<f32>, e: vec4<f32> };
// a=(iResX,iResY,iTime,rot) b=(base.rgb,density) c=(gold.rgb,line) d=(plat.rgb,glow) e=(ptrX,ptrY,irid,vignette)
@group(0) @binding(0) var<uniform> u: U;

const F2: f32 = 0.3660254037844386;   // (sqrt(3)-1)/2   — simplex skew
const G2: f32 = 0.21132486540518713;  // (3-sqrt(3))/6   — simplex unskew
const TAU: f32 = 6.283185307179586;

fn hash21(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// screen-space anti-aliased line coverage. The half-width is clamped to at least ~one pixel (max(w, aa))
// so very thin strokes never go sub-pixel and break into dashes — they stay thin but perfectly continuous.
fn lineMask(f: f32, w: f32) -> f32 {
  let aa = fwidth(f) + 1e-6;
  let hw = max(w, 0.5 * aa);   // floor the half-width at ~½ pixel → continuous (never a gap) yet still thin
  return clamp((hw - f) / aa + 0.5, 0.0, 1.0);
}

struct VOut { @builtin(position) pos: vec4<f32> };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var P = array<vec2<f32>, 3>(vec2<f32>(-1.0,-1.0), vec2<f32>(3.0,-1.0), vec2<f32>(-1.0,3.0));
  var o: VOut; o.pos = vec4<f32>(P[vi], 0.0, 1.0); return o;
}

@fragment fn fs(@builtin(position) posIn: vec4<f32>) -> @location(0) vec4<f32> {
  let iRes = u.a.xy; let iTime = u.a.z; let speed = u.a.w;
  let base = u.b.xyz; let density = u.b.w;
  let gold = u.c.xyz; let lw = u.c.w;
  let plat = u.d.xyz; let glow = u.d.w;
  let ptr = u.e.xy; let irid = u.e.z; let vig = u.e.w;

  let aspect = iRes.x / max(iRes.y, 1.0);
  var uv = posIn.xy / iRes - vec2<f32>(0.5, 0.5);
  uv.x = uv.x * aspect;
  let p0 = uv * density + ptr * 0.6;            // pointer parallax = a gentle pan of the lattice
  let ROT = u.a.w;                              // lattice rotation in radians — live knob (was the unused speed slot)
  let cR = cos(ROT); let sR = sin(ROT);
  let p = vec2<f32>(p0.x * cR - p0.y * sR, p0.x * sR + p0.y * cR);

  // ── fold into one equilateral lattice cell (2-D simplex), recover barycentric (u,v,w) ──────────────
  let s = (p.x + p.y) * F2;
  let ij = floor(p + vec2<f32>(s, s));
  let t = (ij.x + ij.y) * G2;
  let origin = ij - vec2<f32>(t, t);
  let xy = p - origin;
  var o1 = vec2<f32>(1.0, 0.0);
  if (xy.x <= xy.y) { o1 = vec2<f32>(0.0, 1.0); } // lower vs upper triangle of the skew cell
  let A = vec2<f32>(0.0, 0.0);
  let B = o1 - vec2<f32>(G2, G2);
  let C = vec2<f32>(1.0, 1.0) - vec2<f32>(2.0 * G2, 2.0 * G2);

  let v0 = B - A; let v1 = C - A; let v2 = xy - A;
  let d00 = dot(v0, v0); let d01 = dot(v0, v1); let d11 = dot(v1, v1);
  let d20 = dot(v2, v0); let d21 = dot(v2, v1);
  let denom = max(d00 * d11 - d01 * d01, 1e-6);
  let vb = (d11 * d20 - d01 * d21) / denom;
  let wb = (d00 * d21 - d01 * d20) / denom;
  let ub = 1.0 - vb - wb;
  let bary = vec3<f32>(ub, vb, wb);

  let edgeF = min(bary.x, min(bary.y, bary.z));                                   // triangular grid (spokes)
  let medF  = min(abs(bary.x - bary.y), min(abs(bary.y - bary.z), abs(bary.z - bary.x))); // leaf medians
  let mx    = max(bary.x, max(bary.y, bary.z));
  let nodeDist = 1.0 - mx;                                                        // 0 at a star center

  // crisp, UNIFORM single-tone inlay on a flat panel — nothing else (maximally minimal)
  let edges = lineMask(edgeF, lw);
  let meds  = lineMask(medF, lw);
  let lines = max(edges, meds);
  let col = mix(base, plat, lines);                                                // one metal, flat field — no glow, no vignette, no two-tone

  return vec4<f32>(col, 1.0);
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

function makePipeline(device, format) {
  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({ layout: "auto",
    vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" } });
  const ubuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  return { pipeline, ubuf };
}
// pack the 5×vec4 uniform; ignore undefined/null overrides so a partial {gold:undefined} can't clobber a default
function packU(W, H, iTime, o) {
  o = o || {};
  const pick = (k) => (o[k] != null ? o[k] : DEFAULTS[k]);
  const base = pick("base"), gold = pick("gold"), plat = pick("plat");
  const px = o.px != null ? o.px : 0, py = o.py != null ? o.py : 0;
  return new Float32Array([
    W, H, iTime, pick("rot"),
    base[0], base[1], base[2], pick("density"),
    gold[0], gold[1], gold[2], pick("line"),
    plat[0], plat[1], plat[2], pick("glow"),
    px, py, pick("irid"), pick("vignette"),
  ]);
}

// ── LIVE: mount the lattice on a canvas; drives iTime from elapsed seconds (× speed) ─────────────────
export function createBackground(canvas, opts = {}) {
  if (!DEVICE) return null;
  const device = DEVICE;
  const ctx = canvas.getContext("webgpu");
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });
  const { pipeline, ubuf } = makePipeline(device, format);
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: ubuf } }] });

  let speed = opts.speed != null ? opts.speed : DEFAULTS.speed;
  const colors = { base: opts.base, gold: opts.gold, plat: opts.plat,
    density: opts.density, line: opts.line, glow: opts.glow, irid: opts.irid, vignette: opts.vignette,
    rot: opts.rot, px: 0, py: 0 };
  // eased pointer parallax (opt-in: shell passes parallax per its holo:wall-parallax toggle)
  let tpx = 0, tpy = 0;
  const onMove = (e) => { tpx = ((e.clientX / innerWidth) - 0.5) * 0.12; tpy = ((e.clientY / innerHeight) - 0.5) * 0.12; };
  if (opts.parallax) { try { addEventListener("pointermove", onMove, { passive: true }); } catch {} }

  const CAP = 2560, DPR = () => Math.min(opts.maxScale || 2, (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1);
  let W = 0, H = 0;
  function resize() {
    const r = canvas.getBoundingClientRect();
    let w = Math.max(2, Math.round((r.width || canvas.clientWidth || 320) * DPR())), h = Math.max(2, Math.round((r.height || canvas.clientHeight || 200) * DPR()));
    const m = Math.max(w, h); if (m > CAP) { const k = CAP / m; w = Math.round(w * k); h = Math.round(h * k); }
    if (w !== W || h !== H) { W = w; H = h; canvas.width = W; canvas.height = H; }
  }

  let raf = 0, t0 = 0, running = true, painted = false, errored = false;
  const reduced = !!opts.reduced;
  function frame(now) {
    if (!running) return;
    resize();
    if (!t0) t0 = now;
    const iTime = reduced ? 0 : ((now - t0) / 1000) * speed;
    colors.px += (tpx - colors.px) * 0.08; colors.py += (tpy - colors.py) * 0.08;
    try {
      device.queue.writeBuffer(ubuf, 0, packU(W, H, iTime, colors));
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
      device.queue.submit([enc.finish()]);
      painted = true;
    } catch (e) { if (!errored) { errored = true; try { console.warn("holo-asanoha-gpu frame error:", e); } catch {} } }
    if (reduced) { running = false; return; }   // one static frame, then idle
    raf = requestAnimationFrame(frame);
  }
  const onVis = () => { if (typeof document !== "undefined") { if (document.hidden) { if (raf) cancelAnimationFrame(raf), raf = 0; } else if (running && !raf) raf = requestAnimationFrame(frame); } };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
  raf = requestAnimationFrame(frame);

  return {
    resize,
    setSpeed: (v) => { speed = v; },
    setRotation: (rad) => { colors.rot = rad; },     // live lattice rotation (radians) — picked up next frame
    setPointer: (x, y) => { tpx = x; tpy = y; },     // host can drive parallax instead of the listener
    painted: () => painted,
    errored: () => errored,
    stop() { running = false; if (raf) cancelAnimationFrame(raf); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis); try { removeEventListener("pointermove", onMove); } catch {} try { ubuf.destroy(); } catch {} },
  };
}

// ── WITNESS: deterministic single frame, RGBA8 top-left readback (parity/regression harness) ─────────
export async function renderOnce(canvas, params = {}) {
  await ready;
  if (!DEVICE) return null;
  const device = DEVICE;
  const W = Math.max(1, params.width | 0 || 320), H = Math.max(1, params.height | 0 || 200);
  const tex = device.createTexture({ size: [W, H], format: "rgba8unorm", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const { pipeline, ubuf } = makePipeline(device, "rgba8unorm");
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }] });
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
  try { tex.destroy(); ubuf.destroy(); readBuf.destroy(); } catch {}
  return { w: W, h: H, rgba };
}

export default { createBackground, renderOnce, probe, ready, gpuAvailable, setDevice, WGSL, DEFAULTS };
