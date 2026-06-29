#!/usr/bin/env node
// holo-osr-content-tiling-witness.mjs — DETERMINISTIC proof of the content-space tiling thesis (the producer
// change in holo_osr.cc OnPaint). It models, in JS, the EXACT extraction geometry the native producer runs —
// content rows at a vertical phase offset (phaseY = scrollY mod TILE), document-row addressing (c{cx}_{prow}),
// zero-padded margin tiles — over a synthetic scrolling document, and computes the SAME κ-LUT reuse% the host
// logs (HOLO-OSR-KAPPA-LUT). It proves the mechanism the falsifiable bar measures WITHOUT the GPU host: a
// fully-visible content tile keeps the same BLAKE3 κ as the page scrolls (O(1) recurrence), where the legacy
// screen-space grid re-hashes the same content as "novel" on every non-tile-multiple scroll.
//
// What it canNOT prove here (host-only): that Chromium's real scrollY is acquired accurately at paint time —
// that is the predictor + throttled-CDP leg, instrumented live as "scroll-acq resid" in the same host log.
//   node tools/holo-osr-content-tiling-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { blake3hex } from "../os/usr/lib/holo/holo-blake3.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-osr-content-tiling-witness.result.json"), JSON.stringify(r, null, 2) + "\n");

const TILE = 256;
const W = 256;          // one column is enough — the content-space win is purely the VERTICAL axis
const H = 768;          // 3 tile-rows tall viewport
const COLS = (W + TILE - 1) / TILE;

// A synthetic, infinitely-tall document: every absolute document row has DISTINCT bytes (so distinct content ⇒
// distinct κ; no accidental collisions inflate reuse). The producer reads BGRA from the framebuffer; we model
// the framebuffer the same way and apply the same BGRA→RGBA swap on extraction, for fidelity.
function docPixelBGRA(x, docY) {
  const r = (docY * 7 + 11) & 255;
  const g = ((docY >> 3) * 5 + x * 3) & 255;
  const b = (docY * 13 + x * 7 + 3) & 255;
  return [b, g, r, 255];   // B,G,R,A — framebuffer order
}

// The framebuffer the producer would receive at a given scrollY: screen row sRow shows document row scrollY+sRow.
function frameBufferAt(scrollY) {
  const buf = new Uint8Array(W * H * 4);
  for (let sRow = 0; sRow < H; ++sRow) {
    const docY = scrollY + sRow;
    for (let x = 0; x < W; ++x) {
      const p = docPixelBGRA(x, docY);
      const o = (sRow * W + x) * 4;
      buf[o] = p[0]; buf[o + 1] = p[1]; buf[o + 2] = p[2]; buf[o + 3] = p[3];
    }
  }
  return buf;
}

// Extract ONE tile's RGBA bytes exactly as holo_osr.cc OnPaint does: TILE rows tall, row r taken from screen
// row screenTop+r when on-screen (BGRA→RGBA), else zero-padded. `tw` = the tile's (possibly clipped) width.
function extractTile(buf, screenTop, tx, tw) {
  const px = new Uint8Array(tw * TILE * 4);
  for (let r = 0; r < TILE; ++r) {
    const sRow = screenTop + r;
    const d = r * tw * 4;
    if (sRow >= 0 && sRow < H) {
      for (let i = 0; i < tw; ++i) {
        const s = (sRow * W + (tx + i)) * 4;
        px[d + i * 4] = buf[s + 2];      // R ← B
        px[d + i * 4 + 1] = buf[s + 1];  // G
        px[d + i * 4 + 2] = buf[s];      // B ← R
        px[d + i * 4 + 3] = buf[s + 3];  // A
      }
    } // else: leave zero (deterministic margin pad)
  }
  return px;
}

