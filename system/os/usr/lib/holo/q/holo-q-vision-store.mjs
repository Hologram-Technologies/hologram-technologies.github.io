// holo-q-vision-store.mjs — PERCEPTION AS SUBSTRATE: every perceived κ lives in a persistent,
// content-addressed store, so re-seeing anything ever is an O(1) read — no model, no network, persistent
// across reloads (and, via export, across devices). This is what makes ambient perception "very, very
// low latency" and "100% κ-addressable substrate native": the perceived object is NOT a bespoke cache
// entry, it is a first-class content-addressed κ-object keyed by its own κ. resolve() re-derives and
// VERIFIES it (Law L5) — a tampered entry fails verification and is refused, never silently trusted.
//
// ONE KV, TWO ROLES:  "obj:<κ>" → the sealed perception object (immutable, content-addressed, verifiable)
//                     "cap:<captureHash>" → the κ (so identical PIXELS short-circuit to the κ, no OCR).
// The KV is injected (a Map in Node, IndexedDB in the browser) so the whole thing is Node-witnessable.
// Seal/verify/address come from holo-object, so a perceived κ is the SAME κ-space as pluck/holospaces.

import { seal, verify, address } from "../holo-object.mjs";

function _jcs(v) {                                                    // stable serialization for storage (re-parsed + re-verified on read)
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(_jcs).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + _jcs(v[k])).join(",") + "}";
}

// createPerceptionCache({ kv }) — kv: { get(key) → string|null (maybe async), set(key, val) }.
export function createPerceptionCache({ kv } = {}) {
  if (!kv || typeof kv.get !== "function" || typeof kv.set !== "function") throw new Error("holo-q-vision-store: kv required");
  const stats = { puts: 0, hits: 0, misses: 0, refused: 0 };

  // put(captureHash, object) → κ. Stores the sealed object under its own κ and maps the pixels to it.
  async function put(captureHash, object) {
    const sealed = object && object.id ? object : seal(object);
    await kv.set("obj:" + sealed.id, _jcs(sealed));
    await kv.set("cap:" + captureHash, sealed.id);
    stats.puts++;
    return sealed.id;
  }

  // resolve(κ) → object | null. Reads + VERIFIES (Law L5): bytes that do not re-derive to κ are refused.
  async function resolve(kappa) {
    const s = await kv.get("obj:" + kappa);
    if (s == null) return null;
    let obj; try { obj = JSON.parse(s); } catch { return null; }
    if (!obj || obj.id !== kappa || !verify(obj) || address(obj) !== kappa) { stats.refused++; return null; }   // verify-before-trust
    return obj;
  }

  // get(captureHash) → { kappa, object } | null. The O(1) "seen these exact pixels before?" lookup that
  // lets ambient perception skip OCR entirely and survive reloads. A hit that fails to verify is a miss.
  async function get(captureHash) {
    const kappa = await kv.get("cap:" + captureHash);
    if (!kappa) { stats.misses++; return null; }
    const object = await resolve(kappa);
    if (!object) { stats.misses++; return null; }
    stats.hits++;
    return { kappa, object };
  }

  return { get, put, resolve, stats: () => ({ ...stats }) };
}

// ── a minimal persistent IndexedDB KV (browser only; no dependency) ──────────────────────────────────────
function idbKV(dbName = "holo-vision", storeName = "kv") {
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

// browser binding: build the real persistent cache (IndexedDB) and expose it. Fail-soft — if IndexedDB
// is unavailable the ambient layer simply runs without persistence (in-memory memo for this session).
if (typeof window !== "undefined") {
  window.HoloPerceptionCache = {
    createPerceptionCache,
    async live() { try { return createPerceptionCache({ kv: idbKV() }); } catch { return null; } },
  };
}

export default { createPerceptionCache };
