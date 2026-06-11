#!/usr/bin/env node
// make-boot.mjs — deterministic asset generator for Holo Boot (the hologram-native
// rEFInd boot manager). It emits the icon set (OS icons, tool/func icons, the two
// selection highlights, and the banner) as flat SVGs — no timestamps, no randomness,
// so every file re-derives byte-for-byte to a fixed κ on any machine — then pins
// every asset, refind.conf, each theme.conf, and each sibling holospace LOADER
// (.html) by sha256 into boot/boot-manifest.json.
//
// The loader pins are the heart of Holo Boot's "Secure Boot": boot.html re-derives a
// loader's bytes before it boots it and refuses a κ mismatch (Law L5). Re-run after
// changing any pinned loader:  node boot/make-boot.mjs
//
// Usage: node boot/make-boot.mjs   (idempotent; prints what it wrote + the κ count)

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)); // …/web/boot
const web = dirname(here);                            // …/web
const sha = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");

// ── SVG icon kit ─────────────────────────────────────────────────────────────────
// Flat line glyphs on a 128×128 canvas, drawn in `currentColor` so boot.html tints
// them (accent when selected, dim otherwise). rEFInd naming: os_*, tool_*, func_*.
const W = 128;
const svg = (body, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" fill="none" ` +
  `stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"${extra}>\n${body}\n</svg>\n`;

const ICONS = {
  // ── OS / holospace icons ──
  // The hologram mark: an isometric cube (the κ-addressed unit).
  os_hologram: svg(
    `<path d="M64 16 L110 42 V86 L64 112 L18 86 V42 Z"/>
     <path d="M18 42 L64 68 L110 42"/><path d="M64 68 V112"/>`),
  // Debian/Linux: a penguin silhouette, simplified.
  os_linux: svg(
    `<ellipse cx="64" cy="74" rx="30" ry="36"/>
     <circle cx="64" cy="34" r="20"/>
     <circle cx="56" cy="32" r="3" fill="currentColor"/><circle cx="72" cy="32" r="3" fill="currentColor"/>
     <path d="M58 42 L64 50 L70 42"/>
     <path d="M40 96 L30 112 M88 96 L98 112"/>`),
  // Video: a film clapper / play.
  os_video: svg(
    `<rect x="20" y="36" width="88" height="60" rx="8"/>
     <path d="M56 52 L82 66 L56 80 Z" fill="currentColor" stroke="none"/>
     <path d="M20 50 H108"/>`),
  // Winamp: the lightning bolt.
  os_winamp: svg(
    `<path d="M72 14 L34 70 H60 L52 114 L96 52 H68 Z" fill="currentColor" stroke="currentColor" stroke-width="5"/>`),
  // Music: a beamed pair of eighth notes.
  os_music: svg(
    `<path d="M48 92 V40 L92 28 V80"/>
     <circle cx="40" cy="92" r="12"/><circle cx="84" cy="80" r="12"/>
     <path d="M48 40 L92 28"/>`),
  // Meet: a video camera.
  os_meet: svg(
    `<rect x="20" y="42" width="64" height="44" rx="8"/>
     <path d="M84 56 L108 44 V84 L84 72 Z"/>`),
  // Docs: a document with text lines.
  os_docs: svg(
    `<path d="M36 16 H78 L98 36 V112 H36 Z"/>
     <path d="M78 16 V36 H98"/>
     <path d="M50 56 H84 M50 72 H84 M50 88 H72"/>`),
  // Player: a stacked media library.
  os_player: svg(
    `<rect x="22" y="30" width="84" height="58" rx="8"/>
     <path d="M30 100 H98 M40 112 H88"/>
     <path d="M58 46 L80 59 L58 72 Z" fill="currentColor" stroke="none"/>`),
  // Cloud.
  os_cloud: svg(
    `<path d="M42 92 a26 26 0 0 1 -2 -52 a30 30 0 0 1 57 8 a22 22 0 0 1 1 44 Z"/>`),
  // Code: angle brackets.
  os_code: svg(
    `<path d="M44 40 L20 64 L44 88"/><path d="M84 40 L108 64 L84 88"/><path d="M74 32 L54 96"/>`),
  // Container (Podman): a corrugated shipping container.
  os_container: svg(
    `<rect x="18" y="46" width="92" height="50" rx="5"/>
     <path d="M34 46 V96 M50 46 V96 M66 46 V96 M82 46 V96 M98 46 V96"/>
     <path d="M18 46 L30 34 H98 L110 46"/>`),
  // Splash (Plymouth): a hexagon mark with a boot spinner arc — the boot-splash stage.
  os_splash: svg(
    `<path d="M64 18 L104 41 V87 L64 110 L24 87 V41 Z"/>
     <path d="M82 64 a18 18 0 1 1 -10 -16"/>
     <circle cx="64" cy="64" r="5" fill="currentColor" stroke="none"/>`),
  // Unknown loader (disabled / teleport entry): a question disc.
  os_unknown: svg(
    `<circle cx="64" cy="64" r="44"/>
     <path d="M50 50 a14 14 0 1 1 20 12 c-4 3 -6 6 -6 12"/>
     <circle cx="64" cy="92" r="3.5" fill="currentColor"/>`),

  // ── Tool / func icons (the second row) ──
  tool_shell: svg(
    `<rect x="16" y="26" width="96" height="76" rx="8"/>
     <path d="M34 52 L50 64 L34 76"/><path d="M62 80 H92"/>`),
  tool_memtest: svg(
    `<rect x="24" y="40" width="80" height="48" rx="4"/>
     <path d="M40 40 V26 M64 40 V26 M88 40 V26 M40 88 V102 M64 88 V102 M88 88 V102"/>
     <path d="M44 56 H84 M44 72 H84"/>`),
  tool_netboot: svg(
    `<circle cx="64" cy="64" r="44"/>
     <path d="M20 64 H108 M64 20 V108"/>
     <path d="M64 20 a44 56 0 0 1 0 88 a44 56 0 0 1 0 -88"/>`),
  tool_bootorder: svg(
    `<path d="M52 38 H104 M52 64 H104 M52 90 H104"/>
     <path d="M24 30 V52 M16 44 L24 52 L32 44"/>
     <path d="M24 98 V76 M16 84 L24 76 L32 84"/>`),
  func_hidden: svg(
    `<path d="M16 64 C32 40 96 40 112 64 C96 88 32 88 16 64 Z"/>
     <circle cx="64" cy="64" r="14"/><path d="M24 104 L104 24"/>`),
  func_about: svg(
    `<circle cx="64" cy="64" r="46"/>
     <circle cx="64" cy="42" r="4" fill="currentColor"/>
     <path d="M64 58 V92"/>`),
  func_firmware: svg(
    `<rect x="40" y="40" width="48" height="48" rx="6"/>
     <path d="M52 24 V40 M76 24 V40 M52 88 V104 M76 88 V104 M24 52 H40 M24 76 H40 M88 52 H104 M88 76 H104"/>
     <circle cx="64" cy="64" r="9"/>`),
  func_exit: svg(
    `<path d="M76 24 H96 V104 H76"/>
     <path d="M28 64 H80 M58 42 L80 64 L58 86"/>`),
  func_shutdown: svg(
    `<path d="M64 20 V60"/>
     <path d="M40 36 a40 40 0 1 0 48 0"/>`),
  func_reset: svg(
    `<path d="M100 64 a36 36 0 1 1 -11 -26"/>
     <path d="M92 18 V40 H70"/>`),
};

// The two selection highlights (rEFInd: selection_big 144², selection_small 64²).
// A rounded, translucent box with a glowing accent border — the classic look.
const selection = (px) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px} ${px}">\n` +
  `  <rect x="${px * 0.03}" y="${px * 0.03}" width="${px * 0.94}" height="${px * 0.94}" rx="${px * 0.14}" ` +
  `fill="rgba(88,166,255,0.14)" stroke="#58a6ff" stroke-width="${Math.max(2, px * 0.02)}"/>\n</svg>\n`;

