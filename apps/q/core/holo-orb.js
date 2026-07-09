// holo-orb.js — THE canonical living Q orb (shared by the standalone Q chat and the messenger; the messenger's
// holo-q-orb-live.mjs re-exports this file). mountOrb(canvas, opts?) → { stop, fallback, mode, ... } — the API is
// a superset of the original 54-line WebGL orb (opts optional, {stop,fallback} preserved), so existing callers
// are unaffected while every surface gains the enhanced renderer. Original preserved as holo-orb.js.pre-converge.bak.
//
// PRIMARY: a NATIVE-WebGPU raymarched volume rendered on a dedicated Web Worker via OffscreenCanvas. The render
// loop lives on the worker, PHYSICALLY off the main thread, so the orb stays glass-smooth and NEVER freezes even
// while the host's main thread is busy (React, Q inference, message churn). It binds the real GPU adapter
// (powerPreference:"high-performance", no fallback) → 100% native WebGPU, and renders at native DPR × SSAA for a
// crisp, hyper-real look. Fully self-contained: the worker is spawned from a Blob URL with inline WGSL — no deps,
// no import map, no extra files to serve, so it works in every environment (dev SPA and the real app alike).
//
// FALLBACK: the original self-contained WebGL2 wireframe icosphere (kept verbatim below), then a CSS/SVG orb.
// The gate is fail-closed and probe-before-transfer: the worker confirms a GPU adapter BEFORE the canvas is
// transferred, so a probe failure leaves the canvas reusable for the WebGL2 floor.
//
//   mountOrb(canvas) → { stop(), fallback:boolean, mode }

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// WGSL — fullscreen-triangle vertex + a raymarched, noise-displaced SDF sphere with the OS brand spectrum
// (OKLAB-interpolated), a triangular lattice shell, thin-film iridescence, an inner living nebula, ACES filmic
// tonemap and temporal dither. Idle-animated (breath + spin + shimmer) so it's alive at rest with ZERO main-
// thread involvement. TERM-IDENTICAL to the native OS orb (usr/lib/holo/voice/holo-voice-orb-gpu.mjs): same
// march (72 steps / 4 octaves / radius 0.82 / freq 1.7 / glow 0.012), same full signal uniforms (level + bands
// + onset + energy + warm/dim/gold), same spin/swell/iridescence/nebula formulas — so the messenger's corner
// orb and the CEF home-tab orb are the SAME animation, pixel for pixel (minus the OS-only morph-form library).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const WGSL = `
struct U {
  res: vec2f, time: f32, level: f32,
  bass: f32, mid: f32, treble: f32, onset: f32,
  energy: f32, warm: f32, dim: f32, gold: f32,
};
@group(0) @binding(0) var<uniform> u: U;

const STOPS = array<vec3f, 8>(
  vec3f(1.0, 0.231, 0.42), vec3f(1.0, 0.62, 0.173), vec3f(1.0, 0.886, 0.29), vec3f(0.275, 0.878, 0.541),
  vec3f(0.169, 0.831, 1.0), vec3f(0.357, 0.549, 1.0), vec3f(0.78, 0.482, 1.0), vec3f(1.0, 0.231, 0.42));

