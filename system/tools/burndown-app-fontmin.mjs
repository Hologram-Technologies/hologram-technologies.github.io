#!/usr/bin/env node
// burndown-app-fontmin.mjs — burn down an app's Holo UI floor baseline (ADR-0057) by routing every
// sub-floor px `font-size` in its authored shell to the canonical token `var(--holo-text-sm, 1rem)`,
// which clamps up to --holo-font-min (the readability floor) and tracks the user's setting. This is
// the per-app burn-down the ratchet witness (holo-app-ui-conformance-witness.mjs) measures: after
// running it, re-seal the baseline with `--update-baseline` and the app's ceiling drops.
//
// Only the `font-size` PROPERTY in px below the floor is rewritten (the `font:` shorthand and
// already-≥16px / token / rem values are left alone). Idempotent. After editing, relock the app
// (relock-app.mjs) so its holospace.lock.json κ matches the new bytes.
//
//   node tools/burndown-app-fontmin.mjs <app-id> [<app-id> …] [--check]

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FLOOR = 16;
const APPS = process.env.HOLO_APPS_DIR || "C:/Users/pavel/Desktop/Hologram Apps/apps";
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const ids = args.filter((a) => a !== "--check");
if (!ids.length) { console.error("usage: node tools/burndown-app-fontmin.mjs <app-id> [<app-id> …] [--check]"); process.exit(2); }

const TOKEN = "var(--holo-text-sm, 1rem)";
let grand = 0;
for (const id of ids) {
  const file = join(APPS, id, "index.html");
  try { if (!statSync(file).isFile()) throw 0; } catch { console.log(`  ⚠ ${id}: no index.html`); continue; }
  const src = readFileSync(file, "utf8");
  let n = 0;
  // 1) the font-size property; 2) the size inside a `font:` shorthand (the only px before the
  //    family / `/line-height`; weight/style carry no px). Both routed to the floor token.
  let out = src.replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, (m, num) => {
    if (parseFloat(num) >= FLOOR) return m;          // ≥ floor → leave
    n++; return `font-size: ${TOKEN}`;
  });
  out = out.replace(/(\bfont:\s*[^;{}"'/]*?)(\d+(?:\.\d+)?)px/g, (m, pre, num) => {
    if (parseFloat(num) >= FLOOR) return m;          // ≥ floor → leave
    n++; return pre + TOKEN;                          // keep weight/style + the trailing /lh & family
  });
  grand += n;
  console.log(`  ${checkOnly ? "would tokenize" : "tokenized"} ${String(n).padStart(3)} sub-${FLOOR}px font-size → ${TOKEN}   ·   ${id}`);
  if (!checkOnly && n) writeFileSync(file, out);
}
console.log(`\n${grand} declaration(s) ${checkOnly ? "would be" : ""} routed to the floor token across ${ids.length} app(s)${checkOnly ? " (check only)" : ""}`);
process.exit(0);
