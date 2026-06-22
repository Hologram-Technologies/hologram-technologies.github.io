#!/usr/bin/env node
// holo-cold-app-witness.mjs — DEPLOY gate: prove EVERY app surface the OS advertises or the shell loads
// actually RESOLVES for a cold new visitor. The cold-BOOT witness proves the OS frame boots; it does NOT
// open a single app. That gap let a real outage ship: the Play honeycomb (the `spaces` app) was loaded by
// the shell but absent from the launcher catalog, so the catalog-driven deploy vendoring never copied it —
// /apps/spaces 404'd on the static host (the SW cannot re-derive an unvendored app dir) and the Play panel
// rendered empty. "Many parts dont work for me." This witness makes that class of bug a red deploy.
//
// The contract it enforces: for every id in (catalog landingPage ids) ∪ (os/etc/core-surfaces.json surfaces),
// the app's holospace.json + holospace.lock.json + index.html must be present/resolvable. The deploy vendors
// exactly that union (pages.yml), so witness and vendoring read the SAME source of truth — they can't drift.
//
// Two modes (pick one; the gate uses the first, a manual/post-deploy run can use the second):
//   • HOLO_OS_DIR=<dir>     filesystem — assert the files exist on disk in the ASSEMBLED artifact (_site/os).
//                           Deterministic, no server, runs before upload. This is the fail-closed deploy gate.
//   • HOLO_DEPLOY=<url>     network — fetch each file from a real STATIC host (the live site) and assert 200.
//                           MUST be a static host: the dev server re-derives missing files (DEV=true) and
//                           would mask the very bug this catches. Optional Playwright phase then resolves
//                           each surface THROUGH the prod Service Worker (no 404, no 409) — the real cold visit.
//
// Usage:
//   HOLO_OS_DIR=_site/os                                   node tools/holo-cold-app-witness.mjs
//   HOLO_DEPLOY=https://host/hologram-os/  [WITH_BROWSER=1] node tools/holo-cold-app-witness.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OSDIR = (process.env.HOLO_OS_DIR || "").trim();
const raw = (process.env.HOLO_DEPLOY || "").trim();
if (!OSDIR && !raw) { console.error("set HOLO_OS_DIR=_site/os (artifact) OR HOLO_DEPLOY=https://host/hologram-os/ (live)"); process.exit(2); }
const SITE = raw ? raw.replace(/\/?$/, "/").replace(/\/os\/$/, "/") : null;
const OS = SITE ? SITE + "os/" : null;

const results = []; let pass = 0, fail = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const get = (u) => fetch(u, { cache: "no-store" });

// ── the app id set: catalog ∪ core-surfaces — the SAME union the deploy vendors ──
const APP_FILES = ["holospace.json", "holospace.lock.json", "index.html"];   // every catalog app ships all three
async function loadCatalogIds() {
  let cat;
  if (OSDIR) {
    const p = join(OSDIR, "apps", "index.jsonld");
    if (!existsSync(p)) { rec("apps/index.jsonld present in artifact", false, p); return null; }
    cat = JSON.parse(readFileSync(p, "utf8"));
  } else {
    const r = await get(OS + "apps/index.jsonld");
    if (!r.ok) { rec("fetch apps/index.jsonld", false, `HTTP ${r.status}`); return null; }
    cat = await r.json();
  }
  const ds = cat["dcat:dataset"] || [];
  return new Set(ds.map((a) => String(a["dcat:landingPage"] || "").split("/")[1]).filter(Boolean));
}
function loadCoreSurfaces() {
  // Read from the artifact/source tree; over the network read the SERVED copy so the gate reflects live bytes.
  let txt = null;
  if (OSDIR) { const p = join(OSDIR, "etc", "core-surfaces.json"); if (existsSync(p)) txt = readFileSync(p, "utf8"); }
  return txt ? (JSON.parse(txt).surfaces || []) : null;
}
async function loadCoreSurfacesNet() {
  try { const r = await get(OS + "etc/core-surfaces.json"); if (r.ok) return (await r.json()).surfaces || []; } catch {}
  return [];
}

async function checkExists(id, file) {           // filesystem mode
  return existsSync(join(OSDIR, "apps", id, file));
}
async function checkHttp(id, file) {             // network mode (origin status — static host, no SW)
  try { const r = await fetch(OS + `apps/${id}/${file}`, { cache: "no-store", method: "GET" }); return r.status === 200; }
  catch { return false; }
}

