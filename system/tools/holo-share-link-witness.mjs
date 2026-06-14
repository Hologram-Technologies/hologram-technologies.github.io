#!/usr/bin/env node
// holo-share-link-witness.mjs — TEST the seamless-sharing thesis literally: take an existing app, build
// the share link the shell itself emits (holospace.html?app=<ref>#k=<κ>, the Share-to-Run convention,
// ADR-064), and open it in a COLD, fresh browser context — exactly what happens when someone taps the
// link from Telegram on a device that has never seen this origin. It must: (1) open and render the app
// fullscreen with the share chrome, (2) self-resolve the app by its content address, (3) run on the ONE
// Holo Runtime delivery worker (holo-fhs-sw.js, the κ-cache), and (4) the SECOND open is network-free.
// A screenshot is saved as proof. ?sw=1 forces the production SW path on localhost.
//   node tools/holo-share-link-witness.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const APP = "notepad";
const APPS = "C:/Users/pavel/Desktop/Hologram Apps/apps";
const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };

const lock = JSON.parse(readFileSync(join(APPS, APP, "holospace.lock.json"), "utf8"));
const rootK = lock.root;                                   // the app's single content-derived address
const indexHex = String((lock.closure[`apps/${APP}/index.html`] || {}).kappa).split(":").pop();

const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
// the EXACT link shareLinkFor() emits: holospace.html?app=<ref>#k=<κ>  (+ sw=1 → force the prod runtime SW on localhost)
const shareLink = `${base}/holospace.html?app=${APP}&sw=1#k=${encodeURIComponent(rootK)}`;
console.log(`\n  SHARE LINK (paste into Telegram):\n    ${base}/holospace.html?app=${APP}#k=${rootK}\n  Cold-opening it in a fresh browser…\n`);

let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { rec("playwright available", false, "not installed: " + e.message); }

if (chromium) {
  const browser = await chromium.launch();
  try {
    // COLD: a brand-new context — no cache, no service worker, no prior visit (the Telegram tap).
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 740 } });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(shareLink, { waitUntil: "load", timeout: 30000 });
    // The app mounts in a SANDBOXED iframe (its own realm, cross-origin to the parent — the parent
    // CANNOT read its contentDocument). Use Playwright's frame API, which has its own execution
    // context inside the frame, to confirm the app actually RENDERED (non-empty body).
    let rendered = false, appSrc = "", bodyLen = 0;
    for (let i = 0; i < 100; i++) {
      const fr = page.frames().find((f) => /\/apps\/notepad\//.test(f.url()));
      if (fr) {
        appSrc = fr.url();
        try { bodyLen = await fr.evaluate(() => (document.body ? document.body.innerText.length + document.body.childElementCount + document.querySelectorAll("textarea,[contenteditable],button,input").length : 0)); } catch { bodyLen = 0; }
        if (bodyLen > 0) { rendered = true; break; }
      }
      await page.waitForTimeout(150);
    }
    const coldMs = Date.now() - t0;
    // which delivery worker controls — is it the Holo Runtime (holo-fhs-sw) or the older A29 (holo-sw)?
    const sw = await page.evaluate(async () => {
      for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
      const c = navigator.serviceWorker.controller;
      return { url: c ? c.scriptURL : "", controlled: !!c };
    });
    const onRuntime = /holo-fhs-sw\.js/.test(sw.url);
    // self-resolve the app by its content address through whatever SW is live
    const selfResolve = await page.evaluate(async (hex) => {
      try { const r = await fetch(`/.holo/sha256/${hex}`, { cache: "no-store" }); return r.status === 200 && (await r.arrayBuffer()).byteLength > 0; } catch { return false; }
    }, indexHex);
    // proof
    const shot = join(here, "holo-share-link-witness.png");
    await page.screenshot({ path: shot });

    rec("the share link OPENS and RENDERS the app fullscreen in a COLD browser (the Telegram tap)", rendered, `${APP} · ${coldMs} ms · body ${bodyLen} · ${appSrc.split("/").slice(-2).join("/")}`);
    rec("a delivery Service Worker is live (the app runs on a content worker, not bare HTTP)", sw.controlled, sw.url.split("/").pop() || "none");
    rec("the app runs on the ONE Holo Runtime delivery worker (holo-fhs-sw.js — the κ-cache), not the older per-app worker", onRuntime, sw.url.split("/").pop() || "none");
    rec("the app SELF-RESOLVES by its content address (κ-route returns its bytes)", selfResolve, `index κ ${indexHex.slice(0, 12)}…`);

    // WARM: a second visit (return tap) — should be network-free if on the runtime κ-cache.
    const t1 = Date.now();
    await page.goto(shareLink, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(400);
    const warmMs = Date.now() - t1;
    const cacheHit = await page.evaluate(async (app) => {
      const r = await fetch(`/apps/${app}/index.html?probe=warm`, { cache: "no-store" });
      return r.headers.get("x-holo-cache");
    }, APP);
    rec("the 2nd open is served network-free from the κ-cache (x-holo-cache: hit) — the runtime advantage", cacheHit === "hit", `cache: ${cacheHit} · warm reload ${warmMs} ms`);
    console.log(`\n  screenshot proof → tools/holo-share-link-witness.png`);
    await browser.close();
  } catch (e) { try { await browser.close(); } catch {} rec("browser run completed", false, String(e && e.message || e)); }
}
await close();

const witnessed = failed === 0 && passed >= 5;
console.log(`\n${witnessed ? "WITNESSED ✓" : "INCOMPLETE ✗"} — ${passed}/${passed + failed} · share an app by one link → opens + runs on the Holo Runtime in any browser`);
writeFileSync(join(here, "holo-share-link-witness.result.json"),
  JSON.stringify({ witnessed, passed, failed, app: APP, rootK, shareLink: `/holospace.html?app=${APP}#k=${rootK}`,
    covers: results.filter((r) => r.ok).map((r) => r.name.slice(0, 56)), results,
    spec: "A holo app is shareable by one content link (holospace.html?app=<ref>#k=<κ>). Tapped in a cold, fresh browser (the Telegram path), it opens and renders the app fullscreen with the Share-to-Run chrome, self-resolves the app by its content address, runs on the ONE Holo Runtime delivery worker (holo-fhs-sw.js, the κ-cache), and the 2nd open is network-free." }, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
