#!/usr/bin/env node
// holo-cold-boot-witness.mjs — POST-DEPLOY health gate: prove a COLD new visitor boots and is NEVER
// shown the fail-closed "Safety Stop". This is the witness whose ABSENCE let a mis-sealed image ship
// (2026-06-21): the Service Worker refuses EVERY request with a 409 "This didn't match, so nothing
// opened" page when sha256(os/etc/os-closure.json) != its baked CLOSURE_KAPPA. Detection then depended
// on a user report. This makes the OS find its own outage in minutes, and BLOCKS such a deploy.
//
// Two phases, increasingly strong; ANY failure exits 1 (fail-closed CI gate):
//   A · NETWORK-ONLY (no browser, deterministic) — re-derive the EXACT invariant that broke:
//       sha256(live os/etc/os-closure.json) === CLOSURE_KAPPA baked in live os/holo-fhs-sw.js.
//       This alone would have caught the incident. Also re-derives a few boot files vs their pins.
//   B · REAL COLD BOOT (Playwright, if installed) — fresh profile, register the worker, then fetch a
//       boot-critical path THROUGH it and assert HTTP 200 (not the 409 Safety-Stop page).
//
// Usage:
//   HOLO_DEPLOY=https://host/hologram-os/  EXPECT_BUILD=<sha>  node tools/holo-cold-boot-witness.mjs
//   HOLO_DEPLOY may point at the site root OR its os/ dir — both are accepted. EXPECT_BUILD (optional)
//   polls <site>/build-id.json until this commit is live, so we never assert against stale CDN bytes.
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const raw = (process.env.HOLO_DEPLOY || process.env.W1_DEPLOY || "").trim();
if (!raw) { console.error("set HOLO_DEPLOY=https://host/hologram-os/ (the site root or its os/ dir)"); process.exit(2); }
const SITE = raw.replace(/\/?$/, "/").replace(/\/os\/$/, "/");   // …/hologram-os/  (strip a trailing /os/ SEGMENT only — never the "os/" inside "hologram-os/")
const OS = SITE + "os/";                                       // …/hologram-os/os/
const EXPECT = (process.env.EXPECT_BUILD || "").trim();
const POLL_MS = +(process.env.POLL_MS || 240000);

const results = []; let pass = 0, fail = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const get = (u, o) => fetch(u, { cache: "no-store", ...o });
const sleep = (m) => new Promise((r) => setTimeout(r, m));
const ENGINE = (process.env.PW_ENGINE || "chromium").trim();   // chromium | webkit | firefox — the OS must boot on each (P4)

// ── wait for THIS build to be live (CDN propagation) before asserting, so we never test stale bytes ──
async function awaitBuild() {
  if (!EXPECT) { console.log("(no EXPECT_BUILD — skipping build-marker poll)\n"); return true; }
  const deadline = Date.now() + POLL_MS;
  while (Date.now() < deadline) {
    try { const r = await get(SITE + "build-id.json"); if (r.ok) { const j = await r.json(); if (String(j.commit) === EXPECT) { console.log(`build ${EXPECT.slice(0, 12)} is live\n`); return true; } } }
    catch { /* not up yet */ }
    await sleep(5000);
  }
  rec("build marker became live (no stale-byte race)", false, `commit ${EXPECT.slice(0, 12)} not live within ${POLL_MS}ms`);
  return false;
}

// ── Phase A: the exact invariant, re-derived from live bytes (no browser) ──
async function phaseA() {
  let anchor = null, closureHash = null;
  try { anchor = ((await (await get(OS + "holo-fhs-sw.js")).text()).match(/CLOSURE_KAPPA = "([0-9a-f]{64})"/) || [])[1] || null; }
  catch (e) { rec("fetch live service worker", false, e.message); return; }
  rec("live SW bakes a CLOSURE_KAPPA anchor", !!anchor, anchor ? anchor.slice(0, 16) + "…" : "none");
  try { closureHash = sha256(Buffer.from(await (await get(OS + "etc/os-closure.json")).arrayBuffer())); }
  catch (e) { rec("fetch live os-closure.json", false, e.message); return; }
  rec("SW anchor === sha256(served os-closure.json) — the incident invariant",
    !!anchor && anchor === closureHash, `anchor ${String(anchor).slice(0, 12)} vs closure ${String(closureHash).slice(0, 12)}`);
  // re-derive a handful of boot-critical served files vs their pins (os-served keys are real serve paths)
  try {
    const served = (await (await get(OS + "etc/os-served.json")).json()).closure || {};
    const probe = ["usr/share/frame/shell.html", "lib/holo-fhs-map.mjs", "holo-fhs-sw.js", "index.html"].filter((k) => served[k]);
    let ok = 0;
    for (const k of probe) {
      const want = String(served[k]).split(":").pop().toLowerCase();
      const got = sha256(Buffer.from(await (await get(OS + k)).arrayBuffer()));
      if (got === want) ok++; else rec(`boot file re-derives: ${k}`, false, `want ${want.slice(0, 12)} got ${got.slice(0, 12)}`);
    }
    rec("boot-critical served files re-derive to their pinned κ", ok === probe.length, `${ok}/${probe.length}`);
  } catch (e) { rec("re-derive boot files vs os-served", false, e.message); }
}

