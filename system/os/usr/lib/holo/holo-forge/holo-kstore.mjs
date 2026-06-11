// holo-kstore.mjs — the persistent content-addressed store (the κ-store) over IndexedDB: put / get /
// has objects BY THEIR κ, on every browser (IndexedDB is universal — desktop + mobile). It realizes
// two substrate laws at once: Law L3 (storage is a cache of the address space; an object present
// locally is never refetched) and the hologram O(1) content-addressed dispatch — "re-executing
// identical inputs rebinds rather than recomputes." A value keyed by its κ is one lookup, not work.
// Reads re-derive on demand (Law L5): a tampered local byte does not match its κ and is refused.
//
// Shared by the page AND the Service Worker (same DB name, same origin) so a build cached by the
// page is served offline by the worker, and an asset sealed by the worker is an O(1) hit for the page.

const DB = "holo-kstore", STORE = "kappa";
const hexOf = (k) => String(k).split(":").pop();
let _db = null;
function db() {
  return _db || (_db = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function withStore(mode, fn) { const d = await db(); const t = d.transaction(STORE, mode); const out = await fn(t.objectStore(STORE)); return out; }

export async function kput(kappa, bytes) { const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); await withStore("readwrite", (s) => reqP(s.put(u, hexOf(kappa)))); return kappa; }
export async function kget(kappa) { return withStore("readonly", (s) => reqP(s.get(hexOf(kappa)))); }   // Uint8Array | undefined
export async function khas(kappa) { const k = await withStore("readonly", (s) => reqP(s.getKey(hexOf(kappa)))); return k !== undefined; }
export async function kcount() { return withStore("readonly", (s) => reqP(s.count())); }

export async function sha256hex(bytes) { const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const d = await crypto.subtle.digest("SHA-256", u); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
export const kappaOf = async (bytes) => "did:holo:sha256:" + await sha256hex(bytes);

// kverify(kappa) → bytes | null : get from the store and RE-DERIVE (Law L5). A local byte that does
// not hash to its own address is refused — the store cannot be silently poisoned.
export async function kverify(kappa) { const b = await kget(kappa); if (!b) return null; return (await sha256hex(b)) === hexOf(kappa) ? b : null; }
