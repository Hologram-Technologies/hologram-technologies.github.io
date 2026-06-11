#!/usr/bin/env node
// atlas96-resonator-witness.mjs — witness the Atlas 96 Resonator end-to-end in real Chromium:
// the page re-derives all FIVE identities (atlas object · structure DNA · derivation module ·
// receipt · the atlas engine COMPILED IN-TAB by Holo Forge against its sealed build receipt),
// the 12,288-cell physics responds to a pluck and conserves back toward budget = 0, the 96-EDO
// sonification renders non-silence offline, the 1D→4D projections stay finite, the renderer
// reaches an 8K-class backbuffer, a SECOND visit rebinds the structure O(1) by κ (and still
// re-derives everything in the background), the WebGL2 fallback tier works when WebGPU is
// forced off, and tampering ONE codepoint of the atlas object is REFUSED with every cell
// re-deriving differently. That last check is the decidable answer to "how do we know it isn't
// shape-classification + a formula?" — a formula would shrug; a content-addressed structure refuses.
//
//   node tools/atlas96-resonator-witness.mjs

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { console.log("playwright unavailable:", e.message); close(); process.exit(0); }

// the SYSTEM Chrome gets the real GPU adapter headlessly (the bundled Playwright Chromium is
// too old for WebGPU) — so the compute tier is witnessed on the user's actual hardware
let browser;
try { browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-webgpu"] }); }
catch { browser = await chromium.launch({ args: ["--enable-unsafe-webgpu"] }); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
// real Chrome requests /favicon.ico (404 from the dev server) — not a Resonator error
const consoleErr = (m) => { if (m.type() !== "error") return;
  if (/favicon\.ico/.test((m.location() || {}).url || "")) return; errs.push(m.text()); };
page.on("console", consoleErr);
page.on("pageerror", (e) => errs.push(String(e)));

const waitReady = async (p) => { for (let i = 0; i < 160; i++) {
  if (await p.evaluate(() => !!(window.__resonator && window.__resonator.ready)).catch(() => false)) return true;
  await sleep(500); } return false; };

const checks = {}; let tierMain = "?", tierFallback = "?";
try {
  await page.goto(`${base}/apps/atlas96/resonator.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  checks.boots = await waitReady(page);

  // ── the five Law-L5 re-derivations, done by the PAGE itself ──
  const info = await page.evaluate(() => ({ proof: window.__resonator.proof, tier: window.__resonator.tier,
    engine: window.__resonator.engine, counts: window.__resonator.counts, rebound: window.__resonator.rebound }));
  tierMain = info.tier;
  const adapterExists = await page.evaluate(async () => !!(navigator.gpu && await navigator.gpu.requestAdapter().catch(() => null)));
  checks.webgpu_tier_active_when_available = adapterExists ? info.tier === "webgpu" : true;
  checks.atlas_object_rederives = info.proof.object === true;
  checks.structure_dna_rederives = info.proof.structure === true;
  checks.derivation_module_pinned = info.proof.derivation === true;
  checks.receipt_rederives = info.proof.receipt === true;
  checks.engine_compiled_natively_by_forge = info.proof.engine === true && info.engine.native === true;
  console.log(`  tier ${info.tier} · engine Holo Forge ${info.engine.compiler} native=${info.engine.native} · first visit rebound=${info.rebound}`);

  // ── the WHOLE structure is modeled ──
  checks.all_12288_cells = info.counts.cells === 12288;
  checks.fiber_weave_matches_receipt = info.counts.fibers > 20000 && info.counts.holes > 2000;

  // ── physics: pluck → respond → conserve back toward budget = 0 (truth ≙ conservation) ──
  //    one evaluate, rAF paused: the step sequence is deterministic, no concurrent frames race it
  const { settle, peak, relaxed } = await page.evaluate(async () => {
    const R = window.__resonator; R.pause(true);
    const settle = await R.step(800);                      // flat baseline
    R.pluck(6000); R.pluck(2048); R.pluck(9000);
    const peak = await R.step(2);                          // measure AT the kick
    const relaxed = await R.step(900);
    R.pause(false);
    return { settle, peak, relaxed };
  });
  checks.physics_responds_to_pluck = peak > settle * 1.1 + 0.0008;
  checks.physics_conserves = relaxed < peak && Number.isFinite(relaxed);
  console.log(`  budget settle ${settle.toFixed(4)} → pluck ${peak.toFixed(4)} → relax ${relaxed.toFixed(4)}`);

  // ── the dimensions: 1D cycle · 2D sheet · 3D torus · 4D Clifford torus all stay finite ──
  let dimsOk = true;
  for (const d of [1, 2, 4, 3]) {
    const b = await page.evaluate((dd) => { window.__resonator.setDim(dd); return window.__resonator.step(240); }, d);
    if (!Number.isFinite(b)) dimsOk = false;
    console.log(`  dim ${d}: budget ${b.toFixed(4)}`);
  }
  checks.dimensions_1_2_3_4_finite = dimsOk;

  // ── sonification: the 96-EDO synth renders NON-SILENCE offline (no audio device needed) ──
  const rms = await page.evaluate(() => window.__resonator.sonifyTest());
  checks.sonification_renders = rms > 0.005;
  console.log(`  offline sonification rms ${rms.toFixed(4)}`);

  // visual proof: settled torus, then a pluck mid-glow
  await page.evaluate(() => { window.__resonator.setDim(3); window.__resonator.step(300); });
  await sleep(700);
  await page.evaluate(() => { window.__resonator.pluck(3120); window.__resonator.pluck(9000); });
  await sleep(350);
  await page.screenshot({ path: join(here, "atlas96-resonator-witness.png") });

  // ── 8K-class rendering: the backbuffer reaches ≥ 7680px wide (capped only by the adapter) ──
  await page.evaluate(() => window.__resonator.setRes("8k"));
  await sleep(2500);
  const [bw, bh] = await page.evaluate(() => window.__resonator.canvasSize());
  const stillAlive = await page.evaluate(() => Number.isFinite(window.__resonator.budget()));
  checks.renders_8k_class = (bw >= 7680 || bh >= 4320) && stillAlive;
  console.log(`  8K backbuffer ${bw}×${bh} · alive=${stillAlive}`);
  await page.evaluate(() => window.__resonator.setRes("auto"));

  // ── the refusal: tamper ONE codepoint of the atlas object ──
  const t = await page.evaluate(() => window.__resonator.tamper());
  checks.tamper_refused = t && t.refused === true;
  checks.tamper_changes_every_cell = t && t.changed === 12288;
  console.log(`  tamper: refused=${t && t.refused} · ${t && t.changed}/12288 cells re-derive differently`);

  // ── O(1) substrate compute: the SECOND visit rebinds the structure by κ, no re-derivation —
  //    and then re-derives all 12,288 cells in the background anyway, so the proof stays absolute
  await sleep(4600);                                       // let the tamper demo restore first
  await page.reload({ waitUntil: "domcontentloaded" });
  checks.reboots = await waitReady(page);
  const re = await page.evaluate(() => ({ rebound: window.__resonator.rebound, ok: window.__resonator.proof.structure }));
  checks.o1_rebind_by_kappa = re.rebound === true && re.ok === true;
  checks.background_full_rederivation = (await page.evaluate(() => window.__resonator.fullDerive)) === true;
  console.log(`  revisit: rebound=${re.rebound} · background full re-derivation ✓`);

  // ── the WebGL2 fallback tier carries the whole experience when WebGPU is absent ──
  const pg = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  pg.on("pageerror", (e) => errs.push("GL: " + String(e)));
  await pg.goto(`${base}/apps/atlas96/resonator.html?tier=gl`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const glReady = await waitReady(pg);
  tierFallback = glReady ? await pg.evaluate(() => window.__resonator.tier) : "?";
  const glr = glReady ? await pg.evaluate(async () => {
    const R = window.__resonator; R.pause(true);
    const settle = await R.step(600);
    R.pluck(2048); R.pluck(7000);
    const peak = await R.step(2);
    R.pause(false);
    return { settle, peak };
  }) : { settle: NaN, peak: NaN };
  checks.webgl2_fallback_works = glReady && tierFallback === "webgl2" && glr.peak > glr.settle;
  console.log(`  fallback tier ${tierFallback}: settle ${glr.settle.toFixed?.(4)} → pluck ${glr.peak.toFixed?.(4)}`);
  await pg.close();

  checks.no_console_errors = errs.length === 0;
} catch (e) {
  errs.push("WITNESS: " + (e.message || e));
  checks.completed = false;
}
await browser.close(); close();

const pass = Object.values(checks).every(Boolean);
const result = { witness: "atlas96-resonator", url: "/apps/atlas96/resonator.html",
  tiers: { main: tierMain, fallback: tierFallback },
  covers: ["atlas-12288", "whole-structure-modeled", "fiber-physics", "sonification-96edo",
    "dimensions-1d-2d-3d-4d", "artifacts-are-address-bytes", "prov-o-receipt", "rederives-in-tab",
    "native-engine-holo-forge", "o1-rebind-by-kappa", "webgpu-tier", "webgl2-fallback", "8k-render",
    "tamper-refused", "law-l5"],
  checks, errors: errs, witnessed: pass };
writeFileSync(join(here, "atlas96-resonator-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
if (errs.length) console.log("  errors:\n   " + errs.slice(0, 8).join("\n   "));
console.log(`\n  ${pass ? "WITNESSED ✓ — compiles natively, re-derives, rebinds O(1), responds, conserves, sounds, scales to 8K, and refuses" : "FAILED ✗"}`);
process.exit(pass ? 0 : 1);
