// holo-art-cache.mjs — every poster/backdrop/logo/still is a content-addressed κ-object.
//
// The same poster is identical bytes for everyone, so it should be fetched ONCE and re-served forever. This
// caches image bytes under their content hash (κ): a warm image paints in <1 frame from the resident set, a
// reload paints with zero network, and it works offline. Law L5 holds — stored bytes that don't re-derive to
// their κ are refused (a poisoned poster fails closed, never silently painted). Bytes are stored as base64 so
// the SAME store works in Node (Map, witnessable) and the browser (IndexedDB); `objectURL()` hands the UI a
// blob: URL with no re-encode round-trip on the hot path.
//
// TWO ROLES:  "u:<url>" → the κ for an image URL (so the same URL short-circuits to its κ)
//             "b:<κ>"   → the image bytes (base64), content-addressed + verifiable

async function sha256hex(bytes) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const b = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}
const b64 = {
  enc: (u8) => { if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64"); let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); },
  dec: (s) => { if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64")); const bin = atob(s); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; },
};

// createArtCache({ kv, fetch }) — kv: { get(k)->string|null (maybe async), set(k,v) }; fetch optional (else global).
export function createArtCache({ kv, fetch: f } = {}) {
  if (!kv || typeof kv.get !== "function" || typeof kv.set !== "function") throw new Error("holo-art-cache: kv required");
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  const stats = { puts: 0, hits: 0, misses: 0, refused: 0, dedup: 0 };

  async function put(url, bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const kappa = "sha256:" + (await sha256hex(u8));
    const had = await kv.get("b:" + kappa);
    if (had != null) stats.dedup++; else await kv.set("b:" + kappa, b64.enc(u8));   // identical bytes from any URL stored once
    await kv.set("u:" + url, kappa);
    stats.puts++;
    return kappa;
  }
  // bytesFor(κ) → Uint8Array | null, verify-before-trust (Law L5).
  async function bytesFor(kappa) {
    const s = await kv.get("b:" + kappa);
    if (s == null) return null;
    const u8 = b64.dec(s);
    if ("sha256:" + (await sha256hex(u8)) !== kappa) { stats.refused++; return null; }
    return u8;
  }
  async function get(url) {
    const kappa = await kv.get("u:" + url);
    if (!kappa) { stats.misses++; return null; }
    const bytes = await bytesFor(kappa);
    if (!bytes) { stats.misses++; return null; }
    stats.hits++;
    return { kappa, bytes };
  }
  // resolve(url) — the call the UI uses: a hit serves from κ (no network); a miss fetches the bytes, stores
  // them, returns. Throws only if the fetch itself fails on a cold miss (caller falls back to the direct URL).
  async function resolve(url) {
    const hit = await get(url);
    if (hit) return { ...hit, fromCache: true };
    if (!doFetch) throw new Error("no fetch");
    const res = await doFetch(url);
    if (!res.ok) throw new Error("img " + res.status);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const kappa = await put(url, bytes);
    return { kappa, bytes, fromCache: false };
  }
  return { put, get, bytesFor, resolve, stats: () => ({ ...stats }) };
}

// ── browser: persistent IndexedDB store + blob:URL minting ───────────────────────────────────────────────
function idbKV(dbName = "holo-art", storeName = "kv") {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open(dbName, 1); r.onupgradeneeded = () => { try { r.result.createObjectStore(storeName); } catch {} }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(storeName, mode); const s = t.objectStore(storeName); const rq = fn(s); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); };
  return { get: (k) => tx("readonly", (s) => s.get(k)).then((v) => (v == null ? null : v)).catch(() => null), set: (k, v) => tx("readwrite", (s) => s.put(v, k)).catch(() => {}) };
}
export function memKV() { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v); } }; }

// sniff an image MIME from magic bytes — a typeless Blob won't decode reliably as an <img> src.
function sniffImageType(b) {
  if (!b || b.length < 12) return "image/jpeg";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";   // RIFF…WEBP
  if (b[0] === 0x3c) return "image/svg+xml";   // '<'
  return "image/jpeg";
}

if (typeof window !== "undefined") {
  const objURLs = new Map();   // κ → blob: URL (minted once, reused)
  window.HoloArtCache = {
    createArtCache, memKV,
    _cache: null,
    live() { if (!this._cache) { try { this._cache = createArtCache({ kv: idbKV() }); } catch { this._cache = createArtCache({ kv: memKV() }); } } return this._cache; },
    // url → a blob: URL served from κ (warm), fetching+caching on a cold miss. Null if it can't be had.
    async url(imageUrl) {
      const c = this.live();
      let r; try { r = await c.resolve(imageUrl); } catch { return null; }
      if (objURLs.has(r.kappa)) return objURLs.get(r.kappa);
      const u = URL.createObjectURL(new Blob([r.bytes], { type: sniffImageType(r.bytes) }));
      objURLs.set(r.kappa, u);
      return u;
    },
  };
}

export default { createArtCache, memKV };
