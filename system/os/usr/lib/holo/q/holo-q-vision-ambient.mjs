// holo-q-vision-ambient.mjs — AMBIENT PERCEPTION: delete the verb. A verb is already a failure of
// magic. perceive() exists, but the user must never call it. This watcher runs perception as a
// BACKGROUND SUBSTRATE PROCESS: the visible world's non-κ pixels silently condense into the κ-graph,
// and because every promoted thing is JUST A κ, it lights up the whole stack (omni-index search,
// pluck, share, words, roam, provenance) with no new surface and zero user input.
//
// THE TRIGGER (zero input): the capture layer NOTICES a raster island — an on-screen fragment the
// renderer could not κ-stamp because it is non-κ pixels. notice() is the only entry. Symmetric to how
// the orchestrator already feeds the perception scene's CODE face (holo-q-orchestrate.js): this feeds
// the missing VISUAL face, which closes holo-q-perception's own drift loop.
//
// THE SPEED CONTRACT (very, very fast): two strictly separated lanes.
//   • FAST lane (the user's actions): the κ-graph read in perceive() — O(1), no pixels. NOT here.
//   • COLD lane (this module): OCR, IDLE-ONLY, MEMOIZED by capture hash (re-see = free), RANK-ORDERED
//     to you, COALESCED (one in-flight per island), and PREEMPTIBLE (a user interaction pauses it).
// Nothing here ever touches the interaction path; by the time the user asks, the answer is already a κ.

import { hashBytes } from "./holo-q-vision.mjs";

