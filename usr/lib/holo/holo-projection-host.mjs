// holo-projection-host.mjs — the ONE projection host for Holo Messenger. It owns the shared surface lens
// and a registry of SURFACES (chat, wallpaper, composer, sidebar, home, each embedded app, the Q orb). Each
// surface is a PRODUCER that yields κ-addressed draw items for its current view; every frame the host asks
// the live producers, uploads any new tiles into the ONE shared cache, and composites all surfaces as
// z-ordered layers in a single transparent pass. This is how "every experience in messenger is a projection"
// is enforced at runtime: an experience is either a registered producer (present:"gpu-lens") or it falls back
// to its own DOM/iframe and is FLAGGED (present:"dom") — never a hidden un-projected island. Relates:
// [[holo-messenger-projection-upgrade]] · holo-surface-lens.mjs · holo_osr.cc (the producer→lens pattern).
//
//   makeProjectionHost(canvas, { device? }) -> host        (async — probes WebGPU)
//     host.surface(id, producer, { z }) -> { remove(), setZ(n) }
//        producer(dtMs) -> [{ key, src?, x, y, w, h, alpha? }]   // src (OffscreenCanvas/ImageBitmap) only when a tile's pixels are NEW
//     host.start() / host.stop() / host.frameOnce(dtMs)          // frameOnce is deterministic (Node-drivable, no rAF)
//     host.ensureTile(key, src) · host.lens · host.info() · host.tier · host.destroy()
//   window.__projSurfaces() -> [{ id, z, present, fps, count }] — the runtime conformance probe

import { makeSurfaceLens } from "./holo-surface-lens.mjs";

export async function makeProjectionHost(canvas, { device = null } = {}) {
  const lens = await makeSurfaceLens(canvas, { device });
  const surfaces = new Map();                 // id → { id, producer, z, present, count }
  let alive = false, raf = 0, fpsEMA = 0, lastT = 0, dbgErr = null;

  function surface(id, producer, { z = 0 } = {}) {
    const s = { id, producer, z, present: lens ? "pending" : "dom", count: 0 };
    surfaces.set(id, s);
    return { remove: () => surfaces.delete(id), setZ: (v) => { s.z = v; } };
  }

  // one deterministic composition step — the rAF loop calls this; a witness can call it directly.
  function frameOnce(dtMs = 16) {
    if (!lens) { for (const s of surfaces.values()) s.present = "dom"; return; }
    const layers = [];
    for (const s of surfaces.values()) {
      let items;
      try { items = s.producer(dtMs) || []; } catch (e) { s.present = "err"; s.count = 0; if (!dbgErr) dbgErr = e; continue; }   // one bad surface never breaks the others
      const quads = [];
      for (const it of items) { if (it.src) { try { lens.ensureTile(it.key, it.src); } catch {} } quads.push({ key: it.key, x: it.x, y: it.y, w: it.w, h: it.h, alpha: it.alpha }); }
      layers.push({ z: s.z, quads });
      s.present = "gpu-lens"; s.count = quads.length;
    }
    try { lens.frame(layers); } catch (e) { if (!dbgErr) dbgErr = e; }
  }

  function loop() {
    if (!alive) return;
    const t = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (lastT) { const inst = 1000 / Math.max(1, t - lastT); fpsEMA = fpsEMA ? fpsEMA * 0.9 + inst * 0.1 : inst; }
    lastT = t;
    frameOnce(16);
    raf = requestAnimationFrame(loop);
  }
  function start() { if (alive || !lens) return; alive = true; if (typeof requestAnimationFrame !== "undefined") raf = requestAnimationFrame(loop); }
  function stop() { alive = false; if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(raf); }

  const info = () => [...surfaces.values()].map((s) => ({ id: s.id, z: s.z, present: s.present, fps: Math.round(fpsEMA), count: s.count }));
  if (typeof window !== "undefined") window.__projSurfaces = info;

  return {
    surface, start, stop, frameOnce, info,
    ensureTile: (k, src) => { if (lens) lens.ensureTile(k, src); },
    lens,
    get tier() { return lens ? "gpu-lens" : "dom"; },
    get err() { return dbgErr && (dbgErr.message || String(dbgErr)); },
    destroy() { stop(); if (lens) lens.destroy(); if (typeof window !== "undefined" && window.__projSurfaces === info) { try { delete window.__projSurfaces; } catch {} } },
  };
}

export default { makeProjectionHost };
