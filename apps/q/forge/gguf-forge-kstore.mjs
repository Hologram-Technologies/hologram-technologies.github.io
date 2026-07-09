// Resident, multi-source κ-store — the Node-testable realization of the warm-residency
// + multi-source semantics that qvac-kstore.mjs (content-keyed verify-once cache,
// shared across loads) and qvac-kdisk.mjs (round-robin sources, per-sector re-derive,
// κ-verified failover) provide in the browser. Same law, smaller surface:
//
//   • L3 residency: a content-keyed cache (κ-hex → bytes) PERSISTS across forwards —
//     pass the same `resident` Map to a second forward and already-fetched experts are
//     served with zero source traffic (warm / hot-set convergence).
//   • Multi-source: ordered `sources` (local OPFS-ish, LAN peer, CDN). A block missing
//     from one source falls over to the next; a CORRUPT source is rejected by
//     re-derivation (sha256(bytes)===κ) and the next source is tried — sources are
//     never trusted, content is.
//
// Boundary (honest): the real browser path is async (HTTP Range / OPFS) and is
// qvac-kstore/kdisk; this models the cache + failover + verify LOGIC synchronously over
// in-memory sources so the synchronous Tier-A forward can drive it under test. Swap the
// sources for the real readers in the browser; the verify-by-re-derivation law is identical.

import { readSync } from "node:fs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

// sources: ordered array of { get(hex) -> Uint8Array | undefined }. resident: a Map
// reused across forwards to model L3 persistence. Returns a store usable by loadByKappa
// (it exposes get/has) plus a `stats` ledger.
export function makeResidentStore({ sources = [], resident = new Map(), verify = true } = {}) {
  const SRC = sources.length ? sources : [];
  const stats = { hits: 0, fetched: 0, verified: 0, refused: 0, perSource: SRC.map(() => 0) };
  return {
    resident, stats,
    has(hex) { return resident.has(hex) || SRC.some((s) => s.get(hex) !== undefined); },
    get(hex) {
      const hit = resident.get(hex);
      if (hit) { stats.hits++; return hit; }                       // warm: served from residency, no source touch
      for (let i = 0; i < SRC.length; i++) {
        const b = SRC[i].get(hex);
        if (b === undefined) continue;                             // not on this source → next
        stats.fetched++; stats.perSource[i]++;
        if (verify) { stats.verified++; if (sha256hex(b) !== hex) { stats.refused++; continue; } } // corrupt → refuse, failover
        resident.set(hex, b);                                      // L3: verified once, now warm forever
        return b;
      }
      return undefined;                                            // exhausted → loadByKappa throws "κ not found"
    },
  };
}

// Convenience: wrap a plain Map (or {get}) as a single source.
export const asSource = (mapOrGet) => (typeof mapOrGet.get === "function" ? mapOrGet : { get: (h) => mapOrGet[h] });

// Disk-backed κ-store — serve any κ-block by RANGE-READING the file (no whole-model RAM),
// with a BOUNDED LRU so memory tracks the ACTIVE set, not the model. This is the qvac-kdisk
// analog for multi-GB models (GLM-5.2): forgeGgufScan emits `dir: { hex -> {fileOffset,len} }`;
// here get(hex) reads that span from `fd`, verifies by re-derivation (sha256===hex, L5), and
// caches it in an LRU capped at `budgetBytes` (oldest evicted first). Synchronous (readSync)
// so the Tier-A forward drives it directly. Cache HITS skip re-verify (verify-once-per-residency);
// an evicted-then-refetched block is re-verified. Drop-in for loadByKappa/fastload (get/has).
export function makeDiskStore({ fd, dir, budgetBytes = 1 << 30, verify = true } = {}) {
  if (typeof fd !== "number") throw new Error("makeDiskStore: fd (open file descriptor) required");
  if (!dir) throw new Error("makeDiskStore: dir (hex -> {fileOffset,len}) required");
  const cache = new Map();                                  // insertion order == LRU recency
  let used = 0;
  const stats = { reads: 0, hits: 0, verified: 0, refused: 0, evicted: 0, bytes: () => used, peak: 0 };
  return {
    stats, dir,
    has(hex) { return cache.has(hex) || hex in dir; },
    get(hex) {
      const hit = cache.get(hex);
      if (hit !== undefined) { stats.hits++; cache.delete(hex); cache.set(hex, hit); return hit; } // touch → MRU
      const loc = dir[hex];
      if (!loc) return undefined;                            // unknown κ → loadByKappa throws
      const buf = Buffer.allocUnsafe(loc.len);
      for (let got = 0; got < loc.len; ) {                   // readSync may return short — loop
        const n = readSync(fd, buf, got, loc.len - got, loc.fileOffset + got);
        if (n <= 0) throw new Error(`makeDiskStore: short read @${loc.fileOffset}+${got}/${loc.len}`);
        got += n;
      }
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset, loc.len);
      stats.reads++;
      if (verify) { stats.verified++; if (sha256hex(bytes) !== hex) { stats.refused++; throw new Error(`makeDiskStore: L5 refuse ${hex.slice(0, 12)}…`); } }
      cache.set(hex, bytes); used += loc.len;
      if (used > stats.peak) stats.peak = used;
      while (used > budgetBytes && cache.size > 1) {         // evict LRU until under budget
        const k = cache.keys().next().value;
        used -= cache.get(k).length; cache.delete(k); stats.evicted++;
      }
      return bytes;
    },
  };
}
