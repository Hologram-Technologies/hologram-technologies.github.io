#!/usr/bin/env node
// holo-v86-ingest.mjs — turn ANY v86 OS into a sealed, κ-addressed, lazily-streaming holo app.
//
// One command:  node tools/holo-v86-ingest.mjs <os> [<os> ...]   |   --list   |   --all
//
// What it does, per OS:
//   1. ACQUIRE the disk image (local reuse, else fetch from the open-image host). Acquisition is
//      the only off-substrate, out-of-band step — the ToS/legal boundary, the user's call. The
//      substrate is source-agnostic; once bytes are in hand it doesn't know or care where from.
//   2. ENCODE the image as a κ-block DAG (tools/holo-disk-encode.mjs): each block a content-
//      addressed object, the disk re-derivable from the block set alone (Law L2·L5).
//   3. GENERATE the app from tools/v86-template (index.html + sw.js, drive/BIOS/memory/9p filled in)
//      + kappa.json (engine+BIOS+disk-root pins) + holospace.json. v86 engine + BIOS + xterm copied.
//   4. SEAL it into the substrate (relock-app.local.mjs): every byte — engine, BIOS, and all disk
//      blocks — folded into the app closure, resolving at the OS-wide /.holo/sha256 route.
//
// Result: a real OS that boots from the κ-substrate, disk streamed lazily by κ-block, every byte
// re-derived before the guest sees it. Open over http://localhost (a service worker is required).

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = "C:/Users/pavel/Desktop/HOLOGRAM";
const APPS = REPO + "/holo-apps/apps";
const TEMPLATE = join(here, "v86-template");
const ENCODER = join(here, "holo-disk-encode.mjs");
const RELOCK = join(here, "relock-app.local.mjs");
const ENGINE_SRC = APPS + "/holo-x86/vendor/v86";    // libv86.js · v86.wasm · seabios.bin · vgabios.bin
const XTERM_SRC = APPS + "/holo-x86/vendor/xterm";
const SPLASH_SRC = APPS + "/holo-x86/holo-splash.js";
const ICON_SRC = APPS + "/holo-x86/icon.svg";
const IMG_HOST = "https://copy.sh/v86/images/";

const SHARED = REPO + "/holo-os/system/os/usr/lib/holo";
const { sha256hex } = await import(pathToFileURL(join(SHARED, "holo-uor.mjs")));
const SHA = "did:holo:sha256:";

const MB = 1024 * 1024;
// The open-image catalog. drive ∈ {cdrom, fda, hda}. ninep mounts the κ-substrate into the guest
// (Linux guests with 9p only). image = filename at IMG_HOST, or `local` = an absolute path to reuse.
const CATALOG = {
  freedos:   { name: "FreeDOS",          image: "freedos722.img", drive: "fda",   view: "vga",    memory: 32 * MB,  vga: 8 * MB,  ninep: false, license: "GPL-2.0", cats: ["System", "Emulator"], kw: ["dos", "freedos"], summary: "FreeDOS on v86 — disk = a content-addressed κ-DAG." },
  kolibri:   { name: "KolibriOS",        image: "kolibri.img",    drive: "fda",   view: "vga",    memory: 128 * MB, vga: 16 * MB, ninep: false, vgabios: "bochs-vgabios.bin", license: "GPL-2.0", cats: ["System", "Emulator"], kw: ["kolibri", "graphical"], summary: "KolibriOS graphical desktop on v86 — disk = a content-addressed κ-DAG." },
  buildroot: { name: "Buildroot Linux",  image: "linux4.iso",     drive: "cdrom", view: "serial", memory: 128 * MB, vga: 8 * MB,  ninep: true,  license: "GPL-2.0", cats: ["System", "Emulator"], kw: ["linux", "buildroot"], summary: "Real x86 Buildroot Linux on v86 — disk = a κ-DAG, /mnt = the κ-substrate.", local: APPS + "/holo-x86/images/linux4.iso" },
};

