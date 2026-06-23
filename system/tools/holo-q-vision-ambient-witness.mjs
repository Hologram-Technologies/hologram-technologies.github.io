#!/usr/bin/env node
// holo-q-vision-ambient-witness.mjs — AMBIENT PERCEPTION, proven in pure Node: it just works, fast,
// with ZERO user action. Drives the background watcher through the magic the browser would show:
//   ZERO-VERB → notice() a raster island, do nothing else; at idle it becomes a κ, the scene goes coherent
//   PRECEDENCE → a κ-native island is never enqueued, never OCR'd
//   FREE RE-SEE → identical pixels are an O(1) memo hit; the engine is not called again
//   IDLE-ONLY + PREEMPT → the cold lane never runs on the interaction path; a user interaction pauses it
//   PHOTOGRAPHIC → a promoted κ is searchable forever via the real holo-omni-index
//   PROVENANCE → the promotion is a signed entry on the operator strand (holo-strand-provenance)
//   RANK → higher-scored islands (rank-to-you) are promoted first
//
//   node tools/holo-q-vision-ambient-witness.mjs
//
// Authority: ADR-0081 (perception) · ADR-0084 (mux) · holo-omni-index · holo-strand-provenance · Law L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createAmbientPerception } from "../os/usr/lib/holo/q/holo-q-vision-ambient.mjs";
import { perceive, createVisionSpecialist, makeStubEngine } from "../os/usr/lib/holo/q/holo-q-vision.mjs";
import { createScene } from "../os/usr/lib/holo/q/holo-q-perception.js";
import { record as omniRecord, search as omniSearch } from "../os/sbin/holo-omni-index.mjs";
import { recordIngest, provenanceOf } from "../os/usr/lib/holo/holo-strand-provenance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── controllable idle: tasks queue here and run ONLY when we flushIdle() — models requestIdleCallback ──
function makeIdle() {
  const q = [];
  const idle = (fn) => q.push(fn);
  const flush = async () => { while (q.length) { const fn = q.shift(); await fn(); } };
  return { idle, flush, pending: () => q.length };
}
// an in-memory omni-index store (the real record/search logic, injected store — never touches localStorage)
function makeIndex(T) {
  const mem = [];
  const store = { get: () => [...mem], set: (a) => { mem.length = 0; mem.push(...a); }, now: () => T };
  return { record: (e) => omniRecord(e, store), search: (q) => omniSearch(q, { store, now: T, limit: 12 }), _mem: mem };
}
// a fake operator strand (the real provenance logic rides its public append/replay surface)
function makeStrand() {
  const entries = [];
  return {
    append: async (e) => { const row = { kind: e.kind, "holstr:payload": e.payload }; entries.push(row); return row; },
    replay: ({ kind } = {}) => entries.filter((x) => !kind || x.kind === kind),
    _entries: entries,
  };
}

// ── 1 · ZERO-VERB — notice a raster island, do nothing; at idle it becomes a κ, the scene coheres ──
{
  const scene = createScene();
  const engine = makeStubEngine({ "FOREIGN-PAGE-PIXELS": "# Foreign site\nHello from a cross-origin page." });
  const specialist = createVisionSpecialist({ engine });
  const { idle, flush } = makeIdle();
  const amb = createAmbientPerception({ scene, perceive, specialist, idle });

  await amb.notice({ id: "tab#foreign", pixels: "FOREIGN-PAGE-PIXELS", hint: "foreign site" });
  // the user did nothing else. NOTHING has happened on the hot path yet:
  const beforeFlush = engine.calls();
  await flush();                                                       // idle arrives
  const entry = scene.snapshot().find((e) => e.id === "tab#foreign");
  const fb = scene.feedback();
  ok("zero-verb-promotes-at-idle",
    beforeFlush === 0 && engine.calls() === 1 && amb.stats().promoted === 1 &&
    !!entry && /^did:holo:sha256:[0-9a-f]{64}$/.test(entry.visual),
    `beforeFlush=${beforeFlush} promoted=${amb.stats().promoted}`);
  ok("scene-becomes-coherent-no-drift", fb.visualOnly + fb.coherent >= 1 && fb.drift.length === 0, JSON.stringify(fb));
}

// ── 2 · PRECEDENCE — a κ-native island is never enqueued, never OCR'd ──
{
  const engine = makeStubEngine();
  const specialist = createVisionSpecialist({ engine });
  const { idle, flush } = makeIdle();
  const amb = createAmbientPerception({ perceive, specialist, idle });
  await amb.notice({ id: "native", kappa: "did:holo:sha256:" + "c".repeat(64), pixels: "IGNORED" });
  await flush();
  ok("kappa-island-never-ocrd",
    amb.stats().skippedKappa === 1 && amb.stats().enqueued === 0 && engine.calls() === 0,
    JSON.stringify(amb.stats()));
}

