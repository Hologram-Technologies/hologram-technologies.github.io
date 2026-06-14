#!/usr/bin/env node
// holo-minimal-app-bench.mjs — MEASURE (don't assert) the "minimal app" claim for one real app:
// how small does it get when expressed as a κ-reference manifest (compose, don't bundle), and how fast
// is the ATLAS96 addressing path. Honest about what's sub-ms (addressing/resolution/rebind) vs what
// isn't (full cold-start = fetch+parse). Run: node tools/holo-minimal-app-bench.mjs [appId]
import { readFileSync, statSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS2 = join(here, "../os");
const APPS = "C:/Users/pavel/Desktop/Hologram Apps";
const APP = process.argv[2] || "files";
const { atlasCoord } = await import(pathToFileURL(join(OS2, "usr/lib/holo/holo-atlas-coord.mjs")));
const kb = (b) => (b / 1024).toFixed(1) + " KB", mb = (b) => (b / 1048576).toFixed(2) + " MB";

const lockPath = join(APPS, "apps", APP, "holospace.lock.json");
if (!existsSync(lockPath)) { console.error("no lock for app:", APP); process.exit(2); }
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const cl = lock.closure || {};
const manifestBytes = statSync(lockPath).size;

// ── SIZE: bundle vs app-unique vs shared-runtime ──
let total = 0, appUnique = 0, shared = 0, nFiles = 0;
const sharedKeys = [];
for (const [k, e] of Object.entries(cl)) {
  const b = e.bytes || 0; total += b; nFiles++;
  if (k.startsWith(`apps/${APP}/`)) appUnique += b;
  else { shared += b; sharedKeys.push(k); }
}

// ── DEDUP: how much of this app's "shared" set is reused by OTHER apps (stored once, globally) ──
const useCount = new Map();   // shared-key → how many apps reference it
for (const id of readdirSync(join(APPS, "apps"))) {
  const lp = join(APPS, "apps", id, "holospace.lock.json"); if (!existsSync(lp)) continue;
  try { for (const k of Object.keys(JSON.parse(readFileSync(lp, "utf8")).closure || {})) if (k.startsWith("_shared/")) useCount.set(k, (useCount.get(k) || 0) + 1); } catch {}
}
const sharedReusedBytes = sharedKeys.filter((k) => (useCount.get(k) || 0) > 1).reduce((s, k) => s + (cl[k].bytes || 0), 0);
const avgReuse = sharedKeys.length ? (sharedKeys.reduce((s, k) => s + (useCount.get(k) || 1), 0) / sharedKeys.length) : 0;

// ── LATENCY: the ATLAS96 addressing path (Node; the browser run mirrors this) ──
const sampleK = (Object.values(cl)[0] || {}).kappa || "did:holo:sha256:" + "a".repeat(64);
const N = 1_000_000;
let t = process.hrtime.bigint(); for (let i = 0; i < N; i++) atlasCoord(sampleK); const coordNs = Number(process.hrtime.bigint() - t) / N;
// the κ-route is a Map lookup (the O(1) "precomputed hash table"); build it + time a hit
const idx = new Map(); for (const [k, e] of Object.entries(cl)) idx.set(String(e.kappa).split(":").pop(), k);
const probe = String(Object.values(cl)[0].kappa).split(":").pop();
t = process.hrtime.bigint(); for (let i = 0; i < N; i++) idx.get(probe); const lookupNs = Number(process.hrtime.bigint() - t) / N;

console.log(`\n  MINIMAL-APP BENCH · app "${APP}"\n  ${"─".repeat(60)}`);
console.log(`  SIZE`);
console.log(`    full bundle (all closure bytes) ........ ${mb(total)}  (${nFiles} files)`);
console.log(`    app-UNIQUE bytes (apps/${APP}/*) ........ ${kb(appUnique)}   ← the only NEW bytes this app costs`);
console.log(`    shared runtime (_shared/*) ............. ${mb(shared)}   (fetched once, deduped across apps)`);
console.log(`    └ of which reused by other apps ........ ${mb(sharedReusedBytes)}  · avg ${avgReuse.toFixed(1)}× reuse`);
console.log(`    κ-reference MANIFEST (the lock) ........ ${kb(manifestBytes)}   ← the app's whole self-describing identity`);
console.log(`    shrink: identity is ${(manifestBytes / total * 100).toFixed(2)}% of the bundle · marginal cost (unique+manifest) = ${kb(appUnique + manifestBytes)} (${(((appUnique + manifestBytes) / total) * 100).toFixed(1)}% of bundle)`);
console.log(`  LATENCY (ATLAS96 addressing path)`);
console.log(`    atlasCoord(κ) — derive the coordinate .. ${coordNs.toFixed(0)} ns/op   (${(coordNs / 1e6).toFixed(6)} ms)`);
console.log(`    κ-route lookup (O(1) hash table) ....... ${lookupNs.toFixed(1)} ns/op   (${(lookupNs / 1e6).toFixed(6)} ms)`);
console.log(`    addressing total ....................... ${((coordNs + lookupNs) / 1e6).toFixed(6)} ms  ⇒ ${coordNs + lookupNs < 1e6 ? "SUB-MILLISECOND ✓" : "over 1 ms"}`);
console.log(`  ${"─".repeat(60)}`);
console.log(`  HONEST: sub-ms is the ADDRESSING + cached RESOLUTION + O(1) REBIND — not a full cold-start`);
console.log(`  (fetch+parse of the unique bytes is bounded by I/O). The win is dedup (compose, don't bundle)`);
console.log(`  + the app's identity collapses to a ${kb(manifestBytes)} κ-manifest with its atlas coordinate.\n`);
