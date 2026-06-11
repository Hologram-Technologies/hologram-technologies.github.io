// holo-soulbis-field.js — the living holographic "wave field" that animates the Hologram
// OS boot splash. A faithful port of the soulbis renderer (github.com/mitchuski/soulbis,
// index.html), whose hero/footer canvases breathe the dual-agent geometry of the
// 0xagentprivacy architecture:
//
//   • a TWO-LATTICE manifold  — two phase-shifted sinusoidal lattices (L = 0,1), the dual
//     agents, woven across the field and bending toward a focal "soul orb";
//   • a drifting CONSTELLATION — points of light (mostly neutral, some cyan, some coral)
//     linked by gossamer lines when they pass near one another;
//   • a SOUL-ORB glass lens     — the focal point: the manifold re-sampled into a clipped
//     circle behind a glass radial gradient (cyan "rear" → glass → coral "forward").
//
// The colour language is soulbis's, kept verbatim: Coral #e8523a (the Swordsman — tools,
// enforcement, the forward edge) ⇄ Cyan #4dd9e8 (the Mage — gestalt, the rear depth),
// over deep navy. On the splash the navy is the boot's own indigo (≈ identical), so the
// field is composited with `mix-blend-mode: screen`: navy is the identity for screen-blend
// and contributes nothing — only the glowing lines and stars add as holographic light over
// the boot theme, and the centred boot logo becomes the soul orb the manifold flows toward.
//
// The wave maths (manifoldY, the strokePass lens, the Star field, the coral⇄cyan ramp) are
// soulbis's, reproduced faithfully. What is new here is only the HOST: a single full-stage
// canvas (rather than three section canvases), a device-tier backing store so the vector
// strokes resolve crisp all the way to 8K, a dynamic focal point, and reduced-motion +
// page-visibility politeness. No soulbis bytes are vendored; this is a from-spec port.

const CORAL = { r: 232, g: 82, b: 58 };   // #e8523a — Swordsman
const CYAN  = { r: 77,  g: 217, b: 232 }; // #4dd9e8 — Mage
const round = Math.round;
const lerp = (a, b, m) => round(a + (b - a) * m);

// coral → cyan across a line's progress (the hero direction). prog 0 = coral, 1 = cyan.
function lineRgb(prog) {
  return { r: lerp(CORAL.r, CYAN.r, prog), g: lerp(CORAL.g, CYAN.g, prog), b: lerp(CORAL.b, CYAN.b, prog) };
}

