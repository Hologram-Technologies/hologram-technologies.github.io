#!/usr/bin/env node
// holo-app-token-witness.mjs — extend Holo UI conformance from TEXT SIZE to the other themeable
// parameters: COLOR and SHAPE. The canonical palette (`--holo-bg/-surface/-ink/-accent/…`) and radius
// (`--holo-radius-sm/-/-lg`) tokens are the single source; a hardcoded hex color or px border-radius
// in an app's authored shell BYPASSES them (it can't follow the OS palette or a theme change).
//
// Unlike the text floor, color is IDENTITY: apps + the faithful reproductions (MetaMask wallet, VS
// Code workspace, …) legitimately keep their own colors (the ADOPT-vs-OWN model, ADR-0023). So this is
// a no-regression RATCHET, not a forced rewrite: it counts each app's hardcoded themeable bypasses and
// FAILS only if an app gains MORE than its committed baseline. The corpus can only get MORE token-
// conformant; new code is pushed toward the tokens; burning a surface down (adopting tokens, or — for
// radius — the safe exact-match tokenization in burndown-app-radius.mjs) only ever passes. Read-only.
//
//   node tools/holo-app-token-witness.mjs                    # enforce against the baseline
//   node tools/holo-app-token-witness.mjs --update-baseline  # re-seal the baseline to current
//
// Scope: each app's authored index.html in the served app repo (Hologram Apps). Override: HOLO_APPS_DIR.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APPS = process.env.HOLO_APPS_DIR || join(here, "../../../holo-apps/apps");
const BASELINE = join(here, "holo-app-token-baseline.json");
const update = process.argv.includes("--update-baseline");

const HEX = /#[0-9a-fA-F]{3,8}\b/g;                    // a hardcoded hex color (bypasses the palette tokens)
const RADIUS_PX = /border-radius:\s*\d+(?:\.\d+)?px/g; // a hardcoded px corner radius (bypasses the radius tokens)

const appIds = existsSync(APPS)
  ? readdirSync(APPS).filter((n) => { try { return statSync(join(APPS, n, "index.html")).isFile(); } catch { return false; } })
  : [];

const counts = {};
for (const id of appIds) {
  const src = readFileSync(join(APPS, id, "index.html"), "utf8");
  const hex = (src.match(HEX) || []).length;
  const radius = (src.match(RADIUS_PX) || []).length;
  if (hex + radius > 0) counts[id] = { hex, radius, bypass: hex + radius };
}
const total = Object.values(counts).reduce((a, c) => a + c.bypass, 0);

if (update) {
  const ceilings = Object.fromEntries(Object.entries(counts).map(([id, c]) => [id, c.bypass]));
  writeFileSync(BASELINE, JSON.stringify({
    note: "Ratchet baseline for Holo UI COLOR + SHAPE token conformance (ADR-0057). 'ceilings' is the max hardcoded themeable bypasses (hex colors + px border-radius) allowed per app's authored index.html; the witness FAILS on any increase. Colors are IDENTITY (the adopt-vs-own model) so they are not force-rewritten — the ratchet just prevents NEW bypasses; radius exact-matches (8/12/16px) are safely tokenizable via burndown-app-radius.mjs. New apps default to 0.",
    total, perApp: counts, ceilings,
  }, null, 2) + "\n");
  console.log(`token baseline sealed → ${BASELINE}  (${total} hardcoded bypasses across ${Object.keys(counts).length} apps)`);
  process.exit(0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { ceilings: {} };
const ceil = base.ceilings || {};
const regressions = [], improvements = [];
for (const id of appIds) {
  const now = counts[id]?.bypass || 0, was = ceil[id] || 0;
  if (now > was) regressions.push({ app: id, was, now, added: now - was, detail: counts[id] });
  else if (now < was) improvements.push({ app: id, was, now });
}

const witnessed = regressions.length === 0;
console.log(`Holo UI color+shape conformance — ${appIds.length} apps · ${total} hardcoded bypasses baselined (hex + px radius)`);
if (regressions.length) { console.log(`\nFAIL — new hardcoded themeable value(s) that bypass the canonical tokens:`); for (const r of regressions) console.log(`  ✗ ${r.app}: ${r.was} → ${r.now} (+${r.added}; hex ${r.detail.hex} · radius-px ${r.detail.radius})`); }
else console.log(`PASS — no app added a hardcoded color/radius that bypasses the Holo UI tokens`);
if (improvements.length) console.log(`\n↓ improved (re-seal with --update-baseline): ${improvements.map((i) => `${i.app} ${i.was}→${i.now}`).join(", ")}`);

writeFileSync(join(here, "holo-app-token-witness.result.json"), JSON.stringify({
  spec: "Holo UI color + shape conformance is ratcheted across every served app: no app may add a hardcoded hex color or px border-radius that bypasses the canonical --holo-* palette/radius tokens beyond its committed baseline. Color is identity (adopt-vs-own), so existing values are not force-rewritten — the ratchet prevents regression and drives new code to the tokens.",
  authority: "ADR-0030 (Holo UI) · ADR-0023 (the --holo-* token contract + adopt-vs-own) · ADR-0057 · the 'betterer' no-new-violations ratchet · static analysis of the served app repo",
  witnessed,
  covers: ["holo-ui", "color-tokens", "radius-tokens", "every-application", "ratchet", "adopt-vs-own"],
  appsScanned: appIds.length, baselinedTotal: total,
  regressions, improvements,
}, null, 2) + "\n");

console.log(`\nholo-app-token: ${witnessed ? "WITNESSED" : "FAILED"}${regressions.length ? ` · ${regressions.length} app(s) regressed` : ""}`);
process.exit(witnessed ? 0 : 1);
