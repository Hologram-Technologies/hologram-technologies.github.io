#!/usr/bin/env node
// holo-palette-witness.mjs — proves per-title color extraction: the dominant accent is the poster's vivid
// colour (not its muddy average), border black/white is ignored, the accent is UI-readable, deterministic.
//
// Checks:
//   1 dominantHue     — a mostly-red image yields a red-dominant accent (r ≫ g,b).
//   2 ignoresExtremes — a black image with a blue patch yields blue (black skipped).
//   3 favoursVivid    — a grey majority + a small saturated cyan minority picks cyan, not grey.
//   4 accentReadable  — the accent luminance sits in a mid band (reads on a dark page, works as text).
//   5 deterministic   — same pixels → identical palette.
//
// node holo-palette-witness.mjs   (from holo-apps/apps/player/)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dominant } from "./holo-palette.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// build an RGBA buffer from a list of [count,[r,g,b]] runs.
const buf = (runs) => { const px = []; for (const [n, [r, g, b]] of runs) for (let i = 0; i < n; i++) px.push(r, g, b, 255); return new Uint8ClampedArray(px); };
const lum = ([r, g, b]) => (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;

// 1 — mostly red (200,40,40) with a black border
{
  const p = dominant(buf([[200, [0, 0, 0]], [800, [200, 40, 40]]]));
  ok("dominantHue", p.rgb[0] > p.rgb[1] + 40 && p.rgb[0] > p.rgb[2] + 40, JSON.stringify(p.rgb));
}
// 2 — black image + a blue patch → blue (black skipped by the lum<24 guard)
{
  const p = dominant(buf([[2000, [5, 5, 5]], [200, [40, 80, 220]]]));
  ok("ignoresExtremes", p.rgb[2] > p.rgb[0] && p.rgb[2] > p.rgb[1], JSON.stringify(p.rgb));
}
// 3 — grey majority + small vivid cyan → cyan wins (saturation weighting)
{
  const p = dominant(buf([[1500, [128, 128, 128]], [200, [20, 200, 200]]]));
  ok("favoursVivid", p.rgb[1] > 120 && p.rgb[2] > 120 && p.rgb[0] < 120, JSON.stringify(p.rgb));
}
// 4 — accent readable (mid luminance)
{
  const p = dominant(buf([[1000, [120, 20, 20]]]));   // a dark red → accent lifted to mid-bright
  const L = lum(p.accentRgb);
  ok("accentReadable", L >= 0.42 && L <= 0.7, JSON.stringify({ accent: p.accent, L: +L.toFixed(2) }));
}
// 5 — deterministic
{
  const px = buf([[500, [200, 40, 40]], [300, [20, 200, 200]]]);
  const a = dominant(px), b = dominant(buf([[500, [200, 40, 40]], [300, [20, 200, 200]]]));
  ok("deterministic", a.accent === b.accent && a.hex === b.hex, JSON.stringify({ a: a.accent, b: b.accent }));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-palette — per-title accent extracted from the poster: dominant by saturation-weighted quantization (vivid minority beats muddy average), border black/white ignored, accent lifted to a UI-readable mid band, deterministic. The detail page wears the colour of the title.",
  authority: "rests on #holo-palette — Step 8 of the universal-catalog action plan (immersion finish)",
  witnessed,
  covers: witnessed ? ["dominant-hue", "ignores-extremes", "favours-vivid", "accent-readable", "deterministic"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-palette-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-palette witness — the detail page wears the colour of the title\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  per-title palette: vivid, readable, deterministic" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