// ── the drifting constellation (soulbis Star, verbatim behaviour) ──────────────────────
class Star {
  constructor(w, h) { this.w = w; this.h = h; this.reset(); }
  reset() {
    this.x = Math.random() * this.w;
    this.y = Math.random() * this.h;
    this.size = Math.random() * 2 + 0.5;
    this.speedX = (Math.random() - 0.5) * 0.3;
    this.speedY = (Math.random() - 0.5) * 0.2;
    this.opacity = Math.random() * 0.6 + 0.2;
    this.pulse = Math.random() * Math.PI * 2;
    // mostly white/neutral, some cyan (Mage), some coral (Swordsman)
    const roll = Math.random();
    this.color = roll < 0.7 ? "240,238,232" : roll < 0.85 ? "77,217,232" : "232,82,58";
  }
  update() {
    this.x += this.speedX; this.y += this.speedY; this.pulse += 0.02;
    if (this.x < 0 || this.x > this.w || this.y < 0 || this.y > this.h) this.reset();
  }
  draw(ctx) {
    const flicker = Math.sin(this.pulse) * 0.3 + 0.7;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${this.color},${this.opacity * flicker})`;
    ctx.fill();
  }
}

// ── the two-lattice manifold height field (soulbis heroManifoldY, verbatim) ────────────
// x is a stage-space x; `lattice` (0|1) phases the second agent against the first; the
// field bows toward the focal orb via an exponential well around orbX, then is pulled
// toward orbY. The result reads as one woven surface with a gravitational focus.
function manifoldY(x, t, prog, w, h, orbX, orbY, lattice) {
  const lat = lattice | 0;
  const latPhase = lat * 0.55;
  const xNorm = (x - orbX) / (w * 0.5);
  const yBase = h * 0.5 + (prog - 0.5) * h * 0.8;
  const distFromOrb = Math.abs(x - orbX) / w;
  const orbInfluence = Math.exp(-distFromOrb * 3) * 80;
  let y = yBase;
  y += Math.sin(xNorm * 4 + t * 0.4 + prog * 1.5 + latPhase) * 50 * (1 - Math.abs(prog - 0.5) * 1.5);
  y += Math.sin(xNorm * 2.5 - t * 0.3 + prog * 2.5 - latPhase * 0.7) * 30;
  y += Math.cos(xNorm * 6 + t * 0.5 + latPhase) * 15;
  y += (orbY - yBase) * orbInfluence * 0.015;
  return y;
}

/**
 * Attach the soulbis wave field to a <canvas>.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [opts]
 * @param {(w:number,h:number)=>{x:number,y:number}} [opts.focus] focal orb centre in CSS px
 * @param {number} [opts.dpr]      desired device-pixel-ratio (capped by maxDim)
 * @param {number} [opts.maxDim]   longest backing-store edge ceiling (8K tier ⇒ 7680)
 * @param {number} [opts.lines]    manifold line count (soulbis hero = 70)
 * @param {number} [opts.pts]      samples per line (soulbis hero = 250)
 * @param {number} [opts.speed]    time step per frame (soulbis = 0.008)
 * @param {boolean}[opts.orb]      render the soul-orb glass lens at the focus (default true)
 * @returns {{start:Function,stop:Function,resize:Function,dispose:Function,
 *            pause:Function,resume:Function,setSpeed:Function,running:()=>boolean}}
 */
export function createSoulbisField(canvas, opts = {}) {
  const ctx = canvas.getContext("2d");
  const cfg = {
    focus: opts.focus || ((w, h) => ({ x: w / 2, y: h * 0.42 })),
    dpr: opts.dpr || (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1,
    maxDim: opts.maxDim || 4096,
    lines: opts.lines || 70,
    pts: opts.pts || 250,
    speed: opts.speed == null ? 0.008 : opts.speed,
    orb: opts.orb !== false,
  };
  const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  let cssW = 0, cssH = 0, dprEff = 1;
  let t = 0, rafId = 0, running = false, paused = false;
  let stars = [];

  // CSS rect + an effective dpr capped so the backing store's longest edge ≤ maxDim. Vector
  // strokes stay razor-sharp at whatever the device can present — 1080p phone to 8K wall.
  function resize() {
    const r = canvas.getBoundingClientRect();
    cssW = Math.max(64, Math.floor(r.width || canvas.offsetWidth || 0));
    cssH = Math.max(64, Math.floor(r.height || canvas.offsetHeight || 0));
    dprEff = Math.max(1, Math.min(cfg.dpr, cfg.maxDim / Math.max(cssW, cssH)));
    canvas.width = Math.round(cssW * dprEff);
    canvas.height = Math.round(cssH * dprEff);
    ctx.setTransform(dprEff, 0, 0, dprEff, 0, 0);
    // constellation density tracks area (soulbis ships 80 over a hero viewport); keep the
    // same visual density as the field scales up, clamped so 8K stays light, not noisy.
    const target = round(80 * Math.sqrt((cssW * cssH) / (1440 * 900)));
    const n = Math.max(70, Math.min(280, target));
    stars = []; for (let i = 0; i < n; i++) stars.push(new Star(cssW, cssH));
    if (!running) renderFrame();   // keep a static frame correct when paused/reduced
  }

  // ── the soul-orb glass lens (soulbis drawHeroOrb, re-projected onto the main ctx) ──────
  // A clipped circle of radius R at the focus, into which the manifold is re-sampled (a
  // gentle zoom), layered: cyan rear field → a glass radial gradient → coral forward field.
  function drawOrb(orbX, orbY, w, h) {
    const R = Math.max(28, Math.min(w, h) * 0.16);
    const cw = 2 * R, ch = 2 * R;
    const sample = (w * 0.24) / cw;       // how much stage-x one lens-x spans (soulbis ratio)
    const yScale = (ch * 0.92) / (h * 0.55);
    const lines = 28, half = lines >> 1, pts = 72;

    ctx.save();
    ctx.translate(orbX - R, orbY - R);     // lens-local coords: centre at (R,R)
    ctx.beginPath();
    ctx.arc(R, R, R - 0.5, 0, Math.PI * 2);
    ctx.clip();

    const strokePass = (minProg, maxProg, alpha, lw, fixed) => {
      for (let L = 0; L < 2; L++) {
        for (let i = 0; i < half; i++) {
          const idx = L * half + i;
          const prog = idx / Math.max(1, lines - 1);
          if (prog < minProg || prog > maxProg) continue;
          const { r, g, b } = fixed || lineRgb(prog);
          ctx.beginPath();
          for (let j = 0; j <= pts; j++) {
            const x = (j / pts) * cw;
            const xFoot = orbX + (x - cw / 2) * sample;
            const yFoot = manifoldY(xFoot, t, prog, w, h, orbX, orbY, L);
            const y = ch / 2 + (yFoot - orbY) * yScale;
            j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.lineWidth = lw;
          ctx.stroke();
        }
      }
    };

    // rear field (cyan-leaning, soft) + a Mage cyan tint
    strokePass(0, 0.46, 0.13, 0.52);
    strokePass(0, 0.4, 0.2, 0.62, CYAN);
    // glass lens between depth layers
    const gx = R, gy = R;
    const gr = ctx.createRadialGradient(gx - ch * 0.15, gy - ch * 0.18, 0, gx, gy, ch * 0.58);
    gr.addColorStop(0, "rgba(240,238,232,0.09)");
    gr.addColorStop(0.35, "rgba(8,12,32,0.24)");
    gr.addColorStop(0.72, "rgba(8,12,32,0.06)");
    gr.addColorStop(1, "rgba(232,82,58,0.09)");
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, cw, ch);
    // forward spectrum (coral-leaning) + a Swordsman coral overlay
    strokePass(0.52, 1, 0.3, 0.76);
    strokePass(0.65, 1, 0.26, 0.72, CORAL);

    ctx.restore();
  }

  function renderFrame() {
    const w = cssW, h = cssH;
    if (w < 2 || h < 2) return;
    const { x: orbX, y: orbY } = cfg.focus(w, h);
    ctx.clearRect(0, 0, w, h);

    // 1 · constellation + proximity links (soulbis density/threshold)
    for (const s of stars) { s.update(); s.draw(ctx); }
    ctx.strokeStyle = "rgba(240,238,232,0.06)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const dx = stars[i].x - stars[j].x, dy = stars[i].y - stars[j].y;
        if (dx * dx + dy * dy < 100 * 100) {
          ctx.beginPath();
          ctx.moveTo(stars[i].x, stars[i].y);
          ctx.lineTo(stars[j].x, stars[j].y);
          ctx.stroke();
        }
      }
    }

    // 2 · the two-lattice manifold (L = 0,1), coral → cyan, bowing toward the orb
    const half = Math.floor(cfg.lines / 2);
    for (let L = 0; L < 2; L++) {
      for (let i = 0; i < half; i++) {
        const idx = L * half + i;
        const prog = idx / cfg.lines;
        const { r, g, b } = lineRgb(prog);
        ctx.beginPath();
        for (let j = 0; j <= cfg.pts; j++) {
          const x = (j / cfg.pts) * w;
          const y = manifoldY(x, t, prog, w, h, orbX, orbY, L);
          j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${r},${g},${b},0.26)`;
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
    }

    // 3 · the soul-orb glass lens at the focus (the boot logo's halo)
    if (cfg.orb) drawOrb(orbX, orbY, w, h);
  }

  function frame() {
    renderFrame();
    if (!paused) t += cfg.speed;
    if (running) rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return api;
    if (!cssW || !cssH) resize();
    if (reduceMotion) { renderFrame(); return api; }   // honour reduced motion: one still frame
    running = true; paused = false;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
    return api;
  }
  function stop() { running = false; cancelAnimationFrame(rafId); }
  function pause() { paused = true; }
  function resume() { paused = false; }
  function setSpeed(s) { cfg.speed = s; }
  function dispose() { stop(); document.removeEventListener("visibilitychange", onVis); }

  // page-visibility politeness — don't burn frames on a backgrounded tab
  function onVis() {
    if (document.hidden) { if (running) cancelAnimationFrame(rafId); }
    else if (running && !reduceMotion) { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(frame); }
  }
  document.addEventListener("visibilitychange", onVis);

  const api = { start, stop, resize, dispose, pause, resume, setSpeed, running: () => running };
  resize();
  return api;
}

export default createSoulbisField;
