#!/usr/bin/env node
// holo-delta-render-witness.mjs — PROVE the DELTA RENDER LOOP: the loop that composes the proven primitives
// (compute-memo O(1) L1/L2 · the metric harness · a transform driver) into one per-frame pass where ONLY
// novel regions recompute/dispatch and everything else reconstructs O(1) — and a per-frame COMPUTE BUDGET
// bounds work so the frame rate holds. This is the on-screen form of "work ∝ novelty": an unchanged frame
// costs ~nothing, a one-region change costs one region, and a warmup burst is spread across frames by the
// budget. Pure + injectable (paint + transform handed in), so the loop accounting is witnessed in Node;
// real FPS is measured in-page (preview).
//
// Checks: first frame all-novel; identical frame zero work; one-region delta; budget defers excess novel
// work; paint fires only on κ-change; meter reflects delta ratio + FPS; deterministic; throughput model.
//   node tools/holo-delta-render-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeDeltaLoop } from "../os/usr/lib/holo/holo-delta-render.mjs";
import { makeComputeMemo } from "../os/usr/lib/holo/holo-compute-memo.mjs";
import { makeMeter } from "../os/usr/lib/holo/holo-stream-meter.mjs";
import { kappaOf } from "../os/usr/lib/holo/holo-kappa-stream.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const enc = (s) => new TextEncoder().encode(s);
const OP = await kappaOf(enc("layout-op"));
// build a scene of M regions; region i's content κ from a label (so we can change one)
const scene = async (labels) => Promise.all(labels.map(async (lab, i) => ({ id: "r" + i, op: OP, in: await kappaOf(enc(lab)) })));
// a counting transform (the "GPU/CPU work"): deterministic bytes from (op,in)
const makeTransform = () => { const c = { calls: 0 }; const fn = async (op, inn) => { c.calls++; return enc("OUT:" + op + "|" + inn); }; fn.count = c; return fn; };
const l2 = () => { const m = new Map(); return { get: async (h) => m.get(h) || null, put: async (h, b) => { m.set(h, b); } }; };

const checks = {};

// ── 1 · first frame: every region novel (computed + painted) ─────────────────────────────────────
{
  const memo = makeComputeMemo({ l2: l2(), cap: 256 }), tf = makeTransform();
  const painted = []; const loop = makeDeltaLoop({ memo, transform: tf, paint: (id) => painted.push(id) });
  const s = await scene(["a", "b", "c", "d"]);
  const r = await loop.frame(s);
  checks.firstFrameAllNovel = r.total === 4 && r.computed === 4 && r.repainted === 4 && painted.length === 4 && tf.count.calls === 4;
}

// ── 2 · identical frame: zero compute, zero repaint (full O(1) reuse) ─────────────────────────────
{
  const memo = makeComputeMemo({ l2: l2(), cap: 256 }), tf = makeTransform();
  const painted = []; const loop = makeDeltaLoop({ memo, transform: tf, paint: (id) => painted.push(id) });
  const s = await scene(["a", "b", "c", "d"]);
  await loop.frame(s); const r = await loop.frame(s);
  checks.identicalFrameZeroWork = r.computed === 0 && r.repainted === 0 && r.reused === 4 && tf.count.calls === 4;  // still only the first frame's 4
}

// ── 3 · one region changes ⇒ exactly one region of work ───────────────────────────────────────────
{
  const memo = makeComputeMemo({ l2: l2(), cap: 256 }), tf = makeTransform();
  const loop = makeDeltaLoop({ memo, transform: tf });
  await loop.frame(await scene(["a", "b", "c", "d"]));
  const r = await loop.frame(await scene(["a", "B!", "c", "d"]));   // region 1 changed
  checks.oneRegionDelta = r.computed === 1 && r.repainted === 1 && r.reused === 3;
}

