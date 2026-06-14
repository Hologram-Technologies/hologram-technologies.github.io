#!/usr/bin/env node
// qvac-render.mjs — PROVE the QVAC SDK Playground renders + runs in a REAL browser. Starts the κ-route
// serving layer, drives Chromium (Playwright, the project's render recipe): load /apps/qvac/index.html,
// assert the app boots on the Holo Runtime and is content-addressed (a holo:// build κ), DRIVE the live
// chat to get a streamed answer + a re-derivable receipt, flip to Code mode (real Monaco), and confirm
// describe-mode reactivity. Captures a screenshot as visual proof.
//
//   node tools/qvac-render.mjs

import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rec = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); return ok; };
const waitFor = async (page, fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await page.evaluate(fn)) return true; } catch (e) {} await sleep(200); } return false; };

const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
console.log(`OS serving at ${base}\n`);

let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { console.log("playwright not available: " + e.message); close(); process.exit(2); }

let pass = true;
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1340, height: 850 } })).newPage();
  const errs = [], got404 = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("response", (r) => { if (r.status() === 404) got404.push(r.url()); });

  const resp = await page.goto(`${base}/apps/qvac/index.html`, { waitUntil: "load", timeout: 30000 });
  pass = rec("index.html loads", !!resp && resp.status() === 200, `HTTP ${resp && resp.status()}`) && pass;

  // 1 · boots on the Holo Runtime + the app is content-addressed (a holo:// build κ in the status bar)
  const booted = await waitFor(page, () => /holo:\/\/[0-9a-f]{12}/.test((document.querySelector("#f-build") || {}).textContent || ""));
  const buildK = await page.evaluate(() => (document.querySelector("#f-build") || {}).textContent || "");
  pass = rec("boots on the Holo Runtime + the app is content-addressed (holo:// κ, Law L5)", booted, buildK) && pass;

  // 2 · the default 'Describe' chat runs LIVE on the Holo Runtime → a streamed answer + a sealed receipt
  await page.fill("#chatin", "hello");
  await page.click("#chatsend");
  const answered = await waitFor(page, () => { const b = document.querySelectorAll(".bubble.ai"); return b.length >= 1 && b[b.length - 1].textContent.trim().length > 1; });
  const receipted = await waitFor(page, () => /did:holo:sha256:[0-9a-f]{64}/.test((document.querySelector("#f-rcpt") || {}).textContent || ""));
  pass = rec("the live app answers in-page (streamed) and seals a re-derivable receipt (Law L5)", answered && receipted) && pass;

  // 3 · Describe reactivity — plain words switch the whole app live (chat → classifier)
  await page.fill("#desc", "sort feedback into bug, feature, praise");
  const becameClassifier = await waitFor(page, () => ((document.querySelector("#built-t") || {}).textContent || "").includes("classifier") && !!document.querySelector("#sin"));
  pass = rec("describe-mode reactivity — plain words rebuild the app live (chat → classifier)", becameClassifier) && pass;

  // 4 · Code mode brings up the REAL VS Code editor (Monaco) on demand
  await page.click("#m-code");
  const monaco = await waitFor(page, () => !!(window.monaco && document.querySelector("#editor .monaco-editor")));
  pass = rec("Code mode opens the real VS Code editor (Monaco), lazily", monaco) && pass;

  // 5 · only benign Monaco on-demand 404s; no fatal JS errors
  const badMiss = [...new Set(got404)].filter((u) => !/vendor\/monaco\//.test(u));
  pass = rec("no app-logic 404s (only optional Monaco on-demand assets)", badMiss.length === 0, badMiss.join(", ")) && pass;
  const fatal = errs.filter((e) => !/worker|sourcemap|favicon|Failed to load resource|\[object Event\]/i.test(e));
  pass = rec("no fatal JS errors", fatal.length === 0, fatal.slice(0, 2).join(" | ")) && pass;

  await page.click("#m-describe").catch(() => {});
  await sleep(400);
  const shot = join(here, "qvac-render.png");
  await page.screenshot({ path: shot, fullPage: false });
  console.log(`\nscreenshot → ${shot}`);
  if (got404.length) console.log("404s:", [...new Set(got404)].map((u) => u.replace(base, "")).slice(0, 6));
} finally { await browser.close(); close(); }

console.log(`\nqvac-render: ${pass ? "RENDERED ✓" : "FAILED"}`);
process.exit(pass ? 0 : 1);
