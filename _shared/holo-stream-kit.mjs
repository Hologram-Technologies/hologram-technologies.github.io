// holo-stream-kit.mjs — the unified STREAMING TOOLKIT: one import that lights up the whole Hologram-native
// streaming foundation for any surface or for Q. It barrels the witnessed primitives — the κ-stream
// transport, the O(1) L1/L2 compute memo, the metric harness, the delta render loop, the delta LLM
// decoder, the one unified scheduler, the adaptive-quality binder, the substrate fabric and its WebGPU
// driver — behind a single namespace, and `mount()` publishes them as `window.HoloStream` so a surface can
// stream apps and LLMs at high FPS with one line, no plumbing. Everything stays delta, content-addressed,
// re-derived (Law L5), and silicon-default (WebGPU only when present). The deep render-loop wiring of a
// specific surface is just: import this, build a loop + scheduler, pump. Abstract complexity, one seam.
//
// Browser-oriented (it references the sbin fabric by served path); each primitive is independently
// node-witnessed (see tools/holo-*-witness.mjs).

import { makeKappaStream, kappaOf } from "./holo-kappa-stream.mjs";
import * as bao from "./holo-bao.mjs";                      // verified streaming: per-chunk proofs over the canonical κ
import { makeComputeMemo } from "./holo-compute-memo.mjs";
import { makeMeter } from "./holo-stream-meter.mjs";
import { makeDeltaLoop } from "./holo-delta-render.mjs";
import { makeDeltaDecoder } from "./holo-delta-llm.mjs";
import { makeScheduler } from "./holo-scheduler.mjs";
import { makePrefetcher } from "./holo-prefetcher.mjs";
import { streamConfig, qualityOp, adaptiveCost } from "./holo-fidelity-stream.mjs";
import { fidelity, current as currentFidelity, deviceProfile } from "./holo-fidelity.mjs";
import * as fabric from "/holo-fabric.mjs";
import * as webgpu from "/sbin/holo-fabric-webgpu.mjs";

export {
  makeKappaStream, kappaOf, bao, makeComputeMemo, makeMeter, makeDeltaLoop, makeDeltaDecoder,
  makeScheduler, streamConfig, qualityOp, adaptiveCost, fidelity, currentFidelity, deviceProfile, fabric, webgpu,
};
export { makePrefetcher };

// streamObject(root, source, onChunk) — the BLAKE3 dividend for a surface: consume a LARGE κ-object's
// chunks each PROVEN against its single root κ (== the object's stream κ), calling onChunk(bytes, index)
// the instant each verified chunk arrives — render frame 0 / play second 0 / run layer 0 before the
// object is whole, holding at most one chunk + its O(log n) proof. A bad chunk throws (Law L5); earlier
// chunks already rendered are unaffected. `source` is any (async) iterable of { index, bytes, proof }.
export async function streamObject(root, source, onChunk) {
  let n = 0;
  for await (const ev of bao.verifiedChunks(root, source)) { await onChunk(ev.bytes, ev.index); n++; }
  return n;
}

// build the one streaming context for a surface: a shared cache + memo + meter + scheduler, tuned to the
// device's fidelity. Returns the pieces a surface uses to stream render frames AND LLM tokens under one budget.
export function makeStreamContext({ profile = null } = {}) {
  const f = profile ? fidelity(profile) : currentFidelity();
  const cfg = streamConfig(f);
  const cache = new Map();                                  // the shared κ-address space (Law L3)
  const memo = makeComputeMemo({ cap: 8192 });
  const meter = makeMeter({ window: 240 });
  const scheduler = makeScheduler({ now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()), budgetMs: cfg.budgetMs });
  return { config: cfg, fidelity: f, cache, memo, meter, scheduler, prefetch: cfg.prefetch,
    renderLoop: (opts) => makeDeltaLoop({ memo, meter, ...opts }),
    decoder: (opts) => makeDeltaDecoder({ memo, meter, ...opts }),
    // prefetch tiles ahead of need, gated by the device's fidelity policy (off on a slow link). The surface
    // supplies the upcoming-κ source + fetch; `has` defaults to the shared cache so resident tiles are skipped.
    prefetcher: (opts = {}) => makePrefetcher(scheduler, { policy: cfg.prefetch, has: (k) => cache.has(k), ...opts }),
    stream: () => makeKappaStream(cache) };
}

// mount() — publish the toolkit as window.HoloStream so any surface/Q can stream with one line.
export function mount(win) {
  const w = win || (typeof window !== "undefined" ? window : globalThis);
  w.HoloStream = {
    makeKappaStream, kappaOf, bao, streamObject, makeComputeMemo, makeMeter, makeDeltaLoop, makeDeltaDecoder,
    makeScheduler, streamConfig, qualityOp, adaptiveCost, fidelity, currentFidelity, deviceProfile,
    fabric, webgpu, makeStreamContext, makePrefetcher,
  };
  return w.HoloStream;
}

export default { mount, makeStreamContext };
