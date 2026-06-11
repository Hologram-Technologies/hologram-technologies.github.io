#!/usr/bin/env node
// gen-wordmark.mjs — the HOLOGRAM OS hero wordmark drawn as a pure-vector logotype in the style of
// Caslon's Egyptian (a clean, near-monoline geometric grotesque — the first sans, 1816). A custom
// wordmark, not a font: self-contained (no licensed file), razor-sharp at any resolution, fully
// content-native. Letters are stroked centre-lines at a uniform weight; round forms are true arcs.
//
//   node tools/gen-wordmark.mjs            # print the <svg class="word"> block
//   node tools/gen-wordmark.mjs --preview  # print a standalone <svg> on black, for eyeballing

const CAP = 70, SW = 9;          // cap height · stroke weight (≈13% → grotesque monoline)
const TRACK = 15, SPACE = 38;    // letter tracking · word space

// Each glyph: stroked centre-line sub-paths in a box (x:0..w, y:0..CAP, baseline at CAP).
const G = {
  H: { w: 56, p: ["M4.5 0V70", "M51.5 0V70", "M4.5 35H51.5"] },
  O: { w: 70, p: ["M4.5 35A30.5 30.5 0 1 0 65.5 35A30.5 30.5 0 1 0 4.5 35"] },
  L: { w: 45, p: ["M4.5 0V70", "M4.5 65.5H45"] },
  G: { w: 71, p: ["M62 51A30.5 30.5 0 1 1 62 19", "M45 35H62V51"] },
  R: { w: 58, p: ["M4.5 0V70", "M4.5 4.5H30A18 18 0 0 1 30 40.5H4.5", "M24 40.5L54 70"] },
  A: { w: 66, p: ["M5 70L33 4.5L61 70", "M14.5 48H51.5"] },
  M: { w: 80, p: ["M4.5 70V0L40 50L75.5 0V70"] },
  S: { w: 53, p: ["M46 17C46 6 31 4 22 9C11 15 12 28 26 34C41 40 42 53 33 59C24 65 9 63 7 51"] },
};

const TEXT = "HOLOGRAM";

function layout() {
  let x = 0;
  const groups = [];
  for (const ch of TEXT) {
    if (ch === " ") { x += SPACE; continue; }
    const g = G[ch];
    groups.push(`<g transform="translate(${+x.toFixed(2)} 0)">${g.p.map((d) => `<path d="${d}"/>`).join("")}</g>`);
    x += g.w + TRACK;
  }
  return { groups, width: x - TRACK };
}

export function wordmarkSvg() {
  const { groups, width } = layout();
  const pad = 7, vb = `${-pad} ${-pad} ${(width + 2 * pad).toFixed(2)} ${CAP + 2 * pad}`;
  return `<svg class="word" viewBox="${vb}" role="img" aria-label="HOLOGRAM" fill="none" stroke="currentColor" stroke-width="${SW}" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="12">${groups.join("")}</svg>`;
}

if (process.argv[1]?.endsWith("gen-wordmark.mjs")) {
  if (process.argv.includes("--preview")) {
    const { groups, width } = layout(), pad = 12;
    process.stdout.write(`<svg viewBox="${-pad} ${-pad} ${width + 2 * pad} ${CAP + 2 * pad}" xmlns="http://www.w3.org/2000/svg"><rect x="${-pad}" y="${-pad}" width="${width + 2 * pad}" height="${CAP + 2 * pad}" fill="#000"/><g fill="none" stroke="#fff" stroke-width="${SW}" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="12">${groups.join("")}</g></svg>\n`);
  } else process.stdout.write(wordmarkSvg() + "\n");
}
