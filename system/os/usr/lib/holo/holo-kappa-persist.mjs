// holo-kappa-persist.mjs — HOLO-KAPPA-RENDER-SUBSTRATE phase 3: a returning user opens their timeline INSTANTLY —
// no reload, no re-fetch, no re-render of what they already have.
//
// Every message is an immutable, content-addressed (κ) object, so it only ever has to be stored ONCE. Persistence is
// therefore two durable things: (a) the append-only LOG of κ (the ordered spine — light: just addresses), and
// (b) a content-addressed BODY store κ→bytes (immutable; a κ seen before is never re-written). On return:
//   • open() loads only the LOG → O(N) light addresses, ZERO body reads, ZERO hashing. The timeline "is there" instantly.
//   • a viewport reads ONLY the visible bodies from the store (O(visible)), each L5-verified on load (a corrupted or
//     tampered stored body is REFUSED, not drawn). Composes with phase 1: 1M persisted messages open instantly and
//     read ~50 bodies for the first frame.
//   • incremental sync: setHead(seq/ts) records the last-seen message so on return you fetch ONLY what is newer than
//     the head — never the whole history again.
// The store is injected (OPFS in the browser, fs in Node, a Map in a witness), so this is isomorphic + testable.
// Relates: [[holo-kappa-render-substrate]] · [[holo-boot-once-per-planet]] · [[holo-messenger-local-first-inbox]].

import { blake3hex } from "./holo-blake3.mjs";

const enc = (s) => (s instanceof Uint8Array ? s : new TextEncoder().encode(s));

function canon(m) {
  if (m && typeof m === "object" && !Array.isArray(m)) {
    const keys = Object.keys(m).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon(m[k])).join(",") + "}";
  }
  return JSON.stringify(m);
}

// persistence adapter contract (all async; a κ-body is immutable so putBody is idempotent):
//   loadLog() -> [κ…]        appendLog(κ)        has(κ) -> bool
//   putBody(κ, bytes)        getBody(κ) -> bytes|null
//   head() -> {seq,ts}|null  setHead(h)
export function makePersistentTimeline({ sha256hex, renderRow, memoCap = 512, persistence } = {}) {
  if (typeof renderRow !== "function" || !persistence) throw new Error("holo-kappa-persist: inject renderRow + persistence");
  const spine = [];               // κ[] — the append-only log (loaded from disk on open; light)
  const memo = new Map();         // κ -> tile, O(1) LRU
  let reads = 0, verifies = 0, renders = 0, puts = 0;

  // persistence owns content-addressing here (κ = sha256(canon)); in production the message's SIGNED source-chain κ +
  // its signed bytes are stored, and this L5 checks against that. Self-consistent either way: hash(stored)==κ.
  const kappaOf = (m) => "did:holo:blake3:" + blake3hex(enc(canon(m)));
  // legacy dual-read: an existing store may hold sha256-addressed bodies; accept EITHER axis on verify.
  const matches = (bytes, k) => ("did:holo:blake3:" + blake3hex(enc(bytes))) === k || (typeof sha256hex === "function" && ("did:holo:sha256:" + sha256hex(bytes)) === k); // legacy dual-read

  function _memoGet(k) { const t = memo.get(k); if (t !== undefined) { memo.delete(k); memo.set(k, t); } return t; }
  function _memoPut(k, tile) { memo.set(k, tile); if (memo.size > memoCap) { const lru = memo.keys().next().value; if (lru !== k) memo.delete(lru); } }

  // open() — the RETURNING-USER path: load only the ordered κ-log. No body reads, no hashing → instant regardless of N.
  async function open() { const log = (await persistence.loadLog()) || []; for (const k of log) spine.push(k); return { n: spine.length }; }

  // append(m) — store the body ONCE (content-addressed; skip if the κ already exists), append the κ to the durable log.
  async function append(m) {
    const bytes = canon(m), k = "did:holo:blake3:" + blake3hex(enc(bytes)), seq = spine.length;
    if (!(await persistence.has(k))) { await persistence.putBody(k, bytes); puts++; }   // immutable: written at most once
    await persistence.appendLog(k); spine.push(k);
    return { seq, kappa: k };
  }
  async function appendMany(ms) { const out = []; for (const m of ms) out.push(await append(m)); return out; }

  // tileAt(i) — memo hit O(1); miss → read ONE body from the store + L5 (re-derive; refuse a tamper) + render + cache.
  async function tileAt(i) {
    const k = spine[i];
    const hit = _memoGet(k); if (hit !== undefined) return hit;
    const bytes = await persistence.getBody(k); reads++;
    if (bytes == null) throw new Error("holo-kappa-persist: κ missing in store " + k);
    verifies++;
    if (!matches(bytes, k)) throw new Error("holo-kappa-persist: κ L5 REFUSE " + k + " (tamper)"); // legacy dual-read
    const tile = renderRow(JSON.parse(bytes), i); renders++;
    _memoPut(k, tile); return tile;
  }
  async function viewport(start, end) { start = Math.max(0, start | 0); end = Math.min(spine.length, Math.max(start, end | 0)); const out = new Array(end - start); for (let i = start; i < end; i++) out[i - start] = await tileAt(i); return out; }

  const head = () => persistence.head();
  const setHead = (h) => persistence.setHead(h);
  const stats = () => ({ n: spine.length, memoSize: memo.size, reads, verifies, renders, puts });
  const resetCounters = () => { reads = 0; verifies = 0; renders = 0; puts = 0; };
  return { open, append, appendMany, tileAt, viewport, head, setHead, kappaOf, stats, resetCounters, get length() { return spine.length; }, kappaAt: (i) => spine[i] };
}

// A durable-store reference adapter (Map-backed) — models OPFS/fs across app launches: two makePersistentTimeline
// instances sharing ONE of these = the same disk seen by two sessions (write in session A, read in session B).
export function makeMemPersistence() {
  const log = []; const bodies = new Map(); let hd = null; const c = { loadLogs: 0, bodyReads: 0, bodyPuts: 0 };
  return {
    async loadLog() { c.loadLogs++; return log.slice(); },
    async appendLog(k) { log.push(k); },
    async has(k) { return bodies.has(k); },
    async putBody(k, bytes) { if (!bodies.has(k)) { bodies.set(k, bytes); c.bodyPuts++; } },
    async getBody(k) { c.bodyReads++; return bodies.has(k) ? bodies.get(k) : null; },
    async head() { return hd; }, async setHead(h) { hd = h; },
    counters: c, corrupt: (k, bytes) => bodies.set(k, bytes), size: () => bodies.size, logLen: () => log.length,
  };
}

export default makePersistentTimeline;
