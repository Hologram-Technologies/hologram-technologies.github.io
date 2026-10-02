// holo-projection-resolver.worker.mjs — the fabric's RESOLVER lane (F1). A module worker: every κ
// resolve, fetch, and verify happens HERE — the main thread never touches a content byte.
//
// Capabilities (SEC-2): the façade mints one MessagePort per experience, granted a NAME-SET. This
// worker refuses any project outside the grant; a revoked port's experience is dead — authority only
// attenuates, enforced at the only place bytes can enter.
//
// The lane speaks want/need/bytes: a "project" first sends WANT to the present worker; if the κ is
// RESIDENT there the projection is a BIND and no fetch happens at all (SEC-3 — the InfiniBand moment).
// Only a NEED comes back here, and then: fetch (the SW's κ-route/rescue rungs answer underneath) →
// re-derive against the κ IN THIS WORKER (L5 — F2 moves big objects onto the GPU) → ownership of the
// buffer MOVES across the lane (zero-copy Transferable).

import { blake3hex } from "./holo-blake3.mjs";
import { segmentsFor } from "./holo-projection-verify.mjs";

let BASE = "";
let _reg = null;                    // holo-manifests.json — lazy + memoized (restart-safe)
const registry = async () => (_reg ||= fetch(new URL("holo-manifests.json", BASE), { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
let lane = null;
const grants = new Map();           // id → { names:Set, port, revoked }

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.op === "init") {
    BASE = m.base; lane = m.lane;
    lane.onmessage = (ev) => { const n = ev.data || {}; if (n.op === "need") produce(n.id, n.kappa); };
    return;
  }
  if (m.op === "grant") {
    const g = { names: new Set(m.names || []), port: m.port, revoked: false };
    grants.set(m.id, g);
    g.port.onmessage = (ev) => onCap(m.id, g, ev.data || {});
  }
};

function onCap(id, g, m) {
  if (m.op === "revoke") { g.revoked = true; try { g.port.close(); } catch (e) {} return; }
  if (m.op !== "project") return;
  if (g.revoked) return self.postMessage({ op: "refused", id, why: "capability revoked (SEC-2)" });
  if (!g.names.has(m.name)) return self.postMessage({ op: "refused", id, why: "name outside this experience's grant (SEC-2)" });
  const hex = String(m.name).replace(/^blake3:/, "");
  if (!/^[0-9a-f]{64}$/.test(hex)) return self.postMessage({ op: "refused", id, why: "F1 speaks blake3 κs (the name plane joins at F5)" });
  lane.postMessage({ op: "want", id, kappa: hex });                       // resident? → bind, no fetch
}

async function produce(id, hex) {
  try {
    const t0 = performance.now();
    // G1: STREAMED when a sidecar manifest exists — segments cross the lane as they arrive and verify
    // ON THE GPU mid-stream (refuse-early at the failing segment). The manifest itself is a tiny
    // κ-object, JS-verified here; a forged manifest still dies at the final root fold (L5 authority).
    const reg = await registry();
    const mHex = reg[hex];
    if (mHex) {
      const mr = await fetch(new URL("b/" + mHex, BASE), { cache: "no-store" });
      if (mr.ok) {
        const mBytes = new Uint8Array(await mr.arrayBuffer());
        if ((await blake3hex(mBytes)) === mHex) {
          const manifest = JSON.parse(new TextDecoder().decode(mBytes));
          if (manifest.root === hex && manifest.axis === "blake3") return streamSegments(id, hex, manifest, t0);
        }
      }
    }
    // κ-route first: under SW control it verifies + falls to the mirror for pruned objects; the plain
    // b/ path is the uncontrolled-page floor. Either way L5 re-derives below — rungs are hints (SEC-6).
    let r = await fetch(new URL(".holo/blake3/" + hex, BASE), { cache: "no-store" }).catch(() => null);
    if (!r || !r.ok) r = await fetch(new URL("b/" + hex, BASE), { cache: "no-store" });
    if (!r.ok) throw new Error("no rung produced the object (http " + r.status + ")");
    const bytes = new Uint8Array(await r.arrayBuffer());
    const tFetch = performance.now();
    // E1: the GPU road. Objects past the measured crossover (~64 KB: GPU dispatch+readback ≈ JS hash
    // time) cross the lane UNVERIFIED-BUT-TAGGED — the present worker verifies on the GPU BEFORE any
    // byte is cached or painted (L5 holds, 18×+ faster). Small objects keep the instant JS check here.
    if (bytes.length > 65536) {
      lane.postMessage({ op: "bytes", id, kappa: hex, buf: bytes.buffer, verify: "gpu-pending",
        fetch_ms: +(tFetch - t0).toFixed(1) }, [bytes.buffer]);
      return;
    }
    const got = await blake3hex(bytes);                                   // L5 — off-main, before the lane
    if (got !== hex) throw new Error("REFUSED: re-derived " + got.slice(0, 12) + "… ≠ " + hex.slice(0, 12) + "… (L5)");
    const tVerify = performance.now();
    lane.postMessage({ op: "bytes", id, kappa: hex, buf: bytes.buffer, verify: "js",
      fetch_ms: +(tFetch - t0).toFixed(1), verify_ms: +(tVerify - tFetch).toFixed(1) }, [bytes.buffer]);
  } catch (err) {
    lane.postMessage({ op: "fail", id, why: String(err.message || err) });
  }
}

// stream one object as manifest segments: exact byte cuts, each an aligned subtree — the present
// worker verifies each ON ARRIVAL. Ownership moves per segment (zero-copy Transferables).
async function streamSegments(id, hex, manifest, t0) {
  try {
    let r = await fetch(new URL(".holo/blake3/" + hex, BASE), { cache: "no-store" }).catch(() => null);
    if (!r || !r.ok) r = await fetch(new URL("b/" + hex, BASE), { cache: "no-store" });
    if (!r.ok) throw new Error("no rung produced the object (http " + r.status + ")");
    const segs = segmentsFor(manifest.size);
    lane.postMessage({ op: "sbegin", id, kappa: hex, manifest, fetch_t0: t0 });
    const reader = r.body.getReader();
    let seg = 0, want = Math.min(segs[0].chunks * 1024, manifest.size - segs[0].chunkOff * 1024);
    let buf = new Uint8Array(want), fill = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let v = value;
      while (v.length) {
        const take = Math.min(v.length, want - fill);
        buf.set(v.subarray(0, take), fill); fill += take; v = v.subarray(take);
        if (fill === want) {
          lane.postMessage({ op: "sseg", id, i: seg, buf: buf.buffer }, [buf.buffer]);
          seg++;
          if (seg < segs.length) { want = Math.min(segs[seg].chunks * 1024, manifest.size - segs[seg].chunkOff * 1024); buf = new Uint8Array(want); fill = 0; }
          else { buf = null; want = 0; }
        }
      }
    }
    if (buf && fill) throw new Error("stream ended mid-segment (" + fill + "/" + want + ")");
    lane.postMessage({ op: "send", id });
  } catch (err) { lane.postMessage({ op: "fail", id, why: String(err.message || err) }); }
}
