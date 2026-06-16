#!/usr/bin/env node
// holo-mobile-appearance-witness.mjs — PROVE the Hologram OS mobile appearance system is ONE
// canonical axis, applied BEFORE first paint across the boot chain, with one clean modal primitive.
//
// The feature (mobile themes: Dark · Light · Immersive) must be coherent by construction, not by
// per-screen duplication. This witness verifies, by static analysis of the served bytes:
//
//   1 · ENGINE — holo-theme.js is the single source of truth: its state (holo.theme.v1) carries the
//       immersive + wallpaper axis, apply() publishes data-holo-immersive + --holo-wallpaper, the κ
//       wallpaper resolves to the serverless /.holo/<algo>/<hex> store (Law L5), and the user-facing
//       setMode / setImmersive / setWallpaper verbs are exported.
//   2 · PRE-PAINT — holo-appearance-boot.js is a synchronous, classic resolver that reads the SAME
//       holo.theme.v1 and pins data-holo-palette + color-scheme + data-holo-immersive on <html>
//       before paint, migrating the homepage's legacy key once (index.html is never edited).
//   3 · WIRED — the boot screens that hand off into the desktop (splash.html, shell.html) load that
//       bootstrap as a plain <script> (NOT a deferred module), so the first frame wears the theme.
//   4 · SHEET — holo-sheet.js is the ONE modal primitive (window.HoloSheet) on the native <dialog>,
//       token-driven, honoring the ≥48px tap floor and the 16px readability floor (no sub-16 px).
//   5 · PINNED — both new served modules are content-addressed in os-closure.json (verified, L5).
//
//   node tools/holo-mobile-appearance-witness.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const FLOOR = 16;
const read = (rel) => (existsSync(join(OS, rel)) ? readFileSync(join(OS, rel), "utf8") : "");

const theme = read("usr/lib/holo/holo-theme.js");
const boot = read("usr/lib/holo/holo-appearance-boot.js");
const sheet = read("usr/lib/holo/holo-sheet.js");
const splash = read("usr/share/frame/splash.html");
const shell = read("usr/share/frame/shell.html");
const login = read("usr/share/frame/login.html");
const closure = (() => { try { return JSON.parse(read("etc/os-closure.json")).closure || {}; } catch { return {}; } })();

// the curated κ-sealed Immersive wallpaper set: every member's bytes must re-derive to the sha256
// κ recorded in its receipt (Law L5) — a real content-addressed, attributed set, not a stub.
const curated = (() => {
  try {
    const r = JSON.parse(read("usr/share/wallpapers/curated.receipt.jsonld"));
    const members = r["prov:hadMember"] || [];
    const verified = members.filter((m) => {
      const want = String(m["@id"]).split(":").pop();
      const abs = join(OS, "usr/share/wallpapers", m["holo:file"] || "");
      if (!existsSync(abs)) return false;
      return createHash("sha256").update(readFileSync(abs)).digest("hex") === want;
    });
    return { count: members.length, verified: verified.length, attributed: members.every((m) => m["dcterms:creator"] && m["holo:attributionUrl"]) };
  } catch { return { count: 0, verified: 0, attributed: false }; }
})();

