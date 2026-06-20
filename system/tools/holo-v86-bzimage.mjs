#!/usr/bin/env node
// holo-v86-bzimage.mjs — ingest a bzImage v86 OS (direct kernel boot, no disk) as a κ-native app.
//
// bzImage profiles boot a Linux kernel directly (bzimage:{url} + cmdline, empty 9p root). The kernel
// is small (5–14 MB) and immutable, so we κ-pin it WHOLE (like a BIOS) and gate it before boot — no
// block-DAG, no service worker. The generated app's template detects kappa.image.bzimage and boots it.
//
//   node tools/holo-v86-bzimage.mjs <os>     (resolves from profiles.json; e.g. buildroot, buildroot6, nodeos)

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
const DEFAULT_CMDLINE = "tsc=reliable mitigations=off random.trust_cpu=on";

const { sha256hex } = await import(pathToFileURL(join(REPO, "holo-os/system/os/usr/lib/holo/holo-uor.mjs")));
const SHA = "did:holo:sha256:";
const MB = 1024 * 1024;

let GEN = {};
try { GEN = JSON.parse(readFileSync(APPS + "/holo-v86/profiles.json", "utf8")); } catch {}

const copyDir = (src, dst) => { mkdirSync(dst, { recursive: true });
  for (const n of readdirSync(src)) { const s = join(src, n), d = join(dst, n);
    statSync(s).isDirectory() ? copyDir(s, d) : copyFileSync(s, d); } };
const fill = (tpl, map) => Object.entries(map).reduce((s, [k, v]) => s.split(k).join(String(v)), tpl);
const enginePin = (dir, file, name) => { const b = readFileSync(join(dir, file)); const hex = sha256hex(b);
  return { url: "./vendor/v86/" + file, name, sha256: hex, did: SHA + hex, bytes: b.length }; };

const osKey = process.argv[2];
const p = osKey && GEN[osKey];
if (!p || p.format !== "bzimage") { console.error(`'${osKey}' is not a bzImage profile (have: ${Object.keys(GEN).filter((k) => GEN[k].format === "bzimage").join(", ")})`); process.exit(1); }

const appId = osKey, appDir = join(APPS, appId);
console.log(`\n── ${p.name} (${appId}) · bzImage ─────────────────────────────`);
mkdirSync(join(appDir, "images"), { recursive: true });

// 1. Engine + BIOS + xterm + splash + icon.
const VEND = join(appDir, "vendor", "v86");
copyDir(ENGINE_SRC, VEND); copyDir(XTERM_SRC, join(appDir, "vendor", "xterm"));
copyFileSync(SPLASH_SRC, join(appDir, "holo-splash.js"));
if (existsSync(ICON_SRC)) copyFileSync(ICON_SRC, join(appDir, "icon.svg"));
const vgabiosFile = "bochs-vgabios.bin";
if (!existsSync(join(VEND, vgabiosFile))) {
  const br = await fetch("https://copy.sh/v86/bios/" + vgabiosFile);
  if (!br.ok) { console.error("vgabios fetch failed HTTP " + br.status); process.exit(1); }
  writeFileSync(join(VEND, vgabiosFile), Buffer.from(await br.arrayBuffer()));
}

// 2. Acquire the kernel (single file) and κ-pin it WHOLE.
const kernelFile = p.url.split("/").pop();
const kernelPath = join(appDir, "images", kernelFile);
if (existsSync(kernelPath) && statSync(kernelPath).size > 0) { console.log("  kernel   reuse " + statSync(kernelPath).size + " bytes"); }
else {
  const url = HOST + p.url;
  console.log("  kernel   fetching " + url + " …");
  const r = await fetch(url);
  if (!r.ok) { console.error("  acquisition failed HTTP " + r.status); process.exit(1); }
  writeFileSync(kernelPath, Buffer.from(await r.arrayBuffer()));
  console.log("  kernel   " + statSync(kernelPath).size + " bytes");
}
const kbytes = readFileSync(kernelPath);
const khex = sha256hex(kbytes);
console.log("  kernel κ " + SHA + khex);

// 3. kappa.json — engine/BIOS pins + image.bzimage (whole-κ kernel gate).
const kappa = {
  $comment: "κ-pins for a bzImage v86 holo app. Engine + BIOSes + the kernel are content-addressed and gated before boot (Law L5). No disk: the kernel boots directly with its initramfs.",
  algo: "sha256",
  engine: { libv86: enginePin(VEND, "libv86.js", "v86 — x86 emulator (libv86.js, BSD-2-Clause)"), wasm: enginePin(VEND, "v86.wasm", "v86 JIT core (x86→wasm)"), seabios: enginePin(VEND, "seabios.bin", "SeaBIOS"), vgabios: enginePin(VEND, vgabiosFile, "VGA BIOS (" + vgabiosFile + ")") },
  image: { bzimage: { url: "./images/" + kernelFile, name: p.name + " kernel (bzImage)", sha256: khex, did: SHA + khex, bytes: kbytes.length, cmdline: DEFAULT_CMDLINE } },
};
writeFileSync(join(appDir, "kappa.json"), JSON.stringify(kappa, null, 2) + "\n");

// 4. index.html (template detects image.bzimage). No sw.js — bzImage needs no disk seam.
const map = { "__APP_NAME__": p.name, "__IMAGE_FILE__": appId, "__DRIVE__": "hda", "__VIEW__": "vga",
  "__MEMORY__": p.memory || 128 * MB, "__VGA_MEMORY__": p.vga || 8 * MB, "__NINEP__": "false", "__NINEP_TAG__": " · bzImage kernel" };
writeFileSync(join(appDir, "index.html"), fill(readFileSync(join(TEMPLATE, "index.html"), "utf8"), map));

// 5. holospace.json
writeFileSync(join(appDir, "holospace.json"), JSON.stringify({
  id: "org.hologram.V86" + p.name.replace(/[^A-Za-z0-9]/g, ""), name: p.name,
  type: ["schema:SoftwareApplication", "schema:WebApplication"], summary: `${p.name} on v86 — a κ-verified Linux kernel booted directly (bzImage).`,
  entry: "index.html", icon: "icon.svg", applicationCategory: "UtilitiesApplication",
  description: [{ p: `${p.name} boots its Linux kernel directly on v86 (bzImage). The kernel is content-addressed and re-derived before a single instruction runs (Law L5).` }],
  categories: ["System", "Emulator"], keywords: ["v86", "linux", "bzimage", "kappa"],
  developer: { id: "org.hologram", name: "Hologram Technologies" }, license: "GPL-2.0", homepage: "https://hologram.os/apps/" + appId,
}, null, 2) + "\n");

// 6. Seal.
const rl = spawnSync(process.execPath, [RELOCK, appId], { stdio: "inherit" });
if (rl.status !== 0) { console.error("relock failed"); process.exit(1); }
console.log(`  ✓ boot: http://127.0.0.1:8300/apps/${appId}/index.html`);
