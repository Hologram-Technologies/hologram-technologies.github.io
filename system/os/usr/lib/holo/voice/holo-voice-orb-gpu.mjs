// holo-voice-orb-gpu.mjs — Q's orb, rendered as a WebGPU RAYMARCHED VOLUMETRIC (Tier 3).
// A fullscreen fragment shader marches a noise-displaced SDF sphere with an intrinsic volumetric glow,
// coloured by the SAME κ-addressed spectrum as the WebGL orb (wallpaper-adaptive), and driven by the same
// live voice signal (level/bands/onset) + circadian + presence. 100% serverless: WebGPU is a browser API,
// the WGSL is inline — nothing is fetched. O(1) CPU per frame: we write ~48 uniform floats + one draw call;
// all the work is GPU-parallel (no per-vertex CPU loop), so it stays low-latency on any device, and the
// render resolution auto-scales to hold framerate. Strictly gated: any failure → the caller falls back to
// the WebGL orb (and then the 2D orb), so the user never sees a broken orb.
//
//   gpuSupported() → boolean (quick)         createGpuOrb(canvas, {descriptor, level(), color()}) → controller (async)

const PHI = (1 + Math.sqrt(5)) / 2;

// the orb's form as a canonical descriptor (mirrors the WebGL module's scheme so the κ is comparable).
// steps/octaves raised for a denser, hyper-real volume; the frame-time loop auto-scales RESOLUTION (not
// step count) to hold fps, so weak GPUs stay smooth while capable GPUs render the full march.
export const ORB_GPU_DESCRIPTOR = {
  "@type": "holo:OrbVolumetric",
  march: { steps: 72, radius: 0.82, freq: 1.7, octaves: 4 },
  spectrum: { stops: ["#ff3b6b", "#ff9e2c", "#ffe24a", "#46e08a", "#2bd4ff", "#5b8cff", "#c77bff", "#ff3b6b"], spin: 7 },
  glow: 0.012,
};

// ── κ identity (RFC 8785 JCS subset → did:holo:blake3, inlined so the module stays dependency-free) ──
import { blake3hex } from "../holo-blake3.mjs";
function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
async function kappaOf(obj) {
  const str = canon(obj);
  return "did:holo:blake3:" + blake3hex(new TextEncoder().encode(str));
}
function hex2rgb(h) { h = String(h).replace("#", ""); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]; }

export function gpuSupported() { return typeof navigator !== "undefined" && !!navigator.gpu; }

