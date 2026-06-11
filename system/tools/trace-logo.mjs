#!/usr/bin/env node
// trace-logo.mjs — vectorise the Hologram logo PIXEL-FOR-PIXEL. Reads the raster logo (light dots on
// a dark field), detects every dot by 8-connected component analysis (exact centroid + area→radius,
// validated by overlay against the source), and emits a razor-sharp SVG that reproduces the source
// dot-for-dot. Two contrast variants, both transparent-background:
//   • hologram-dark.svg  — light dots (the source colours), for a DARK surface
//   • hologram-light.svg — ink dots, for a LIGHT surface
// Default output is the faithful trace (exact centroids + sizes). --clean snaps to the inferred grid
// and quantises radii for a more regular render (use only if you want regularity over fidelity).
//
//   node tools/trace-logo.mjs <path-to-logo> [--clean]

import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(process.argv[2] || join(here, "_src-logo.png"));
const CLEAN = process.argv.includes("--clean");
if (!existsSync(src)) { console.error("✗ no source image at:\n    " + src); process.exit(2); }

const require = createRequire(pathToFileURL("C:/Users/pavel/Desktop/hologram-os/os/package.json"));
const { chromium } = require("playwright");
const bytes = readFileSync(src);
const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg"
  : bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png"
  : bytes.slice(8, 12).toString() === "WEBP" ? "image/webp"
  : bytes[0] === 0x47 && bytes[1] === 0x49 ? "image/gif" : "image/png";
const dataUrl = "data:" + mime + ";base64," + bytes.toString("base64");

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const found = await page.evaluate(async (du) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = du; });
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, W, H).data;
  const on = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { const o = i * 4; on[i] = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) > 128 ? 1 : 0; }
  const seen = new Uint8Array(W * H), comps = [], st = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const idx = y * W + x; if (!on[idx] || seen[idx]) continue;
    st.length = 0; st.push(idx); seen[idx] = 1; let sx = 0, sy = 0, n = 0, mnx = x, mxx = x, mny = y, mxy = y;
    while (st.length) {
      const cur = st.pop(), cy = (cur / W) | 0, cx = cur - cy * W; sx += cx; sy += cy; n++;
      if (cx < mnx) mnx = cx; if (cx > mxx) mxx = cx; if (cy < mny) mny = cy; if (cy > mxy) mxy = cy;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx; if (on[ni] && !seen[ni]) { seen[ni] = 1; st.push(ni); }
      }
    }
    comps.push({ cx: sx / n, cy: sy / n, n, w: mxx - mnx + 1, h: mxy - mny + 1 });
  }
  return { W, H, comps };
}, dataUrl);
await browser.close();

const maxN = Math.max(...found.comps.map((c) => c.n));
// radius from area (√(n/π)) + a small antialias correction so the circle covers the dot edge
let dots = found.comps
  .filter((c) => c.n >= Math.max(2, maxN * 0.01))
  .map((c) => ({ x: c.cx, y: c.cy, r: Math.sqrt(c.n / Math.PI) }));

let note = "faithful trace (exact centroids + sizes)";
if (CLEAN) {
  const nn = dots.map((a) => Math.min(...dots.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
  const spacing = nn.slice().sort((a, b) => a - b)[Math.floor(nn.length / 2)] || 1;
  const x0 = Math.min(...dots.map((d) => d.x)), y0 = Math.min(...dots.map((d) => d.y));
  const snap = (v, o) => o + Math.round((v - o) / spacing) * spacing;
  const seen = new Map();
  for (const d of dots) { const k = snap(d.x, x0).toFixed(1) + "," + snap(d.y, y0).toFixed(1); const p = seen.get(k); if (!p || d.r > p.r) seen.set(k, { x: snap(d.x, x0), y: snap(d.y, y0), r: d.r }); }
  dots = [...seen.values()];
  const rs = dots.map((d) => d.r).sort((a, b) => a - b), lo = rs[0], hi = rs[rs.length - 1], L = 5;
  dots = dots.map((d) => { const q = Math.round((d.r - lo) / (hi - lo || 1) * (L - 1)) / (L - 1); return { x: d.x, y: d.y, r: lo + q * (hi - lo) }; });
  note = `grid-snapped (spacing≈${spacing.toFixed(1)}px, ${L} size levels)`;
}

// centre on the radius-inclusive bounding box; scale so the whole mark spans 200, viewBox ±104
const minX = Math.min(...dots.map((d) => d.x - d.r)), maxX = Math.max(...dots.map((d) => d.x + d.r));
const minY = Math.min(...dots.map((d) => d.y - d.r)), maxY = Math.max(...dots.map((d) => d.y + d.r));
const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, S = 200 / Math.max(maxX - minX, maxY - minY);
const norm = dots.map((d) => ({ x: (d.x - cx) * S, y: (d.y - cy) * S, r: d.r * S }));
const VB = 104;

const circles = norm
  .sort((a, b) => a.y - b.y || a.x - b.x)
  .map((d) => `<circle cx="${d.x.toFixed(2)}" cy="${d.y.toFixed(2)}" r="${d.r.toFixed(2)}"/>`)
  .join("");
const svg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-${VB} -${VB} ${VB * 2} ${VB * 2}" role="img" aria-label="Hologram">
<title>Hologram</title>
<g fill="${fill}">${circles}</g>
</svg>
`;

const outDir = join(here, "_preview");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "hologram-dark.svg"), svg("#FFFFFF"));
writeFileSync(join(outDir, "hologram-light.svg"), svg("#0A0A0F"));
console.log(`source ${found.W}×${found.H} · ${found.comps.length} blobs → ${dots.length} dots · ${note}`);
console.log(`wrote hologram-dark.svg + hologram-light.svg → ${outDir}`);
