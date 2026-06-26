// holo-canvas-share.mjs — P4: a SECOND VIEWER adopts the live scene at ~zero novel bytes.
//
// The envelope already captures every projected frame. This layer turns that frame into a STREAM OF
// κ-OBJECTS via the real holo-projector (compute-memo + delta-render + kappa-stream): the frame is tiled,
// each tile addressed by the κ of its pixels. Between frames, tiles far from the action are byte-identical
// → same κ → the delta loop emits NOTHING for them; only a CHANGED tile's bytes travel, and a tile the
// viewer already holds is a ref (≈0 bytes, reconstruct O(1)). The viewer verifies each tile before it
// paints (Law L5 — a tampered tile is refused, never shown). What crosses the wire is NOVELTY, not pixels.
//
// HONEST BOUNDARY: this shares the RENDERED PIXELS (a content-addressed spectator view), not app
// interactivity — the second viewer SEES the scene, it does not independently drive it. Generic by
// construction: pixels, not app state, so ANY imported three.js/WebGL app shares with zero app changes.
// Transport is injected (v1 = BroadcastChannel, same-origin cross-tab); the WAN swap (WebRTC / holo-dial)
// rides the same wire. Pure parts (tileFrame) are node-witnessed.
//
// Relative imports (resolve in node AND on the HOLOGRAM-rooted dev server), mirroring water-share.mjs.
import { makeProjector } from "./holo-projector.mjs";
import { kappoHex, KAPPA_PREFIX } from "./holo-kappa.mjs";

const BLIT = "op:blit";                                  // the one paint op (opaque identity; projector keys on it)
const kOf = (b) => KAPPA_PREFIX + kappoHex(b instanceof Uint8Array ? b : new Uint8Array(b));

// pure: tile an RGBA frame (w×h, row-major, 4 bytes/px) → projector regions + a bytes-by-inκ map + layout.
export function tileFrame(rgba, w, h, tw = 128, th = 128) {
  const cols = Math.ceil(w / tw), rows = Math.ceil(h / th);
  const regions = [], bytesByIn = new Map(), tiles = [];
  for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
    const x0 = tx * tw, y0 = ty * th, bw = Math.min(tw, w - x0), bh = Math.min(th, h - y0);
    const tile = new Uint8Array(bw * bh * 4);
    for (let row = 0; row < bh; row++) {                  // copy this tile's rows out of the full frame
      const src = ((y0 + row) * w + x0) * 4;
      tile.set(rgba.subarray(src, src + bw * 4), row * bw * 4);
    }
    const inK = kOf(tile), id = ty * cols + tx;
    regions.push({ id, op: BLIT, in: inK });
    bytesByIn.set(inK, tile);
    tiles.push({ id, x: x0, y: y0, w: bw, h: bh });
  }
  return { regions, bytesByIn, layout: { cols, rows, tw, th, w, h, tiles } };
}

const novelOf = (wire) => wire.reduce((n, e) => n + (e.event?.kind === "obj" ? (e.event.payload?.length || 0) : 0), 0);

// HOST — share a sequence of frames. reset() starts a fresh channel for a NEWLY joined viewer (its keyframe
// re-sends every tile as bytes, since that viewer holds nothing yet); steady frames send only the delta.
export function makeShareHost({ tw = 128, th = 128 } = {}) {
  let bytesByIn = new Map();
  const transform = (_op, inK) => { const b = bytesByIn.get(inK); if (!b) throw new Error("share: no tile for " + inK); return b; };
  let projector = makeProjector({ transform });
  return {
    reset() { projector = makeProjector({ transform }); },
    async frame(rgba, w, h, { keyframe = false } = {}) {
      const t = tileFrame(rgba, w, h, tw, th);
      bytesByIn = t.bytesByIn;
      const { wire, emitted } = await projector.render(t.regions, { keyframe });
      return { wire, layout: t.layout, emitted, novelBytes: novelOf(wire) };
    },
  };
}

// VIEWER — admit each frame's wire and paint changed tiles. paintTile(id, rgbaBytes, tile) draws one tile;
// the viewer holds prior tiles, so unchanged regions never repaint and refs reconstruct O(1). Tamper → refused.
export function makeShareViewer({ paintTile } = {}) {
  let layout = null;
  const projector = makeProjector({
    transform: () => { throw new Error("share: a viewer does not produce"); },
    paint: (id, bytes) => { const lt = layout?.tiles.find((t) => t.id === id); if (lt && paintTile) paintTile(id, bytes, lt); },
  });
  return {
    async receive({ wire, layout: l }) { if (l) layout = l; return projector.receive(wire); },
    held: () => projector.held(),
    wireBytes: () => projector.wireBytes(),
  };
}

export default { tileFrame, makeShareHost, makeShareViewer };
