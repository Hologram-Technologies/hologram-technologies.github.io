// holo-canvas-gl.mjs — the WebGL2 twin of holo-canvas.mjs (HoloCanvas). Same projection envelope, same
// contract, but runs where there is NO WebGPU adapter — e.g. the native CEF host (hardware WebGL2 via
// ANGLE, but no Dawn in libcef; see M1-webgpu-diagnosis.md). So an imported app renders at an INTERNAL
// resolution and is super-res'd (Catmull-Rom upscale + CAS sharpen, the same kernel as water-webgl.js /
// holo-render-sr.js) to the display at devicePixelRatio — TODAY, no libcef rebuild.
//
// HONEST: the GPU still draws every pixel; we draw fewer (internal-res) and restore detail in a cheap
// pass. NO-OP SAFE: no WebGL2 / no app canvas / ?sr=0 ⇒ the app runs untouched. Pure helpers (tier/scale)
// are reused from holo-canvas.mjs so WebGPU and WebGL2 tier identically.

import { tierFor, scaleFor, clampOut, frameNovel } from "./holo-canvas.mjs";

const VERT = `#version 300 es
out vec2 vUv;
void main(){ vec2 p=vec2(gl_VertexID==1?3.0:-1.0, gl_VertexID==2?3.0:-1.0); vUv=(p+1.0)*0.5; gl_Position=vec4(p,0.0,1.0); }`;

// Catmull-Rom upscale. Samples the SOURCE (a canvas-oriented texture) with a y-flip so the result is
// upright on the GL framebuffer; the CAS pass then samples that (GL-oriented) texture straight.
const FS_UPSCALE = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uSrc; uniform float uFlip; out vec4 o;
float cr(float x){ float a=-0.5; float ax=abs(x);
  if(ax<1.0)return (a+2.0)*ax*ax*ax-(a+3.0)*ax*ax+1.0; if(ax<2.0)return a*ax*ax*ax-5.0*a*ax*ax+8.0*a*ax-4.0*a; return 0.0; }
void main(){ vec2 uv=vec2(vUv.x, mix(vUv.y, 1.0-vUv.y, uFlip));
  vec2 dim=vec2(textureSize(uSrc,0)); vec2 inv=1.0/dim; vec2 c=uv*dim-0.5; vec2 b=floor(c); vec2 f=c-b;
  vec4 col=vec4(0.0); float ws=0.0;
  for(int m=-1;m<=2;m++){ float wy=cr(f.y-float(m));
    for(int n=-1;n<=2;n++){ float w=cr(f.x-float(n))*wy; col+=w*texture(uSrc,(b+vec2(float(n),float(m))+0.5)*inv); ws+=w; } }
  o=vec4((col/ws).rgb,1.0); }`;

const FS_CAS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uImg; uniform float uSharp; out vec4 o;
void main(){ vec2 dim=vec2(textureSize(uImg,0)); vec2 px=1.0/dim;
  vec3 c=texture(uImg,vUv).rgb;
  vec3 u=texture(uImg,vUv+vec2(0.0,-px.y)).rgb; vec3 d=texture(uImg,vUv+vec2(0.0,px.y)).rgb;
  vec3 l=texture(uImg,vUv+vec2(-px.x,0.0)).rgb; vec3 r=texture(uImg,vUv+vec2(px.x,0.0)).rgb;
  vec3 mn=min(c,min(min(u,d),min(l,r))); vec3 mx=max(c,max(max(u,d),max(l,r)));
  vec3 amp=sqrt(clamp(min(mn,vec3(1.0)-mx)/max(mx,vec3(1e-4)),vec3(0.0),vec3(1.0)));
  vec3 w=-amp*mix(0.1,0.25,clamp(uSharp,0.0,1.0));
  vec3 res=(c+(u+d+l+r)*w)/(vec3(1.0)+4.0*w);
  o=vec4(clamp(res,vec3(0.0),vec3(1.0)),1.0); }`;

