// holo-pull.mjs — pipelined, deadline-aware pull of a κ's blocks over a VERIFIED block source
// (holo-mesh-blocks' wantBlock — every block re-derives on receipt, Law L5, so a peer cannot lie and
// no unverified byte ever reaches a consumer here). Keeps ≤ `pipeline` requests in flight — THIS is
// what beats RTT-bound, one-block-at-a-time fetch — feeds completions back to the picker, and exposes
// getBlock(cid): a DROP-IN for holo-ipfs-gateway's resolveIpfsPath / streamUnixFsFile, so the existing
// render path streams UNCHANGED while the picker front-runs the playhead. A consumer's getBlock() is
// treated as highest-priority demand under ANY strategy. Transport- and consumer-agnostic; timing via
// an injectable `now` (Node-witnessable). The multi-peer scheduler (holo-swarm-fetch) sits above this;
// the WebGPU/inference loop (holo-pull-consume) drives the playhead from below.

import { createPicker } from "./holo-pull-picker.mjs";

// source: { wantBlock(cid) → Promise<Uint8Array|null> }  (null = timeout / wrong bytes / declined)
export function createPull(source, { blocks = [], strategy = "streaming", window = 16, pipeline = 8, endgameThreshold = 4, peers = [], now = () => Date.now() } = {}) {
  const picker = createPicker({ blocks, strategy, window, endgameThreshold });
  const cache = new Map();          // cid → bytes (already L5-verified by the source)
  const inflight = new Set();
  const waiters = new Map();        // cid → [resolve]
  const demand = [];                // consumer-requested cids: highest priority, any strategy
  const blockCbs = [];
  let started = false, stopped = false, t0 = 0, ttffMs = -1, bytesIn = 0, failed = 0;

  const emit = (cid, b) => { for (const cb of blockCbs) try { cb(cid, b); } catch {} };
  const wake = (cid, b) => { const w = waiters.get(cid); if (w) { waiters.delete(cid); for (const r of w) r(b); } };

  async function fetchOne(cid) {
    inflight.add(cid);
    let b = null;
    try { b = await source.wantBlock(cid); } catch { b = null; }
    inflight.delete(cid);
    if (stopped) return;
    if (b) {                        // verified upstream — store, never re-hash, never re-verify
      if (!cache.has(cid)) { cache.set(cid, b); bytesIn += b.length || 0; picker.markHave(cid); if (ttffMs < 0) ttffMs = now() - t0; emit(cid, b); wake(cid, b); }
    } else { failed++; }            // re-eligible: a wrong/late/missing block just gets re-requested
    pump();
  }

  function pump() {
    if (stopped) return;
    for (let i = demand.length - 1; i >= 0; i--) if (cache.has(demand[i])) demand.splice(i, 1);   // prune satisfied
    for (const cid of demand) {                                                                    // 1) consumer demand first
      if (inflight.size >= pipeline) return;
      if (!cache.has(cid) && !inflight.has(cid)) fetchOne(cid);
    }
    while (inflight.size < pipeline) {                                                              // 2) picker fills the rest
      const want = picker.next(pipeline - inflight.size, peers, inflight);
      let issued = 0;
      for (const cid of want) if (!inflight.has(cid) && !cache.has(cid)) { fetchOne(cid); issued++; }
      if (!issued) break;
    }
  }

  function getBlock(cid) {
    if (cache.has(cid)) return Promise.resolve(cache.get(cid));
    if (!demand.includes(cid)) demand.push(cid);
    const p = new Promise((resolve) => { const w = waiters.get(cid) || []; w.push(resolve); waiters.set(cid, w); });
    if (started) pump();
    return p;
  }

  return {
    start() { if (started) return; started = true; t0 = now(); pump(); },
    stop() { stopped = true; },
    setPlayhead(i) { picker.setPlayhead(i); pump(); },
    setDeadline(cid, ms) { picker.setDeadline(cid, ms); pump(); },
    setStrategy(s) { picker.setStrategy(s); pump(); },
    setPeers(p) { peers = p; pump(); },
    onBlock(cb) { blockCbs.push(cb); },
    pull: getBlock,
    getBlock,                       // ← the drop-in for resolveIpfsPath / streamUnixFsFile
    has(cid) { return cache.has(cid); },
    stats() { const el = Math.max(1, now() - t0); return { ttffMs, inflight: inflight.size, have: cache.size, total: blocks.length, failed, bps: Math.round((bytesIn * 1000) / el), progress: picker.progress(), done: picker.done() }; },
  };
}

export default { createPull };
