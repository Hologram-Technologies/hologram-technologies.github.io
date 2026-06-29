// holo-kappa-swarm.mjs — the swarm tile resolver for κ-projection co-view.
//
// Today a viewer fetches every tile from the origin (1→1). This makes it 1→N a SWARM: to get a tile, ask the room
// "who holds blake3 X?", fetch from the nearest peer that has it, and — because the tile is content-addressed —
// L5-VERIFY it (re-derive to its own address) regardless of source. A peer that serves tampered bytes is skipped
// and the next holder tried; only if no peer has a valid copy do we fall back to the origin (the floor). On a
// valid fetch we register self as a holder, so later joiners pull from US. Throughput rises with the swarm,
// latency falls with proximity, the origin uploads each novel tile ~once.
//
// THE WHOLE REASON THIS IS SAFE: a tile from any peer re-derives to its address or it's refused — there is no
// "trusted peer". Verification is by math, not by source. (This is the keystone; real peer transport / DHT
// discovery / piece-picking wrap around it — inject `peers()` from the room.)
//
// Pure: inject peers / originGet / digestHex. De-risk it in node before any transport (see the witness).
//
// makeSwarmResolver({ peers, originGet, digestHex, selfStore?, } ) → { swarmGet, stats, selfStore, has }
//   peers(): () => Array<{ has?(b3)→bool, get(b3)→Promise<Uint8Array> }>   holders, caller-ordered nearest-first
//   originGet(b3): Promise<Uint8Array>     the 1→1 floor (κ-cache / shared-κ origin)
//   digestHex(bytes): Promise<string>      re-derive the blake3 address (L5)
//   selfStore: Map                         residency — a held κ is a ref (no re-fetch) AND makes you a holder

export function makeSwarmResolver({ peers = () => [], originGet, digestHex, selfStore = new Map(), onHold } = {}) {
  const stats = { fromPeerBytes: 0, fromOriginBytes: 0, peerHits: 0, originHits: 0, refused: 0, residentHits: 0 };

  async function verifiedFetch(get, b3, source) {
    let bytes;
    try { bytes = await get(b3); } catch (e) { return null; }
    if (!bytes) return null;
    if ((await digestHex(bytes)) !== b3) { stats.refused++; return null; }   // L5 — a tampered/wrong holder is skipped
    const fresh = !selfStore.has(b3);
    selfStore.set(b3, bytes);                                                // verified → become a holder for later joiners
    if (fresh && typeof onHold === "function") { try { onHold(b3); } catch (e) {} }   // advertise the new holding to the room
    if (source === "peer") { stats.fromPeerBytes += bytes.length; stats.peerHits++; }
    else { stats.fromOriginBytes += bytes.length; stats.originHits++; }
    return bytes;
  }

  // PIECE-PICKING: among the peers that ACTUALLY hold b3 (real has()), try the NEAREST first (lowest latency). A
  // peer with no has() is treated as a maybe-holder (asked after known holders). Unknown latency sorts middling.
  function orderHolders(b3) {
    return peers()
      .filter((p) => typeof p.has !== "function" || p.has(b3))
      .sort((a, b) => (a.latency ?? 50) - (b.latency ?? 50));
  }

  async function swarmGet(b3) {
    const resident = selfStore.get(b3);
    if (resident) { stats.residentHits++; return resident; }                 // already verified-resident → ref, no wire
    for (const p of orderHolders(b3)) {                                      // nearest holder of b3 first
      const bytes = await verifiedFetch((x) => p.get(x), b3, "peer");
      if (bytes) return bytes;                                               // first VALID holder wins (tampered ones skipped)
    }
    return await verifiedFetch(originGet, b3, "origin");                     // no valid peer → the origin floor
  }

  return { swarmGet, orderHolders, stats, selfStore, has: (b3) => selfStore.has(b3) };
}

export default { makeSwarmResolver };
