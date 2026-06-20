#!/usr/bin/env node
// holo-v86-chunked.mjs — ingest a CHUNKED v86 OS (use_parts) as a κ-native, lazily-streamed app.
//
// copy.sh serves big images as a directory of fixed-size parts: <base><off>-<off+chunk><ext>
// (per-chunk zstd for .zst). This tool ACQUIRES every part once (hash only — bytes NOT stored),
// seals a small PART MANIFEST (root κ commits to every part's κ), and generates the app. At runtime
// the chunked service worker intercepts v86's part requests, re-derives each part against the
// manifest (Law L5), and streams it — so a 700 MB OS costs ~KB of pinned state (manifest-only pin).
//
//   node tools/holo-v86-chunked.mjs <os>     (built-in profiles below; default msdos622)
//
// Acquisition (the per-part fetch) is the off-substrate boundary; the substrate seals identities.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = "C:/Users/pavel/Desktop/HOLOGRAM";
const APPS = REPO + "/holo-apps/apps";
const TEMPLATE = join(here, "v86-template");
const RELOCK = join(here, "relock-app.local.mjs");
const ENGINE_SRC = APPS + "/holo-x86/vendor/v86";
const XTERM_SRC = APPS + "/holo-x86/vendor/xterm";
const SPLASH_SRC = APPS + "/holo-x86/holo-splash.js";
const ICON_SRC = APPS + "/holo-x86/icon.svg";
const HOST = "https://i.copy.sh/";
const CONC = 12;                                   // parallel part fetches

const { sha256hex } = await import(pathToFileURL(join(REPO, "holo-os/system/os/usr/lib/holo/holo-uor.mjs")));
const SHA = "did:holo:sha256:";
const MB = 1024 * 1024;

// Chunked profiles (from v86 main.js). basename ends with "/"; ext includes ".zst" if per-chunk zstd.
const CATALOG = {
  msdos622: { name: "MS-DOS 6.22", basename: "msdos622/", ext: ".img", size: 64 * MB, chunkSize: 256 * 1024, drive: "hda", view: "vga", memory: 64 * MB, vga: 8 * MB, cats: ["System", "Emulator"], kw: ["dos"], summary: "MS-DOS 6.22 on v86 — disk streamed + verified from a κ-part manifest." },
};

const copyDir = (src, dst) => { mkdirSync(dst, { recursive: true });
  for (const n of readdirSync(src)) { const s = join(src, n), d = join(dst, n);
    statSync(s).isDirectory() ? copyDir(s, d) : copyFileSync(s, d); } };
const fill = (tpl, map) => Object.entries(map).reduce((s, [k, v]) => s.split(k).join(String(v)), tpl);
const enginePin = (dir, file, name) => { const b = readFileSync(join(dir, file)); const hex = sha256hex(b);
  return { url: "./vendor/v86/" + file, name, sha256: hex, did: SHA + hex, bytes: b.length }; };

// Beyond the curated entries, resolve ANY chunked OS from the generated profiles.json.
let GEN = {};
try { GEN = JSON.parse(readFileSync(APPS + "/holo-v86/profiles.json", "utf8")); } catch {}
function resolve(k) {
  if (CATALOG[k]) return CATALOG[k];
  const p = GEN[k]; if (!p || p.format !== "chunked") return null;
  return { name: p.name, basename: p.basename, ext: p.ext, size: p.size, chunkSize: p.chunkSize,
    drive: p.drive || "hda", view: p.view || "vga", memory: p.memory || 128 * MB, vga: p.vga || 8 * MB,
    cats: ["System", "Emulator"], kw: [String(p.family || "").toLowerCase()],
    summary: `${p.name} on v86 — disk streamed + verified from a κ-part manifest.` };
}

const osKey = process.argv[2] || "msdos622";
const os = resolve(osKey);
if (!os) { console.error("unknown/non-chunked OS: " + osKey + " — see holo-v86 catalog (chunked ids only)"); process.exit(1); }

const appId = osKey, appDir = join(APPS, appId);
console.log(`\n── ${os.name} (${appId}) · chunked ─────────────────────────────`);
const count = Math.ceil(os.size / os.chunkSize);
const isZstd = os.ext.endsWith(".zst");
console.log(`  parts    ${count} × ${os.chunkSize} B  (${(os.size / MB).toFixed(0)} MB, ${isZstd ? "zstd" : "raw"})  from ${HOST}${os.basename}`);

