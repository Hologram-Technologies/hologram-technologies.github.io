#!/usr/bin/env node
// holo-app-ui-conformance-witness.mjs — extend the Holo UI readability FLOOR (ADR-0057) from the OS
// chrome to EVERY holospace application. The OS-chrome witness (holo-ui-conformance-witness.mjs) holds
// first-party OS code to ZERO sub-floor px text. Apps are a large pre-existing corpus, so we enforce
// the floor as a RATCHET (the "betterer" pattern): scan every served app's authored shell, and FAIL if
// any app gained a sub-floor px `font-size` beyond its committed baseline. No app can introduce new
// too-small text; the baseline is the visible burn-down list, and burning it down only ever passes.
//
// Read-only: it scans app HTML, it never edits — so it adds the enforcement with NO κ drift / re-pin.
// Apps already inherit the floor for token/rem text via the --holo-* tokens + postMessage propagation;
// this closes the bypass where an app hardcodes px in its OWN authored shell.
//
//   node tools/holo-app-ui-conformance-witness.mjs                    # enforce against the baseline
//   node tools/holo-app-ui-conformance-witness.mjs --update-baseline  # re-seal the baseline to current
//
// Scope: each app's authored index.html in the served app repo (Hologram Apps). Vendored subtrees
// (Monaco/xterm/webamp/…) live in SUBDIRS and are not scanned. Override the repo with HOLO_APPS_DIR.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const FLOOR = 16;                                          // px — matches DEFAULTS.fontMin (holo-theme.js)
const APPS = process.env.HOLO_APPS_DIR || join(here, "../../../holo-apps/apps");
const BASELINE = join(here, "holo-app-ui-baseline.json");
const update = process.argv.includes("--update-baseline");
const PX = /font-size:\s*(\d+(?:\.\d+)?)px/g;                       // the font-size property
const FONT_SH = /\bfont:\s*[^;{}"'/]*?(\d+(?:\.\d+)?)px/g;          // the size inside a `font:` shorthand

// Each app's AUTHORED shell = apps/<id>/index.html (vendored code lives in subdirs, not scanned).
const appIds = existsSync(APPS)
  ? readdirSync(APPS).filter((n) => { try { return statSync(join(APPS, n, "index.html")).isFile(); } catch { return false; } })
  : [];

const current = {};            // app → [{line, px, snippet}]
for (const id of appIds) {
  const lines = readFileSync(join(APPS, id, "index.html"), "utf8").split(/\r?\n/);
  const hits = [];
  lines.forEach((ln, i) => { for (const RX of [PX, FONT_SH]) { let m; RX.lastIndex = 0; while ((m = RX.exec(ln))) { const px = parseFloat(m[1]); if (px < FLOOR) hits.push({ line: i + 1, px, snippet: ln.trim().slice(0, 90) }); } } });
  if (hits.length) current[id] = hits;
}
const counts = Object.fromEntries(Object.entries(current).map(([id, h]) => [id, h.length]));
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (update) {
  writeFileSync(BASELINE, JSON.stringify({
    note: "Ratchet baseline for the Holo UI readability floor across apps (ADR-0057). 'ceilings' is the max sub-16px font-size count allowed per app's authored index.html; the witness FAILS on any increase. Burn these down (route to var(--holo-text-sm)) and re-seal with --update-baseline. New apps default to a ceiling of 0.",
    floor: FLOOR, total, ceilings: counts,
  }, null, 2) + "\n");
  console.log(`baseline sealed → ${BASELINE}  (${total} pre-existing across ${Object.keys(counts).length} apps)`);
  process.exit(0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { ceilings: {} };
const ceil = base.ceilings || {};
const regressions = [], improvements = [];
for (const id of appIds) {
  const now = counts[id] || 0, was = ceil[id] || 0;
  if (now > was) regressions.push({ app: id, was, now, added: now - was, sample: (current[id] || []).slice(-3) });
  else if (now < was) improvements.push({ app: id, was, now });
}

const witnessed = regressions.length === 0;
console.log(`Holo UI app conformance — floor ${FLOOR}px · ${appIds.length} apps scanned · ${total} baselined sub-floor px (burn-down)`);
if (regressions.length) { console.log(`\nFAIL — new sub-${FLOOR}px text introduced:`); for (const r of regressions) { console.log(`  ✗ ${r.app}: ${r.was} → ${r.now} (+${r.added})`); for (const s of r.sample) console.log(`        :${s.line}  ${s.px}px  ·  ${s.snippet}`); } }
else console.log(`PASS — no app exceeded its baseline (no new too-small text in any native application)`);
if (improvements.length) console.log(`\n↓ improved (re-seal the baseline with --update-baseline): ${improvements.map((i) => `${i.app} ${i.was}→${i.now}`).join(", ")}`);

writeFileSync(join(here, "holo-app-ui-conformance-witness.result.json"), JSON.stringify({
  spec: "The Holo UI readability floor (ADR-0057, --holo-font-min) is ENFORCED across every served holospace application: no app may introduce a sub-floor px font-size in its authored shell beyond its committed baseline (a ratchet that only burns down).",
  authority: "ADR-0057 (minimum text size) · ADR-0030 (Holo UI) · WCAG 2.2 (1.4.4 Resize Text) · the 'betterer' no-new-violations ratchet · static analysis of the served app repo",
  witnessed,
  covers: ["holo-ui", "font-min", "app-conformance", "every-application", "a11y", "ratchet"],
  floor: FLOOR, appsScanned: appIds.length, baselinedTotal: total,
  regressions, improvements,
}, null, 2) + "\n");

console.log(`\nholo-app-ui-conformance: ${witnessed ? "WITNESSED" : "FAILED"}${regressions.length ? ` · ${regressions.length} app(s) regressed` : ""}`);
process.exit(witnessed ? 0 : 1);
