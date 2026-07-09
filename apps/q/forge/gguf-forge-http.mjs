// Network κ-transport — stream a sealed .holo's blocks over HTTP Range, so a token's experts
// are pulled from a server/peer, not just local disk. The κ-store law is unchanged: the source
// is never trusted, content is — every fetched range is verified by re-derivation (L5) and a
// corrupt range is refused. This is the "stream only the needed κ-weights from anywhere" half
// of the thesis; same get(hex) contract as makeDiskStore, but async over the wire.
//
// Bridge to the synchronous Tier-A forward: `decodeFromAsyncSource` runs the sync forward and,
// on a missing block, DEMAND-fetches exactly that κ from the async source, verifies, warms it
// into residency, and retries — so only the trunk + the experts a token actually routes to are
// ever pulled (unrouted experts never touch the wire). Production batches per-layer prefetch;
// demand-fetch is the honest minimal proof that transport is sparse.

import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const hexOf = (k) => String(k).split(":").pop();

// HTTP Range source over a served .holo file. `header` = the holo-pkg/1 header (blocks{off,len}),
// `regionStart` = align32(16+headerLen) (from openHoloPackageDisk). get(hex) → Promise<bytes>.
export function httpRangeSource(url, header, regionStart, { fetchImpl = fetch } = {}) {
  const stats = { fetches: 0, bytes: 0 };
  return {
    stats,
    async get(hex) {
      const loc = header.blocks[hex];
      if (!loc) return undefined;                                  // not a stored block (whole-stacks reconstruct from slices)
      const start = regionStart + loc.off, end = start + loc.len - 1;
      const res = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end}` } });
      if (res.status !== 206 && res.status !== 200) throw new Error(`httpRangeSource: HTTP ${res.status} for ${hex.slice(0, 12)}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length !== loc.len) throw new Error(`httpRangeSource: got ${buf.length}B, expected ${loc.len} for ${hex.slice(0, 12)}`);
      stats.fetches++; stats.bytes += buf.length;
      return buf;
    },
  };
}

// Run a synchronous forward against an ASYNC source by demand-fetching missing blocks.
// Returns { logits, fetched:Set<hex>, passes }. Each missing κ is fetched once, verified
// (sha256(bytes)===hex or refuse), warmed into `resident`, and the forward is retried.
export async function decodeFromAsyncSource({ forward, plan, graph, ids, expertDir, source, resident = new Map(), verify = true }) {
  const fetched = new Set();
  const store = { resident, has: (h) => resident.has(h), get: (h) => resident.get(h) };
  const load = (st, k) => { const h = hexOf(k); const b = resident.get(h); if (b === undefined) { const e = new Error("MISS " + h); e.missHex = h; throw e; } return b; };
  let passes = 0;
  for (;;) {
    passes++;
    try {
      const logits = forward(plan, graph, store, ids, { load, expertDir });
      return { logits, fetched, passes };
    } catch (e) {
      if (!e.missHex) throw e;
      const h = e.missHex;
      const bytes = await source.get(h);
      if (bytes === undefined) throw new Error(`decodeFromAsyncSource: source has no block ${h.slice(0, 12)}`);
      if (verify && sha256hex(bytes) !== h) throw new Error(`decodeFromAsyncSource: L5 refuse — ${h.slice(0, 12)} re-derives differently`);
      resident.set(h, bytes); fetched.add(h);
    }
  }
}
