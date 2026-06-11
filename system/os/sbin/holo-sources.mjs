// holo-sources.mjs — the ordered SOURCE CHAIN the κ-resolver pulls from (ADR-026). A file is
// fetched by its κ from the FASTEST place that has it and accepted ONLY after re-derivation
// (Law L5), so the origin gateway is just one source among peers — demoted from AUTHORITY to
// CDN. "Stored anywhere, accessed from multiple sources; trust is in the math, not the source"
// (docs/08 §Verify by re-derivation). This is what makes the whole OS gateway-free: deny the
// origin and the same verified bytes still arrive from cache, a peer, or a neighbour on the LAN.
//
// Each source is `async (kappa) => Uint8Array | null` (null = "I don't have it"). A source need
// NOT verify — the resolver re-derives every byte and refuses a wrong one, so a hostile source
// cannot poison the κ-store. Order = preference (latency, not trust):
//   cache (local, instant, offline) → peers (IPFS / Hypercore / mesh, gateway-free) → origin.
//
// Pure + isomorphic: importable in Node (the witness) and inside the Service Worker. The shared
// resolution spine lives in holo-resolver.mjs (witnessed A29); this only assembles its sources.

import { hexOf } from "./holo-resolver.mjs";

// cacheSource(get) — the local κ-store (W3C Cache API, OPFS, or a Map): a block verified once is
// served from anywhere thereafter, including with NO network (Law L3 — RAM/disk is a cache of the
// address space). `get(hex) → bytes | null`. This is the offline-first / survive-the-switch source.
export function cacheSource(get) {
  return async (kappa) => (await get(hexOf(kappa))) || null;
}

// originSource(closure, fetchImpl) — the ORIGIN gateway, demoted. It serves its own copy by path,
// still κ-VERIFIED by the resolver, so a tampered or substituted origin is refused exactly like
// any hostile peer. Placed LAST: used only when no nearer source has the block.
export function originSource(closure, fetchImpl) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const pathOf = (k) => { const h = hexOf(k); return Object.keys(closure).find((p) => hexOf(closure[p]) === h); };
  return async (kappa) => {
    if (!f) return null;
    const p = pathOf(kappa); if (!p) return null;
    const r = await f("/" + p, { cache: "force-cache" }).catch(() => null);
    return r && r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  };
}

// peerSource(name, getByKappa) — a gateway-free transport adapter (IPFS Bitswap, Hypercore,
// WebRTC mesh). `getByKappa(kappa) → bytes | null`. A sha-256 κ IS a CIDv1 (sha2-256), so the
// IPFS adapter maps κ → CID directly — IPFS adopted, not bridged. The adapter does not verify;
// the resolver does. `.peer` is a label for diagnostics.
export function peerSource(name, getByKappa) {
  const s = async (kappa) => { try { return (await getByKappa(kappa)) || null; } catch { return null; } };
  s.peer = name;
  return s;
}

// sourceChain({ cache, peers, origin }) — assemble the ordered list, dropping absent transports.
// The resolver tries each IN ORDER and the FIRST κ-verified copy wins (preference order, not a
// blind race: cache first for latency/offline, peers next for gateway-freedom, origin last).
export function sourceChain({ cache, peers = [], origin } = {}) {
  return [cache, ...(Array.isArray(peers) ? peers : [peers]), origin].filter(Boolean);
}

if (typeof self !== "undefined" && typeof window === "undefined" && typeof importScripts === "undefined") {
  // ESM module Service Worker: expose for holo-boot-sw.js without a bundler.
}
