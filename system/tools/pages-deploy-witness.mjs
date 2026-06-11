#!/usr/bin/env node
// pages-deploy-witness.mjs — PROVE Hologram OS boots on a DUMB static host (GitHub Pages) as-is.
// It serves os/ with a bare file server: files only at their literal FHS path, correct MIME, and
// NO COOP/COEP headers — exactly what GitHub Pages does (no mapping, no κ-route, no fallback). Then
// it drives real Chromium: the bootstrap registers holo-fhs-sw.js, which maps the flat URL space
// onto the FHS tree and stamps the isolation headers — so /boot.html, /login.html, /_shared/* all
// resolve and crossOriginIsolated is true, with zero server cooperation. The deploy story, witnessed.
//
//   node tools/pages-deploy-witness.mjs

import http from "node:http";
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const ORIG = "C:/Users/pavel/Desktop/hologram-os/os";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".jsonld": "application/ld+json", ".wasm": "application/wasm", ".png": "image/png",
  ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".map": "application/json" };

const results = []; let passed = 0, failed = 0;
const rec = (name, ok, detail = "") => { results.push({ name, ok, detail }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? "  (" + detail + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── a DUMB static host, mounted under a PROJECT SUBPATH (/holo-os/) — the hard case: a
// GitHub *project* site serves at /<repo>/, not the origin root. Literal paths only, real MIME,
// NO COI headers. If the OS boots here, it boots at a root/user site trivially. ──
const MOUNT = "/holo-os";
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
  if (pathname !== MOUNT && !pathname.startsWith(MOUNT + "/")) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("404 (outside the project base): " + pathname); }
  let p = pathname.slice(MOUNT.length).replace(/^\/+/, "");
  if (p === "" || p.endsWith("/")) p += "index.html";
  const abs = join(OS, p);
  if (!existsSync(abs) || !statSync(abs).isFile()) { res.writeHead(404, { "content-type": "text/plain" }); return res.end(`404 (Pages has no such file): ${MOUNT}/` + p); }
  res.writeHead(200, { "content-type": TYPES[extname(abs).toLowerCase()] || "application/octet-stream" });   // ← no COOP/COEP, like Pages
  res.end(readFileSync(abs));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}${MOUNT}`;     // the project-site base URL
console.log(`dumb static host (Pages project site) at ${base}/\n`);

// ── 1 · it really is Pages-like: flat URLs 404, only physical FHS paths exist ──
const code = async (u) => (await fetch(base + u)).status;
const flat404 = await code("/home.html"), phys200 = await code("/usr/share/frame/home.html"), sw200 = await code("/holo-fhs-sw.js"), map200 = await code("/lib/holo-fhs-map.mjs");
rec("the host is a dumb static host (flat /home.html 404s; only the physical FHS path exists)",
  flat404 === 404 && phys200 === 200 && sw200 === 200 && map200 === 200, `flat=${flat404} phys=${phys200} sw=${sw200} map=${map200}`);

let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { rec("playwright available", false, e.message); }

if (chromium) {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

    // ── 2 · the bootstrap brings up the SW, which then maps /boot.html (flat) → the rEFInd menu ──
    await page.goto(base + "/", { waitUntil: "load", timeout: 30000 });
    await page.waitForURL(/\/boot\.html/, { timeout: 25000 }).catch(() => {});
    await sleep(2500);                                   // rEFInd parses refind.conf (SW-mapped) + scans
    const boot = await page.evaluate(() => ({
      url: location.pathname, controlled: !!navigator.serviceWorker.controller,
      menu: /Hologram OS/.test(document.body.innerText || ""),
      isolated: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : false,
    }));
    rec("the SW controls the page and maps /boot.html → the real rEFInd menu (flat URL, dumb host)",
      boot.controlled && /boot\.html/.test(boot.url) && boot.menu, `url=${boot.url} controlled=${boot.controlled} menu=${boot.menu}`);
    rec("cross-origin isolation works on Pages (SW stamps COOP/COEP — SharedArrayBuffer ready)", boot.isolated, `crossOriginIsolated=${boot.isolated}`);

    // ── 3 · the greeter loads through the SW: flat /login.html + /_shared/* + the SDDM theme ──
    await page.goto(base + "/login.html?next=home.html&label=Hologram%20OS&logo=boot/icons/os_hologram.svg", { waitUntil: "load", timeout: 30000 });
    await sleep(2000);
    const greeter = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll("input")];
      const bgEl = document.querySelector('[data-qml="Background"]');
      return {
        engine: !!window.__holoQml,
        pass: inputs.some((i) => i.type === "password"),
        login: [...document.querySelectorAll("button")].some((b) => /login/i.test(b.textContent)),
        bg: !!(bgEl && /background\.jpg/.test(bgEl.style.backgroundImage)),
        isolated: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : false,
      };
    });
    rec("the SDDM greeter (QML engine + _shared modules + theme) loads entirely through the SW",
      greeter.engine && greeter.pass && greeter.login && greeter.bg, `engine=${greeter.engine} pass=${greeter.pass} login=${greeter.login} bg=${greeter.bg}`);
    rec("the greeter page is cross-origin isolated too", greeter.isolated, `crossOriginIsolated=${greeter.isolated}`);

    await page.screenshot({ path: join(here, "pages-deploy-witness.png") });
    console.log(`screenshot → ${join(here, "pages-deploy-witness.png")}`);
    await browser.close();
  } catch (e) { if (browser) await browser.close().catch(() => {}); rec("pages deploy flow completed without throwing", false, String(e && e.message || e)); }
}

const witnessed = failed === 0 && passed > 0;
writeFileSync(join(here, "pages-deploy-witness.result.json"), JSON.stringify({
  spec: "Hologram OS boots on a dumb static host (GitHub Pages) as-is: holo-fhs-sw.js (the in-browser twin of holo-serve-fhs.mjs, sharing lib/holo-fhs-map.mjs) maps the flat URL space onto the FHS tree and provides cross-origin isolation — no server cooperation",
  witnessed, covers: witnessed ? ["pages-deploy", "fhs-service-worker", "cross-origin-isolation"] : [], results,
}, null, 2) + "\n");
console.log(`\n=== ${passed}/${passed + failed} passed, ${failed} failed ===`);
server.close();
process.exit(failed ? 1 : 0);
