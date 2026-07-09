// holo-kappa-scroller.mjs — HOLO-KAPPA-RENDER-SUBSTRATE phase 4 (core): scroll millions of rows at 8K in real time.
//
// The visual layer rasterizes each row to a κ-addressed WebGPU tile (glyph atlas) — that binding is browser/GPU only.
// But the LOAD-BEARING math is pure and verifiable: which rows are visible at a given scroll offset, at any
// resolution, in O(log N) — never O(N). A Fenwick (binary-indexed) tree over per-row heights gives:
//   • offsetToIndex(px)      — the row at a pixel offset            (O(log N))
//   • indexToOffset(i)       — the pixel top of a row               (O(log N))
//   • visibleWindow(top,h)   — the [start,end) rows to draw + where (O(log N))
//   • setHeight(i, px)       — a row's measured height changed      (O(log N))
//   • totalHeight()          — the scrollbar extent                 (O(1))
// So a scroll to the middle of a 1,000,000-row thread resolves the visible window in microseconds, and the renderer
// draws only that window — composing with phase 1 (materialize only visible) and phase 3 (read only visible bodies).
//
// Resolution independence: a tile is addressed by (content κ, css width, device-pixel-ratio), so 8K/retina gets its
// OWN crisp rasterization while identical content at the same width+dpr shares one tile (atlas dedup). Pure — a
// witness drives it without a GPU. Relates: [[holo-kappa-render-substrate]] · [[holo-projection-lens-8k-caps]].

// makeScroller({ count, rowHeight }) -> a virtual scroller over `count` rows (all rowHeight until measured otherwise).
export function makeScroller({ count, rowHeight = 44 } = {}) {
  const n = count | 0;
  const h = new Float64Array(n);                    // per-row heights (px, css units)
  const N1 = n + 1;
  const bit = new Float64Array(N1);                 // Fenwick tree, 1-indexed
  let ops = 0;                                      // instrumentation: Fenwick node visits (proves O(log N), not O(N))

  // O(1)-amortized linear build: seed every row to rowHeight, then fold into the Fenwick in O(n).
  for (let i = 0; i < n; i++) h[i] = rowHeight;
  for (let i = 1; i < N1; i++) { bit[i] += h[i - 1]; const j = i + (i & -i); if (j < N1) bit[j] += bit[i]; }

  const _add = (i, delta) => { for (let x = i + 1; x < N1; x += x & -x) { bit[x] += delta; ops++; } };
  const _prefix = (i) => { let s = 0; for (let x = i; x > 0; x -= x & -x) { s += bit[x]; ops++; } return s; };   // Σ h[0..i-1]

  const LOG = (() => { let k = 0; while ((1 << (k + 1)) <= n) k++; return k; })();
  // offsetToIndex(px): the 0-based row whose span contains pixel `px` (Fenwick "find-by-prefix" — O(log N)).
  function offsetToIndex(px) {
    let pos = 0, rem = px;
    for (let k = LOG; k >= 0; k--) { const nx = pos + (1 << k); if (nx < N1 && bit[nx] <= rem) { rem -= bit[nx]; pos = nx; ops++; } }
    return Math.max(0, Math.min(pos, n - 1));
  }
  const indexToOffset = (i) => _prefix(Math.max(0, Math.min(i, n)));
  const totalHeight = () => _prefix(n);

  // visibleWindow(scrollTop, viewportH, overscan) -> { start, end, offsetOfStart } — the rows to draw + the pixel top
  // of the first, in O(log N). `overscan` rows above/below smooth fast scrolls. end is exclusive.
  function visibleWindow(scrollTop, viewportH, overscan = 4) {
    const first = offsetToIndex(scrollTop);
    const last = offsetToIndex(scrollTop + viewportH);
    const start = Math.max(0, first - overscan);
    const end = Math.min(n, last + 1 + overscan);
    return { start, end, offsetOfStart: indexToOffset(start) };
  }
  function setHeight(i, px) { if (i < 0 || i >= n) return; const d = px - h[i]; if (d !== 0) { h[i] = px; _add(i, d); } }

  const resetOps = () => { ops = 0; }; const opCount = () => ops;
  return { offsetToIndex, indexToOffset, totalHeight, visibleWindow, setHeight, resetOps, opCount, get count() { return n; } };
}

// tileKeyOf(kappa, { width, dpr }) — a tile's content address in the atlas: same (content, width, dpr) → same tile
// (dedup); a higher dpr (retina / 8K scale) → a DISTINCT key → its own crisp rasterization. Deterministic + pure.
export function tileKeyOf(kappa, { width = 0, dpr = 1 } = {}) {
  return String(kappa).split(":").pop() + "@" + (width | 0) + "x" + (Math.round(dpr * 100) / 100);
}

export default makeScroller;
