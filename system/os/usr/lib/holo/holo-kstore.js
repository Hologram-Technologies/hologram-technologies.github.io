// holo-kstore.js — the in-browser content-addressed κ-store: "the store IS the memory" (Law L3).
// Resolve any object BY ITS κ, caching UPWARD so the 2nd-and-later access is warm:
//   1 · ARENA   — one CONTIGUOUS byte buffer + a κ→{off,len} index; resolveSync() returns a ZERO-COPY
//                 view. Synchronous + contiguous + small ⇒ the CPU keeps the hot working set in L1/L2
//                 *by itself* (you cannot address L1/L2 from a browser — you earn residency with locality).
//   2 · OPFS    — sub-ms; survives reload, the persistent κ-disk.
//   3 · κ-route /.holo/<axis>/<hex> over HTTP — cold, VERIFIED by re-derivation (Law L5; wrong κ refused,
//                 the origin demoted to one untrusted CDN).
// Each object's ATLAS96 coordinate is its content-derived PLACEMENT (computed, not looked up).
//
//   import { resolveSync, resolve, warm, rebind, coordinate, kstats } from "/_shared/holo-kstore.js";

let ARENA = new Uint8Array(1 << 20);                     // the contiguous resident buffer (grows ×2 on demand)
let USED = 0;
const VIEW = new Map();                                  // κ-hex → { off, len } into ARENA
const stats = { sync: 0, opfs: 0, http: 0, verified: 0, refused: 0, bytes: 0 };
const hexOf = (k) => String(k).split(":").pop().toLowerCase();
const axisOf = (k) => /blake3/.test(String(k)) ? "blake3" : "sha256";

function intern(hex, bytes) {                            // append bytes contiguously; return the view
  let v = VIEW.get(hex); if (v) return ARENA.subarray(v.off, v.off + v.len);
  if (USED + bytes.length > ARENA.length) {
    let cap = ARENA.length; while (USED + bytes.length > cap) cap <<= 1;
    const grown = new Uint8Array(cap); grown.set(ARENA.subarray(0, USED)); ARENA = grown;   // one copy, amortized O(1)
  }
  ARENA.set(bytes, USED); v = { off: USED, len: bytes.length }; VIEW.set(hex, v); USED += bytes.length;
  return ARENA.subarray(v.off, v.off + v.len);
}

// resolveSync(κ) — the HOT PATH: a synchronous, zero-copy view of resident bytes, or null if not resident.
// One Map.get + one subarray; the bytes live contiguously, so a hot loop stays in L1/L2. (μs→ns.)
export function resolveSync(k) {
  const hex = (typeof k === "string" && k.length === 64) ? k : hexOf(k);   // fast-path: caller passes the bare 64-hex (no substring alloc / re-hash)
  const v = VIEW.get(hex); if (!v) return null;
  stats.sync++; return ARENA.subarray(v.off, v.off + v.len);
}

let _dir;
async function dir() {
  if (_dir !== undefined) return _dir;
  try { _dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("kstore", { create: true }); } catch { _dir = null; }
  return _dir;
}
async function rederives(bytes, k) {
  const want = hexOf(k);
  if (axisOf(k) === "blake3") { const { blake3hex } = await import("./holo-blake3.mjs"); return blake3hex(bytes) === want; }
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("") === want;
}

// resolve(κ) — verified bytes through ARENA → OPFS → κ-route, interning into the arena (warm thereafter).
export async function resolve(k, { verify = true } = {}) {
  const hex = hexOf(k);
  const hit = resolveSync(k); if (hit) return hit;                                 // tier 1 · arena (sync, zero-copy)
  const d = await dir();
  if (d) { try { const fh = await d.getFileHandle(hex); const buf = new Uint8Array(await (await fh.getFile()).arrayBuffer());
    stats.opfs++; return intern(hex, buf); } catch {} }                            // tier 2 · OPFS (sub-ms, persistent)
  const r = await fetch(`/.holo/${axisOf(k)}/${hex}`, { cache: "force-cache" });   // tier 3 · κ-route over HTTP (cold)
  if (!r.ok) throw new Error("κ not resolvable: " + hex);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (verify && !(await rederives(buf, k))) { stats.refused++; throw new Error("holo-kstore: κ MISMATCH — refused (Law L5): " + hex); }
  stats.verified += verify ? 1 : 0; stats.http++; stats.bytes += buf.length;
  if (d) { try { const fh = await d.getFileHandle(hex, { create: true }); const w = await fh.createWritable(); await w.write(buf); await w.close(); } catch {} }
  return intern(hex, buf);
}

export const warm = (ks) => Promise.all(ks.map((k) => resolve(k).catch(() => null)));
export async function rebind(lock) {
  const before = { ...stats };
  const ks = Object.values(lock.closure || {}).map((e) => e.kappa).filter(Boolean);
  await warm(ks);
  return { coordinate: lock.root ? await coordinate(lock.root) : null, objects: ks.length, fromArena: stats.sync - before.sync, fromHttp: stats.http - before.http };
}
export async function coordinate(k) { const { atlasCoord } = await import("./holo-atlas-coord.mjs"); return atlasCoord(k); }
export const kstats = () => ({ ...stats, resident: VIEW.size, arenaBytes: USED });
export const has = (k) => VIEW.has(hexOf(k));
