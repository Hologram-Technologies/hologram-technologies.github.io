#!/usr/bin/env node
// holo-9p-pack.mjs — mount the κ-SUBSTRATE into a v86 guest at /mnt.
//
// v86's 9p filesystem (fs.json v3) is ALREADY content-addressed: each regular file's inode carries
// a `sha256sum`, and v86 reads its bytes from `baseurl + sha256sum`. So our κ-route IS a drop-in 9p
// backend — set baseurl = "/.holo/sha256/" and the guest reads Hologram's real, content-addressed,
// L5-verifiable files from inside the VM. This tool builds that fs.json + the backing κ-objects.
//
//   node tools/holo-9p-pack.mjs <appId> [sourceDir]
//
// With a sourceDir, the whole tree is exposed (each file → one κ-object). With none, a small
// "welcome" tree is generated, including the booted disk's OWN κ-block manifest — so inside the
// guest you can `cat /mnt/this-disk.kblocks.json` and read the κ-DAG of the very disk you booted.
//
// After packing: `relock-app.local.mjs <appId>` (fold the fs objects into the closure) + restart the
// dev server (κ-route re-index). The app's index must have 9p on (ingest profile ninep:true).

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "C:/Users/pavel/Desktop/HOLOGRAM";
const APPS = REPO + "/holo-apps/apps";
const SHARED = REPO + "/holo-os/system/os/usr/lib/holo";
const { sha256hex } = await import(pathToFileURL(join(SHARED, "holo-uor.mjs")));

const appId = process.argv[2];
if (!appId) { console.error("usage: node tools/holo-9p-pack.mjs <appId> [sourceDir]"); process.exit(2); }
const sourceDir = process.argv[3];
const appDir = join(APPS, appId);
if (!existsSync(appDir)) { console.error("no such app: " + appDir); process.exit(1); }

const FS_DIR = join(appDir, "fs");
const STORE = join(FS_DIR, ".holo", "sha256");
mkdirSync(STORE, { recursive: true });

const MTIME = 1718000000;                 // fixed → deterministic fs.json (stable κ)
const MODE_FILE = 33188;                  // 0o100644  (S_IFREG | rw-r--r--)
const MODE_DIR = 16877;                   // 0o040755  (S_IFDIR | rwxr-xr-x)
let totalSize = 0, fileCount = 0;

// A file entry: [name, size, mtime, mode, uid, gid, sha256sum]; its bytes become a κ-object.
function fileEntry(name, bytes) {
  const hex = sha256hex(bytes);
  writeFileSync(join(STORE, hex), bytes);
  totalSize += bytes.length; fileCount++;
  return [name, bytes.length, MTIME, MODE_FILE, 0, 0, hex];
}
const dirEntry = (name, children) => [name, 0, MTIME, MODE_DIR, 0, 0, children];

// Walk a real source tree into fs.json entries.
function packDir(dir) {
  const out = [];
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    out.push(statSync(p).isDirectory() ? dirEntry(n, packDir(p)) : fileEntry(n, readFileSync(p)));
  }
  return out;
}

let fsroot;
if (sourceDir) {
  if (!existsSync(sourceDir)) { console.error("no such sourceDir: " + sourceDir); process.exit(1); }
  fsroot = packDir(sourceDir);
} else {
  // Default welcome tree — including the booted disk's own κ-block manifest.
  const manifestFile = readdirSync(join(appDir, "images")).find((f) => f.endsWith(".kblocks.json"));
  const readme =
    "You are inside a v86 guest — a real OS booted in a browser tab.\n\n" +
    "This /mnt is the Hologram κ-substrate, mounted over 9p.\n" +
    "Every file here is content-addressed: its name in the filesystem index is its\n" +
    "SHA-256 — its κ — and v86 fetched it from /.holo/sha256/<κ>, the SAME route the\n" +
    "whole OS resolves from. Tamper one byte and re-derivation refuses it (Law L5).\n\n" +
    "Try:  cat /mnt/this-disk.kblocks.json   — the κ-block DAG of the disk you booted from.\n";
  const children = [fileEntry("README.txt", Buffer.from(readme, "utf8"))];
  if (manifestFile)
    children.push(fileEntry("this-disk.kblocks.json", readFileSync(join(appDir, "images", manifestFile))));
  fsroot = [
    ...children,
    dirEntry("hologram", [fileEntry("about.txt", Buffer.from(
      "Hologram — a content-addressed operating substrate.\n" +
      "This OS, its disk, and these files are all κ-objects: identity is the bytes, not the path.\n", "utf8"))]),
  ];
}

const fsjson = { fsroot, version: 3, size: totalSize };
writeFileSync(join(FS_DIR, "fs.json"), JSON.stringify(fsjson));
console.log(`holo-9p-pack: ${appId}`);
console.log(`  ${fileCount} files · ${totalSize} bytes → κ-objects at fs/.holo/sha256/`);
console.log(`  fs.json → ${join(FS_DIR, "fs.json")}`);
console.log(`  next: relock-app.local.mjs ${appId} + restart the dev server, then boot (mount -t 9p host9p /mnt is automatic on Buildroot).`);
