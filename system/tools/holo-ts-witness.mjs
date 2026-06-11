#!/usr/bin/env node
// holo-ts-witness.mjs — the ADR-0056 power ceiling: the REAL TypeScript language service (the TS compiler,
// the editor's #1 language server) runs entirely in the browser in a Web Worker, no server. Boots the
// workspace in real Chromium, opens a .ts file, and proves Monaco's TypeScript worker delivers genuine
// CROSS-FILE TYPE INFERENCE (a real type error is reported) and IntelliSense (completions) — all in-tab.
//
// Browser witness (committed result, like audit-apps/boot). Run:  node tools/holo-ts-witness.mjs
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
  writeFileSync(join(here, "holo-ts-witness.result.json"),
    JSON.stringify({ witnessed, covers: Object.keys(checks).filter((k) => checks[k]), checks, note: note || "", server: "TypeScript (Monaco worker)" }, null, 2) + "\n");
  console.log(Object.entries(checks).map(([k, v]) => `  ${v ? "✓" : "✗"} ${k}`).join("\n"));
  console.log(witnessed ? "\nPASS — Holo TS: the real TypeScript language service runs in-tab (type inference + IntelliSense), serverless" : "\nFAIL — " + (note || ""));
};

const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { console.log("playwright unavailable:", e.message); result(false, "playwright unavailable"); close(); process.exit(0); }

const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 720 } })).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
  await page.goto(`${base}/holospace.html?app=${APP}&bare=1&sw=0`, { waitUntil: "domcontentloaded", timeout: 25000 });
  let wf = null;
  for (let i = 0; i < 60 && !wf; i++) { for (const f of page.frames()) if (await f.evaluate(() => !!document.getElementById("activitybar")).catch(() => false)) { wf = f; break; } if (!wf) await sleep(300); }
  for (let i = 0; i < 80; i++) { if (await wf.evaluate(() => !!(window.__editor && window.monaco)).catch(() => false)) break; await sleep(300); }

  // the TS contribution is bundled in editor.main → the namespace exists even before the worker
  checks["ts-service-registered"] = await wf.evaluate(() => !!(window.monaco.languages.typescript && window.monaco.languages.typescript.getTypeScriptWorker)).catch(() => false);

  // open app.ts → creates the model → boots the 5.7 MB tsWorker
  await wf.evaluate(() => { const el = [...document.querySelectorAll("#files .file")].find((e) => /app\.ts/.test(e.textContent)); if (el) el.querySelector(".fn").click(); });

  // poll the TS worker for semantic diagnostics + completions (worker load takes a moment)
  let out = {};
  for (let i = 0; i < 30; i++) {
    out = await wf.evaluate(async () => {
      try {
        const T = window.monaco.languages.typescript; const model = window.__editor.getModel();
        if (!T || !model) return { ready: false };
        const getW = await T.getTypeScriptWorker(); const client = await getW(model.uri); const uri = model.uri.toString();
        const v = model.getValue();
        const sem = await client.getSemanticDiagnostics(uri);
        const comp = await client.getCompletionsAtPosition(uri, v.lastIndexOf("count")); // expression position
        const qi = await client.getQuickInfoAtPosition(uri, v.indexOf("greeting") + 2);  // hover the typed symbol
        const msgs = (sem || []).map((d) => typeof d.messageText === "string" ? d.messageText : (d.messageText && d.messageText.messageText) || "");
        const hover = qi && qi.displayParts ? qi.displayParts.map((p) => p.text).join("") : "";
        return { ready: true, semCount: (sem || []).length, msgs, compCount: comp && comp.entries ? comp.entries.length : 0, hover };
      } catch (e) { return { ready: false, err: String(e).slice(0, 120) }; }
    }).catch((e) => ({ ready: false, err: String(e) }));
    if (out.ready && out.semCount >= 1 && (out.compCount > 0 || /string/.test(out.hover || ""))) break;
    await sleep(500);
  }
  console.log("typescript:", JSON.stringify(out));

  checks["ts-worker-runs"] = out.ready === true;
  checks["cross-file-type-inference"] = (out.semCount || 0) >= 1 && (out.msgs || []).some((m) => /not assignable/i.test(m));
  checks["intellisense"] = (out.compCount || 0) > 0 || /string/.test(out.hover || "");

  const witnessed = Object.values(checks).every(Boolean);
  result(witnessed, witnessed ? "" : "out: " + JSON.stringify(out) + " errs: " + errs.slice(0, 3).join(" | "));
  close(); await browser.close();
  process.exit(witnessed ? 0 : 1);
} catch (e) {
  result(false, "exception: " + (e.message || e));
  try { close(); await browser.close(); } catch {}
  process.exit(1);
}
