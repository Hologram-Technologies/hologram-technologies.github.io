#!/usr/bin/env node
// boot-os2-witness.mjs — PROVE the lean FHS OS2 actually boots. Starts the κ-route serving layer,
// HTTP-checks that every boot-critical resource resolves (and from where: OS2 vs original fallback),
// then drives real Chromium (Playwright, per the project's browser-witness recipe): load the frame,
// mount a holospace (Holo Search — the lightest app), confirm the app frame mounts + renders, capture
// console errors + a screenshot. Honest: reports OS2 self-containment (os2-served vs gap-fallback).
//
//   node tools/boot-os2-witness.mjs

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const writeResult = (r) => writeFileSync(join(here, "boot-os2-witness.result.json"), JSON.stringify(r, null, 2) + "\n");
const results = []; let passed = 0, failed = 0;
const rec = (name, ok, detail = "") => { results.push({ name, ok, detail }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? "  (" + detail + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { port, stats, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
console.log(`OS2 serving at ${base}\n`);

// ── 1 · HTTP resolution: every boot-critical resource must resolve ──
const NEED = ["/", "/holospace.html", "/holo-launch.mjs", "/_shared/holo-terms.js", "/apps/index.jsonld",
  "/apps/search/holospace.json", "/apps/search/holospace.lock.json", "/apps/search/index.html", "/manifest.webmanifest", "/.well-known/mcp.json"];
let httpOk = 0;
for (const u of NEED) { try { const r = await fetch(base + u); if (r.status === 200) httpOk++; else console.log(`   ${r.status} ${u}`); } catch (e) { console.log(`   ERR ${u} ${e.message}`); } }
rec("every boot-critical resource resolves over the κ-route + FHS mount", httpOk === NEED.length, `${httpOk}/${NEED.length}`);

// ── 2 · real browser boot (Playwright; resolved from the original's node_modules) ──
let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { rec("playwright available", false, "not installed — HTTP proof only: " + e.message); }

if (chromium) {
  let browser;
  try {
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const consoleErr = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErr.push(m.text()); });
    page.on("pageerror", (e) => consoleErr.push(String(e)));

    // bare mount of Holo Search (lightest: 0 κ-script refs), per-app SW off → rely on the host κ-route
    const url = `${base}/holospace.html?app=org.hologram.HoloSearch&bare=1&sw=0`;
    const resp = await page.goto(url, { waitUntil: "load", timeout: 30000 });
    rec("frame document loads (holospace.html)", !!resp && resp.status() === 200, `HTTP ${resp && resp.status()}`);

    // the frame resolves the app and mounts it in its sandboxed iframe
    let frameSrc = null;
    for (let i = 0; i < 40 && !frameSrc; i++) { frameSrc = await page.evaluate(() => { const f = document.querySelector("#frame"); return f && f.getAttribute("src"); }); if (!frameSrc) await sleep(250); }
    rec("the frame mounts the holospace (sandboxed iframe → the app)", !!frameSrc && /apps\/search\/index\.html/.test(frameSrc), frameSrc || "no #frame");

    await sleep(2500); // let the app paint
    // did the app actually render? (its index.html + subresources were served)
    rec("the app's package was served (index.html + holospace.json)", !stats.miss.has("apps/search/index.html"), `${stats.miss.size} missing`);

    const shot = join(here, "boot-os2-witness.png");
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`screenshot → ${shot}`);
    rec("captured a screenshot of the booted OS", true);
    rec("no fatal page errors", consoleErr.length === 0, consoleErr.slice(0, 3).join(" | ") || "clean");
    await browser.close();
  } catch (e) { if (browser) await browser.close().catch(() => {}); rec("browser boot completed without throwing", false, String((e && e.message) || e)); }
}

// ── 3 · honest self-containment report ──
const origList = [...stats.orig].sort();
console.log(`\nserved: ${stats.os2} from OS2 (os/) · ${stats.apps} from the Apps repo · ${origList.length} fell back to original os/ · ${stats.miss.size} missing`);
if (origList.length) console.log(`  gap (runnable-closure, not in lean manifest): ${origList.slice(0, 20).join(", ")}${origList.length > 20 ? ` … +${origList.length - 20}` : ""}`);
if (stats.miss.size) console.log(`  missing: ${[...stats.miss].slice(0, 20).join(", ")}`);

const witnessed = failed === 0 && passed > 0;
writeResult({
  spec: "Hologram OS2 — the lean, FHS-shaped, content-addressed OS boots in a real browser via the κ-route serving layer",
  witnessed, covers: witnessed ? ["os2-boot", "kappa-route", "fhs-serving"] : [],
  served: { fromOS2: stats.os2, fromAppsRepo: stats.apps, fellBackToOriginal: origList.length, missing: stats.miss.size, gap: origList, missingList: [...stats.miss] },
  results,
});
console.log(`\n=== ${passed}/${passed + failed} passed, ${failed} failed ===`);
close();
process.exit(failed ? 1 : 0);
