// _probe-webgpu.mjs — find the launch config that gives Playwright Chromium a WebGPU adapter
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { ORIG, startServer } from "./holo-serve-fhs.mjs";
const require = createRequire(pathToFileURL(join(ORIG, "package.json")));
const { chromium } = require("playwright");
const { port, close } = await startServer();
const URL = `http://127.0.0.1:${port}/apps/atlas96/icon.svg`;

const combos = [
  { name: "pw-chromium headless", opts: { args: ["--enable-unsafe-webgpu"] } },
  { name: "chrome headless", opts: { channel: "chrome", args: ["--enable-unsafe-webgpu"] } },
  { name: "chrome headless plain", opts: { channel: "chrome" } },
  { name: "chrome headed", opts: { channel: "chrome", headless: false } },
];
console.log("playwright chromium:", chromium.executablePath());
for (const c of combos) {
  let out = "launch failed";
  try {
    const b = await chromium.launch(c.opts);
    const p = await b.newPage();
    await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 15000 });
    out = await p.evaluate(async () => {
      if (!navigator.gpu) return "no navigator.gpu";
      const a = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }).catch((e) => null);
      if (!a) return "no adapter";
      const i = a.info || {};
      return "ADAPTER: " + [i.vendor, i.architecture, i.description].filter(Boolean).join(" · ");
    });
    await b.close();
  } catch (e) { out = "err: " + String(e.message || e).slice(0, 120); }
  console.log(`${c.name.padEnd(30)} ${out}`);
}
close();
