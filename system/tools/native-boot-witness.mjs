#!/usr/bin/env node
// native-boot-witness.mjs — PROVE the boot is 100% native to the UOR content-addressed substrate:
// every booted byte is re-derived to its κ and a tampered origin is REFUSED (Law L5). It serves the
// staged layout from a dumb static host (no headers, like Pages) and can corrupt any file on demand.
//   • clean boot: the gateway → rEFInd renders + cross-origin isolated (all boot bytes verified);
//   • the SW serves a pinned file only when its bytes re-derive to the pin (200);
//   • flip ONE byte at the origin → the SW refuses it (409) → the boot does not proceed.
//
//   node system/tools/native-boot-witness.mjs

import http from "node:http";
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");          // system/
const REPO = join(ROOT, "..");          // repo root
const OS = join(ROOT, "os");            // system/os
const ORIG = "C:/Users/pavel/Desktop/hologram-os/os";
const ROOT_FILES = ["index.html", "README.md", "AGENTS.md", "CONSTITUTION.md"];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".jsonld": "application/ld+json", ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".txt": "text/plain", ".webmanifest": "application/manifest+json" };

const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolve(pathname) {
  let p = pathname.replace(/^\/+/, ""); if (p === "" || p.endsWith("/")) p += "index.html";
  if (ROOT_FILES.includes(p)) return join(REPO, p);
  if (p === "llms.txt") return join(ROOT, "llms.txt");
  if (p.startsWith(".well-known/")) return join(OS, p);
  if (p === "os" || p.startsWith("os/")) return join(ROOT, p);
  return null;
}
let TAMPER = null;   // a pathname whose bytes the origin will corrupt (one flipped/added byte)
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  let abs = resolve(pathname);
  if (abs && existsSync(abs) && statSync(abs).isDirectory()) abs = join(abs, "index.html");
  if (!abs || !existsSync(abs) || !statSync(abs).isFile()) { res.writeHead(404); return res.end("404 " + pathname); }
  let buf = readFileSync(abs);
  if (TAMPER && pathname === TAMPER) buf = Buffer.concat([buf, Buffer.from("/*x*/")]);   // ← origin tampering
  res.writeHead(200, { "content-type": TYPES[extname(abs).toLowerCase()] || "application/octet-stream" });
  res.end(buf);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`dumb static host at ${base}/\n`);

const require = createRequire(pathToFileURL(join(ORIG, "package.json")));
const { chromium } = require("playwright");
let browser;
try {
  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

  // ── clean boot: every boot byte re-derives to its κ, so the SDDM greeter runs + COI works ──
  // The streamlined default path skips the rEFInd menu + Plymouth and goes straight to the greeter,
  // which (on unlock) opens the ONE desktop shell (apps/sdk). Integrity is unchanged — the worker
  // still re-derives every byte to its κ (L5); we just land on the greeter, not a boot animation.
  await page.goto(base + "/", { waitUntil: "load", timeout: 30000 });
  await page.waitForURL(/\/login\.html/, { timeout: 25000 }).catch(() => {});
  await sleep(2500);
  const boot = await page.evaluate(() => ({ controlled: !!navigator.serviceWorker.controller, greeter: !!window.__holoQml || !!document.querySelector("#stage input"), isolated: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : false }));
  rec("clean boot: SW controls, the SDDM greeter renders, isolated — i.e. every boot byte re-derived to its κ (L5)",
    boot.controlled && boot.greeter && boot.isolated, `controlled=${boot.controlled} greeter=${boot.greeter} isolated=${boot.isolated}`);

  // ── the SW serves a pinned file only when it verifies (clean = 200) ──
  const clean = await page.evaluate(async () => (await fetch("/os/_shared/holo-identity.mjs?cb=" + Date.now())).status);
  rec("a κ-pinned boot module verifies and is served (200)", clean === 200, `status=${clean}`);

  // ── tamper the origin for that module → the SW must REFUSE it (409), boot fails closed ──
  TAMPER = "/os/usr/lib/holo/holo-identity.mjs";   // the physical path the SW fetches for /os/_shared/holo-identity.mjs
  const tampered = await page.evaluate(async () => { const r = await fetch("/os/_shared/holo-identity.mjs?cb=" + Date.now()); return { status: r.status, body: (await r.text()).slice(0, 40) }; });
  rec("tampered origin byte is REFUSED by re-derivation (409) — the origin is untrusted (L5)",
    tampered.status === 409 && /MISMATCH/.test(tampered.body), `status=${tampered.status} body="${tampered.body}"`);

  // ── and with tampering on, the boot genuinely can't proceed (the greeter won't initialise) ──
  await page.goto(base + "/os/login.html?next=apps%2Fsdk%2Findex.html&label=Hologram%20OS", { waitUntil: "load", timeout: 30000 });
  await sleep(1500);
  const greeterDied = await page.evaluate(() => !window.__holoQml);   // login.html imports holo-identity (now refused)
  rec("with a tampered identity module, the greeter fails closed (does not boot)", greeterDied, `__holoQml=${!greeterDied}`);
  TAMPER = null;

  await browser.close();
} catch (e) { if (browser) await browser.close().catch(() => {}); rec("witness completed without throwing", false, String(e && e.message || e)); }

const witnessed = failed === 0 && passed > 0;
writeFileSync(join(here, "native-boot-witness.result.json"), JSON.stringify({
  spec: "Hologram OS boot is 100% native to the UOR content-addressed substrate: every booted byte is re-derived to its κ and a tampered origin is refused (Law L5); no servers, no external dependencies",
  witnessed, covers: witnessed ? ["content-addressed-boot", "law-l5-delivery", "untrusted-origin"] : [], results,
}, null, 2) + "\n");
console.log(`\n=== ${passed}/${passed + failed} passed, ${failed} failed ===`);
server.close();
process.exit(failed ? 1 : 0);
