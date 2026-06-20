#!/usr/bin/env node
// holospaces-witness.mjs — prove the First Light holospace templates are sound, before any browser.
//
// Checks (exit 1 on any failure — never fakes green):
//   1. Referential integrity — every member's holo:app resolves to a real app in the apps catalog,
//      and its stamped holo:appRoot equals that app's root κ (the member is κ-pinned to a real app).
//   2. Layout enum — every template's holo:layout is one the shell can tile.
//   3. Non-empty — every template has ≥1 member (a composition is at least one app).
//   4. Source ↔ served identical — gen-apps-catalog vendored the served copy byte-for-byte (the
//      divergence guard that previously broke the nav: the SW serves the vendored copy, not the source).
//
//   node tools/holospaces-witness.mjs

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APPS = process.env.HOLO_APPS_REPO || join(here, "../../../holo-apps");
const OS2 = process.env.HOLO_OS_DIR || join(here, "../os");

const SRC = join(APPS, "apps", "holospaces.jsonld");
const SERVED = join(OS2, "usr/share/holospaces/holospaces.jsonld");
const APPCAT = join(APPS, "apps", "index.jsonld");
const LAYOUTS = new Set(["split-h", "split-v", "primary-rail", "grid-2x2", "stack", "single"]);

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };

if (!existsSync(SRC)) { console.error("✗ no apps/holospaces.jsonld — run tools/gen-apps-catalog.mjs"); process.exit(1); }
if (!existsSync(SERVED)) { bad("served copy usr/share/holospaces/holospaces.jsonld is missing — run gen-apps-catalog"); }

const srcBody = readFileSync(SRC, "utf8");
const src = JSON.parse(srcBody);
const apps = (JSON.parse(readFileSync(APPCAT, "utf8"))["dcat:dataset"] || []);
const rootById = {}; for (const a of apps) if (a["schema:identifier"]) rootById[a["schema:identifier"]] = a["@id"];

const templates = src["dcat:dataset"] || [];
if (!templates.length) bad("no templates in the catalog");

for (const t of templates) {
  const name = t["schema:name"] || t["@id"];
  const members = t["holo:members"] || [];
  if (!members.length) { bad(`${name}: has no members`); continue; }
  if (LAYOUTS.has(t["holo:layout"])) ok(`${name}: layout "${t["holo:layout"]}" is tileable`);
  else bad(`${name}: layout "${t["holo:layout"]}" is not a known layout`);
  let allWired = true;
  for (const m of members) {
    const ref = m["holo:app"], root = rootById[ref];
    if (!root) { bad(`${name}: member "${ref}" is not a real app`); allWired = false; continue; }
    if (m["holo:appRoot"] !== root) { bad(`${name}: member "${ref}" κ ${m["holo:appRoot"]} ≠ app root ${root}`); allWired = false; }
  }
  if (allWired) ok(`${name}: all ${members.length} members κ-pinned to real apps`);
}

// divergence guard — served must equal source byte-for-byte
if (existsSync(SERVED)) {
  if (readFileSync(SERVED, "utf8") === srcBody) ok("served copy is byte-identical to source (no divergence)");
  else bad("served copy DIVERGED from source — re-run gen-apps-catalog");
}

// ── 5. STREAM-BY-κ readiness — every catalog app must have its lock vendored into the served image so
// the SW folds its κ pins and the app streams by content address (the broken-pane fix). For each app:
//   · a holospace.lock.json exists at usr/share/holospaces/<id>/ (what fhsMap routes apps/<id>/lock to),
//   · its root κ equals the catalog @id (no split identity between the launch entry and the pins), and
//   · the app's OWN landing page (apps/<id>/index.html) is a key in the closure (the entry byte IS pinned,
//     so it re-derives instead of 404ing). A missing/stale lock = an app that can't render from its κ.
const KRE = /^did:holo:sha256:[0-9a-f]{64}$/;
let streamReady = 0;
for (const a of apps) {
  const dir = String(a["dcat:landingPage"] || "").split("/")[1];
  const entry = String(a["dcat:landingPage"] || "");                       // apps/<id>/index.html
  const lp = join(OS2, "usr/share/holospaces", dir, "holospace.lock.json");
  if (!existsSync(lp)) { bad(`${dir}: no vendored lock — can't stream by κ (run gen-apps-catalog)`); continue; }
  let lock; try { lock = JSON.parse(readFileSync(lp, "utf8")); } catch { bad(`${dir}: vendored lock is not valid JSON`); continue; }
  if (KRE.test(a["@id"]) && lock.root !== a["@id"]) { bad(`${dir}: vendored lock root ${String(lock.root).slice(-12)} ≠ catalog κ ${a["@id"].slice(-12)}`); continue; }
  if (!(lock.closure && Object.prototype.hasOwnProperty.call(lock.closure, entry))) { bad(`${dir}: landing page ${entry} is not pinned in the lock closure`); continue; }
  streamReady++;
}
if (streamReady === apps.length && apps.length) ok(`all ${apps.length} catalog apps have a vendored lock pinning their landing page (stream-by-κ ready)`);

console.log(`\nholospaces witness: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
