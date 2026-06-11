#!/usr/bin/env node
// splash-studio-witness.mjs — PROVE the splash is the full editable Holo Splash theme studio AND a
// clean firmware-style boot splash, both 100% native to the UOR substrate. Serves the staged Pages
// layout from a dumb static host (no headers) and drives real Chromium:
//   • BOOT FACE: the gateway boots → the splash runs in handoff (chromeless, F2 → Boot Menu prompt),
//     the κ SW controls every byte, cross-origin isolated.
//   • F2 → BOOT MENU: pressing F2 on the boot splash enters Holo Boot (rEFInd); the menu renders its
//     entries and every boot byte re-derives to its κ — NO 409 anywhere in the run (Law L5).
//   • STUDIO FACE: opening the splash standalone (no ?next) is the editable theme studio — the dev
//     bar, the κ-verified theme picker (the real .plymouth catalog), the plymouth(1) client dock —
//     editable directly in the holospace, with the live "✓ κ verified" L5 badge.
//
//   node system/tools/splash-studio-witness.mjs

import http from "node:http";
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, ".."), REPO = join(ROOT, ".."), OS = join(ROOT, "os");
const ORIG = "C:/Users/pavel/Desktop/hologram-os/os";
const ROOT_FILES = ["index.html", "README.md", "AGENTS.md", "CONSTITUTION.md"];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".jsonld": "application/ld+json", ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".webp": "image/webp", ".txt": "text/plain", ".webmanifest": "application/manifest+json" };

const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolve(p) { p = p.replace(/^\/+/, ""); if (p === "" || p.endsWith("/")) p += "index.html"; if (ROOT_FILES.includes(p)) return join(REPO, p); if (p === "llms.txt") return join(ROOT, "llms.txt"); if (p.startsWith(".well-known/")) return join(OS, p); if (p === "os" || p.startsWith("os/")) return join(ROOT, p); return null; }
const server = http.createServer((req, res) => { let pn = decodeURIComponent((req.url || "/").split("?")[0]); let abs = resolve(pn); if (abs && existsSync(abs) && statSync(abs).isDirectory()) abs = join(abs, "index.html"); if (!abs || !existsSync(abs) || !statSync(abs).isFile()) { res.writeHead(404); return res.end("404 " + pn); } res.writeHead(200, { "content-type": TYPES[extname(abs).toLowerCase()] || "application/octet-stream" }); res.end(readFileSync(abs)); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`dumb static host (staged Pages layout) at ${base}/\n`);

let chromium; try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); } catch (e) { rec("playwright available", false, e.message); }

