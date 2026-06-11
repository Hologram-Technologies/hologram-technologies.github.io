#!/usr/bin/env node
// gen-scanpad.mjs — the boot pill's login icon as a BIOMETRIC SCAN PAD (matching the reference): a
// sharp fingerprint over a soft glow and a faint ISOMETRIC grid that subtly reveals near the centre
// (a scanner field), with a slow scan sweep. One self-contained SVG (glow · grid · ridges · SMIL) —
// no script, themeable. On-brand: a near-white fingerprint with one restrained cool-cyan glow.
// Internal proportions are golden (φ): glow radius = φ² · core, grid-reveal radius = φ · fingerprint.
//
//   node tools/gen-scanpad.mjs            # print <svg class="scanpad"> block
//   node tools/gen-scanpad.mjs --preview  # standalone <svg> on black, for eyeballing

const VB = 100, CX = 50, CY = 53, PHI = 1.618;
const r2 = (n) => Math.round(n * 100) / 100;

function smooth(pts) {
  let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
    d += `C${r2(p1[0] + (p2[0] - p0[0]) / 6)} ${r2(p1[1] + (p2[1] - p0[1]) / 6)} ${r2(p2[0] - (p3[0] - p1[0]) / 6)} ${r2(p2[1] - (p3[1] - p1[1]) / 6)} ${r2(p2[0])} ${r2(p2[1])}`;
  }
  return d;
}

// fingerprint: 7 loop ridges opening at the base + an open spiral core
function ridges() {
  const ds = [], N = 7;
  for (let i = 0; i < N; i++) {
    const rx = 4.2 + i * 3.0, ry = 5.2 + i * 3.45, cy = CY - i * 0.5, gap = (24 + i * 2) * Math.PI / 180;
    const a0 = Math.PI / 2 + gap, a1 = Math.PI / 2 + 2 * Math.PI - gap, S = 24, pts = [];
    for (let k = 0; k <= S; k++) { const a = a0 + (a1 - a0) * k / S; pts.push([CX + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
    ds.push(smooth(pts));
  }
  ds.push("M54.6 60C49.4 57.6 48.9 49.4 53.7 46C58.5 42.6 64.1 45.2 64.3 50");   // spiral core
  return ds;
}

// a faint ISOMETRIC lattice: verticals + ±60° diagonals + sparse vertex dots (the scanner grid)
function grid() {
  const s = 12, m = Math.tan(Math.PI / 3), rowH = s * Math.sqrt(3) / 2, lines = [], dots = [];
  for (let x = -2 * s; x <= VB + 2 * s; x += s) lines.push(`M${r2(x)} -12V112`);
  for (let c = -2 * VB; c <= 2 * VB; c += s) {
    lines.push(`M-12 ${r2(-12 * m + c)}L112 ${r2(112 * m + c)}`);
    lines.push(`M-12 ${r2(12 * m + c)}L112 ${r2(-112 * m + c)}`);
  }
  for (let j = -1; j * rowH <= VB + s; j++) for (let k = -1; k * s <= VB + s; k++) {
    if ((j + k) % 2) continue;
    dots.push(`<circle cx="${r2(k * s + (j % 2 ? s / 2 : 0))}" cy="${r2(j * rowH)}" r="1.05"/>`);
  }
  return { lines, dots };
}

export function scanPadSvg() {
  const rd = ridges().map((d) => `<path d="${d}"/>`).join("");
  const gr = grid();
  const gridLines = gr.lines.map((d) => `<path d="${d}"/>`).join("");
  return `<svg class="scanpad" viewBox="0 0 ${VB} ${VB}" role="img" aria-label="Fingerprint login">
      <defs>
        <radialGradient id="sp-glow" cx="50%" cy="51%" r="54%">
          <stop offset="0" stop-color="#aeebff" stop-opacity=".72"/>
          <stop offset="40%" stop-color="#4fbdf2" stop-opacity=".30"/>
          <stop offset="100%" stop-color="#2f8fce" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="sp-fade" cx="50%" cy="51%" r="50%">
          <stop offset="0" stop-color="#fff" stop-opacity="1"/>
          <stop offset="62%" stop-color="#fff" stop-opacity=".55"/>
          <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
        </radialGradient>
        <mask id="sp-fademask"><rect width="${VB}" height="${VB}" fill="url(#sp-fade)"/></mask>
        <g id="sp-ridges" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${rd}</g>
        <mask id="sp-ridgemask"><use href="#sp-ridges"/></mask>
        <linearGradient id="sp-scan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#dff6ff" stop-opacity="0"/>
          <stop offset=".5" stop-color="#eafaff" stop-opacity="1"/>
          <stop offset="1" stop-color="#dff6ff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <!-- the cool biometric glow -->
      <rect class="sp-glow" width="${VB}" height="${VB}" fill="url(#sp-glow)"/>
      <!-- the scanner grid, subtly revealed (stronger at the centre, gone at the edges) -->
      <g class="sp-grid" mask="url(#sp-fademask)">
        <g fill="none" stroke="#9bdcf6" stroke-width=".5" opacity=".5">${gridLines}</g>
        <g fill="#bfecff" opacity=".62">${gr.dots.join("")}</g>
      </g>
      <!-- the fingerprint (near-white, sharp) -->
      <use href="#sp-ridges" class="sp-print" stroke="#e9f6ff"/>
      <!-- a soft scan band sweeping the ridges — the sovereign read -->
      <rect class="sp-sweep" x="0" y="-26" width="${VB}" height="26" fill="url(#sp-scan)" mask="url(#sp-ridgemask)">
        <animate attributeName="y" values="-26;${VB};${VB}" keyTimes="0;.6;1" dur="5.8s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0 0 1 1"/>
      </rect>
    </svg>`;
}

if (process.argv[1]?.endsWith("gen-scanpad.mjs")) {
  if (process.argv.includes("--preview")) process.stdout.write(`<svg viewBox="0 0 ${VB} ${VB}" xmlns="http://www.w3.org/2000/svg"><rect width="${VB}" height="${VB}" fill="#0a0a0c"/>${scanPadSvg().replace(/<svg[^>]*>/, "").replace("</svg>", "")}</svg>\n`);
  else process.stdout.write(scanPadSvg() + "\n");
}
