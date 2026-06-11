#!/usr/bin/env node
// gateway-witness.mjs — PROVE the single top-level gateway. It serves the STAGED deploy layout
// (the gateway index.html + llms.txt at the root, the OS as the os/ subtree, /.well-known mirrored)
// from a dumb static host with NO headers — GitHub Pages to the letter. Then it checks the gateway
// is discoverable + operable by BOTH readers:
//   • AGENT: GET / carries a parseable JSON-LD manifest declaring Boot + the substrate endpoints;
//            llms.txt + /.well-known/agents.json resolve.
//   • HUMAN: opening / renders the boot window, brings up the κ Service Worker, and enters the
//            real rEFInd boot chain — with cross-origin isolation — from one click on one file.
//
//   node tools/gateway-witness.mjs

import http from "node:http";
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");                 // system/  (here = system/tools)
const REPO = join(ROOT, "..");                 // the repo root — the gateway + root docs live here
const OS = join(ROOT, "os");                   // system/os
const ROOT_FILES = ["index.html", "README.md", "AGENTS.md", "CONSTITUTION.md"];
const ORIG = "C:/Users/pavel/Desktop/hologram-os/os";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".jsonld": "application/ld+json", ".wasm": "application/wasm", ".png": "image/png",
  ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".webp": "image/webp", ".txt": "text/plain", ".webmanifest": "application/manifest+json" };

const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// resolve the STAGED layout: / → gateway, /llms.txt → root, /os/* → os/*, /.well-known/* → os/.well-known/*
function resolve(pathname) {
  let p = pathname.replace(/^\/+/, "");
  if (p === "" || p.endsWith("/")) p += "index.html";
  if (ROOT_FILES.includes(p)) return join(REPO, p);                  // gateway + agent/governance docs (repo root)
  if (p === "llms.txt") return join(ROOT, "llms.txt");               // agent map (system/llms.txt)
  if (p.startsWith(".well-known/")) return join(OS, p);              // root mirror of the agent convention
  if (p === "os" || p.startsWith("os/")) return join(ROOT, p);       // the OS image (system/os)
  return null;
}
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
  let abs = resolve(pathname);
  if (abs && existsSync(abs) && statSync(abs).isDirectory()) abs = join(abs, "index.html");
  if (!abs || !existsSync(abs) || !statSync(abs).isFile()) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("404 (Pages has no such file): " + pathname); }
  res.writeHead(200, { "content-type": TYPES[extname(abs).toLowerCase()] || "application/octet-stream" });  // ← no COOP/COEP, like Pages
  res.end(readFileSync(abs));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`dumb static host (staged Pages layout) at ${base}/\n`);

// ── 1 · the gateway is a machine-readable manifest (agent discovery) ──
const html = await (await fetch(base + "/")).text();
let ld = null; try { ld = JSON.parse((html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1]); } catch {}
const boots = ld && (ld.potentialAction || []).some((a) => /boot/i.test(a.name || "") && /boot\.html/.test(a.target || ""));
const parts = ld ? JSON.stringify(ld.hasPart || []) : "";
rec("the gateway carries an agent manifest (JSON-LD: SoftwareApplication · Boot action · endpoints)",
  !!ld && ld.name === "Hologram OS" && boots && /agents\.json/.test(parts) && /mcp\.json/.test(parts),
  ld ? `type=${ld["@type"]} boot=${boots}` : "no JSON-LD");
const llms = await fetch(base + "/llms.txt"), aj = await fetch(base + "/.well-known/agents.json");
rec("agent-discovery files resolve (llms.txt + /.well-known/agents.json at the root)",
  llms.status === 200 && aj.status === 200 && /Hologram OS/.test(await llms.text()), `llms=${llms.status} agents=${aj.status}`);
// it really is a dumb host: the gateway is at root, the OS is the os/ subtree (flat /os/boot.html 404s)
const flat = (await fetch(base + "/os/boot.html")).status, phys = (await fetch(base + "/os/boot/index.html")).status, sw = (await fetch(base + "/os/holo-fhs-sw.js")).status;
rec("staged layout: gateway at /, OS as the os/ subtree, served by a dumb host", flat === 404 && phys === 200 && sw === 200, `flat=${flat} phys=${phys} sw=${sw}`);

let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { rec("playwright available", false, e.message); }

if (chromium) {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

    // ── 2 · a human opens ONE file → the gateway renders ──
    await page.goto(base + "/", { waitUntil: "load", timeout: 30000 });
    await sleep(600);
    const ui = await page.evaluate(() => ({
      title: (document.querySelector("h1") || {}).textContent || "",
      enter: !!document.getElementById("enter"),
      agentLink: !!document.querySelector('.agents a[href*="agents.json"]'),
      kappa: /did:holo:sha256:[0-9a-f]{8}/.test((document.getElementById("kappa") || {}).textContent || ""),
    }));
    rec("opening the gateway renders the boot window (mark · title · enter · live self-κ · agent links)",
      /Hologram\s*OS/.test(ui.title) && ui.enter && ui.agentLink && ui.kappa, `title="${ui.title.trim()}" κ=${ui.kappa}`);

    // ── 3 · …and it boots: SW comes up, the Plymouth splash runs (rEFInd is behind F2), isolated ──
    await page.waitForURL(/\/splash\.html/, { timeout: 25000 }).catch(() => {});
    await sleep(2500);
    const boot = await page.evaluate(() => ({
      url: location.pathname, controlled: !!navigator.serviceWorker.controller,
      splash: !!document.getElementById("screen"),
      prompt: /F2/.test(((document.getElementById("skip") || document.getElementById("prompt") || {}).textContent) || ""),
      isolated: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : false,
    }));
    rec("the gateway boots → the Plymouth splash (κ SW controls, F2 → Boot Menu prompt, isolated)",
      /splash\.html/.test(boot.url) && boot.controlled && boot.splash && boot.prompt && boot.isolated,
      `url=${boot.url} controlled=${boot.controlled} splash=${boot.splash} prompt=${boot.prompt} isolated=${boot.isolated}`);

    await page.screenshot({ path: join(here, "gateway-witness.png") });
    console.log(`screenshot → ${join(here, "gateway-witness.png")}`);
    await browser.close();
  } catch (e) { if (browser) await browser.close().catch(() => {}); rec("gateway flow completed without throwing", false, String(e && e.message || e)); }
}

const witnessed = failed === 0 && passed > 0;
writeFileSync(join(here, "gateway-witness.result.json"), JSON.stringify({
  spec: "A single top-level gateway (index.html) is discoverable + operable by humans and agents: it carries a JSON-LD substrate manifest, self-addresses by content, and boots the OS (κ SW + rEFInd→Plymouth→SDDM→PrimeOS) on a dumb static host — 100% serverless",
  witnessed, covers: witnessed ? ["single-gateway", "agent-manifest", "human-boot", "self-address"] : [], results,
}, null, 2) + "\n");
console.log(`\n=== ${passed}/${passed + failed} passed, ${failed} failed ===`);
server.close();
process.exit(failed ? 1 : 0);