// the WGSL — vertex emits a fullscreen triangle; fragment raymarches the orb. STEPS/OCTAVES are injected.
function wgsl(STEPS, OCTAVES) {
  return `
struct U {
  res: vec2f, time: f32, level: f32,
  bass: f32, mid: f32, treble: f32, onset: f32,
  energy: f32, warm: f32, dim: f32, gold: f32,
  nstops: f32, radius: f32, freq: f32, glow: f32,
  stops: array<vec4f, 8>,
};
@group(0) @binding(0) var<uniform> u: U;

@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}

fn hash(p3i: vec3f) -> f32 {
  var p3 = fract(p3i * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn vnoise(x: vec3f) -> f32 {
  let i = floor(x); let f = fract(x); let w = f * f * (3.0 - 2.0 * f);
  let n000 = hash(i + vec3f(0.0, 0.0, 0.0)); let n100 = hash(i + vec3f(1.0, 0.0, 0.0));
  let n010 = hash(i + vec3f(0.0, 1.0, 0.0)); let n110 = hash(i + vec3f(1.0, 1.0, 0.0));
  let n001 = hash(i + vec3f(0.0, 0.0, 1.0)); let n101 = hash(i + vec3f(1.0, 0.0, 1.0));
  let n011 = hash(i + vec3f(0.0, 1.0, 1.0)); let n111 = hash(i + vec3f(1.0, 1.0, 1.0));
  let x00 = mix(n000, n100, w.x); let x10 = mix(n010, n110, w.x);
  let x01 = mix(n001, n101, w.x); let x11 = mix(n011, n111, w.x);
  return mix(mix(x00, x10, w.y), mix(x01, x11, w.y), w.z) * 2.0 - 1.0;
}
fn fbm(p0: vec3f) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0;
  for (var i = 0; i < ${OCTAVES}; i = i + 1) { s = s + a * vnoise(p); p = p * 1.9; a = a * 0.5; }
  return s;
}
// ── perceptual colour: interpolate the spectrum in OKLAB (even hue, no muddy mid-stops / grey crossfades) ──
fn srgb2lin(c: vec3f) -> vec3f { return select(c / 12.92, pow((c + 0.055) / 1.055, vec3f(2.4)), c > vec3f(0.04045)); }
fn lin2srgb(c: vec3f) -> vec3f { let x = max(c, vec3f(0.0)); return select(x * 12.92, 1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x > vec3f(0.0031308)); }
fn lin2oklab(c: vec3f) -> vec3f {
  let l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  let m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  let s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  let l_ = pow(max(l, 0.0), 1.0 / 3.0); let m_ = pow(max(m, 0.0), 1.0 / 3.0); let s_ = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3f(0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
               1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
               0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_);
}
fn oklab2srgb(c: vec3f) -> vec3f {
  let l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  let m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  let s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  let l = l_ * l_ * l_; let m = m_ * m_ * m_; let s = s_ * s_ * s_;
  let lin = vec3f(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                 -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                 -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  return lin2srgb(lin);
}
fn spec(t0: f32) -> vec3f {
  let n = max(2.0, u.nstops);
  let t = fract(t0) * (n - 1.0);
  let k = clamp(i32(floor(t)), 0, 6);
  let a = lin2oklab(srgb2lin(u.stops[k].rgb));
  let b = lin2oklab(srgb2lin(u.stops[k + 1].rgb));
  return oklab2srgb(mix(a, b, fract(t)));
}
fn sdf(p: vec3f) -> f32 {
  let R = u.radius + u.level * 0.05 + u.onset * 0.03 + sin(u.time * 0.6) * 0.012;   // gentle breath, softer voice swell
  let warp = vec3f(u.time * 0.05, u.time * 0.06, u.time * 0.07);
  let disp = fbm(p * u.freq + warp) * (0.07 + u.level * 0.20 + u.mid * 0.14 + u.bass * 0.10);   // ~half the distortion — beautiful, not wild
  return length(p) - R - disp;
}
fn nrm(p: vec3f) -> vec3f {
  let e = vec2f(0.0012, 0.0);
  return normalize(vec3f(sdf(p + e.xyy) - sdf(p - e.xyy), sdf(p + e.yxy) - sdf(p - e.yxy), sdf(p + e.yyx) - sdf(p - e.yyx)));
}
// a soft grid line near integer x (no fwidth — derivatives aren't allowed in the non-uniform hit branch)
fn gline(x: f32) -> f32 { return smoothstep(0.42, 0.5, abs(fract(x) - 0.5)); }
// interleaved-gradient noise — a cheap blue-noise-like dither that, animated by frame, kills glow banding
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
// ACES filmic tonemap — HDR highlights roll off to white like real light (not a flat clamp)
fn aces(x: vec3f) -> vec3f { let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0)); }

@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = (fc.xy - 0.5 * u.res) / u.res.y;
  let ro = vec3f(0.0, 0.0, 3.6);                       // pulled back → the orb sits in frame with margin (no clipping)
  let rd = normalize(vec3f(uv.x, -uv.y, -1.5));
  let spin = u.time / 7.0 * (1.0 + u.level * 1.6 + u.treble * 1.4) * (0.4 + 0.6 * u.energy);
  // relaxed sphere-tracing: over-step by 1.2× and back off on overshoot → fewer steps for the same surface
  // accuracy, and an INNER-NEBULA pass that accumulates living volumetric density inside the shell.
  var t = 0.0; var glow = 0.0; var neb = 0.0; var hit = false; var hp = vec3f(0.0);
  var omega = 1.2; var prevD = 1e9; var stepLen = 0.0;
  for (var i = 0; i < ${STEPS}; i = i + 1) {
    let p = ro + rd * t;
    let d = sdf(p);
    if (omega > 1.0 && (d + prevD) < stepLen) {        // overshot the surface → undo the relaxation, march safely
      t = t - stepLen; omega = 1.0; prevD = 1e9; continue;
    }
    prevD = d;
    glow = glow + u.glow / (1.0 + d * d * 42.0);
    if (d < 0.0) {                                      // inside the shell — sample the core's living density
      neb = neb + (0.5 + 0.5 * fbm(p * (u.freq * 1.6) + vec3f(u.time * 0.09))) * 0.05;
    }
    if (d < 0.0015) { hit = true; hp = p; break; }
    stepLen = max(d * omega, 0.004);
    t = t + stepLen;
    if (t > 6.0) { break; }
  }
  var col = vec3f(0.0); var alpha = 0.0;
  if (hit) {
    let n = nrm(hp);
    let lon = atan2(n.x, n.z) / 6.2831853 + 0.5;
    let lat = acos(clamp(n.y, -1.0, 1.0)) / 3.14159265;
    let hue = lon + spin + 0.18 * n.y;
    let base = spec(hue);
    let fres = pow(1.0 - max(dot(n, -rd), 0.0), 2.5);
    let ld = normalize(vec3f(-0.4, 0.7, 0.5));
    let diff = 0.5 + 0.5 * max(dot(n, ld), 0.0);
    // THIN-FILM IRIDESCENCE — at grazing angles the shell shifts hue like a soap bubble / oil film
    let irid = spec(hue + fres * 0.30 + u.treble * 0.08);
    let bodyHue = mix(base, irid, fres * 0.45);
    // GEOMETRIC GRID — a triangular lattice on the surface (the beloved wireframe, conformal to the volume)
    let A = lon * 18.0; let B = lat * 11.0;
    let pf = sin(lat * 3.14159265);                    // fade at the poles so longitudes don't pinch
    let g = max(gline(B), max(gline(A + B * 0.5), gline(A - B * 0.5))) * pf;
    let face = bodyHue * (0.28 + 0.30 * diff);         // dim glowing body between the lines
    // CHROMATIC DISPERSION — the bright spectral grid lines split into prismatic R/G/B like glass edges
    let dofs = 0.020 * (0.5 + fres);
    let edgeRGB = vec3f(spec(hue - dofs).r, spec(hue).g, spec(hue + dofs).b);
    let edge = (edgeRGB * 1.7 + vec3f(0.22, 0.22, 0.32)) * (0.7 + 0.6 * fres);
    col = mix(face, edge, g) + bodyHue * fres * 0.55;
    col = col * (0.9 + u.level * 0.45 + u.onset * 0.5);
    alpha = max(g, 0.34 + 0.45 * fres);                // lines opaque, faces translucent → a lattice shell over the glow
  }
  // the living core: interior nebula coloured by the spectrum, brightening with voice — an alive inner light
  let ncol = spec(spin + 0.55 + neb);
  col = col + ncol * neb * (0.7 + u.level * 0.9 + u.bass * 0.8);
  let gcol = spec(spin + 0.25);
  col = col + gcol * glow * 1.0 * (0.6 + u.level * 1.0 + u.treble * 0.7);
  alpha = max(alpha, clamp((glow + neb * 0.6) * 1.2, 0.0, 1.0));
  if (u.gold > 0.0) { col = mix(col, vec3f(1.0, 0.78, 0.20) * (0.4 + 0.9 * length(col)), u.gold); }
  col.r = col.r * (1.0 + u.warm * 0.10);
  col.b = col.b * (1.0 - u.warm * 0.30);
  col = col * (1.0 - u.dim * 0.4);
  col = aces(col * 1.18);                               // filmic HDR roll-off → highlights read as real light, not a hard clip
  col = col + (ign(fc.xy + u.time * 60.0) - 0.5) * (1.5 / 255.0);   // temporal dither → no banding in the glow gradient
  col = clamp(col, vec3f(0.0), vec3f(1.0));
  return vec4f(col * alpha, alpha);   // premultiplied alpha
}`;
}

