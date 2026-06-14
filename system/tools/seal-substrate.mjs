#!/usr/bin/env node
// seal-substrate.mjs — anchor the WHOLE OS on the unified UOR substrate. Every entry in the OS-wide
// κ-route closure (os/etc/os-closure.json) gets its substrate σ-axis κ: a did:holo:blake3 alsoKnownAs
// alias = BLAKE3 over the served bytes, byte-identical to hologram's kappa() (KAT-proven, holo-blake3-
// witness). So every OS object is DUAL-AXIS — addressed by its content on the OS serving key
// (did:holo:sha256) AND on the shared substrate (did:holo:blake3), resolvable on the network by either.
// (App locks get the same alias natively via relock-app.mjs. Run AFTER reseal-drift so both axes
// reflect the current served bytes.) Re-run after any closure regen.
//
//   node tools/seal-substrate.mjs
//   node tools/seal-substrate.mjs --check    # report coverage without writing (exit 1 if any gap)

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS2 = join(here, "../os");
const ORIG = "C:/Users/pavel/Desktop/hologram-os/os";
const APPS = "C:/Users/pavel/Desktop/Hologram Apps";
const CLOSURE = join(OS2, "etc/os-closure.json");
const checkOnly = process.argv.includes("--check");

const { fhsMap } = await import(pathToFileURL(join(OS2, "lib/holo-fhs-map.mjs")));
const { blake3hex } = await import(pathToFileURL(join(OS2, "usr/lib/holo/holo-blake3.mjs")));

// resolve a closure key (serve-rel path) to its physical bytes — OS2 (via the FHS map) first, else the
// original os/ gap-fallback (the same resolution order the κ-route server uses). null = missing.
const bytesOf = (key) => {
  if (key.startsWith("apps/")) { const a = join(APPS, key); if (existsSync(a) && statSync(a).isFile()) return readFileSync(a); }   // apps serve from live Hologram Apps (as the dev server does)
  const p = fhsMap(key);
  if (p) { const f = join(OS2, p); if (existsSync(f) && statSync(f).isFile()) return readFileSync(f); }
  const d = join(OS2, key); if (existsSync(d) && statSync(d).isFile()) return readFileSync(d);   // os-root files (holo-fhs-sw.js, lib/…) the map leaves as-is
  const m = key.match(/^_shared\/(.+)$/); if (m) { const l = join(OS2, "lib", m[1]); if (existsSync(l) && statSync(l).isFile()) return readFileSync(l); }   // a runtime lib that lives at lib/, not usr/lib/holo
  const o = join(ORIG, key); if (existsSync(o) && statSync(o).isFile()) return readFileSync(o);
  return null;
};

const doc = JSON.parse(readFileSync(CLOSURE, "utf8"));
const closure = doc.closure || {};
let stamped = 0, already = 0, missing = 0;
const gaps = [];
for (const [key, entry] of Object.entries(closure)) {
  if (typeof entry !== "object") continue;
  const buf = bytesOf(key);
  if (!buf) { missing++; gaps.push(key); continue; }
  const want = "did:holo:blake3:" + blake3hex(buf);
  const aka = Array.isArray(entry.alsoKnownAs) ? entry.alsoKnownAs.filter((k) => !/^did:holo:blake3:/.test(k)) : [];
  const had = (entry.alsoKnownAs || []).includes(want);
  if (had) { already++; continue; }
  if (!checkOnly) entry.alsoKnownAs = [...aka, want];
  stamped++;
}
if (!checkOnly) writeFileSync(CLOSURE, JSON.stringify(doc, null, 2) + "\n");

console.log(`${checkOnly ? "check" : "sealed"} the OS on the unified UOR substrate (σ-axis did:holo:blake3)`);
console.log(`  ${already} already-anchored · ${stamped} ${checkOnly ? "would stamp" : "stamped"} · ${missing} unresolved (gap-fallback miss)`);
if (gaps.length) console.log(`  unresolved keys: ${gaps.slice(0, 8).join(", ")}${gaps.length > 8 ? ` … (+${gaps.length - 8})` : ""}`);
console.log(`  ${Object.keys(closure).length} κ in the closure`);
process.exit(checkOnly && missing > 0 ? 1 : 0);
