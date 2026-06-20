// holo-anchor-sw.mjs — re-seal step for G1/SEC-1: bake sha256(etc/os-closure.json) into the worker's
// CLOSURE_KAPPA so the pin set verifies against an anchor a tamperer cannot forge. Run AFTER the closure is
// (re)generated/pinned, BEFORE deploy. Idempotent. Updates the served OS worker and the Tauri-desktop mirror.
// Usage: node system/tools/holo-anchor-sw.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");   // holo-os/system
const REPO = join(ROOT, "../..");                                   // repo root (HOLOGRAM)
const sha = (b) => createHash("sha256").update(b).digest("hex");

const closurePath = join(ROOT, "os/etc/os-closure.json");
const anchor = sha(readFileSync(closurePath));
console.log("os-closure.json κ:", anchor);

// the served OS worker (source of truth) + the Tauri desktop mirror, if present
const targets = [
  join(ROOT, "os/holo-fhs-sw.js"),
  join(REPO, "holo-apps/apps/tauri/dist/holo-fhs-sw.js"),
];

let changed = 0, missingConst = [];
for (const f of targets) {
  if (!existsSync(f)) continue;
  const src = readFileSync(f, "utf8");
  if (!/const CLOSURE_KAPPA = "[0-9a-f]{0,64}"/.test(src)) { missingConst.push(f); continue; }
  const next = src.replace(/const CLOSURE_KAPPA = "[0-9a-f]{0,64}"/, `const CLOSURE_KAPPA = "${anchor}"`);
  if (next !== src) { writeFileSync(f, next); changed++; console.log("  baked →", f.replace(REPO, ".")); }
  else console.log("  already current →", f.replace(REPO, "."));
}
if (missingConst.length) {
  console.log("\nNOTE: these workers have no CLOSURE_KAPPA constant (anchor not wired there yet):");
  missingConst.forEach((f) => console.log("  · " + f.replace(REPO, ".")));
}
console.log(`\n${changed ? "ANCHOR UPDATED" : "anchor unchanged"} — ${changed} worker(s) re-baked.`);
