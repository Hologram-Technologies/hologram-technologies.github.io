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
//     5 MOTION   — every app honors prefers-reduced-motion via the OS-wide guard it inherits (the OS guard
//                  exists + every app inherits it + no app overrides it with its own !important motion).
//     6 NATIVE   — no app shows an unconditional Apple-only modifier glyph (⌘/⌥): the host's modifier is
//                  derived (HoloPlatform / metaKey) or rendered by the inherited data-holo-shortcut rewriter.
//   Read-only over the app repo — no edits, no re-lock.
//
//   node tools/holo-app-ux-witness.mjs
//   Scope: each app's authored index.html + holospace.json in the served app repo. Override: HOLO_APPS_DIR.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { findJargon } from "../os/usr/lib/holo/holo-voice.mjs";
import { verify } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const APPS = process.env.HOLO_APPS_DIR || join(here, "../../../holo-apps/apps");

const ENGINE = ["holo-theme.js", "holo-ui-kernel.js", "holo-ui.js", "holo-ux.js"];

// Verbatim-vendored exemption (mirrors holo-app-wired-witness): a full third-party distribution
// shipped UNMODIFIED can't load the engine without forking upstream + resealing its whole closure.
// It's held to the vendoring contract, not the inherit-the-doctrine contract — listed explicitly so
// the exception is auditable. Because it doesn't load the engine, it also can't inherit the shared
// reduced-motion guard; the vendored distro carries its own motion behavior, outside our wire.
const VENDORED_EXEMPT = new Set(["jypyter"]);
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
const unwired = appIds.filter((id) => !VENDORED_EXEMPT.has(id) && !ENGINE.some((f) => effectiveHtml(id).includes(f)));

// ── 4 · VOICE — every app's manifest is jargon-free (signal-over-noise, the plain register) ───────
const jargonApps = [];
for (const id of appIds) {
  const m = manifest(id);
  const txt = [m.name, m.title, m.summary, m.description, m.tagline].filter(Boolean).join("  ");
  const hits = [...new Set(findJargon(txt).map((j) => j.term))];
  if (hits.length) jargonApps.push({ id, terms: hits });
}

// strip <script>…</script> and comments so a check sees only VISIBLE authored markup (a Ctrl in a
// JS string / a code comment / a terminal hint is not a UI idiom).
const visibleMarkup = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<!--[\s\S]*?-->/g, " ");
// an app "adapts the modifier at runtime" if it derives it from the host (HoloPlatform / the
// inherited data-holo-* signals / a metaKey branch / the data-holo-shortcut rewriter).
const adaptsModifier = (html) => /profileFor|HoloPlatform|HoloUX|data-holo-(?:mod|platform|shortcut)|metaKey|\.apple\b/.test(html);

// ── 5 · MOTION — every app honors prefers-reduced-motion (ABSOLUTE, via the inherited shared guard) ──
// The OS provides ONE universal guard in holo-theme.css (`:where(*,*::before,*::after){animation/
// transition-duration:…!important}` under prefers-reduced-motion), injected into EVERY app by the
// engine — so an app honors reduced motion by inheriting it; it does NOT need its own copy (Law L2).
// The only thing the shared !important guard can't neutralize is an app's OWN !important motion, so
// THAT is the one real violation. Conformant = the OS guard exists + every app inherits it (loads the
// engine) or has its own guard + no app has unbeatable !important motion.
const themeCss = read(join(OS, "usr/lib/holo/holo-theme.css"));
const osMotionGuard = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/.test(themeCss)
  && /animation-duration:[^;]*!important/.test(themeCss) && /transition-duration:[^;]*!important/.test(themeCss);
const motionOverride = appIds.filter((id) => {
  if (VENDORED_EXEMPT.has(id)) return false;                // verbatim-vendored: outside our motion wire
  const html = effectiveHtml(id);
  const ownGuard = /prefers-reduced-motion/.test(html);
  const hardMotion = /(animation|transition)[^;:{}]*:[^;{}]*!important/i.test(visibleMarkup(html));
  return hardMotion && !ownGuard;                          // its own !important motion the shared guard can't beat
});
const motionOk = osMotionGuard && motionOverride.length === 0 && (appIds.length === 0 || unwired.length === 0);