export class HoloCanvasGL {
  constructor(outCanvas, { sharpen = 0.6, maxDim = 8192 } = {}) {
    this.canvas = outCanvas; this.sharpenAmt = sharpen; this.maxDim = maxDim;
    this.stats = { fps: 0, outW: 0, outH: 0, srcW: 0, srcH: 0, mode: "sr", engine: "webgl2" }; this._last = 0;
  }
  init() {
    const gl = this.canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error("no WebGL2");
    this.gl = gl;
    this.maxDim = Math.min(this.maxDim, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    this.vao = gl.createVertexArray();
    this.pUp = this._prog(FS_UPSCALE); this.pCas = this._prog(FS_CAS);
    this.uUpFlip = gl.getUniformLocation(this.pUp, "uFlip");
    this.uCasSharp = gl.getUniformLocation(this.pCas, "uSharp");
    return this;
  }
  _prog(fs) {
    const gl = this.gl, mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("GLSL: " + gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p)); return p;
  }
  _tex(w, h) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  setOutput(w, h) {
    const gl = this.gl, W = clampOut(w, this.maxDim), H = clampOut(h, this.maxDim);
    if (W === this.stats.outW && H === this.stats.outH && this.texA) return;
    this.stats.outW = this.canvas.width = W; this.stats.outH = this.canvas.height = H;
    if (this.texA) gl.deleteTexture(this.texA);
    this.texA = this._tex(W, H);
    this.fbo = this.fbo || gl.createFramebuffer();
  }
  _setSource(w, h) {
    const gl = this.gl; this.stats.srcW = w; this.stats.srcH = h;
    if (this.srcTex) gl.deleteTexture(this.srcTex);
    this.srcTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  _pass(prog, tex, fbo, vpW, vpH, flip, sharp) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    if (fbo) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texA, 0);
    gl.viewport(0, 0, vpW, vpH); gl.useProgram(prog); gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, prog === this.pUp ? "uSrc" : "uImg"), 0);
    if (prog === this.pUp) gl.uniform1f(this.uUpFlip, flip ? 1 : 0);
    if (prog === this.pCas) gl.uniform1f(this.uCasSharp, this.sharpenAmt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // capture a live same-origin canvas and project it. mode: "sr" | "bicubic" | "off".
  present(srcCanvas, mode = "sr") {
    const gl = this.gl, now = performance.now();
    if (this._last) { const i = 1000 / Math.max(0.001, now - this._last); this.stats.fps = this.stats.fps ? this.stats.fps * 0.9 + i * 0.1 : i; }
    this._last = now; this.stats.mode = mode;
    const w = srcCanvas.width || srcCanvas.videoWidth || 0, h = srcCanvas.height || srcCanvas.videoHeight || 0;
    if (!w || !h || !this.texA) return this.stats;
    if (w !== this.stats.srcW || h !== this.stats.srcH) this._setSource(w, h);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas); }
    catch (e) { this.stats.captureErr = String(e?.message || e).slice(0, 80); return this.stats; }
    if (mode === "bicubic") { this._pass(this.pUp, this.srcTex, null, this.stats.outW, this.stats.outH, true); }
    else { this._pass(this.pUp, this.srcTex, this.fbo, this.stats.outW, this.stats.outH, true);     // src → texA (upright)
           this._pass(this.pCas, this.texA, null, this.stats.outW, this.stats.outH, false); }        // texA → canvas (sharpen)
    return this.stats;
  }
  setSharpen(a) { this.sharpenAmt = a; }
  destroy() { try { const gl = this.gl; gl?.getExtension("WEBGL_lose_context")?.loseContext(); } catch (e) {} }
}

// probe WebGL2 + tier it (same shape as holo-canvas detectGPU, so callers branch on .engine).
export function detectGL() {
  try {
    const c = (typeof OffscreenCanvas !== "undefined") ? new OffscreenCanvas(4, 4) : document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return { ok: false, reason: "no-webgl2" };
    const profile = { maxTextureDimension2D: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxBufferSize: 0, isFallbackAdapter: false };
    return { ok: true, engine: "webgl2", reason: "probed-gl", profile, tier: tierFor(profile) };
  } catch (e) { return { ok: false, reason: "gl-threw" }; }
}

