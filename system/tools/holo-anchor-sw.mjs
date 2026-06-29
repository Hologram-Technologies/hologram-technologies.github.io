// holo-anchor-sw.mjs — re-seal step for G1/SEC-1: bake the CANONICAL κ of etc/os-closure.json — blake3,
// the substrate's kappo — into the worker's CLOSURE_KAPPA so the pin set verifies against an anchor a
// tamperer cannot forge. Run AFTER the closure is (re)generated/pinned, BEFORE deploy. Idempotent. Updates
// the served OS worker and the Tauri-desktop mirror. The manifest is stamped `anchorAxis: "blake3"` so the
// chosen axis is legible. Consumers (SW, Rust load_store, CEF HotStore) match blake3 first and accept the
// legacy sha256 value as a fallback, so the trust-root flip is atomic-safe — never half-flipped.
// Usage: node system/tools/holo-anchor-sw.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");   // holo-os/system
const REPO = join(ROOT, "../..");                                   // repo root (HOLOGRAM)
const { blake3hex } = await import(pathToFileURL(join(ROOT, "os/usr/lib/holo/holo-blake3.mjs")));

// HOLO_ANCHOR_DIR points the tool at a self-contained OS tree (its own etc/os-closure.json + holo-fhs-sw.js)
// — used by the P4 witness to exercise the real anchor logic on a throwaway image, leaving production alone.
const ANCHOR_DIR = process.env.HOLO_ANCHOR_DIR || join(ROOT, "os");
const closurePath = join(ANCHOR_DIR, "etc/os-closure.json");
// Stamp the canonical-anchor axis into the manifest (legibility) BEFORE hashing, so the anchor covers the
// final bytes. seal-served runs after this step, so the stamped manifest is re-pinned in os-served.
let doc; try { doc = JSON.parse(readFileSync(closurePath, "utf8")); } catch { doc = null; }
if (doc && doc.anchorAxis !== "blake3") { doc.anchorAxis = "blake3"; writeFileSync(closurePath, JSON.stringify(doc, null, 2) + "\n"); }
const anchor = blake3hex(readFileSync(closurePath));
console.log("os-closure.json canonical κ (blake3):", anchor);

// the served OS worker (source of truth) + the Tauri desktop mirror, if present
const targets = process.env.HOLO_ANCHOR_DIR ? [join(ANCHOR_DIR, "holo-fhs-sw.js")] : [
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
