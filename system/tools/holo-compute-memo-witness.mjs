#!/usr/bin/env node
// holo-compute-memo-witness.mjs — PROVE the O(1) L1/L2 COMPUTE memo: a computed result (a graded frame, a
// matmul, a token block) is addressed by its κ and memoized BEFORE the work — keyed by the INPUT identity
// (op κ + in κ) — so a repeat returns the cached output with NO recompute and NO GPU dispatch. Two tiers:
// a bounded page-resident L1 (zero-copy, low memory) over a durable L2 (OPFS/κ-store). Delta compute falls
// out: stream the inputs and only the NOVEL (op,in) pays — the rest is O(1). Every cached output stays
// content-addressed (re-derives to its κ, Law L5). This is the compute twin of holo-q-render's DOM memo.
//
// Checks (all must hold):
//   1 computesOnceReplays      — same (op,in) twice: first computes, second is an L1 hit, same out-κ, produce called ONCE.
//   2 outputIsContentAddressed — the cached output re-derives to its κ (Law L5).
//   3 l2SurvivesEviction       — an entry evicted from L1 is recovered from L2 on next use (no recompute), re-promoted to L1.
//   4 residentBounded          — under churn of > cap distinct inputs, the L1 resident set stays ≤ cap (low memory).
//   5 deltaCompute             — F frames of M inputs, ONE changes per frame ⇒ computes == M + (F-1), the rest are hits.
//   6 deterministic            — two memo instances, same inputs ⇒ same out-κ sequence (Law L2).
//   7 distinctInputsDistinctKeys — different (op,in) never collide to a false hit.
//   8 noRecomputeAfterHit      — produce-call count stays flat across many repeated hits.
//
// Authority (external): holospaces Laws L1/L2/L3/L5 · memoization / content-addressed cache · CPU-cache
// L1/L2 locality model · HTTP ETag/304 (compute the answer once, replay by identity). Usage:
//   node tools/holo-compute-memo-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeComputeMemo } from "../os/usr/lib/holo/holo-compute-memo.mjs";
import { kappaOf } from "../os/usr/lib/holo/holo-kappa-stream.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const enc = (s) => new TextEncoder().encode(s);
const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);
// a counting "producer": the actual (GPU/CPU) work. Deterministic bytes from the inputs.
const makeProducer = () => { const c = { calls: 0 }; const fn = async (opK, inK) => { c.calls++; return enc("OUT:" + opK + "|" + inK); }; fn.count = c; return fn; };
// an injected durable L2 (OPFS/κ-store stand-in): hex → bytes
const makeL2 = () => { const m = new Map(); return { get: async (hex) => m.get(hex) || null, put: async (hex, b) => { m.set(hex, b); }, size: () => m.size }; };

const checks = {};
const opK = await kappaOf(enc("op-A")), inK = await kappaOf(enc("in-A"));

// ── 1 · computes once, replays from L1 ───────────────────────────────────────────────────────────
{
  const produce = makeProducer();
  const memo = makeComputeMemo({ l2: makeL2(), cap: 64 });
  const r1 = await memo.compute(opK, inK, produce);
  const r2 = await memo.compute(opK, inK, produce);
  checks.computesOnceReplays = r1.computed === true && r2.hit === "L1" && r1.kappa === r2.kappa && produce.count.calls === 1;
}

// ── 2 · the cached output is content-addressed (Law L5) ──────────────────────────────────────────
{
  const produce = makeProducer();
  const memo = makeComputeMemo({ l2: makeL2(), cap: 64 });
  const r = await memo.compute(opK, inK, produce);
  checks.outputIsContentAddressed = r.kappa === (await kappaOf(r.bytes)) && same(r.bytes, enc("OUT:" + opK + "|" + inK));
}

// ── 3 · L2 recovers an L1-evicted entry without recompute, re-promotes to L1 ──────────────────────
{
  const produce = makeProducer();
  const l2 = makeL2();
  const memo = makeComputeMemo({ l2, cap: 2 });                       // tiny L1
  const a = [await kappaOf(enc("a")), await kappaOf(enc("ina"))];
  const b = [await kappaOf(enc("b")), await kappaOf(enc("inb"))];
  const c = [await kappaOf(enc("c")), await kappaOf(enc("inc"))];
  await memo.compute(...a, produce);                                  // L1: {a}
  await memo.compute(...b, produce);                                  // L1: {a,b}
  await memo.compute(...c, produce);                                  // L1: {b,c} — a evicted from L1, still in L2
  const callsBefore = produce.count.calls;                           // 3
  const ra = await memo.compute(...a, produce);                       // should be an L2 hit, NOT a recompute
  checks.l2SurvivesEviction = ra.hit === "L2" && produce.count.calls === callsBefore && memo.stats().resident <= 2;
}