@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}
fn hash(p3i: vec3f) -> f32 { var p3 = fract(p3i * 0.1031); p3 = p3 + dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
fn vnoise(x: vec3f) -> f32 {
  let i = floor(x); let f = fract(x); let w = f * f * (3.0 - 2.0 * f);
  let n000 = hash(i + vec3f(0.0,0.0,0.0)); let n100 = hash(i + vec3f(1.0,0.0,0.0));
  let n010 = hash(i + vec3f(0.0,1.0,0.0)); let n110 = hash(i + vec3f(1.0,1.0,0.0));
  let n001 = hash(i + vec3f(0.0,0.0,1.0)); let n101 = hash(i + vec3f(1.0,0.0,1.0));
  let n011 = hash(i + vec3f(0.0,1.0,1.0)); let n111 = hash(i + vec3f(1.0,1.0,1.0));
  let x00 = mix(n000,n100,w.x); let x10 = mix(n010,n110,w.x); let x01 = mix(n001,n101,w.x); let x11 = mix(n011,n111,w.x);
  return mix(mix(x00,x10,w.y), mix(x01,x11,w.y), w.z) * 2.0 - 1.0;
}
fn fbm(p0: vec3f) -> f32 { var p = p0; var a = 0.5; var s = 0.0; for (var i = 0; i < 4; i = i + 1) { s = s + a * vnoise(p); p = p * 1.9; a = a * 0.5; } return s; }
fn srgb2lin(c: vec3f) -> vec3f { return select(c/12.92, pow((c+0.055)/1.055, vec3f(2.4)), c > vec3f(0.04045)); }
fn lin2srgb(c: vec3f) -> vec3f { let x = max(c, vec3f(0.0)); return select(x*12.92, 1.055*pow(x, vec3f(1.0/2.4))-0.055, x > vec3f(0.0031308)); }
fn lin2oklab(c: vec3f) -> vec3f {
  let l = 0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b;
  let m = 0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b;
  let s = 0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b;
  let l_ = pow(max(l,0.0),1.0/3.0); let m_ = pow(max(m,0.0),1.0/3.0); let s_ = pow(max(s,0.0),1.0/3.0);
  return vec3f(0.2104542553*l_+0.7936177850*m_-0.0040720468*s_, 1.9779984951*l_-2.4285922050*m_+0.4505937099*s_, 0.0259040371*l_+0.7827717662*m_-0.8086757660*s_);
}
fn oklab2srgb(c: vec3f) -> vec3f {
  let l_ = c.x+0.3963377774*c.y+0.2158037573*c.z; let m_ = c.x-0.1055613458*c.y-0.0638541728*c.z; let s_ = c.x-0.0894841775*c.y-1.2914855480*c.z;
  let l = l_*l_*l_; let m = m_*m_*m_; let s = s_*s_*s_;
  let lin = vec3f(4.0767416621*l-3.3077115913*m+0.2309699292*s, -1.2684380046*l+2.6097574011*m-0.3413193965*s, -0.0041960863*l-0.7034186147*m+1.7076147010*s);
  return lin2srgb(lin);
}
fn spec(t0: f32) -> vec3f { let t = fract(t0) * 7.0; let k = clamp(i32(floor(t)), 0, 6); let a = lin2oklab(srgb2lin(STOPS[k])); let b = lin2oklab(srgb2lin(STOPS[k+1])); return oklab2srgb(mix(a, b, fract(t))); }
fn sdf(p: vec3f) -> f32 {
  let R = 0.82 + u.level * 0.05 + u.onset * 0.03 + sin(u.time * 0.6) * 0.012;
  let warp = vec3f(u.time*0.05, u.time*0.06, u.time*0.07);
  let disp = fbm(p * 1.7 + warp) * (0.07 + u.level * 0.20 + u.mid * 0.14 + u.bass * 0.10);
  return length(p) - R - disp;
}
fn nrm(p: vec3f) -> vec3f { let e = vec2f(0.0012, 0.0); return normalize(vec3f(sdf(p+e.xyy)-sdf(p-e.xyy), sdf(p+e.yxy)-sdf(p-e.yxy), sdf(p+e.yyx)-sdf(p-e.yyx))); }
fn gline(x: f32) -> f32 { return smoothstep(0.42, 0.5, abs(fract(x) - 0.5)); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
fn aces(x: vec3f) -> vec3f { let a=2.51; let b=0.03; let c=2.43; let d=0.59; let e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), vec3f(0.0), vec3f(1.0)); }

