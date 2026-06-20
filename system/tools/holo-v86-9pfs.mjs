#!/usr/bin/env node
// holo-v86-9pfs.mjs — ingest a 9pfs v86 OS (Arch Linux) as a κ-native, root-on-9p app.
//
// v86's 9p filesystem (fs.json v3) is the purest κ store: every file is addressed by its sha256, and
// v86 reads content from baseurl + <sha256>. The OS root IS a content-addressed object set. We seal
// only the small fs.json (the inode tree = the manifest); the whole filesystem streams on demand and
// SELF-verifies (filename == content hash, Law L5). v86 extracts the kernel+initrd from the tree and
// boots root-on-9p. Files stream from the CDN (CORS-open) through the 9pfs service worker.
//
//   node tools/holo-v86-9pfs.mjs            (Arch Linux — the one 9pfs profile)

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

const { sha256hex } = await import(pathToFileURL(join(REPO, "holo-os/system/os/usr/lib/holo/holo-uor.mjs")));
const SHA = "did:holo:sha256:";
const MB = 1024 * 1024;

// The one 9pfs profile in v86 (Arch). basefs = the inode tree; files live content-addressed under arch/.
const PROFILE = {
  id: "archlinux-boot", name: "Arch Linux", memory: 512 * MB, vga: 8 * MB, view: "vga",
  fsjsonUrl: HOST + "fs.json", fileOrigin: HOST + "arch/",
  cmdline: "rw apm=off vga=0x344 video=vesafb:ypan,vremap:8 root=host9p rootfstype=9p rootflags=trans=virtio,cache=loose mitigations=off audit=0 init_on_free=on tsc=reliable random.trust_cpu=on nowatchdog init=/usr/bin/init-openrc net.ifnames=0 biosdevname=0",
};

const copyDir = (src, dst) => { mkdirSync(dst, { recursive: true });
  for (const n of readdirSync(src)) { const s = join(src, n), d = join(dst, n);
    statSync(s).isDirectory() ? copyDir(s, d) : copyFileSync(s, d); } };
const fill = (tpl, map) => Object.entries(map).reduce((s, [k, v]) => s.split(k).join(String(v)), tpl);
const enginePin = (dir, file, name) => { const b = readFileSync(join(dir, file)); const hex = sha256hex(b);
  return { url: "./vendor/v86/" + file, name, sha256: hex, did: SHA + hex, bytes: b.length }; };

const p = PROFILE, appId = p.id, appDir = join(APPS, appId);
console.log(`\n── ${p.name} (${appId}) · 9pfs ─────────────────────────────`);
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

// 2. Acquire + κ-pin the fs.json inode tree (the manifest). Files themselves stream on demand.
const fsjsonPath = join(appDir, "fs.json");
if (existsSync(fsjsonPath) && statSync(fsjsonPath).size > 1024) { console.log("  fs.json  reuse " + statSync(fsjsonPath).size + " bytes"); }
else {
  console.log("  fs.json  fetching " + p.fsjsonUrl + " …");
  const r = await fetch(p.fsjsonUrl);
  if (!r.ok) { console.error("  fs.json fetch failed HTTP " + r.status); process.exit(1); }
  writeFileSync(fsjsonPath, Buffer.from(await r.arrayBuffer()));
  console.log("  fs.json  " + statSync(fsjsonPath).size + " bytes");
}
const fbytes = readFileSync(fsjsonPath);
const fhex = sha256hex(fbytes);
console.log("  fs.json κ " + SHA + fhex + "  (commits to the whole root tree)");

// 3. kappa.json — engine/BIOS pins + image.ninepfs (fs.json κ gates the boot; files self-verify by name).
const kappa = {
  $comment: "κ-pins for a 9pfs v86 holo app. Engine + BIOSes + the fs.json inode tree are content-addressed and gated (Law L5). The root filesystem streams on demand: every file is fetched by its sha256 and re-derived before the guest sees it — content-addressing is self-verifying.",
  algo: "sha256",
  engine: { libv86: enginePin(VEND, "libv86.js", "v86 — x86 emulator (libv86.js, BSD-2-Clause)"), wasm: enginePin(VEND, "v86.wasm", "v86 JIT core (x86→wasm)"), seabios: enginePin(VEND, "seabios.bin", "SeaBIOS"), vgabios: enginePin(VEND, vgabiosFile, "VGA BIOS (" + vgabiosFile + ")") },
  image: { ninepfs: { name: p.name + " root (9pfs, κ-streamed)", basefs: "./fs.json", baseurl: "./fs9p/", cmdline: p.cmdline, fsjson: { url: "./fs.json", sha256: fhex, did: SHA + fhex, bytes: fbytes.length } } },
};
writeFileSync(join(appDir, "kappa.json"), JSON.stringify(kappa, null, 2) + "\n");

// 4. index.html (template detects image.ninepfs) + sw.js (9pfs SW, file origin baked in).
const map = { "__APP_NAME__": p.name, "__IMAGE_FILE__": appId, "__DRIVE__": "hda", "__VIEW__": p.view,
  "__MEMORY__": p.memory, "__VGA_MEMORY__": p.vga, "__NINEP__": "false", "__NINEP_TAG__": " · 9pfs root = κ-substrate" };
writeFileSync(join(appDir, "index.html"), fill(readFileSync(join(TEMPLATE, "index.html"), "utf8"), map));
writeFileSync(join(appDir, "sw.js"), fill(readFileSync(join(TEMPLATE, "sw-9pfs.js"), "utf8"), { "__FILE_ORIGIN__": p.fileOrigin }));

// 5. holospace.json
writeFileSync(join(appDir, "holospace.json"), JSON.stringify({
  id: "org.hologram.V86ArchLinux", name: p.name,
  type: ["schema:SoftwareApplication", "schema:WebApplication"], summary: `${p.name} on v86 — a full root filesystem streamed as content-addressed κ-objects over 9p.`,
  entry: "index.html", icon: "icon.svg", applicationCategory: "UtilitiesApplication",
  description: [{ p: `${p.name} boots root-on-9p: its entire filesystem is a content-addressed object set. Only the inode tree is sealed; every file streams on demand and self-verifies by its sha256 before the guest reads it (Law L5).` }],
  categories: ["System", "Emulator"], keywords: ["v86", "linux", "arch", "9pfs", "kappa"],
  developer: { id: "org.hologram", name: "Hologram Technologies" }, license: "GPL-2.0/MIT", homepage: "https://hologram.os/apps/" + appId,
}, null, 2) + "\n");

// 6. Seal (fs.json + shell; the root filesystem is manifest-only — files stream + self-verify).
const rl = spawnSync(process.execPath, [RELOCK, appId], { stdio: "inherit" });
if (rl.status !== 0) { console.error("relock failed"); process.exit(1); }
console.log(`  ✓ boot: http://127.0.0.1:8300/apps/${appId}/index.html`);
