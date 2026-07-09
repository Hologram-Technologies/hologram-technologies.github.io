// holo-kappa-store.mjs — the persistent, content-addressed body store for κ-streamed models.
//
// One OPFS directory ("holo-kappa") keyed by κ (sha256 hex). A body fetched once is kept forever,
// L5-verified on every read, shared across EVERY model (a κ-block common to two models is stored
// once — real cross-model dedup). Second load is 0-network and offline; identity is the hash, so
// the cache never invalidates. This is the same layer holo-whisper-stream rides, lifted to a seam
// so the LLM κ-stream and Whisper share one persistent store.
//
// Node-safe: no browser API is touched at import time. The default backend (OPFS + WebCrypto) is
// only invoked in a browser; tests inject a mock backend + sha256 so the logic is witnessed in Node.

const hexOf = (b) => { let s = ""; for (const x of b) s += x.toString(16).padStart(2, "0"); return s; };

// ── default browser backend: OPFS dir keyed by κ (identical shape to holo-whisper-stream) ──
async function opfsGet(dir, key) { try { const r = await navigator.storage.getDirectory(); const d = await r.getDirectoryHandle(dir, { create: true }); const fh = await d.getFileHandle(key); return new Uint8Array(await (await fh.getFile()).arrayBuffer()); } catch { return null; } }
async function opfsPut(dir, key, bytes) { try { const r = await navigator.storage.getDirectory(); const d = await r.getDirectoryHandle(dir, { create: true }); const fh = await d.getFileHandle(key, { create: true }); const w = await fh.createWritable(); await w.write(bytes); await w.close(); return true; } catch { return false; } }
async function opfsClear(dir) { try { const r = await navigator.storage.getDirectory(); await r.removeEntry(dir, { recursive: true }); return true; } catch { return false; } }
const browserBackend = (dir) => ({ get: (k) => opfsGet(dir, k), put: (k, b) => opfsPut(dir, k, b), clear: () => opfsClear(dir) });

const webcryptoSha256 = async (buf) => hexOf(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)));

// makeKappaStore — a verify-once persistent store over a backend.
//   get(hex, fetchMiss): OPFS-hit (L5) → return 0-network; else fetchMiss() (which must itself L5-verify
//   the transport body), persist it, return. A persisted body that no longer re-derives is REFUSED and
//   re-fetched (tamper/bit-rot safe). stats expose the warm/cold proof: opfsHits vs misses/bytesFetched.
export function makeKappaStore({ dir = "holo-kappa", backend, sha256 = webcryptoSha256, useOpfs = true } = {}) {
  const be = backend || browserBackend(dir);
  const stats = { opfsHits: 0, opfsWrites: 0, misses: 0, bytesFetched: 0, verifies: 0, refuses: 0, headHits: 0, headRefuses: 0, headWrites: 0 };
  const enc = new TextEncoder(), dec = new TextDecoder();
  return {
    stats,
    clear: () => (be.clear ? be.clear() : Promise.resolve(false)),
    hash: (bytes) => sha256(bytes),                       // content κ of a blob (hex)
    async get(hex, fetchMiss) {
      if (useOpfs) {
        const c = await be.get(hex);
        if (c) { stats.verifies++; if ((await sha256(c)) === hex) { stats.opfsHits++; return c; } stats.refuses++; }  // L5 on cached body
      }
      const b = await fetchMiss();                       // transport read (Range/IPFS) — fetchMiss L5-verifies
      stats.misses++; stats.bytesFetched += b.length;
      if (useOpfs) { try { if (await be.put(hex, b)) stats.opfsWrites++; } catch {} }
      return b;
    },
    // peek a content-addressed blob already in the store (no transport): L5-verify, else null. For the
    // head-region blob — a cached head that no longer re-derives is REFUSED (returns null → re-fetch).
    async peek(hex) {
      if (!useOpfs) return null;
      const c = await be.get(hex); if (!c) return null;
      if ((await sha256(c)) === hex) { stats.headHits++; return c; } stats.headRefuses++; return null;
    },
    async putBody(hex, bytes) { if (!useOpfs) return false; try { if (await be.put(hex, bytes)) { stats.headWrites++; return true; } } catch {} return false; },
    // small NON-identity local hints (e.g. url→headκ accelerator). Trust still flows through κ: a wrong
    // hint yields a headκ whose peek() misses or refuses → re-fetch. Never a source of unverified bytes.
    async getHint(key) { if (!useOpfs) return null; const c = await be.get("m_" + key); return c ? dec.decode(c) : null; },
    async putHint(key, val) { if (!useOpfs) return false; try { return await be.put("m_" + key, enc.encode(val)); } catch { return false; } },
  };
}

export { opfsGet, opfsPut, opfsClear };
