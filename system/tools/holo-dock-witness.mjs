#!/usr/bin/env node
// holo-dock-witness.mjs — PROVE Holo Dock (ADR-0059) is the native-feel bottom dock/taskbar built by
// ADOPTING the supplied desktop-component specs as content-addressed κ-objects, not by running a
// foreign runtime (ADR-0029). Pure-Node static analysis, like holo-ui-conformance-witness.mjs:
//
//   1 FILES   — the 5 dock κ-objects (+ runtime) exist and are non-empty.
//   2 ZPACK   — holo-dock-config.json is a VALID instance of the vendored zebar zpack schema.
//   3 SPEC    — the vendored zpack schema is structurally faithful (dockToEdge.edge enum) + pinned.
//   4 GLASS   — the TranslucentTB accent states are wired as --holo-glass-* tokens in holo-theme.css.
//   5 PHI     — the dock CSS sizes everything off holo-phi tokens (no raw px for height/gap).
//   6 OS      — the dock adapts to all 7 host OSes via [data-holo-platform=…]; JS stamps it.
//   7 MOUNT   — the dock is mounted in the desktop shell (home.html: css + js + boot-hide).
//   8 FLOOR   — no sub-16px font-size in the dock CSS/JS (ADR-0057 readability floor).
//   9 ACCENT  — holo-translucenttb-accents.json faithfully enumerates the accent model it adopts.
//
//   node tools/holo-dock-witness.mjs

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const LIB = join(OS, "usr/lib/holo");
const FLOOR = 16;

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const sha256hex = (buf) => createHash("sha256").update(buf).digest("hex");
const nonEmpty = (p) => { try { const s = statSync(p); return s.isFile() && s.size > 0; } catch { return false; } };
const J = (f) => { try { return JSON.parse(read(join(LIB, f))); } catch { return null; } };

const checks = {};
const set = (k, v) => { checks[k] = !!v; };

// ── 1 · files ────────────────────────────────────────────────────────────────────────
const FILES = ["holo-dock.js", "holo-dock.css", "holo-dock-config.json", "holo-zpack-schema.json", "holo-translucenttb-accents.json"];
for (const f of FILES) set(`file present + non-empty: ${f}`, nonEmpty(join(LIB, f)));

const config = J("holo-dock-config.json");
const schema = J("holo-zpack-schema.json");
const accents = J("holo-translucenttb-accents.json");
const dockCss = read(join(LIB, "holo-dock.css"));
const dockJs = read(join(LIB, "holo-dock.js"));
const themeCss = read(join(LIB, "holo-theme.css"));
const homeHtml = read(join(OS, "usr/share/frame/home.html"));

// ── 2 · config ⊨ zpack schema (draft-07 subset validator) ──────────────────────────────
function validateZpack(cfg, sch) {
  const errs = [];
  if (!cfg || typeof cfg !== "object") return ["config is not an object"];
  for (const req of (sch.required || [])) if (!(req in cfg)) errs.push(`missing top-level "${req}"`);
  const widgets = cfg.widgets;
  if (!Array.isArray(widgets) || widgets.length === 0) { errs.push("widgets[] missing/empty"); return errs; }
  const wSch = sch.properties.widgets.items;
  const pSch = wSch.properties.presets.items[0];
  for (const w of widgets) {
    for (const req of (wSch.required || [])) if (!(req in w)) errs.push(`widget missing "${req}"`);
    if (!wSch.properties.zOrder.enum.includes(w.zOrder)) errs.push(`zOrder "${w.zOrder}" invalid`);
    for (const pr of (w.presets || [])) {
      for (const req of (pSch.required || [])) if (!(req in pr)) errs.push(`preset missing "${req}"`);
      if (!pSch.properties.anchor.enum.includes(pr.anchor)) errs.push(`anchor "${pr.anchor}" invalid`);
      const mt = pr.monitorSelection && pr.monitorSelection.type;
      if (!["all", "primary", "secondary", "index", "name"].includes(mt)) errs.push(`monitorSelection.type "${mt}" invalid`);
      if (pr.dockToEdge && pr.dockToEdge.edge != null) {
        const edges = pSch.properties.dockToEdge.properties.edge.oneOf[0].enum;
        if (!edges.includes(pr.dockToEdge.edge)) errs.push(`dockToEdge.edge "${pr.dockToEdge.edge}" invalid`);
      }
    }
  }
  return errs;
}
const zErrs = (config && schema) ? validateZpack(config, schema) : ["config or schema missing"];
set("dock config is a valid instance of the vendored zebar zpack schema", zErrs.length === 0);

// ── 3 · zpack schema faithful + pinned ──────────────────────────────────────────────────
let edgeEnum = [];
try { edgeEnum = schema.properties.widgets.items.properties.presets.items[0].properties.dockToEdge.properties.edge.oneOf[0].enum; } catch {}
set("zpack schema carries the faithful dockToEdge.edge enum [top,right,bottom,left]",
  JSON.stringify(edgeEnum) === JSON.stringify(["top", "right", "bottom", "left"]));
const schemaPin = schema ? "sha256:" + sha256hex(read(join(LIB, "holo-zpack-schema.json"))) : null;

// ── 4 · glass tokens (TranslucentTB accent states as CSS) ───────────────────────────────
for (const tok of ["--holo-glass-blur", "--holo-glass-acrylic-fx", "--holo-glass-opaque-bg", "--holo-glass-clear-bg", "--holo-glass-tint"])
  set(`holo-theme.css declares the glass token ${tok}`, themeCss.includes(tok));

