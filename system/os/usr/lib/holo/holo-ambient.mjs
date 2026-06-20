// holo-ambient.mjs — ONE AMBIENT LOOP (S1 of the Q-unification). The verdict found TWO ambient timers doing
// self-improvement in parallel: the spine's idle loop (reflect → speak → act) and trinity's own setInterval
// (drift-heal of render-target κ). Two timers, no coordination, a standing cost on the critical path. This is
// the single ambient AUTHORITY — one loop that dispatches to registered FACULTIES at their own cadence. The
// spine's reflection, trinity's drift-heal, and the evolve step all become faculties of ONE scheduler; no
// module owns a timer anymore. One heartbeat, many organs.
//
//   register(name, run, { everyTicks, enabled }) → unregister   // a faculty + how often it runs (in ticks)
//   tick() → { ran[], skipped[], errored[] }                    // run every DUE faculty, in registration order
//   start({ schedule }) → stop                                  // arm ONE loop (schedule injected: rIC / setInterval)
//   pause() / resume()                                          // one-move hands-off for the WHOLE ambient layer
//
// FAULT-ISOLATED: a faculty that throws is caught and reported — it never stalls the heartbeat or its siblings
// (a flaky drift-heal must not take down reflection). DETERMINISTIC: faculties run in registration order, due
// by an integer tick count (no clock in the core) — so a witness replays the schedule to identical dispatch.
// The core owns NO timer; `start` takes the injected pump, exactly like holo-heal-supervisor. Pure + isomorphic.

export function makeAmbient() {
  const faculties = [];                 // [{ name, run, everyTicks, enabled }] — registration order = dispatch order
  const byName = new Map();
  let _ticks = 0, paused = false;

  function register(name, run, { everyTicks = 1, enabled = true } = {}) {
    if (typeof run !== "function") throw new Error("ambient.register needs a run() function");
    const rec = { name: String(name), run, everyTicks: Math.max(1, everyTicks | 0), enabled: !!enabled };
    if (byName.has(rec.name)) { const i = faculties.indexOf(byName.get(rec.name)); if (i >= 0) faculties.splice(i, 1); }   // replace, never duplicate
    faculties.push(rec); byName.set(rec.name, rec);
    return () => { const i = faculties.indexOf(rec); if (i >= 0) faculties.splice(i, 1); byName.delete(rec.name); };       // unregister
  }

  // tick — run every DUE faculty once, in order. Due = (tick count) divisible by its cadence. Resilient: an
  // error in one faculty is recorded, never thrown, so the heartbeat and the other faculties keep going.
  async function tick() {
    if (paused) return { ran: [], skipped: faculties.map((f) => f.name), errored: [], paused: true };
    _ticks++;
    const ran = [], skipped = [], errored = [];
    for (const f of faculties) {
      if (!f.enabled || (_ticks % f.everyTicks) !== 0) { skipped.push(f.name); continue; }
      try { await f.run({ tick: _ticks }); ran.push(f.name); }
      catch (e) { errored.push({ name: f.name, error: (e && e.message) || String(e) }); }
    }
    return { ran, skipped, errored, tick: _ticks };
  }

  // start — arm ONE loop. `schedule(fn)` is the injected pump (requestIdleCallback in the browser, a paced
  // setInterval fallback). Each tick re-arms the next; the core never holds a timer. Returns a stop() handle.
  function start({ schedule } = {}) {
    if (typeof schedule !== "function") return () => {};
    let stopped = false;
    const loop = () => { if (stopped) return; tick().catch(() => {}).finally(() => { if (!stopped) schedule(loop); }); };
    schedule(loop);
    return () => { stopped = true; };
  }

  const pause = () => { paused = true; return true; };
  const resume = () => { paused = false; return true; };
  const isPaused = () => paused;
  const list = () => faculties.map((f) => ({ name: f.name, everyTicks: f.everyTicks, enabled: f.enabled }));

  return { register, tick, start, pause, resume, isPaused, faculties: list, ticks: () => _ticks };
}

// ── browser binding: window.HoloAmbient — the single ambient authority. The spine's reflect, trinity's
// drift-heal, and the evolve step REGISTER here instead of each spawning a timer; the heal-boot idle pump
// drives ambient.tick (one loop). trinity-ui stops calling startImproving once this owns the heartbeat.
// Law L2, one canonical wire. Created early + idempotent so faculties can register as they come up.
if (typeof window !== "undefined") {
  try {
    if (!window.HoloAmbient) {
      window.HoloAmbient = makeAmbient();
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-ambient-ready"));
    }
  } catch (e) { /* leave unset; callers fall back to their own loop */ }
}
