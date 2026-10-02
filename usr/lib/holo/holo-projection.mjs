// holo-projection.mjs — the PROJECTION FABRIC façade (F1 of HOLO-PORTAL-PROMPT.md).
//
// Names are taken seriously here: holo-portal.mjs is the κ-Portal LINK feature; holo-projector.mjs is
// the origin↔lens SEAM (scenes of κ-regions, novelty-only wire); holo-projection-host.mjs is the
// messenger's surface host. This module is their CARRIAGE: the worker topology that takes all of that
// OFF the main thread. Main thread = compositor only.
//
//   RESOLVER worker : classify/resolve/stream κ-objects off-main (names-host + rescue + verify — L5
//                     before a byte crosses the lane; GPU verify takes the job in F2). Its per-
//                     experience MessagePorts ARE the capability grants (SEC-2): minted scoped to a
//                     name-set, revoked = the experience's reach dies.
//   PRESENT worker  : ONE owner of presentation. F1: OffscreenCanvas present + a κ-keyed bitmap cache —
//                     a repeat κ is a BIND (0 fetch / 0 hash / 0 transfer — SEC-3, observable in
//                     stats.resident). F2-F4 grow it into the device owner: WGSL BLAKE3 + κ-atlas +
//                     makeProjectionHost/surface-lens hosted HERE, presenting scenes from the
//                     holo-projector seam.
//   Bytes flow resolver → present over a direct MessageChannel; main sees only stats.
//
//   const fabric = await mountProjection({ base });
//   const h = await fabric.project(name, canvasEl, { grant: [name] });
//   h.stats() → { kappa, bytes, fetched, verify_ms, decode_present_ms, resident }
//   h.again()  — re-project (resident bind) · h.revoke() — capability dies, further projects refuse.

const HERE = new URL("./", import.meta.url);

export async function mountProjection({ base } = {}) {
  const BASE = base || new URL("../../../", import.meta.url).href;      // bundle root from usr/lib/holo
  const resolver = new Worker(new URL("holo-projection-resolver.worker.mjs", HERE), { type: "module" });
  const present = new Worker(new URL("holo-projection-present.worker.mjs", HERE), { type: "module" });

  const lane = new MessageChannel();                                     // the byte lane — never through main
  resolver.postMessage({ op: "init", base: BASE, lane: lane.port1 }, [lane.port1]);
  present.postMessage({ op: "init", lane: lane.port2 }, [lane.port2]);

  let nextId = 1;
  const pending = new Map(), stats = new Map();
  const settle = (m) => { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.op === "stats" ? p.resolve(m.stats) : p.reject(new Error(m.why)); };
  present.onmessage = (e) => { const m = e.data || {}; if (m.op === "stats") { stats.set(m.id, m.stats); settle(m); } else if (m.op === "error") settle(m); };
  resolver.onmessage = (e) => { const m = e.data || {}; if (m.op === "refused") settle(m); };

  return {
    /** pre-initialize the GPU verifier (device + pipelines, ~1.7-3.6s once) OFF the critical path —
     *  call from idle after mount so the user's first paste never pays it (INSTANT, H3). */
    warm() { try { present.postMessage({ op: "warm" }); } catch (e) {} },
    async project(name, canvas, { grant = [name] } = {}) {
      const id = nextId++;
      const cap = new MessageChannel();                                  // the capability (SEC-2)
      resolver.postMessage({ op: "grant", id, names: grant, port: cap.port1 }, [cap.port1]);
      if (canvas && canvas.transferControlToOffscreen) {
        const off = canvas.transferControlToOffscreen();                 // once-only — the façade owns canvas lifecycle
        present.postMessage({ op: "mount", id, canvas: off, dpr: globalThis.devicePixelRatio || 1 }, [off]);
      }
      let revoked = false;
      // revoke() enforces SEC-2 at BOTH ends: the façade refuses locally (a dead capability must reject,
      // not hang — a closed port drops messages silently) and the resolver kills the grant remotely.
      const run = () => {
        if (revoked) return Promise.reject(new Error("capability revoked (SEC-2)"));
        const d = new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
        cap.port2.postMessage({ op: "project", id, name });
        return d;
      };
      await run();
      return {
        id,
        stats: () => stats.get(id),
        again: run,
        revoke: () => { revoked = true; try { cap.port2.postMessage({ op: "revoke", id }); cap.port2.close(); } catch (e) {} },
      };
    },
    kill() { resolver.terminate(); present.terminate(); },
  };
}
