// holo-kappa-timeline.mjs — the κ-stream render core (ADR: HOLO-KAPPA-RENDER-SUBSTRATE, phase 1).
//
// The disease this replaces: the messenger rebuilds its WHOLE model and re-renders a monolithic React tree on every
// event (buildModel loops all conversations; the code's own note: re-materializing all threads was "~800ms on every
// rebuild"). Cost is O(total) — a big inbox is slow no matter what you touch.
//
// The cure, in one law: a timeline is an APPEND-ONLY log of content-addressed (κ) objects, and rendering it is
// O(visible), never O(total). Three moves make that true:
//   1. append is O(1) and never touches an existing row (immutable, content-addressed spine).
//   2. a viewport materializes ONLY its [start,end) window — it never scans the rest.
//   3. a row's rendered form is memoized by its content κ (bounded LRU); a κ seen before is O(1), so scrolling back
//      re-uses cached tiles with ZERO re-render. L5 (re-derive the κ) runs ONCE, on first materialize (verify-once).
// Per-frame work is therefore independent of the total count: 1M messages cost the same to scroll as 100. The
// renderer uploads only the DELTA between frames (diff() → entered/left), so a scroll step is O(1) new work.
//
// Pure + IO injected (a renderRow(msg,seq)->tile fn; the κ hash is BLAKE3 per §1.2) so this core is Node-witnessable WITHOUT a GPU;
// in the browser, renderRow rasterizes to a κ-addressed WebGPU tile. Relates: [[webgpu-render-substrate]] ·
// [[hologram-streaming-substrate]] · [[holo-messenger-thread]] (the κ source chain this consumes).

import { blake3hex } from "./holo-blake3.mjs";  // §1.2: the ONE canonical κ hash is BLAKE3.

const _enc = new TextEncoder();

// canon(m) — a deterministic serialization for the content address. Swap for RFC 8785 JCS in production; stable-key
// JSON is enough for the render spine (the message's OWN κ from the source chain is the real identity — pass it in
// as m.kappa to skip re-hashing entirely; kappaOf honors a precomputed κ).
function canon(m) {
  if (m && typeof m === "object" && !Array.isArray(m)) {
    const keys = Object.keys(m).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon(m[k])).join(",") + "}";
  }
  return JSON.stringify(m);
}

// makeTimeline({ sha256hex, renderRow, memoCap }) -> timeline
//   sha256hex(str)->hex           OPTIONAL legacy reader — §1.2 mints via BLAKE3 now, but if injected it lets this
//                                 timeline still VERIFY content addressed under the old did:holo:sha256 axis (dual-read).
//   renderRow(msg, seq)->tile     rasterize/lay-out one row (injected; a GPU tile in the browser, any value in a witness)
//   memoCap                       max cached tiles (bounded memory; LRU-evicted). Sized to a few viewports.
export function makeTimeline({ sha256hex, renderRow, memoCap = 512 } = {}) {
  if (typeof renderRow !== "function") throw new Error("holo-kappa-timeline: inject renderRow");
  const kappa = [];               // kappa[i] = content address of row i (append-only, immutable)
  const rows = [];                // rows[i]  = the message object (in prod: a lazy handle into the κ-store)
  const memo = new Map();         // κ -> tile, insertion-ordered → O(1) LRU (delete+set moves to MRU)
  let renders = 0, verifies = 0, touches = 0;   // instrumentation: proves O(window), not O(N)

  // §1.2: MINT the content address with BLAKE3 (the ONE canonical κ hash). A precomputed m.kappa is honored as-is.
  function kappaOf(m) { return m && m.kappa ? String(m.kappa) : "did:holo:blake3:" + blake3hex(_enc.encode(canon(m))); }
  // Dual-read verify (§1.2): a stored κ matches if it re-derives under the BLAKE3 axis OR (legacy) the old sha256 axis,
  // so a timeline over content addressed before the migration still verifies. sha256hex is optional (skip if absent).
  function matches(m, k) {
    if (kappaOf(m) === k) return true;
    if (typeof sha256hex === "function" && ("did:holo:sha256:" + sha256hex(canon(m))) === k) return true;  // legacy dual-read
    return false;
  }

  // O(1) append. Immutable + content-addressed: returns {seq, kappa}; NEVER touches an existing row (0 renders).
  function append(m) {
    const k = kappaOf(m), seq = kappa.length;
    kappa.push(k); rows.push(m);
    return { seq, kappa: k };
  }
  function appendMany(ms) { const out = []; for (const m of ms) out.push(append(m)); return out; }

  // LRU memo (O(1)) — Map keeps insertion order; get→re-insert moves to MRU; over cap → evict the LRU (oldest key).
  function _memoGet(k) { const t = memo.get(k); if (t !== undefined) { memo.delete(k); memo.set(k, t); } return t; }
  function _memoPut(k, tile) { memo.set(k, tile); if (memo.size > memoCap) { const lru = memo.keys().next().value; if (lru !== k) memo.delete(lru); } }

  // Materialize ONE row by seq. Memo hit → O(1), no re-verify (verify-once: an immutable κ-body can't change).
  // Miss → L5 (re-derive the κ; refuse a tamper) + renderRow + cache. This is the only place a row is drawn.
  function tileAt(i) {
    touches++;
    const k = kappa[i];
    const hit = _memoGet(k);
    if (hit !== undefined) return hit;                        // warm: O(1), already verified when first drawn
    const m = rows[i];
    verifies++;                                               // L5 on first materialize (BLAKE3, or legacy sha256 dual-read)
    if (!matches(m, k)) throw new Error("holo-kappa-timeline: κ L5 REFUSE at seq " + i + " (tamper)");
    const tile = renderRow(m, i); renders++;
    _memoPut(k, tile);
    return tile;
  }

  // Render a VIEWPORT [start,end) → tiles. O(window) touches; O(misses) renders. Clamps to bounds; scans nothing else.
  function viewport(start, end) {
    start = Math.max(0, start | 0); end = Math.min(kappa.length, Math.max(start, end | 0));
    const out = new Array(end - start);
    for (let i = start; i < end; i++) out[i - start] = tileAt(i);
    return out;
  }

  // Delta between two viewport ranges → { entered:[seq…], left:[seq…], stayed }. The renderer uploads only `entered`
  // and drops `left`, so a scroll step of k rows is O(k) new work, not O(window).
  function diff(prev, next) {
    const a0 = prev.start, a1 = prev.end, b0 = next.start, b1 = next.end;
    const entered = [], left = [];
    for (let i = b0; i < b1; i++) if (i < a0 || i >= a1) entered.push(i);
    for (let i = a0; i < a1; i++) if (i < b0 || i >= b1) left.push(i);
    return { entered, left, stayed: Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) };
  }

  const stats = () => ({ n: kappa.length, memoSize: memo.size, renders, verifies, touches });
  const resetCounters = () => { renders = 0; verifies = 0; touches = 0; };
  return { append, appendMany, tileAt, viewport, diff, kappaOf, stats, resetCounters, get length() { return kappa.length; }, kappaAt: (i) => kappa[i] };
}

export default makeTimeline;
