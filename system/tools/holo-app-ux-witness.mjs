#!/usr/bin/env node
// holo-app-ux-witness.mjs — PROVE the Holo UX doctrine (ADR-0062) is strictly adhered to by EVERY
// served holospace application, the experience twin of holo-app-wired/-ui/-token witnesses. Loading
// the one engine every app already loads (holo-theme.js) bootstraps the Holo UX runtime
// (holo-ux.js), so every app inherits the WHOLE doctrine — the host-OS native feel, the capability
// tier, the resource budget, the propagation — by binding one canonical wire (Law L2), with no
// per-app script tag. This witness proves that inheritance is real for every app, and holds each app
// to the two obligations that are checkable in its OWN authored shell:
//
//   ABSOLUTE (must hold for every app — strict):
//     1 CARRIER  — holo-theme.js bootstraps holo-ux.js (the universal wire that delivers the doctrine).
//     2 SEALED   — the canonical doctrine object (etc/holo-ux/doctrine.uor.json) exists + re-derives (L5).
//     3 INHERIT  — every served app loads the engine (holo-theme.js / -ui-kernel.js / -ui.js) → gets it.
//     4 VOICE    — every app's manifest (name/summary/description) is jargon-free (signal-over-noise).
//   RATCHET (no-new-violations vs the committed baseline — the burn-down to full adherence):
//     5 MOTION   — an app that animates honors prefers-reduced-motion (sacred-resources · WCAG 2.3.3);
//                  the current offenders are baselined and no NEW one may regress (run --update-baseline
//                  to record a burn-down). Read-only over the app repo — no edits, no re-lock.
//
//   node tools/holo-app-ux-witness.mjs [--update-baseline]
//   Scope: each app's authored index.html + holospace.json in the served app repo. Override: HOLO_APPS_DIR.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { findJargon } from "../os/usr/lib/holo/holo-voice.mjs";
import { verify } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const APPS = process.env.HOLO_APPS_DIR || "C:/Users/pavel/Desktop/Hologram Apps/apps";
const BASELINE = join(here, "holo-app-ux-baseline.json");
const UPDATE = process.argv.includes("--update-baseline");

const ENGINE = ["holo-theme.js", "holo-ui-kernel.js", "holo-ui.js", "holo-ux.js"];
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

const appIds = existsSync(APPS)
  ? readdirSync(APPS).filter((n) => { try { return statSync(join(APPS, n, "index.html")).isFile(); } catch { return false; } })
  : [];

