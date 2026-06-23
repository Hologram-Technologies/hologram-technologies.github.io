// holo-swarm-fetch.mjs — the multi-peer rung. Presents the SAME { wantBlock(cid) } interface holo-pull
// already consumes, but routes each request across a SET of peers: pick the best holder (least in-flight,
// then fastest by EWMA bandwidth, then fewest failures = a minimal speed-band choke/unchoke), and on a
// null/timeout REASSIGN to another holder before giving up. So one slow or lying peer can only slow
// ITSELF — it never stalls the stream (this is what Phase A deferred to here). Trust stays in κ + L5:
// every byte still flows through each peer's holo-mesh-blocks wantBlock, so a peer that serves garbage
// fails to re-derive, is dropped, and the block is re-fetched from an honest holder. The aggregate
// have-maps (`peers`) feed holo-pull's picker so `rarest` works end-to-end.
//
//   peer := { id, wantBlock(cid) → Promise<Uint8Array|null>, has(cid) → bool }   (has from a bitfield/have-map)

export function createSwarmSource(peerList = [], { attempts = 3, now = () => Date.now() } = {}) {
  const state = peerList.map((p) => ({ p, inflight: 0, ewmaBps: 0, ok: 0, fail: 0 }));

  const holdersOf = (cid) => state.filter((s) => { try { return s.p.has ? s.p.has(cid) : (s.p.blocks && s.p.blocks.has(cid)); } catch { return false; } });
  // unchoke logic: least-loaded first, then fastest, then most-reliable. A fresh/idle peer (inflight 0)
  // is naturally tried (the optimistic-unchoke effect); a slow peer's in-flight piles up so it sinks.
  function pickPeer(cid, exclude) {
    const cands = holdersOf(cid).filter((s) => !exclude.has(s));
    if (!cands.length) return null;
    cands.sort((a, b) => (a.inflight - b.inflight) || (b.ewmaBps - a.ewmaBps) || (a.fail - b.fail));
    return cands[0];
  }

  async function wantBlock(cid) {
    const tried = new Set();
    for (let i = 0; i < attempts; i++) {
      const s = pickPeer(cid, tried);
      if (!s) break;                              // no (untried) holder left → let holo-pull re-request later
      tried.add(s);
      s.inflight++;
      const t = now();
      let b = null;
      try { b = await s.p.wantBlock(cid); } catch { b = null; }
      s.inflight--;
      if (b) {                                    // verified by the peer's mesh layer (L5) before it ever returns
        s.ok++;
        const bps = ((b.length || 0) * 1000) / Math.max(1, now() - t);
        s.ewmaBps = s.ewmaBps ? s.ewmaBps * 0.7 + bps * 0.3 : bps;
        return b;
      }
      s.fail++;                                   // reassign to another holder
    }
    return null;
  }

  return {
    wantBlock,
    get peers() { return state.map((s) => s.p); },     // → holo-pull { peers } so `rarest` sees availability
    addPeer(p) { if (!state.some((s) => s.p.id === p.id)) state.push({ p, inflight: 0, ewmaBps: 0, ok: 0, fail: 0 }); },
    dropPeer(id) { const i = state.findIndex((s) => s.p.id === id); if (i >= 0) state.splice(i, 1); },
    stats() { return state.map((s) => ({ id: s.p.id, inflight: s.inflight, ok: s.ok, fail: s.fail, bps: Math.round(s.ewmaBps) })); },
  };
}

export default { createSwarmSource };
