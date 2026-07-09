// holo-spine.mjs — the LIVE CADENCE of the autonomy spine (sense → reason → speak → act). Given one heal-loop
// tick, it folds the coherence snapshot (S1), reads the gate verdict if the shell exposes one, asks the
// observer what is worth raising (S2), and lets the courier speak under its send discipline (S3). ACTING (S4)
// stays behind HoloTrust and is NOT auto-invoked here — the live loop only proposes. Idempotent, fail-soft,
// no clock of its own. This is the one piece of active glue; everything it calls is already witnessed.

export function makeSpine({ coherence, observer, courier, gate = () => null, apps = () => [], system = () => [] } = {}) {
  let prev = null;
  function runOnce(tick = {}) {
    if (!coherence || !observer || !courier) return null;            // fail-soft until the spine is fully wired
    const heal = tick.summary ? { ...tick.summary, flaky: tick.flaky } : (tick.heal || {});
    const snapshot = coherence.fold({ heal, gate: gate() || {}, apps: apps(), system: system() });
    const diff = coherence.diff(prev, snapshot); prev = snapshot;
    const observation = observer.observe(snapshot);
    const delivery = courier.deliver(observation);                  // S3 SPEAK: send discipline decides what (if anything) is said
    // S0 ACT: after speaking, Q may also FIX — but only through the trust gate (propose-only until granted).
    // Fire-and-forget so the perception tick never blocks on a fix; nothing ships outside trust.act.
    try { if (typeof window !== "undefined" && window.HoloEvolve) window.HoloEvolve.step(observation).catch(() => {}); } catch (e) {}
    try { if (typeof window !== "undefined") window.__holoSpine = { coherence: snapshot.coherence, whole: snapshot.whole, raised: observation.proposals.length, spoke: delivery.spoke, at: snapshot.at }; } catch (e) {}
    return { snapshot, diff, observation, delivery };
  }
  return { runOnce, last: () => prev };
}

// ── browser binding: window.HoloSpine once coherence + observer + courier are all up. It does NOT own a loop;
// the heal-boot idle loop drives it (one guarded call). Law L2, one canonical wire. Fail-soft.
if (typeof window !== "undefined") {
  const wire = () => {
    try {
      if (window.HoloSpine || !window.HoloCoherence || !window.HoloObserver || !window.HoloCourier) return;
      window.HoloSpine = makeSpine({
        coherence: window.HoloCoherence, observer: window.HoloObserver, courier: window.HoloCourier,
        gate: () => window.__holoGateVerdict || null,                // optional live gate verdict, if the shell sets it
        apps: () => (window.__holoAppActivity || []),                // optional app-lifecycle rollup (shell observeApp seam)
      });
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-spine-ready"));
    } catch (e) { /* leave unset; the heal loop's call is guarded */ }
  };
  if (window.HoloCoherence && window.HoloObserver && window.HoloCourier) wire();
  else if (document.documentElement) {
    // any of the three becoming ready may complete the set — try on each
    ["holo-coherence-ready", "holo-observer-ready", "holo-courier-ready"].forEach((ev) =>
      document.documentElement.addEventListener(ev, wire));
  }
}
