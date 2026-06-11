// _probe-gpu-physics.mjs — trace the GPU tier's budget step by step to find the runaway
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";
const { port, close } = await startServer();
const require = createRequire(pathToFileURL(join(ORIG, "package.json")));
const { chromium } = require("playwright");
const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-webgpu"] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
const seen = new Set();
page.on("console", (m) => { const t = `[${m.type()}] ` + m.text().slice(0, 240);
  if (!seen.has(t)) { seen.add(t); console.log(t); } });
await page.goto(`http://127.0.0.1:${port}/apps/atlas96/resonator.html`, { waitUntil: "domcontentloaded" });
for (let i = 0; i < 90; i++) { if (await page.evaluate(() => !!(window.__resonator && window.__resonator.ready)).catch(() => false)) break; await new Promise((r) => setTimeout(r, 500)); }
console.log("tier:", await page.evaluate(() => window.__resonator.tier));
const trace = await page.evaluate(async () => {
  const R = window.__resonator, out = [];
  R.pause(true);                                            // freeze the rAF loop — clean experiment
  out.push({ at: "idle", pos: await R.readPos() });
  for (const n of [1, 1, 2, 4, 8, 16, 32, 64, 128, 256]) {
    const b = await R.step(n);
    out.push({ after: n, budget: +b.toFixed(3), pos: await R.readPos() });
  }
  R.pause(false);
  return out;
});
for (const t of trace) console.log(JSON.stringify(t));
await page.screenshot({ path: "tools/_probe-gpu.png" });
await browser.close(); close();
