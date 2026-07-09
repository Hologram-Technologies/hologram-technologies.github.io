// holo-media-cache.mjs — every metadata response is a content-addressed κ-object.
//
// This is the "very, very fast" + "100% κ-addressable substrate-native" answer for discovery. A TMDb
// response (a trending page, a title, a season, a poster manifest) is fetched ONCE, sealed under its own
// content hash (κ), and read back O(1) — across reloads (IndexedDB) and, by export, across devices. Cold =
// network; warm = memory-speed from the resident κ-set; offline = still works. Law L5 holds: a cached
// entry only returns bytes that RE-DERIVE to the requested κ — a tampered entry fails verification and is
// refused, never silently trusted (the same discipline as holo-q-vision-store, kept self-contained here so
// the module is app-local + Node-witnessable with zero cross-tree imports).
//
// ONE KV, TWO ROLES:  "obj:<κ>"  → the sealed response (immutable, content-addressed, verifiable)
//                     "req:<key>" → the κ for a request key (so the same request short-circuits to the κ)

// Stable (canonical) serialization so the hash is deterministic regardless of key order.
function jcs(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
}

// sha-256 hex — SubtleCrypto in the browser, node:crypto in Node. Both deterministic; this IS the κ.
async function sha256hex(s) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(s).digest("hex");
}

export async function address(body) { return "sha256:" + (await sha256hex(jcs(body))); }
export async function seal(body) { return { id: await address(body), body }; }
export async function verify(obj) { return !!obj && typeof obj.id === "string" && obj.id === (await address(obj.body)); }

// createMediaCache({ kv }) — kv: { get(key)->string|null (maybe async), set(key,val) }.
export function createMediaCache({ kv } = {}) {
  if (!kv || typeof kv.get !== "function" || typeof kv.set !== "function") throw new Error("holo-media-cache: kv required");
  const stats = { puts: 0, hits: 0, misses: 0, refused: 0 };

  async function put(key, body) {
    const sealed = await seal(body);
    await kv.set("obj:" + sealed.id, jcs(sealed));
    await kv.set("req:" + key, sealed.id);
    stats.puts++;
    return sealed.id;
  }
  // resolve(κ) → body | null, verify-before-trust (Law L5).
  async function resolveKappa(kappa) {
    const s = await kv.get("obj:" + kappa);
    if (s == null) return null;
    let obj; try { obj = JSON.parse(s); } catch { return null; }
    if (!obj || obj.id !== kappa || !(await verify(obj))) { stats.refused++; return null; }
    return obj.body;
  }
  // get(key) → { kappa, body } | null. The O(1) "fetched this request before?" lookup (survives reloads).
  async function get(key) {
    const kappa = await kv.get("req:" + key);
    if (!kappa) { stats.misses++; return null; }
    const body = await resolveKappa(kappa);
    if (body == null) { stats.misses++; return null; }
    stats.hits++;
    return { kappa, body };
  }
  // through(key, fetcher) — the one call sites use: a hit serves from κ (no fetcher run); a miss runs the
  // fetcher, seals + stores, and returns. Offline + rate-limited paths fall through to the cached κ.
  async function through(key, fetcher) {
    const hit = await get(key);
    if (hit) return { ...hit, fromCache: true };
    const body = await fetcher();
    const kappa = await put(key, body);
    return { kappa, body, fromCache: false };
  }
  return { get, put, resolveKappa, through, stats: () => ({ ...stats }) };
}

// ── persistent IndexedDB KV (browser only; no dependency) — same shape as holo-q-vision-store's idbKV ──────
function idbKV(dbName = "holo-media", storeName = "kv") {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => { try { r.result.createObjectStore(storeName); } catch {} };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(storeName, mode); const s = t.objectStore(storeName); const rq = fn(s); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); };
  return {
    get: (k) => tx("readonly", (s) => s.get(k)).then((v) => (v == null ? null : v)).catch(() => null),
    set: (k, v) => tx("readwrite", (s) => s.put(v, k)).catch(() => {}),
  };
}
// in-memory fallback (Node default / private-mode browser) — session-scoped, still κ-correct.
export function memKV() { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v); } }; }

if (typeof window !== "undefined") {
  window.HoloMediaCache = {
    createMediaCache, memKV,
    live() { try { return createMediaCache({ kv: idbKV() }); } catch { return createMediaCache({ kv: memKV() }); } },
  };
}

export default { createMediaCache, memKV, seal, verify, address };
