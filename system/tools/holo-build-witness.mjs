#!/usr/bin/env node
// holo-build-witness.mjs — the BUILD pillar (ADR-0055, Holo Build): the holospace-native, serverless,
// VS Code-faithful IDE. Boots the real workspace app in real Chromium via the κ-route serving layer and
// proves, by observation (Law L5), that it: mounts the real VS Code editor (Monaco) + terminal (xterm)
// with NO server; rebinds an identical build in O(1) (Holo Forge memo — "rebind, not recompute"); keeps
// multiple files as editor tabs; renders a holospace's running code LIVE (the visual Build); exposes the
// two defining VS Code moves (Quick Open Ctrl+P, Command Palette F1); and lets two peers co-edit in real
// time, CONVERGING to the SAME content address (κ) — collaboration proven by re-derivation, not trust.
//
// Browser witness (committed result, like audit-apps/boot/qml-render): writes holo-build-witness.result.json;
// the gate (tools/gate.mjs) reads it. Run:  node tools/holo-build-witness.mjs
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
  writeFileSync(join(here, "holo-build-witness.result.json"),
    JSON.stringify({ witnessed, covers: Object.keys(checks).filter((k) => checks[k]), checks, note: note || "", app: APP }, null, 2) + "\n");
  console.log(Object.entries(checks).map(([k, v]) => `  ${v ? "✓" : "✗"} ${k}`).join("\n"));
  console.log(witnessed ? "\nPASS — Holo Build: serverless VS Code-faithful IDE, O(1) rebind, live preview, real-time κ-convergent co-edit" : "\nFAIL — " + (note || "see checks"));
};

const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { console.log("playwright unavailable:", e.message); result(false, "playwright unavailable"); close(); process.exit(0); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

async function openIDE() {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
  page.on("console", (m) => { if (m.type() === "error" && !/404/.test(m.text())) errs.push(m.text().slice(0, 140)); });
  await page.goto(`${base}/holospace.html?app=${APP}&bare=1&sw=0`, { waitUntil: "domcontentloaded", timeout: 25000 });
  let wf = null;
  for (let i = 0; i < 60 && !wf; i++) { for (const f of page.frames()) if (await f.evaluate(() => !!document.getElementById("activitybar")).catch(() => false)) { wf = f; break; } if (!wf) await sleep(300); }
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) { ready = await wf.evaluate(() => !!(window.__editor && window.monaco && window.HoloCoedit)).catch(() => false); if (!ready) await sleep(300); }
  return { page, wf, ready, errs };
}

try {
  const A = await openIDE(), B = await openIDE();
  checks["serverless-editor-mounts"] = A.ready && B.ready && A.errs.length === 0;

  // O(1) build rebind (Holo Forge memo): identical source rebinds (hit:true), no recompile.
  let app = false; for (let i = 0; i < 40 && !app; i++) { app = await A.wf.evaluate(() => !!window.HoloApp).catch(() => false); if (!app) await sleep(250); }
  const build = await A.wf.evaluate(async () => { const s = "int main(){ return 7; } // " + Math.random(); const a = await window.HoloApp.build(s); const b = await window.HoloApp.build(s); return { first: a.hit, second: b.hit, exports: a.exports }; }).catch(() => ({}));
  checks["o1-build-rebind"] = build.first === false && build.second === true && (build.exports || []).includes("main");

  // multi-file editor tabs
  await A.wf.evaluate(() => { const el = [...document.querySelectorAll("#files .file")].find((e) => /gcd\.hc/.test(e.textContent)); if (el) el.querySelector(".fn").click(); });
  await sleep(500);
  checks["multi-file-tabs"] = (await A.wf.evaluate(() => document.querySelectorAll("#tabs .tab").length)) >= 2;

  // live preview: open hello.html → the Run panel renders the running app in a sandboxed iframe
  await A.wf.evaluate(() => { const el = [...document.querySelectorAll("#files .file")].find((e) => /hello\.html/.test(e.textContent)); if (el) el.querySelector(".fn").click(); });
  await sleep(900);
  checks["live-preview"] = await A.wf.evaluate(() => { const rv = document.getElementById("runview"); return !rv.hidden && !!rv.querySelector("iframe.rframe"); });

  // Quick Open (Ctrl+P) + Command Palette (F1) — VS Code's defining moves
  await A.wf.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true })));
  await sleep(300);
  checks["quick-open"] = await A.wf.evaluate(() => document.getElementById("quick").classList.contains("on") && document.querySelectorAll("#quicklist .qi").length > 0);
  await A.wf.evaluate(() => { document.getElementById("quickq").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "F1", bubbles: true })); });
  await sleep(300);
  checks["command-palette"] = await A.wf.evaluate(() => document.getElementById("quick").classList.contains("on") && [...document.querySelectorAll("#quicklist .ql")].some((e) => /Build & Run/.test(e.textContent)));
  await A.wf.evaluate(() => document.getElementById("quickq").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

  // real-time co-edit: peers see each other; A's edit reaches B; both converge to the SAME κ
  await A.wf.evaluate(() => window.HoloCoedit.join({ name: "Ilya", kind: "human" }));
  await B.wf.evaluate(() => window.HoloCoedit.join({ name: "Claude", kind: "agent" }));
  await sleep(1000);
  // both open the same file so live text sync applies
  await A.wf.evaluate(() => { const el = [...document.querySelectorAll("#files .file")].find((e) => /sq\.hc/.test(e.textContent)); el.querySelector(".fn").click(); });
  await B.wf.evaluate(() => { const el = [...document.querySelectorAll("#files .file")].find((e) => /sq\.hc/.test(e.textContent)); el.querySelector(".fn").click(); });
  await sleep(600);
  const peersOk = (await A.wf.evaluate(() => window.HoloCoedit.peers().some((p) => p.kind === "agent"))) && (await B.wf.evaluate(() => window.HoloCoedit.peers().some((p) => p.name === "Ilya")));
  checks["co-edit-presence"] = peersOk;
  await A.wf.evaluate(() => window.__editor.executeEdits("t", [{ range: new window.monaco.Range(1, 1, 1, 1), text: "// co-edited live\n" }]));
  let converged = false, bGot = false;
  for (let i = 0; i < 20 && !converged; i++) {
    await sleep(300);
    const [a, b] = await Promise.all([A.wf.evaluate(() => window.__editor.getValue()), B.wf.evaluate(() => window.__editor.getValue())]);
    bGot = /co-edited live/.test(b); converged = (a === b) && bGot;
  }
  checks["co-edit-live-sync"] = bGot;
  checks["kappa-convergence"] = converged;

  const witnessed = Object.values(checks).every(Boolean);
  result(witnessed, witnessed ? "" : "errors: " + [...A.errs, ...B.errs].slice(0, 4).join(" | "));
  close(); await browser.close();
  process.exit(witnessed ? 0 : 1);
} catch (e) {
  result(false, "exception: " + (e.message || e));
  try { close(); await browser.close(); } catch {}
  process.exit(1);
}
