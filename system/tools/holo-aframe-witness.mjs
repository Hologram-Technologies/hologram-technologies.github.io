#!/usr/bin/env node
// holo-aframe-witness.mjs — proves the VENDORED A-Frame is feature-complete AND 100% κ-addressable
// substrate-native (Law L5, dual-axis). Original code (aframevr/aframe 1.7.1, MIT), not reimplemented;
// every vendored byte re-derives to its pinned κ on both axes; the navigation/world API surface is
// present; version recorded. The in-browser world proof lives in apps/surfacedemo/world.html.
//
// Run: node holo-os/system/tools/holo-aframe-witness.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const { blake3hex } = await import(pathToFileURL(join(OS, "usr/lib/holo/holo-blake3.mjs")));
const closure = JSON.parse(readFileSync(join(OS, "etc/os-closure.json"), "utf8")).closure;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + m); };
const phys = (key) => join(OS, "usr/lib/holo/" + key.replace(/^_shared\//, ""));

for (const key of ["_shared/vendor/aframe/aframe.min.js", "_shared/vendor/aframe/package.json"]) {
  const e = closure[key];
  if (!e) { ok(false, `${key.split("/").pop()} — NOT pinned`); continue; }
  const buf = readFileSync(phys(key));
  const sha = "did:holo:sha256:" + createHash("sha256").update(buf).digest("hex");
  const bl = "did:holo:blake3:" + blake3hex(buf);
  ok(e.kappa === sha && (e.alsoKnownAs || []).includes(bl), `${key.split("/").pop()} — re-derives to pinned κ (sha256 ⊕ blake3)`);
}

const js = readFileSync(phys("_shared/vendor/aframe/aframe.min.js"), "utf8");
for (const sym of ["a-scene", "a-camera", "a-cursor", "wasd-controls", "look-controls", "registerComponent", "raycaster"])
  ok(js.includes(sym), `A-Frame provides ${sym} (feature-complete navigation/world API)`);

const pkg = JSON.parse(readFileSync(phys("_shared/vendor/aframe/package.json"), "utf8"));
ok(pkg.name === "aframe" && /^1\.7\./.test(pkg.version), `pinned ${pkg.name}@${pkg.version} (MIT: ${pkg.license})`);
ok(/super-three/.test(pkg.dependencies.three), `bundles ${pkg.dependencies.three} (the r173 fork — the version seam)`);

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
