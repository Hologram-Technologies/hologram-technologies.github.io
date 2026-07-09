// kappa-resolve.mjs — THE unified κ tier-resolver: the whole substrate in one API.
//
// One κ (BLAKE3) is the same object at every tier. get(κ) serves from the hottest tier that has it,
// verifying BLAKE3 on every promotion (tamper→refuse), deduping concurrent gets, and evicting the hot
// tier by LRU under a byte budget. "Don't store the whole model" is a consequence: only the κ a caller
// asks for ever climbs; the rest stay as addresses.
//
//   hot  (RAM Map — the VRAM-residency proxy; in the engine this becomes the κ-keyed GPU buffer map)
//   warm (OPFS — persistent across reloads → warm reload fetches 0 network bytes)
//   cold (net — injected: HF range fetch by κ, or any source)
//
// verify(bytes) MUST return the κ string ("blake3:<hex>") — pass the WASM `kappa` from holospaces_web.js.

const HEX = (k) => String(k).replace(/^blake3:/, "").replace(/^did:holo:blake3:/, "");

async function opfsRoot(dirName) {
  if (!(navigator.storage && navigator.storage.getDirectory)) return null;
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle(dirName, { create: true });
}

export async function makeKappaResolver({ net, verify, budgetBytes = 256 * 1024 * 1024, dirName = "ksub", opfs = true } = {}) {
  if (typeof net !== "function") throw new Error("kappaResolve: net(κ)->bytes required");
  if (typeof verify !== "function") throw new Error("kappaResolve: verify(bytes)->κ required (WASM blake3 kappa)");

  const hot = new Map();                 // κ -> Uint8Array (insertion order = LRU order)
  const inflight = new Map();            // κ -> Promise (dedup)
  let hotBytes = 0;
  const dir = opfs ? await opfsRoot(dirName) : null;
  const stats = { hotHit: 0, warmHit: 0, netFetch: 0, verified: 0, refused: 0, evicted: 0, promoted: 0, bytesNet: 0 };

  const opfsRead = async (k) => {
    if (!dir) return null;
    try { const fh = await dir.getFileHandle(HEX(k)); const f = await fh.getFile(); return new Uint8Array(await f.arrayBuffer()); }
    catch { return null; }
  };
  const opfsWrite = async (k, bytes) => {
    if (!dir) return;
    try { const fh = await dir.getFileHandle(HEX(k), { create: true }); const w = await fh.createWritable(); await w.write(bytes); await w.close(); } catch {}
  };
  const opfsDelete = async (k) => { if (!dir) return; try { await dir.removeEntry(HEX(k)); } catch {} };

  const touch = (k) => { const b = hot.get(k); hot.delete(k); hot.set(k, b); };   // move to LRU-newest
  const evictToBudget = () => {
    while (hotBytes > budgetBytes && hot.size > 1) {
      const oldest = hot.keys().next().value;
      hotBytes -= hot.get(oldest).byteLength; hot.delete(oldest); stats.evicted++;
    }
  };
  const promoteHot = (k, bytes) => { hot.set(k, bytes); hotBytes += bytes.byteLength; stats.promoted++; evictToBudget(); };

  const verifyOrRefuse = (bytes, k) => {
    const got = verify(bytes); stats.verified++;
    if (got !== k) { stats.refused++; throw new Error(`kappaResolve: BLAKE REFUSE — bytes re-derive to ${got}, expected ${k}`); }
  };

  async function get(k) {
    if (hot.has(k)) { stats.hotHit++; touch(k); return hot.get(k); }
    if (inflight.has(k)) return inflight.get(k);
    const p = (async () => {
      // warm tier (OPFS)
      let bytes = await opfsRead(k);
      if (bytes) { try { verifyOrRefuse(bytes, k); stats.warmHit++; } catch { await opfsDelete(k); bytes = null; } }
      // cold tier (net)
      if (!bytes) {
        bytes = await net(k); stats.netFetch++;
        if (!bytes) throw new Error(`kappaResolve: κ not found in any tier — ${k}`);
        stats.bytesNet += bytes.byteLength;
        verifyOrRefuse(bytes, k);          // untrusted source → verify before trusting
        await opfsWrite(k, bytes);          // promote to warm (survives reload)
      }
      promoteHot(k, bytes);                 // promote to hot
      return bytes;
    })();
    inflight.set(k, p);
    try { return await p; } finally { inflight.delete(k); }
  }

  return {
    get,
    stats,
    has: (k) => hot.has(k),
    hotSize: () => hot.size,
    hotBytes: () => hotBytes,
    clearHot: () => { hot.clear(); hotBytes = 0; },                       // simulate VRAM flush (keeps OPFS warm)
    async clearWarm() { if (!dir) return; try { for await (const n of dir.keys()) await dir.removeEntry(n); } catch {} },
  };
}