// Banners — the Holo Boot wordmark. Two variants prove the theme `banner` override.
const banner = (sub) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 140" fill="none">\n` +
  `  <text x="360" y="74" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" ` +
  `font-size="58" font-weight="800" letter-spacing="6" fill="#e6edf3">HOLO BOOT</text>\n` +
  `  <text x="360" y="110" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" ` +
  `font-size="18" letter-spacing="3" fill="#58a6ff">${sub}</text>\n</svg>\n`;

// ── write the kit ─────────────────────────────────────────────────────────────────
mkdirSync(join(here, "icons"), { recursive: true });
mkdirSync(join(here, "themes", "default"), { recursive: true });

const assets = {}; // relPath(from web) -> κ
const put = (relFromWeb, bytes) => {
  const abs = join(web, relFromWeb);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  assets[relFromWeb] = sha(bytes);
};

for (const [name, body] of Object.entries(ICONS)) put(`boot/icons/${name}.svg`, body);
put("boot/icons/selection_big.svg", selection(144));
put("boot/icons/selection_small.svg", selection(64));
put("boot/icons/banner.svg", banner("the hologram-native boot manager · κ-verified"));
// Theme-specific overrides for the "default" theme (distinct banner + selection).
put("boot/themes/default/banner.svg", banner("content-addressed boot · Law L5"));
put("boot/themes/default/selection_big.svg", selection(144));
put("boot/themes/default/selection_small.svg", selection(64));