// ── 6 · NATIVE-ADAPTIVE — no app shows an unconditional Apple-only modifier glyph (⌘ ⌥) ──────────────
// The native-adaptive tenet: the modifier must adapt to the host. A bare ⌘/⌥ in visible markup is
// simply WRONG on the ~85% of hosts that aren't Apple. It's fine when the app adapts at runtime
// (HoloPlatform / metaKey), when the glyph is paired with its non-Apple form (e.g. "Ctrl/⌘"), or when
// it uses the inherited data-holo-shortcut rewriter. Code/comments/terminal Ctrl are excluded (not UI).
const APPLE_GLYPH = /[⌘⌥]/;
const nativeViolations = [];
for (const id of appIds) {
  const html = effectiveHtml(id);
  if (adaptsModifier(html)) continue;                      // derives the modifier from the host — adaptive
  const vis = visibleMarkup(html);
  const lines = vis.split(/\r?\n/).filter((ln) => APPLE_GLYPH.test(ln) && !/ctrl|alt|\bcmd\b/i.test(ln)); // unpaired
  if (lines.length) nativeViolations.push({ id, count: lines.length });
}
// the enabler must exist in the inherited runtime so apps have a zero-branch way to be adaptive.
const uxRuntime = read(join(OS, "usr/lib/holo/holo-ux.js"));
const shortcutEnabler = /data-holo-shortcut/.test(uxRuntime) && /renderChord|applyShortcuts/.test(uxRuntime);

// ── verdict ───────────────────────────────────────────────────────────────────────────────────────
const checks = {
  "the carrier is intact — holo-theme.js bootstraps holo-ux.js (every engine-loading app inherits the doctrine)": carrierOk,
  "the canonical Holo UX doctrine object exists + re-derives to its content address (Law L5)": sealedOk,
  "every served app loads the engine → inherits Holo UX (native-OS feel · tier · obligations)": appIds.length > 0 && unwired.length === 0,
  "every app's manifest is jargon-free (signal-over-noise · the plain voice register)": jargonApps.length === 0,
  "every app honors prefers-reduced-motion — the OS provides one universal guard + every app inherits it + none overrides it (sacred resources · WCAG 2.3.3)": motionOk,
  "no app shows an unconditional Apple-only modifier glyph (⌘/⌥) — the modifier adapts to the host (native-adaptive)": nativeViolations.length === 0,
  "the inherited runtime offers the data-holo-shortcut rewriter so apps adapt the modifier with no per-app branch": shortcutEnabler,
};
const witnessed = Object.values(checks).every(Boolean);

console.log(`Holo UX app conformance — ${appIds.length} apps scanned`);
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
if (unwired.length) console.log("  unwired:", unwired.join(", "));
if (jargonApps.length) console.log("  jargon:", jargonApps.map((a) => `${a.id}[${a.terms.join(",")}]`).join(", "));
if (!osMotionGuard) console.log("  MISSING the OS-wide reduced-motion guard in holo-theme.css");
if (motionOverride.length) console.log("  own !important motion (shared guard can't beat):", motionOverride.join(", "));
if (nativeViolations.length) console.log("  non-adaptive Apple glyph:", nativeViolations.map((v) => `${v.id}(${v.count})`).join(", "));

writeFileSync(join(here, "holo-app-ux-witness.result.json"), JSON.stringify({
  spec: "Every served holospace app strictly adheres to the canonical Holo UX doctrine (ADR-0062): it inherits the whole doctrine by loading the one engine (holo-theme.js bootstraps holo-ux.js — the native-OS feel, capability tier, resource budget and propagation reach every app with no per-app script, Law L2); its manifest holds the plain voice (signal over noise); it honors prefers-reduced-motion through the OS-wide guard every app inherits (sacred resources · WCAG 2.3.3); and its modifier keys are native-adaptive (no unconditional Apple-only glyph — the host's modifier is derived, or rendered by the inherited data-holo-shortcut rewriter). Read-only static analysis of the served app repo.",
  authority: "ADR-0062 (Holo UX doctrine) · ADR-0030/0057 (Holo UI) · W3C UA Client Hints (host modifier) · WCAG 2.2 (2.3.3 Animation from Interactions · 1.4.x readability) · the plain voice register (holo-voice.mjs) · RAIL / W3C Web Performance · static analysis of the served app repo",
  witnessed,
  covers: ["holo-ux", "every-application", "inherits-doctrine", "native-os-feel", "native-adaptive-modifier", "plain-voice", "reduced-motion", "sacred-resources", "strict-conformance"],
  appsScanned: appIds.length,
  doctrineKappa: doctrine?.id || null,
  checks,
  unwired, jargonApps,
  reducedMotion: { osGuard: osMotionGuard, everyAppInherits: appIds.length > 0 && unwired.length === 0, overrides: motionOverride },
  nativeAdaptive: { violations: nativeViolations, enabler: shortcutEnabler },
}, null, 2) + "\n");

console.log(`\nholo-app-ux: ${witnessed ? "WITNESSED" : "FAILED"} · ${appIds.length} apps · motion ${motionOk ? "universal" : "GAP"} · native-adaptive ${nativeViolations.length === 0 ? "ok" : nativeViolations.length + " gap"}`);
process.exit(witnessed ? 0 : 1);
