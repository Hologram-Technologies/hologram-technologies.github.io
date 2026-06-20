// holo-cosmos.js — Holo Cosmos (ADR-0080, Stage 3): a real-time, navigable, INFINITELY-detailed
// space environment rendered from a κ SEED. Pure procedural: a fullscreen WebGL2 fragment shader
// raymarches a starfield + nebula + a distant sun, computed from world coordinates by hash — so
// detail is unbounded and storage is zero. The whole universe IS its seed: same seed κ → byte-
// identical universe on every device, re-derivable (Law L5). You fly through it (look + throttle).
//
//   HoloCosmos.start(canvas, { seed, reduced }) -> { stop() } | null   (null ⇒ no WebGL2; caller falls back)
//
// Honest scope: this is the L1 procedural core (the "cockpit exploring infinite space"). WebGPU
// (ADR L3, holo-gpu) and κ-streamed LOD chunks (L5) are the later refinements; WebGL2 ships now and
// is verifiable (readPixels). Degrades cleanly — returns null where WebGL2 is unavailable.

const VERT = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 frag;
uniform vec2 uRes; uniform float uTime; uniform vec3 uCam; uniform vec2 uLook; uniform vec3 uSeed; uniform float uReduced;

float h31(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float h21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec3  h33(vec3 p){ p=fract(p*vec3(0.1031,0.1030,0.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float noise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x), mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x), mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.03+vec3(7.1,3.7,1.3); a*=0.5; } return s; }
mat3 lookMat(vec2 a){ float cy=cos(a.x),sy=sin(a.x),cp=cos(a.y),sp=sin(a.y);
  return mat3(cy,0.0,sy, 0.0,1.0,0.0, -sy,0.0,cy) * mat3(1.0,0.0,0.0, 0.0,cp,-sp, 0.0,sp,cp); }

