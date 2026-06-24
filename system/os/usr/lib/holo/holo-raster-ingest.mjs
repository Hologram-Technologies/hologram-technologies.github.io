// holo-raster-ingest.mjs — the RASTER EDGE of the projection browser: turn an engine's painted framebuffer
// into a κ region-scene for holo-projector. This is the exact CPU step the native host's
// CefRenderHandler::OnPaint(buffer, dirtyRects, w, h) calls — kept here as a PURE function so the tiling +
// content-addressing + delta logic is witnessed in Node, then the C++ glue is a thin shim over the SAME law.
//
// First principles. The engine paints a BGRA buffer and tells us which rectangles changed (Chromium's own
// damage tracking — `dirtyRects`). We must NOT re-hash the whole frame every paint (that would burn the
// latency win). So: snap the frame to a fixed TILE GRID; a tile is re-extracted ONLY if a dirty rect
// touches it; each (re)extracted tile is content-addressed (κ = sha256 of its BGRA bytes). Two wins fall
// out for free — TEMPORAL: an untouched tile keeps its κ (no work); SPATIAL: two tiles with identical
// pixels (a flat background, a repeated glyph) collapse to ONE κ, so they stream once and dedup on screen.
//
// The output is a SCENE for holo-projector: regions [{ id, op, in }] where id is the tile slot, op a constant
// blit op, in the tile's content κ — plus a tileStore (inκ-hex → BGRA bytes) the projector's transform reads.
// So raster pixels enter the SAME κ channel as everything else (Law L4: one runtime). node-/DOM-safe.
import { kappaOf } from "./holo-kappa-stream.mjs";

const hexOf = (k) => String(k).split(":").pop();

// makeRasterIngest({ tile }) — one ingest per offscreen browser (it remembers each tile's last κ).
//   ingest({ buffer, width, height, dirtyRects? }) → { regions, tileStore, changed, dedup }
//     buffer     : BGRA bytes, width*height*4, upper-left origin (CEF OnPaint layout)
//     dirtyRects : [{ x, y, width, height }] in pixel coords; omit/null ⇒ KEYFRAME (every tile is dirty)
//   transform()  → the producer holo-projector calls: (opκ, inκ) → the tile's bytes (a blit is identity on pixels)
export function makeRasterIngest({ tile = 256 } = {}) {
  if (!(tile > 0)) throw new Error("holo-raster-ingest: tile must be > 0");
  const OP = "did:holo:sha256:" + "00".repeat(31) + "01";   // the constant "blit tile" op κ
  const lastK = new Map();                                    // tile id → last content κ (temporal delta state)
  const store = new Map();                                    // inκ-hex → BGRA bytes (the projector's source)

  const hits = (tx, ty, tw, th, rects) => {
    if (!rects) return true;                                  // keyframe: every tile is dirty
    for (const r of rects) {
      if (r.x < tx + tw && r.x + r.width > tx && r.y < ty + th && r.y + r.height > ty) return true;
    }
    return false;
  };

  async function ingest({ buffer, width, height, dirtyRects = null }) {
    const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (buf.length < width * height * 4) throw new Error("holo-raster-ingest: buffer smaller than width*height*4");
    const cols = Math.ceil(width / tile), rows = Math.ceil(height / tile);
    const regions = []; let changed = 0; const seenThisFrame = new Set();
    for (let ry = 0; ry < rows; ry++) {
      for (let cx = 0; cx < cols; cx++) {
        const id = "t" + cx + "_" + ry;
        const tx = cx * tile, ty = ry * tile;
        const tw = Math.min(tile, width - tx), th = Math.min(tile, height - ty);
        if (!hits(tx, ty, tw, th, dirtyRects) && lastK.has(id)) {
          regions.push({ id, op: OP, in: lastK.get(id) });    // untouched ⇒ reuse its κ, no extraction
          continue;
        }
        // extract this tile's BGRA bytes (rows are width*4 apart in the source) and content-address them
        const px = new Uint8Array(tw * th * 4);
        for (let row = 0; row < th; row++) {
          const src = ((ty + row) * width + tx) * 4;
          px.set(buf.subarray(src, src + tw * 4), row * tw * 4);
        }
        const k = await kappaOf(px);                           // SPATIAL dedup: identical tiles ⇒ identical κ
        const hex = hexOf(k);
        if (!store.has(hex)) store.set(hex, px);
        if (!seenThisFrame.has(hex)) seenThisFrame.add(hex);
        if (lastK.get(id) !== k) changed++;
        lastK.set(id, k);
        regions.push({ id, op: OP, in: k });
      }
    }
    return { regions, tileStore: store, changed, dedup: regions.length - seenThisFrame.size };
  }

  // the producer for holo-projector: a tile's painted output IS its bytes (blit is identity on the pixels)
  const transform = async (_op, inn) => store.get(hexOf(inn));

  return { ingest, transform, op: OP, tiles: () => ({ rows: lastK.size }) };
}

export default { makeRasterIngest };
