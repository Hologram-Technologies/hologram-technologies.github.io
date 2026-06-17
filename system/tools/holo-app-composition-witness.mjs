#!/usr/bin/env node
// holo-app-composition-witness.mjs — measure + ratchet how much each app's UI is COMPOSED from the
// canonical Holo UI object library (apps/ui) versus hand-rolled bespoke markup. This is the convergence
// half of the shell-object framework: consistency at scale comes from every app rendering the SAME
// κ-addressed objects (shell objects + shadcn components) via window.HoloRender, themed by one --holo-*
// source — not from per-app CSS. (Pairs with holo-app-token-witness.mjs, which bans NEW hardcoded
// color/shape bypasses.)
//
// The metric per app = the number of canonical-object MOUNT SITES in its authored index.html:
//   • `HoloRender.render(` call sites  (each mounts a library κ-object into the app)
//   • distinct references to a registered library object's κ (shell objects + components)
// It is a no-regression RATCHET: an app may only gain composition, never lose it (the corpus can only
// converge). FAILS if any app drops below its committed floor. Read-only; identity reskins are free to
// stay at 0 (the adopt-vs-own model) — the ratchet just prevents backsliding and rewards migration.
//
//   node tools/holo-app-composition-witness.mjs                    # enforce against the baseline
//   node tools/holo-app-composition-witness.mjs --update-baseline  # re-seal the baseline to current
//
// Scope: each app's authored index.html in the served app repo (Hologram Apps). Override: HOLO_APPS_DIR.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APPS = process.env.HOLO_APPS_DIR || join(here, "../../../holo-apps/apps");
const UI = join(APPS, "ui");
const BASELINE = join(here, "holo-app-composition-baseline.json");
const update = process.argv.includes("--update-baseline");

// the canonical library κ's an app can compose: registered components + shell objects (hex form).
const libKappas = new Set();
const addFrom = (file, key) => { try { const j = JSON.parse(readFileSync(file, "utf8")); for (const o of (j[key] || [])) { const k = (o.holo || o.kappa || "").split(":").pop(); if (k) libKappas.add(k); } } catch {} };
addFrom(join(UI, "registry", "index.json"), "components");
addFrom(join(UI, "registry", "shell", "index.json"), "objects");
addFrom(join(UI, "registry", "bundles", "index.json"), "bundles");

const RENDER_SITE = /(?:HoloRender|HR)\.render\s*\(/g;     // a mount call site (HoloRender, commonly aliased HR) — informational
const HEX64 = /[0-9a-f]{64}/g;                            // candidate κ references in the source

const appIds = existsSync(APPS)
  ? readdirSync(APPS).filter((n) => n !== "ui" && (() => { try { return statSync(join(APPS, n, "index.html")).isFile(); } catch { return false; } })())
  : [];

const counts = {};
for (const id of appIds) {
  const src = readFileSync(join(APPS, id, "index.html"), "utf8");
  const sites = (src.match(RENDER_SITE) || []).length;
  const refs = new Set((src.match(HEX64) || []).filter((h) => libKappas.has(h)));   // distinct library objects composed
  const composed = refs.size;                                                       // the score = distinct canonical objects the app composes (robust, not alias-dependent)
  if (composed > 0) counts[id] = { renderSites: sites, libObjects: refs.size, composed };
}
const total = Object.values(counts).reduce((a, c) => a + c.composed, 0);

if (update) {
  const floors = Object.fromEntries(Object.entries(counts).map(([id, c]) => [id, c.composed]));
  writeFileSync(BASELINE, JSON.stringify({
    note: "Ratchet baseline for Holo UI COMPOSITION coverage. 'floors' is the min canonical-object mount sites (HoloRender.render call sites + distinct library-κ references) required per app's authored index.html; the witness FAILS on any DECREASE. Apps may only gain composition — the corpus converges to a consistent, library-composed UI. Identity reskins legitimately stay at 0. New apps default to their first sealed value.",
    libraryObjects: libKappas.size, total, perApp: counts, floors,
  }, null, 2) + "\n");
  console.log(`composition baseline sealed → ${BASELINE}  (${total} mount sites across ${Object.keys(counts).length} apps; ${libKappas.size} library objects known)`);
  process.exit(0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { floors: {} };
const floors = base.floors || {};
let fail = 0;
const all = new Set([...Object.keys(floors), ...Object.keys(counts)]);
for (const id of [...all].sort()) {
  const have = (counts[id] || {}).composed || 0;
  const floor = floors[id] || 0;
  if (have < floor) { console.log(`FAIL — ${id}: composed ${have} < floor ${floor} (composition regressed)`); fail++; }
}
console.log(`\n${Object.keys(counts).length} apps compose from the library · ${total} total mount sites · ${libKappas.size} library objects`);
const top = Object.entries(counts).sort((a, b) => b[1].composed - a[1].composed).slice(0, 6);
for (const [id, c] of top) console.log(`  ${id.padEnd(14)} ${c.composed}  (${c.renderSites} render sites · ${c.libObjects} objects)`);
if (fail) { console.log(`\n✗ ${fail} app(s) regressed below their composition floor`); process.exit(1); }
console.log("\nWITNESSED ✓ — every app's library-composition coverage holds at or above its floor (the corpus only converges)");
