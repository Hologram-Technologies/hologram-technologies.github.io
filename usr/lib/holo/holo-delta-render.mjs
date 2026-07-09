// holo-delta-render.mjs — the DELTA RENDER LOOP. It composes the proven primitives into one per-frame pass:
// a scene is an ordered list of REGIONS, each addressed by (op κ, in κ); the loop runs each region through
// the compute-memo, so a region that hasn't changed reconstructs in O(1) (no recompute, no GPU dispatch)
// and only NOVEL regions pay. It repaints a region ONLY when its output κ changes, and a per-frame COMPUTE
// BUDGET caps first-time work so a warmup burst is spread across frames and the frame rate holds. This is
// the on-screen form of "work ∝ novelty": a static frame is ~free, a one-region change costs one region.
//
// Pure + injectable — `transform` (the producer: (opκ,inκ)→bytes, e.g. fabric/WebGPU driver) and `paint`
// ((regionId, bytes, reused)→void, e.g. holo-q-render) are handed in — so the loop accounting is witnessed
// in Node and the SAME loop drives a real canvas/DOM in the browser. node-, SW- and DOM-safe; no imports.
//
//   makeDeltaLoop({ memo, transform, paint?, meter? })
//     .frame(regions, { dtMs?, budget? }) → { total, computed, repainted, reused, deferred }
//        regions : [{ id, op, in }]   op/in are κ; id is the stable region identity (a slot on screen)
//        budget  : max first-time computes this frame (default ∞); excess novel regions defer to next frame

export function makeDeltaLoop({ memo, transform, paint = null, meter = null } = {}) {
  if (!memo || !transform) throw new Error("holo-delta-render: needs { memo, transform }");
  const lastK = new Map();                       // regionId → last painted output κ (the on-screen state)
  const lastIn = new Map();                       // regionId → "op|in" — the region's identity last frame

  async function frame(regions, { dtMs = null, budget = Infinity } = {}) {
    let total = 0, computed = 0, repainted = 0, reused = 0, deferred = 0;
    for (const r of regions) {
      total++;
      const sig = r.op + "|" + r.in;
      // UNCHANGED region: same (op,in) as last frame ⇒ truly O(1) — no hash, no memo, no repaint. This is
      // the delta short-circuit: an unchanged slot must cost a pointer compare, never a re-derivation.
      if (lastIn.get(r.id) === sig && lastK.has(r.id)) { reused++; continue; }
      // new or changed region ⇒ go through the memo (cheap hit if seen before, compute only if novel)
      const novel = !(await memo.seen(r.op, r.in));
      if (novel && computed >= budget) { deferred++; continue; }     // hold the frame budget — retry next frame
      const res = await memo.compute(r.op, r.in, transform);
      if (res.computed) computed++; else reused++;
      lastIn.set(r.id, sig);
      if (lastK.get(r.id) !== res.kappa) {                           // κ changed ⇒ this slot must repaint
        if (paint) paint(r.id, res.bytes, !res.computed);
        lastK.set(r.id, res.kappa); repainted++;
      }
    }
    if (meter) { meter.regions(total, repainted); if (computed) meter.gpu(computed); if (dtMs != null) meter.frame(dtMs); }
    return { total, computed, repainted, reused, deferred };
  }

  return { frame, lastK, clear: () => lastK.clear() };
}

export default { makeDeltaLoop };
