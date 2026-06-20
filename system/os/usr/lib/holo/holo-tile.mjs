// holo-tile.mjs — framebuffer tiling + delta codec: the streaming-substrate core. A pixel surface (RGBA)
// is split into a grid of TILES, each content-addressed (tile→κ, blake3 σ-axis, matching shards/erasure).
// A frame is a MANIFEST of tile κs — the spatial cousin of the native-store shard manifest. Between frames,
// an unchanged tile keeps the SAME κ, so it is a cache hit and is NEVER re-sent: only changed tiles stream.
// That is the high-FPS streaming win — bytes-on-wire scale with what CHANGED, not with frame size — and it
// is 100% client-side + self-verifying (every tile re-derives to its κ, Law L5). Couples to holo-erasure:
// a frame's changed-tile set can itself be erasure-coded for loss-tolerant delivery. Isomorphic pure JS.

let _blake3 = null;
async function blake3hex(bytes) {
  if (!_blake3) _blake3 = (await import("./holo-blake3.mjs")).blake3hex;   // relative — resolves in Node (file://) and browser (/_shared/)
  return _blake3(bytes);
}
const kappaOf = async (bytes) => "did:holo:blake3:" + (await blake3hex(bytes));

// tileFrame(pixels, {width, height, tile}) → { manifest, tiles } — split RGBA pixels into κ-addressed tiles.
export async function tileFrame(pixels, { width, height, tile = 16 } = {}) {
  const px = pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels);
  if (px.length !== width * height * 4) throw new Error("holo-tile: pixels length ≠ width*height*4 (RGBA expected)");
  const cols = Math.ceil(width / tile), rows = Math.ceil(height / tile);
  const tiles = [], mtiles = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = tx * tile, y0 = ty * tile;
      const tw = Math.min(tile, width - x0), th = Math.min(tile, height - y0);
      const buf = new Uint8Array(tw * th * 4);
      for (let yy = 0; yy < th; yy++) {
        const srcOff = ((y0 + yy) * width + x0) * 4;
        buf.set(px.subarray(srcOff, srcOff + tw * 4), yy * tw * 4);
      }
      const index = ty * cols + tx;
      const kappa = await kappaOf(buf);
      tiles.push({ index, kappa, bytes: buf });
      mtiles.push({ index, tx, ty, x: x0, y: y0, w: tw, h: th, kappa });
    }
  }
  const manifest = { "@type": "holo:FrameManifest", kappa: await kappaOf(px), width, height, tile, cols, rows, tiles: mtiles };
  return { manifest, tiles };
}

// reconstruct(manifest, getBytes) → Uint8Array — reassemble a full RGBA frame. getBytes(index) → tile bytes
// (supplied from the client's tile-cache for unchanged tiles + the delta for changed ones). Byte-exact.
export async function reconstruct(manifest, getBytes) {
  const { width, height } = manifest;
  const out = new Uint8Array(width * height * 4);
  for (const t of manifest.tiles) {
    const buf = await getBytes(t.index);
    if (!buf) throw new Error(`holo-tile: missing tile ${t.index} (cannot reconstruct)`);
    for (let yy = 0; yy < t.h; yy++) {
      const dstOff = ((t.y + yy) * width + t.x) * 4;
      out.set(buf.subarray(yy * t.w * 4, (yy + 1) * t.w * 4), dstOff);
    }
  }
  return out;
}

// diff(prevManifest, currManifest) → { changed:[index], unchanged:[index] } — the tiles to STREAM vs reuse.
// Same grid required; an index whose κ differs CHANGED (must be sent), equal κ is a cache hit (reuse).
export function diff(prev, curr) {
  if (prev.cols !== curr.cols || prev.rows !== curr.rows) throw new Error("holo-tile: grid mismatch (re-tile at a fixed grid to delta)");
  const pk = new Map(prev.tiles.map((t) => [t.index, t.kappa]));
  const changed = [], unchanged = [];
  for (const t of curr.tiles) (pk.get(t.index) === t.kappa ? unchanged : changed).push(t.index);
  return { changed, unchanged };
}

export default { tileFrame, reconstruct, diff };
