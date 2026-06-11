#!/usr/bin/env node
// repin-shared-refs.mjs — re-pin every app's content-addressed _shared reference to the CURRENT
// bytes of the shared file it names. When a canonical _shared lib is edited (e.g. the Holo UI
// readability floor, ADR-0057), its κ changes; an app HTML that pins the OLD hex in
// `<… src="/.holo/sha256/<hex>.<ext>" data-holo-shared="<name>">` then mismatches the new bytes —
// the dev server self-heals (old hex → path → new bytes), but the content-verify Service Worker
// (holo-fhs-sw.js) re-derives and REFUSES the mismatch (409, Law L5) in production. This rewrites
// the hex to κ(name) for every app, driven by the `data-holo-shared` hint already in the markup.
//
// Idempotent: a ref already at the current κ is left untouched. The shared file is resolved from
// the OS2 runtime (os/usr/lib/holo); refs naming a file that isn't there (vendored / app-local)
// are skipped. Pair with `reseal-drift.mjs` (reseals os/etc/os-closure.json) and `relock-app.mjs`
// (re-seals each app's holospace.lock.json) for a complete production re-pin of an edited lib.
//
//   node tools/repin-shared-refs.mjs --check      # report what would change (no writes)
//   node tools/repin-shared-refs.mjs              # rewrite Hologram Apps app HTMLs in place

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SHARED = join(here, "../os/usr/lib/holo");                 // the OS2 runtime _shared resolves here
const APPS = process.env.HOLO_APPS_DIR || "C:/Users/pavel/Desktop/Hologram Apps/apps";  // what OS2 serves
const checkOnly = process.argv.includes("--check");

const kappaCache = new Map();
const kappaOf = (name) => {
  if (kappaCache.has(name)) return kappaCache.get(name);
  const p = join(SHARED, name);
  const k = (existsSync(p) && statSync(p).isFile()) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null;
  kappaCache.set(name, k); return k;
};

const htmls = [];
const walk = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); const s = statSync(p);
  if (s.isDirectory()) walk(p); else if (p.endsWith(".html")) htmls.push(p); } };
if (existsSync(APPS)) walk(APPS); else { console.error("apps dir not found: " + APPS); process.exit(2); }

// <… /.holo/sha256/<oldhex>[.ext]" … data-holo-shared="<name>" …>
const REF = /\/\.holo\/sha256\/([a-f0-9]{64})((?:\.\w+)?")([^>]*?\bdata-holo-shared=")([^"]+)(")/g;

let filesChanged = 0, refsChanged = 0, skipped = new Set();
const perName = {};
for (const file of htmls) {
  const src = readFileSync(file, "utf8");
  let changed = 0;
  const out = src.replace(REF, (m, oldhex, extQuote, mid, name, endq) => {
    const k = kappaOf(name);
    if (!k) { skipped.add(name); return m; }                    // vendored / app-local → leave as-is
    if (k === oldhex) return m;                                  // already current → idempotent
    changed++; perName[name] = (perName[name] || 0) + 1;
    return `/.holo/sha256/${k}${extQuote}${mid}${name}${endq}`;
  });
  if (changed) { refsChanged += changed; filesChanged++; if (!checkOnly) writeFileSync(file, out); }
}

console.log(`repin-shared-refs ${checkOnly ? "(check only)" : ""}`);
for (const [name, n] of Object.entries(perName).sort()) console.log(`  ${String(n).padStart(3)} × ${name}  → κ ${String(kappaOf(name)).slice(0, 12)}…`);
if (skipped.size) console.log(`  skipped (not in OS2 runtime): ${[...skipped].join(", ")}`);
console.log(`\n${refsChanged} ref(s) ${checkOnly ? "would be" : ""} re-pinned across ${filesChanged} app HTML(s) · scanned ${htmls.length}`);
process.exit(0);