// ── code-closure: every CODE file an app's lock declares must resolve (weights heal by κ, so they're skipped) ──
// A 200 on index.html does not prove the app WORKS — its lock closure lists every byte it imports. A missing
// _shared/ runtime module or a renamed cross-tree dependency leaves the dir present but the app broken. Code
// files (.mjs/.js/.css/.html/.json/.svg…) are always committed → MUST resolve; binary weights (models, .holo,
// .onnx…) are gitignored and heal by κ at runtime → may be absent at origin, so they're excluded by extension.
const CODE_EXT = new Set([".mjs", ".js", ".css", ".html", ".htm", ".json", ".jsonld", ".svg", ".txt", ".md", ".xml", ".webmanifest"]);
const isCodeKey = (k) => CODE_EXT.has(((String(k).match(/\.[a-z0-9]+$/i) || [""])[0]).toLowerCase());
const isAppLocal = (k) => /^apps\/[^/]+\//.test(k);          // vendored flat under os/apps/<id>/
let _fhs = null;
async function fhsMap() {
  if (_fhs) return _fhs;
  try { _fhs = (await import(pathToFileURL(join(OSDIR, "lib", "holo-fhs-map.mjs")).href)).fhsMap || ((x) => x); }
  catch { _fhs = (x) => x; }
  return _fhs;
}
function loadLockFs(id) { try { return JSON.parse(readFileSync(join(OSDIR, "apps", id, "holospace.lock.json"), "utf8")).closure || {}; } catch { return null; } }
async function loadLockNet(id) { try { const r = await get(OS + `apps/${id}/holospace.lock.json`); if (r.ok) return (await r.json()).closure || {}; } catch {} return null; }
// present if EITHER the flat serve path exists OR its fhsMap target exists — mirrors the SW's "try mapped, fall back to flat"
function resolvesFs(key, fhs) { if (existsSync(join(OSDIR, key))) return true; const m = fhs(key); return !!(m && existsSync(join(OSDIR, m))); }

// ── Phase A: every advertised/loaded surface is materialized (deterministic) ──
async function phaseA() {
  const catalog = await loadCatalogIds();
  if (!catalog) return [];
  const core = OSDIR ? loadCoreSurfaces() : await loadCoreSurfacesNet();
  rec("core-surfaces manifest present", core !== null, core ? `surfaces=[${core.join(", ")}]` : "missing etc/core-surfaces.json");
  const ids = [...new Set([...catalog, ...(core || [])])].sort();
  rec("app id set derived (catalog ∪ core-surfaces)", ids.length > 0, `${ids.length} ids — catalog ${catalog.size}, core ${(core || []).length}`);

  const check = OSDIR ? checkExists : checkHttp;
  const broken = [];
  for (const id of ids) {
    const miss = [];
    for (const f of APP_FILES) { if (!(await check(id, f))) miss.push(f); }
    if (miss.length) broken.push(`${id} (${miss.join(", ")})`);
  }
  rec(`every advertised/loaded app surface resolves on a cold visit (${ids.length} apps)`,
    broken.length === 0, broken.length ? `${broken.length} broken: ${broken.join("; ")}` : `${ids.length}/${ids.length} ok`);

  // FS mode: the FULL code closure — every code file each app's lock declares must be on disk in the artifact.
  // Deterministic and exhaustive (no browser). Catches a present-but-incomplete app and a dangling cross-tree
  // (_shared/usr) dependency — the failure where the dir vendors but the app still breaks at runtime.
  if (OSDIR) {
    const fhs = await fhsMap();
    const dangling = []; let codeChecked = 0, healSkipped = 0;
    for (const id of ids) {
      const cl = loadLockFs(id); if (!cl) continue;
      for (const key of Object.keys(cl)) {
        if (!isCodeKey(key)) { healSkipped++; continue; }
        codeChecked++;
        if (!resolvesFs(key, fhs)) dangling.push(`${id} → ${key}`);
      }
    }
    rec("every app's code closure resolves (no dangling module dependency)",
      dangling.length === 0,
      dangling.length ? `${dangling.length} dangling: ${dangling.slice(0, 6).join("; ")}${dangling.length > 6 ? " …" : ""}`
                      : `${codeChecked} code files across ${ids.length} apps ok; ${healSkipped} heal-by-κ weights skipped`);
  }
  return ids;
}

