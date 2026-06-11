#!/usr/bin/env node
// holo-ui-conformance-witness.mjs — PROVE the Holo UI readability FLOOR is wired and not bypassed.
//
// Holo UI (ADR-0030) is the single canonical UI source: one engine (holo-theme.js) drives the
// --holo-* token contract, and ADR-0057 adds --holo-font-min, a px FLOOR below which no text
// rendered through the tokens can fall. The floor only holds if (a) the canonical token layer
// actually clamps up to it, and (b) first-party chrome routes text through the tokens instead of
// hardcoding sub-floor px sizes that silently bypass the floor. This witness checks BOTH:
//
//   1 · CONTRACT — holo-theme.css (root font-size) and holo-mobile.css (the sub-1rem type ramp +
//       form controls) must clamp up to the floor with max(var(--holo-font-min), …).
//   2 · NO BYPASS — no first-party UI file (the canonical runtime os/usr/lib/holo/*.{css,js} and
//       the shell frames os/usr/share/frame/*.html) may set `font-size:<N>px` with N < the floor.
//       The only exemptions are VERBATIM upstream reproductions (the SDDM greeter / Plymouth
//       splash), which are styled byte-for-byte to their spec and must not be re-typed.
//
//   node tools/holo-ui-conformance-witness.mjs

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const FLOOR = 16;                                  // px — must match DEFAULTS.fontMin (holo-theme.js)

// VERBATIM-fidelity reproductions: their type is pinned to upstream (SDDM `SddmComponents 2.0`
// QML · Plymouth), so re-typing them would BREAK the reproduction. Exempt by design, not backlog.
const FIDELITY = new Set([
  "os/usr/lib/holo/holo-sddm.js",
  "os/usr/share/frame/login.html",                // the SDDM greeter projection
  "os/usr/share/frame/splash.html",               // the Plymouth boot splash projection
]);

const rel = (abs) => abs.replace(OS, "os").replace(/\\/g, "/");
const filesIn = (d, exts) => readdirSync(join(OS, d))
  .map((n) => join(OS, d, n))
  .filter((p) => { try { return statSync(p).isFile() && exts.some((e) => p.endsWith(e)); } catch { return false; } });

// First-party UI surface: the canonical runtime (top-level loose files only — vendored libs live
// in SUBDIRS: xterm/ videojs/ webamp/ shoelace/ metamask/ … and are not scanned) + the shell frames.
const targets = [
  ...filesIn("usr/lib/holo", [".css", ".js"]),
  ...filesIn("usr/share/frame", [".html"]),
];

// ── check 1 · the canonical contract clamps up to the floor ──────────────────────────
const themeCss = readFileSync(join(OS, "usr/lib/holo/holo-theme.css"), "utf8");
const mobileCss = readFileSync(join(OS, "usr/lib/holo/holo-mobile.css"), "utf8");
const contract = {
  "holo-theme.css declares the @property --holo-font-min token": /@property\s+--holo-font-min/.test(themeCss),
  "holo-theme.css floors the root font-size to --holo-font-min": /font-size:\s*max\(\s*var\(--holo-font-min/.test(themeCss),
  "holo-mobile.css floors --holo-text-sm to --holo-font-min": /--holo-text-sm:\s*max\(\s*var\(--holo-font-min/.test(mobileCss),
  "holo-mobile.css floors --holo-text to --holo-font-min": /--holo-text:\s*max\(\s*var\(--holo-font-min/.test(mobileCss),
  "holo-mobile.css floors form controls to --holo-font-min": /input,\s*select,\s*textarea\)\s*\{\s*font-size:\s*max\(\s*var\(--holo-font-min/.test(mobileCss),
};

// ── check 2 · no first-party bypass (sub-floor px outside fidelity reproductions) ──
// Both the `font-size` property AND the `font:` shorthand's size are in scope (px, int or decimal).
// In a font shorthand the size is the only px before the family / `/line-height`, so the first px
// (stopping before any `/` or quote) is the size; weight/style carry no px units.
const PX = /font-size:\s*(\d+(?:\.\d+)?)px/g;
const FONT_SH = /\bfont:\s*[^;{}"'/]*?(\d+(?:\.\d+)?)px/g;
const violations = [];
for (const abs of targets) {
  const r = rel(abs);
  if (FIDELITY.has(r)) continue;
  const lines = readFileSync(abs, "utf8").split(/\r?\n/);
  lines.forEach((ln, i) => {
    for (const RX of [PX, FONT_SH]) {
      let m; RX.lastIndex = 0;
      while ((m = RX.exec(ln))) {
        const px = parseFloat(m[1]);
        if (px < FLOOR) violations.push({ file: r, line: i + 1, px, snippet: ln.trim().slice(0, 90) });
      }
    }
  });
}

const contractOk = Object.values(contract).every(Boolean);
const witnessed = contractOk && violations.length === 0;

for (const [k, v] of Object.entries(contract)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
console.log(`${violations.length === 0 ? "PASS" : "FAIL"} — no sub-${FLOOR}px font-size in first-party UI (found ${violations.length})`);
for (const v of violations.slice(0, 40)) console.log(`        ${v.file}:${v.line}  ${v.px}px  ·  ${v.snippet}`);

writeFileSync(join(here, "holo-ui-conformance-witness.result.json"), JSON.stringify({
  spec: "Holo UI is the single canonical UI source; --holo-font-min (ADR-0057) is the readability FLOOR. The canonical token layer clamps up to it and no first-party UI hardcodes sub-floor px text that bypasses it (verbatim SDDM/Plymouth reproductions exempt).",
  authority: "ADR-0030 (Holo UI façade) · ADR-0057 (minimum text size) · WCAG 2.2 readability · verify by static analysis of the served token layer + first-party chrome",
  witnessed,
  covers: ["holo-ui", "font-min", "type-ramp", "canonical-tokens", "a11y", "conformance"],
  floor: FLOOR,
  contract, contractOk,
  scanned: targets.length,
  fidelityExempt: [...FIDELITY],
  violations,
}, null, 2) + "\n");

console.log(`\nholo-ui-conformance: ${witnessed ? "WITNESSED" : "FAILED"} · ${targets.length} files scanned · ${violations.length} violations`);
process.exit(witnessed ? 0 : 1);
