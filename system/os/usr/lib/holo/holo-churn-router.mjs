// holo-churn-router.mjs — the FULL-MOTION seam: classify each tile slot per frame as a raw κ TILE (low churn:
// UI, text, static — lossless, sharp) or a κ video CHUNK (high churn: video, animation, WebGL — WebCodecs, ~300×
// smaller). A slot that changes for `promoteAfter` consecutive frames PROMOTES to a codec stream; a slot static
// for `demoteAfter` frames DEMOTES back to a raw tile (its last frame re-enters the raster path, so a PAUSED
// video becomes free again). Hysteresis (promoteAfter ≠ demoteAfter) stops a region flapping between modes near
// the threshold. Pure + tiny; the producer (holo_osr.cc / the encode worker) ports this verbatim over its
// existing per-slot last_kappa_ state. node-/DOM-safe; no imports.
//
//   makeChurnRouter({ promoteAfter, demoteAfter })
//     classify(id, changed) -> "tile" | "vchunk"   // changed = did this slot's κ change this frame?
//     kindOf(id) -> current kind   ·   promoted()/demoted() since last frame (for keyframe scheduling)

export function makeChurnRouter({ promoteAfter = 4, demoteAfter = 8 } = {}) {
  if (!(promoteAfter >= 1) || !(demoteAfter >= 1)) throw new Error("holo-churn-router: promoteAfter/demoteAfter ≥ 1");
  const state = new Map();        // id → { kind, changeRun, staticRun }
  let lastTransitions = [];       // [{ id, to }] this frame — a promotion needs a keyframe

  function classify(id, changed) {
    let s = state.get(id);
    if (!s) { s = { kind: "tile", changeRun: 0, staticRun: 0 }; state.set(id, s); }
    if (changed) { s.changeRun++; s.staticRun = 0; } else { s.staticRun++; s.changeRun = 0; }
    const was = s.kind;
    if (s.kind === "tile" && s.changeRun >= promoteAfter) s.kind = "vchunk";        // sustained motion → codec
    else if (s.kind === "vchunk" && s.staticRun >= demoteAfter) s.kind = "tile";    // went still → raw tile (free)
    if (s.kind !== was) lastTransitions.push({ id, to: s.kind });
    return s.kind;
  }

  // call once per frame after classifying all slots; returns the promotions (each needs a codec keyframe) +
  // demotions (each region's last frame should be content-addressed back into the raster path), then resets.
  function frameTransitions() {
    const t = lastTransitions; lastTransitions = [];
    return { promoted: t.filter((x) => x.to === "vchunk").map((x) => x.id), demoted: t.filter((x) => x.to === "tile").map((x) => x.id) };
  }

  return { classify, frameTransitions, kindOf: (id) => (state.get(id) || {}).kind || "tile", state };
}

export default { makeChurnRouter };