@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = (fc.xy - 0.5 * u.res) / u.res.y;
  let ro = vec3f(0.0, 0.0, 3.6);
  let rd = normalize(vec3f(uv.x, -uv.y, -1.5));
  let spin = u.time / 7.0 * (1.0 + u.level * 1.6 + u.treble * 1.4) * (0.4 + 0.6 * u.energy);
  var t = 0.0; var glow = 0.0; var neb = 0.0; var hit = false; var hp = vec3f(0.0);
  var omega = 1.2; var prevD = 1e9; var stepLen = 0.0;
  for (var i = 0; i < 72; i = i + 1) {
    let p = ro + rd * t; let d = sdf(p);
    if (omega > 1.0 && (d + prevD) < stepLen) { t = t - stepLen; omega = 1.0; prevD = 1e9; continue; }
    prevD = d;
    glow = glow + 0.012 / (1.0 + d * d * 42.0);
    if (d < 0.0) { neb = neb + (0.5 + 0.5 * fbm(p * 2.72 + vec3f(u.time * 0.09))) * 0.05; }
    if (d < 0.0015) { hit = true; hp = p; break; }
    stepLen = max(d * omega, 0.004); t = t + stepLen;
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
    let irid = spec(hue + fres * 0.30 + u.treble * 0.08);
    let bodyHue = mix(base, irid, fres * 0.45);
    let A = lon * 18.0; let B = lat * 11.0; let pf = sin(lat * 3.14159265);
    let g = max(gline(B), max(gline(A + B * 0.5), gline(A - B * 0.5))) * pf;
    let face = bodyHue * (0.28 + 0.30 * diff);
    let dofs = 0.020 * (0.5 + fres);
    let edgeRGB = vec3f(spec(hue - dofs).r, spec(hue).g, spec(hue + dofs).b);
    let edge = (edgeRGB * 1.7 + vec3f(0.22, 0.22, 0.32)) * (0.7 + 0.6 * fres);
    col = mix(face, edge, g) + bodyHue * fres * 0.55;
    col = col * (0.9 + u.level * 0.45 + u.onset * 0.5);
    alpha = max(g, 0.34 + 0.45 * fres);
  }
  let ncol = spec(spin + 0.55 + neb);
  col = col + ncol * neb * (0.7 + u.level * 0.9 + u.bass * 0.8);
  let gcol = spec(spin + 0.25);
  col = col + gcol * glow * (0.6 + u.level * 1.0 + u.treble * 0.7);
  alpha = max(alpha, clamp((glow + neb * 0.6) * 1.2, 0.0, 1.0));
  if (u.gold > 0.0) { col = mix(col, vec3f(1.0, 0.78, 0.20) * (0.4 + 0.9 * length(col)), u.gold); }
  col.r = col.r * (1.0 + u.warm * 0.10);
  col.b = col.b * (1.0 - u.warm * 0.30);
  col = col * (1.0 - u.dim * 0.4);
  col = aces(col * 1.18);
  col = col + (ign(fc.xy + u.time * 60.0) - 0.5) * (1.5 / 255.0);
  col = clamp(col, vec3f(0.0), vec3f(1.0));
  return vec4f(col * alpha, alpha);
}`;

// ── the worker body (classic worker, spawned from a Blob URL). WGSL is injected as a JS string literal so the
// whole thing is self-contained — nothing extra is fetched, so it runs in any serve environment. ──
const WORKER_BODY = [
  "const WGSL = __WGSL__;",
  "let dev=null, ctx=null, pipeline=null, bind=null, ubuf=null, uf=null, raf=0, running=false, dead=false, canvas=null;",
  "let dpr=1, ssMax=1, scale=1, cssW=64, cssH=64;",   // backing = css × dpr × scale; scale climbs to ssMax (SSAA) with headroom, drops under load — the native orb's ladder
  "let mode=0, extLevel=-1, cur=0.0, gcur=0.0, dbg=false, fc=0, lastT=0, emaDt=0;",   // mode: 0 idle · 1 listening · 2 thinking · 3 speaking. cur = eased base level; gcur = eased gold (mind-flare) wash; extLevel = live speech amplitude (0..1) or -1.
  "const NOW=function(){return (typeof performance!=='undefined')?performance.now():Date.now();};",
  "const RAF=(typeof requestAnimationFrame==='function')?requestAnimationFrame:function(f){return setTimeout(function(){f(NOW());},16);};",
  "const CAF=(typeof cancelAnimationFrame==='function')?cancelAnimationFrame:clearTimeout;",
  "function resize(){var s=dpr*scale;var w=Math.max(1,Math.round(cssW*s)),h=Math.max(1,Math.round(cssH*s)); if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}}",
  // Q-state-reactive level, calibrated to the NATIVE orb's idle: at rest level eases to 0 (energy 1), so the
  // idle animation is exactly the OS home-tab orb — breath sin(t·0.6)·0.012, spin t/7, fbm skin 0.07. States
  // modulate on top: listening = alert; thinking = livelier + the OS gold mind-flare wash; speaking = pulse to
  // live amplitude (extLevel) or a synthetic speech cadence. cur/gcur ease so transitions read as intent.",
  "function frame(){ if(!running||dead) return; var t=NOW()/1000; var base, osc, gold=0;",
  "  if(mode===2){ base=0.35; osc=0.10*Math.sin(t*3.4); gold=0.30+0.20*Math.sin(t*3.4); }",
  "  else if(mode===1){ base=0.22; osc=0.05*Math.sin(t*2.0); }",
  "  else if(mode===3){ base=0.32; osc=(extLevel>=0?0.0:0.30*Math.abs(Math.sin(t*6.5))); }",
  "  else { base=0.0; osc=0.0; }",
  "  var live=(extLevel>=0&&(mode===1||mode===3))?extLevel*0.6:0.0;",   // REAL audio amplitude swells the orb (listening to you · speaking as Q)
  "  cur+=(base-cur)*0.06; gcur+=(gold-gcur)*0.08; var lvl=Math.max(0.0, cur+osc+live);",
  "  var now=NOW(); if(lastT){ emaDt=emaDt?emaDt*0.9+(now-lastT)*0.1:(now-lastT); } lastT=now;",
  "  if(((++fc)%24)===0&&emaDt>0){ var fps=1000/emaDt;",   // frame-time adaptive resolution (the native ladder): drop fast under load, climb slow into SSAA headroom → sharp AND never laggy
  "    if(fps<50&&scale>0.5){ scale=Math.max(0.5,scale-0.25); resize(); }",
  "    else if(fps>58&&scale<ssMax){ scale=Math.min(ssMax,scale+0.25); resize(); } }",
  "  if(dbg&&(fc%15)===0){ try{ self.postMessage({t:'lvl', v:lvl, mode:mode}); }catch(e){} }",
  "  uf[0]=canvas.width; uf[1]=canvas.height; uf[2]=t; uf[3]=lvl;",
  "  uf[4]=0; uf[5]=0; uf[6]=0; uf[7]=0; uf[8]=1; uf[9]=0; uf[10]=0; uf[11]=gcur;",   // bass/mid/treble/onset idle at 0 and energy at 1 — the native orb's values when no live meter feeds it
  "  dev.queue.writeBuffer(ubuf,0,uf); var view; try{ view=ctx.getCurrentTexture().createView(); }catch(e){ raf=RAF(frame); return; } var enc=dev.createCommandEncoder(); var pass=enc.beginRenderPass({colorAttachments:[{view:view,clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]}); pass.setPipeline(pipeline); pass.setBindGroup(0,bind); pass.draw(3); pass.end(); dev.queue.submit([enc.finish()]); raf=RAF(frame); }",
  "self.onmessage=async function(e){ var m=e.data||{}; try{",
  "  if(m.t==='probe'){ try{ if(!navigator.gpu) throw new Error('no gpu'); var a=await navigator.gpu.requestAdapter({powerPreference:'high-performance'}); if(!a) throw new Error('no adapter'); var d=await a.requestDevice(); if(d.destroy) d.destroy(); self.postMessage({t:'probe-ok'}); }catch(err){ self.postMessage({t:'fail',err:'probe: '+String(err&&err.message||err)}); } return; }",
  "  if(m.t==='init'){ try{",
  "    canvas=m.canvas; dpr=m.dpr||1; ssMax=m.ss||1; scale=1; cssW=m.cssW||64; cssH=m.cssH||64; dbg=!!m.debug;",
  "    var a=await navigator.gpu.requestAdapter({powerPreference:'high-performance'}); if(!a) throw new Error('no adapter'); dev=await a.requestDevice(); if(dev.lost) dev.lost.then(function(){dead=true;});",
  "    ctx=canvas.getContext('webgpu'); if(!ctx) throw new Error('no webgpu ctx'); var fmt=navigator.gpu.getPreferredCanvasFormat(); ctx.configure({device:dev,format:fmt,alphaMode:'premultiplied'});",
  "    uf=new Float32Array(12); ubuf=dev.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});",
  "    dev.pushErrorScope('validation'); var mod=dev.createShaderModule({code:WGSL});",
  "    pipeline=dev.createRenderPipeline({layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format:fmt,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});",
  "    var perr=await dev.popErrorScope(); if(perr) throw new Error('wgsl: '+perr.message);",
  "    bind=dev.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}}]});",
  "    resize(); running=true; raf=RAF(frame); self.postMessage({t:'ready'});",
  "  }catch(err){ self.postMessage({t:'fail',err:String(err&&err.message||err)}); } return; }",
  "  if(!canvas) return;",
  "  if(m.t==='size'){ cssW=m.cssW||cssW; cssH=m.cssH||cssH; dpr=m.dpr||dpr; resize(); }",
  "  else if(m.t==='sig'){ mode=m.mode||0; extLevel=(typeof m.level==='number'?m.level:-1); }",
  "  else if(m.t==='pause'){ if(running){ running=false; if(raf){ CAF(raf); raf=0; } } }",   // off-screen/backgrounded → halt the loop, KEEP the device (cheap resume)
  "  else if(m.t==='resume'){ if(!running && !dead && canvas){ running=true; raf=RAF(frame); } }",
  "  else if(m.t==='stop'){ running=false; if(raf){ CAF(raf); raf=0; } try{ if(dev&&dev.destroy) dev.destroy(); }catch(e){} }",
  "}catch(err){ try{ self.postMessage({t:'fail',err:String(err&&err.message||err)}); }catch(e2){} } };",
].join("\n");

const WORKER_SRC = WORKER_BODY.replace("__WGSL__", JSON.stringify(WGSL));

// mount the WebGPU worker orb. Returns a handle (sync) that upgrades async; on any failure it falls back to the
// WebGL2 wireframe on the SAME canvas (probe-before-transfer keeps the canvas reusable). Returns null only when
// the platform can't do OffscreenCanvas/Worker/WebGPU at all → caller uses WebGL2 directly.
function mountGpuOrb(canvas, opts) {
  opts = opts || {};
  const ok = typeof navigator !== "undefined" && navigator.gpu &&
    typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined" &&
    canvas && canvas.transferControlToOffscreen;
  if (!ok) return null;

  let worker = null, url = null, stopped = false, transferred = false, fellBack = null, timer = 0, ro = null, pendingSig = null, onQState = null;
  const handle = { fallback: false, mode: "webgpu-worker",
    pause() {   // visibility budget: halt the render loop while unseen (keeps the device warm for an instant resume)
      try { if (worker && !stopped) worker.postMessage({ t: "pause" }); } catch (e) {}
      if (fellBack && fellBack.pause) { try { fellBack.pause(); } catch (e) {} }
    },
    resume() {
      try { if (worker && !stopped) worker.postMessage({ t: "resume" }); } catch (e) {}
      if (fellBack && fellBack.resume) { try { fellBack.resume(); } catch (e) {} }
    },
    stop() {
      stopped = true; if (timer) { clearTimeout(timer); timer = 0; }
      try { if (ro) ro.disconnect(); } catch (e) {}
      try { if (typeof window !== "undefined" && onQState) window.removeEventListener("holo-q-state", onQState); } catch (e) {}
      try { if (worker) { worker.postMessage({ t: "stop" }); worker.terminate(); } } catch (e) {}
      try { if (url) URL.revokeObjectURL(url); } catch (e) {}
      if (fellBack && fellBack.stop) { try { fellBack.stop(); } catch (e) {} }
    } };

  function toWebgl() {
    if (timer) { clearTimeout(timer); timer = 0; }
    try { if (worker) worker.terminate(); } catch (e) {}
    if (stopped || transferred || fellBack) return;   // transferred → canvas burned, can't reuse (rare, post-probe only)
    fellBack = mountWebglOrb(canvas);                  // same untouched canvas → the proven WebGL2 wireframe
    handle.mode = (fellBack && !fellBack.fallback) ? "webgl" : "none";
  }

  try { url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" })); worker = new Worker(url); }
  catch (e) { return mountWebglOrb(canvas); }

  const dpr = () => Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 3);   // full device DPR (cap 3) — a small corner orb is cheap, so every edge is razor-sharp
  const cw = () => canvas.clientWidth || 64, ch = () => canvas.clientHeight || 64;

  worker.onmessage = (e) => {
    const m = e.data || {};
    if (m.t === "probe-ok") {
      if (stopped) return;
      let off; try { off = canvas.transferControlToOffscreen(); transferred = true; }
      catch (err) { toWebgl(); return; }
      try { worker.postMessage({ t: "init", canvas: off, dpr: dpr(), ss: 2, cssW: cw(), cssH: ch(), debug: !!opts.debug }, [off]); }   // ss = the SSAA ceiling the worker's ladder climbs to with fps headroom (starts at 1× — instant first paint)
      catch (err) { toWebgl(); }
    } else if (m.t === "ready") { if (timer) { clearTimeout(timer); timer = 0; } if (pendingSig) { forwardSig(pendingSig.mode, pendingSig.level); pendingSig = null; } }   // painting on the worker
    else if (m.t === "lvl") { handle.level = m.v; handle.stateMode = m.mode; if (typeof handle.onLevel === "function") { try { handle.onLevel(m.v, m.mode); } catch (e) {} } }   // optional debug readback (opts.debug)
    else if (m.t === "fail") { toWebgl(); }
  };
  worker.onerror = () => toWebgl();
  timer = setTimeout(toWebgl, 4500);
  try { worker.postMessage({ t: "probe" }); } catch (e) { toWebgl(); }

  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => { if (transferred && worker && !stopped) { try { worker.postMessage({ t: "size", cssW: cw(), cssH: ch(), dpr: dpr() }); } catch (e) {} } });
    try { ro.observe(canvas); } catch (e) {}
  }

  // ── Q-state reactivity: forward the global `holo-q-state` events to the worker (the messenger dispatches them
  // when Q is thinking/listening/speaking), so the orb visibly REACTS instead of only idling. Buffered until the
  // worker is live (pendingSig), and torn down with the orb (stop() removes the listener). ──
  const MODE_MAP = { idle: 0, listening: 1, thinking: 2, speaking: 3 };
  function forwardSig(modeNum, level) {
    if (worker && transferred && !stopped) { try { worker.postMessage({ t: "sig", mode: modeNum, level: level }); } catch (e) {} }
    else pendingSig = { mode: modeNum, level: level };
  }
  handle.signal = function (s) { s = s || {}; forwardSig(MODE_MAP[s.mode] || 0, (typeof s.level === "number") ? s.level : -1); };
  onQState = (e) => handle.signal((e && e.detail) || {});
  if (typeof window !== "undefined") { try { window.addEventListener("holo-q-state", onQState); } catch (e) {} }
  return handle;
}

// ── VISIBILITY BUDGET (M5-L1) — the orb is a CONTINUOUS GPU raymarch; on a phone it must cost ~nothing when it
// can't be seen. The dominant case is the app/tab BACKGROUNDED — halt the loop on `visibilitychange`/document.hidden
// and resume on return. This is 100% reliable and self-correcting: the orb runs exactly as before whenever the app
// is foreground-visible, and goes idle (no rAF, no GPU) the moment it's backgrounded — the big battery/thermal win.
// prefers-reduced-motion → paint one calm frame, then hold static (the base <img> behind the canvas carries the
// still orb, so it never goes blank). Fail-safe: any error leaves the orb running exactly as before — we never
// break the orb to save a frame. (Off-screen-while-foreground gating via IntersectionObserver is deferred to a
// later L1 pass, pending real-device verification — it can't be exercised in a throttled headless tab.)
function budgetByVisibility(canvas, h) {
  try {
    if (!h || typeof h.pause !== "function" || typeof h.resume !== "function") return h;   // mode:"none" → nothing to gate
    if (typeof document === "undefined") return h;
    const reduce = (typeof matchMedia === "function") && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      const t = setTimeout(function () { try { h.pause(); } catch (e) {} }, 450);   // one frame settles, then the still image holds
      const os = h.stop && h.stop.bind(h);
      h.stop = function () { try { clearTimeout(t); } catch (e) {} if (os) os(); };
      return h;
    }
    let gone = false;
    const onVis = function () { if (gone) return; try { document.hidden ? h.pause() : h.resume(); } catch (e) {} };
    try { document.addEventListener("visibilitychange", onVis); } catch (e) {}
    const os = h.stop && h.stop.bind(h);
    h.stop = function () {
      gone = true;
      try { document.removeEventListener("visibilitychange", onVis); } catch (e) {}
      if (os) os();
    };
    if (document.hidden) onVis();   // mounted while backgrounded → start idle
    return h;
  } catch (e) { return h; }
}

export function mountOrb(canvas, opts) {
  const h = mountGpuOrb(canvas, opts)   // native-WebGPU worker orb (off the main thread) — the hero
    || mountWebglOrb(canvas);           // no WebGPU/Worker/OffscreenCanvas → the WebGL2 wireframe floor
  return budgetByVisibility(canvas, h);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// FALLBACK — the original self-contained WebGL2 wireframe icosphere (VERBATIM from hf-space-q-chat/core/
// holo-orb.js), so where WebGPU/worker isn't available the messenger's Q orb still animates as it always has.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const SPECTRUM = [[1,.231,.42],[1,.62,.173],[1,.886,.29],[.275,.878,.541],[.169,.831,1],[.357,.549,1],[.78,.482,1],[1,.231,.42]];
function hueAt(t){ t=(t%1+1)%1; const n=SPECTRUM.length-1, f=t*n, i=Math.floor(f), k=f-i, a=SPECTRUM[i], b=SPECTRUM[Math.min(i+1,n)]; return [a[0]+(b[0]-a[0])*k, a[1]+(b[1]-a[1])*k, a[2]+(b[2]-a[2])*k]; }
function norm(v){ const l=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/l,v[1]/l,v[2]/l]; }
function icosphere(sub){
  const t=(1+Math.sqrt(5))/2;
  let V=[[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(norm);
  let F=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  const cache=new Map();
  const mid=(a,b)=>{ const key=a<b?a+"_"+b:b+"_"+a; if(cache.has(key))return cache.get(key); const m=norm([(V[a][0]+V[b][0])/2,(V[a][1]+V[b][1])/2,(V[a][2]+V[b][2])/2]); V.push(m); const i=V.length-1; cache.set(key,i); return i; };
  for(let s=0;s<sub;s++){ const nf=[]; for(const [a,b,c] of F){ const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a); nf.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]); } F=nf; }
  const seen=new Set(), E=[];
  for(const [a,b,c] of F) for(const [x,y] of [[a,b],[b,c],[c,a]]){ const k=x<y?x+"_"+y:y+"_"+x; if(!seen.has(k)){ seen.add(k); E.push(x,y); } }
  return { V, E };
}
function mat4Perspective(fovy, aspect, near, far){ const f=1/Math.tan(fovy/2), nf=1/(near-far); return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]); }

function mountWebglOrb(canvas){
  let gl; try { gl = canvas.getContext("webgl2", { alpha:true, antialias:true, premultipliedAlpha:false }); } catch(e){}
  if(!gl) return { fallback:true, mode:"none", stop(){} };
  const { V, E } = icosphere(3);
  const pos=new Float32Array(E.length*3), col=new Float32Array(E.length*3);
  for(let i=0;i<E.length;i++){ const p=V[E[i]]; pos[i*3]=p[0]; pos[i*3+1]=p[1]; pos[i*3+2]=p[2]; const h=hueAt(Math.atan2(p[2],p[0])/(2*Math.PI)+0.5); col[i*3]=h[0]; col[i*3+1]=h[1]; col[i*3+2]=h[2]; }
  const vs=`#version 300 es
    in vec3 aPos; in vec3 aCol; uniform mat4 uProj; uniform float uT; out vec3 vCol; out float vD;
    void main(){
      float a=uT*0.9, ca=cos(a), sa=sin(a);
      vec3 p=vec3(ca*aPos.x+sa*aPos.z, aPos.y, -sa*aPos.x+ca*aPos.z);
      float ax=uT*0.556, cx=cos(ax), sx=sin(ax);
      p=vec3(p.x, cx*p.y - sx*p.z, sx*p.y + cx*p.z);
      float br=1.0 + 0.05*sin(uT*1.3+p.y*3.0) + 0.035*sin(uT*0.7+p.x*4.0);
      p*=br; vD=p.z; p.z-=3.15;
      gl_Position=uProj*vec4(p,1.0); vCol=aCol;
    }`;
  const fs=`#version 300 es
    precision highp float; in vec3 vCol; in float vD; out vec4 o;
    void main(){ float d=0.72+0.28*smoothstep(-1.0,1.0,vD); o=vec4(vCol*d, 0.92); }`;
  const sh=(t,s)=>{ const o=gl.createShader(t); gl.shaderSource(o,s); gl.compileShader(o); if(!gl.getShaderParameter(o,gl.COMPILE_STATUS)){ console.error("[orb] shader:", gl.getShaderInfoLog(o)); } return o; };
  const prog=gl.createProgram(); gl.attachShader(prog,sh(gl.VERTEX_SHADER,vs)); gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,fs)); gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){ console.error("[orb] link:", gl.getProgramInfoLog(prog)); return { fallback:true, mode:"none", stop(){} }; }
  gl.useProgram(prog);
  const mkBuf=(data,loc)=>{ const b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0); };
  mkBuf(pos, gl.getAttribLocation(prog,"aPos")); mkBuf(col, gl.getAttribLocation(prog,"aCol"));
  const uProj=gl.getUniformLocation(prog,"uProj"), uT=gl.getUniformLocation(prog,"uT");
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.lineWidth(1);
  let raf=0, t0=performance.now(), stopped=false, paused=false;
  function resize(){ const dpr=Math.min(window.devicePixelRatio||1, 2.5); const w=Math.max(2, canvas.clientWidth), h=Math.max(2, canvas.clientHeight); const W=Math.round(w*dpr), H=Math.round(h*dpr); if(canvas.width!==W||canvas.height!==H){ canvas.width=W; canvas.height=H; } gl.viewport(0,0,canvas.width,canvas.height); gl.uniformMatrix4fv(uProj,false, mat4Perspective(45*Math.PI/180, canvas.width/canvas.height, 0.1, 10)); }
  function frame(){ if(stopped||paused) return; resize(); const t=(performance.now()-t0)/1000; gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.uniform1f(uT,t); gl.drawArrays(gl.LINES,0,E.length); raf=requestAnimationFrame(frame); }
  frame();
  return {
    stop(){ stopped=true; cancelAnimationFrame(raf); raf=0; },
    pause(){ if(paused||stopped) return; paused=true; if(raf){ cancelAnimationFrame(raf); raf=0; } },   // halt while unseen; the last frame stays painted
    resume(){ if(!paused||stopped) return; paused=false; if(!raf) frame(); },
    fallback:false, mode:"webgl" };
}

export default mountOrb;
