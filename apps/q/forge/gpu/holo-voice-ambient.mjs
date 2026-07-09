// holo-voice-ambient.mjs — W1: the ambient duty-cycle. Running the 0.6B ear on silence would burn battery; this
// gates it on speech ENERGY. IDLE: a cheap energy check (the mic level the barge loop already computes) — the ear
// is asleep (resident weights stay warm, zero compute). When sustained speech energy appears, go ACTIVE: run the
// ear, feed partials to the wake detector (W0). On a wake → the conversation arms. After speech stops (hangover),
// back to IDLE. Sane on mobile AND desktop, still 100% on-device.
//
// Pure state machine, DOM-free; onActive/onIdle injected. onFrame(level, atMs) returns { state, run } — `run` is
// whether the ear should process this frame.

// makeAmbientGate({ energyFloor, startFrames, hangoverMs, onActive, onIdle })
export function makeAmbientGate({ energyFloor = 0.02, startFrames = 3, hangoverMs = 600, onActive = () => {}, onIdle = () => {} } = {}) {
  let state = "idle", loud = 0, lastLoudAt = -1e9, activeFrames = 0, earFrames = 0;

  function onFrame(level, atMs = 0) {
    const speech = level > energyFloor;
    if (state === "idle") {
      loud = speech ? loud + 1 : 0;                       // require `startFrames` of sustained energy (debounce spikes)
      if (loud >= startFrames) { state = "active"; activeFrames = 0; lastLoudAt = atMs; onActive(atMs); }
    } else {                                              // active: ear runs; idle out after a silent hangover
      activeFrames++; earFrames++;
      if (speech) lastLoudAt = atMs;
      else if (atMs - lastLoudAt >= hangoverMs) { state = "idle"; loud = 0; onIdle(atMs); }
    }
    return { state, run: state === "active" };
  }

  return { onFrame, reset() { state = "idle"; loud = 0; lastLoudAt = -1e9; activeFrames = 0; earFrames = 0; }, state: () => state, earFrames: () => earFrames };
}

export default { makeAmbientGate };
