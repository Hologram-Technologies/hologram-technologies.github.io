#!/usr/bin/env node
// holo-shrink-map.mjs — MEASURE where every holo app's bytes actually live, so shrinking is evidence-led
// not lattice-hoped. For each app it reads the lock closure and splits it into: full bundle · app-UNIQUE
// bytes (apps/<id>/*, the only NEW bytes the app costs) · shared runtime (_shared/*, fetched once, deduped
// across apps) · the κ-manifest (the lock = the app's whole self-describing identity). It ranks apps by
// app-unique bytes (the part you can actually shrink), lists each app's largest unique files (the targets),
// and flags cross-app DEDUP CANDIDATES — identical bytes (same κ) duplicated under different apps' own
// trees, which should be promoted to the one runtime and bound, not copied.
//   node tools/holo-shrink-map.mjs
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const APPS = "C:/Users/pavel/Desktop/Hologram Apps/apps";
const kb = (b) => (b / 1024).toFixed(1).padStart(8) + " KB";
const pct = (n, d) => d ? (n / d * 100).toFixed(1) + "%" : "—";

const ids = readdirSync(APPS).filter((d) => existsSync(join(APPS, d, "holospace.lock.json")));
const kappaUses = new Map();   // κ-hex → Set(app) : how many DISTINCT apps reference these exact bytes
const kappaBytes = new Map();  // κ-hex → byte length
const apps = [];

for (const id of ids) {
  let lock; try { lock = JSON.parse(readFileSync(join(APPS, id, "holospace.lock.json"), "utf8")); } catch { continue; }
  const cl = lock.closure || {};
  const manifest = statSync(join(APPS, id, "holospace.lock.json")).size;
  let total = 0, unique = 0, shared = 0;
  const uniqueFiles = [];   // [bytes, key]
  for (const [k, e] of Object.entries(cl)) {
    const b = e.bytes || 0; total += b;
    const hex = String(e.kappa || "").split(":").pop();
    if (hex) { if (!kappaUses.has(hex)) kappaUses.set(hex, new Set()); kappaUses.get(hex).add(id); kappaBytes.set(hex, b); }
    if (k.startsWith(`apps/${id}/`)) { unique += b; uniqueFiles.push([b, k, hex]); }
    else shared += b;
  }
  uniqueFiles.sort((a, b) => b[0] - a[0]);
  apps.push({ id, total, unique, shared, manifest, marginal: unique + manifest, files: Object.keys(cl).length, uniqueFiles });
}

// cross-app dedup candidates: the SAME bytes (κ) appearing under >1 app's OWN tree (apps/<id>/…) — true
// duplication that should be one runtime object the apps bind, not N copies. (_shared/* is already one.)
const ownDup = new Map();   // κ → { bytes, apps:Set, sampleKeys:[] }
for (const id of ids) {
  let lock; try { lock = JSON.parse(readFileSync(join(APPS, id, "holospace.lock.json"), "utf8")); } catch { continue; }
  for (const [k, e] of Object.entries(lock.closure || {})) {
    if (!k.startsWith(`apps/${id}/`)) continue;
    const hex = String(e.kappa || "").split(":").pop(); if (!hex) continue;
    if (!ownDup.has(hex)) ownDup.set(hex, { bytes: e.bytes || 0, apps: new Set(), keys: [] });
    const d = ownDup.get(hex); d.apps.add(id); if (d.keys.length < 3) d.keys.push(`${id}: ${k.split("/").pop()}`);
  }
}
const dupCandidates = [...ownDup.entries()].filter(([, d]) => d.apps.size > 1).sort((a, b) => (b[1].bytes * (b[1].apps.size - 1)) - (a[1].bytes * (a[1].apps.size - 1)));

// ── GLOBAL ──
const sumBundles = apps.reduce((s, a) => s + a.total, 0);                              // if every app shipped standalone
const uniqueCorpus = [...kappaBytes.entries()].reduce((s, [, b]) => s + b, 0);         // every distinct byte-set, counted ONCE (the real floor)
const sharedOnce = [...kappaUses.entries()].filter(([h]) => kappaUses.get(h).size > 1).reduce((s, [h]) => s + (kappaBytes.get(h) || 0), 0);
const reclaimable = dupCandidates.reduce((s, [, d]) => s + d.bytes * (d.apps.size - 1), 0);

console.log(`\n  HOLO SHRINK MAP · ${apps.length} apps\n  ${"─".repeat(78)}`);
console.log(`  GLOBAL`);
console.log(`    naive sum of all app bundles ............. ${kb(sumBundles)}   (every app shipped standalone)`);
console.log(`    distinct byte-sets, counted ONCE ......... ${kb(uniqueCorpus)}   ← the REAL corpus floor (dedup ceiling)`);
console.log(`    dedup factor ............................. ${(sumBundles / uniqueCorpus).toFixed(2)}×   (bundles ÷ floor)`);
console.log(`    bytes shared by >1 app (paid once) ....... ${kb(sharedOnce)}`);
console.log(`    reclaimable by de-duping app-tree copies . ${kb(reclaimable)}   ← promote to runtime + bind (the actionable shrink)`);
console.log(`\n  PER-APP  (ranked by app-UNIQUE bytes — the part you can actually shrink)`);
console.log(`  ${"─".repeat(78)}`);
console.log(`    ${"app".padEnd(12)} ${"bundle".padStart(11)} ${"app-unique".padStart(11)} ${"shared".padStart(11)} ${"manifest".padStart(10)}  unique%`);
for (const a of [...apps].sort((x, y) => y.unique - x.unique)) {
  console.log(`    ${a.id.padEnd(12)} ${kb(a.total)} ${kb(a.unique)} ${kb(a.shared)} ${kb(a.manifest)}  ${pct(a.unique, a.total)}`);
}

console.log(`\n  TOP UNIQUE-BYTE TARGETS  (the biggest app-only files — minify/split/lazy these first)`);
console.log(`  ${"─".repeat(78)}`);
const allUnique = apps.flatMap((a) => a.uniqueFiles.map(([b, k, hex]) => ({ b, k, hex, shared: (kappaUses.get(hex)?.size || 1) > 1 })));
allUnique.sort((x, y) => y.b - x.b);
for (const f of allUnique.slice(0, 20)) console.log(`    ${kb(f.b)}  ${f.k}`);

console.log(`\n  CROSS-APP DEDUP CANDIDATES  (same κ, copied under >1 app's OWN tree → promote to runtime + bind)`);
console.log(`  ${"─".repeat(78)}`);
if (!dupCandidates.length) console.log(`    (none — every app-tree object is unique; sharing already maximised)`);
for (const [hex, d] of dupCandidates.slice(0, 15)) {
  console.log(`    ${kb(d.bytes)} × ${d.apps.size} apps  (reclaim ${kb(d.bytes * (d.apps.size - 1))})  ${[...d.apps].slice(0, 6).join(", ")}`);
  console.log(`             e.g. ${d.keys.join(" · ")}`);
}
console.log("");
