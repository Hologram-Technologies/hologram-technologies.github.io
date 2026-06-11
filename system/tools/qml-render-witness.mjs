#!/usr/bin/env node
// qml-render-witness.mjs — PROVE the greeter renders in a REAL browser. Starts the κ-route serving
// layer, HTTP-checks the login chain resolves, then drives real Chromium (Playwright, the project's
// browser-witness recipe): load /login.html, let Holo QML parse + execute the verbatim SDDM theme,
// and assert the LIVE DOM shows the real greeter — the welcomeText binding evaluated, a username
// field, a Login button — with no fatal console errors. Captures a screenshot as visual proof.
//
//   node tools/qml-render-witness.mjs

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const writeResult = (r) => writeFileSync(join(here, "qml-render-witness.result.json"), JSON.stringify(r, null, 2) + "\n");
const results = []; let passed = 0, failed = 0;
const rec = (name, ok, detail = "") => { results.push({ name, ok, detail }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? "  (" + detail + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
console.log(`OS serving at ${base}\n`);

// ── 1 · the login chain resolves over the κ-route ──
const NEED = ["/login.html", "/_shared/holo-qml.mjs", "/_shared/holo-sddm.js", "/_shared/holo-identity.mjs", "/etc/sddm.conf", "/usr/share/sddm/themes/maldives/Main.qml"];
let httpOk = 0;
for (const u of NEED) { try { const r = await fetch(base + u); if (r.status === 200) httpOk++; else console.log(`   ${r.status} ${u}`); } catch (e) { console.log(`   ERR ${u} ${e.message}`); } }
rec("login chain resolves (engine + theme + identity over the κ-route)", httpOk === NEED.length, `${httpOk}/${NEED.length}`);

// ── 2 · real browser render ──
let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { rec("playwright available", false, "not installed — HTTP proof only: " + e.message); }

let render = null;
if (chromium) {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const consoleErr = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErr.push(m.text()); });
    page.on("pageerror", (e) => consoleErr.push(String(e)));

    const resp = await page.goto(`${base}/login.html`, { waitUntil: "load", timeout: 30000 });
    rec("login.html loads", !!resp && resp.status() === 200, `HTTP ${resp && resp.status()}`);

    // wait for Holo QML to build the tree + the greeter to paint
    for (let i = 0; i < 40; i++) { const ready = await page.evaluate(() => !!(window.__holoQml && window.__holoQml.root)); if (ready) break; await sleep(200); }
    await sleep(800);

    render = await page.evaluate(() => {
      const eng = window.__holoQml;
      const txt = [...document.querySelectorAll('#stage [data-qml="Text"], #stage div')].map((e) => e.textContent || "").filter(Boolean);
      const welcome = txt.find((t) => /^Welcome to/.test(t.trim()));
      const buttons = [...document.querySelectorAll("#stage button")].map((b) => b.textContent.trim());
      return {
        engineRan: !!(eng && eng.root), rootType: eng && eng.root && eng.root.type,
        itemCount: eng ? (function c(i){ return 1 + (i.children||[]).reduce((n,k)=>n+c(k),0); })(eng.root) : 0,
        welcome: welcome || null,
        hasUsernameInput: !!document.querySelector("#stage input"),
        buttons,
      };
    });

    rec("Holo QML executed the theme (live object tree)", render.engineRan && render.rootType === "Rectangle" && render.itemCount >= 20, `root=${render.rootType} items=${render.itemCount}`);
    rec("the welcomeText property binding evaluated", !!render.welcome, render.welcome || "no welcome text in DOM");
    rec("the greeter rendered its real controls (username field + Login button)", render.hasUsernameInput && render.buttons.includes("Login"), `input=${render.hasUsernameInput} buttons=[${render.buttons.join(", ")}]`);

    const shot = join(here, "qml-render-witness.png");
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`screenshot → ${shot}`);
    rec("captured a screenshot of the rendered greeter", true);
    rec("no fatal page errors", consoleErr.length === 0, consoleErr.slice(0, 3).join(" | ") || "clean");
    await browser.close();
  } catch (e) { if (browser) await browser.close().catch(() => {}); rec("browser render completed without throwing", false, String((e && e.message) || e)); }
}

const witnessed = failed === 0 && passed > 0;
writeResult({
  spec: "Hologram OS display manager renders the real, verbatim upstream SDDM QML in a real browser",
  witnessed, covers: witnessed ? ["qml-render", "greeter-live", "sddm-theme"] : [],
  render, results,
});
console.log(`\n=== ${passed}/${passed + failed} passed, ${failed} failed ===`);
close();
process.exit(failed ? 1 : 0);