// Beyond the curated entries above, resolve ANY single-file OS from the generated profiles.json
// (holo-v86-catalog.mjs). So `holo-v86-ingest.mjs <anyId>` works for the whole single-file catalog.
let GEN = {};
try { GEN = JSON.parse(readFileSync(APPS + "/holo-v86/profiles.json", "utf8")); } catch {}
function resolve(osKey) {
  if (CATALOG[osKey]) return CATALOG[osKey];
  const p = GEN[osKey]; if (!p) return null;
  if (p.format !== "single") { console.error(`'${osKey}' is format '${p.format}' — use ` + (p.format === "chunked" ? `tools/holo-v86-chunked.mjs ${osKey}` : "the matching adapter (bzimage/9pfs pending).")); return "WRONGFMT"; }
  return { name: p.name, image: (p.url.split("/").pop()) || (osKey + ".img"), srcUrl: p.host + p.url,
    drive: p.drive || "hda", view: p.view || "vga", memory: p.memory || 128 * MB, vga: p.vga || 8 * MB,
    ninep: false, license: p.license || "open", cats: ["System", "Emulator"], kw: [String(p.family || "").toLowerCase()],
    summary: `${p.name} on v86 — disk = a content-addressed κ-DAG.` };
}

const args = process.argv.slice(2);
if (!args.length || args[0] === "--list") {
  console.log("holo-v86-ingest — open-image catalog:");
  for (const [k, v] of Object.entries(CATALOG))
    console.log(`  ${k.padEnd(12)} ${v.name.padEnd(18)} ${v.drive.padEnd(6)} ${v.ninep ? "9p" : "  "}  ${v.summary}`);
  console.log("\n  node tools/holo-v86-ingest.mjs <os> [<os> ...]   |   --all");
  process.exit(0);
}
const targets = args[0] === "--all" ? Object.keys(CATALOG)
  : args[0] === "--all-single" ? Object.keys(GEN).filter((k) => GEN[k].format === "single" && GEN[k].license === "open")
  : args;

const copyDir = (src, dst) => { mkdirSync(dst, { recursive: true });
  for (const n of readdirSync(src)) { const s = join(src, n), d = join(dst, n);
    statSync(s).isDirectory() ? copyDir(s, d) : copyFileSync(s, d); } };
const fill = (tpl, map) => Object.entries(map).reduce((s, [k, v]) => s.split(k).join(String(v)), tpl);
const enginePin = (dir, file, name) => { const bytes = readFileSync(join(dir, file)); const hex = sha256hex(bytes);
  return { url: "./vendor/v86/" + file, name, sha256: hex, did: SHA + hex, bytes: bytes.length }; };

