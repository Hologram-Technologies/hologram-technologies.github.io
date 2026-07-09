// Browser κ-DISK reader — the in-browser realization of holospaces' KappaDisk
// (crates/holospaces/src/disk.rs) for qvac. The model's weights live in the
// substrate as κ-addressed sectors (KappaStore = the served .qvf, addressed by
// sector κ). Every sector read is RE-DERIVED against its κ-label
// (sha256(bytes)===κ → verify-by-re-derivation, the substrate law) and kept in a
// content-keyed read-through cache (Law L3: RAM is a bounded cache of the
// canonical store). The model is one verified, teleportable `image_kappa`.
//
// Exposes rr(off,len) over the virtual disk image, so qvac's loader (header →
// tokenizer, singles, per-layer frames, MoE experts) reads through the substrate
// unchanged. The peer realizes the matmuls on its GPU.

const G = (typeof window !== "undefined" ? window : globalThis);
G.__kdcache = G.__kdcache || new Map();        // κ → Uint8Array (content-keyed, shared across loads/peers)
G.__kdinflight = G.__kdinflight || new Map();  // κ → Promise
let CACHE_SECTORS = 1024;                        // bound (KappaDisk CACHE_CAPACITY); LRU. ~1GB @1MB — kept small so kd-cache + engine expert-cache + embed stay under the renderer's ~4GB cap
if (typeof window !== "undefined" && window.__kdCacheSectors) CACHE_SECTORS = window.__kdCacheSectors;

// Bound concurrent source fetches — HTTP/1.0 opens a connection per request, so
// too many at once exhausts the browser's per-host pool ("Failed to fetch"). A
// small gate keeps us under it. (With keep-alive or multi-source this would widen.)
const GATE_MAX = 12;   // global concurrent fetches, spread across source origins
G.__kdgate = G.__kdgate || { active: 0, q: [] };
function acquire() { const g = G.__kdgate; if (g.active < GATE_MAX) { g.active++; return Promise.resolve(); } return new Promise((res) => g.q.push(res)).then(() => { g.active++; }); }
function release() { const g = G.__kdgate; g.active--; const n = g.q.shift(); if (n) n(); }

const hex = (buf) => { const b = new Uint8Array(buf); let s = ""; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0"); return s; };

// A MULTI-SOURCE κ-disk. `index` = the .kdisk.json; `sources` = data-file URLs
// (different origins: local disk, LAN peers, CDN). Because every sector is
// verified by re-derivation, sources are never trusted — a wrong/corrupt/missing
// byte stream is rejected and another source is tried. Sectors are round-robined
// across sources so multiple links carry the load in parallel (bandwidth
// aggregation) AND a wedged/slow source just fails over to the next (resilience).
export function makeKDisk({ index, sources, dataUrl, verify = true }) {
  const SS = index.sectorSize, sectors = index.sectors, fileSize = index.fileSize;
  const cache = G.__kdcache, inflight = G.__kdinflight;
  const SRC = (sources && sources.length) ? sources : [dataUrl];
  let fetched = 0, verified = 0, hits = 0;
  const perSource = SRC.map(() => 0);

  // ONE coalesced multi-source HTTP fetch of [absOff, absOff+length) — big base in
  // the URL (small Range header, dodging Chromium's large-offset hang), rotating
  // sources for aggregation, patient failover (κ-verified ⇒ retry is always safe).
  const evict = (k) => { while (cache.size >= CACHE_SECTORS && !cache.has(k)) { const o = cache.keys().next().value; cache.delete(o); } };
  let reqId = 0;                                   // per-request source rotation → spread load across origins (aggregation)
  async function fetchRange(absOff, length) {
    const base = reqId++;
    let bytes = null, lastErr;
    for (let attempt = 0; attempt < 20 && !bytes; attempt++) {
      const s = (base + attempt) % SRC.length;
      try {
        if (attempt) await new Promise((res) => setTimeout(res, Math.min(1500, 40 * Math.pow(1.6, attempt))));
        await acquire();
        try {
          const r = await fetch(SRC[s] + "?base=" + absOff, { headers: { Range: `bytes=0-${length - 1}` } });
          if (!r.ok && r.status !== 206) throw new Error("HTTP " + r.status);
          bytes = new Uint8Array(await r.arrayBuffer());
        } finally { release(); }
        if (bytes.length !== length) { lastErr = new Error("short read"); bytes = null; continue; }
        perSource[s]++;
      } catch (e) { lastErr = e; }
    }
    if (!bytes) throw new Error(`κ-disk range ${absOff}+${length} unresolvable across ${SRC.length} sources: ${lastErr}`);
    fetched++;
    return bytes;
  }

  return {
    imageKappa: index.imageKappa,
    qvf: index.qvf,
    sources: SRC,
    stats: () => ({ fetched, verified, hits, cached: cache.size, perSource, sources: SRC.length, distinctSectors: index.distinctSectors, sectorCount: index.sectorCount }),
    // read [off, off+len): assemble from the content cache where possible; for the
    // uncached part, ONE coalesced fetch covering the whole range, then verify +
    // cache each FULL sector it spans (still content-addressed: each κ re-derived).
    rr: async (off, len) => {
      const out = new Uint8Array(len);
      const f0 = Math.floor(off / SS), f1 = Math.floor((off + len - 1) / SS);
      let allCached = true;
      for (let si = f0; si <= f1; si++) if (!cache.has(sectors[si])) { allCached = false; break; }
      if (allCached) {                                   // 0 fetches — pure cache hit
        let done = 0, si = f0, within = off - si * SS;
        while (done < len) { const sec = cache.get(sectors[si]); cache.delete(sectors[si]); cache.set(sectors[si], sec); const take = Math.min(sec.length - within, len - done); out.set(sec.subarray(within, within + take), done); done += take; si++; within = 0; }
        hits++; return out;
      }
      const raw = await fetchRange(off, len);             // 1 HTTP fetch for the whole range
      out.set(raw, 0);
      for (let si = f0; si <= f1; si++) {                 // verify + cache the FULL sectors covered
        const sStart = si * SS, sEnd = Math.min(sStart + SS, fileSize);
        if (sStart >= off && sEnd <= off + len && !cache.has(sectors[si])) {
          const sub = raw.subarray(sStart - off, sEnd - off);
          if (verify) { const got = index.axis + ":" + hex(await crypto.subtle.digest("SHA-256", sub)); if (got !== sectors[si]) throw new Error(`κ MISMATCH sector ${si}`); verified++; }
          evict(sectors[si]); cache.set(sectors[si], new Uint8Array(sub));
        }
      }
      return out;
    },
    // verify the disk INDEX itself re-derives to image_kappa (KappaDisk::image_kappa)
    verifyImage: async () => {
      const enc = new TextEncoder().encode(index.imageIri || "https://uor.foundation/holospaces/realization/kappa-disk");
      const parts = [enc, new Uint8Array([0])];
      for (const k of sectors) { const h = k.split(":")[1]; const b = new Uint8Array(h.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); parts.push(b); }
      let total = 0; for (const p of parts) total += p.length; const all = new Uint8Array(total); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
      const got = index.axis + ":" + hex(await crypto.subtle.digest("SHA-256", all));
      return { ok: got === index.imageKappa, got, expected: index.imageKappa };
    },
  };
}
