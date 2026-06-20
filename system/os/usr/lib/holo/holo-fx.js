// holo-fx.js — unicode motion + ASCII wordmark for hologram. Zero dependencies,
// content-addressable. One tiny module so every surface — boot, loading, progress,
// transitions — feels crisp and alive: the OS's faithful adoption of unicode-animations
// (gunnargray-dev, MIT, v1.0.3 — vendored at vendor/unicode-animations/, the byte source
// of truth this engine reproduces). All 18 spinners + gridToBraille/makeGrid, exact frames.
//
//   <span data-holo-spin="scan"> → declarative spinner, auto-driven, zero script (Law L2)
//   HoloFX.spin(el, "scan")      → a running loader; .stop("✓") to resolve it
//   HoloFX.loader(el, {name,label}) → a labelled chip loader; .stop("✓") to resolve it
//   HoloFX.spinners              → the full {name → {frames, interval}} spec table
//   HoloFX.gridToBraille(grid)   → boolean[][] → braille string  (custom spinners)
//   HoloFX.makeGrid(rows, cols)  → empty boolean grid
//   HoloFX.bar(pct)              → "███████░░░░░░" progress string
//   HoloFX.scramble(el, text)    → decode/glitch text into place (Promise)
//   HoloFX.type(el, text)        → typewriter (Promise)
//   HoloFX.ascii(text, {font})   → text→ASCII art (FIGlet/TAAG), 328 κ-fonts, lazy (Promise<string>)
//   HoloFX.asciiFonts()          → the full list of available font names (Promise<string[]>)
//   HoloFX.BANNER.HOLOGRAM       → the ANSI-Shadow wordmark (string)
//
// House vocabulary (the "Instrument" set — sharp & precise):
//   braille  → inline / row-level (verifying, buttons)
//   scan     → block / search / app-load (a precise two-column sweep)
//   dna      → generative / streaming (inference, decode)
//   cascade  → boot / heavy waits

