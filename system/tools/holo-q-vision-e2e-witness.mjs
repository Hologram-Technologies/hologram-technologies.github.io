#!/usr/bin/env node
// holo-q-vision-e2e-witness.mjs — THE WHOLE BROWSER-TIER LOOP, end to end, in pure Node. Proves the
// magic the user asked for: it just works, fast, with ZERO user action, across every layer at once.
//
//   DOM surfaces  →  capture (raster-island source)  →  ambient.notice  →  ONE heartbeat tick  →
//   perceive (OCR via stub engine)  →  seal κ  →  scene VISUAL face  →  omni-index (searchable)
//
//   • a κ-tagged surface is skipped at the SOURCE (never enters the loop) — precedence end to end
//   • a cross-origin <img> is skipped (unreadable pixels) — honest, deferred to the native CDP leg
//   • the user does nothing; after ticks, a foreign canvas's text is searchable and the scene coheres
//
//   node tools/holo-q-vision-e2e-witness.mjs
//
// Authority: ADR-0081 (perception) · ADR-0084 (mux + one ambient loop) · holo-omni-index · Law L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createCapture, planScan } from "../os/usr/lib/holo/q/holo-q-vision-capture.mjs";
import { wireAmbientPerception } from "../os/usr/lib/holo/q/holo-q-vision-boot.mjs";
import { createVisionSpecialist, makeStubEngine } from "../os/usr/lib/holo/q/holo-q-vision.mjs";
import { createScene } from "../os/usr/lib/holo/q/holo-q-perception.js";
import { makeAmbient } from "../os/usr/lib/holo/holo-ambient.mjs";
import { record as omniRecord, search as omniSearch } from "../os/sbin/holo-omni-index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── a fake "page": four on-screen surfaces, exactly the mix the real DOM presents ──
const SURFACES = [
  { tag: "canvas", id: "chart",   w: 320, h: 200, hint: "revenue chart" },                       // raster → promote
  { tag: "video",  id: "clip",    w: 640, h: 360, hint: "a paused video frame" },                 // raster → promote
  { tag: "img",    id: "remote",  w: 100, h: 100, crossOrigin: true, hint: "cross-origin logo" }, // skip (native leg)
  { tag: "div",    id: "ui",      w: 50,  h: 50,  kappa: "did:holo:sha256:" + "d".repeat(64) },   // not raster at all
  { tag: "canvas", id: "native",  w: 80,  h: 80,  kappa: "did:holo:sha256:" + "e".repeat(64) },   // raster BUT κ → skip
];
// what each readable surface "shows" once OCR'd (the stub maps pixels→markdown deterministically)
const PIXELS = { chart: "CHART-PIXELS", clip: "VIDEO-PIXELS" };
const OCR = { "CHART-PIXELS": "# Revenue\nQ4 $4.2M", "VIDEO-PIXELS": "# Scene 3\nthe hero speaks" };

// ── 0 · SOURCE precedence — the pure planner skips κ-native + cross-origin before any work ──
{
  const plan = planScan(SURFACES, {});
  const ids = plan.islands.map((i) => i.id).sort();
  const skipReasons = Object.fromEntries(plan.skipped.map((s) => [s.id, s.reason]));
  ok("source-plans-only-readable-raster-islands",
    JSON.stringify(ids) === JSON.stringify(["chart", "clip"]) &&
    skipReasons.native === "kappa-native" && skipReasons.remote === "cross-origin-pixels-unreadable",
    `${ids} | ${JSON.stringify(skipReasons)}`);
}

// ── 1 · THE WHOLE LOOP — wire it like the browser does, then just let the heartbeat run ──
const scene = createScene();
const engine = makeStubEngine(OCR);
const specialist = createVisionSpecialist({ engine });
const ambient = makeAmbient();

// real omni-index over an injected in-memory store (photographic memory, no localStorage)
const T = 1_700_000_000_000, mem = [];
const store = { get: () => [...mem], set: (a) => { mem.length = 0; mem.push(...a); }, now: () => T };
const index = { record: (e) => omniRecord(e, store), search: (q) => omniSearch(q, { store, now: T }) };