// drop-in: wrap an <iframe> running an imported app with the WebGL2 envelope. Same contract as
// holo-canvas.mjs mountEnvelope (returns a no-op-safe controller). `gl` from detectGL().
export function mountEnvelopeGL({ iframe, outCanvas, gl, query, onStats } = {}) {
  const off = { active: false, reason: "", engine: "webgl2", stop() {}, setMode() {}, stats: null };
  if (!gl?.ok) { off.reason = gl?.reason || "no-webgl2"; return off; }
  if (query && query.get("sr") === "0") { off.reason = "disabled"; return off; }
  const dpr = Math.min((typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1), 2);
  const tier = gl.tier; let mode = (query && query.get("mode")) || "sr";
  let comp = null, raf = 0, stopped = false, poll = 0, appCanvas = null, _cap = null, _capCtx = null;
  const ctl = { active: true, reason: "projecting", engine: "webgl2", tier, dpr, stats: null, appCanvas: null,
    setMode(m) { mode = m; }, toggle() { mode = mode === "sr" ? "bicubic" : mode === "bicubic" ? "off" : "sr"; return mode; },
    capture(maxDim = 720) {   // app frame → RGBA (downscaled), the share producer's source (engine-agnostic seam)
      try {
        const cv = appCanvas; if (!cv || !cv.width) return null;
        const s = Math.min(1, maxDim / Math.max(cv.width, cv.height));
        const w = Math.max(1, Math.round(cv.width * s)), h = Math.max(1, Math.round(cv.height * s));
        if (!_cap || _cap.width !== w || _cap.height !== h) { _cap = new OffscreenCanvas(w, h); _capCtx = _cap.getContext("2d", { willReadFrequently: true }); }
        _capCtx.drawImage(cv, 0, 0, w, h);
        return { rgba: new Uint8Array(_capCtx.getImageData(0, 0, w, h).data.buffer), w, h };
      } catch (e) { return null; }
    },
    stop() { stopped = true; cancelAnimationFrame(raf); clearInterval(poll); comp?.destroy(); ctl.active = false; } };
  try { iframe.style.background = "transparent"; } catch (e) {}
  try {
    comp = new HoloCanvasGL(outCanvas, { sharpen: tier.sharpen, maxDim: gl.profile.maxTextureDimension2D }).init();
    const sizeOut = () => comp.setOutput((window.innerWidth || 16) * dpr, (window.innerHeight || 16) * dpr);
    sizeOut(); window.addEventListener("resize", sizeOut);
    poll = setInterval(() => {
      let cv = null; try { cv = iframe.contentDocument?.querySelector("canvas"); } catch (e) {}
      if (cv && cv.width > 2 && cv.height > 2) {
        clearInterval(poll); appCanvas = cv; ctl.appCanvas = cv;
        try { cv.style.opacity = "0"; const d = iframe.contentDocument; d.documentElement.style.background = "transparent"; if (d.body) d.body.style.background = "transparent"; } catch (e) {}
        let lastSeq = -1, presented = 0, skipped = 0;
        const readSeq = () => { try { const v = iframe.contentWindow?.__holoSeq; return typeof v === "number" ? v : null; } catch (e) { return null; } };
        const loop = () => {
          if (stopped) return;
          const seq = readSeq();
          if (frameNovel(seq, lastSeq)) { try { comp.present(cv, mode); } catch (e) {} lastSeq = seq; presented++; } else skipped++;
          ctl.stats = comp.stats; ctl.stats.presented = presented; ctl.stats.skipped = skipped;
          onStats?.(ctl.stats, tier, mode);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      }
    }, 60);
    setTimeout(() => clearInterval(poll), 25000);
  } catch (e) { ctl.reason = "init-failed: " + (e?.message || e); ctl.active = false; }
  return ctl;
}
