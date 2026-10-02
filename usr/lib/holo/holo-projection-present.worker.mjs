// holo-projection-present.worker.mjs — the fabric's ONE present worker (F1). Owns every surface the
// fabric paints; from F2-F4 it owns the GPUDevice (WGSL BLAKE3 verify + the VRAM κ-atlas) and hosts
// makeProjectionHost/surface-lens for scene streams from the holo-projector seam. F1 floor: decode +
// paint OFF-MAIN onto transferred OffscreenCanvases, and THE κ-CACHE — content-addressed decoded
// surfaces, so a repeat κ is a BIND: 0 fetch, 0 hash, 0 transfer, 0 decode (SEC-3, observable).
//
// L3: this cache is memory over the store — eviction is GC (simple LRU cap here; VRAM-bounded atlas
// at F3); a re-fault re-streams from the resolver lane. Verified-before-paint is upstream (L5 in the
// resolver worker; the GPU takes it at F2) — nothing unverified ever reaches a surface.

let lane = null;
let _gpu = null;      // null=untried · false=unavailable · {hash} — the E1 verifier (lazy)
async function verifier() {
  if (_gpu === null) {
    try { const { makeGpuKappa } = await import("./holo-projection-verify.mjs"); _gpu = (await makeGpuKappa()) || false; }
    catch (e) { _gpu = false; }
  }
  return _gpu;
}
const mounts = new Map();     // id → { canvas, ctx, dpr }
const waits = new Map();      // id → { kappa, t0 }
const cache = new Map();      // κ → ImageBitmap | { raw:Uint8Array }  (LRU, capped)
const CACHE_CAP = 128;

const lru = (k, v) => { cache.delete(k); cache.set(k, v); if (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value); };

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.op === "init") {
    lane = m.lane;
    lane.onmessage = (ev) => onLane(ev.data || {});
    return;
  }
  if (m.op === "mount") mounts.set(m.id, { canvas: m.canvas, ctx: null, dpr: m.dpr || 1 });
  if (m.op === "warm") verifier();                       // pre-init device+pipelines (H3 INSTANT)
};

function onLane(m) {
  if (m.op === "want") {
    const hit = cache.get(m.kappa);
    if (hit) { lru(m.kappa, hit); return presentNow(m.id, m.kappa, hit, { resident: true, fetched: false }); }
    waits.set(m.id, { kappa: m.kappa, t0: performance.now() });
    lane.postMessage({ op: "need", id: m.id, kappa: m.kappa });
    return;
  }
  if (m.op === "bytes") return admit(m);
  if (m.op === "sbegin") { sessions.set(m.id, { kappa: m.kappa, manifest: m.manifest, segs: [], parts: [], t0: performance.now(), q: Promise.resolve() }); return; }
  // sseg/send handlers are ASYNC (GPU awaits) — the port delivers in order but handlers would interleave;
  // a per-session promise CHAIN serializes them (send must observe every verified segment).
  if (m.op === "sseg") { const S = sessions.get(m.id); if (S) S.q = S.q.then(() => onSegment(m)); return; }
  if (m.op === "send") { const S = sessions.get(m.id); if (S) S.q = S.q.then(() => onStreamEnd(m)); return; }
  if (m.op === "fail") { waits.delete(m.id); sessions.delete(m.id); self.postMessage({ op: "error", id: m.id, why: m.why }); }
}

