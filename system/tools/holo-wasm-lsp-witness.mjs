#!/usr/bin/env node
// holo-wasm-lsp-witness.mjs — the ADR-0056 ESCALATION, fulfilled: a REAL WASM language server (Biome,
// Rust→WebAssembly, vendored) runs entirely in the browser, off the main thread, with NO server. Boots
// the workspace in real Chromium and proves window.HoloBiome (the Biome worker) produces genuine lint
// DIAGNOSTICS and FORMATTING for JS/TS — the production Rust analyzer, content-addressed + serverless.
//
// Browser witness (committed result, like audit-apps/boot). Run:  node tools/holo-wasm-lsp-witness.mjs
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = "org.hologram.HoloWorkspace";
const checks = {};
const result = (witnessed, note) => {
  writeFileSync(join(here, "holo-wasm-lsp-witness.result.json"),
    JSON.stringify({ witnessed, covers: Object.keys(checks).filter((k) => checks[k]), checks, note: note || "", server: "Biome 1.9.4 (Rust→WASM)" }, null, 2) + "\n");
  console.log(Object.entries(checks).map(([k, v]) => `  ${v ? "✓" : "✗"} ${k}`).join("\n"));
  console.log(witnessed ? "\nPASS — Holo WASM-LSP: a real Rust→WASM language server (Biome) lints + formats in-tab, serverless" : "\nFAIL — " + (note || ""));
};

const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { console.log("playwright unavailable:", e.message); result(false, "playwright unavailable"); close(); process.exit(0); }

const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 720 } })).newPage();
  await page.goto(`${base}/holospace.html?app=${APP}&bare=1&sw=0`, { waitUntil: "domcontentloaded", timeout: 25000 });
  let wf = null;
  for (let i = 0; i < 60 && !wf; i++) { for (const f of page.frames()) if (await f.evaluate(() => !!document.getElementById("activitybar")).catch(() => false)) { wf = f; break; } if (!wf) await sleep(300); }
  for (let i = 0; i < 80; i++) { if (await wf.evaluate(() => !!(window.__editor && window.HoloBiome)).catch(() => false)) break; await sleep(300); }

  // warm the 14 MB wasm (first request compiles + boots the Workspace) — generous wait
  const ping = await wf.evaluate(async () => { try { return await window.HoloBiome.request("ping", { text: "", path: "file.ts" }); } catch (e) { return "err:" + e; } }).catch((e) => "throw:" + e);
  console.log("biome boot:", JSON.stringify(ping));
  checks["wasm-server-boots"] = ping === "ok";

  const out = await wf.evaluate(async () => {
    const lintSrc = "var x = 1\nif (x == 2) { x = 3 }\n";
    const diags = await window.HoloBiome.request("diagnostics", { text: lintSrc, path: "file.ts" });
    const fmtSrc = "var  x=1\nfunction f( a ){return a}\n";
    const fmt = await window.HoloBiome.request("format", { text: fmtSrc, path: "file.ts" });
    return {
      diagCount: (diags || []).length,
      categories: (diags || []).map((d) => d.category).filter(Boolean),
      fmt: fmt,
      fmtChanged: typeof fmt === "string" && fmt !== fmtSrc && /;/.test(fmt),
    };
  }).catch((e) => ({ err: String(e) }));
  console.log("biome:", JSON.stringify(out));

  checks["real-lint-diagnostics"] = out.diagCount >= 1 && (out.categories || []).some((c) => /lint\//.test(c || ""));
  checks["real-formatting"] = out.fmtChanged === true;

  const witnessed = Object.values(checks).every(Boolean);
  result(witnessed, witnessed ? "" : "out: " + JSON.stringify(out));
  close(); await browser.close();
  process.exit(witnessed ? 0 : 1);
} catch (e) {
  result(false, "exception: " + (e.message || e));
  try { close(); await browser.close(); } catch {}
  process.exit(1);
}