async function ingest(osKey) {
  const os = resolve(osKey);
  if (os === "WRONGFMT") return false;
  if (!os) { console.error(`unknown OS '${osKey}' — see --list or regenerate the catalog`); return false; }
  const appId = osKey, appDir = join(APPS, appId);
  console.log(`\n── ${os.name} (${appId}) ─────────────────────────────`);
  mkdirSync(join(appDir, "images"), { recursive: true });

  // 1. Engine + BIOS + xterm + splash (the v86 runtime, identical across OSes — substrate dedups by κ).
  const VEND = join(appDir, "vendor", "v86");
  copyDir(ENGINE_SRC, VEND);
  copyDir(XTERM_SRC, join(appDir, "vendor", "xterm"));
  copyFileSync(SPLASH_SRC, join(appDir, "holo-splash.js"));
  if (existsSync(ICON_SRC)) copyFileSync(ICON_SRC, join(appDir, "icon.svg"));

  // VGA BIOS: default to the Bochs VGABIOS for EVERY app — it's a VBE superset, so graphical guests
  // (KolibriOS-class) render AND text/serial guests are unaffected. Fetched on demand if missing.
  const vgabiosFile = os.vgabios || "bochs-vgabios.bin";
  if (!existsSync(join(VEND, vgabiosFile))) {
    const burl = "https://copy.sh/v86/bios/" + vgabiosFile;
    console.log("  vgabios  fetching " + burl + " …");
    const br = await fetch(burl);
    if (!br.ok) { console.error("  vgabios fetch failed: HTTP " + br.status); return false; }
    writeFileSync(join(VEND, vgabiosFile), Buffer.from(await br.arrayBuffer()));
  }

  // 2. Acquire the image (local reuse, else fetch — the out-of-band ToS boundary).
  const imgPath = join(appDir, "images", os.image);
  if (os.local && existsSync(os.local)) { copyFileSync(os.local, imgPath); console.log("  image    reused local " + os.local); }
  else if (existsSync(imgPath) && statSync(imgPath).size > 0) { console.log("  image    reuse " + statSync(imgPath).size + " bytes (already acquired)"); }
  else {
    const url = os.srcUrl || (IMG_HOST + os.image);
    console.log("  image    fetching " + url + " …");
    const r = await fetch(url);
    if (!r.ok) { console.error("  acquisition failed: HTTP " + r.status); return false; }
    writeFileSync(imgPath, Buffer.from(await r.arrayBuffer()));
    console.log("  image    " + statSync(imgPath).size + " bytes → " + imgPath);
  }

  // 3. Encode the disk as a κ-block DAG.
  const enc = spawnSync(process.execPath, [ENCODER, imgPath, "--block", "256"], { stdio: "inherit" });
  if (enc.status !== 0) { console.error("  encode failed"); return false; }
  const manifest = JSON.parse(readFileSync(imgPath + ".kblocks.json", "utf8"));

  // 4. kappa.json — engine + BIOS + disk-root pins (Law L5 gate on boot).
  const kappa = {
    $comment: "κ-pins for this v86 holo app. Engine + BIOSes are content-addressed and gated before exec; the disk is a κ-block DAG (image.kblocks) resolved lazily and re-derived per block.",
    algo: "sha256",
    engine: { libv86: enginePin(VEND, "libv86.js", "v86 — x86 emulator (libv86.js, BSD-2-Clause)"), wasm: enginePin(VEND, "v86.wasm", "v86 JIT core (x86→wasm)"), seabios: enginePin(VEND, "seabios.bin", "SeaBIOS"), vgabios: enginePin(VEND, vgabiosFile, "VGA BIOS (" + vgabiosFile + ")") },
    image: { kblocks: { $comment: "The disk as a κ-block DAG (tools/holo-disk-encode.mjs). 'root' is the closure κ over the block set; the boot gates on it, each block re-derived at read (Law L5).", manifest: "./images/" + os.image + ".kblocks.json", name: os.name + " disk (κ-block DAG)", blockSize: manifest.blockSize, root: manifest.root } },
  };
  writeFileSync(join(appDir, "kappa.json"), JSON.stringify(kappa, null, 2) + "\n");

  // 5. Generate index.html + sw.js from the template.
  const map = { "__APP_NAME__": os.name, "__IMAGE_FILE__": os.image, "__DRIVE__": os.drive,
    "__VIEW__": os.view || "serial", "__MEMORY__": os.memory, "__VGA_MEMORY__": os.vga,
    "__NINEP__": os.ninep ? "true" : "false", "__NINEP_TAG__": os.ninep ? " · /mnt = κ-substrate" : "" };
  writeFileSync(join(appDir, "index.html"), fill(readFileSync(join(TEMPLATE, "index.html"), "utf8"), map));
  writeFileSync(join(appDir, "sw.js"), fill(readFileSync(join(TEMPLATE, "sw.js"), "utf8"), map));

  // 6. holospace.json
  const holospace = {
    id: "org.hologram.V86" + os.name.replace(/[^A-Za-z0-9]/g, ""), name: os.name,
    type: ["schema:SoftwareApplication", "schema:WebApplication"], summary: os.summary,
    entry: "index.html", icon: "icon.svg", applicationCategory: "UtilitiesApplication",
    description: [{ p: `${os.name} boots on the v86 x86-to-wasm JIT. Its disk is not a blob — it is an ordered set of content-addressed κ-blocks, streamed lazily and re-derived per block before the guest sees a byte (Law L5).` }],
    categories: os.cats, keywords: ["v86", "emulator", "kappa", "content-addressed", ...os.kw],
    developer: { id: "org.hologram", name: "Hologram Technologies" }, license: os.license,
    homepage: "https://hologram.os/apps/" + appId,
  };
  writeFileSync(join(appDir, "holospace.json"), JSON.stringify(holospace, null, 2) + "\n");

  // 7. Seal into the substrate.
  const rl = spawnSync(process.execPath, [RELOCK, appId], { stdio: "inherit" });
  if (rl.status !== 0) { console.error("  relock failed"); return false; }
  console.log(`  ✓ boot: http://127.0.0.1:8300/apps/${appId}/index.html`);
  return true;
}

let ok = true;
for (const t of targets) ok = (await ingest(t)) && ok;
console.log(ok ? "\n✓ ingest complete" : "\n✗ ingest had failures");
process.exit(ok ? 0 : 1);