// 1. Acquire + hash every part (bytes discarded — manifest-only pin). Reuse an existing manifest
//    (e.g. a template-only regen) so we don't re-download the whole image.
mkdirSync(join(appDir, "images"), { recursive: true });
const manifestFile = osKey + ".parts.json";
const manifestPath = join(appDir, "images", manifestFile);
let parts;
const existing = existsSync(manifestPath) ? (() => { try { return JSON.parse(readFileSync(manifestPath, "utf8")); } catch { return null; } })() : null;
if (existing && existing.count === count && existing.size === os.size && Array.isArray(existing.parts) && existing.parts.length === count) {
  parts = existing.parts;
  console.log(`  acquire  reusing manifest (${count} parts, already acquired)`);
} else {
  parts = new Array(count);
  let done = 0, bytes = 0;
  const fetchPart = async (i) => {
    const off = i * os.chunkSize;
    const url = HOST + os.basename + off + "-" + (off + os.chunkSize) + os.ext;
    const r = await fetch(url);
    if (!r.ok) throw new Error("part " + i + " HTTP " + r.status + " (" + url + ")");
    const buf = Buffer.from(await r.arrayBuffer());
    parts[i] = SHA + sha256hex(buf);
    done++; bytes += buf.length;
    if (done % 32 === 0 || done === count) process.stdout.write(`\r  acquire  ${done}/${count} parts · ${(bytes / MB).toFixed(1)} MB`);
  };
  for (let i = 0; i < count; i += CONC) await Promise.all(Array.from({ length: Math.min(CONC, count - i) }, (_, j) => fetchPart(i + j)));
  process.stdout.write("\n");
}

// 2. Manifest + root κ (closure over the sorted, deduped part-κ set — same construction as κ-blocks).
const uniqueSorted = [...new Set(parts.map((d) => d.slice(SHA.length)))].sort();
const root = SHA + sha256hex(Buffer.from(JSON.stringify(uniqueSorted), "utf-8"));
const manifest = { algo: "sha256", host: HOST, basename: os.basename, ext: os.ext, chunkSize: os.chunkSize,
  size: os.size, isZstd, drive: os.drive, count, root, parts };
writeFileSync(manifestPath, JSON.stringify(manifest));
console.log(`  manifest ${count} parts · ${uniqueSorted.length} unique · root ${root}`);

// 3. Engine + xterm + splash + icon.
const VEND = join(appDir, "vendor", "v86");
copyDir(ENGINE_SRC, VEND); copyDir(XTERM_SRC, join(appDir, "vendor", "xterm"));
copyFileSync(SPLASH_SRC, join(appDir, "holo-splash.js"));
if (existsSync(ICON_SRC)) copyFileSync(ICON_SRC, join(appDir, "icon.svg"));

// 4. kappa.json — engine/BIOS pins + image.chunked (manifest root gates the boot).
const kappa = {
  $comment: "κ-pins for a chunked v86 holo app. Engine + BIOSes content-addressed + gated; the disk is a chunked part-DAG (image.chunked) — manifest root sealed, parts streamed + re-derived per L5.",
  algo: "sha256",
  engine: { libv86: enginePin(VEND, "libv86.js", "v86 — x86 emulator (libv86.js, BSD-2-Clause)"), wasm: enginePin(VEND, "v86.wasm", "v86 JIT core (x86→wasm)"), seabios: enginePin(VEND, "seabios.bin", "SeaBIOS"), vgabios: enginePin(VEND, "vgabios.bin", "VGA BIOS") },
  image: { chunked: { $comment: "Chunked part-DAG (use_parts). 'root' = closure κ over all part κs; each part re-derived at read (L5). url is the v86 part-base; parts stream from the manifest's host.", manifest: "./images/" + manifestFile, name: os.name + " disk (chunked κ-DAG)", url: HOST + os.basename + os.ext, size: os.size, chunkSize: os.chunkSize, drive: os.drive, root } },
};
writeFileSync(join(appDir, "kappa.json"), JSON.stringify(kappa, null, 2) + "\n");

// 5. index.html (chunked-aware template) + sw.js (chunked SW).
const map = { "__APP_NAME__": os.name, "__IMAGE_FILE__": osKey, "__DRIVE__": os.drive, "__VIEW__": os.view,
  "__MEMORY__": os.memory, "__VGA_MEMORY__": os.vga, "__NINEP__": "false", "__NINEP_TAG__": " · chunked κ-stream" };
writeFileSync(join(appDir, "index.html"), fill(readFileSync(join(TEMPLATE, "index.html"), "utf8"), map));
writeFileSync(join(appDir, "sw.js"), fill(readFileSync(join(TEMPLATE, "sw-chunked.js"), "utf8"), { "__MANIFEST_FILE__": manifestFile }));

// 6. holospace.json
writeFileSync(join(appDir, "holospace.json"), JSON.stringify({
  id: "org.hologram.V86" + os.name.replace(/[^A-Za-z0-9]/g, ""), name: os.name,
  type: ["schema:SoftwareApplication", "schema:WebApplication"], summary: os.summary,
  entry: "index.html", icon: "icon.svg", applicationCategory: "UtilitiesApplication",
  description: [{ p: `${os.name} on the v86 JIT. Its disk is a chunked content-addressed part-DAG: only the small manifest is sealed; each part streams on demand and is re-derived against its κ before the guest sees it (Law L5).` }],
  categories: os.cats, keywords: ["v86", "emulator", "kappa", "chunked", ...os.kw],
  developer: { id: "org.hologram", name: "Hologram Technologies" }, license: "mixed", homepage: "https://hologram.os/apps/" + appId,
}, null, 2) + "\n");

// 7. Seal (the manifest + app shell; parts are NOT stored → manifest-only pin).
const rl = spawnSync(process.execPath, [RELOCK, appId], { stdio: "inherit" });
if (rl.status !== 0) { console.error("relock failed"); process.exit(1); }
console.log(`  ✓ boot: http://127.0.0.1:8300/apps/${appId}/index.html`);