// ── 5 · golden-ratio sizing, no raw px for height/gap ───────────────────────────────────
set("holo-dock.css sizes off holo-phi tokens (--holo-size-* / --holo-phi)",
  dockCss.includes("var(--holo-size-") && dockCss.includes("var(--holo-phi"));
const rawPx = [];
dockCss.split(/\r?\n/).forEach((ln, i) => {
  const m = ln.match(/(?:^|[\s;{])(height|gap)\s*:\s*(\d+(?:\.\d+)?)px/);
  if (m && parseFloat(m[2]) > 2) rawPx.push(`${i + 1}: ${m[1]}:${m[2]}px`);
});
set("holo-dock.css uses no raw px for height/gap (φ tokens only; ≤2px hairlines/indicators ok)", rawPx.length === 0);

// ── 6 · OS-adaptive variants ─────────────────────────────────────────────────────────────
const OSES = ["windows", "macos", "ios", "ipados", "android", "linux", "chromeos"];
for (const os of OSES) set(`dock styles the ${os} variant ([data-holo-platform="${os}"])`, dockCss.includes(`[data-holo-platform="${os}"]`));
set("holo-dock.js stamps data-holo-platform from HoloPlatform.profileFor",
  /setAttribute\(\s*["']data-holo-platform["']/.test(dockJs) && dockJs.includes("profileFor"));

// ── 6b · orientation — bottom dock in fullscreen, vertical LEFT bar in a window (no taskbar clash) ──
set('dock styles both orientations ([data-orient="bottom"] + [data-orient="left"])',
  dockCss.includes('[data-orient="bottom"]') && dockCss.includes('[data-orient="left"]'));
set("holo-dock.js switches orientation on the fullscreen state",
  dockJs.includes("display-mode: fullscreen") && /fullscreenElement/.test(dockJs) && dockJs.includes("data-orient"));

// ── 7 · mounted in the desktop shell ─────────────────────────────────────────────────────
set("home.html links holo-dock.css", homeHtml.includes("_shared/holo-dock.css"));
set("home.html loads holo-dock.js", homeHtml.includes("_shared/holo-dock.js"));
set("home.html hides the dock behind the boot splash", /html\.booting\s+#holo-dock/.test(homeHtml));

// ── 8 · readability floor (ADR-0057) ─────────────────────────────────────────────────────
const subFloor = [];
for (const [name, txt] of [["holo-dock.css", dockCss], ["holo-dock.js", dockJs]]) {
  const re = /font-size:\s*(\d+(?:\.\d+)?)px/g; let m;
  while ((m = re.exec(txt))) if (parseFloat(m[1]) < FLOOR) subFloor.push(`${name}: ${m[1]}px`);
}
set(`no sub-${FLOOR}px font-size in the dock CSS/JS`, subFloor.length === 0);

// ── 9 · accent model faithfully adopted ──────────────────────────────────────────────────
let accentOk = false;
try {
  const en = accents.parameters.accent.enum, br = accents.parameters.blur_radius, st = accents.states;
  accentOk = ["normal", "opaque", "clear", "blur", "acrylic"].every((s) => en.includes(s))
    && br.min === 0 && br.max === 750 && br.cssDivisor === 3
    && ["opaque", "clear", "blur", "acrylic"].every((s) => st[s] && st[s].token && st[s].token.bg && st[s].token.fx);
} catch {}
set("translucenttb accent model is faithfully adopted (5 states + blur_radius 0–750 /3 + token map)", accentOk);

// ── verdict ───────────────────────────────────────────────────────────────────────────────
const witnessed = Object.values(checks).every(Boolean);
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
if (rawPx.length) console.log("  raw px (height/gap):", rawPx.join(", "));
if (subFloor.length) console.log("  sub-floor font-size:", subFloor.join(", "));
if (zErrs.length) console.log("  zpack validation:", zErrs.join("; "));

writeFileSync(join(here, "holo-dock-witness.result.json"), JSON.stringify({
  spec: "Holo Dock (ADR-0059) is the native-feel bottom dock/taskbar: it ADOPTS the zebar widget-pack schema (holo-zpack-schema.json) and the TranslucentTB accent-state model (holo-translucenttb-accents.json) as byte-pinned, content-addressed κ-objects and renders natively — no foreign runtime (ADR-0029). It is golden-ratio-proportioned (holo-phi), OS-adaptive (HoloPlatform → data-holo-platform), glass-translucent (--holo-glass-* tokens), linked to Holo UI/UX, and editable like every other substrate object; the dock config validates against the adopted schema.",
  authority: "zebar (github.com/glzr-io/zebar — resources/zpack-schema.json) · TranslucentTB (github.com/TranslucentTB/TranslucentTB — settings.schema.json) · ADR-0029 (adopt OSS desktop standards as κ-objects, never run a foreign runtime) · ADR-0030 (Holo UI) · ADR-0057 (readability floor) · W3C CSS backdrop-filter / Color 4 light-dark() / Custom Properties · golden ratio (φ) · verify by static analysis of the served chrome",
  witnessed,
  covers: ["holo-dock", "glass", "phi-sizing", "os-adaptive", "zpack-adopt", "translucenttb-adopt", "a11y", "conformance"],
  schemaPin,
  checks,
  rawPx, subFloor, zErrs,
}, null, 2) + "\n");

console.log(`\nholo-dock: ${witnessed ? "WITNESSED" : "FAILED"} · ${Object.keys(checks).length} checks`);
process.exit(witnessed ? 0 : 1);
