#!/usr/bin/env node
// compute-manifest.mjs — compute the EXACT files that fill the FHS graph, with sizes, BEFORE any
// copy. Source of truth = each core app's holospace.lock.json closure (path→κ→bytes). _shared is
// unioned ONCE (deduped at /usr/lib/holo). OS-level spine (frame · SW · resolver · pkg · .well-known)
// is stat'd from the original os/. Reads only; writes a manifest + prints a per-directory table.
//
//   node tools/compute-manifest.mjs

import { readFileSync, statSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = "C:/Users/pavel/Desktop/hologram-os/os";          // the original OS image
const fmt = (b) => b >= 1048576 ? (b / 1048576).toFixed(2) + " MB" : (b / 1024).toFixed(1) + " KB";

// core holospaces (boot → /boot; the rest → /usr/share/holospaces/<id>)
const CORE = ["world", "os", "browser", "search", "notepad", "docs", "workspace", "wallet", "ipfs"];
const dest = {};                 // FHS top-level group → { files:Set, bytes }
const add = (group, path, bytes) => { (dest[group] ??= { files: new Set(), bytes: 0 }); if (!dest[group].files.has(path)) { dest[group].files.add(path); dest[group].bytes += bytes; } };

const sharedSeen = new Set();    // dedupe _shared across all app closures
const otherClosure = new Set();
let lockMissing = [];

for (const id of [...CORE, "boot"]) {
  const lockPath = join(SRC, "apps", id, "holospace.lock.json");
  if (!existsSync(lockPath)) { lockMissing.push(id); continue; }
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const closure = lock.closure || {};
  for (const [rel, meta] of Object.entries(closure)) {
    const bytes = meta.bytes || 0;
    if (rel.startsWith("_shared/")) {
      if (sharedSeen.has(rel)) continue; sharedSeen.add(rel);
      add("/usr/lib/holo", rel, bytes);
    } else if (rel.startsWith(`apps/${id}/`)) {
      add(id === "boot" ? "/boot" : "/usr/share/holospaces", rel, bytes);
    } else {
      otherClosure.add(rel); add("(other closure refs)", rel, bytes);
    }
  }
}

// OS-level spine — stat from disk (src relative to os/ → FHS group)
const walk = (rel) => { const abs = join(SRC, rel); if (!existsSync(abs)) return []; const s = statSync(abs);
  if (s.isFile()) return [[rel, s.size]];
  return readdirSync(abs).flatMap((n) => walk(join(rel, n).replace(/\\/g, "/"))); };
const SPINE = {
  "/usr/share/frame": ["holospace.html", "home.html", "find.html", "world.html"],
  "/boot": ["holo-boot-sw.js", "coi-serviceworker.min.js"],
  "/lib": ["holo-sw.js", "holo-launch.mjs", "holo-boot-sw-register.mjs", "browser-sw.js"],
  "/sbin": ["holo-resolver.mjs", "holo-sources.mjs", "holo-peers.mjs", "holo-uor.mjs", "holo-object.mjs", "holo-wire.mjs"],
  "/etc": ["manifest.webmanifest", "os-closure.json"],
  "/usr/share/icons": ["icon-192.png", "icon-512.png"],
  "/.well-known": ["./.well-known"],
  "/usr/lib/pkg": ["./pkg"],
};
let spineMissing = [];
for (const [group, items] of Object.entries(SPINE))
  for (const item of items) {
    const found = walk(item);
    if (!found.length && !item.startsWith("./")) spineMissing.push(item);
    for (const [rel, bytes] of found) add(group, rel, bytes);
  }

// excluded-but-referenced (the lean win): the VM image carried as /boot pins, not bytes
const PINS = ["os-kernel.gz", "os-rootfs.tar.gz"].map((n) => { const p = join(SRC, n); return existsSync(p) ? [n, statSync(p).size] : [n, 0]; });
const pinBytes = PINS.reduce((s, [, b]) => s + b, 0);

// ── report ──
const groups = Object.entries(dest).sort((a, b) => b[1].bytes - a[1].bytes);
let totalFiles = 0, totalBytes = 0;
for (const [, g] of groups) { totalFiles += g.files.size; totalBytes += g.bytes; }

console.log("FHS destination            files     size");
console.log("───────────────────────────────────────────");
for (const [group, g] of groups) console.log(`${group.padEnd(26)} ${String(g.files.size).padStart(5)}  ${fmt(g.bytes).padStart(9)}`);
console.log("───────────────────────────────────────────");
console.log(`${"TOTAL (shipped content)".padEnd(26)} ${String(totalFiles).padStart(5)}  ${fmt(totalBytes).padStart(9)}`);
console.log(`\nExcluded, carried as /boot κ-pins (resolved from peers/IPFS): ${fmt(pinBytes)}  (${PINS.map(([n]) => n).join(", ")})`);
if (lockMissing.length) console.log(`\n⚠ no holospace.lock.json for: ${lockMissing.join(", ")}`);
if (spineMissing.length) console.log(`⚠ spine file not found in os/: ${spineMissing.join(", ")}`);
if (otherClosure.size) console.log(`ℹ closure refs outside apps/ and _shared/ (need a home): ${[...otherClosure].slice(0, 12).join(", ")}${otherClosure.size > 12 ? " …" : ""}`);

writeFileSync(join(here, "os2-manifest.json"),
  JSON.stringify({ totalFiles, totalBytes, pinBytes, groups: groups.map(([g, x]) => ({ fhs: g, files: x.files.size, bytes: x.bytes, list: [...x.files].sort() })), pins: PINS.map(([n, b]) => ({ name: n, bytes: b })), lockMissing, spineMissing, otherClosure: [...otherClosure] }, null, 2) + "\n");
console.log(`\n✓ wrote tools/os2-manifest.json (${totalFiles} files, ${fmt(totalBytes)})`);