// ── Phase B: a genuinely cold visitor, under a real worker (Playwright optional) ──
async function phaseB() {
  let pw;
  try { pw = await import("playwright"); }
  catch { console.log("\n(playwright not installed — Phase B real-browser cold boot skipped; Phase A is still fatal)"); return; }
  let browser;
  try { browser = await (pw[ENGINE] || pw.chromium).launch(); }
  catch (e) {
    // In CI the browser is installed, so a launch failure is a real setup fault → FAIL (never let P2
    // silently degrade to network-only). Locally without a browser binary, skip and rely on Phase A.
    if (process.env.CI) { rec(`launch ${ENGINE} for cold-boot`, false, e.message); return; }
    console.log(`\n(${ENGINE} not launchable locally — Phase B skipped: ${e.message})`); return;
  }
  try {
    const ctx = await browser.newContext();             // fresh profile = a genuinely cold first visit
    const page = await ctx.newPage();
    // OBSERVE the wire: a Safety-Stop IS an HTTP 409 from the worker. Watching responses is redirect-proof
    // (the boot page navigates once the worker activates, which would destroy an in-page evaluate).
    const refused = [];
    page.on("response", (r) => { if (r.status() === 409) refused.push(r.url()); });
    await page.goto(OS, { waitUntil: "load", timeout: 60000 }).catch(() => {});
    // Kick a registration (best-effort; the OS boot also self-registers), THEN poll control from the Node
    // side. The OS navigates as it boots, which destroys any long in-page evaluate — so a single awaited
    // loop inside the page would throw "context destroyed" and read as "no control" (a false negative seen
    // on a fast-booting local artifact). Per-iteration evaluates tolerate the navigation (catch → retry).
    await page.evaluate(async () => { try { if (navigator.serviceWorker && !navigator.serviceWorker.controller) await navigator.serviceWorker.register("./holo-fhs-sw.js", { type: "module" }); } catch {} }).catch(() => {});
    let controlled = false;
    for (let i = 0; i < 200 && !controlled; i++) {
      controlled = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)).catch(() => false);
      if (!controlled) await page.waitForTimeout(100).catch(() => {});
    }
    rec("service worker takes control on a cold visit", controlled);
    if (!controlled) return;
    // reload so EVERY boot request — including the top-level document — flows through the worker, then let
    // the boot chain fan out. A mis-sealed image refuses (409) here; refuseClosure 409s EVERYTHING.
    await page.reload({ waitUntil: "load", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000);
    rec("no Safety-Stop (zero 409 refusals) during a cold boot under the worker",
      refused.length === 0, refused.length ? `${refused.length}× 409 — e.g. ${refused[0]}` : "0× 409");
    // P5 · offline-after-first-load: the OS claims to be serverless/offline. After one warm boot the worker
    // has cached the boot bytes; with the network CUT, a reload must still take control and serve the document
    // (not the browser's "no internet" page). This turns the serverless promise into a gate.
    let offlineOk = false, offlineDetail = "";
    try {
      await page.context().setOffline(true);
      await page.reload({ waitUntil: "load", timeout: 45000 }).catch((e) => { offlineDetail = e.message.split("\n")[0]; });
      offlineOk = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller) && document.readyState === "complete" && !!document.querySelector("body *")).catch(() => false);
    } finally { await page.context().setOffline(false); }
    rec("boots offline after first load (the serverless promise)", offlineOk, offlineOk ? "served the boot with no network" : (offlineDetail || "no SW control / empty document offline"));
  } finally { await browser.close(); }
}

// ── Phase C: the GATEWAY (the actual URL a user opens) ──────────────────────────────────────────────
// The root gateway (index.html) is served RAW by the host — outside the Service Worker AND outside the
// seal — so neither the artifact gate nor Phases A/B cover it. Yet it is the one surface a visitor lands
// on, and it FAILS CLOSED on its own (Law L5 self-certification): it re-derives its own bytes and refuses
// to boot if it can't (data-holo-certified, #enter disabled). A broken/unprovable gateway would strand
// every visitor with Power-up greyed out — invisible to A/B. This loads the real gateway and asserts it
// certifies and enables Power-up — closing the last unwitnessed boot surface (browser-only; if Playwright
// is unavailable this is skipped, like Phase B).
async function phaseC() {
  let pw;
  try { pw = await import("playwright"); }
  catch { return; }   // already reported by Phase B's skip notice
  let browser;
  try { browser = await (pw[ENGINE] || pw.chromium).launch(); }
  catch (e) { if (process.env.CI) rec(`launch ${ENGINE} for gateway check`, false, e.message); return; }
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(SITE, { waitUntil: "load", timeout: 60000 }).catch(() => {});
    let state = "pending";
    for (let i = 0; i < 100 && state === "pending"; i++) {   // the self-cert is async (fetch+hash own bytes)
      state = await page.evaluate(() => document.documentElement.getAttribute("data-holo-certified") || "pending").catch(() => "err");
      if (state === "pending") await sleep(100);
    }
    rec("gateway self-certifies (data-holo-certified=true)", state === "true", "state=" + state);
    const enterOk = await page.evaluate(() => { const e = document.getElementById("enter"); return !!e && !e.disabled; }).catch(() => false);
    rec("Power-up is enabled on the certified gateway", enterOk);
    const refusal = await page.evaluate(() => document.documentElement.getAttribute("data-holo-refusal") || "").catch(() => "");
    rec("no gateway certification refusal", !refusal, refusal ? "refusal=" + refusal : "clean");
  } finally { await browser.close(); }
}

(async () => {
  console.log(`cold-boot witness → ${OS}\n`);
  const live = await awaitBuild();
  if (live) { await phaseA(); await phaseB(); await phaseC(); }
  const ok = fail === 0;
  try { writeFileSync(join(here, "holo-cold-boot-witness.result.json"), JSON.stringify({ os: OS, expect: EXPECT || null, pass, fail, ok, results }, null, 2)); } catch {}
  console.log(`\n${ok ? "PASS" : "FAIL"} — ${pass} ok · ${fail} failed`);
  process.exit(ok ? 0 : 1);
})();