// ── G1: the STREAMED road — each segment verifies ON THE GPU as it arrives (refuse-early), the final
// fold of segment CVs must re-derive the object κ (a forged manifest cannot survive it — L5 authority).
const sessions = new Map();   // id → { kappa, manifest, segs:[{chunks,cv}], parts:[Uint8Array], t0 }
async function onSegment(m) {
  const S = sessions.get(m.id); if (!S) return;
  try {
    const { segmentsFor } = await import("./holo-projection-verify.mjs");
    const layout = segmentsFor(S.manifest.size)[m.i];
    const bytes = new Uint8Array(m.buf);
    const g = await verifier();
    let cv;
    if (g) cv = await g.segmentCV(bytes, layout.chunkOff);
    else { sessions.delete(m.id); return self.postMessage({ op: "error", id: m.id, why: "streamed verify needs WebGPU here — JS floor falls back to whole-object (retry expected)" }); }
    const hexOf = (w) => Array.from(w, (x) => [x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255].map((b) => b.toString(16).padStart(2, "0")).join("")).join("");
    if (hexOf(cv) !== S.manifest.cvs[m.i]) {
      sessions.delete(m.id);
      return self.postMessage({ op: "error", id: m.id, why: `REFUSED at segment ${m.i + 1}/${S.manifest.cvs.length} — re-derived ${hexOf(cv).slice(0, 12)}… ≠ manifest ${S.manifest.cvs[m.i].slice(0, 12)}… (L5, mid-stream)` });
    }
    S.segs[m.i] = { chunks: layout.chunks, cv };
    S.parts[m.i] = bytes;
  } catch (e) { sessions.delete(m.id); self.postMessage({ op: "error", id: m.id, why: String(e.message || e) }); }
}
async function onStreamEnd(m) {
  const S = sessions.get(m.id); if (!S) return;
  sessions.delete(m.id);
  try {
    const { foldSegmentCVs } = await import("./holo-projection-verify.mjs");
    const root = foldSegmentCVs(S.segs);
    if (root !== S.kappa) return self.postMessage({ op: "error", id: m.id, why: `REFUSED: segment fold ${root.slice(0, 12)}… ≠ ${S.kappa.slice(0, 12)}… (L5 root)` });
    const whole = new Uint8Array(S.manifest.size);
    let off = 0; for (const p of S.parts) { whole.set(p, off); off += p.length; }
    admit({ id: m.id, kappa: S.kappa, buf: whole.buffer, verify: "gpu-stream", verify_ms: +(performance.now() - S.t0).toFixed(1), segments: S.manifest.cvs.length });
  } catch (e) { self.postMessage({ op: "error", id: m.id, why: String(e.message || e) }); }
}

async function admit(m) {
  waits.delete(m.id);
  const bytes = new Uint8Array(m.buf);
  // E1: the GPU road — a tagged object verifies HERE, before any byte reaches the cache or a surface.
  if (m.verify === "gpu-stream") { /* already verified per-segment + root-folded */ }
  else if (m.verify === "gpu-pending") {
    const t0 = performance.now();
    const g = await verifier();
    let got;
    if (g) got = await g.hash(bytes);
    else { const { blake3hex } = await import("./holo-blake3.mjs"); got = await blake3hex(bytes); }   // no-WebGPU floor
    if (got !== m.kappa) { self.postMessage({ op: "error", id: m.id, why: "REFUSED: re-derived " + got.slice(0, 12) + "… ≠ " + m.kappa.slice(0, 12) + "… (L5, " + (g ? "gpu" : "js") + ")" }); return; }
    m.verify = g ? "gpu" : "js-floor";
    m.verify_ms = +(performance.now() - t0).toFixed(1);
  }
  let surface = null;
  try { surface = await createImageBitmap(new Blob([bytes])); } catch (e) { surface = { raw: bytes }; }   // non-image κ: held raw (F4 routes by kind)
  lru(m.kappa, surface);
  presentNow(m.id, m.kappa, surface, { resident: false, fetched: true, bytes: bytes.length, verify: m.verify, segments: m.segments, fetch_ms: m.fetch_ms, verify_ms: m.verify_ms });
}

function presentNow(id, kappa, surface, extra) {
  const t0 = performance.now();
  const mnt = mounts.get(id);
  let painted = false;
  if (mnt && surface && surface.width) {
    try {
      if (!mnt.ctx) mnt.ctx = mnt.canvas.getContext("2d");
      const c = mnt.canvas;
      const s = Math.min(c.width / surface.width, c.height / surface.height);
      const w = surface.width * s, h = surface.height * s;
      mnt.ctx.clearRect(0, 0, c.width, c.height);
      mnt.ctx.drawImage(surface, (c.width - w) / 2, (c.height - h) / 2, w, h);
      painted = true;
    } catch (e) {}
  }
  self.postMessage({ op: "stats", id, stats: { kappa, painted, resident: !!extra.resident, fetched: !!extra.fetched,
    bytes: extra.bytes ?? (surface && surface.raw ? surface.raw.length : undefined), verify: extra.verify, segments: extra.segments,
    fetch_ms: extra.fetch_ms, verify_ms: extra.verify_ms, present_ms: +(performance.now() - t0).toFixed(2), cache_size: cache.size } });
}
