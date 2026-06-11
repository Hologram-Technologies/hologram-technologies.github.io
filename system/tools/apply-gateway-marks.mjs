#!/usr/bin/env node
// apply-gateway-marks.mjs — set the two marks on the boot gateway (repo-root index.html):
//   • the HERO mark (left of "HOLOGRAM OS") = the original Hologram dot-hexagon (single source of
//     truth: os/usr/share/icons/hologram-dark.svg), recoloured to currentColor (white on black).
//   • the BOOT ACTION = a standalone human FINGERPRINT scan pad (press your finger to boot — sovereign identity).
// index.html is a plain root file (not κ-pinned) → no reseal. Idempotent.
//
//   node tools/apply-gateway-marks.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scanPadSvg } from "./gen-scanpad.mjs";
import { wordmarkSvg } from "./gen-wordmark.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const INDEX = join(here, "../../index.html");
const DARK = join(here, "../os/usr/share/icons/hologram-dark.svg");

let html = readFileSync(INDEX, "utf8");

// 0 · HERO WORDMARK ← the custom vector logotype (replaces the prior text span / an earlier svg)
{
  let s = html.indexOf('<svg class="word"'), close = "</svg>";
  if (s < 0) { s = html.indexOf('<span class="word"'); close = "</span>"; }
  if (s >= 0) { const e = html.indexOf(close, s); html = html.slice(0, s) + wordmarkSvg() + html.slice(e + close.length); }
}

// 1 · HERO ← the dot-hexagon (reuse the canonical icon's circles, themeable via currentColor)
const m = readFileSync(DARK, "utf8").match(/<g fill="#FFFFFF">([\s\S]*?)<\/g>/);
if (!m) { console.error("could not read circles from hologram-dark.svg"); process.exit(1); }
const heroMark = `<svg class="mark" viewBox="-104 -104 208 208" role="img" aria-label="Hologram"><g fill="currentColor">${m[1]}</g></svg>`;
let s = html.indexOf('<svg class="mark"');
if (s < 0) { console.error('no <svg class="mark"> found'); process.exit(1); }
let e = html.indexOf("</svg>", s);
html = html.slice(0, s) + heroMark + html.slice(e + "</svg>".length);

// 2 · BOOT ACTION ← the fingerprint biometric scan pad, standalone (glow + revealed grid + scan sweep).
// Optional: the scan pad is currently removed from the gateway (hero-only). If a scanpad slot exists,
// refresh it; otherwise skip (re-adding the fingerprint = re-introduce the <svg class="scanpad"> slot).
s = html.indexOf('<svg class="scanpad"');
if (s >= 0) { e = html.indexOf("</svg>", s); html = html.slice(0, s) + scanPadSvg() + html.slice(e + "</svg>".length); }
else { console.log("· no scanpad slot (hero-only gateway) — skipping the fingerprint"); }

writeFileSync(INDEX, html);
console.log("✓ hero = Hologram dot-mark · wordmark = vector logotype · boot pill = fingerprint scan pad  →  index.html");
