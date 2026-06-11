#!/usr/bin/env node
// audit-apps.mjs — boot EVERY app in the OS holospace frame and capture, per app, exactly what it
// pulls from the original os/ (the fallback set) + anything missing + console errors + a screenshot.
// This scopes the "make every app 100% self-contained" work precisely, app by app. Read-only.
//
//   node tools/audit-apps.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer, ORIG, APPS as APPSDIR } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// catalog-driven: audit every app the catalog lists (dir, identifier).
const catalog = JSON.parse(readFileSync(join(APPSDIR, "apps/index.jsonld"), "utf8"));
const APPS = (catalog["dcat:dataset"] || []).map((d) => [d["dcat:landingPage"].split("/")[1], d["schema:identifier"]]);

const { port, stats, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { console.log("playwright unavailable:", e.message); close(); process.exit(0); }

const browser = await chromium.launch();
const rows = [];
for (const [id, identifier] of APPS) {
  stats.orig.clear(); stats.miss.clear(); stats.os2 = 0; stats.apps = 0;
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e)));
  let frameSrc = null;
  try {
    await page.goto(`${base}/holospace.html?app=${identifier}&bare=1&sw=0`, { waitUntil: "domcontentloaded", timeout: 20000 });
    for (let i = 0; i < 16 && !frameSrc; i++) { frameSrc = await page.evaluate(() => { const f = document.querySelector("#frame"); return f && f.getAttribute("src"); }).catch(() => null); if (!frameSrc) await sleep(250); }
    await sleep(3500);
    await page.screenshot({ path: join(here, `audit-${id}.png`) });
  } catch (e) { errs.push("GOTO: " + (e.message || e)); }
  const fallbacks = [...stats.orig].sort(), missing = [...stats.miss].sort();
  rows.push({ id, mounted: !!frameSrc, fromOS2: stats.os2, fromApps: stats.apps, fallbacks: fallbacks.length, missing: missing.length, errs: errs.length, fallbackList: fallbacks, missingList: missing });
  const flag = fallbacks.length === 0 && missing.length === 0 ? "✓ self-contained" : `${fallbacks.length} fallback · ${missing.length} missing`;
  console.log(`${id.padEnd(11)} mount:${frameSrc ? "y" : "n"}  os2:${String(stats.os2).padStart(3)} apps:${String(stats.apps).padStart(3)}  ${flag}  err:${errs.length}`);
  if (fallbacks.length) console.log(`            ↳ ${fallbacks.slice(0, 10).join(", ")}${fallbacks.length > 10 ? ` …+${fallbacks.length - 10}` : ""}`);
  await ctx.close();
}
await browser.close(); close();
writeFileSync(join(here, "audit-apps.result.json"), JSON.stringify({ apps: rows }, null, 2) + "\n");
const clean = rows.filter((r) => r.fallbacks === 0 && r.missing === 0).length;
console.log(`\n${clean}/${rows.length} apps already 100% self-contained · audit → tools/audit-apps.result.json + audit-<id>.png`);
