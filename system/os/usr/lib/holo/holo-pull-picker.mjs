// holo-pull-picker.mjs — pure, deterministic piece picker for κ-block streaming. This is the ONE
// net-new idea of Phase A: the ordering intelligence libtorrent adds ABOVE a verified block. Given a
// κ's ordered leaf list (its UnixFS DAG order = the manifest, from holo-ipfs), which blocks we already
// hold, an optional playhead + per-block deadlines, and which peers advertise which blocks, it decides
// the NEXT blocks to request under a strategy:
//   rarest    — ascending availability across peers (spread cold content fast); ties broken by index
//   sequential— strict manifest order (download-in-order)
//   streaming — a window ahead of the playhead, deadline-first then index; spare slots spread rarest
//   endgame   — near the end, return the stragglers (the multi-peer driver fans them to all peers)
// No I/O, no hashing, no transport — only order. Deterministic ⇒ Node-witnessable; the same code runs
// unchanged in the browser. The driver (holo-pull.mjs) owns in-flight state and feeds it back via args.

export function createPicker({ blocks = [], strategy = "rarest", window = 16, endgameThreshold = 4 } = {}) {
  const order = blocks.slice();
  const index = new Map(order.map((c, i) => [c, i]));
  const have = new Set();
  const deadline = new Map();                       // cid → relative priority (lower fires first)
  let mode = strategy, playhead = 0;

  const idx = (c) => (index.has(c) ? index.get(c) : Infinity);
  const byIndex = (a, b) => idx(a) - idx(b);
  const notHeld = (c) => !have.has(c);

  function availability(c, peers) {                 // how many peers advertise this block (rarity = low count)
    let n = 0;
    for (const p of peers) {
      try { if (typeof p.has === "function" ? p.has(c) : p.blocks && (p.blocks.has ? p.blocks.has(c) : p.blocks.includes(c))) n++; } catch {}
    }
    return n;
  }
  const rarest = (cands, peers) => cands.slice().sort((a, b) => (availability(a, peers) - availability(b, peers)) || byIndex(a, b));

  // next(n, peers, inflight) → up to n cids to request next, best-first under the active strategy.
  function next(n = 1, peers = [], inflight = new Set()) {
    if (n <= 0) return [];
    const remaining = order.filter(notHeld);
    if (remaining.length === 0) return [];
    // endgame: few blocks left — return stragglers in index order, IGNORING inflight so they can be
    // double-requested across peers (the everyday cousin of "one slow block must not end the stream").
    if (remaining.length <= endgameThreshold) return remaining.sort(byIndex).slice(0, n);

    const free = (c) => notHeld(c) && !inflight.has(c);

    if (mode === "sequential") return remaining.filter((c) => !inflight.has(c)).sort(byIndex).slice(0, n);

    if (mode === "streaming") {
      const win = order.slice(playhead, playhead + window);
      const cand = [...new Set([...win, ...deadline.keys()])].filter(free);   // deadlines pull blocks in even from outside the window
      cand.sort((a, b) => ((deadline.has(a) ? deadline.get(a) : Infinity) - (deadline.has(b) ? deadline.get(b) : Infinity)) || byIndex(a, b));
      if (cand.length < n) {                                                  // spare slots spread the file (rarest-first)
        const seen = new Set(cand);
        cand.push(...rarest(remaining.filter((c) => free(c) && !seen.has(c)), peers));
      }
      return cand.slice(0, n);
    }
    return rarest(remaining.filter(free), peers).slice(0, n);                 // rarest (default)
  }

  return {
    setHave(cids) { for (const c of cids) { have.add(c); deadline.delete(c); } },
    markHave(c) { have.add(c); deadline.delete(c); },
    setPlayhead(i) { playhead = Math.max(0, Math.min(order.length, i | 0)); },
    setDeadline(c, ms = 0) { if (!have.has(c)) deadline.set(c, ms); },
    clearDeadline(c) { deadline.delete(c); },
    setStrategy(s) { mode = s; },
    next,
    remaining() { return order.length - have.size; },
    progress() { return order.length ? have.size / order.length : 1; },
    done() { return have.size >= order.length; },
    get strategy() { return mode; },
    get playhead() { return playhead; },
  };
}

export default { createPicker };