void main(){
  vec2 uv = (gl_FragCoord.xy*2.0 - uRes) / uRes.y;
  vec3 rd = normalize(lookMat(uLook) * vec3(uv, 1.45));
  vec3 ro = uCam;
  vec3 colA = 0.55 + 0.45*cos(6.2831*(uSeed.x + vec3(0.0,0.33,0.67)));   // nebula palette A
  vec3 colB = 0.55 + 0.45*cos(6.2831*(uSeed.y + vec3(0.15,0.45,0.8)));   // palette B / star tint

  vec3 col = mix(vec3(0.012,0.018,0.04), colA*0.08, smoothstep(-0.6,0.8,rd.y));

  // ── starfield: 3 depth layers that stream past as the camera flies (parallax) ──
  for(int L=0; L<3; L++){
    float dist = 6.0 + float(L)*10.0;
    vec3 sp = ro/dist + rd*(2.0+float(L)*2.0);
    vec3 cell = floor(sp*7.0);
    vec3 hr = h33(cell + uSeed*17.0 + float(L)*5.0);
    float on = step(0.965 - float(L)*0.006, hr.x);
    float d = length(fract(sp*7.0) - hr);
    float tw = uReduced>0.5 ? 0.85 : (0.55 + 0.45*sin(uTime*(0.6+hr.y*3.0) + hr.z*6.28));
    col += on * smoothstep(0.22,0.0,d) * tw * 1.8 * mix(vec3(1.0), colB, hr.z) * (1.0 - float(L)*0.2);
  }

  // ── nebula: raymarch steps through fbm density, emissive, depth-faded (the colourful gas) ──
  vec3 neb = vec3(0.0); float t = 0.0;
  for(int i=0;i<20;i++){
    vec3 p = ro*0.04 + rd*t + uSeed*4.0;
    float dens = smoothstep(0.50, 0.82, fbm(p*0.5));
    vec3 ec = mix(colA, colB, fbm(p*0.27 + 2.3));
    neb += dens * ec * 0.105 * exp(-t*0.05);
    t += 0.62;
  }
  col += neb;

  // ── a distant sun/core in a seed-chosen direction ──
  vec3 sunDir = normalize(vec3(cos(uSeed.z*6.2831), 0.12, sin(uSeed.z*6.2831)));
  float sd = max(0.0, dot(rd, sunDir));
  col += colB*pow(sd,120.0)*3.2 + colA*pow(sd,5.0)*0.5;

  // ── tone, vignette, grain ──
  col = 1.0 - exp(-col*1.45);
  col *= mix(0.5, 1.0, smoothstep(1.5, 0.25, length(uv)));
  col += (h21(gl_FragCoord.xy + uTime) - 0.5) * 0.02;
  frag = vec4(col, 1.0);
}`;

function seedVec(seed) {
  // robust for ANY seed string (a κ hex, an app id, a phrase) → three decorrelated floats in [0,1)
  const s = String(seed || "default-cosmos");
  let a = 0x811c9dc5, b = 0x1000193, c = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); a = ((a ^ ch) * 16777619) >>> 0; b = (b + ch * 2654435761) >>> 0; c = ((c ^ (ch + i)) * 2246822519) >>> 0; }
  return [(a % 100003) / 100003, (b % 100003) / 100003, (c % 100003) / 100003];
}

export function start(canvas, opts = {}) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { try { console.warn("holo-cosmos shader:", gl.getShaderInfoLog(s)); } catch {} return null; } return s; };
  const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { try { console.warn("holo-cosmos link:", gl.getProgramInfoLog(prog)); } catch {} return null; }
  gl.useProgram(prog);
  const U = (n) => gl.getUniformLocation(prog, n);
  const uRes = U("uRes"), uTime = U("uTime"), uCam = U("uCam"), uLook = U("uLook"), uSeed = U("uSeed"), uReduced = U("uReduced");
  const seed = seedVec(opts.seed);
  const reduced = !!opts.reduced;
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);

  const DPR = () => Math.min(opts.maxScale || 2, (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1);
  const CAP = 2560;   // cap the raymarch buffer's longest side — procedural detail stays "infinite", fps stays high
  let W = 0, H = 0;
  function resize() {
    const r = canvas.getBoundingClientRect(); let w = Math.max(2, Math.round((r.width || canvas.clientWidth || 320) * DPR())), h = Math.max(2, Math.round((r.height || canvas.clientHeight || 200) * DPR()));
    const m = Math.max(w, h); if (m > CAP) { const k = CAP / m; w = Math.round(w * k); h = Math.round(h * k); }
    if (w !== W || h !== H) { W = w; H = h; canvas.width = W; canvas.height = H; gl.viewport(0, 0, W, H); }
  }

  // ── cockpit: continuous forward flight + look (pointer/tilt) + throttle (wheel) + autonomous drift ──
  let yaw = 0, pit = 0, tyaw = 0, tpit = 0, throttle = 0, thrT = 0;
  const cam = [0, 0, 0];
  const onPtr = (e) => { tyaw = (e.clientX / (innerWidth || 1) - 0.5) * 1.1; tpit = -(e.clientY / (innerHeight || 1) - 0.5) * 0.7; };
  const onTilt = (e) => { if (e.gamma != null) { tyaw = Math.max(-1, Math.min(1, e.gamma / 35)); tpit = Math.max(-0.6, Math.min(0.6, -(e.beta - 45) / 45)); } };
  const onWheel = (e) => { thrT = Math.max(-0.5, Math.min(4, thrT - e.deltaY * 0.002)); };
  if (!reduced) { window.addEventListener("pointermove", onPtr, { passive: true }); window.addEventListener("deviceorientation", onTilt, { passive: true }); window.addEventListener("wheel", onWheel, { passive: true }); }

  let raf = 0, t0 = 0, last = 0, running = true;
  function frame(now) {
    if (!running) return;
    resize();
    if (!t0) { t0 = now; last = now; }
    const t = (now - t0) / 1000, dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    yaw += (tyaw - yaw) * 0.05; pit += (tpit - pit) * 0.05; throttle += (thrT - throttle) * 0.04;
    const dyaw = reduced ? 0 : Math.sin(t * 0.05) * 0.08, dpit = reduced ? 0 : Math.cos(t * 0.037) * 0.04;
    const cy = Math.cos(yaw + dyaw), sy = Math.sin(yaw + dyaw), cp = Math.cos(pit + dpit), sp = Math.sin(pit + dpit);
    const fwd = [sy * cp, sp, cy * cp];                       // flight along the look direction
    const speed = (reduced ? 0.0 : 2.2) + throttle * 3.0;     // always gently exploring
    cam[0] += fwd[0] * speed * dt; cam[1] += fwd[1] * speed * dt; cam[2] += fwd[2] * speed * dt;
    gl.uniform2f(uRes, W, H); gl.uniform1f(uTime, t); gl.uniform3f(uCam, cam[0], cam[1], cam[2]);
    gl.uniform2f(uLook, yaw + dyaw, pit + dpit); gl.uniform3f(uSeed, seed[0], seed[1], seed[2]); gl.uniform1f(uReduced, reduced ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (reduced) { running = false; return; }
    raf = requestAnimationFrame(frame);
  }
  const onVis = () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf), raf = 0; } else if (running && !reduced && !raf) raf = requestAnimationFrame(frame); };
  document.addEventListener("visibilitychange", onVis);
  frame(typeof performance !== "undefined" && performance.now ? performance.now() : 0);   // paint frame 1 now

  return {
    getCam: () => [cam[0], cam[1], cam[2]],   // current camera position (the L5 streamer reads this)
    stop() { running = false; if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPtr); window.removeEventListener("deviceorientation", onTilt); window.removeEventListener("wheel", onWheel);
      document.removeEventListener("visibilitychange", onVis);
      try { gl.getExtension("WEBGL_lose_context") && gl.getExtension("WEBGL_lose_context").loseContext(); } catch {} } };
}

// ── deterministic single-frame render (P2 parity witness) ────────────────────────────────────────
// Renders ONE frame with EXPLICIT uniforms — no input listeners, no time/camera drift — and returns
// RGBA8 bytes in TOP-LEFT row-major order, so a WebGPU backend (holo-cosmos-gpu.js) can be diff'd
// against this exact WebGL2 baseline pixel-for-pixel. Uses the same VERT/FRAG/seedVec the live cockpit
// ships, so the test reflects the real shader, not a copy. Returns null where WebGL2 is unavailable.
export function renderOnce(canvas, params = {}) {
  const W = Math.max(1, params.width | 0 || 256), H = Math.max(1, params.height | 0 || 256);
  canvas.width = W; canvas.height = H;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { try { console.warn("renderOnce shader:", gl.getShaderInfoLog(s)); } catch {} return null; } return s; };
  const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const U = (n) => gl.getUniformLocation(prog, n);
  const seed = Array.isArray(params.seed) ? params.seed : seedVec(params.seed);
  const cam = params.cam || [0, 0, 0], look = params.look || [0, 0];
  gl.bindVertexArray(gl.createVertexArray());
  gl.viewport(0, 0, W, H);
  gl.uniform2f(U("uRes"), W, H); gl.uniform1f(U("uTime"), params.time || 0);
  gl.uniform3f(U("uCam"), cam[0], cam[1], cam[2]); gl.uniform2f(U("uLook"), look[0], look[1]);
  gl.uniform3f(U("uSeed"), seed[0], seed[1], seed[2]); gl.uniform1f(U("uReduced"), params.reduced ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3); gl.finish();
  const flip = new Uint8Array(W * H * 4), glrows = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, glrows);   // readPixels is bottom-left origin…
  for (let y = 0; y < H; y++) flip.set(glrows.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);   // …flip to top-left to match WebGPU
  try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch {}
  return { w: W, h: H, rgba: flip };
}

export { VERT as GLSL_VERT, FRAG as GLSL_FRAG, seedVec };
export default { start, renderOnce, seedVec };