// One frame of the CONTENT-SPACE producer. Returns the per-frame κ-LUT tally (full-tile changes vs recurrences)
// exactly as the host counts it, plus the list of full tiles (for invariants), mutating cache+lastKappa+state.
function contentFrame(scrollY, st) {
  const phaseY = ((scrollY % TILE) + TILE) % TILE;
  const scrolled = scrollY !== st.lastScroll;
  let changedFull = 0, recurFull = 0, edges = 0;
  const fullTiles = [];
  const buf = frameBufferAt(scrollY);
  for (let ry = 0; ; ++ry) {
    const screenTop = ry * TILE - phaseY;
    if (screenTop >= H) break;
    const prow = (scrollY + screenTop) / TILE;             // exact integer for full tiles
    const vFull = screenTop >= 0 && screenTop + TILE <= H;
    for (let cx = 0; cx < COLS; ++cx) {
      const tx = cx * TILE, tw = Math.min(TILE, W - tx);
      const visTop = Math.max(0, screenTop), visBot = Math.min(H, screenTop + TILE);
      if (visBot <= visTop) continue;
      const hex = blake3hex(extractTile(buf, screenTop, tx, tw));
      const id = `c${cx}_${prow}`;
      const kChanged = st.lastKappa.get(id) !== hex;
      if (!kChanged && !scrolled) continue;                // emit on κ-change OR scroll (position shift)
      st.lastKappa.set(id, hex);
      if (!vFull) { edges++; if (!st.cache.has(hex)) st.cache.add(hex); continue; }
      changedFull++;
      if (st.cache.has(hex)) recurFull++; else st.cache.add(hex);
      fullTiles.push({ prow, cx, hex, screenTop, lensY: prow * TILE - scrollY });
    }
  }
  st.lastScroll = scrollY;
  return { changedFull, recurFull, edges, fullTiles };
}

// The LEGACY screen-space producer (the bug being fixed): fixed grid t{cx}_{ry}, emit only on κ-change. This is
// the baseline the host measured at 21–27% mid-scroll.
function screenFrame(scrollY, st) {
  let changed = 0, recur = 0;
  const buf = frameBufferAt(scrollY);
  const rows = Math.ceil(H / TILE);
  for (let ry = 0; ry < rows; ++ry) {
    const screenTop = ry * TILE;
    const th = Math.min(TILE, H - screenTop);
    for (let cx = 0; cx < COLS; ++cx) {
      const tx = cx * TILE, tw = Math.min(TILE, W - tx);
      // extract th rows at the fixed screen slot (screen-space → content shifts inside it as you scroll)
      const px = new Uint8Array(tw * th * 4);
      for (let r = 0; r < th; ++r) for (let i = 0; i < tw; ++i) {
        const s = ((screenTop + r) * W + (tx + i)) * 4, d = (r * tw + i) * 4;
        px[d] = buf[s + 2]; px[d + 1] = buf[s + 1]; px[d + 2] = buf[s]; px[d + 3] = buf[s + 3];
      }
      const hex = blake3hex(px);
      const id = `t${cx}_${ry}`;
      if (st.lastKappa.get(id) === hex) continue;          // legacy emit rule: κ-change only
      st.lastKappa.set(id, hex);
      changed++;
      if (st.cache.has(hex)) recur++; else st.cache.add(hex);
    }
  }
  return { changed, recur };
}

// A scroll trace that mimics a read of a long article: settle, read-scroll down in non-tile-multiple steps,
// pause, then scroll back UP over the same content (must be near-total reuse — it's all resident), then re-down.
function buildTrace() {
  const t = [];
  let y = 0;
  for (let i = 0; i < 3; ++i) t.push(y);                    // initial settle
  for (let i = 0; i < 34; ++i) { y += 83; t.push(y); }      // read-scroll DOWN (83px: not a tile multiple)
  for (let i = 0; i < 6; ++i) t.push(y);                    // pause (settled)
  const upMark = t.length;
  for (let i = 0; i < 34; ++i) { y -= 83; t.push(y); }      // scroll BACK UP over seen content
  const reDownMark = t.length;
  for (let i = 0; i < 20; ++i) { y += 83; t.push(y); }      // re-scroll DOWN over seen content
  return { trace: t, upMark, reDownMark };
}

const { trace, upMark } = buildTrace();
// The bar names MID-SCROLL over fresh content (where the screen grid measured 21–27%). Window the trace so the
// comparison is host-faithful: the initial read-scroll DOWN is fresh content; the back-up/re-down phases are
// REVISITS (both producers recur there, so a whole-trace average would mask the bug). midDown = frames [3,37).
const midIn = (f) => f >= 3 && f < 37;
const backIn = (f) => f >= upMark;

