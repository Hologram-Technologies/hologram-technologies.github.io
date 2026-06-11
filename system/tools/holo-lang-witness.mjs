#!/usr/bin/env node
// holo-lang-witness.mjs — HOLO LANG (ADR-0056): language intelligence as a serverless, OFF-THREAD
// κ-object language service. Boots the workspace in real Chromium and proves window.HoloLang answers,
// from a Web Worker (off the main thread, no server), the language-server feature set Monaco consumes:
// document symbols/outline · find-references · signature help · document formatting. This is the
// language-server PATTERN a real WASM LSP (clangd/rust-analyzer) plugs into over the same transport.
//
// Browser witness (committed result, like audit-apps/boot). Run:  node tools/holo-lang-witness.mjs
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
  writeFileSync(join(here, "holo-lang-witness.result.json"),
    JSON.stringify({ witnessed, covers: Object.keys(checks).filter((k) => checks[k]), checks, note: note || "" }, null, 2) + "\n");
  console.log(Object.entries(checks).map(([k, v]) => `  ${v ? "✓" : "✗"} ${k}`).join("\n"));
  console.log(witnessed ? "\nPASS — Holo Lang: off-thread serverless language service (symbols · references · signature · format)" : "\nFAIL — " + (note || ""));
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
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) { ready = await wf.evaluate(() => !!(window.__editor && window.HoloLang)).catch(() => false); if (!ready) await sleep(300); }

  const out = await wf.evaluate(async () => {
    const T = "int sq(int x){ return x*x; }\nint fib(int n){ if(n<2) return n; return fib(n-1)+fib(n-2); }\nint main(){ return fib(10); }\n";
    const syms = await window.HoloLang.request("symbols", { text: T });
    const refs = await window.HoloLang.request("references", { text: T, offset: T.indexOf("fib") + 1 });
    const sig = await window.HoloLang.request("signature", { text: T, offset: T.indexOf("fib(n-1)") + 5 });
    const fmt = await window.HoloLang.request("format", { text: "int main(){\nreturn 1;\n}\n" });
    return {
      symNames: (syms || []).map((s) => s.name),
      refCount: (refs || []).length,
      sigLabel: sig && sig.label,
      fmtIndented: typeof fmt === "string" && /\n  return 1;/.test(fmt),
    };
  }).catch((e) => ({ err: String(e) }));
  console.log("lang:", JSON.stringify(out));

  checks["service-off-thread-worker"] = ready;
  checks["document-symbols"] = JSON.stringify(out.symNames) === JSON.stringify(["sq", "fib", "main"]);
  checks["find-references"] = out.refCount >= 3;
  checks["signature-help"] = /fib/.test(out.sigLabel || "");
  checks["document-formatting"] = out.fmtIndented === true;

  const witnessed = Object.values(checks).every(Boolean);
  result(witnessed, witnessed ? "" : "out: " + JSON.stringify(out));
  close(); await browser.close();
  process.exit(witnessed ? 0 : 1);
} catch (e) {
  result(false, "exception: " + (e.message || e));
  try { close(); await browser.close(); } catch {}
  process.exit(1);
}