// ── 4 · the per-frame compute budget defers excess novel work, then drains ────────────────────────
{
  const memo = makeComputeMemo({ l2: l2(), cap: 256 }), tf = makeTransform();
  const loop = makeDeltaLoop({ memo, transform: tf });
  const s = await scene(["a", "b", "c", "d", "e"]);                 // 5 novel
  const f1 = await loop.frame(s, { budget: 2 });
  const f2 = await loop.frame(s, { budget: 2 });
  const f3 = await loop.frame(s, { budget: 2 });
  checks.budgetDefers = f1.computed === 2 && f1.deferred === 3 && f2.computed === 2 && f3.computed === 1 && f3.deferred === 0;
}

// ── 5 · paint fires ONLY on κ-change ─────────────────────────────────────────────────────────────
{
  const memo = makeComputeMemo({ l2: l2(), cap: 256 }), tf = makeTransform();
  let paints = 0; const loop = makeDeltaLoop({ memo, transform: tf, paint: () => paints++ });
  const s = await scene(["a", "b"]);
  await loop.frame(s); await loop.frame(s); await loop.frame(s);    // 3 frames, content static
  checks.paintOnlyOnChange = paints === 2;                          // only the first frame painted both regions
}

// ── 6 · the meter reflects delta ratio + FPS ──────────────────────────────────────────────────────
{
  const memo = makeComputeMemo({ l2: l2(), cap: 256 }), tf = makeTransform(), meter = makeMeter({ window: 1000 });
  const loop = makeDeltaLoop({ memo, transform: tf, meter });
  await loop.frame(await scene(["a", "b", "c", "d"]), { dtMs: 1000 / 120 });   // frame 1: 4 repainted of 4
  await loop.frame(await scene(["a", "b", "c", "d"]), { dtMs: 1000 / 120 });   // frame 2: 0 repainted of 4
  const snap = meter.snapshot();
  checks.meterReflects = Math.abs(snap.deltaRatio - 4 / 8) < 1e-9 && Math.abs(snap.fps - 120) < 0.5;
}

// ── 7 · deterministic across loops ───────────────────────────────────────────────────────────────
{
  const k = [];
  for (let n = 0; n < 2; n++) {
    const memo = makeComputeMemo({ l2: l2(), cap: 256 }); const loop = makeDeltaLoop({ memo, transform: makeTransform() });
    const seq = []; const lp = makeDeltaLoop({ memo, transform: makeTransform(), paint: (id, bytes) => {} });
    await loop.frame(await scene(["x", "y"]));
    k.push([...loop.lastK.values()].join(","));
  }
  checks.deterministic = k[0] === k[1] && k[0].includes("did:holo:sha256:");
}

// ── 8 · throughput model: F frames, M regions, ONE changes per frame ──────────────────────────────
let model = null;
{
  const M = 16, F = 100;
  const memo = makeComputeMemo({ l2: l2(), cap: 4096 }), tf = makeTransform();
  const loop = makeDeltaLoop({ memo, transform: tf });
  for (let f = 0; f < F; f++) {
    const labels = Array.from({ length: M }, (_, i) => "r" + i); labels[0] = "frame" + f;   // one novel/frame
    await loop.frame(await scene(labels));
  }
  const expected = M + (F - 1);
  model = { computed: tf.count.calls, expected, naive: M * F, reduction: +((M * F) / tf.count.calls).toFixed(1) };
  checks.throughputModel = tf.count.calls === expected;
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-delta-render-witness.result.json"), JSON.stringify({
  spec: "Delta render loop: per frame, only NOVEL regions recompute/dispatch (compute-memo), everything else reconstructs O(1); a per-frame compute budget bounds work so FPS holds; paint fires only on κ-change. Work ∝ novelty on screen. Pure + injectable; real FPS measured in-page.",
  authority: "holospaces Laws L1/L2/L3/L5 · damage/dirty-region rendering · frame-budget scheduling · content-addressed memoization",
  witnessed,
  covers: witnessed ? ["delta-render-loop", "zero-work-static", "one-region-delta", "compute-budget", "paint-on-change", "metered", "deterministic", "throughput-model"] : [],
  model,
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
if (model) console.log(`· throughput: ${model.computed} computes (expected ${model.expected}) vs naive ${model.naive} = ${model.reduction}× less`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ on-screen work ∝ novelty: static frame ~free, one change = one region, budget holds the frame rate" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