(function () {
  "use strict";
  if (window.HoloFX) return;

  // This script's own URL, captured synchronously — so the lazy ASCII engine import
  // resolves relative to /usr/lib/holo/, not the host document.
  const FX_SRC = (document.currentScript && document.currentScript.src) || "";
  const ASCII_URL = FX_SRC ? new URL("holo-ascii.mjs", FX_SRC).href : "./holo-ascii.mjs";

  // ── unicode-animations@1.0.3 — vendored frame data & generators (verbatim) ──────────
  const BRAILLE_DOT_MAP = [[1, 8], [2, 16], [4, 32], [64, 128]];
  function gridToBraille(grid) {
    const rows = grid.length;
    const cols = grid[0] ? grid[0].length : 0;
    const charCount = Math.ceil(cols / 2);
    let result = "";
    for (let c = 0; c < charCount; c++) {
      let code = 10240;
      for (let r = 0; r < 4 && r < rows; r++) {
        for (let d = 0; d < 2; d++) {
          const col = c * 2 + d;
          if (col < cols && grid[r] && grid[r][col]) code |= BRAILLE_DOT_MAP[r][d];
        }
      }
      result += String.fromCodePoint(code);
    }
    return result;
  }
  function makeGrid(rows, cols) {
    if (rows <= 0 || cols <= 0) return [];
    return Array.from({ length: rows }, () => Array(cols).fill(false));
  }
  function genScan() {
    const W = 8, H = 4, frames = [];
    for (let pos = -1; pos < W + 1; pos++) {
      const g = makeGrid(H, W);
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (c === pos || c === pos - 1) g[r][c] = true;
      frames.push(gridToBraille(g));
    }
    return frames;
  }
  function genRain() {
    const W = 8, H = 4, totalFrames = 12, frames = [];
    const offsets = [0, 3, 1, 5, 2, 7, 4, 6];
    for (let f = 0; f < totalFrames; f++) {
      const g = makeGrid(H, W);
      for (let c = 0; c < W; c++) { const row = (f + offsets[c]) % (H + 2); if (row < H) g[row][c] = true; }
      frames.push(gridToBraille(g));
    }
    return frames;
  }
  function genScanLine() {
    const W = 6, H = 4, frames = [];
    const positions = [0, 1, 2, 3, 2, 1];
    for (const row of positions) {
      const g = makeGrid(H, W);
      for (let c = 0; c < W; c++) { g[row][c] = true; if (row > 0) g[row - 1][c] = c % 2 === 0; }
      frames.push(gridToBraille(g));
    }
    return frames;
  }
  function genPulse() {
    const W = 6, H = 4, frames = [];
    const cx = W / 2 - 0.5, cy = H / 2 - 0.5;
    const radii = [0.5, 1.2, 2, 3, 3.5];
    for (const r of radii) {
      const g = makeGrid(H, W);
      for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
        const dist = Math.sqrt((col - cx) ** 2 + (row - cy) ** 2);
        if (Math.abs(dist - r) < 0.9) g[row][col] = true;
      }
      frames.push(gridToBraille(g));
    }
    return frames;
  }
  function genSnake() {
    const W = 4, H = 4, path = [];
    for (let r = 0; r < H; r++) {
      if (r % 2 === 0) for (let c = 0; c < W; c++) path.push([r, c]);
      else for (let c = W - 1; c >= 0; c--) path.push([r, c]);
    }
    const frames = [];
    for (let i = 0; i < path.length; i++) {
      const g = makeGrid(H, W);
      for (let t = 0; t < 4; t++) { const idx = (i - t + path.length) % path.length; g[path[idx][0]][path[idx][1]] = true; }
      frames.push(gridToBraille(g));
    }
    return frames;
  }
  function genSparkle() {
    const patterns = [
      [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0],
      [0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0],
      [0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      [0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1],
      [0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0]
    ];
    const W = 8, H = 4, frames = [];
    for (const pat of patterns) {
      const g = makeGrid(H, W);
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) g[r][c] = !!pat[r * W + c];
      frames.push(gridToBraille(g));
    }
    return frames;
  }
  function genCascade() {
    const W = 8, H = 4, frames = [];
    for (let offset = -2; offset < W + H; offset++) {
      const g = makeGrid(H, W);
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const diag = c + r; if (diag === offset || diag === offset - 1) g[r][c] = true; }
      frames.push(gridToBraille(g));
    }
    return frames;
  }
  function genColumns() {
    const W = 6, H = 4, frames = [];
    for (let col = 0; col < W; col++) {
      for (let fillTo = H - 1; fillTo >= 0; fillTo--) {
        const g = makeGrid(H, W);
        for (let pc = 0; pc < col; pc++) for (let r = 0; r < H; r++) g[r][pc] = true;
        for (let r = fillTo; r < H; r++) g[r][col] = true;
        frames.push(gridToBraille(g));
      }
    }
    const full = makeGrid(H, W);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) full[r][c] = true;
    frames.push(gridToBraille(full));
    frames.push(gridToBraille(makeGrid(H, W)));
    return frames;
  }
  function genOrbit() {
    const W = 2, H = 4;
    const path = [[0, 0], [0, 1], [1, 1], [2, 1], [3, 1], [3, 0], [2, 0], [1, 0]];
    const frames = [];
    for (let i = 0; i < path.length; i++) {
      const g = makeGrid(H, W);
      g[path[i][0]][path[i][1]] = true;
      const t1 = (i - 1 + path.length) % path.length;
      g[path[t1][0]][path[t1][1]] = true;
      frames.push(gridToBraille(g));
    }
    return frames;
  }
  function genBreathe() {
    const stages = [
      [], [[1, 0]], [[0, 1], [2, 0]], [[0, 0], [1, 1], [3, 0]],
      [[0, 0], [1, 1], [2, 0], [3, 1]], [[0, 0], [0, 1], [1, 1], [2, 0], [3, 1]],
      [[0, 0], [0, 1], [1, 0], [2, 1], [3, 0], [3, 1]], [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1]],
      [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]]
    ];
    const frames = [];
    const sequence = [...stages, ...stages.slice().reverse().slice(1)];
    for (const dots of sequence) {
      const g = makeGrid(4, 2);
      for (const [r, c] of dots) g[r][c] = true;
      frames.push(gridToBraille(g));
    }
    return frames;
  }
  function genWaveRows() {
    const W = 8, H = 4, totalFrames = 16, frames = [];
    for (let f = 0; f < totalFrames; f++) {
      const g = makeGrid(H, W);
      for (let c = 0; c < W; c++) {
        const phase = f - c * 0.5;
        const row = Math.round((Math.sin(phase * 0.8) + 1) / 2 * (H - 1));
        g[row][c] = true;
        if (row > 0) g[row - 1][c] = (f + c) % 3 === 0;
      }
      frames.push(gridToBraille(g));
    }
    return frames;
  }
  function genCheckerboard() {
    const W = 6, H = 4, frames = [];
    for (let phase = 0; phase < 4; phase++) {
      const g = makeGrid(H, W);
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        if (phase < 2) g[r][c] = (r + c + phase) % 2 === 0;
        else g[r][c] = (r + c + phase) % 3 === 0;
      }
      frames.push(gridToBraille(g));
    }
    return frames;
  }
  function genHelix() {
    const W = 8, H = 4, totalFrames = 16, frames = [];
    for (let f = 0; f < totalFrames; f++) {
      const g = makeGrid(H, W);
      for (let c = 0; c < W; c++) {
        const phase = (f + c) * (Math.PI / 4);
        const y1 = Math.round((Math.sin(phase) + 1) / 2 * (H - 1));
        const y2 = Math.round((Math.sin(phase + Math.PI) + 1) / 2 * (H - 1));
        g[y1][c] = true; g[y2][c] = true;
      }
      frames.push(gridToBraille(g));
    }
    return frames;
  }
  function genFillSweep() {
    const W = 4, H = 4, frames = [];
    for (let row = H - 1; row >= 0; row--) {
      const g = makeGrid(H, W);
      for (let r = row; r < H; r++) for (let c = 0; c < W; c++) g[r][c] = true;
      frames.push(gridToBraille(g));
    }
    const full = makeGrid(H, W);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) full[r][c] = true;
    frames.push(gridToBraille(full));
    frames.push(gridToBraille(full));
    for (let row = 0; row < H; row++) {
      const g = makeGrid(H, W);
      for (let r = row + 1; r < H; r++) for (let c = 0; c < W; c++) g[r][c] = true;
      frames.push(gridToBraille(g));
    }
    frames.push(gridToBraille(makeGrid(H, W)));
    return frames;
  }
  function genDiagonalSwipe() {
    const W = 4, H = 4, frames = [];
    const maxDiag = W + H - 2;
    for (let d = 0; d <= maxDiag; d++) {
      const g = makeGrid(H, W);
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (r + c <= d) g[r][c] = true;
      frames.push(gridToBraille(g));
    }
    const full = makeGrid(H, W);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) full[r][c] = true;
    frames.push(gridToBraille(full));
    for (let d = 0; d <= maxDiag; d++) {
      const g = makeGrid(H, W);
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (r + c > d) g[r][c] = true;
      frames.push(gridToBraille(g));
    }
    frames.push(gridToBraille(makeGrid(H, W)));
    return frames;
  }

  // The full 18-spinner spec — exact frames & intervals (unicode-animations@1.0.3).
  const SPINNERS = {
    braille: { frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], interval: 80 },
    braillewave: { frames: ["⠁⠂⠄⡀", "⠂⠄⡀⢀", "⠄⡀⢀⠠", "⡀⢀⠠⠐", "⢀⠠⠐⠈", "⠠⠐⠈⠁", "⠐⠈⠁⠂", "⠈⠁⠂⠄"], interval: 100 },
    dna: { frames: ["⠋⠉⠙⠚", "⠉⠙⠚⠒", "⠙⠚⠒⠂", "⠚⠒⠂⠂", "⠒⠂⠂⠒", "⠂⠂⠒⠲", "⠂⠒⠲⠴", "⠒⠲⠴⠤", "⠲⠴⠤⠄", "⠴⠤⠄⠋", "⠤⠄⠋⠉", "⠄⠋⠉⠙"], interval: 80 },
    scan: { frames: genScan(), interval: 70 },
    rain: { frames: genRain(), interval: 100 },
    scanline: { frames: genScanLine(), interval: 120 },
    pulse: { frames: genPulse(), interval: 180 },
    snake: { frames: genSnake(), interval: 80 },
    sparkle: { frames: genSparkle(), interval: 150 },
    cascade: { frames: genCascade(), interval: 60 },
    columns: { frames: genColumns(), interval: 60 },
    orbit: { frames: genOrbit(), interval: 100 },
    breathe: { frames: genBreathe(), interval: 100 },
    waverows: { frames: genWaveRows(), interval: 90 },
    checkerboard: { frames: genCheckerboard(), interval: 250 },
    helix: { frames: genHelix(), interval: 80 },
    fillsweep: { frames: genFillSweep(), interval: 100 },
    diagswipe: { frames: genDiagonalSwipe(), interval: 60 },
  };

  // Legacy single-style frame sets (kept for back-compat with older callers).
  const LEGACY = {
    dots: [".  ", ".. ", "...", " ..", "  .", "   "],
    line: ["|", "/", "-", "\\"],
    bars: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█", "▇", "▆", "▅", "▄", "▃", "▂"],
    arrow: ["▹▹▹", "▸▹▹", "▸▸▹", "▸▸▸"],
  };

  // Back-compat surface: FRAMES[name] still returns a plain frame array for any spinner.
  const FRAMES = { braille: SPINNERS.braille.frames, pulse: SPINNERS.pulse.frames };
  for (const k in SPINNERS) FRAMES[k] = SPINNERS[k].frames;
  for (const k in LEGACY) FRAMES[k] = LEGACY[k];

  const reduceMotion = () => {
    try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (_) { return false; }
  };
  // A settled, "at rest" frame for the static (reduced-motion) fallback: the densest frame.
  const dotCount = (s) => { let n = 0; for (const ch of s) { let b = ch.codePointAt(0) - 0x2800; if (b >= 0 && b < 256) while (b) { n += b & 1; b >>= 1; } } return n; };
  const restFrame = (frames) => frames.reduce((best, f) => (dotCount(f) > dotCount(best) ? f : best), frames[0]);

  function resolve(name) {
    if (SPINNERS[name]) return { frames: SPINNERS[name].frames, interval: SPINNERS[name].interval };
    if (LEGACY[name]) return { frames: LEGACY[name], interval: 80 };
    if (Array.isArray(name)) return { frames: name, interval: 80 };
    return { frames: SPINNERS.braille.frames, interval: SPINNERS.braille.interval };
  }

  // spin(el, name, speed?) — drive a spinner into el. Per-spinner interval unless `speed`
  // is given. Honours prefers-reduced-motion (Law / Holo UX): static settled frame, no timer.
  function spin(el, name, speed) {
    const { frames, interval } = resolve(name);
    if (!el) return { stop: () => {} };
    if (reduceMotion()) { el.textContent = restFrame(frames); return { stop: (final) => { if (final != null) el.textContent = final; } }; }
    let i = 0; el.textContent = frames[0];
    const id = setInterval(() => { el.textContent = frames[i = (i + 1) % frames.length]; }, speed || interval);
    return { stop: (final) => { clearInterval(id); if (final != null) el.textContent = final; } };
  }

  // loader(el, {name,label,speed}) — a labelled inline chip loader (glyph + dim label).
  // Returns { stop(final?), set(label), el }. Used by block surfaces (app-load, search).
  let loaderCSS = false;
  function loader(el, opts) {
    opts = opts || {};
    if (!loaderCSS && document.head) {
      const css = document.createElement("style"); css.id = "holo-fx-loader-css";
      css.textContent = ".hfx-load{display:inline-flex;gap:.55em;align-items:center;font:600 var(--holo-text-sm,.92rem)/1 ui-monospace,Menlo,Consolas,monospace}.hfx-load .hfx-s{color:var(--holo-accent,#7b5cff);min-width:1.2em;display:inline-block;letter-spacing:.04em}.hfx-load .hfx-t{color:var(--holo-text-dim,#8b949e);letter-spacing:.08em}";
      document.head.appendChild(css); loaderCSS = true;
    }
    el.classList.add("hfx-load");
    el.innerHTML = '<span class="hfx-s"></span><span class="hfx-t"></span>';
    const s = el.querySelector(".hfx-s"), t = el.querySelector(".hfx-t");
    if (opts.label != null) t.textContent = opts.label;
    const sp = spin(s, opts.name || "scan", opts.speed);
    return {
      el,
      set: (label) => { t.textContent = label; },
      stop: (final) => { sp.stop(final != null ? final : "◆"); el.classList.add("hfx-done"); },
    };
  }

  // ── live micro-display: braille is a 2×4 dot screen, so it plots REAL data faithfully ────────
  //   meter(v,width)         → a horizontal level / VU bar (0..1), 2× the resolution of a block bar
  //   progress(v,width)      → determinate progress as braille fill (alias of meter)
  //   graph(values,opts)     → a braille sparkline · waveform · spectrum (opts.fill = area/bars)
  //   scope(el,sample,opts)  → bind any of the above to a live sampling fn (rAF or interval)
  //   audioScope(el,audio,o) → a Web Audio analyser → live waveform · meter · spectrum
  function meter(v, width) {
    width = Math.max(1, width || 12); const cols = width * 2;
    v = Math.max(0, Math.min(1, isFinite(v) ? v : 0)); const filled = Math.round(v * cols);
    const g = makeGrid(4, cols);
    for (let c = 0; c < filled; c++) for (let r = 0; r < 4; r++) g[r][c] = true;
    return gridToBraille(g);
  }
  const progress = meter;
  function graph(values, opts) {
    opts = opts || {}; const arr = (values || []).map(Number).filter((x) => isFinite(x));
    const width = Math.max(1, opts.width || Math.ceil(arr.length / 2) || 1); const cols = width * 2;
    if (!arr.length) return gridToBraille(makeGrid(4, cols));
    const pts = []; for (let c = 0; c < cols; c++) pts.push(arr[Math.min(arr.length - 1, Math.floor(c * arr.length / cols))]);
    let lo = opts.min != null ? opts.min : Math.min.apply(null, pts), hi = opts.max != null ? opts.max : Math.max.apply(null, pts);
    if (!(hi > lo)) hi = lo + 1;
    const g = makeGrid(4, cols);
    for (let c = 0; c < cols; c++) {
      const n = Math.max(0, Math.min(1, (pts[c] - lo) / (hi - lo)));
      const row = 3 - Math.round(n * 3);                 // 0 = top row
      if (opts.fill) for (let r = row; r < 4; r++) g[r][c] = true;   // area / spectrum bars
      else g[row][c] = true;                             // line
    }
    return gridToBraille(g);
  }
  function scope(el, sample, opts) {
    opts = opts || {}; if (!el || typeof sample !== "function") return { stop: () => {} };
    const kind = opts.kind || "wave", width = opts.width || 16, span = opts.span || width * 2;
    const buf = []; let raf = 0, iv = 0, stopped = false;
    const render = () => {
      let s; try { s = sample(); } catch (e) { s = null; }
      if (kind === "meter") { el.textContent = meter(Number(s), width); return; }
      if (Array.isArray(s)) { el.textContent = graph(s, { width, fill: opts.fill, min: opts.min, max: opts.max }); return; }
      buf.push(Number(s) || 0); while (buf.length > span) buf.shift();
      el.textContent = graph(buf, { width, fill: opts.fill, min: opts.min, max: opts.max });
    };
    if (reduceMotion()) { render(); return { stop: () => {} }; }
    if (opts.fps) { const period = 1000 / opts.fps; let last = 0; const loop = (t) => { if (stopped) return; if (t - last >= period) { last = t; render(); } raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); }
    else iv = setInterval(render, opts.interval || 90);
    return { stop: () => { stopped = true; if (raf) cancelAnimationFrame(raf); if (iv) clearInterval(iv); } };
  }
  function audioScope(el, audio, opts) {
    opts = opts || {}; const kind = opts.kind || "bars", width = opts.width || 12;
    let analyser, raf = 0, stopped = false;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC || !el || !audio) return { stop: () => {} };
      const ctx = audioScope._ctx || (audioScope._ctx = new AC());
      const src = audio.__holoSrc || (audio.__holoSrc = ctx.createMediaElementSource(audio));  // one tap per element (re-creating throws)
      analyser = ctx.createAnalyser(); analyser.fftSize = kind === "wave" ? 256 : 64; analyser.smoothingTimeConstant = 0.75;
      src.connect(analyser); try { src.connect(ctx.destination); } catch (e) {}   // keep it audible
      el.__holoCtx = ctx;
    } catch (e) { return { stop: () => {} }; }
    const td = new Uint8Array(analyser.fftSize), fd = new Uint8Array(analyser.frequencyBinCount), n = width * 2;
    const tick = () => {
      if (stopped) return;
      try { if (el.__holoCtx && el.__holoCtx.state === "suspended") el.__holoCtx.resume(); } catch (e) {}
      if (kind === "meter") { analyser.getByteTimeDomainData(td); let s = 0; for (let i = 0; i < td.length; i++) { const x = (td[i] - 128) / 128; s += x * x; } el.textContent = meter(Math.min(1, Math.sqrt(s / td.length) * 3), width); }
      else if (kind === "wave") { analyser.getByteTimeDomainData(td); const a = []; for (let c = 0; c < n; c++) a.push((td[Math.floor(c * td.length / n)] - 128) / 128); el.textContent = graph(a, { width, min: -1, max: 1 }); }
      else { analyser.getByteFrequencyData(fd); const a = []; for (let c = 0; c < n; c++) a.push(fd[Math.floor(c * fd.length / n)] / 255); el.textContent = graph(a, { width, fill: true, min: 0, max: 1 }); }
      raf = requestAnimationFrame(tick);
    };
    if (reduceMotion()) { el.textContent = meter(0, width); return { stop: () => {} }; }
    raf = requestAnimationFrame(tick);
    return { stop: () => { stopped = true; if (raf) cancelAnimationFrame(raf); try { analyser.disconnect(); } catch (e) {} } };
  }

  // ── κ as streaming braille (content-addressed identity, made motion) ─────────────────────
  // A hash IS its bytes, and the braille block is exactly 8 dots = one byte (U+2800 | byte). So we
  // render any did:holo / sha256 / blake3 digest as a live braille stream DERIVED FROM THE HASH
  // ITSELF (faithful + half the width of the hex) — hover (or focus) freezes it and reveals the hash
  // underneath. ONE synchronized driver ticks every κ on the page, so it feels sharp + consistent.
  // Auto-detected, high-precision identifier shapes (order matters — most specific first):
  //   did:holo / sha256: / blake3: / did:key:z…(multibase base58btc) / 0x…40 (EVM address) /
  //   0x…64 (32-byte hash·tx·block) / bc1…(bech32 BTC) / bare 64-hex. Bare base58 (Solana) is NOT
  //   auto-detected (false-positive risk) — apps mark those via [data-holo-kappa]; bytesOf still
  //   decodes them faithfully.
  const KRE_SRC = [
    "(?:did:holo:[a-z0-9-]+:[0-9a-f]{8,})",
    "(?:did:key:z[1-9A-HJ-NP-Za-km-z]{16,})",
    "(?:\\bsha256:[0-9a-f]{8,})",
    "(?:\\bblake3:[0-9a-f]{8,})",
    "(?:\\b0x[0-9a-f]{40}\\b)",
    "(?:\\b0x[0-9a-f]{64}\\b)",
    "(?:\\b(?:bc1|tb1|bcrt1)[02-9ac-hj-np-z]{8,87}\\b)",
    "(?:\\b[0-9a-f]{64}\\b)",
  ].join("|");
  const KRE = new RegExp(KRE_SRC, "gi");          // exec/scan (stateful)
  const KRE_T = new RegExp(KRE_SRC, "i");         // test (stateless)

  // ── faithful byte decoders (zero-dep): a κ's braille is its ACTUAL bytes, whatever the encoding ──
  const bytesToBraille = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCodePoint(0x2800 + (bytes[i] & 0xff)); return s; };
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function hexBytes(h) { h = h.toLowerCase().replace(/[^0-9a-f]/g, ""); if (h.length % 2) h = h.slice(0, -1); const o = []; for (let i = 0; i < h.length; i += 2) o.push(parseInt(h.substr(i, 2), 16)); return o; }
  function utf8Bytes(s) { const o = []; for (let i = 0; i < s.length; i++) { let c = s.charCodeAt(i); if (c < 0x80) o.push(c); else if (c < 0x800) o.push(0xc0 | c >> 6, 0x80 | c & 63); else o.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63); } return o; }
  function b58Bytes(s) {                          // base58 → bytes (did:key·Solana·BTC-base58)
    const bytes = [];
    for (const ch of s) { let carry = B58.indexOf(ch); if (carry < 0) return utf8Bytes(s); for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; } while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; } }
    for (let k = 0; k < s.length && s[k] === "1"; k++) bytes.push(0);
    return bytes.reverse();
  }
  function bech32Bytes(s) {                       // bech32 → witness-program bytes (BTC bc1…)
    const C = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"; s = s.toLowerCase();
    const pos = s.lastIndexOf("1"); if (pos < 1) return utf8Bytes(s);
    const vals = []; for (const ch of s.slice(pos + 1)) { const v = C.indexOf(ch); if (v < 0) return utf8Bytes(s); vals.push(v); }
    const prog = vals.slice(1, -6);               // drop witness version + 6-char checksum
    let acc = 0, bits = 0; const out = []; for (const v of prog) { acc = (acc << 5) | v; bits += 5; while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); } }
    return out.length ? out : utf8Bytes(s);
  }
  // bytesOf(token) — decode any recognized identifier to its canonical bytes (hex/0x · multibase ·
  // base58 · bech32), else its UTF-8 bytes. The braille is then a faithful projection of those bytes.
  function bytesOf(token) {
    let t = String(token).trim();
    if (/^did:[a-z0-9]+:/i.test(t)) t = t.slice(t.lastIndexOf(":") + 1);   // did:key:zABC→zABC · did:holo:sha256:hex→hex
    if (/^0x[0-9a-f]+$/i.test(t)) t = t.slice(2);
    if (/^[0-9a-f]+$/i.test(t) && t.length % 2 === 0) return hexBytes(t);
    if (/^z[1-9A-HJ-NP-Za-km-z]+$/.test(t)) return b58Bytes(t.slice(1));    // multibase base58btc (did:key)
    if (/^(bc1|tb1|bcrt1)/i.test(t)) return bech32Bytes(t);
    if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(t)) return b58Bytes(t);             // base58 (Solana·BTC-base58)
    return utf8Bytes(t);
  }
  // NB: use the NON-global KRE_T here — String.match on the global KRE resets its lastIndex and would
  // corrupt the while(KRE.exec()) loop in kUpgradeTextNode (infinite re-scan). Subtle but fatal.
  const tokenOf = (value) => { const m = String(value).match(KRE_T); return m ? m[0] : String(value).trim(); };
  // hexToBraille kept for back-compat (homepage/witness): hex string → faithful braille.
  const hexToBraille = (hex) => bytesToBraille(hexBytes(String(hex)));
  const KSET = new Set();          // active streaming κ entries
  let kDriver = null, kCSS = false;
  const kWindow = (e) => { const B = e.braille; if (!B) return ""; const reps = Math.ceil((e.w + B.length) / B.length); return B.repeat(reps).substr(e.off % B.length, e.w); };
  function kTick() { for (const e of KSET) { if (e.paused) continue; e.off = (e.off + 1) % e.braille.length; e.node.nodeValue = kWindow(e); } }
  function kInjectCss() {
    if (kCSS || !document.head) return; kCSS = true;
    const s = document.createElement("style"); s.id = "holo-fx-kappa-css";
    s.textContent = ".holo-k{font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--holo-accent,#7b5cff);cursor:help;white-space:nowrap;letter-spacing:.02em;border-bottom:1px dotted color-mix(in srgb,var(--holo-accent,#7b5cff) 45%,transparent)}"
      + ".holo-k.holo-k-rev{color:var(--holo-text,var(--holo-ink,inherit));letter-spacing:0;border-bottom-style:solid;white-space:normal;word-break:break-all}"
      + ".holo-k-copy{display:inline-flex;align-items:center;justify-content:center;margin-left:.45em;padding:0;width:1.05em;height:1.05em;border:0;background:none;color:inherit;cursor:pointer;opacity:.55;vertical-align:-.12em;transition:opacity .12s ease,color .12s ease}"
      + ".holo-k-copy:hover{opacity:1}.holo-k-copy.copied{color:var(--holo-ok,#1a7f37);opacity:1}"
      + ".holo-k-copy svg{width:1em;height:1em;display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}";
    document.head.appendChild(s);
  }
  // crisp inline icons (currentColor, scale with em) — copy + the success check.
  const K_COPY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const K_CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  function kCopyFallback(value, done) {
    try { const ta = document.createElement("textarea"); ta.value = value; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:-9999px;opacity:0;pointer-events:none"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); done(); } catch (e) {}
  }
  function kCopy(value, btn) {
    const done = () => { btn.classList.add("copied"); btn.innerHTML = K_CHECK_SVG; btn.title = "Copied"; setTimeout(() => { btn.classList.remove("copied"); btn.innerHTML = K_COPY_SVG; btn.title = "Copy"; }, 1100); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(done, () => kCopyFallback(value, done));
      else kCopyFallback(value, done);
    } catch (e) { kCopyFallback(value, done); }
  }
  // kappa(el, value?, opts?) — upgrade el into a streaming-braille κ with hover/focus-to-reveal.
  // value defaults to data-holo-kappa or the element's own text. opts: {width, interval, reveal}.
  function kappa(el, value, opts) {
    if (!el || el.getAttribute("data-holo-k-upgraded")) return null;
    opts = opts || {};
    value = String(value != null ? value : (el.getAttribute("data-holo-kappa") || el.textContent || "")).trim();
    const token = tokenOf(value);                   // the identifier inside value (strips any label)
    const bytes = bytesOf(token);
    if (!bytes || bytes.length < 2) return null;    // nothing identifier-like → leave as-is
    const braille = bytesToBraille(bytes);
    kInjectCss();
    el.setAttribute("data-holo-k-upgraded", "1");
    el.classList.add("holo-k");
    el.title = value; el.setAttribute("aria-label", value);
    const reveal = opts.reveal != null ? opts.reveal : value;
    const w = Math.max(1, opts.width || braille.length);
    el.textContent = ""; const node = document.createTextNode(""); el.appendChild(node);
    const entry = { el, node, braille, w, off: 0, paused: false };
    const rest = () => { node.nodeValue = reduceMotion() ? braille.slice(0, w) : kWindow(entry); };
    rest();
    // Hover/focus reveals the hash + a copy button (kept INSIDE el so moving onto it doesn't fire
    // mouseleave). One click copies the full UOR-native κ; a check confirms. Effortless + seamless.
    let copyBtn = null;
    const ensureBtn = () => {
      if (copyBtn) return copyBtn;
      copyBtn = document.createElement("button");
      copyBtn.type = "button"; copyBtn.className = "holo-k-copy"; copyBtn.tabIndex = -1;
      copyBtn.title = "Copy"; copyBtn.setAttribute("aria-label", "Copy to clipboard"); copyBtn.innerHTML = K_COPY_SVG;
      copyBtn.addEventListener("mousedown", (e) => e.preventDefault());          // don't blur/clear selection
      copyBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); kCopy(value, copyBtn); });
      return copyBtn;
    };
    const show = () => { entry.paused = true; node.nodeValue = reveal; el.classList.add("holo-k-rev"); el.appendChild(ensureBtn()); };
    const hide = () => { el.classList.remove("holo-k-rev"); if (copyBtn && copyBtn.parentNode === el) el.removeChild(copyBtn); if (!reduceMotion()) entry.paused = false; rest(); };
    el.addEventListener("mouseenter", show); el.addEventListener("mouseleave", hide);
    el.addEventListener("focus", show); el.addEventListener("blur", hide);
    if (!reduceMotion()) { KSET.add(entry); if (!kDriver) kDriver = setInterval(kTick, opts.interval || 90); }
    return { el, reveal: show, resume: hide, stop: () => { KSET.delete(entry); node.nodeValue = reveal; } };
  }
  function kSkippable(node) {
    for (let p = node.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      const t = p.tagName;
      if (t === "SCRIPT" || t === "STYLE" || t === "TEXTAREA" || t === "INPUT" || p.isContentEditable) return true;
      if (p.classList && (p.classList.contains("holo-k") || p.hasAttribute("data-holo-kappa-skip"))) return true;
    }
    return false;
  }
  function kUpgradeTextNode(node) {
    const text = node.nodeValue; if (!text || text.length < 8 || !KRE_T.test(text)) return;
    KRE.lastIndex = 0; const frag = document.createDocumentFragment(); let last = 0, m, any = false;
    while ((m = KRE.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement("span"); span.className = "holo-k"; span.setAttribute("data-holo-kappa", m[0]);
      frag.appendChild(span); try { kappa(span, m[0]); } catch (e) {} any = true; last = m.index + m[0].length;
    }
    if (!any) return;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    if (node.parentNode) node.parentNode.replaceChild(frag, node);
  }
  // kappaScan(root) — upgrade [data-holo-kappa] elements + auto-detect did:holo/sha256/blake3
  // digests in text and stream them. Opt out with <html data-holo-kappa-auto="off"> (explicit
  // [data-holo-kappa] still works) or mark a subtree [data-holo-kappa-skip].
  function kappaScan(root) {
    root = root || document.body; if (!root) return;
    if (root.querySelectorAll) root.querySelectorAll("[data-holo-kappa]:not([data-holo-k-upgraded])").forEach((el) => kappa(el));
    if (document.documentElement.getAttribute("data-holo-kappa-auto") === "off") return;
    if (root.nodeType === 3) return kUpgradeTextNode(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (!kSkippable(n) && KRE_T.test(n.nodeValue || "")) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const nodes = []; let n; while ((n = tw.nextNode())) nodes.push(n);
    nodes.forEach(kUpgradeTextNode);
  }
  function bootKappa() {
    if (!document.body) { requestAnimationFrame(bootKappa); return; }
    kappaScan(document.body);
    try { spinScan(document.body); } catch (e) {}
    try {
      // childList only (NOT characterData): stream updates write node.nodeValue, invisible here.
      const obs = new MutationObserver((muts) => {
        const roots = new Set();
        for (const mu of muts) {
          if (mu.type !== "childList") continue;
          mu.addedNodes.forEach((node) => {
            if (node.nodeType === 1) { if (!node.closest || !node.closest(".holo-k")) roots.add(node); }
            else if (node.nodeType === 3 && node.parentNode && !kSkippable(node)) roots.add(node.parentNode);
          });
        }
        if (roots.size) requestAnimationFrame(() => roots.forEach((r) => { try { kappaScan(r); } catch (e) {} try { spinScan(r); } catch (e) {} }));
      });
      obs.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  function bar(pct, width) {
    width = width || 24; pct = Math.max(0, Math.min(100, pct));
    const fill = Math.round((pct / 100) * width);
    return "█".repeat(fill) + "░".repeat(width - fill);
  }

  const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789/\\<>#*+=-·";
  function scramble(el, text, dur) {
    dur = dur || 700;
    if (reduceMotion()) { el.textContent = text; return Promise.resolve(); }
    const start = performance.now();
    return new Promise((res) => {
      const tick = (t) => {
        const p = Math.min(1, (t - start) / dur);
        const lock = Math.floor(p * text.length);
        let s = text.slice(0, lock);
        for (let i = lock; i < text.length; i++) s += text[i] === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0];
        el.textContent = s;
        if (p < 1) requestAnimationFrame(tick); else { el.textContent = text; res(); }
      };
      requestAnimationFrame(tick);
    });
  }

  function type(el, text, cps) {
    cps = cps || 48;
    if (reduceMotion()) { el.textContent = text; return Promise.resolve(); }
    let i = 0;
    return new Promise((res) => {
      const id = setInterval(() => { el.textContent = text.slice(0, ++i); if (i >= text.length) { clearInterval(id); res(); } }, 1000 / cps);
    });
  }

  // ANSI-Shadow wordmark (column-aligned; renders crisp in any monospace <pre>).
  const BANNER = {
    HOLOGRAM: [
      "██╗  ██╗ ██████╗ ██╗      ██████╗  ██████╗ ██████╗  █████╗ ███╗   ███╗",
      "██║  ██║██╔═══██╗██║     ██╔═══██╗██╔════╝ ██╔══██╗██╔══██╗████╗ ████║",
      "███████║██║   ██║██║     ██║   ██║██║  ███╗██████╔╝███████║██╔████╔██║",
      "██╔══██║██║   ██║██║     ██║   ██║██║   ██║██╔══██╗██╔══██║██║╚██╔╝██║",
      "██║  ██║╚██████╔╝███████╗╚██████╔╝╚██████╔╝██║  ██║██║  ██║██║ ╚═╝ ██║",
      "╚═╝  ╚═╝ ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝",
    ].join("\n"),
    SOVEREIGN: "SOVEREIGN OS",
  };

  // ── declarative spinners — the canonical wire (Law L2) ────────────────────────────────────
  // Any surface gets a HoloFX spinner with ZERO script, just markup:
  //   <span data-holo-spin="scan"></span>                  (name from the 18-spinner vocabulary)
  //   <span data-holo-spin="dna" data-holo-spin-speed="60"></span>
  // Auto-driven at boot and on DOM mutation (same observer as κ). Honours reduced-motion via
  // spin(). For loaders that must resolve, drive them explicitly with HoloFX.spin/loader instead.
  const SPUN = new WeakSet();
  function spinScan(root) {
    root = root || document.body; if (!root) return;
    const list = [];
    if (root.nodeType === 1 && root.matches && root.matches("[data-holo-spin]")) list.push(root);
    if (root.querySelectorAll) root.querySelectorAll("[data-holo-spin]").forEach((e) => list.push(e));
    for (const el of list) {
      if (SPUN.has(el)) continue; SPUN.add(el);
      const name = el.getAttribute("data-holo-spin") || "braille";
      const speed = parseInt(el.getAttribute("data-holo-spin-speed"), 10);
      spin(el, name, Number.isFinite(speed) ? speed : undefined);
    }
  }

  // Universal loading indicator: a subtle braille spinner while the page loads,
  // faded out on window.load. Zero per-page wiring. Skipped on the dashboard
  // (it has the full boot splash) and on any page with data-holo-boot="off".
  function autoBoot() {
    if (document.getElementById("bootsplash")) return;
    if (document.documentElement.getAttribute("data-holo-boot") === "off") return;
    if (document.readyState === "complete") return;
    const css = document.createElement("style");
    css.textContent = "#holo-load{position:fixed;left:14px;bottom:14px;z-index:2147482000;display:flex;gap:8px;align-items:center;font:600 var(--holo-text-sm, 1rem)/1 ui-monospace,Menlo,Consolas,monospace;color:#7b5cff;background:#0d1117cc;border:1px solid #2b3440;border-radius:999px;padding:7px 12px;backdrop-filter:blur(6px);transition:opacity .4s}#holo-load.done{opacity:0}#holo-load .t{color:#8b949e;letter-spacing:.08em}";
    document.head.appendChild(css);
    const chip = document.createElement("div"); chip.id = "holo-load";
    chip.innerHTML = '<span class="s">⠋</span><span class="t">loading</span>';
    const attach = () => { if (document.body) document.body.appendChild(chip); else requestAnimationFrame(attach); };
    attach();
    const sp = spin(chip.querySelector(".s"), "braille", 70);
    window.addEventListener("load", () => { sp.stop("◆"); chip.classList.add("done"); setTimeout(() => chip.remove && chip.remove(), 600); }, { once: true });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", autoBoot); document.addEventListener("DOMContentLoaded", bootKappa); }
  else { autoBoot(); bootKappa(); }

  // ── native text→ASCII (FIGlet / TAAG) ───────────────────────────────────────────────────
  // The κ-addressable encoder lives in holo-ascii.mjs (vendored figlet core + 328 .flf fonts,
  // byte-identical to patorjk.com/software/taag). Lazy-imported once on first use so HoloFX
  // stays light. ascii() resolves to the art string; asciiFonts() to the full font list.
  let _asciiMod = null;
  const asciiMod = () => (_asciiMod || (_asciiMod = import(ASCII_URL)));
  function ascii(text, opts) { return asciiMod().then((m) => m.renderAscii(text, opts)); }       // → Promise<string>
  function asciiFonts() { return asciiMod().then((m) => m.listFonts()); }                          // → Promise<string[]>
  ascii.fonts = asciiFonts;
  ascii.module = asciiMod;

  window.HoloFX = { FRAMES, spinners: SPINNERS, spin, spinScan, loader, gridToBraille, makeGrid, bar, scramble, type, BANNER, ascii, asciiFonts, kappa, kappaScan, hexToBraille, meter, progress, graph, scope, audioScope };
})();