export async function createGpuOrb(canvas, opts) {
  opts = opts || {};
  if (!navigator.gpu) throw new Error("WebGPU unavailable");
  const D = JSON.parse(JSON.stringify(opts.descriptor || ORB_GPU_DESCRIPTOR));
  const getLevel = typeof opts.level === "function" ? opts.level : () => 0;
  const getColor = typeof opts.color === "function" ? opts.color : () => null;
  const PRCAP = Math.max(1, opts.maxPixelRatio || 2);   // native DPR (cap 2); auto-scales down under load. The hero is fullscreen, so we DON'T oversample — that's what felt laggy.
  const SSMAX = Math.max(1, opts.maxSupersample || 1);  // no supersample by default → no quality/perf oscillation on the fullscreen hero; raise per-mount for a small orb with headroom
  const STEPS = (D.march && D.march.steps) || 72, OCT = (D.march && D.march.octaves) || 4;

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("no GPU adapter");
  const device = await adapter.requestDevice();
  let dead = false; try { device.lost.then(() => { dead = true; }); } catch (e) {}

  // ── optional SR ENVELOPE (opts.sr) — render the orb CHEAP-INTERNAL to an offscreen canvas, then super-resolve
  // it onto the visible canvas via holo-canvas.mjs (Catmull-Rom upscale → CAS sharpen, the OS "ultra" kernel,
  // alpha-preserving so the orb stays transparent over the wallpaper) at native DPR × SSAA, up to the 8K cap.
  // The win is largest on the FULLSCREEN hero (Q Live), where raymarching every native pixel is the cost and the
  // upscale restores detail far cheaper. NO-OP SAFE: if the SR device/pipeline won't init, the orb falls back to
  // rendering DIRECTLY to the visible canvas (the proven path) — same robustness contract as the rest of the orb.
  const SR_INTERNAL = Math.max(0.4, Math.min(1, opts.srInternalScale || 0.85));
  let holoSR = null, srcCanvas = null, renderTarget = canvas;
  if (opts.sr) {
    try {
      const cm = await import("../holo-canvas.mjs");
      srcCanvas = (typeof document !== "undefined") ? document.createElement("canvas") : null;
      if (srcCanvas && cm && cm.HoloCanvas) {
        srcCanvas.width = srcCanvas.height = 2;                                   // real size set in resize()
        holoSR = await new cm.HoloCanvas(canvas, { sharpen: 0.6, maxDim: 8192, alpha: true }).init();
        renderTarget = srcCanvas;                                                 // the orb draws here; HoloCanvas projects it
      }
    } catch (e) { try { if (holoSR) holoSR.destroy(); } catch (e2) {} holoSR = null; srcCanvas = null; renderTarget = canvas; console.warn("[OrbGPU] SR envelope unavailable — direct render:", e && e.message || e); }
  }

  const ctx = renderTarget.getContext("webgpu");
  if (!ctx) throw new Error("no webgpu context");
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "premultiplied" });

  const UF = new Float32Array(48);                                  // matches struct U (192 bytes)
  const ubuf = device.createBuffer({ size: UF.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.pushErrorScope("validation");
  const mod = device.createShaderModule({ code: wgsl(STEPS, OCT) });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: mod, entryPoint: "vs" },
    fragment: { module: mod, entryPoint: "fs", targets: [{ format, blend: { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } }] },
    primitive: { topology: "triangle-list" },
  });
  const perr = await device.popErrorScope();
  if (perr) throw new Error("WGSL/pipeline: " + perr.message);   // a shader error → reject → caller falls back to the WebGL orb
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubuf } }] });

  // static uniform fields (defaults; spectrum can be re-skinned at runtime via color().stops)
  UF[13] = (D.march && D.march.radius) || 0.82; UF[14] = (D.march && D.march.freq) || 1.7; UF[15] = D.glow || 0.012;
  let _stopsRef = null, _nstops = 0;
  function setStops(hexArr) { const n = Math.min(8, hexArr.length); _nstops = n; for (let i = 0; i < n; i++) { const c = hex2rgb(hexArr[i]); UF[16 + i * 4] = c[0]; UF[16 + i * 4 + 1] = c[1]; UF[16 + i * 4 + 2] = c[2]; UF[16 + i * 4 + 3] = 1; } }
  setStops((D.spectrum && D.spectrum.stops) || ORB_GPU_DESCRIPTOR.spectrum.stops);

  const inst = { descriptor: D, kappa: null, mode: "webgpu" };
  kappaOf(D).then((k) => { inst.kappa = k; try { canvas.dataset.kappa = k; } catch (e) {} }, () => {});

  let _scale = 0.85, _prCap = Math.min(window.devicePixelRatio || 1, PRCAP);   // open a touch below native then climb if there's headroom → no heavy first second
  const SCEIL = holoSR ? 1 : SSMAX;   // direct path: _scale climbs to SSMAX (in-shader SSAA). SR path: SSAA lives in the upscale → _scale only trims the raymarch.
  function resize() {
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 300;
    if (holoSR) {
      // visible backing = native × SSAA (HoloCanvas downsamples → clean edges); the CHEAP raymarch = native × internal × _scale,
      // sized from NATIVE (not the SSAA output) so internal stays BELOW native — that's the whole point of SR (render fewer pixels, upscale).
      const base = _prCap;
      const outW = Math.max(1, Math.round(w * base * SSMAX)), outH = Math.max(1, Math.round(h * base * SSMAX));
      try { holoSR.setOutput(outW, outH); } catch (e) {}
      const sw = Math.max(1, Math.round(w * base * SR_INTERNAL * _scale)), sh = Math.max(1, Math.round(h * base * SR_INTERNAL * _scale));
      if (srcCanvas.width !== sw || srcCanvas.height !== sh) { srcCanvas.width = sw; srcCanvas.height = sh; }
      return;
    }
    const s = _prCap * _scale;
    const W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  }
  resize();

  function writeUniforms() {
    const t = window.performance.now(), sig = getLevel() || {}, col = getColor() || {};
    const L = (typeof sig === "number") ? sig : (sig.level || 0);
    UF[0] = renderTarget.width; UF[1] = renderTarget.height; UF[2] = t / 1000; UF[3] = L;
    UF[4] = sig.bass || 0; UF[5] = sig.mid || 0; UF[6] = sig.treble || 0; UF[7] = sig.onset || 0;
    UF[8] = (sig.energy != null ? sig.energy : 1); UF[9] = col.warm || 0; UF[10] = col.dim || 0; UF[11] = col.gold || 0;
    if (col.stops && col.stops !== _stopsRef) { _stopsRef = col.stops; setStops(col.stops); }
    UF[12] = _nstops;
    device.queue.writeBuffer(ubuf, 0, UF);
  }
  function step() {
    if (dead) return;
    writeUniforms();
    let view; try { view = ctx.getCurrentTexture().createView(); } catch (e) { return; }
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
    device.queue.submit([enc.finish()]);
    if (holoSR) { try { holoSR.present(srcCanvas, "sr"); } catch (e) {} }   // super-resolve the cheap render → the visible canvas
  }

  let raf = 0, running = false, lastT = 0, emaDt = 0, fc = 0;
  function frame() {
    if (!running || dead) return;
    const now = window.performance.now();
    if (lastT) emaDt = emaDt ? emaDt * 0.9 + (now - lastT) * 0.1 : (now - lastT);
    lastT = now;
    if ((++fc % 24) === 0 && emaDt > 0) {                           // resolution auto-scale → hold framerate (checked often so lag is corrected fast)
      const fps = 1000 / emaDt;
      // below 0.4 floor → save fps; up to SCEIL (direct: SSMAX · SR: 1) → spend headroom on resolution. Asymmetric: drop fast, climb slow → no oscillation.
      if (fps < 50 && _scale > 0.4) { _scale = Math.max(0.4, _scale - 0.2); resize(); }
      else if (fps > 58 && _scale < SCEIL) { _scale = Math.min(SCEIL, _scale + 0.1); resize(); }
    }
    step();
    raf = requestAnimationFrame(frame);
  }
  let ro = null;
  if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(resize); try { ro.observe(canvas); } catch (e) {} }
  else { window.addEventListener("resize", resize); }

  inst.start = function () { if (running || dead) return; running = true; resize(); raf = requestAnimationFrame(frame); };
  inst.stop = function () { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };
  inst.step = step;
  inst.resize = resize;
  inst.getKappa = function () { return inst.kappa; };
  inst.dispose = function () { inst.stop(); try { if (ro) ro.disconnect(); else window.removeEventListener("resize", resize); } catch (e) {} try { if (holoSR) holoSR.destroy(); } catch (e) {} try { ubuf.destroy(); } catch (e) {} try { device.destroy(); } catch (e) {} };
  inst.sr = !!holoSR;
  return inst;
}

export default createGpuOrb;