// the ambient watcher, driven by the ONE heartbeat (selfSchedule:false inside)
const live = wireAmbientPerception({ ambient, scene, specialist, index });

// the browser-tier capture source: enumerate returns our fake page; rasterize maps id→pixels (same-origin only)
const capture = createCapture({
  notice: (island) => live.notice(island),
  enumerate: () => SURFACES,
  rasterize: async (island) => PIXELS[island.id] != null ? PIXELS[island.id] : null,
});
// the capture scan is itself a faculty of the one loop (every tick here, for the witness)
ambient.register("scan-raster-edge", () => capture.scan(), { everyTicks: 1 });

// THE USER DOES NOTHING. Just heartbeats. (tick 1 scans+notices; subsequent ticks drain one island each.)
let promotedText = [];
for (let i = 0; i < 5; i++) await ambient.tick();

const chart = scene.snapshot().find((e) => e.id === "chart");
const clip = scene.snapshot().find((e) => e.id === "clip");
ok("zero-action-promotes-readable-surfaces-to-kappa",
  chart && /^did:holo:sha256:[0-9a-f]{64}$/.test(chart.visual) &&
  clip && /^did:holo:sha256:[0-9a-f]{64}$/.test(clip.visual) &&
  engine.calls() === 2,
  `chart=${chart && chart.visual ? "κ" : "—"} clip=${clip && clip.visual ? "κ" : "—"} calls=${engine.calls()}`);

ok("native-and-crossorigin-never-ocrd",
  !scene.snapshot().find((e) => e.id === "native") &&                 // κ-tagged canvas: skipped at the source
  !scene.snapshot().find((e) => e.id === "remote") &&                 // cross-origin img: skipped at the source
  engine.calls() === 2,                                               // only the two readable surfaces ever reached OCR
  `engineCalls=${engine.calls()} stats=${JSON.stringify(capture.stats())}`);

ok("scene-coherent-no-drift", scene.feedback().drift.length === 0, JSON.stringify(scene.feedback()));

// ── 2 · PHOTOGRAPHIC — what was only ever pixels is now found by a text search (zero input) ──
{
  const hitR = index.search("revenue");
  const hitV = index.search("hero");
  ok("perceived-pixels-now-searchable",
    hitR.length >= 1 && /Revenue/.test(hitR[0].title) && hitR[0].kappa === scene.snapshot().find((e) => e.id === "chart").visual &&
    hitV.length >= 1 && /Scene 3/.test(hitV[0].title),
    `${hitR[0] && hitR[0].title} | ${hitV[0] && hitV[0].title}`);
}

// ── 3 · FAST / FREE RE-SEE — another full sweep promotes nothing new and never re-calls the engine ──
{
  const before = engine.calls();
  for (let i = 0; i < 5; i++) await ambient.tick();                  // the page hasn't changed
  ok("steady-state-is-free-no-reocr",
    engine.calls() === before && live.stats().skippedMemo >= 2,
    `calls stayed ${engine.calls()} · memoHits=${live.stats().skippedMemo}`);
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "SOURCE — the pure planner emits only readable raster islands; κ-native and cross-origin surfaces are skipped before any work (precedence end to end)",
    "WHOLE LOOP — DOM surfaces → capture → ambient.notice → ONE heartbeat → perceive → seal κ → scene VISUAL face, with ZERO user action",
    "HONEST — a cross-origin <img> is unreadable and is skipped (deferred to the native CDP leg), never faked; a κ-tagged canvas is never OCR'd",
    "COHERENT — the scene has no drift after promotion",
    "PHOTOGRAPHIC — surfaces that were only ever pixels are found by a later text search via the real holo-omni-index",
    "FAST / FREE RE-SEE — an unchanged page re-sweeps for free: the capture-hash memo means the engine is never called again",
  ],
  checks, failed: fail,
  authority: "ADR-0081 · ADR-0084 · holo-omni-index · holo-ambient · holospaces Law L5",
};
writeFileSync(join(here, "holo-q-vision-e2e-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Q Vision E2E witness — the whole browser-tier loop, zero user action\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
