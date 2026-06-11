#!/usr/bin/env node
// reseal-drift.mjs — bring os/etc/os-closure.json back in step with the OS image it pins. The
// content-verify Service Worker (holo-fhs-sw.js) re-derives every in-scope byte to its κ and
// REFUSES a mismatch (409, Law L5). So after any served file is edited — or after a generator
// like repin-boot-loaders.mjs rewrites boot-manifest.json — that file's pin in the closure goes
// stale and the SW refuses the (legitimately) new bytes. This recomputes, for EVERY closure key,
// the κ of the bytes the κ-route actually serves (resolved by the one shared fhsMap), and reseals
// ONLY the keys that drifted — printing old→new for each so the change is auditable. Missing files
// (apps that live in the separate Apps repo, not this lean image) are left untouched: they 404 /
// fall back, they never 409. Pass --check to report drift without writing (exit 1 if any).
//
//   node tools/reseal-drift.mjs            # reseal drifted keys
//   node tools/reseal-drift.mjs --check    # report only (CI / pre-commit)

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fhsMap } from "../os/lib/holo-fhs-map.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const CLOSURE = join(OS, "etc/os-closure.json");
const checkOnly = process.argv.includes("--check");

const entry = (buf) => {
  const dig = createHash("sha256").update(buf).digest();
  return {
    kappa: "did:holo:sha256:" + dig.toString("hex"),
    sri: "sha256-" + dig.toString("base64"),
    multibase: "u" + Buffer.concat([Buffer.from([0x12, 0x20]), dig]).toString("base64url"),
    bytes: buf.length,
  };
};

const doc = JSON.parse(readFileSync(CLOSURE, "utf8"));
const closure = doc.closure || {};
let drifted = 0, resealed = 0;
for (const [key, old] of Object.entries(closure)) {
  const phys = fhsMap(key) || key;   // null-mapped paths (e.g. splash/splash-manifest.json) serve literally
  const abs = join(OS, phys);
  if (!existsSync(abs) || !statSync(abs).isFile()) continue;     // missing → not served → never 409
  const e = entry(readFileSync(abs));
  if (e.kappa === old.kappa) continue;
  drifted++;
  console.log(`  ↻ ${key}\n      ${old.kappa.slice(0, 30)}… → ${e.kappa.slice(0, 30)}…`);
  if (!checkOnly) { closure[key] = e; resealed++; }
}
if (!checkOnly && resealed) writeFileSync(CLOSURE, JSON.stringify(doc, null, 2) + "\n");
console.log(`\n${drifted} drifted${checkOnly ? " (check only — nothing written)" : `, ${resealed} resealed`} · ${Object.keys(closure).length} κ in the closure`);
process.exit(checkOnly && drifted ? 1 : 0);
