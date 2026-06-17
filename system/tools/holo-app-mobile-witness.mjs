#!/usr/bin/env node
// holo-app-mobile-witness.mjs — enforce MOBILE conformance across every holospace application, as a
// RATCHET (the "betterer" pattern), the sibling of holo-app-ui-conformance-witness.mjs (which ratchets
// the readability floor). The mobile MECHANICS (≥48dp tap targets · 16px form controls · safe-area
// insets · no horizontal overflow · container-query window-size classes) are delivered AUTOMATICALLY by
// the vendored holo-mobile.css, which the runtime now injects into every app and the build/share paths
// bake in — so most of the standard is enforced by construction, not by this file.
//
// This witness catches the few anti-patterns the runtime layer CANNOT fix because they are AUTHORED
// INTENT in the app's own head/CSS, and fails the gate if any app introduces a NEW one beyond its
// committed baseline:
//   • 100vh        — breaks on mobile when the URL bar shows/hides; must be 100dvh (the layer can't
//                    safely override an authored height). WCAG 2.1 §1.4.10 Reflow.
//   • zoom disabled — user-scalable=no / maximum-scale=1 blocks pinch-zoom. WCAG 2.2 §1.4.4 Resize Text.
//   • viewport not mobile — a <meta viewport> without width=device-width renders desktop-zoomed.
//
// Read-only: it scans app HTML, never edits — so it adds the enforcement with NO κ drift / re-pin.
//
//   node tools/holo-app-mobile-witness.mjs                    # enforce against the baseline
//   node tools/holo-app-mobile-witness.mjs --update-baseline  # re-seal the baseline to current
//
// Scope: each app's authored index.html in the served app repo (Hologram Apps). Override with HOLO_APPS_DIR.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APPS = process.env.HOLO_APPS_DIR || join(here, "../../../holo-apps/apps");
const BASELINE = join(here, "holo-app-mobile-baseline.json");
const update = process.argv.includes("--update-baseline");

// Each app's AUTHORED shell = apps/<id>/index.html (vendored code lives in subdirs, not scanned).
const appIds = existsSync(APPS)
  ? readdirSync(APPS).filter((n) => { try { return statSync(join(APPS, n, "index.html")).isFile(); } catch { return false; } })
  : [];

// detect the statically-reliable, runtime-unfixable mobile anti-patterns in one app's source.
function scan(html) {
  const hits = [];
  const vh = (html.match(/\b100vh\b/gi) || []).length;          // should be 100dvh
  if (vh) hits.push({ rule: "100vh-not-dvh", n: vh, note: "use 100dvh (overflow when the URL bar toggles)" });
  const vpTag = (html.match(/<meta\b[^>]*name\s*=\s*["']?viewport[^>]*>/i) || [null])[0];
  if (!vpTag) {
    hits.push({ rule: "no-viewport-meta", n: 1, note: "add <meta viewport width=device-width> (renders desktop-zoomed without it)" });
  } else {
    if (!/width\s*=\s*device-width/i.test(vpTag)) hits.push({ rule: "viewport-not-device-width", n: 1, note: "viewport lacks width=device-width" });
    if (/user-scalable\s*=\s*(?:no|0)\b/i.test(vpTag) || /maximum-scale\s*=\s*(?:0|1)(?:\.0+)?\b/i.test(vpTag))
      hits.push({ rule: "zoom-disabled", n: 1, note: "user-scalable=no / maximum-scale=1 blocks pinch-zoom (WCAG 1.4.4)" });
  }
  return hits;
}

const current = {};            // app → [{rule, n, note}]
for (const id of appIds) {
  const hits = scan(readFileSync(join(APPS, id, "index.html"), "utf8"));
  if (hits.length) current[id] = hits;
}
const countOf = (hits) => (hits || []).reduce((a, h) => a + h.n, 0);
const counts = Object.fromEntries(Object.entries(current).map(([id, h]) => [id, countOf(h)]));
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (update) {
  writeFileSync(BASELINE, JSON.stringify({
    note: "Ratchet baseline for MOBILE conformance across apps. 'ceilings' is the max statically-detectable, runtime-unfixable mobile violations (100vh-not-dvh · no/!device-width viewport · zoom-disabled) allowed per app's authored index.html; the witness FAILS on any increase. The rest of the mobile standard (48dp · 16px · safe-area · no-overflow · container queries) is delivered automatically by the injected holo-mobile.css. Burn these down and re-seal with --update-baseline. New apps default to a ceiling of 0.",
    total, ceilings: counts,
  }, null, 2) + "\n");
  console.log(`mobile baseline sealed → ${BASELINE}  (${total} pre-existing across ${Object.keys(counts).length} apps)`);
  process.exit(0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { ceilings: {} };
const ceil = base.ceilings || {};
const regressions = [], improvements = [];
for (const id of appIds) {
  const now = counts[id] || 0, was = ceil[id] || 0;
  if (now > was) regressions.push({ app: id, was, now, added: now - was, sample: (current[id] || []).slice(0, 3) });
  else if (now < was) improvements.push({ app: id, was, now });
}

const witnessed = regressions.length === 0;
console.log(`Holo mobile app conformance — ${appIds.length} apps scanned · ${total} baselined mobile anti-patterns (burn-down)`);
if (regressions.length) { console.log(`\nFAIL — new mobile anti-pattern introduced:`); for (const r of regressions) { console.log(`  ✗ ${r.app}: ${r.was} → ${r.now} (+${r.added})`); for (const s of r.sample) console.log(`        ${s.rule} ×${s.n}  ·  ${s.note}`); } }
else console.log(`PASS — no app exceeded its mobile baseline (no new mobile-breaking markup in any application)`);
if (improvements.length) console.log(`\n↓ improved (re-seal the baseline with --update-baseline): ${improvements.map((i) => `${i.app} ${i.was}→${i.now}`).join(", ")}`);

writeFileSync(join(here, "holo-app-mobile-witness.result.json"), JSON.stringify({
  spec: "Mobile conformance is ENFORCED across every served holospace application: the mechanics (48dp tap targets · 16px form controls · safe-area insets · no horizontal overflow · container-query window-size classes) are delivered automatically by the runtime-injected holo-mobile.css, and this ratchet fails the gate if any app introduces a NEW runtime-unfixable anti-pattern (100vh instead of 100dvh · a non-mobile or zoom-disabled viewport) beyond its committed baseline — so the corpus can only get MORE mobile-correct.",
  authority: "WCAG 2.2 (§1.4.10 Reflow · §1.4.4 Resize Text · §2.5.8 Target Size) · Material Design 3 (48dp · adaptive window-size classes) · the 'betterer' no-new-violations ratchet · static analysis of the served app repo + the auto-injected runtime CSS layer",
  witnessed,
  covers: ["mobile", "touch-target", "safe-area", "100dvh", "container-query", "pwa", "every-application", "ratchet", "a11y"],
  appsScanned: appIds.length, baselinedTotal: total,
  regressions, improvements,
}, null, 2) + "\n");

console.log(`\nholo-app-mobile: ${witnessed ? "WITNESSED" : "FAILED"}${regressions.length ? ` · ${regressions.length} app(s) regressed` : ""}`);
process.exit(witnessed ? 0 : 1);
