// holo-q-vision-boot.mjs — LIVE WIRING: assemble the ambient raster edge from the OS's live globals and
// register it as ONE faculty of the single ambient heartbeat (window.HoloAmbient, S1 of the Q-unification).
// No private timer, no new surface, no user verb. Fail-soft + idempotent: it is INERT until a vision
// engine and a raster-island source exist — then perception "just works", paced by the one loop.
//
// THE SEAM: window.HoloAmbient is the single ambient authority (register/tick). window.HoloVision.perceive
// is the raster-edge verb. The mux 'vision' slot is bound to the engine by holo-q-vision.mjs when
// window.HoloVisionEngine is present. The native capture layer calls window.HoloAmbientPerception.live
// .notice(island) for every non-κ on-screen fragment. This module ties those together once.

import { createAmbientPerception } from "./holo-q-vision-ambient.mjs";
import { perceive } from "./holo-q-vision.mjs";
import "./holo-q-vision-capture.mjs";   // window.HoloVisionCapture — same-origin raster source
import "./holo-q-vision-engine.mjs";    // window.HoloVisionEngine (real ≤2B browser OCR) + self-bind (lazy model)
import "./holo-q-vision-engine-native.mjs"; // the 3B document engine (κ-addressed) — supersedes the browser one when a native host is present
import "./holo-q-vision-cdp.mjs";       // window.HoloVisionCdp — native cross-origin <iframe> leg (dormant on the web)
import "./holo-q-vision-store.mjs";     // window.HoloPerceptionCache — κ-store-backed O(1) persistent perception

// wireAmbientPerception(deps) — pure, testable assembly. Registers a "perceive-raster-edge" faculty on
// `ambient` that drains one noticed island per tick (the cold lane, paced by the one heartbeat). Returns
// the live watcher (with .notice for the capture layer), or null if there is no ambient loop to ride.
export function wireAmbientPerception({ ambient, scene = null, specialist = null, index = null, provenance = null, score = null, cache = null } = {}) {
  if (!ambient || typeof ambient.register !== "function") return null;
  const live = createAmbientPerception({ scene, perceive, specialist, index, provenance, score, cache, selfSchedule: false });
  ambient.register("perceive-raster-edge", () => live.drain(), { everyTicks: 1 });   // ONE faculty, one heartbeat
  // pause/resume the cold lane with the rest of the ambient layer — a user interaction already pauses
  // the whole loop; mirror it onto the watcher so an in-flight queue yields too.
  live.__boundAmbient = ambient;
  return live;
}

// ── browser auto-wire: ride the live globals as they come up; never throw, never block boot ──────────────
// holo-omni-index (record/search) and holo-strand-provenance (window.HoloStrandProvenance) are the
// photographic-memory and signed-history seams; the operator strand is read from the live Q when present.
if (typeof window !== "undefined") {
  const tryWire = () => {
    try {
      if (window.__holoVisionWired) return true;
      const ambient = window.HoloAmbient;
      if (!ambient) return false;                                    // wait for the one loop
      // the live perception scene (trinity owns it) + the bound vision specialist (mux), both optional:
      const scene = (window.Q && window.Q.scene) || (window.HoloTrinity && window.HoloTrinity.scene) || null;
      // the bound vision specialist: the engine module sets window.HoloVisionSpecialist when it installs;
      // fall back to the mux registry if some other path bound it. Null ⇒ the loop is inert (fail-soft).
      const specialist = window.HoloVisionSpecialist || (() => { try { const r = window.HoloQMux && window.HoloQMux.routeTask && window.HoloQMux.routeTask("vision"); return r && !r.fallback ? r : null; } catch { return null; } })();
      // photographic memory: record every perceived κ into the SAME on-device stores the omnibar and
      // Q.recall read — holo-omni-index (recent/rank) AND holo-omni-q.indexObject (full-text BM25 recall),
      // so "find where it said X" finds a foreign surface by the text Q OCR'd off it. Lazy-imported, fail-soft.
      const index = (() => {
        let oi = null, oq = null, loading = null;
        const ensure = () => loading || (loading = (async () => {
          try { oi = await import("/sbin/holo-omni-index.mjs"); } catch {}
          try { oq = await import("/sbin/holo-omni-q.mjs"); } catch {}
        })());
        return {
          record: (e) => { ensure().then(() => {
            try { if (oi) oi.record({ addr: e.addr, input: e.input, kind: e.kind, title: e.title, kappa: e.kappa }); } catch {}
            try { if (oq && oq.indexObject) oq.indexObject({ addr: e.addr, input: e.input || e.addr, kind: e.kind || "perceived", title: e.title, text: e.input || e.title }); } catch {}
          }); },
          search: async (q) => { await ensure(); try { return oi ? oi.search(q) : []; } catch { return []; } },
        };
      })();
      const strand = (window.Q && window.Q.strand) || (window.HoloStrand && window.HoloStrand.operator) || null;
      const provenance = (strand && window.HoloStrandProvenance) ? { append: (m) => window.HoloStrandProvenance.recordIngest(strand, { source: m.source, name: m.name, kind: m.kind, view: m.view, bytes: m.bytes }) } : null;
      const score = (() => { try { return window.HoloRank && window.HoloProfile ? (isl) => window.HoloProfile.affinity ? window.HoloProfile.affinity(isl.hint || "") : 0 : null; } catch { return null; } })();
      // the κ-store-backed persistent cache: re-seeing any surface (this or a prior session/device) is an
      // O(1) substrate read, no OCR. Lazily resolves the live OPFS κ-store; fail-soft (in-memory if absent).
      const cache = (() => {
        let c = null, loading = null;
        const ensure = () => loading || (loading = ((window.HoloPerceptionCache && window.HoloPerceptionCache.live) ? window.HoloPerceptionCache.live() : Promise.resolve(null)).then((x) => { c = x; }).catch(() => {}));
        return { get: async (h) => { await ensure(); return c ? c.get(h) : null; }, put: async (h, o) => { await ensure(); return c ? c.put(h, o) : null; } };
      })();
      const live = wireAmbientPerception({ ambient, scene, specialist, index, provenance, score, cache });
      if (!live) return false;
      window.HoloAmbientPerception = Object.assign(window.HoloAmbientPerception || {}, { live, wireAmbientPerception });
      // attach the browser-tier raster-island source (same-origin canvas/img/video). The capture calls
      // live.notice for every non-κ surface; a light scan on the one heartbeat keeps it current. Fail-soft.
      try {
        if (window.HoloVisionCapture && !window.__holoCaptureWired) {
          const capture = window.HoloVisionCapture.attach((island) => live.notice(island));
          ambient.register("scan-raster-edge", () => { try { return capture.scan(document); } catch { return null; } }, { everyTicks: 8 });
          window.__holoCaptureWired = true;
          window.HoloAmbientPerception.capture = capture;
        }
      } catch {}
      window.__holoVisionWired = true;
      return true;
    } catch (e) { return false; }
  };
  if (!tryWire()) {
    // arm when the one loop announces itself, and as a backstop poll a few times during boot
    try { document.documentElement.addEventListener("holo-ambient-ready", tryWire, { once: true }); } catch {}
    let n = 0; const iv = setInterval(() => { if (tryWire() || ++n > 40) clearInterval(iv); }, 250);
  }
}

export default { wireAmbientPerception };