// ── 3 · FREE RE-SEE — identical pixels are an O(1) memo hit; the engine is not called again ──
{
  const engine = makeStubEngine({ SAME: "# same pixels" });
  const specialist = createVisionSpecialist({ engine });
  const { idle, flush } = makeIdle();
  const amb = createAmbientPerception({ perceive, specialist, idle });
  await amb.notice({ id: "a", pixels: "SAME" });
  await flush();
  const afterFirst = engine.calls();
  const second = await amb.notice({ id: "b", pixels: "SAME" });        // same pixels, different surface id
  await flush();
  ok("identical-pixels-free-memo-hit",
    afterFirst === 1 && engine.calls() === 1 && second.reason === "memo" && amb.stats().skippedMemo === 1,
    `calls=${engine.calls()} reason=${second.reason}`);
}

// ── 4 · IDLE-ONLY + PREEMPT — never on the hot path; a user interaction pauses the cold lane ──
{
  const engine = makeStubEngine({ P: "# idle work" });
  const specialist = createVisionSpecialist({ engine });
  const { idle, flush } = makeIdle();
  const amb = createAmbientPerception({ perceive, specialist, idle });

  await amb.notice({ id: "p", pixels: "P" });
  const ranOnNotice = engine.calls();                                  // must be 0 — notice never runs the engine inline
  amb.interaction();                                                   // the user starts doing something
  await flush();                                                       // idle fires, but we are preempted
  const duringInteraction = engine.calls();                           // still 0 — the cold lane yielded
  amb.resume();                                                        // the user goes idle again
  await flush();
  const afterResume = engine.calls();
  ok("idle-only-and-preemptible",
    ranOnNotice === 0 && duringInteraction === 0 && afterResume === 1,
    `notice=${ranOnNotice} interaction=${duringInteraction} resume=${afterResume}`);
}

// ── 5 · PHOTOGRAPHIC + 6 · PROVENANCE — promoted κ is searchable forever AND signed on the strand ──
{
  const T = 1_700_000_000_000;
  const scene = createScene();
  const engine = makeStubEngine({ "SCANNED-INVOICE": "# Invoice 1042\nAcme Corp — total due $980" });
  const specialist = createVisionSpecialist({ engine });
  const { idle, flush } = makeIdle();
  const index = makeIndex(T);
  const strand = makeStrand();
  const provenance = { append: (m) => recordIngest(strand, { source: m.source, name: m.name, kind: m.kind, view: m.view, bytes: m.bytes }) };
  const amb = createAmbientPerception({ scene, perceive, specialist, index, provenance, idle });

  await amb.notice({ id: "pdf#1", pixels: "SCANNED-INVOICE", hint: "invoice" });
  await flush();
  const kappa = scene.snapshot().find((e) => e.id === "pdf#1").visual;

  const hits = index.search("invoice");                               // "find where it said X" — retroactively
  ok("promoted-kappa-searchable-forever",
    hits.length >= 1 && hits[0].kappa === kappa && /Invoice 1042/.test(hits[0].title),
    hits[0] && hits[0].title);

  const prov = provenanceOf(strand, kappa);                           // a signed, replayable perception event
  ok("promotion-recorded-on-operator-strand",
    !!prov && prov.kind === "ingest" && prov["holstr:payload"].source === kappa && prov["holstr:payload"].kind === "perception",
    prov ? prov["holstr:payload"].name : "no provenance entry");
}

// ── 7 · RANK — higher-scored islands (rank-to-you) are promoted first ──
{
  const engine = makeStubEngine({ LOW: "# low", HIGH: "# high" });
  const specialist = createVisionSpecialist({ engine });
  const { idle, flush } = makeIdle();
  const order = [];
  // wrap perceive to record promotion order
  const tracked = async (island, opts) => { const r = await perceive(island, opts); if (r.source === "ocr") order.push(island.id); return r; };
  const score = (island) => (island.hint === "important" ? 10 : 1);   // rank-to-you
  const amb = createAmbientPerception({ perceive: tracked, specialist, score, idle });

  await amb.notice({ id: "low", pixels: "LOW", hint: "trivia" });     // noticed first…
  await amb.notice({ id: "high", pixels: "HIGH", hint: "important" }); // …but this outranks it
  await flush();
  ok("rank-to-you-promotes-important-first", order[0] === "high" && order[1] === "low", order.join(","));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "ZERO-VERB — notice() a raster island and do nothing; at idle it auto-promotes to a κ and the scene becomes coherent (no drift)",
    "PRECEDENCE — a κ-native island is never enqueued and never OCR'd (the regression guard holds in the ambient layer)",
    "FREE RE-SEE — identical pixels are an O(1) memo hit; the engine is not called again",
    "IDLE-ONLY + PREEMPT — the cold lane never runs inline on notice(); a user interaction pauses it; resume() continues at idle",
    "PHOTOGRAPHIC — a promoted κ is recorded in the real holo-omni-index and is found by a later text search (retroactive recall)",
    "PROVENANCE — the promotion appends a signed, replayable ingest entry on the operator strand (holo-strand-provenance)",
    "RANK — rank-to-you scoring promotes the important island before the trivial one",
  ],
  checks, failed: fail,
  authority: "ADR-0081 (perception) · ADR-0084 (mux) · holo-omni-index · holo-strand-provenance · holospaces Law L5",
};
writeFileSync(join(here, "holo-q-vision-ambient-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Q Ambient Perception witness — it just works, fast, zero user action\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