// ── Phase B: resolve each surface THROUGH the prod Service Worker (the real cold visit) ──
// Network mode + WITH_BROWSER=1 only. Proves the SW serves 200 (not the 409 Safety-Stop, not a 404).
async function phaseB(ids) {
  if (OSDIR || !process.env.WITH_BROWSER || !ids.length) return;
  const ENGINE = (process.env.PW_ENGINE || "chromium").trim();   // chromium | webkit | firefox (P4)
  let pw;
  try { pw = await import("playwright"); }
  catch { console.log("\n(playwright not installed — Phase B SW-resolution skipped; Phase A is still fatal)"); return; }
  let browser;
  try { browser = await (pw[ENGINE] || pw.chromium).launch(); }
  catch (e) { if (process.env.CI) rec(`launch ${ENGINE} for SW-resolution`, false, e.message); else console.log(`\n(${ENGINE} not launchable — Phase B skipped: ${e.message})`); return; }
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(OS, { waitUntil: "load", timeout: 60000 }).catch(() => {});
    // register best-effort, then poll control from Node — the OS boot navigation destroys a single long
    // in-page wait (false negative on a fast artifact); per-iteration evaluates tolerate it (catch → retry).
    await page.evaluate(async () => { try { if (navigator.serviceWorker && !navigator.serviceWorker.controller) await navigator.serviceWorker.register("./holo-fhs-sw.js", { type: "module" }); } catch {} }).catch(() => {});
    let controlled = false;
    for (let i = 0; i < 200 && !controlled; i++) { controlled = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)).catch(() => false); if (!controlled) await page.waitForTimeout(100).catch(() => {}); }
    rec("service worker takes control (for SW-resolution phase)", controlled);
    if (!controlled) return;
    // Run the long fetch-loop on a FRESH page (same context → the SW already controls it) sent straight to a
    // STATIC in-OS page. The OS root keeps booting (it navigates on to the shell), and a late boot navigation
    // destroys any in-flight evaluate on that first page ("context destroyed" — WebKit's timing exposes it).
    // A fresh page that never booted the OS sits still, so the evaluate survives. The static page is the
    // not-found page, and proving it renders IS the P2 check. Belt-and-suspenders: retry on a stray destroy.
    const probe = await ctx.newPage();
    await probe.goto(OS + "apps/__cold_app_probe_missing__/index.html", { waitUntil: "load", timeout: 30000 }).catch(() => {});
    const nf = await probe.evaluate(() => ({ holo: /Hologram OS/.test(document.title || ""), host: /github/i.test(document.body && document.body.innerText || "") && /404|file not found/i.test(document.body && document.body.innerText || "") })).catch(() => ({}));
    rec("a missing in-scope navigation shows a calm in-OS page (not the host 404)",
      !!nf.holo && !nf.host, nf.host ? "host 404 page bled into the frame" : nf.holo ? "in-OS not-found ✓" : "neither in-OS nor host — unexpected body");
    let bad = null;
    for (let attempt = 0; attempt < 3 && bad === null; attempt++) {
      bad = await probe.evaluate(async ({ ids, base }) => {
        const out = [];
        for (const id of ids) {
          for (const f of ["holospace.json", "index.html"]) {
            try { const r = await fetch(base + `apps/${id}/${f}`, { cache: "no-store" }); if (r.status !== 200) out.push(`${id}/${f}=${r.status}`); }
            catch (e) { out.push(`${id}/${f}=ERR`); }
          }
        }
        return out;
      }, { ids, base: OS }).catch(() => null);
      if (bad === null) await probe.waitForTimeout(500).catch(() => {});
    }
    if (bad === null) bad = ["evaluate kept being destroyed by navigation"];
    rec("every surface resolves through the prod Service Worker (200, no 404/409)",
      bad.length === 0, bad.length ? `${bad.length} bad: ${bad.slice(0, 8).join(", ")}${bad.length > 8 ? " …" : ""}` : "all 200");

    // P3 · capability degradation: under REAL WebGPU stripping, the requirements primitive must DETECT the
    // absence and produce a LABELED fallback — proving an app that needs WebGPU degrades to a calm card, not
    // a blank frame. Stripping is real (the API is denied via an init script), not mocked.
    const sctx = await browser.newContext();
    await sctx.addInitScript(() => { try { Object.defineProperty(navigator, "gpu", { get: () => undefined }); } catch {} });
    const spage = await sctx.newPage();
    await spage.goto(OS, { waitUntil: "load", timeout: 60000 }).catch(() => {});
    const cap = await spage.evaluate(async (base) => {
      const m = await import(base + "usr/lib/holo/holo-requires.mjs");
      const det = m.detect();
      const missing = m.missingFor(["webgpu"], det);
      const doc = m.fallbackDoc({ appName: "Holo Q", missing, present: [] });
      return { webgpu: det.webgpu, missing, labeled: /WebGPU/.test(doc) && /data-holo-requires-fallback/.test(doc) && /Holo Q/.test(doc), nonblank: doc.length > 400 };
    }, OS).catch((e) => ({ err: String(e) }));
    rec("a required capability, when absent, degrades to a labeled fallback (real WebGPU stripping)",
      !!cap && cap.webgpu === false && Array.isArray(cap.missing) && cap.missing.includes("webgpu") && cap.labeled && cap.nonblank,
      cap && cap.err ? cap.err : `webgpu=${cap && cap.webgpu}, missing=${cap && JSON.stringify(cap.missing)}, labeled=${cap && cap.labeled}`);
    await sctx.close();
  } finally { await browser.close(); }
}

(async () => {
  console.log(`cold-app witness → ${OSDIR ? "artifact " + OSDIR : OS}\n`);
  const ids = await phaseA();
  await phaseB(ids);
  const ok = fail === 0;
  try { writeFileSync(join(here, "holo-cold-app-witness.result.json"), JSON.stringify({ mode: OSDIR ? "fs" : "net", target: OSDIR || OS, pass, fail, ok, results }, null, 2)); } catch {}
  console.log(`\n${ok ? "PASS" : "FAIL"} — ${pass} ok · ${fail} failed`);
  process.exit(ok ? 0 : 1);
})();
