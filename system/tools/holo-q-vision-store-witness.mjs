#!/usr/bin/env node
// holo-q-vision-store-witness.mjs — PERCEPTION AS SUBSTRATE: every perceived κ lives in the OS κ-store,
// so re-seeing anything is an O(1), L5-verified substrate read — no model, persistent across sessions.
//   ROUNDTRIP → put a perception object, get(captureHash) returns it; κ == object.id (content address)
//   L5 REFUSE → corrupt the stored bytes → get returns null (verify-before-trust; never silently trusts)
//   PERSIST   → a NEW session (fresh watcher, fresh engine) re-seeing the SAME pixels is a κ-store HIT —
//               the engine is NEVER called again; the scene re-coheres and it stays searchable. O(1).
//
//   node tools/holo-q-vision-store-witness.mjs
//
// Authority: ADR-0081 (perception) · UOR κ-store (holo-opfs-kappastore / holo-object) · Law L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPerceptionCache } from "../os/usr/lib/holo/q/holo-q-vision-store.mjs";
import { createAmbientPerception } from "../os/usr/lib/holo/q/holo-q-vision-ambient.mjs";
import { perceive, createVisionSpecialist, makeStubEngine, hashBytes } from "../os/usr/lib/holo/q/holo-q-vision.mjs";
import { createScene } from "../os/usr/lib/holo/q/holo-q-perception.js";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// a persistent content-addressed KV (Map tier) — shared across the "sessions" below to model reload/roam
function backend() {
  const m = new Map();
  return { kv: { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v); } }, _m: m };
}

// ── 1 · ROUNDTRIP — put a perception object; get by capture hash; κ == object.id ──
const PIX = "SCANNED-PAGE-PIXELS";
const capHash = await hashBytes(PIX);
let storedKappa;
{
  const be = backend();
  const cache = createPerceptionCache(be);
  // mint a perception object exactly as the specialist would
  const eng = makeStubEngine({ [PIX]: "# Contract\nparty A agrees to terms" });
  const sp = createVisionSpecialist({ engine: eng });
  const r = await sp.infer({ imageBytes: PIX });
  storedKappa = await cache.put(capHash, r.object);
  const hit = await cache.get(capHash);
  ok("roundtrip-kappa-equals-object-id",
    storedKappa === r.object.id && hit && hit.kappa === storedKappa &&
    hit.object["schema:text"] === "# Contract\nparty A agrees to terms",
    storedKappa);
  global.__be = be;   // reuse this backend's bytes for the tamper test
}

// ── 2 · L5 REFUSE — corrupt the stored object → get returns null (verify-before-trust) ──
{
  const be = global.__be;
  const cache = createPerceptionCache(be);
  // overwrite the stored object with a forgery that keeps the id but changes the content (won't re-derive)
  be.kv.set("obj:" + storedKappa, JSON.stringify({ id: storedKappa, "@type": "holo:Perception", "schema:text": "TAMPERED" }));
  const hit = await cache.get(capHash);
  ok("tampered-store-entry-refused-L5", hit === null && cache.stats().refused >= 1, JSON.stringify(cache.stats()));
}

// ── 3 · PERSIST — a NEW session re-seeing the same pixels is a κ-store HIT; the engine is never recalled ──
{
  const be = backend();
  // SESSION A: perceive fresh (engine called once), persist into the κ-store
  {
    const cache = createPerceptionCache(be);
    const scene = createScene();
    const engine = makeStubEngine({ [PIX]: "# Invoice\ntotal $42" });
    const live = createAmbientPerception({ scene, perceive, specialist: createVisionSpecialist({ engine }), cache, selfSchedule: false });
    await live.notice({ id: "doc", pixels: PIX, hint: "scan" });
    await live.drain();   // driven mode: one fully-awaited pump (perceive → seal → persist into the κ-store)
    ok("session-A-perceives-and-persists", engine.calls() === 1 && live.stats().promoted === 1 && be._m.has("cap:" + capHash), `calls=${engine.calls()} keys=${be._m.size}`);
  }
  // SESSION B: brand-new watcher + brand-new engine sharing the SAME κ-store backend
  {
    const cache = createPerceptionCache(be);
    const scene = createScene();
    const engine = makeStubEngine({ [PIX]: "# Invoice\ntotal $42" });
    const hits = [];
    const index = { record: (e) => hits.push(e) };
    const live = createAmbientPerception({ scene, perceive, specialist: createVisionSpecialist({ engine }), cache, index, selfSchedule: false });
    const res = await live.notice({ id: "doc-again", pixels: PIX, hint: "scan" });   // SAME pixels, new session → cache hit IN notice()
    const entry = scene.snapshot().find((e) => e.id === "doc-again");
    ok("session-B-is-a-kappa-store-hit-no-engine",
      res.reason === "kappa-store" && res.kappa === be.kv.get("cap:" + capHash) &&
      engine.calls() === 0 &&                                                          // ← the engine was NEVER called
      entry && entry.visual === res.kappa &&                                           // ← scene re-cohered from the store
      hits.length === 1 && /Invoice/.test(hits[0].title),                              // ← still searchable
      `reason=${res.reason} calls=${engine.calls()}`);
  }
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "ROUNDTRIP — a perceived object is stored in the κ-store by its κ (κ == object.id, content-addressed) and retrieved by its pixels' capture hash",
    "L5 REFUSE — a tampered κ-store entry fails verify-before-trust and is refused (returns null → it will be re-perceived honestly, never silently trusted)",
    "PERSIST — a brand-new session/watcher re-seeing the SAME pixels is an O(1) κ-store hit: the OCR engine is never called again, the scene re-coheres from the stored κ, and it stays searchable",
  ],
  checks, failed: fail,
  authority: "ADR-0081 (perception) · UOR κ-store (holo-opfs-kappastore MemKappaStore / holo-object) · holospaces Law L5",
};
writeFileSync(join(here, "holo-q-vision-store-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Q Vision store witness — perception as substrate (O(1), persistent, L5)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