if (chromium) {
  let browser;
  const refused = [];   // any 409 (a κ mismatch) anywhere in the run is a hard failure
  try {
    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
    page.on("response", (r) => { if (r.status() === 409) refused.push(r.url().replace(base, "")); });

    // ── BOOT FACE: gateway → the splash runs as a clean handoff (chromeless, F2 prompt), κ SW + COI ──
    await page.goto(base + "/", { waitUntil: "load", timeout: 30000 });
    // the gateway is a STATIC splash: it must NOT auto-boot — it waits for an explicit user action.
    await sleep(2200);
    const preBoot = await page.evaluate(() => location.pathname);
    rec("gateway is a static splash — it does NOT auto-boot; it waits for the user",
      !/splash\.html/.test(preBoot), `still at ${preBoot} after 2.2 s (no auto-forward)`);
    // boot explicitly by pressing Enter (the button click is wired to the same boot()).
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/splash\.html/, { timeout: 25000 }).catch(() => {});
    await sleep(2500);
    rec("explicit boot: pressing Enter on the gateway boots into the splash handoff",
      /splash\.html/.test(await page.evaluate(() => location.pathname)), "Enter → splash.html");
    const bootFace = await page.evaluate(() => {
      const vis = (el) => !!el && getComputedStyle(el).display !== "none" && el.offsetParent !== null;
      return {
        url: location.pathname, handoff: document.body.classList.contains("handoff"),
        barHidden: !vis(document.getElementById("bar")), screen: !!document.getElementById("screen"),
        f2: /F2/.test((document.getElementById("skip") || {}).textContent || ""),
        controlled: !!navigator.serviceWorker.controller,
        isolated: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : false,
      };
    });
    rec("boot face: the gateway boots → a clean handoff splash (chromeless, F2 prompt, κ SW controls, isolated)",
      /splash\.html/.test(bootFace.url) && bootFace.handoff && bootFace.barHidden && bootFace.screen && bootFace.f2 && bootFace.controlled && bootFace.isolated,
      JSON.stringify(bootFace));

    // ── F2 → BOOT MENU: enter Holo Boot (rEFInd); the menu renders its entries; every byte verifies ──
    await page.keyboard.press("F2");
    await page.waitForURL(/\/boot\.html/, { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => window.__holoBootReady === true, { timeout: 15000 }).catch(() => {});
    await sleep(800);
    const menu = await page.evaluate(() => ({
      url: location.pathname, entries: (document.getElementById("osrow") || { children: [] }).children.length,
      ver: (document.getElementById("ver") || {}).textContent || "", controlled: !!navigator.serviceWorker.controller,
    }));
    rec("F2 → Holo Boot (rEFInd): the boot menu renders its entries, κ SW controls — every boot byte re-derived (L5)",
      /boot\.html/.test(menu.url) && menu.entries > 0 && menu.controlled, `url=${menu.url} entries=${menu.entries} ver="${menu.ver.trim()}"`);

    // ── STUDIO FACE: open the splash standalone — the editable theme studio (SW already controls) ──
    await page.goto(base + "/os/splash.html", { waitUntil: "load", timeout: 30000 });
    await sleep(3000);   // theme catalog loads + first theme κ-verifies
    const studio = await page.evaluate(() => {
      const vis = (el) => !!el && getComputedStyle(el).display !== "none" && el.offsetParent !== null;
      const seg = document.getElementById("bgSeg");
      return {
        handoff: document.body.classList.contains("handoff"),
        barVisible: vis(document.getElementById("bar")),
        dockVisible: vis(document.getElementById("dock")),
        themes: (document.getElementById("themeSel") || { options: [] }).options.length,
        importBtn: vis(document.getElementById("impBtn")),
        screen: !!document.getElementById("screen"),
        ver: (document.getElementById("ver") || {}).textContent || "",
        // the new controls
        bgModes: seg ? [...seg.querySelectorAll("button[data-bg]")].map((b) => b.dataset.bg) : [],
        bgActive: seg ? (seg.querySelector("button.on") || {}).dataset?.bg || "" : "",
        hasSizeRange: vis(document.getElementById("sizeRange")),
        sizeVal: (document.getElementById("sizeVal") || {}).textContent || "",
        // the redundant plymouth dev-dock must be GONE
        oldDock: ["cShow", "cHide", "cStatus", "cMessage", "cAsk", "cMode", "cProgress", "cPause", "cQuit", "bgSel"].filter((id) => document.getElementById(id)),
      };
    });
    rec("studio face: the standalone splash is the editable theme studio (κ-verified theme picker · Import · controls)",
      !studio.handoff && studio.barVisible && studio.dockVisible && studio.themes >= 2 && studio.importBtn && studio.screen,
      `themes=${studio.themes} bar=${studio.barVisible} dock=${studio.dockVisible} import=${studio.importBtn}`);
    rec("studio face: every active theme byte re-derives to its κ — the live L5 badge reads verified",
      /κ verified/.test(studio.ver), `ver="${studio.ver.trim()}"`);
    rec("controls: a 3-mode Background segmented control (Dark · Light · Immersive) with one active",
      studio.bgModes.join(",") === "dark,light,immersive" && ["dark", "light", "immersive"].includes(studio.bgActive),
      `modes=[${studio.bgModes}] active=${studio.bgActive}`);
    rec("controls: a Center-size slider with a live % readout",
      studio.hasSizeRange && /%$/.test(studio.sizeVal.trim()), `sizeVal="${studio.sizeVal.trim()}"`);
    rec("redundant components removed: the busy plymouth dev-dock + the old BG dropdown are gone",
      studio.oldDock.length === 0, studio.oldDock.length ? "still present: " + studio.oldDock.join(", ") : "none present");

    // ── LOADING BAR + BOOT TIME: a precise linear progress bar under the centre animation, and an
    //    editable Boot-time (seconds) in the dock. Default 12 s; the bar fills over the run; editing
    //    the time sets eng.duration and restarts the bar from zero. ──
    const barA = await page.evaluate(() => ({
      present: !!document.getElementById("loadbar") && getComputedStyle(document.getElementById("loadbar")).display !== "none",
      durPresent: !!document.getElementById("durNum"),
      dur: document.getElementById("durNum") ? document.getElementById("durNum").value : null,
      fill: parseFloat((document.getElementById("loadbarFill") || {}).style?.width) || 0,
      progress: (window.holoSplash.last || {}).progress || 0,
    }));
    await sleep(1300);
    const barB = await page.evaluate(() => ({
      fill: parseFloat((document.getElementById("loadbarFill") || {}).style?.width) || 0,
      progress: (window.holoSplash.last || {}).progress || 0,
    }));
    rec("loading bar: a precise progress bar under the centre animation (default Boot time 12 s) fills over the run",
      barA.present && barA.durPresent && barA.dur === "12" && barB.fill > barA.fill && barB.progress > barA.progress,
      `dur=${barA.dur}s · fill ${barA.fill.toFixed(1)}%→${barB.fill.toFixed(1)}% · progress ${barA.progress.toFixed(3)}→${barB.progress.toFixed(3)}`);
    const barC = await page.evaluate(async () => {
      const d = document.getElementById("durNum");
      d.value = "6"; d.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 140));
      return { dur: d.value, progress: (window.holoSplash.last || {}).progress || 0 };
    });
    rec("Boot time editable: setting a new time restarts the bar at that duration (run resets toward 0)",
      barC.dur === "6" && barC.progress < barB.progress, `set 6 s · progress ${barB.progress.toFixed(3)}→${barC.progress.toFixed(3)}`);
    // restore the default so the remaining assertions run against a fresh 12 s run
    await page.evaluate(async () => { const d = document.getElementById("durNum"); d.value = "12"; d.dispatchEvent(new Event("change", { bubbles: true })); await new Promise((r) => setTimeout(r, 60)); });

    // ── the Background toggle is WIRED, tested on a STATIC mark (holo-logo, non-solo): Dark hides
    //    the field; Immersive shows it. Then the animated holo-pulse: it is SOLO (its own full-field
    //    animation) so Immersive suppresses the field, and it actually animates. ──
    const wiring = await page.evaluate(async () => {
      const seg = document.getElementById("bgSeg");
      const fieldShown = () => { const f = document.getElementById("field"); return !!f && getComputedStyle(f).display !== "none"; };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      await window.holoSplash.setTheme("holo-logo"); await sleep(500);     // a static mark → the field is its backdrop
      seg.querySelector('button[data-bg="dark"]').click(); await sleep(150);
      const dark = { cls: document.body.classList.contains("bg-dark"), field: fieldShown() };
      seg.querySelector('button[data-bg="immersive"]').click(); await sleep(150);
      const imm = { cls: document.body.classList.contains("bg-immersive"), field: fieldShown() };
      // the animated mark: solo → no field even in Immersive; engine running with the dot sprites
      await window.holoSplash.setTheme("holo-pulse"); await sleep(600);
      seg.querySelector('button[data-bg="immersive"]').click(); await sleep(200);
      const pulse = { id: (window.holoSplash.theme || {}).id, field: fieldShown(), running: !!(window.holoSplash.engine && window.holoSplash.engine.running), sprites: window.holoSplash.sprites };
      // holo-pulse paints its OWN progress bar (a wide-short sprite); it must be SUPPRESSED so the
      // canonical DOM loading bar is the only one. No visible wide-short sprite may remain.
      const be2 = window.holoSplash.backend;
      const visibleThemeBar = !!(be2 && be2.sprites && be2.sprites.some((s) => s && s.image && s.image.width > 0 && s.image.height > 0 && !s.__hidden && s.opacity > 0 && s.image.width / s.image.height >= 18));
      const singleBar = { visibleThemeBar, domBar: !!document.getElementById("loadbar") };
      // size slider → CSS --center-scale on the animation layer
      const r = document.getElementById("sizeRange"); r.value = "150"; r.dispatchEvent(new Event("input", { bubbles: true })); await sleep(150);
      const scale = getComputedStyle(document.documentElement).getPropertyValue("--center-scale").trim();
      return { dark, imm, pulse, scale, singleBar };
    });
    rec("Background toggle wired (static mark): Dark = clean (field hidden) · Immersive = field shown",
      wiring.dark.cls && !wiring.dark.field && wiring.imm.cls && wiring.imm.field,
      `dark{field:${wiring.dark.field}} immersive{field:${wiring.imm.field}}`);
    rec("animated theme 'Hologram Pulse' (Pack 5): solo (no field), running, with the dot-mark sprites",
      wiring.pulse.id === "holo-pulse" && !wiring.pulse.field && wiring.pulse.running && wiring.pulse.sprites >= 70,
      `id=${wiring.pulse.id} field=${wiring.pulse.field} running=${wiring.pulse.running} sprites=${wiring.pulse.sprites}`);
    rec("single loading bar: a theme's own bar is suppressed (no double) — only the canonical DOM bar shows",
      !wiring.singleBar.visibleThemeBar && wiring.singleBar.domBar,
      `themeBarVisible=${wiring.singleBar.visibleThemeBar} domBar=${wiring.singleBar.domBar}`);
    rec("Center-size slider scales the centre animation (--center-scale follows the slider)",
      Math.abs(parseFloat(wiring.scale) - 1.5) < 0.01, `--center-scale=${wiring.scale} (slider=150%)`);

    // a clean screenshot of the real studio (reset to Immersive · 100%) — taken BEFORE the
    // synthetic-import mutation below so it shows the genuine studio state
    await page.evaluate(() => { document.getElementById("bgSeg").querySelector('button[data-bg="immersive"]').click(); const r = document.getElementById("sizeRange"); r.value = "100"; r.dispatchEvent(new Event("input", { bubbles: true })); });
    await sleep(400);
    await page.screenshot({ path: join(here, "splash-studio-witness.png") });
    console.log(`screenshot → ${join(here, "splash-studio-witness.png")}`);

    // ── IMPORTED image-theme handling (owl-style): its OWN backdrop, not the wave field, and a
    //    clean centre on Light/Dark. Synthesised here (a real adi1090x import lives in the user's
    //    browser); the code path is identical — a full-bleed backdrop sprite + a small centre logo. ──
    const imp = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const hs = window.holoSplash, be = hs.backend; const W = be.width(), H = be.height();
      const backdrop = { __sprite: true, backend: be, image: { width: W, height: H, bitmap: {} }, x: 0, y: 0, z: -10, opacity: 1 };
      const logo = { __sprite: true, backend: be, image: { width: Math.round(W * 0.12), height: Math.round(H * 0.12), bitmap: {} }, x: 0, y: 0, z: 1, opacity: 1 };
      be.sprites.length = 0; be.sprites.push(backdrop, logo);
      if (hs.theme) hs.theme.imported = true;     // mark it an imported theme
      const seg = document.getElementById("bgSeg");
      const fieldShown = () => { const f = document.getElementById("field"); return !!f && getComputedStyle(f).display !== "none"; };
      seg.querySelector('button[data-bg="immersive"]').click(); await sleep(120);
      const imm = { backdropShown: !backdrop.__hidden, logoShown: !logo.__hidden, field: fieldShown() };
      seg.querySelector('button[data-bg="light"]').click(); await sleep(120);
      const light = { backdropHidden: !!backdrop.__hidden, logoShown: !logo.__hidden, field: fieldShown() };
      return { imm, light };
    });
    rec("imported image-theme · Immersive shows the theme's OWN backdrop (kept), the wave field OFF (no blur)",
      imp.imm.backdropShown && imp.imm.logoShown && !imp.imm.field, JSON.stringify(imp.imm));
    rec("imported image-theme · Light removes the backdrop behind the centre animation (logo kept, no field)",
      imp.light.backdropHidden && imp.light.logoShown && !imp.light.field, JSON.stringify(imp.light));

    rec("no κ mismatch (409) anywhere across boot · F2 menu · studio — the whole splash is content-native (L5)",
      refused.length === 0, refused.length ? "refused: " + refused.join(", ") : "0 refusals");

    await browser.close();
  } catch (e) { if (browser) await browser.close().catch(() => {}); rec("splash flow completed without throwing", false, String(e && e.message || e)); }
}

const witnessed = failed === 0 && passed > 0;
writeFileSync(join(here, "splash-studio-witness.result.json"), JSON.stringify({
  spec: "The splash is the full editable Holo Splash theme studio (theme picker · plymouth client dock · import) when opened standalone in the holospace, AND a clean firmware-style boot splash (chromeless, F2 → rEFInd boot menu) on the boot path — both served from a dumb static host with every byte κ-verified (Law L5), 100% serverless",
  witnessed, covers: witnessed ? ["editable-studio", "boot-splash", "f2-boot-menu", "content-native-l5"] : [], results,
}, null, 2) + "\n");
console.log(`\n=== ${passed}/${passed + failed} passed, ${failed} failed ===`);
server.close();
process.exit(failed ? 1 : 0);