// the bootstrap must be referenced as a SYNCHRONOUS classic script (no type=module → no defer).
const syncRef = (html) => /<script\s+src="[^"]*holo-appearance-boot\.js"\s*>\s*<\/script>/.test(html);
// pinned with a real sha256 κ in the closure.
const pinned = (key) => !!(closure[key] && /^did:holo:sha256:[0-9a-f]{64}$/.test(closure[key].kappa || ""));
// no sub-floor px font-size in the sheet primitive (same rule as holo-ui-conformance).
const subFloor = [];
{
  const PX = /font-size:\s*(\d+(?:\.\d+)?)px/g, FONT_SH = /\bfont:\s*[^;{}"'/]*?(\d+(?:\.\d+)?)px/g;
  sheet.split(/\r?\n/).forEach((ln, i) => {
    for (const RX of [PX, FONT_SH]) { let m; RX.lastIndex = 0; while ((m = RX.exec(ln))) { if (parseFloat(m[1]) < FLOOR) subFloor.push({ line: i + 1, px: parseFloat(m[1]) }); } }
  });
}

const checks = {
  // 1 · engine
  "holo-theme.js state declares the immersive axis (immersive + wallpaper)":
    /immersive:\s*false/.test(theme) && /wallpaper:\s*""/.test(theme),
  "apply() publishes data-holo-immersive on <html>": /setAttribute\("data-holo-immersive"/.test(theme),
  "apply() publishes --holo-wallpaper": /--holo-wallpaper/.test(theme),
  "κ wallpaper resolves to the serverless /.holo store (L5)": /wallUrl/.test(theme) && /\/\.holo\/"/.test(theme),
  "engine exports setMode / setImmersive / setWallpaper":
    /setMode:\s*setMode/.test(theme) && /setImmersive:\s*setImmersive/.test(theme) && /setWallpaper:\s*setWallpaper/.test(theme),
  // 2 · pre-paint bootstrap
  "pre-paint bootstrap (holo-appearance-boot.js) exists": boot.length > 0,
  "bootstrap reads the canonical holo.theme.v1 state": /holo\.theme\.v1/.test(boot),
  "bootstrap pins data-holo-palette + color-scheme before paint":
    /setAttribute\("data-holo-palette"/.test(boot) && /color-scheme/.test(boot),
  "bootstrap pins data-holo-immersive before paint": /data-holo-immersive/.test(boot),
  "bootstrap migrates the homepage legacy key (index.html untouched)": /holo\.gateway\.mode/.test(boot),
  // 3 · wired into the boot chain
  "splash.html loads the bootstrap as a synchronous script": syncRef(splash),
  "shell.html loads the bootstrap as a synchronous script": syncRef(shell),
  // 4 · the one modal primitive
  "holo-sheet.js exposes window.HoloSheet": /HoloSheet\s*=\s*\{/.test(sheet),
  "HoloSheet is built on the native <dialog> (focus-trap / Esc / top-layer)":
    /el\("dialog"/.test(sheet) && /\.showModal\(\)/.test(sheet),
  "HoloSheet honors the ≥48px tap floor (--holo-tap)": /var\(--holo-tap/.test(sheet),
  "HoloSheet is token-driven (wears the active palette/immersive theme)": /var\(--holo-/.test(sheet),
  "HoloSheet renders no sub-16px text": subFloor.length === 0,
  "shell.html loads holo-sheet.js": /holo-sheet\.js/.test(shell),
  // 5 · immersive backdrop wired to the curated κ set
  "shell has the immersive backdrop layer (#immersive-wall)": /id="immersive-wall"/.test(shell),
  "Immersive paints the engine's chosen wallpaper (--holo-wallpaper)":
    /\[data-holo-immersive="on"\]\s*#immersive-wall[^}]*var\(--holo-wallpaper/.test(shell),
  "Dark/Light hide the photo layers for a clean solid desktop":
    /\[data-holo-immersive="off"\]\s*#wallpaper\s*\{[^}]*opacity:\s*0/.test(shell),
  "curated Immersive set is κ-sealed and re-derives (L5)": curated.count >= 5 && curated.verified === curated.count,
  "curated Immersive set is attributed (Unsplash license)": curated.attributed,
  // 6 · the pickers (consistent boot end to end)
  "login pre-paints the appearance via the bootstrap": syncRef(login),
  "login offers a Dark/Light/Immersive toggle that persists to holo.theme.v1":
    /id="appearance-toggle"/.test(login) && /holo\.theme\.v1/.test(login) && /color-scheme/.test(login),
  "login reflects the chosen palette (a real Light theme, not only Dark)": /\[data-holo-palette="light"\]/.test(login),
  "shell exposes an Appearance picker over the curated set": /function openAppearance/.test(shell) && /curated\.receipt\.jsonld/.test(shell),
  "HoloSheet supports thumbnail options (the wallpaper chooser)": /has-thumb/.test(sheet) && /o\.thumb/.test(sheet),
  // 7 · content-addressed (L5)
  "holo-appearance-boot.js is κ-pinned in os-closure": pinned("_shared/holo-appearance-boot.js"),
  "holo-sheet.js is κ-pinned in os-closure": pinned("_shared/holo-sheet.js"),
};

const witnessed = Object.values(checks).every(Boolean);
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
if (subFloor.length) for (const s of subFloor) console.log(`        holo-sheet.js:${s.line}  ${s.px}px (< ${FLOOR})`);

writeFileSync(join(here, "holo-mobile-appearance-witness.result.json"), JSON.stringify({
  spec: "Hologram OS mobile appearance (Dark · Light · Immersive) is ONE canonical axis on the holo-theme.js engine (holo.theme.v1), applied before first paint by a synchronous bootstrap across the boot chain (splash · shell), with one launcher-clean modal primitive (window.HoloSheet on native <dialog>) that honors the 48px tap floor and 16px readability floor. The homepage (index.html) is never edited; its legacy choice is migrated once. New served modules are content-addressed in os-closure (Law L5).",
  authority: "ADR-0030 (Holo UI façade) · ADR-0057 (minimum text size) · CSS Color Adjustment L1 (light-dark()) · W3C Custom Properties + @property · HTML <dialog> · WCAG 2.2 (2.5.8 target size) · Material Design 3 · holospaces Law L5 · verify by static analysis of the served engine + boot chain + closure",
  witnessed,
  covers: ["mobile-appearance", "themes", "dark-light-immersive", "pre-paint-bootstrap", "holo-sheet", "immersive-backdrop", "curated-wallpapers", "login-picker", "appearance-picker", "tap-floor", "font-min", "canonical-axis", "conformance"],
  floor: FLOOR,
  checks,
  curated,
  subFloor,
}, null, 2) + "\n");

console.log(`\nholo-mobile-appearance: ${witnessed ? "WITNESSED" : "FAILED"}`);
process.exit(witnessed ? 0 : 1);
