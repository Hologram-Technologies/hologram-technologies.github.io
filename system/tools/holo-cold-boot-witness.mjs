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
// ── Phase B: a real cold boot THROUGH THE GATEWAY (the URL a visitor actually opens) ────────────────
// Redirect-proof + GPU-independent. We do NOT navigate /os/ directly (os/index.html does location.replace
// → a race that's flaky pre-publish); instead we open the gateway, let it self-certify (Law L5), press
// Power-up, and let the boot chain (Plymouth → SDDM → shell) fan out through the worker — OBSERVING THE
// WIRE the whole time. A Safety-Stop IS an HTTP 409 from the worker; a boot-breaking regression throws a
// SyntaxError/ReferenceError. We gate on exactly those two (not generic pageerrors — a headless/GPU-less
// runner emits those benignly). This same flow works pre-publish (serving _site) and post-deploy (live).
async function phaseB() {
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { console.log("\n(playwright not installed — browser cold-boot skipped; Phase A is still fatal)"); return; }
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) {
    // In CI the browser is installed, so a launch failure is a real setup fault → FAIL (never let the
    // gate silently degrade to network-only). Locally without a browser binary, skip and rely on Phase A.
    if (process.env.CI) { rec("launch chromium for cold-boot", false, e.message); return; }
    console.log(`\n(chromium not launchable locally — browser cold-boot skipped: ${e.message})`); return;
  }
  try {
    const page = await (await browser.newContext()).newPage();   // fresh profile = a genuinely cold first visit
    const refused = [], fatal = [];
    page.on("response", (r) => { if (r.status() === 409) refused.push(r.url().replace(/^https?:\/\/[^/]+/, "")); });
    page.on("pageerror", (e) => { const s = String(e); if (/SyntaxError|ReferenceError|Unexpected token|is not defined/.test(s)) fatal.push(s.slice(0, 140)); });
    // 1) the gateway (served raw — outside the SW + the seal) self-certifies before it will boot.
    await page.goto(SITE, { waitUntil: "load", timeout: 60000 }).catch(() => {});
    let state = "pending";
    for (let i = 0; i < 120 && state === "pending"; i++) {
      state = await page.evaluate(() => document.documentElement.getAttribute("data-holo-certified") || "pending").catch(() => "pending");
      if (state === "pending") await sleep(100);
    }
    rec("gateway self-certifies (data-holo-certified=true)", state === "true", "state=" + state);
    const enterOk = await page.evaluate(() => { const e = document.getElementById("enter"); return !!e && !e.disabled; }).catch(() => false);
    rec("Power-up is enabled on the certified gateway", enterOk);
    // 2) press Power-up → the boot chain fans out THROUGH the worker; watch the wire.
    if (enterOk) { await page.click("#enter", { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(14000); }
    rec("no Safety-Stop (zero 409 refusals) during a cold boot", refused.length === 0, refused.length ? `${refused.length}× 409 — e.g. ${refused[0]}` : "0× 409");
    rec("no fatal boot error (syntax/reference)", fatal.length === 0, fatal.length ? fatal[0] : "clean");
  } finally { await browser.close(); }
}

(async () => {
  console.log(`cold-boot witness → ${OS}\n`);
  const live = await awaitBuild();
  if (live) { await phaseA(); await phaseB(); }
  const ok = fail === 0;
  try { writeFileSync(join(here, "holo-cold-boot-witness.result.json"), JSON.stringify({ os: OS, expect: EXPECT || null, pass, fail, ok, results }, null, 2)); } catch {}
  console.log(`\n${ok ? "PASS" : "FAIL"} — ${pass} ok · ${fail} failed`);
  process.exit(ok ? 0 : 1);
})();
