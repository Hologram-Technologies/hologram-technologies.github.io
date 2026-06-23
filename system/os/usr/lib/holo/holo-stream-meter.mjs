// holo-stream-meter.mjs — the streaming METRIC HARNESS. The one instrument that turns the high-FPS /
// high-throughput / low-memory claims into MEASURED numbers (holospaces V&V: witness, never assert). It
// records frame times (→ FPS, p50/p99), GPU dispatches/frame, the DELTA RATIO (regions recomputed ÷ total
// — the "work ∝ novelty" / InfiniBand number), tokens/s, resident MB, and first-frame / first-token
// latency. Pure + injectable: the caller passes dt/timestamps, so the math is identical in Node (witness)
// and the browser (fed performance.now() + GPU/navigator counters). Bounded ring → the meter itself is
// low-memory. node-, SW- and DOM-safe; no imports.

// nearest-rank percentile of an unsorted sample, q in [0,1].
function percentile(sample, q) {
  if (!sample.length) return 0;
  const a = [...sample].sort((x, y) => x - y);
  const rank = Math.max(1, Math.ceil(q * a.length));
  return a[Math.min(a.length - 1, rank - 1)];
}

// makeMeter({ window }) — window = how many recent frame times to keep (the FPS/percentile sample size).
export function makeMeter({ window = 120 } = {}) {
  const frames = [];                                   // ring of recent frame times (ms), capped at `window`
  let gpuDispatches = 0;
  let regionTotal = 0, regionNovel = 0;                // delta ratio accumulators
  let tokenCount = 0, tokenMs = 0;                     // throughput accumulators
  const marks = {};                                    // first-frame / first-token (captured ONCE)

  const frame = (dtMs) => { frames.push(+dtMs); if (frames.length > window) frames.shift(); };
  const gpu = (n = 1) => { gpuDispatches += n; };
  const regions = (total, novel) => { regionTotal += total; regionNovel += novel; };
  const tokens = (n = 1, dtMs = 0) => { tokenCount += n; tokenMs += dtMs; };
  const mark = (name, tMs) => { if (!(name in marks)) marks[name] = +tMs; };   // first write wins

  function snapshot({ residentMB = null } = {}) {
    const mean = frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : 0;
    return {
      fps: mean ? +(1000 / mean).toFixed(2) : 0,
      frameP50: percentile(frames, 0.5),
      frameP99: percentile(frames, 0.99),
      gpuDispatches,
      deltaRatio: regionTotal ? regionNovel / regionTotal : 0,
      tokensPerSec: tokenMs ? +(tokenCount / (tokenMs / 1000)).toFixed(2) : 0,
      residentMB,
      firstFrameMs: marks.firstFrame ?? null,
      firstTokenMs: marks.firstToken ?? null,
      frames: frames.length,
    };
  }

  return { frame, gpu, regions, tokens, mark, snapshot, frameCount: () => frames.length, reset: () => { frames.length = 0; gpuDispatches = regionTotal = regionNovel = tokenCount = tokenMs = 0; } };
}

export default { makeMeter };
