#!/usr/bin/env node
// burndown-app-radius.mjs — adopt the canonical SHAPE tokens without changing a single pixel. The OS
// radius scale is --holo-radius-sm 8px · --holo-radius 12px · --holo-radius-lg 16px (holo-mobile.css).
// An app that hardcodes one of those EXACT single-value radii is routed to the matching token with the
// same px as the fallback — so it looks identical today, but now follows the canonical shape language
// (and any future radius change) instead of being frozen. Non-exact radii (6/9/10/14px), pills (999px)
// and percentages are left untouched (no canonical token to adopt). Idempotent.
//
//   node tools/burndown-app-radius.mjs <app-id> [<app-id> …] [--check]

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const APPS = process.env.HOLO_APPS_DIR || "C:/Users/pavel/Desktop/Hologram Apps/apps";
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const ids = args.filter((a) => a !== "--check");
if (!ids.length) { console.error("usage: node tools/burndown-app-radius.mjs <app-id> [<app-id> …] [--check]"); process.exit(2); }

const TOKEN = { 8: "var(--holo-radius-sm, 8px)", 12: "var(--holo-radius, 12px)", 16: "var(--holo-radius-lg, 16px)" };
// single-value border-radius equal to 8/12/16px (terminated by ; } " or ' so multi-value shorthands are skipped).
const RX = /border-radius:\s*(8|12|16)px(?=\s*[;}"'])/g;

let grand = 0;
for (const id of ids) {
  const file = join(APPS, id, "index.html");
  try { if (!statSync(file).isFile()) throw 0; } catch { console.log(`  ⚠ ${id}: no index.html`); continue; }
  let n = 0;
  const out = readFileSync(file, "utf8").replace(RX, (m, px) => { n++; return `border-radius: ${TOKEN[px]}`; });
  grand += n;
  console.log(`  ${checkOnly ? "would adopt" : "adopted"} ${String(n).padStart(3)} exact-match radii → token   ·   ${id}`);
  if (!checkOnly && n) writeFileSync(file, out);
}
console.log(`\n${grand} exact-match border-radius ${checkOnly ? "would be" : ""} routed to the canonical shape tokens across ${ids.length} app(s)${checkOnly ? " (check only)" : ""}`);
process.exit(0);
