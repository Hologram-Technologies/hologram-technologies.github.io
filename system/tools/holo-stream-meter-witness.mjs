#!/usr/bin/env node
// holo-stream-meter-witness.mjs — PROVE the streaming metric harness: the one instrument that makes the
// high-FPS / high-throughput / low-memory claims MEASURED, not asserted. It records frame times (→ FPS,
// p50/p99), GPU dispatches/frame, the DELTA RATIO (regions recomputed ÷ total — the InfiniBand "work ∝
// novelty" number), tokens/s, resident MB, and first-frame / first-token latency. Pure + injectable (the
// caller passes dt/timestamps), so the math is witnessed deterministically in Node; the browser feeds it
// performance.now() and navigator/GPU counters.
//
// Checks: percentiles (nearest-rank), FPS from mean frame time, delta ratio, GPU counter, tokens/s,
// first-frame/first-token captured once, the frame ring is bounded (low memory), snapshot shape.
//   node tools/holo-stream-meter-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeMeter } from "../os/usr/lib/holo/holo-stream-meter.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;
const checks = {};

// ── percentiles + FPS from constant frame time ───────────────────────────────────────────────────
{
  const m = makeMeter({ window: 1000 });
  for (const t of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) m.frame(t);
  const s = m.snapshot();
  checks.percentilesCorrect = s.frameP50 === 50 && s.frameP99 === 100;             // nearest-rank
  const m2 = makeMeter({ window: 1000 });
  for (let i = 0; i < 240; i++) m2.frame(1000 / 120);                              // a steady 120 fps
  checks.fpsFromMean = near(m2.snapshot().fps, 120, 0.5);
}

// ── delta ratio: work ∝ novelty ──────────────────────────────────────────────────────────────────
{
  const m = makeMeter();
  m.regions(20, 1); m.regions(20, 1); m.regions(20, 18);                          // 20 novel of 60 total
  checks.deltaRatioCorrect = near(m.snapshot().deltaRatio, 20 / 60, 1e-9);
}

// ── GPU dispatch counter ─────────────────────────────────────────────────────────────────────────
{
  const m = makeMeter();
  m.gpu(); m.gpu(3); m.gpu();
  checks.gpuCounts = m.snapshot().gpuDispatches === 5;
}

// ── tokens/s ────────────────────────────────────────────────────────────────────────────────────
{
  const m = makeMeter();
  m.tokens(50, 500); m.tokens(50, 500);                                            // 100 tokens over 1000 ms
  checks.tokensPerSec = near(m.snapshot().tokensPerSec, 100, 1e-6);
}

// ── first-frame / first-token captured once ──────────────────────────────────────────────────────
{
  const m = makeMeter();
  m.mark("firstFrame", 42); m.mark("firstFrame", 999);                            // only the first sticks
  m.mark("firstToken", 130);
  const s = m.snapshot();
  checks.firstCapturedOnce = s.firstFrameMs === 42 && s.firstTokenMs === 130;
}

// ── the frame ring is bounded (low memory) ───────────────────────────────────────────────────────
{
  const m = makeMeter({ window: 60 });
  for (let i = 0; i < 5000; i++) m.frame(8);
  checks.frameRingBounded = m.frameCount() === 60;
}

// ── snapshot shape (incl injected resident MB) ───────────────────────────────────────────────────
{
  const m = makeMeter();
  m.frame(8); m.gpu(); m.regions(10, 2);
  const s = m.snapshot({ residentMB: 12.5 });
  checks.snapshotShape = ["fps", "frameP50", "frameP99", "gpuDispatches", "deltaRatio", "tokensPerSec", "residentMB", "frames"].every((k) => k in s) && s.residentMB === 12.5;
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-stream-meter-witness.result.json"), JSON.stringify({
  spec: "Streaming metric harness: FPS + frame p50/p99, GPU dispatches/frame, delta ratio (work ∝ novelty), tokens/s, resident MB, first-frame/first-token latency. Pure + injectable; the instrument that turns the high-FPS/throughput/low-memory gates into measured numbers.",
  authority: "holospaces V&V (witness against external authority) · nearest-rank percentile · standard rendering/throughput metrics",
  witnessed,
  covers: witnessed ? ["metric-harness", "percentiles", "fps", "delta-ratio", "tokens-per-sec", "latency-marks", "bounded-ring"] : [],
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ the metric harness measures FPS, delta ratio, throughput, latency, memory" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
