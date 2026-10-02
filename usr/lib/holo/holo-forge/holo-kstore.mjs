// holo-kstore.mjs — the persistent content-addressed store (the κ-store) over IndexedDB: put / get /
// has objects BY THEIR κ, on every browser (IndexedDB is universal — desktop + mobile). It realizes
// two substrate laws at once: Law L3 (storage is a cache of the address space; an object present
// locally is never refetched) and the hologram O(1) content-addressed dispatch — "re-executing
// identical inputs rebinds rather than recomputes." A value keyed by its κ is one lookup, not work.
// Reads re-derive on demand (Law L5): a tampered local byte does not match its κ and is refused.
//
// Shared by the page AND the Service Worker (same DB name, same origin) so a build cached by the
// page is served offline by the worker, and an asset sealed by the worker is an O(1) hit for the page.

import { blake3hex } from "../holo-blake3.mjs";

const DB = "holo-kstore", STORE = "kappa";
const hexOf = (k) => String(k).split(":").pop();
let _db = null;
// SELF-HEALING open: an IndexedDB open that never settles (queued behind a blocked upgrade/delete,
// storage-backend stall at SW start) used to wedge this memo — and with it EVERY κ-store read in this
// context — for the worker's whole life. Bound the open, reset the memo on failure (the next call
// retries), close+reset on versionchange so an upgrade/delete can never deadlock the origin.
// Callers already fail soft to the network rungs.
function db() {
  return _db || (_db = new Promise((res, rej) => {
    let dead = false;
    const bail = setTimeout(() => { dead = true; _db = null; rej(new Error("kstore open timed out")); }, 4000);
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => { if (dead) { try { r.result.close(); } catch {} return; } clearTimeout(bail); const d = r.result; d.onversionchange = () => { try { d.close(); } catch {} _db = null; }; res(d); };
    r.onerror = () => { clearTimeout(bail); _db = null; rej(r.error); };
  }));
}
function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function withStore(mode, fn) {
  let d = await db(), t = null;
  try { t = d.transaction(STORE, mode); }
  catch { _db = null; d = await db(); t = d.transaction(STORE, mode); }   // a closed/idle-reaped connection self-heals with ONE reopen
  const out = await fn(t.objectStore(STORE)); return out;
}

export async function kput(kappa, bytes) { const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); await withStore("readwrite", (s) => reqP(s.put(u, hexOf(kappa)))); return kappa; }
export async function kget(kappa) { return withStore("readonly", (s) => reqP(s.get(hexOf(kappa)))); }   // Uint8Array | undefined
export async function khas(kappa) { const k = await withStore("readonly", (s) => reqP(s.getKey(hexOf(kappa)))); return k !== undefined; }
export async function kdel(kappa) { await withStore("readwrite", (s) => reqP(s.delete(hexOf(kappa)))); }   // O2: tamper purge — the store never STAYS poisoned
export async function kcount() { return withStore("readonly", (s) => reqP(s.count())); }

// §1.2: the canonical content hash is BLAKE3. κ MINT goes through blake3hex (sync).
export const khex = (bytes) => { const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); return blake3hex(u); };
export const kappaOf = async (bytes) => "did:holo:blake3:" + khex(bytes);
// legacy dual-read: the pre-§1.2 sha256 reader, kept so EXISTING sha256-addressed content still opens.
export async function sha256hex(bytes) { const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const d = await crypto.subtle.digest("SHA-256", u); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

// kverify(kappa) → bytes | null : get from the store and RE-DERIVE (Law L5). A local byte that does
// not hash to its own address is refused — the store cannot be silently poisoned.
export async function kverify(kappa) { const b = await kget(kappa); if (!b) return null; const h = hexOf(kappa); return (khex(b) === h || (await sha256hex(b)) === h) ? b : null; } // legacy dual-read
