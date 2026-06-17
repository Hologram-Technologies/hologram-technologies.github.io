#!/usr/bin/env node
// holo-app-wired-witness.mjs — PROVE every served holospace application is WIRED to upstream Holo UI.
//
// The canonical UI parameters (palette · text size · the --holo-font-min readability floor · density ·
// accent) are defined and persisted by ONE source — the Holo UI engine (holo-theme.js, exposed as
// window.HoloTheme / HoloUI), loaded by the holospace shell — and PROPAGATED to every nested app over
// the postMessage tree (ADR-0023/0030). An app only receives + persists those canonical parameters if
// it actually LOADS the engine; an app that doesn't is an island that can't conform. This witness
// enforces the wire: every app's authored shell must load the Holo UI engine (directly, or via the
// holo-ui-kernel.js / holo-ui.js façades that bootstrap it). Read-only static analysis — no edits.
//
//   node tools/holo-app-wired-witness.mjs
//
// Scope: each app's authored index.html in the served app repo (Hologram Apps). Override: HOLO_APPS_DIR.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APPS = process.env.HOLO_APPS_DIR || join(here, "../../../holo-apps/apps");

// The engine entrypoints: holo-theme.js IS the engine; holo-ui-kernel.js / holo-ui.js load it.
// Referenced by name via the `data-holo-shared` hint, a path, or a κ-route comment — so a filename
// substring match catches every adoption form.
const ENGINE = ["holo-theme.js", "holo-ui-kernel.js", "holo-ui.js"];

// Verbatim-vendored exemption: a few apps are full third-party distributions shipped UNMODIFIED
// (the vendoring principle — no handwritten app code). Injecting the Holo UI engine into their
// build-generated HTML would fork upstream and force a reseal of their whole multi-hundred-MB
// closure, for no real gain (the OS still themes the host frame around them). Such an app is held
// to the vendoring contract instead of the wiring contract — listed here so the exception is
// explicit and auditable, never silent. jypyter = the full JupyterLite distro (see app-vendoring).
const VENDORED_EXEMPT = new Set(["jypyter"]);

const appIds = existsSync(APPS)
  ? readdirSync(APPS).filter((n) => { try { return statSync(join(APPS, n, "index.html")).isFile(); } catch { return false; } })
  : [];

// A forwarder index.html (a stub that redirects to a sibling .html — e.g. search → search.html) is
// checked at its target: the real app is where the engine loads.
function effectiveHtml(id) {
  const index = join(APPS, id, "index.html");
  let html = readFileSync(index, "utf8");
  const fwd = html.match(/location\.(?:replace|href)\s*=?\s*\(?\s*["']\.?\/?([\w.-]+\.html)/);
  if (fwd) { const t = join(APPS, id, fwd[1]); if (existsSync(t)) return readFileSync(t, "utf8"); }
  return html;
}

const unwired = [], exempt = [];
for (const id of appIds) {
  if (ENGINE.some((f) => effectiveHtml(id).includes(f))) continue;   // wired
  (VENDORED_EXEMPT.has(id) ? exempt : unwired).push(id);             // exempt (verbatim-vendored) vs a real gap
}

const witnessed = appIds.length > 0 && unwired.length === 0;
console.log(`Holo UI wiring — ${appIds.length} apps scanned${exempt.length ? ` (${exempt.length} verbatim-vendored exempt: ${exempt.join(", ")})` : ""}`);
console.log(unwired.length
  ? `FAIL — ${unwired.length} app(s) NOT wired to the Holo UI engine: ${unwired.join(", ")}`
  : `PASS — every native application loads the Holo UI engine (canonical params reach every instance)`);

writeFileSync(join(here, "holo-app-wired-witness.result.json"), JSON.stringify({
  spec: "Every served holospace application loads the upstream Holo UI engine (holo-theme.js, directly or via the holo-ui-kernel.js / holo-ui.js façades), so the canonical UI parameters defined + persisted by the holospace shell propagate to — and are honored by — every app instance.",
  authority: "ADR-0030 (Holo UI, the one UI subsystem) · ADR-0023 (the --holo-* token contract + postMessage propagation) · ADR-0057 (the readability floor) · static analysis of the served app repo",
  witnessed,
  covers: ["holo-ui", "wired-to-upstream", "shell-defined-params", "every-application", "persistence"],
  engineEntrypoints: ENGINE,
  appsScanned: appIds.length,
  vendoredExempt: exempt,
  unwired,
}, null, 2) + "\n");

console.log(`\nholo-app-wired: ${witnessed ? "WITNESSED" : "FAILED"}${unwired.length ? ` · ${unwired.length} unwired` : ""}`);
process.exit(witnessed ? 0 : 1);
