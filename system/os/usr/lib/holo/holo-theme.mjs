#!/usr/bin/env node
// holo-theme.mjs — the canonical Holo Theme compiler. Turns the OS's default token foundation
// (holo-theme.css, Chakra-derived per ADR-0078) into κ-ADDRESSED, self-verifying DTCG theme OBJECTS
// (ADR-0079) — so a "theme" is a content-addressed UOR object you can swap, fork, import or build.
//
// A theme is a W3C Design Tokens (DTCG) document — the SAME portable format the engine already speaks.
// We make it κ-addressed: κ = sha256 of the canonical bytes, did:holo:sha256:κ; the engine re-derives
// sha256 on load and refuses on mismatch (Law L5). Themes carry the FULL token surface — the semantic
// core (light/dark) AND, where they choose to, the color ramps and the spacing/radii/weight/elevation
// scales — so a theme can redefine everything, not just the accent (the default and Slate do).
//
//   node holo-theme.mjs        # (re)generate usr/lib/holo/themes/*.theme.json + index.json
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, "holo-theme.css"), "utf8");
const OUT = join(HERE, "themes");
mkdirSync(OUT, { recursive: true });
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// ── parse every --holo-NAME: VALUE; from the kernel (first occurrence wins) ───────────────────────
const decls = {};
for (const m of css.matchAll(/--holo-([a-z0-9-]+):\s*([^;]+);/gi)) if (!(m[1] in decls)) decls[m[1]] = m[2].trim();
const pair = (name) => {
  const ld = /^light-dark\(([^,]+),\s*([^)]+)\)$/.exec(decls[name] || "");
  if (ld) return { light: ld[1].trim(), dark: ld[2].trim() };
  return decls[name] != null ? { light: decls[name], dark: decls[name] } : null;
};

const CORE = ["bg", "surface", "surface-2", "surface-emphasized", "border", "border-subtle",
  "border-emphasized", "ink", "ink-dim", "ink-subtle", "accent", "accent-ink", "ok", "warn", "danger"];
const HUES = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "cyan", "purple", "pink"];
const STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const SCALE_PREFIX = /^(space|radius|weight|leading|tracking|shadow)-/;

const core = {}; for (const n of CORE) { const p = pair(n); if (p) core[n] = p; }
// ramps: mode-independent single values (gray-500, blue-600, white, black, *Alpha-N)
const ramps = {};
for (const h of HUES) for (const s of STEPS) if (decls[`${h}-${s}`]) ramps[`${h}-${s}`] = decls[`${h}-${s}`];
for (const n of ["white", "black"]) if (decls[n]) ramps[n] = decls[n];
for (const n in decls) if (/^(whiteAlpha|blackAlpha)-\d+$/.test(n)) ramps[n] = decls[n];
// scales: spacing / radii / weights / line-heights / tracking / elevation (flat dashed leaves)
const scales = {};
for (const n in decls) if (SCALE_PREFIX.test(n)) scales[n] = decls[n];

// ── DTCG builders ────────────────────────────────────────────────────────────────────────────────
const tok = (value, type) => ({ $value: value, $type: type });
const colorType = (n) => "color";
// build a theme. `coreMap` {name:{light,dark}}; opts.ramps / opts.scales optionally embed the full surface.
function buildTheme({ name, description, coreMap, radius, fonts, ramps: rampMap, scales: scaleMap }) {
  const light = {}, dark = {};
  for (const n in coreMap) { light[n] = tok(coreMap[n].light, "color"); dark[n] = tok(coreMap[n].dark, "color"); }
  if (rampMap) for (const n in rampMap) light[n] = tok(rampMap[n], "color");   // ramps are mode-independent → light only
  const t = {
    $schema: "https://tr.designtokens.org/format/",
    $description: description,
    $extensions: { "org.hologram.theme": { name } },
    color: { light, dark },
    radius: { sm: tok(radius.sm, "dimension"), md: tok(radius.md, "dimension"), lg: tok(radius.lg, "dimension") },
    font: { family: { sans: tok(fonts.sans, "fontFamily"), serif: tok(fonts.serif, "fontFamily"), mono: tok(fonts.mono, "fontFamily") } },
  };
  if (scaleMap) { t.scale = {}; for (const n in scaleMap) t.scale[n] = tok(scaleMap[n], SCALE_PREFIX.test(n) && /^(space|radius)/.test(n) ? "dimension" : "number"); }
  return t;
}
const bytesOf = (obj) => JSON.stringify(obj, null, 2) + "\n";   // κ is over EXACTLY these bytes

const fonts = {
  sans: '"Helvetica Neue", Helvetica, Arial, "Segoe UI", Roboto, system-ui, sans-serif',
  serif: "ui-serif, Georgia, \"Times New Roman\", serif",
  mono: "ui-monospace, \"Cascadia Code\", \"JetBrains Mono\", Menlo, Consolas, monospace",
};
const RADIUS = { default: { sm: "0.375rem", md: "0.75rem", lg: "1rem" }, soft: { sm: "0.5rem", md: "1rem", lg: "1.5rem" } };