// follow a forwarder stub (index.html that redirects to a sibling .html) to where the real app lives.
function effectiveHtml(id) {
  const html = read(join(APPS, id, "index.html"));
  const fwd = html.match(/location\.(?:replace|href)\s*=?\s*\(?\s*["']\.?\/?([\w.-]+\.html)/);
  if (fwd) { const t = join(APPS, id, fwd[1]); if (existsSync(t)) return read(t); }
  return html;
}
const manifest = (id) => { try { return JSON.parse(read(join(APPS, id, "holospace.json"))); } catch { return {}; } };

// ── 1 · CARRIER — the one wire that makes every engine-loading app a Holo UX citizen ──────────────
const themeJs = read(join(OS, "usr/lib/holo/holo-ux.js")) && read(join(OS, "usr/lib/holo/holo-theme.js"));
const carrierOk = /holo-ux\.js/.test(read(join(OS, "usr/lib/holo/holo-theme.js")))
  && /createElement\(\s*["']script["']\s*\)/.test(read(join(OS, "usr/lib/holo/holo-theme.js")));

// ── 2 · SEALED — the canonical doctrine object re-derives (Law L5) ────────────────────────────────
let doctrine = null; try { doctrine = JSON.parse(read(join(OS, "etc/holo-ux/doctrine.uor.json"))); } catch {}
const sealedOk = !!(doctrine && doctrine.id && verify(doctrine));

// ── 3 · INHERIT — every app loads the engine (→ inherits holo-ux.js) ──────────────────────────────
const unwired = appIds.filter((id) => !ENGINE.some((f) => effectiveHtml(id).includes(f)));

// ── 4 · VOICE — every app's manifest is jargon-free (signal-over-noise, the plain register) ───────
const jargonApps = [];
for (const id of appIds) {
  const m = manifest(id);
  const txt = [m.name, m.title, m.summary, m.description, m.tagline].filter(Boolean).join("  ");
  const hits = [...new Set(findJargon(txt).map((j) => j.term))];
  if (hits.length) jargonApps.push({ id, terms: hits });
}

// ── 5 · MOTION — animates ⇒ honors prefers-reduced-motion (ratchet vs baseline) ───────────────────
const animatesUnguarded = appIds.filter((id) => {
  const html = effectiveHtml(id);
  const animates = /@keyframes|\banimation\s*:|\btransition\s*:/.test(html);
  return animates && !/prefers-reduced-motion/.test(html);
});
let baseline = { note: "Ratchet baseline for Holo UX reduced-motion adherence (ADR-0062). Apps that animate without a prefers-reduced-motion guard; no NEW app may regress, burning this down only ever passes.", floor: "prefers-reduced-motion", animatingUnguarded: [], total: 0 };
if (existsSync(BASELINE)) { try { baseline = JSON.parse(read(BASELINE)); } catch {} }
const baseSet = new Set(baseline.animatingUnguarded || []);
const motionNew = animatesUnguarded.filter((id) => !baseSet.has(id));     // regressions — must be empty
const motionFixed = (baseline.animatingUnguarded || []).filter((id) => !animatesUnguarded.includes(id)); // burned down

if (UPDATE) {
  const next = { ...baseline, animatingUnguarded: [...animatesUnguarded].sort(), total: animatesUnguarded.length };
  writeFileSync(BASELINE, JSON.stringify(next, null, 2) + "\n");
  console.log(`baseline updated — ${animatesUnguarded.length} app(s) animate without a reduced-motion guard`);
  baseline = next;
}

// ── verdict ───────────────────────────────────────────────────────────────────────────────────────
const checks = {
  "the carrier is intact — holo-theme.js bootstraps holo-ux.js (every engine-loading app inherits the doctrine)": carrierOk,
  "the canonical Holo UX doctrine object exists + re-derives to its content address (Law L5)": sealedOk,
  "every served app loads the engine → inherits Holo UX (native-OS feel · tier · obligations)": appIds.length > 0 && unwired.length === 0,
  "every app's manifest is jargon-free (signal-over-noise · the plain voice register)": jargonApps.length === 0,
  "no NEW app animates without honoring prefers-reduced-motion (sacred resources · WCAG 2.3.3 ratchet)": motionNew.length === 0,
};
const witnessed = Object.values(checks).every(Boolean);

console.log(`Holo UX app conformance — ${appIds.length} apps scanned`);
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
if (unwired.length) console.log("  unwired:", unwired.join(", "));
if (jargonApps.length) console.log("  jargon:", jargonApps.map((a) => `${a.id}[${a.terms.join(",")}]`).join(", "));
if (motionNew.length) console.log("  NEW unguarded animation:", motionNew.join(", "));
console.log(`  reduced-motion ratchet — baseline ${baseline.total || (baseline.animatingUnguarded||[]).length} · now ${animatesUnguarded.length} · burned down ${motionFixed.length}${motionFixed.length ? " (" + motionFixed.join(", ") + " — run --update-baseline)" : ""}`);

writeFileSync(join(here, "holo-app-ux-witness.result.json"), JSON.stringify({
  spec: "Every served holospace app strictly adheres to the canonical Holo UX doctrine (ADR-0062): it inherits the whole doctrine by loading the one engine (holo-theme.js bootstraps holo-ux.js — the native-OS feel, capability tier, resource budget and propagation reach every app with no per-app script, Law L2); its manifest holds the plain voice (signal-over-noise); and a no-new-regression ratchet drives every app to honor prefers-reduced-motion (sacred resources · WCAG 2.3.3). Read-only static analysis of the served app repo.",
  authority: "ADR-0062 (Holo UX doctrine) · ADR-0030/0057 (Holo UI) · WCAG 2.2 (2.3.3 Animation from Interactions · 1.4.x readability) · the plain voice register (holo-voice.mjs) · RAIL / W3C Web Performance · the 'betterer' no-new-violations ratchet · static analysis of the served app repo",
  witnessed,
  covers: ["holo-ux", "every-application", "inherits-doctrine", "native-os-feel", "plain-voice", "reduced-motion", "sacred-resources", "ratchet", "strict-conformance"],
  appsScanned: appIds.length,
  doctrineKappa: doctrine?.id || null,
  checks,
  unwired, jargonApps,
  reducedMotion: { baseline: (baseline.animatingUnguarded || []).length, now: animatesUnguarded.length, regressions: motionNew, burnedDown: motionFixed, animatingUnguarded: animatesUnguarded },
}, null, 2) + "\n");

console.log(`\nholo-app-ux: ${witnessed ? "WITNESSED" : "FAILED"} · ${appIds.length} apps · ${animatesUnguarded.length} motion-unguarded (ratcheted)`);
process.exit(witnessed ? 0 : 1);
