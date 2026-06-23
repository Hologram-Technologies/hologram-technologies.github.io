#!/usr/bin/env node
// holo-q-vision-boot-witness.mjs — LIVE WIRING, proven against the REAL ambient authority. Shows that
// the raster edge rides the ONE heartbeat (holo-ambient.makeAmbient) as a single faculty — no private
// timer — and promotes a noticed island with zero user verb, paced by the loop's tick.
//   WIRED    → wireAmbientPerception registers exactly one "perceive-raster-edge" faculty on the loop
//   HEARTBEAT→ notice() does NOT run the engine inline; a single ambient tick() drains one island → κ
//   COHERENT → the promoted κ joins the live perception scene as a VISUAL face
//   INERT    → with no specialist bound, the faculty is harmless (no promotion, no throw)
//
//   node tools/holo-q-vision-boot-witness.mjs
//
// Authority: ADR-0084 (one ambient loop, S1) · ADR-0081 (perception) · Law L5 (never fakes).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { wireAmbientPerception } from "../os/usr/lib/holo/q/holo-q-vision-boot.mjs";
import { createVisionSpecialist, makeStubEngine } from "../os/usr/lib/holo/q/holo-q-vision.mjs";
import { createScene } from "../os/usr/lib/holo/q/holo-q-perception.js";
import { makeAmbient } from "../os/usr/lib/holo/holo-ambient.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── WIRED + HEARTBEAT + COHERENT — one faculty on the real loop; a tick promotes a noticed island ──
{
  const ambient = makeAmbient();
  const scene = createScene();
  const engine = makeStubEngine({ "FOREIGN-CANVAS": "# Live\nzero-verb, driven by the one heartbeat" });
  const specialist = createVisionSpecialist({ engine });
  const live = wireAmbientPerception({ ambient, scene, specialist });

  ok("wires-one-faculty-on-the-real-loop",
    !!live && ambient.faculties().filter((f) => f.name === "perceive-raster-edge").length === 1,
    JSON.stringify(ambient.faculties().map((f) => f.name)));

  await live.notice({ id: "tab#x", pixels: "FOREIGN-CANVAS", hint: "foreign canvas" });
  const inlineCalls = engine.calls();                                 // must be 0 — notice never runs the engine inline
  await ambient.tick();                                               // ONE heartbeat drains one island
  const entry = scene.snapshot().find((e) => e.id === "tab#x");
  ok("heartbeat-drains-noticed-island-zero-verb",
    inlineCalls === 0 && engine.calls() === 1 &&
    !!entry && /^did:holo:sha256:[0-9a-f]{64}$/.test(entry.visual),
    `inline=${inlineCalls} after=${engine.calls()}`);
  ok("promoted-kappa-is-visual-face-coherent",
    !!entry && entry.code == null && entry.visual && scene.feedback().drift.length === 0,
    entry ? entry.visual : "no entry");
}

// ── INERT — no specialist bound ⇒ the faculty exists but promotes nothing and never throws (L5) ──
{
  const ambient = makeAmbient();
  const scene = createScene();
  const live = wireAmbientPerception({ ambient, scene, specialist: null });
  await live.notice({ id: "tab#y", pixels: "WHATEVER" });
  let threw = false;
  try { await ambient.tick(); } catch { threw = true; }
  const entry = scene.snapshot().find((e) => e.id === "tab#y");
  ok("inert-without-engine-no-promotion-no-throw", !threw && !entry && live.stats().promoted === 0, threw ? "threw" : "clean");
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "WIRED — wireAmbientPerception registers exactly one 'perceive-raster-edge' faculty on the real makeAmbient() loop (no private timer)",
    "HEARTBEAT — notice() never runs the engine inline; a single ambient.tick() drains one island and promotes it to a κ",
    "COHERENT — the promoted κ joins the live perception scene as a VISUAL face with no drift",
    "INERT — with no specialist bound, the faculty exists but promotes nothing and never throws (fail-soft, Law L5)",
  ],
  checks, failed: fail,
  authority: "ADR-0084 (one ambient loop) · ADR-0081 (perception) · holo-ambient · holospaces Law L5",
};
writeFileSync(join(here, "holo-q-vision-boot-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Q Vision boot witness — the raster edge rides the ONE heartbeat\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
