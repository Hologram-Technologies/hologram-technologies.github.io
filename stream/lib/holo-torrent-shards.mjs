// holo-torrent-shards.mjs — L3 of HOLO-TORRENT-TV: the origin index IS κ-objects (instant · offline).
//
// The library's "does this title stream instantly?" answer must itself be instant, offline, and sealed —
// never a live query. So the origin index ships as κ-SHARDS, exactly like the Holo TV library (16 shards,
// pivots < 25 ms): bucketed by content-κ, each shard minted as a κ (kappo of its bytes). A client loads a
// tiny manifest, then loads ONLY the one shard a title falls in — verified-on-read against its κ (L5) —
// and caches it (0-net, offline thereafter). The shard bytes are ordinary κ-objects, so they resolve
// through the SAME rung ladder (holo-rungs) as everything else. Availability becomes a local lookup.
//
// Pure + node/SW/DOM safe. loadShard INJECTED (the rung ladder / κ-store in the OS; a map in the witness).

import { kappo, kappoVerify } from "../_shared/holo-kappa.mjs";

// shardKeyOf(κ, shards) → which shard a content-κ falls in. 16 shards = first hex nibble of the κ tail
// (matches holo-tv-library's 16-shard fan-out); otherwise a modulo over the leading hex.
export function shardKeyOf(kappa, shards = 16) {
  const tail = String(kappa).split(":").pop();
  return shards === 16 ? tail[0] : String(parseInt(tail.slice(0, 8), 16) % shards);
}

// buildShards(index, { shards }) → { manifest: {shardKey→shardκ}, blobs: {shardκ→bytes}, shards }.
// Deterministic: same index → same shard κs (canonical JSON, sorted keys). Ready to pin to the mirror.
export function buildShards(index, { shards = 16 } = {}) {
  const buckets = {};
  for (const [kappa, origins] of index.entries()) {
    const k = shardKeyOf(kappa, shards);
    (buckets[k] || (buckets[k] = {}))[kappa] = origins;
  }
  const manifest = {}, blobs = {};
  for (const k of Object.keys(buckets).sort()) {
    const obj = buckets[k];
    const sorted = {}; for (const kk of Object.keys(obj).sort()) sorted[kk] = obj[kk];   // canonical → stable κ
    const bytes = new TextEncoder().encode(JSON.stringify(sorted));
    const skappa = kappo(bytes);
    manifest[k] = skappa; blobs[skappa] = bytes;
  }
  return { manifest, blobs, shards };
}

// makeShardedIndex({ manifest, loadShard, shards }) → an index reader that resolves a title's origins by
// loading only its shard, verified-on-read, then caching it. loadShard(shardκ) → bytes (the rung ladder).
export function makeShardedIndex({ manifest, loadShard, shards = 16 }) {
  const cache = new Map();                                        // shardκ → parsed { κ: origins }
  let loads = 0;
  async function shardFor(kappa) {
    const skappa = manifest[shardKeyOf(kappa, shards)];
    if (!skappa) return {};                                       // no shard for this bucket → unknown title
    if (cache.has(skappa)) return cache.get(skappa);             // offline after first load
    const bytes = await loadShard(skappa); loads++;
    if (!kappoVerify(bytes, skappa)) throw new Error("shard κ mismatch — refused (L5): " + String(skappa).slice(0, 22) + "…");
    const obj = JSON.parse(new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
    cache.set(skappa, obj); return obj;
  }
  return {
    async originsOf(kappa) { return (await shardFor(kappa))[kappa] || []; },
    async has(kappa) { return !!(await shardFor(kappa))[kappa]; },
    cachedShards: () => cache.size,
    shardLoads: () => loads,
  };
}

export default { shardKeyOf, buildShards, makeShardedIndex };
