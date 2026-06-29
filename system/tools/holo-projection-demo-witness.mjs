#!/usr/bin/env node
// holo-projection-demo-witness.mjs — SMOKE proof that the live demo page (holo-projection-demo.html) loads,
// composes the substrate, and animates without error in a real browser: the full pipeline runs, frames
// advance, novelty is reported, and toggles (run-ahead / super-res) rebuild and keep running. Honest-skips if
// Playwright is absent.
//   node tools/holo-projection-demo-witness.mjs
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { createServer } from "node:http";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = join(here, "..", "os", "usr", "lib", "holo");
const write = (r) => writeFileSync(join(here, "holo-projection-demo-witness.result.json"), JSON.stringify(r, null, 2) + "\n");

let chromium;
try { ({ chromium } = await import("playwright")); }
catch (e) { console.log("• lane SKIPPED — playwright absent."); write({ spec: "projection demo smoke", witnessed: false, lane: "skipped", reason: "playwright absent" }); process.exit(0); }

const TYPES = { ".mjs": "text/javascript", ".js": "text/javascript", ".html": "text/html" };
const COI = { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" };
const server = createServer((req, res) => {
  const url = req.url.split("?")[0]; const rel = url === "/" ? "holo-projection-demo.html" : url.replace(/^\/+/, "");
  const f = join(libDir, rel); if (!existsSync(f)) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { ...COI, "content-type": TYPES[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
let result = { witnessed: false };
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__holoDemoReady === true, { timeout: 30000 });

  const fpsText = async () => page.$eval("#fps", (e) => e.textContent);
  await page.waitForFunction(() => { const t = document.getElementById("fps").textContent; return t && t !== "—" && +t > 0; }, { timeout: 30000 });
  const fps1 = await fpsText();
  const tiles = await page.$eval("#tiles", (e) => e.textContent);
  const novel = await page.$eval("#novel", (e) => e.textContent);

  // exercise the toggles: run-ahead cycle + super-res — they rebuild the pipeline; the page must keep animating
  await page.click("#bRunahead"); await page.click("#bSuperres");
  await page.waitForTimeout(800);
  const fps2 = await fpsText();
  const stillRunning = !!fps2 && +fps2 > 0;

  const checks = {
    loadedNoErrors: errors.length === 0,
    animates: !!fps1 && +fps1 > 0,
    noveltyReported: /KB/.test(novel) && /\/ 4/.test(tiles),
    togglesKeepRunning: stillRunning,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
  if (errors.length) console.log("  errors:", errors.slice(0, 3));
  console.log(`  (present FPS ${fps1} → ${fps2}; tiles ${tiles}; novelty ${novel})`);
  const witnessed = Object.values(checks).every(Boolean);
  result = { spec: "The live projection demo loads, composes the substrate (run-ahead → ingest → projector → present → reproject), animates a producer to a canvas, reports novelty per frame, and survives run-ahead/super-res toggles — a user-openable, any-device artifact.", authority: "Chromium (Playwright) real DOM/Canvas · the served substrate modules", witnessed, lane: "browser", metrics: { fps1, fps2, tiles, novel }, checks };
  write(result);
  console.log(`\nholo-projection-demo-witness: ${witnessed ? "WITNESSED ✓ the substrate runs live as an openable demo" : "NOT WITNESSED"}`);
} catch (e) { console.log("MEASUREMENT ERROR —", String((e && e.message) || e)); write({ spec: "projection demo smoke", witnessed: false, error: String((e && e.message) || e) }); }
finally { await browser.close(); server.close(); }
process.exit(result.witnessed ? 0 : 1);