const cst = { cache: new Set(), lastKappa: new Map(), lastScroll: -1 };
const sst = { cache: new Set(), lastKappa: new Map() };
const acc = { cAll: [0, 0], cMid: [0, 0], cBack: [0, 0], sAll: [0, 0], sMid: [0, 0], cEdges: 0 };
const add = (slot, changed, recur) => { slot[0] += changed; slot[1] += recur; };
const tileKByProw = new Map();                               // (cx,prow) → set of κ ever seen full (stability check)
let placementOK = true;
for (let f = 0; f < trace.length; ++f) {
  const c = contentFrame(trace[f], cst);
  add(acc.cAll, c.changedFull, c.recurFull); acc.cEdges += c.edges;
  if (midIn(f)) add(acc.cMid, c.changedFull, c.recurFull);
  if (backIn(f)) add(acc.cBack, c.changedFull, c.recurFull);
  for (const t of c.fullTiles) {
    if (t.screenTop !== t.lensY) placementOK = false;        // producer screen pos == lens placement (prow·TILE−scrollY)
    const key = `${t.cx}_${t.prow}`;
    if (!tileKByProw.has(key)) tileKByProw.set(key, new Set());
    tileKByProw.get(key).add(t.hex);
  }
  const s = screenFrame(trace[f], sst);                      // legacy baseline over the identical scroll
  add(acc.sAll, s.changed, s.recur);
  if (midIn(f)) add(acc.sMid, s.changed, s.recur);
}
const pct = ([ch, re]) => (ch ? (100 * re / ch) : 0);
const contentReuse = pct(acc.cAll), screenReuse = pct(acc.sAll);
const midContent = pct(acc.cMid), midScreen = pct(acc.sMid), backReuse = pct(acc.cBack);
// STABILITY: a given content tile (cx,prow), whenever it is fully visible, must hash to ONE κ across all the
// scroll offsets — that single-valued-ness IS the recurrence. (>1 κ for a prow ⇒ the win silently erased.)
const unstable = [...tileKByProw.entries()].filter(([, s]) => s.size !== 1).map(([k]) => k);

const checks = {
  // THE falsifiable bar: mid-scroll (fresh content) reuse climbs to ≥70% — from the screen-grid's 21–27%.
  midScrollReuseAtLeast70: midContent >= 70,
  // the legacy screen grid genuinely fails mid-scroll (reproduces the bug on the same trace) and content fixes
  // it by a wide margin — proving the win is the addressing change, not the workload.
  screenGridFailsMidScroll: midScreen <= 40 && (midContent - midScreen) >= 40,
  // scroll DOWN then back UP/again over seen offsets ⇒ near-total reuse (all content tiles resident)
  scrollBackNearTotal: backReuse >= 90,
  // every fully-visible content tile is single-κ across scroll (margins excluded) — no silent poison
  fullTilesStable: unstable.length === 0,
  // producer screen position equals the lens placement formula prow·TILE − scrollY (round-trip)
  lensPlacementRoundTrips: placementOK,
};
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
console.log(`\n  MID-SCROLL (fresh content) — the bar:`);
console.log(`    content-space: ${midContent.toFixed(1)}%   screen-space: ${midScreen.toFixed(1)}%  (baseline = the bug)`);
console.log(`  whole trace: content ${contentReuse.toFixed(1)}% · screen ${screenReuse.toFixed(1)}% | scroll-back/revisit: ${backReuse.toFixed(1)}%`);
console.log(`  content full-tile changes ${acc.cAll[0]}, recurrences ${acc.cAll[1]}, margin tiles ${acc.cEdges}, frames ${trace.length}`);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  spec: "Content-space tile addressing (holo_osr.cc OnPaint): tiles addressed by document row at a scrollY phase offset keep one BLAKE3 κ across scroll, so a scrolled page reuses content O(1) instead of re-hashing it as novel. Models the native producer's exact extraction geometry + κ-LUT accounting; the host-only scroll-acquisition accuracy is instrumented live (scroll-acq resid).",
  authority: "Node + the substrate's own pure-JS BLAKE3 (holo-blake3.mjs, the σ-axis the lens verifies on)",
  witnessed, lane: "deterministic",
  metrics: { midContentReuse: +midContent.toFixed(1), midScreenReuse: +midScreen.toFixed(1), contentReuse: +contentReuse.toFixed(1), screenReuse: +screenReuse.toFixed(1), backReuse: +backReuse.toFixed(1), fullTileChanges: acc.cAll[0], recurrences: acc.cAll[1], marginTiles: acc.cEdges, frames: trace.length },
  checks,
};
write(result);
console.log(`\nholo-osr-content-tiling-witness: ${witnessed ? "WITNESSED ✓ content-space tiling turns scroll into O(1) κ-reuse (≥70%)" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