const _title = (r) => {
  const md = (r && r.markdown) || "";
  const line = md.split("\n").map((s) => s.replace(/^#+\s*/, "").trim()).find(Boolean) || "raster";
  return line.slice(0, 80);
};

// createAmbientPerception(deps) — the background watcher.
//   scene       — the perception scene (for the precedence read + the VISUAL-face join, done in perceive)
//   perceive    — holo-q-vision.perceive (injected so the witness can count engine calls)
//   specialist  — the bound vision specialist (passed straight through to perceive)
//   index       — { record, search } over holo-omni-index (photographic memory)
//   provenance  — { append(manifest) } over holo-strand-provenance (signed perception history)
//   score       — (island) → number; rank-to-you ordering (holo-rank × holo-profile). Default 0.
//   idle        — (fn) => schedule fn at idle (requestIdleCallback in the browser; injectable in tests).
//                 Default: queue a microtask — still off the synchronous interaction path.
// `selfSchedule` (default true): the watcher schedules its own idle drain on notice() — for standalone
// use and the Node witness. Set FALSE when the ONE ambient loop (window.HoloAmbient) drives draining via
// drain(): then notice() only enqueues (never runs the engine inline) and the heartbeat paces the cold lane.
export function createAmbientPerception({ scene = null, perceive, specialist = null, index = null, provenance = null, score = null, idle = null, coalesce = true, selfSchedule = true, cache = null } = {}) {
  if (typeof perceive !== "function") throw new Error("holo-q-vision-ambient: perceive is required");
  const memo = new Map();        // captureHash → kappa  (re-see is free)
  const queued = new Set();      // captureHashes already waiting (dedup across repeated scans)
  const inflight = new Set();    // ids being promoted   (coalesce)
  const queue = [];              // [{ island, score }]  (rank-ordered)
  let paused = false;            // a user interaction preempts the cold lane
  const stats = { noticed: 0, skippedKappa: 0, skippedMemo: 0, enqueued: 0, promoted: 0, idleRuns: 0, errors: 0 };

  const _idle = idle || ((fn) => Promise.resolve().then(fn));

  // notice(island) — the ONLY entry. island: { id, pixels, capture?, kappa?, hint?, rect?, kind? }.
  // κ-native islands are skipped (precedence). Seen pixels are an O(1) memo hit. New pixels enqueue,
  // rank-ordered, and schedule an idle drain. Never blocks the caller.
  async function notice(island = {}) {
    stats.noticed++;
    if (island.kappa) { stats.skippedKappa++; return { skipped: true, reason: "kappa-native" }; }   // ← precedence
    const h = island.capture || (island.pixels != null ? await hashBytes(island.pixels) : null);
    if (h == null) return { skipped: true, reason: "no-pixels" };
    island._hash = h;
    if (memo.has(h)) { stats.skippedMemo++; return { skipped: true, reason: "memo", kappa: memo.get(h) }; }  // ← free re-see (this session)
    if (queued.has(h)) { stats.skippedMemo++; return { skipped: true, reason: "already-queued" }; }          // ← repeated scan, same pixels
    // ← the SUBSTRATE short-circuit: have these exact pixels EVER been perceived (any prior session/device)?
    //   An O(1) κ-store read, L5-verified inside the cache. Hit ⇒ join the scene from the stored κ, no OCR.
    if (cache) {
      try { const hit = await cache.get(h); if (hit && hit.kappa) { memo.set(h, hit.kappa); stats.skippedMemo++; _land(island, hit.kappa, hit.object, true); return { skipped: true, reason: "kappa-store", kappa: hit.kappa }; } } catch {}
    }
    const s = score ? (score(island) || 0) : 0;
    queued.add(h);
    queue.push({ island, score: s });
    queue.sort((a, b) => b.score - a.score);                          // rank-to-you
    stats.enqueued++;
    schedule();
    return { enqueued: true, score: s };
  }

  function schedule() {
    if (!selfSchedule || paused || !queue.length) return;            // driven mode → the ONE loop calls drain()
    _idle(() => { stats.idleRuns++; return pump(); });               // cold lane only ever runs at idle
  }

  // _land(island, kappa, object, fromCache) — the shared "this surface is now a κ" step, used by BOTH the
  // fresh OCR path and the substrate cache-hit path: join the scene as a VISUAL face (the cache path must
  // do this itself, since perceive() isn't called) and record it to the searchable index.
  function _land(island, kappa, object, fromCache) {
    if (fromCache && scene && typeof scene.observeVisual === "function")
      scene.observeVisual(island.id, kappa, { source: "raster-ocr", kind: island.kind || "raster" });
    const text = (object && object["schema:text"]) || island.hint || island.id;
    const title = String(text).split("\n").map((s) => s.replace(/^#+\s*/, "").trim()).find(Boolean) || "raster";
    if (index && typeof index.record === "function")
      index.record({ addr: kappa, kind: "perceived", title: title.slice(0, 80), input: String(text).slice(0, 400), kappa });
  }

  // drain() — promote at most ONE island. The ambient heartbeat (window.HoloAmbient) calls this once per
  // tick in driven mode, so the cold lane is paced by the single OS loop (no private timer). Returns true
  // if it did work. Honors preemption (paused) and coalescing, exactly like the self-scheduled pump.
  async function drain() { if (paused || !queue.length) return false; stats.idleRuns++; await pump(); return true; }

  async function pump() {
    if (paused) return;                                              // preempted by a user interaction
    const next = queue.shift();
    if (!next) return;
    const { island } = next;
    queued.delete(island._hash);
    if (coalesce && inflight.has(island.id)) { return schedule(); }
    inflight.add(island.id);
    try {
      const r = await perceive(island, { scene, specialist });       // OCR → seal κ → join scene (VISUAL face)
      if (r && r.kappa && r.source === "ocr") {
        memo.set(island._hash, r.kappa);
        stats.promoted++;
        if (cache) { try { await cache.put(island._hash, r.object); } catch {} }   // PERSIST into the substrate κ-store → next time is O(1), forever
        const title = _title(r);
        // index the PERCEIVED TEXT (not just the heading) so "find where it said X" hits body content too
        if (index && typeof index.record === "function")
          index.record({ addr: r.kappa, kind: "perceived", title, input: (r.markdown || island.hint || island.id).slice(0, 400), kappa: r.kappa });   // searchable forever
        if (provenance && typeof provenance.append === "function")
          await provenance.append({ source: r.kappa, name: title, kind: "perception", view: { kappa: r.kappa }, bytes: (island.pixels && island.pixels.length) || null });  // signed history
      } else if (r && r.source === "graph") {
        stats.skippedKappa++;                                        // a κ slipped through — never OCR'd
      }
    } catch (e) { stats.errors++; }
    finally { inflight.delete(island.id); }
    if (queue.length) schedule();                                    // keep draining, still idle-yielding
  }

  function interaction() { paused = true; }                          // user acts → pause the cold lane
  function resume() { if (paused) { paused = false; schedule(); } }  // idle returns → continue

  return {
    notice, interaction, resume, drain,
    stats: () => ({ ...stats }),
    memoSize: () => memo.size,
    pending: () => queue.length,
    kappaFor: (capture) => memo.get(capture) || null,
  };
}

// browser binding: one ambient watcher over the live scene + the real omni-index + the operator strand.
// Fail-soft; if perception/scene are absent the OS simply has no raster edge wired yet.
if (typeof window !== "undefined") {
  window.HoloAmbientPerception = { createAmbientPerception };
}

export default { createAmbientPerception };
