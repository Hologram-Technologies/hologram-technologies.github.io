#!/usr/bin/env node
// gen-fingerprint.mjs — the sovereign mark for the boot gateway: a human FINGERPRINT, drawn as
// smooth concentric ridge paths (a loop pattern that opens at the base, around a recurving spiral
// core). A fingerprint is the cleanest symbol of self-sovereign identity — unique, yours,
// unforgeable — which is exactly what Hologram OS boots into (a key bound to you / this device).
// Pure vector → razor-sharp at any resolution. A slow, soft "scan" band sweeps the ridges (the
// sovereign biometric read), done in self-contained SMIL so it needs no script.
//
//   node tools/gen-fingerprint.mjs            # print the ridge <path> list
//   node tools/gen-fingerprint.mjs --mark     # print the full <svg class="mark"> block
//   node tools/gen-fingerprint.mjs --svg      # print a standalone preview <svg> (on black)

const cx = 52;
const r2 = (n) => Math.round(n * 100) / 100;

// content bounds → a tightly-framed, centred viewBox (no clipping, even margins at any param tweak)
let BB;
const track = (x, y) => { if (!BB) BB = { x0: x, x1: x, y0: y, y1: y }; else { BB.x0 = Math.min(BB.x0, x); BB.x1 = Math.max(BB.x1, x); BB.y0 = Math.min(BB.y0, y); BB.y1 = Math.max(BB.y1, y); } };

// A smooth open path through points via Catmull–Rom → cubic Bézier (clamped ends).
function smooth(pts) {
  let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${r2(c1x)} ${r2(c1y)} ${r2(c2x)} ${r2(c2y)} ${r2(p2[0])} ${r2(p2[1])}`;
  }
  return d;
}

// One ridge: a vertically-elongated loop sampled around the ellipse, leaving a gap at the BASE so
// the ridges read as a fingerprint's downward-opening loop, not concentric circles.
function ridge(i) {
  const rx = 9.4 + i * 4.15, ry = 11.6 + i * 4.7, cy = 55 - i * 0.8;
  const gap = (22 + i * 1.8) * Math.PI / 180;
  const a0 = Math.PI / 2 + gap, a1 = Math.PI / 2 + 2 * Math.PI - gap;
  const N = 22, pts = [];
  for (let k = 0; k <= N; k++) {
    const a = a0 + (a1 - a0) * k / N;
    const sx = 1 + 0.04 * Math.sin(a);   // a touch of asymmetry → natural, non-mechanical
    const x = cx + rx * Math.cos(a) * sx, y = cy + ry * Math.sin(a);
    pts.push([x, y]); track(x, y);
  }
  return smooth(pts);
}

export function ridgePaths() {
  BB = undefined;
  const ds = [];
  for (let i = 0; i < 10; i++) ds.push(ridge(i));
  // the CORE — a single open recurving ridge spiralling inward (never a closed circle), set a hair
  // off-centre so the mark reads as a real, human print.
  ds.push("M50.4 60.2C46.7 58.7 46.1 53 49.4 50.6C52.7 48.3 56.6 50.1 56.8 53.5C56.95 56.2 54.6 57.9 52.4 56.9");
  return ds;
}

// the tightly-framed viewBox for the last ridgePaths() run (content bounds + an even margin that
// clears the rounded stroke). Computed, so it stays correct if the ridge maths is ever retuned.
export function viewBox() {
  const pad = 4.5;
  const x = r2(BB.x0 - pad), y = r2(BB.y0 - pad);
  const w = r2(BB.x1 - BB.x0 + 2 * pad), h = r2(BB.y1 - BB.y0 + 2 * pad);
  return { x, y, w, h, str: `${x} ${y} ${w} ${h}` };
}

export function markSvg() {
  const ds = ridgePaths();
  const vb = viewBox();
  const paths = ds.map((d) => `        <path d="${d}"/>`).join("\n");
  return `<svg class="mark" viewBox="${vb.str}" role="img" aria-label="Hologram — a sovereign fingerprint">
      <defs>
        <g id="fp-ridges" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
${paths}
        </g>
        <linearGradient id="fp-scan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0"/>
          <stop offset=".5" stop-color="#fff" stop-opacity=".95"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
        <mask id="fp-mask" maskUnits="userSpaceOnUse" x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}"><use href="#fp-ridges"/></mask>
      </defs>
      <!-- the fingerprint, held at a calm base brightness -->
      <use href="#fp-ridges" class="fp-base" opacity=".5"/>
      <!-- a soft band that brightens the ridges as it sweeps down then rests — the sovereign read -->
      <rect class="fp-scan" x="${vb.x}" y="${r2(vb.y - 26)}" width="${vb.w}" height="26" fill="url(#fp-scan)" mask="url(#fp-mask)">
        <animate attributeName="y" values="${r2(vb.y - 26)};${r2(vb.y + vb.h)};${r2(vb.y + vb.h)}" keyTimes="0;.62;1" dur="6s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.2 1;0 0 1 1"/>
      </rect>
    </svg>`;
}

// A COMPACT fingerprint for the boot pill's icon slot — fewer ridges + a heavier relative stroke so
// it reads cleanly at ~1.5em. currentColor, tightly framed, no scan (it breathes via CSS instead).
export function iconSvg() {
  const cx = 12, n = 5;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  const T = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  const ds = [];
  for (let i = 0; i < n; i++) {
    const rx = 2.5 + i * 2.05, ry = 3.1 + i * 2.25, cy = 11 - i * 0.18, gap = (30 + i * 4) * Math.PI / 180;
    const a0 = Math.PI / 2 + gap, a1 = Math.PI / 2 + 2 * Math.PI - gap, N = 20, pts = [];
    for (let k = 0; k <= N; k++) { const a = a0 + (a1 - a0) * k / N, x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a); pts.push([x, y]); T(x, y); }
    ds.push(smooth(pts));
  }
  ds.push(`M${cx} ${r2(10.7)}l0 0.01`);   // the core, a single dot (round cap)
  const pad = 1.5, vx = r2(x0 - pad), vy = r2(y0 - pad), vw = r2(x1 - x0 + 2 * pad), vh = r2(y1 - y0 + 2 * pad);
  return `<svg class="fpico" viewBox="${vx} ${vy} ${vw} ${vh}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ds.map((d) => `<path d="${d}"/>`).join("")}</svg>`;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("gen-fingerprint.mjs")) {
  if (process.argv.includes("--icon")) process.stdout.write(iconSvg() + "\n");
  else if (process.argv.includes("--mark")) process.stdout.write(markSvg() + "\n");
  else if (process.argv.includes("--svg")) {
    const ds = ridgePaths(), vb = viewBox();
    const paths = ds.map((d) => `    <path d="${d}"/>`).join("\n");
    process.stdout.write(`<svg viewBox="${vb.str}" xmlns="http://www.w3.org/2000/svg">\n  <rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="#000"/>\n  <g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">\n${paths}\n  </g>\n</svg>\n`);
  } else process.stdout.write(ridgePaths().map((d) => `      <path d="${d}"/>`).join("\n") + "\n");
}
