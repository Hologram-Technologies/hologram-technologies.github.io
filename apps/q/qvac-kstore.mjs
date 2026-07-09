// Browser reader for the κ-store: reconstruct a model's .qvf bytes on demand from
// content-addressed blocks. Every block is fetched by its κ from the shared pack,
// VERIFIED by re-derivation (sha256(block) === κ), and cached GLOBALLY by κ — so
// loading a second related model reuses the first's shared blocks (no re-fetch,
// no re-verify). This is the UOR law in the hot path: hold κ, verify each byte.
//
// It exposes a `rr(off,len)` over the virtual .qvf, so the existing remote loader
// (header → tokenizer, singles, per-layer frames, MoE experts) works unchanged.

const G = (typeof window !== "undefined" ? window : globalThis);
G.__kcache = G.__kcache || new Map();          // κ → Uint8Array (shared across models/loads)
G.__kinflight = G.__kinflight || new Map();    // κ → Promise

const toHex = (buf) => { const b = new Uint8Array(buf); let s = ""; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0"); return s; };

// Build a κ-backed reader. `kman` = the model manifest {blockSize, blocks:[κ], qvf}.
// `index` = the store's {blocks:{κ:{off,size}}}. `packUrl` = served pack.bin.
export function makeKappaReader({ kman, index, packUrl, verify = true }) {
  const bs = kman.blockSize, blocks = kman.blocks, dir = index.blocks;
  const cache = G.__kcache, inflight = G.__kinflight;

  async function getBlock(bi) {
    const k = blocks[bi];
    const hit = cache.get(k); if (hit) return hit;
    const f = inflight.get(k); if (f) return f;
    const loc = dir[k];
    const p = (async () => {
      const r = await fetch(packUrl, { headers: { Range: `bytes=${loc.off}-${loc.off + loc.size - 1}` } });
      if (!r.ok && r.status !== 206) throw new Error("κ fetch " + k.slice(0, 12) + ": HTTP " + r.status);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (verify) { const h = toHex(await crypto.subtle.digest("SHA-256", buf)); if (h !== k) throw new Error("κ MISMATCH (corrupt block): " + k.slice(0, 12) + " ≠ " + h.slice(0, 12)); }
      cache.set(k, buf); inflight.delete(k); return buf;
    })();
    inflight.set(k, p); return p;
  }

  // read [off, off+len) across the virtual .qvf, assembled from κ-blocks
  return async function rr(off, len) {
    const out = new Uint8Array(len);
    let done = 0;
    let bi = Math.floor(off / bs), within = off % bs;
    while (done < len) {
      const blk = await getBlock(bi);
      const take = Math.min(blk.length - within, len - done);
      out.set(blk.subarray(within, within + take), done);
      done += take; bi++; within = 0;
    }
    return out;
  };
}

// stats helper for the UI: how much of this model is already cached (shared)
export function kappaCacheStats(kman) {
  let cached = 0; for (const k of kman.blocks) if (G.__kcache.has(k)) cached++;
  return { cached, total: kman.blocks.length, pct: kman.blocks.length ? +(100 * cached / kman.blocks.length).toFixed(1) : 0 };
}
