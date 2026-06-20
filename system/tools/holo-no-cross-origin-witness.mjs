#!/usr/bin/env node
// holo-no-cross-origin-witness.mjs — G3 (Law L4/L5 / SEC-1) witness for the BOOT/SHELL path.
//
// THE HOLE: the κ-verifying delivery worker (holo-fhs-sw.js) early-returns on cross-origin requests
//   (`if (url.origin !== self.location.origin) return;`), so ANY cross-origin <script src> or ESM
//   `import … from "https://…"` / `import("https://…")` runs with ZERO re-derivation — code executes
//   outside the κ-substrate. That is tolerable inside an individual app (it only runs when the user
//   opens that app, and the app-level KAPPA-1 witness already gates first-party app pages). It is NOT
//   tolerable in the BOOT/SHELL path, which runs at OS boot for every session.
//
// THIS WITNESS asserts ZERO cross-origin executable-code loads in the boot/shell HTML files. It greps
// for the three executable forms only (cross-origin <script src>, static `import … from "https://"`,
// dynamic `import("https://")`). It IGNORES same-origin/relative loads, <link>/CSS, data fetches
// (fetch/XHR — those are governed by Law L4, not by this gate), and comments/strings that merely name a
// URL without loading it (we strip /* */ and // comments before matching so the in-code rationale that
// describes the closed hole does not re-trip the witness).
//
// App-level offenders are listed SEPARATELY and do NOT fail this witness (see holo-kappa1-extern-witness
// for the app gate, and the inventory-with-plan in the G3 report for the un-vendorable bundles).
//
//   node tools/holo-no-cross-origin-witness.mjs           # boot/shell must be clean → exit 0/1
//   node tools/holo-no-cross-origin-witness.mjs --apps    # also print the app-level inventory (never fails)
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const APPS = process.env.HOLO_APPS_REPO || join(here, "../../../holo-apps");
const showApps = process.argv.includes("--apps");

// The BOOT/SHELL path — pages that execute at OS boot, before/around the desktop, for every session.
const BOOT = [
  { rel: "index.html", file: join(OS, "index.html") },
  { rel: "boot/boot.html", file: join(OS, "boot/boot.html") },
  { rel: "splash.html", file: join(OS, "usr/share/frame/splash.html") },
  { rel: "login.html", file: join(OS, "usr/share/frame/login.html") },
  { rel: "home-screen.html", file: join(OS, "usr/share/frame/home-screen.html") },
  { rel: "shell.html", file: join(OS, "usr/share/frame/shell.html") },
];

// Strip JS line/block comments so a URL named in prose (the rationale for a CLOSED hole) is not counted
// as a load. Conservative: it can over-strip inside string literals, but a real cross-origin import is
// NOT a bare string — it is `import(...)` / `from "..."` / `<script src=...>`, which survive stripping
// of the URL only if it sits in executable position. We strip comments, then match the load FORMS.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

// EXECUTABLE cross-origin code-load forms only.
const PATTERNS = [
  { kind: "script-src", re: /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']+/gi },
  { kind: "esm-import", re: /\bimport\b[^;'"(]*?\bfrom\s*["']https?:\/\/[^"']+/gi },
  { kind: "dyn-import", re: /\bimport\s*\(\s*["']https?:\/\/[^"']+/gi },
  { kind: "importScripts", re: /\bimportScripts\s*\(\s*["']https?:\/\/[^"']+/gi },
];
const urlOf = (m) => (m.match(/https?:\/\/[^"')]+/) || [""])[0];

function scan(file) {
  if (!existsSync(file)) return { missing: true, hits: [] };
  const raw = readFileSync(file, "utf8");
  const txt = stripComments(raw);
  const hits = [];
  for (const p of PATTERNS) for (const m of txt.matchAll(p.re)) hits.push({ kind: p.kind, url: urlOf(m[0]) });
  return { missing: false, hits };
}

console.log("G3 — cross-origin executable-code loads in the BOOT/SHELL path (must be ZERO):\n");
let fail = 0, scanned = 0;
for (const t of BOOT) {
  const { missing, hits } = scan(t.file);
  if (missing) { console.log(`  ?  ${t.rel} — not found, skipped`); continue; }
  scanned++;
  if (!hits.length) { console.log(`  ✓ ${t.rel}`); continue; }
  fail += hits.length;
  console.log(`  ✗ ${t.rel}  (${hits.length})`);
  for (const h of hits) console.log(`        ${h.kind}  →  ${h.url.slice(0, 80)}`);
}

// App-level inventory — informational, NEVER fails this witness.
if (showApps) {
  const ROOT = join(APPS, "apps");
  const walk = (d, out = []) => { for (const n of readdirSync(d)) { const p = join(d, n); if (n === "node_modules") continue; statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };
  const isBundle = (rel) => /(^|\/)(extensions|build|dist|node_modules)\//.test(rel) || /\.min\.(js|mjs)$/.test(rel) || /\.[0-9a-f]{8,}\.js$/.test(rel);
  const appHits = {};
  if (existsSync(ROOT)) for (const app of readdirSync(ROOT)) {
    const dir = join(ROOT, app); if (app === "tauri" || !statSync(dir).isDirectory()) continue;
    for (const abs of walk(dir)) {
      if (![".html", ".htm", ".js", ".mjs"].includes(extname(abs).toLowerCase())) continue;
      const rel = relative(ROOT, abs).split("\\").join("/");
      let txt; try { txt = readFileSync(abs, "utf8"); } catch { continue; }
      const t = stripComments(txt); let n = 0;
      for (const p of PATTERNS) n += [...t.matchAll(p.re)].length;
      if (n) (appHits[app] ||= { first: 0, bundle: 0 })[isBundle(rel) ? "bundle" : "first"] += n;
    }
  }
  const apps = Object.keys(appHits).sort();
  console.log(`\n  ── app-level inventory (informational, does NOT fail this gate) ──`);
  if (!apps.length) console.log("     (no app-level cross-origin code loads found)");
  for (const a of apps) console.log(`     ${a}: first-party=${appHits[a].first}  third-party-bundle=${appHits[a].bundle}`);
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${fail} cross-origin code load(s) across ${scanned} boot/shell page(s)`);
process.exit(fail === 0 ? 0 : 1);