// ── pin the configs (already authored on disk) ─────────────────────────────────────
for (const rel of [
  "boot/refind.conf",
  "boot/themes/default/theme.conf",
  "boot/themes/midnight/theme.conf",
]) {
  const abs = join(web, rel);
  if (existsSync(abs)) assets[rel] = sha(readFileSync(abs));
}

// ── pin the LOADERS (sibling holospace pages) — Holo Boot's Secure Boot ─────────────
// The κ each loader must re-derive to before boot.html will boot it (Law L5).
// The curated Secure-Boot menu — the pages boot.html can boot (a distinct concern from the app
// store; not every app is a boot target). Each is resolved through the registry: a definition's
// `loader` (apps/<id>/holospace.json) is authoritative, so a loader-path change propagates to
// Secure Boot. Non-app pages (home/container/splash/channel) fall back to the filename.
const BOOT_PAGES = [
  "home.html", "os.html", "video.html", "winamp.html", "music.html",
  "meet.html", "docs.html", "player.html", "cloud.html", "container.html", "splash.html", "workspace.html",
  "capture.html", "stream.html", "channel.html",
];
const defLoader = (f) => {
  const hp = join(here, "..", "apps", f.replace(/\.html$/, ""), "holospace.json");
  if (existsSync(hp)) { try { return JSON.parse(readFileSync(hp, "utf8")).loader || f; } catch {} }
  return f;
};
const LOADERS = BOOT_PAGES.map(defLoader);
const loaders = {};
for (const f of LOADERS) {
  const abs = join(web, f);
  if (existsSync(abs)) loaders[f] = sha(readFileSync(abs));
}

const manifest = {
  _comment:
    "Holo Boot κ-manifest (Law L5). `assets` pins the boot manager's own icons/config/themes; " +
    "`loaders` pins each bootable holospace page — boot.html re-derives a loader's bytes and " +
    "REFUSES a κ mismatch before booting it (the content-addressed analog of Secure Boot). " +
    "Regenerate with `node boot/make-boot.mjs` after changing a pinned loader.",
  algo: "sha256",
  assets,
  loaders,
};
writeFileSync(join(here, "boot-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const nAssets = Object.keys(assets).length, nLoaders = Object.keys(loaders).length;
console.log(`Holo Boot assets written:`);
console.log(`  icons   : ${Object.keys(ICONS).length} glyphs + 2 selections + 1 banner`);
console.log(`  themes  : default (banner+selection), midnight`);
console.log(`  manifest: ${nAssets} assets + ${nLoaders} loaders pinned → boot/boot-manifest.json`);
console.log(`Done. Every asset re-derives to its κ (sha256); loaders are Secure-Boot pinned.`);