// ── 4 · resident set bounded under churn (low memory) ────────────────────────────────────────────
{
  const produce = makeProducer();
  const memo = makeComputeMemo({ l2: makeL2(), cap: 8 });
  for (let i = 0; i < 200; i++) await memo.compute(await kappaOf(enc("op" + i)), await kappaOf(enc("in" + i)), produce);
  checks.residentBounded = memo.stats().resident <= 8 && produce.count.calls === 200;
}

// ── 5 · delta compute: one input changes per frame ⇒ work ∝ novelty ──────────────────────────────
let delta = null;
{
  const M = 16, F = 100;
  const produce = makeProducer();
  const memo = makeComputeMemo({ l2: makeL2(), cap: 1024 });
  const ins = []; for (let i = 0; i < M; i++) ins.push(await kappaOf(enc("region" + i)));
  for (let f = 0; f < F; f++) {
    ins[0] = await kappaOf(enc("frame" + f));                         // exactly one region novel per frame
    for (let i = 0; i < M; i++) await memo.compute(opK, ins[i], produce);
  }
  const expected = M + (F - 1);                                       // first frame: M computes; then 1/frame
  const st = memo.stats();
  delta = { computes: produce.count.calls, expected, l1Hits: st.l1Hits, naive: M * F, reduction: +((M * F) / produce.count.calls).toFixed(1) };
  checks.deltaCompute = produce.count.calls === expected && st.l1Hits === (M * F - expected);
}

// ── 6 · deterministic across instances (Law L2) ──────────────────────────────────────────────────
{
  const ins = [await kappaOf(enc("x")), await kappaOf(enc("y"))];
  const m1 = makeComputeMemo({ l2: makeL2(), cap: 64 }), m2 = makeComputeMemo({ l2: makeL2(), cap: 64 });
  const k1 = [], k2 = [];
  for (const i of ins) { k1.push((await m1.compute(opK, i, makeProducer())).kappa); k2.push((await m2.compute(opK, i, makeProducer())).kappa); }
  checks.deterministic = k1.every((k, i) => k === k2[i]) && k1[0].startsWith("did:holo:blake3:");
}

// ── 7 · distinct inputs never collide ────────────────────────────────────────────────────────────
{
  const produce = makeProducer();
  const memo = makeComputeMemo({ l2: makeL2(), cap: 64 });
  const r1 = await memo.compute(opK, await kappaOf(enc("p")), produce);
  const r2 = await memo.compute(opK, await kappaOf(enc("q")), produce);
  checks.distinctInputsDistinctKeys = r1.kappa !== r2.kappa && produce.count.calls === 2;
}

// ── 8 · no recompute after a hit, however many repeats ───────────────────────────────────────────
{
  const produce = makeProducer();
  const memo = makeComputeMemo({ l2: makeL2(), cap: 64 });
  await memo.compute(opK, inK, produce);
  for (let i = 0; i < 50; i++) await memo.compute(opK, inK, produce);
  checks.noRecomputeAfterHit = produce.count.calls === 1 && memo.stats().l1Hits === 50;
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-compute-memo-witness.result.json"), JSON.stringify({
  spec: "O(1) L1/L2 compute memo: a computed result is addressed by its κ and memoized BEFORE the work, keyed by input identity (op κ + in κ); repeat ⇒ O(1) hit, no recompute/GPU dispatch; bounded resident L1 over durable L2 (low memory); delta compute (work ∝ novelty); outputs content-addressed (Law L5).",
  authority: "holospaces Laws L1/L2/L3/L5 · content-addressed memoization · CPU L1/L2 locality · HTTP ETag/304",
  witnessed,
  covers: witnessed ? ["compute-memo", "o1-replay", "l2-eviction-recovery", "resident-bounded", "delta-compute", "deterministic", "content-addressed", "law-l5"] : [],
  delta,
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
if (delta) console.log(`· delta compute: ${delta.computes} computes (expected ${delta.expected}) vs naive ${delta.naive} = ${delta.reduction}× less work`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ compute once, address it, replay O(1); work ∝ novelty; resident bounded; outputs re-derive" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
