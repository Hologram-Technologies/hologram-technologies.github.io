#!/usr/bin/env node
// repin-boot-loaders.mjs — keep Holo Boot's Secure Boot honest on OS2. boot.html re-derives a
// loader's bytes at boot and REFUSES a κ mismatch (Law L5). In OS2 the loaders are served from
// the FHS (usr/share/frame) or the original-os/ gap-fallback — NOT as siblings of /boot, so the
// upstream make-boot.mjs can't see them and the pins drift. This recomputes each loader pin
// against the bytes the κ-route ACTUALLY serves (the same resolution holo-serve-fhs uses), so the
// boot menu verifies cleanly instead of refusing. Assets (icons/configs) are left untouched.
//
//   node tools/repin-boot-loaders.mjs

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fhsOf, OS2, ORIG } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(OS2, "boot/boot/boot-manifest.json");
const sha = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");

// resolve a loader's served bytes exactly like the κ-route: OS2 (FHS mount) first, else original.
function servedBytes(loader) {
  const f = fhsOf(loader);
  if (f && existsSync(f) && statSync(f).isFile()) return { buf: readFileSync(f), src: "OS2" };
  const o = join(ORIG, loader);
  if (existsSync(o) && statSync(o).isFile()) return { buf: readFileSync(o), src: "orig" };
  return null;
}

const doc = JSON.parse(readFileSync(MANIFEST, "utf8"));
const loaders = doc.loaders || {};
let changed = 0;
for (const loader of Object.keys(loaders)) {
  const got = servedBytes(loader);
  if (!got) { console.log(`  ?  ${loader} — not served (left as-is)`); continue; }
  const pin = sha(got.buf);
  if (loaders[loader] !== pin) { console.log(`  ↻ ${loader.padEnd(16)} ${loaders[loader].slice(7, 19)}… → ${pin.slice(7, 19)}…  (${got.src})`); loaders[loader] = pin; changed++; }
  else console.log(`  ✓ ${loader.padEnd(16)} ${pin.slice(7, 19)}…  (${got.src})`);
}
doc.loaders = loaders;
writeFileSync(MANIFEST, JSON.stringify(doc, null, 2) + "\n");
console.log(`\nrepinned ${changed} loader(s) → boot-manifest.json (Secure Boot now matches the served bytes)`);
