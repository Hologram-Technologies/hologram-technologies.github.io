#!/usr/bin/env node
// reseal.mjs — THE one canonical reseal entrypoint for the OS image. Run it after editing any served
// file; run it with --check in CI / pre-commit. "Sealed" has ONE meaning: every served byte re-derives
// to its pinned κ (Law L5) and the Service Worker's trust anchor matches the live pin set (G1/SEC-1).
//
// Until now the order lived as folklore across three tool headers (and the note even had it backwards).
// The order below is DERIVED from the actual pin-dependency graph, not folklore:
//
//   os-served.json  pins → etc/os-closure.json  AND  holo-fhs-sw.js     (whole-tree L5, ~6.7k keys)
//   os-closure.json pins → neither manifest                              (boot set, ~500 keys)
//   holo-fhs-sw.js  is in NO closure (it is the verifier, fetched by name = the bootstrap boundary)
//
// Therefore the only correct sequence is:
//   1 · reseal-drift   → os-closure.json pins == bytes. LOOP to a fixpoint: resealing boot-manifest.json
//                        drifts boot-manifest.json's OWN closure pin, so a second pass is needed.
//   2 · holo-anchor-sw → bake sha256(os-closure.json) into the SW's CLOSURE_KAPPA. Must follow (1): it
//                        anchors the FINAL closure. (Without this the SW fail-closes a legit closure.)
//   3 · seal-served    → regenerate os-served.json. Must be LAST: it pins the now-final os-closure.json
//                        AND the now-final (post-anchor) holo-fhs-sw.js. The dev watcher only runs (1),
//                        so os-served.json silently goes stale — this is the step that closes it.
//
// Then verify all three invariants. --check runs the verify ONLY (no writes) and exits 1 if anything is
// out of step — that is the CI gate that makes drift impossible to merge.
//
//   node tools/reseal.mjs            # full canonical reseal (boot closure → anchor → served tree)
//   node tools/reseal.mjs --check    # verify only; exit 1 if served bytes != pinned κ (CI / pre-commit)

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { fhsMap } from "../os/lib/holo-fhs-map.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SYSTEM = join(here, "..");
const checkOnly = process.argv.includes("--check");
// --check (read-only) MAY target a STAGED ARTIFACT via HOLO_OS_DIR — e.g. the deploy's _site/os — so CI
// verifies the bytes it ACTUALLY uploads, not just the source tree (the source gate runs pre-staging). A
// full reseal (writes via the sub-tools, which resolve their own source os/) ALWAYS targets the source.
const OS = (checkOnly && process.env.HOLO_OS_DIR) ? resolve(process.env.HOLO_OS_DIR) : join(here, "../os");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const hexOf = (d) => String(d || "").split(":").pop().toLowerCase();
const run = (script) => spawnSync(process.execPath, [join(here, script)], { cwd: SYSTEM, encoding: "utf8" });

// ── the DEFINITION of "sealed" (pure reads) — re-derive every pinned key exactly as the SW does ──
function verifyManifest(file) {
  const path = join(OS, "etc", file);
  if (!existsSync(path)) return { file, ok: false, clean: 0, mism: [], miss: [], fatal: "manifest missing" };
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const map = doc.closure || doc;
  let clean = 0; const mism = [], miss = [];
  for (const [k, v] of Object.entries(map)) {
    if (typeof k !== "string" || k.endsWith("/") || k.startsWith("@")) continue;
    const want = hexOf(typeof v === "string" ? v : (v && (v.kappa || v.did || v["@id"])));
    if (!/^[0-9a-f]{64}$/.test(want)) continue;
    const phys = fhsMap(k) || k;
    const abs = join(OS, phys);
    if (!existsSync(abs) || statSync(abs).isDirectory()) { miss.push(k); continue; }   // absent → 404/heal-by-κ, never 409
    if (sha(readFileSync(abs)) === want) clean++; else mism.push(k);
  }
  return { file, ok: mism.length === 0, clean, mism, miss };
}
function anchorCurrent() {
  const anchor = sha(readFileSync(join(OS, "etc/os-closure.json")));
  const m = readFileSync(join(OS, "holo-fhs-sw.js"), "utf8").match(/CLOSURE_KAPPA = "([0-9a-f]{0,64})"/);
  return { ok: !!m && m[1] === anchor, anchor, baked: m && m[1] };
}
function verifyAll() {
  const closure = verifyManifest("os-closure.json");
  const served = verifyManifest("os-served.json");
  const anchor = anchorCurrent();
  return { closure, served, anchor, ok: closure.ok && served.ok && anchor.ok };
}
function report(v) {
  const line = (r) => `  ${r.file}: ${r.fatal ? r.fatal : (r.ok ? "clean" : "OUT OF STEP")} — ${r.clean} ok` +
    (r.mism.length ? `, ${r.mism.length} κ-MISMATCH` : "") + (r.miss.length ? `, ${r.miss.length} absent (heal-by-κ)` : "");
  console.log(line(v.closure));
  v.closure.mism.slice(0, 10).forEach((k) => console.log("      ✗ " + k));
  console.log(line(v.served));
  v.served.mism.slice(0, 10).forEach((k) => console.log("      ✗ " + k));
  console.log("  SW anchor: " + (v.anchor.ok ? "current ✓" : "STALE ✗ — " + (v.anchor.baked || "none") + " ≠ " + v.anchor.anchor.slice(0, 12) + "…"));
}

if (checkOnly) {
  console.log("reseal --check (verify only — no writes):\n");
  const v = verifyAll();
  report(v);
  console.log(v.ok
    ? "\nSEALED ✓ — served bytes == pinned κ (boot closure + whole tree), anchor current."
    : "\nNOT SEALED ✗ — run `node tools/reseal.mjs`.");
  process.exit(v.ok ? 0 : 1);
}

// ── full canonical reseal, in dependency order ──
console.log("reseal — bringing the OS image into Law-L5 step (boot closure → SW anchor → served tree)\n");

console.log("1 · reseal-drift (boot closure, to fixpoint)");
for (let pass = 1; pass <= 6; pass++) {
  const r = run("reseal-drift.mjs");
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0 && r.stderr) process.stderr.write(r.stderr);
  const m = (r.stdout || "").match(/(\d+) drifted, (\d+) resealed/);
  if (!m || +m[2] === 0) break;                       // no more reseals → fixpoint (cascades settle in ≤2 passes)
}

console.log("\n2 · holo-anchor-sw (bake the final closure hash into the SW)");
{ const r = run("holo-anchor-sw.mjs"); if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr); }

console.log("\n3 · seal-served (regenerate the whole-tree L5 manifest, LAST)");
{ const r = run("seal-served.mjs"); if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr); }

console.log("\nverify:");
const v = verifyAll();
report(v);
console.log(v.ok
  ? "\nSEALED ✓ — served bytes == pinned κ (boot closure + whole tree), anchor current."
  : "\nSTILL OUT OF STEP ✗ — inspect the mismatches above.");
process.exit(v.ok ? 0 : 1);
