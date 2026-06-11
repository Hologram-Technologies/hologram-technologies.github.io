// holo-phi.mjs — the ONE canonical golden-ratio (φ) proportion system for Hologram OS
// (ADR-028). Object sizing and positioning use a single geometric ramp of powers of φ,
// base 1rem at φ⁰, so proportion is consistent everywhere and defined in exactly one
// place. This SUPERSEDES the per-app reinventions that drifted apart — etherscan's
// `--phi`/`--s0..--s6`, browser's `--s0..--s3`, btc's `1.618fr` columns: each app keeps
// its colors, but its proportion now comes from here (Law L2 — one canonical form).
//
// φ governs PROPORTION (object size, golden splits); the 8px grid of holo-mobile.css
// still governs spacing RHYTHM. Two complementary token groups, no overlap.
//
// Isomorphic + dependency-free: imported by the witness (Node) and by the browser
// runtime/build. The values are DERIVED from φ here; holo-phi.css is their materialization
// and holo-phi-witness.mjs re-derives both (a hand-edit to either fails the gate).

export const PHI = 1.618;                       // golden ratio to 3dp — the value apps already use
export const PHI_EXACT = (1 + Math.sqrt(5)) / 2; // 1.6180339887… — the source of the ramp
export const INV_PHI = 0.618;                    // 1/φ to 3dp

const r3 = (x) => Math.round(x * 1000) / 1000;   // round to 3 decimal places
export const sizeRem = (power) => r3(Math.pow(PHI_EXACT, power));

// The proportional ramp: t-shirt names mapped to powers of φ (base `s` = φ⁰ = 1rem).
// φ⁻³…φ⁵ spans icon-to-hero; the φ⁻³…φ³ core equals the de-facto app convention exactly.
export const RAMP = [
  { name: "3xs", power: -3 }, { name: "2xs", power: -2 }, { name: "xs", power: -1 },
  { name: "s",   power:  0 }, { name: "m",   power:  1 }, { name: "l",  power:  2 },
  { name: "xl",  power:  3 }, { name: "2xl", power:  4 }, { name: "3xl", power: 5 },
].map((e) => ({ ...e, rem: sizeRem(e.power) }));

// Generate the canonical stylesheet from the ramp — one source of truth, no drift.
export function toCss() {
  const lines = RAMP.map((e) => `  --holo-size-${e.name}: ${e.rem}rem;${e.power === 0 ? "   /* φ⁰ base */" : ` /* φ${supers(e.power)} */`}`);
  return [
    ":root {",
    "  /* holo-phi — canonical golden-ratio proportion tokens (φ = 1.618). GENERATED from",
    "   * _shared/holo-phi.mjs; do not hand-edit (holo-phi-witness.mjs re-derives the values).",
    "   * Proportion only — spacing rhythm stays on holo-mobile.css's 8px grid. */",
    `  --holo-phi: ${PHI};`,
    `  --holo-phi-inv: ${INV_PHI};`,
    ...lines,
    "  /* golden grid fractions: a content:aside split of φ:1 → `grid-template-columns: 1fr var(--holo-phi-fr)` */",
    `  --holo-phi-fr: ${PHI}fr;`,
    "}",
    "",
  ].join("\n");
}

const supers = (n) => { const m = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵" };
  return String(n).split("").map((c) => m[c] ?? c).join(""); };

// Browser convenience: a runtime handle for code that wants the values without re-parsing CSS.
if (typeof globalThis !== "undefined") globalThis.HoloPhi = { PHI, INV_PHI, RAMP, sizeRem, toCss };
