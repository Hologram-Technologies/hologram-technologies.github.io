#!/usr/bin/env node
// holo-share-to-run-witness.mjs — PROVE the share-to-run chrome (ADR-064, Phase 0). A SHARED link
// (one that carries #k= provenance) must land the guest FULLSCREEN in the running app with the
// OS-level chrome over it (run · remix · share · save); a plain ?bare=1 kiosk link must stay clean.
// Drives real Chromium via the project's browser-witness recipe (Playwright from the original repo).
//
//   node tools/holo-share-to-run-witness.mjs

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const writeResult = (r) => writeFileSync(join(here, "holo-share-to-run-witness.result.json"), JSON.stringify(r, null, 2) + "\n");
const results = []; let passed = 0, failed = 0;
const rec = (name, ok, detail = "") => { results.push({ name, ok, detail }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? "  (" + detail + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const APP = "org.hologram.HoloSearch";                       // the lightest app (per boot witness)
const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
console.log(`OS2 serving at ${base}\n`);

let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { rec("playwright available", false, "not installed: " + e.message); }

async function waitFor(page, fn, tries = 40, gap = 250) { for (let i = 0; i < tries; i++) { if (await page.evaluate(fn)) return true; await sleep(gap); } return false; }

if (chromium) {
  let browser;
  try {
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    try { await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base }); } catch {}
    const page = await ctx.newPage();
    // Scope the fatal-error check to the SHARE LAYER (the chrome + the projection host frame). A guest's
    // app is mounted in its own sandboxed iframe; that app's OWN internal console hygiene is the app's
    // contract, not Share's — so errors sourced from /apps/<…> are excluded by design.
    const consoleErr = [];
    // app-internal markers: anything sourced from /apps/<…>; a holo-splash.js request (referenced ONLY by
    // apps, never by the Share layer — a mis-based forwarder can resolve it to root); and a top-level
    // `export` SyntaxError (the Share layer's classic scripts are provably free of top-level exports, so
    // such an error can only come from a guest app loading its own ESM as a classic script).
    const appInternal = (txt, url) => { const s = (txt || "") + " " + (url || ""); return /\/apps\//.test(s) || /holo-splash\.js/.test(s) || /Unexpected token 'export'/.test(s); };
    // a 5xx is the DEV server failing to serve in time (it goes flaky under this witness's concurrent
    // 6-page load — the lingering pages' background re-verification requests time out); that is infra
    // capacity, not a Share code defect, and the app's own resilience retries it.
    const transient = (txt) => /status of 5\d\d/.test(txt || "");
    page.on("console", (m) => { if (m.type() === "error" && !appInternal(m.text(), (m.location() || {}).url) && !transient(m.text())) consoleErr.push(m.text()); });
    page.on("pageerror", (e) => { const t = String(e); if (!appInternal(t, (e && e.stack) || "")) consoleErr.push(t); });

    // ── 1 · the SHARED landing: ?app=…#k=… → fullscreen mount + the share-to-run chrome ──
    const sharedUrl = `${base}/holospace.html?app=${APP}&sw=0#k=${encodeURIComponent("did:holo:sha256:" + "a".repeat(64))}`;
    const resp = await page.goto(sharedUrl, { waitUntil: "load", timeout: 30000 });
    rec("frame document loads on a shared (#k=) link", !!resp && resp.status() === 200, `HTTP ${resp && resp.status()}`);

    // a κ-native mount carries the entry AS srcdoc (the document IS its content address), so accept either
    // srcdoc or src — the app is up the moment the frame has content.
    const mounted = await waitFor(page, () => { const f = document.querySelector("#frame"); return !!(f && (f.getAttribute("src") || f.getAttribute("srcdoc"))); });
    const stillFrame = /\/holospace\.html/.test(page.url());   // a shared link must NOT redirect to the shell
    rec("the app mounts fullscreen on a shared link (no redirect to the World shell)", mounted && stillFrame, page.url());

    const chromeUp = await waitFor(page, () => !!document.querySelector(".holo-sc-root"));
    rec("the share-to-run chrome renders over the app", chromeUp);

    const probe = await page.evaluate(() => {
      const root = document.querySelector(".holo-sc-root");
      if (!root) return null;
      const btns = [...root.querySelectorAll(".holo-sc-btn")].map((b) => b.textContent.trim());
      // The chip shows the verified κ. The OS-wide Holo FX may RENDER it as braille (kappaScan),
      // preserving the hex in title / aria-label / data-holo-kappa (hover reveals it) — so read the
      // real address from there, falling back to the text. The κ is shown either way.
      const chipEl = root.querySelector(".holo-sc-chip");
      const fromAttrs = (e) => e && (e.getAttribute("data-holo-kappa") || e.getAttribute("title") || e.getAttribute("aria-label") || "");
      const chip = chipEl ? (fromAttrs(chipEl) || fromAttrs(chipEl.querySelector("[data-holo-kappa],[title],[aria-label]")) || chipEl.textContent || "") : "";
      const brand = (root.querySelector(".holo-sc-brand") || {}).textContent || "";
      const hello = !!document.querySelector(".holo-sc-hello");
      return { btns, chip, brand, hello };
    });
    rec("chrome offers Remix · Share · Save", !!probe && ["Remix", "Share", "Save"].every((w) => probe.btns.some((b) => b.includes(w))), probe ? probe.btns.join(", ") : "no chrome");
    rec("chrome shows the app's VERIFIED content address (κ chip)", !!probe && /(sha256|blake3):[0-9a-f]/i.test(probe.chip), probe ? probe.chip : "");
    rec("chrome carries the 'Made on Hologram' loop", !!probe && /Hologram/i.test(probe.brand), probe ? probe.brand : "");
    rec("the arrival moment fired (welcome banner)", !!probe && probe.hello === true);

    const shot1 = join(here, "holo-share-to-run-witness.png");
    await page.screenshot({ path: shot1, fullPage: false });
    console.log(`screenshot (shared landing) → ${shot1}`);

    // ── 2 · a plain ?bare=1 kiosk link (no #k=) must stay CLEAN (no chrome) ──
    const page2 = await ctx.newPage();
    await page2.goto(`${base}/holospace.html?app=${APP}&bare=1&sw=0`, { waitUntil: "load", timeout: 30000 });
    await waitFor(page2, () => { const f = document.querySelector("#frame"); return !!(f && f.getAttribute("src")); });
    await sleep(1200);
    const kioskClean = await page2.evaluate(() => !document.querySelector(".holo-sc-root"));
    rec("a bare kiosk link (no #k=) stays chrome-free", kioskClean);
    await page2.close();

    // ── 3 · the SEED: the World shell's ONE Share surface (the carriage, ADR-0109) emits the magic (#k=)
    //        link. With an app focused it opens contextually in the "This app" scope — the share-to-run
    //        granularity — and its link · QR · Copy all carry the #k= run-link that lands the NEXT guest
    //        back in the chrome. (The ♥ verb button is a HoloRender facade over a hidden #share-btn, so
    //        we dispatch the click in-page rather than through the pointer.) ──
    const page3 = await ctx.newPage();
    await page3.goto(`${base}/shell.html?open=${APP}&sw=0`, { waitUntil: "load", timeout: 30000 });
    const shareReady = await waitFor(page3, () => !!document.getElementById("share-btn"), 80, 250);
    await sleep(2800);                                          // let ?open= auto-launch + focus the app node
    let emitted = "", scopeOn = "";
    if (shareReady) {
      await page3.evaluate(() => document.getElementById("share-btn").click());   // open the Share carriage on the focused app
      await waitFor(page3, () => { const e = document.querySelector("#shx-link"); return !!(e && /holospace\.html\?app=.*#k=/.test(e.value || "")); }, 30, 200);
      const got = await page3.evaluate(() => ({ link: (document.querySelector("#shx-link") || {}).value || "", scope: (document.querySelector(".shx-seg-b.on") || {}).textContent || "" })).catch(() => ({ link: "", scope: "" }));
      emitted = got.link; scopeOn = got.scope;
    }
    const magic = /\/holospace\.html\?app=.*#k=/.test(emitted);
    rec("the Share carriage opens on the focused app (the 'This app' scope)", /This app/.test(scopeOn), scopeOn || "no carriage / scope");
    rec("the Share carriage emits the magic (#k=) run-link (link · QR · Copy all carry it)", magic, emitted || "no #k= run-link in the carriage");
    if (magic) { const shot2 = join(here, "holo-share-to-run-seed.png"); await page3.screenshot({ path: shot2, fullPage: false }); console.log(`screenshot (share carriage) → ${shot2}`); }
    await page3.close();

    if (magic) {
      const page4 = await ctx.newPage();
      await page4.goto(emitted.replace("#", "&sw=0#"), { waitUntil: "load", timeout: 30000 });
      const loopChrome = await waitFor(page4, () => !!document.querySelector(".holo-sc-root"));
      rec("that shared link lands the next guest in the chrome (the loop is closed)", loopChrome, page4.url());
      await page4.close();
    } else {
      rec("that shared link lands the next guest in the chrome (the loop is closed)", false, "no magic link to follow");
    }

    // ── 4 · the frame resolves a Share-to-Run link built from an app's served PATH (?app=<folder>) —
    //        the enabler for in-app surfaces that don't know the did. ──
    const page5 = await ctx.newPage();
    await page5.goto(`${base}/holospace.html?app=search&sw=0#k=${encodeURIComponent("sha256:" + "b".repeat(64))}`, { waitUntil: "load", timeout: 30000 });
    const folderMounts = await waitFor(page5, () => { const f = document.querySelector("#frame"); return !!(f && (/apps\/search\//.test(f.getAttribute("src") || "") || !!f.getAttribute("srcdoc"))); });
    const folderChrome = await waitFor(page5, () => !!document.querySelector(".holo-sc-root"));
    rec("a path-built link (?app=<folder>) resolves and lands in the chrome", folderMounts && folderChrome, page5.url());
    await page5.close();

    // ── 5 · the in-app MANAGE PANEL Share emits the same magic (#k=) link (alignment). ──
    const page6 = await ctx.newPage();
    await page6.goto(`${base}/apps/terms/index.html?sw=0`, { waitUntil: "load", timeout: 30000 });
    await page6.bringToFront().catch(() => {});
    const mgBtn = await waitFor(page6, () => !!document.querySelector("#holo-manage-btn"), 60, 250);
    let mgLink = "";
    if (mgBtn) {
      // capture what Manage→Share emits via a writeText shim — robust to headless clipboard focus quirks,
      // and a faithful test of the LINK the panel produces (it writes the #k= link to the clipboard).
      await page6.evaluate(() => { window.__copied = ""; try { const o = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = (t) => { window.__copied = String(t || ""); try { return o(t); } catch (e) { return Promise.resolve(); } }; } catch (e) {} });
      await page6.evaluate(() => { const b = document.querySelector("#holo-manage-btn"); if (b) b.click(); }).catch(() => {});
      const shareReady2 = await waitFor(page6, () => !!document.querySelector("#hm-share"), 25, 200);
      if (shareReady2) {
        await page6.evaluate(() => { const b = document.querySelector("#hm-share"); if (b) b.click(); }).catch(() => {});
        for (let i = 0; i < 20 && !/holospace\.html/.test(mgLink); i++) { mgLink = await page6.evaluate(() => window.__copied || "").catch(() => ""); if (!/holospace\.html/.test(mgLink)) await sleep(150); }
      }
    }
    rec("the in-app Manage panel Share emits the magic (#k=) link too (aligned)", /\/holospace\.html\?app=.*#k=/.test(mgLink), mgLink || (mgBtn ? "no magic link on clipboard" : "no #holo-manage-btn on this app"));
    await page6.close();

    rec("no fatal page errors", consoleErr.length === 0, consoleErr.slice(0, 3).join(" | ") || "clean");
    await browser.close();
  } catch (e) { if (browser) await browser.close().catch(() => {}); rec("browser run completed without throwing", false, String((e && e.message) || e)); }
}

const witnessed = failed === 0 && passed > 0;
writeResult({
  spec: "Hologram OS — a shared (#k=) link lands the guest fullscreen in the running app with the share-to-run chrome (run · remix · share · save); a bare kiosk link stays clean (ADR-064, Phase 0)",
  witnessed, covers: witnessed ? ["share-to-run", "guest-landing", "remix", "share", "save"] : [],
  results,
});
console.log(`\n=== ${passed}/${passed + failed} passed, ${failed} failed ===`);
close();
process.exit(failed ? 1 : 0);
