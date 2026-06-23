#!/usr/bin/env node
// holo-q-vision-witness.mjs — THE RASTER EDGE, proven in pure Node.
//
// Rides the raster-edge specialist through the whole arc the browser would:
//   PRECEDENCE → a κ target is read from the graph; the engine is NEVER called (the regression guard)
//   PROMOTE    → raster pixels → OCR → a self-verifying κ-object → joined to the scene as a VISUAL face
//   GROUND     → the sealed κ carries the OCR text + ties to the exact pixels (capture hash); Q can cite it
//   STABLE     → same pixels → same κ (deterministic seal); different pixels → different κ
//   HONEST     → no bound engine ⇒ an honest null, never a fabricated read (Law L5)
//   BIND       → the specialist binds the mux 'vision' slot; resolveModel('vision') routes to it
//
//   node tools/holo-q-vision-witness.mjs
//
// Authority: ADR-0081 (perception) · ADR-0084 (mux vision specialist) · UOR envelope (holo-object) · Law L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { perceive, createVisionSpecialist, makeStubEngine, hashBytes } from "../os/usr/lib/holo/q/holo-q-vision.mjs";
import { createScene } from "../os/usr/lib/holo/q/holo-q-perception.js";
import { verify } from "../os/usr/lib/holo/holo-object.mjs";
import { bindSpecialist, routeTask, resolveModel, unbindAll } from "../os/usr/lib/holo/q/holo-q-mux.js";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── 1 · PRECEDENCE — a κ target is read from the graph; the engine is NEVER called ──
{
  const scene = createScene();
  const engine = makeStubEngine();
  const specialist = createVisionSpecialist({ engine });
  // a κ-native target (it already carries a κ — a holospace object, a plucked message, …)
  const r = await perceive({ id: "native-app", kappa: "did:holo:sha256:" + "a".repeat(64) }, { scene, specialist });
  ok("kappa-target-reads-graph-no-engine",
    r.source === "graph" && r.fromGraph === true && r.engineCalled === false && engine.calls() === 0,
    `${r.source} · engineCalls=${engine.calls()}`);

  // and a target whose id the scene already holds as a CODE face → also graph, also no engine
  scene.observeCode("known", "did:holo:sha256:" + "b".repeat(64));
  const r2 = await perceive({ id: "known" }, { scene, specialist });
  ok("scene-known-code-target-reads-graph", r2.source === "graph" && engine.calls() === 0, r2.source);
}

// ── 2 · PROMOTE — raster pixels become a self-verifying κ, joined to the scene as a VISUAL face ──
let promoted;
{
  const scene = createScene();
  const engine = makeStubEngine({ "CANVAS-DASHBOARD-PIXELS": "# Revenue\nQ4 total: $4.2M" });
  const specialist = createVisionSpecialist({ engine });
  promoted = await perceive({ id: "iframe#7", pixels: "CANVAS-DASHBOARD-PIXELS", hint: "revenue chart" }, { scene, specialist });
  const joined = scene.snapshot().find((e) => e.id === "iframe#7");
  ok("raster-promotes-to-verifying-kappa",
    promoted.source === "ocr" && promoted.engineCalled === true &&
    /^did:holo:sha256:[0-9a-f]{64}$/.test(promoted.kappa) &&
    verify(promoted.object) && promoted.object.id === promoted.kappa,
    promoted.kappa);
  ok("promoted-kappa-joins-scene-as-visual-face",
    !!joined && joined.visual === promoted.kappa && joined.code == null,
    joined ? `visual=${joined.visual}` : "no scene entry");
}

// ── 3 · GROUND — the κ carries the OCR text and ties to the exact pixels (capture hash) ──
{
  const expectCapture = await hashBytes("CANVAS-DASHBOARD-PIXELS");
  ok("kappa-grounds-on-text-and-pixels",
    promoted.object["schema:text"] === "# Revenue\nQ4 total: $4.2M" &&
    promoted.object["holo:source"] === "raster-ocr" &&
    promoted.object["holo:capture"] === expectCapture,
    promoted.object["holo:capture"]);
}

// ── 4 · STABLE — same pixels → same κ; different pixels → different κ (deterministic seal) ──
{
  const engine = makeStubEngine({ A: "# A", B: "# B" });
  const sp = createVisionSpecialist({ engine });
  const a1 = await perceive({ id: "x", pixels: "A" }, { specialist: sp });
  const a2 = await perceive({ id: "y", pixels: "A" }, { specialist: sp });   // identical pixels, different id
  const b1 = await perceive({ id: "z", pixels: "B" }, { specialist: sp });
  ok("deterministic-and-collision-honest",
    a1.kappa === a2.kappa && b1.kappa !== a1.kappa,
    `${a1.kappa.slice(0, 24)} vs ${b1.kappa.slice(0, 24)}`);
}

// ── 5 · HONEST — no bound engine ⇒ a null read, never a fabricated answer (Law L5) ──
{
  const scene = createScene();
  const empty = createVisionSpecialist({ engine: null });               // engine absent
  const r = await perceive({ id: "blank", pixels: "WHATEVER" }, { scene, specialist: empty });
  const noScene = scene.snapshot().find((e) => e.id === "blank");
  ok("no-engine-honest-null-never-fakes",
    r.source === "none" && r.kappa === null && !noScene, r.why || "");

  // and with no specialist at all → honest fallback to main, no scene mutation
  const r2 = await perceive({ id: "blank2", pixels: "WHATEVER" }, { scene });
  ok("no-specialist-falls-back-to-main", r2.source === "none" && r2.fallback === "main", r2.why || "");
}

// ── 6 · BIND — the specialist binds the mux 'vision' slot; resolveModel routes to it ──
{
  unbindAll();
  const before = resolveModel("vision");
  ok("vision-slot-unbound-falls-back-to-main", before.source === "main" && routeTask("vision").fallback === true, before.source);
  const sp = createVisionSpecialist({ engine: makeStubEngine() });
  bindSpecialist("vision", sp);
  const after = resolveModel("vision");
  ok("bound-specialist-routes-the-vision-slot",
    after.source === "override" && routeTask("vision").id === "unlimited-ocr",
    `${after.source} · ${after.id}`);
  unbindAll();
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "PRECEDENCE — a κ target (or a scene-known code face) is read from the graph; the engine is never called (the regression guard)",
    "PROMOTE — raster pixels → OCR → a self-verifying UOR κ-object (id = H(JCS)), joined to the perception scene as a VISUAL face",
    "GROUND — the κ carries the OCR text and the exact-pixels capture hash; Q grounds on and cites the κ",
    "STABLE — identical pixels → identical κ (deterministic seal); different pixels → a different κ (collision-honest)",
    "HONEST — no engine, or no specialist, ⇒ an honest null / main fallback; the scene is untouched; never fakes (Law L5)",
    "BIND — createVisionSpecialist binds the mux 'vision' slot; resolveModel('vision') + routeTask route to it; unbound → main",
  ],
  checks, failed: fail,
  authority: "ADR-0081 (perception scene) · ADR-0084 (mux vision specialist) · UOR object envelope (holo-object) · holospaces Law L5",
};
writeFileSync(join(here, "holo-q-vision-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Q Vision witness — the raster edge: where pixels become κ\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