// Tailwind "slate" ramp — a cool blue-gray, to demonstrate a theme that overrides the NEUTRAL RAMP
// (and the core neutrals derived from it), not merely the accent.
const SLATE = { "50": "#f8fafc", "100": "#f1f5f9", "200": "#e2e8f0", "300": "#cbd5e1", "400": "#94a3b8",
  "500": "#64748b", "600": "#475569", "700": "#334155", "800": "#1e293b", "900": "#0f172a", "950": "#020617" };
const slateRamps = Object.assign({}, ramps);
for (const s of STEPS) slateRamps[`gray-${s}`] = SLATE[s];
const sl = (l, d) => ({ light: l, dark: d });
const slateCore = {
  bg: sl(SLATE["50"], "#020617"), surface: sl("#ffffff", SLATE["900"]), "surface-2": sl(SLATE["100"], SLATE["800"]),
  "surface-emphasized": sl(SLATE["200"], SLATE["700"]), border: sl(SLATE["200"], SLATE["800"]),
  "border-subtle": sl(SLATE["100"], SLATE["900"]), "border-emphasized": sl(SLATE["300"], SLATE["700"]),
  ink: sl(SLATE["900"], SLATE["50"]), "ink-dim": sl(SLATE["500"], SLATE["400"]), "ink-subtle": sl(SLATE["400"], SLATE["500"]),
  accent: sl("#0284c7", "#38bdf8"), "accent-ink": sl("#ffffff", "#ffffff"),
  ok: core.ok, warn: core.warn, danger: core.danger,
};

// ── the theme set ────────────────────────────────────────────────────────────────────────────────
// • Holo (default)  — the COMPLETE reference: full core + ramps + scales (a self-contained theme).
// • accent variants — lean deltas (core + a different brand hue); ramps/scales inherit the kernel.
// • Holo Slate      — a full-surface theme that REDEFINES the neutral ramp + core (cool slate + sky).
const ACCENTS = {
  Violet:  { light: "#7c3aed", dark: "#a78bfa", desc: "Chakra neutrals with a violet accent." },
  Emerald: { light: "#059669", dark: "#34d399", desc: "Chakra neutrals with an emerald accent." },
  Rose:    { light: "#e11d48", dark: "#fb7185", desc: "Chakra neutrals with a rose accent." },
  Amber:   { light: "#d97706", dark: "#fbbf24", desc: "Chakra neutrals with a warm amber accent." },
};

const builds = [];
builds.push({ label: "Holo", name: "Holo", file: "holo.theme.json",
  theme: buildTheme({ name: "Holo", description: "The default — the complete Chakra-derived foundation: zinc neutrals, full color ramps, the spacing/radii/elevation scales, and the Holo blue accent.",
    coreMap: core, radius: RADIUS.default, fonts, ramps, scales }), accent: core.accent });
for (const [label, a] of Object.entries(ACCENTS)) {
  const themedCore = JSON.parse(JSON.stringify(core)); themedCore.accent = { light: a.light, dark: a.dark };
  builds.push({ label, name: `Holo ${label}`, file: `${label.toLowerCase()}.theme.json`,
    theme: buildTheme({ name: `Holo ${label}`, description: a.desc, coreMap: themedCore, radius: RADIUS.default, fonts }),
    accent: { light: a.light, dark: a.dark } });
}
builds.push({ label: "Slate", name: "Holo Slate", file: "slate.theme.json",
  theme: buildTheme({ name: "Holo Slate", description: "A full-surface theme: cool slate neutrals (its OWN gray ramp + core) with a sky accent — proves a theme can redefine everything, not just the accent.",
    coreMap: slateCore, radius: RADIUS.soft, fonts, ramps: slateRamps, scales }), accent: slateCore.accent });

const index = [];
for (const b of builds) {
  const bytes = bytesOf(b.theme);
  const kappa = sha256(bytes);
  writeFileSync(join(OUT, b.file), bytes);
  const surface = b.label === "Slate" ? "carries ramps + scales" : (b.label === "Holo" ? "carries ramps + scales" : "core delta");
  index.push({ name: b.name, file: b.file, did: `did:holo:sha256:${kappa}`, kappa: `sha256:${kappa}`, accent: b.accent, surface });
  console.log(`  ✓ ${b.name.padEnd(12)} κ ${kappa.slice(0, 16)}…  ${b.file}  (${surface})`);
}

writeFileSync(join(OUT, "index.json"), JSON.stringify({
  spec: "Holo Theme catalog — every theme is a κ-addressed, self-verifying W3C Design Tokens (DTCG) object. Swap by κ via HoloTheme.setThemeByKappa; the engine re-derives sha256 and refuses on mismatch (Law L5). A theme may carry the FULL token surface (semantic core + color ramps + spacing/radii/elevation scales) or be a lean delta over the shared Chakra-derived foundation (ADR-0078/0079).",
  resolve: "fetch /_shared/themes/<file>, verify sha256(bytes) === kappa, then HoloTheme.importTheme(json).",
  count: index.length, default: "Holo", themes: index,
}, null, 2) + "\n");
console.log(`\n✓ ${index.length} κ-addressed DTCG themes → usr/lib/holo/themes/  (Holo + Slate carry the full surface)`);
