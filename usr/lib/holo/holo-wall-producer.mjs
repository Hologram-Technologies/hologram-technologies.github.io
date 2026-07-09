// holo-wall-producer.mjs — the WALLPAPER as a projection-host producer (layer 0). Instead of a separate
// wallpaper canvas/context behind the app, the wallpaper becomes the BACK LAYER of the one shared surface
// lens: a single cover-fit tile, κ-addressed by (source, size), uploaded once and re-rastered only when the
// wallpaper changes or the viewport resizes. This is the GPU-native half of "one projected messenger" — the
// wallpaper and the chat composite in ONE pass on ONE device, which is also what makes true frosted-glass
// bubbles possible later (a bubble can sample the wallpaper layer behind it). Interactive DOM chrome
// (composer, menus) stays DOM by design — only rich GPU/canvas surfaces ride the lens. Relates:
// [[holo-messenger-projection-upgrade]] · holo-wall-lens.mjs · holo-projection-host.mjs.
//
//   makeWallProducer({ source, size, raster?, key? }) -> producer(dtMs) -> [{ key, src?, x, y, w, h, alpha }]
//     source() -> url | ""            // current wallpaper url (e.g. kappaUrl(holo.theme.v1.wallpaper)); "" = none
//     size()   -> { w, h }            // the host canvas size in device px
//     raster(url, w, h) -> Promise<canvas|bitmap>   // decode + cover-fit to a tile (default: fetch→bitmap→OffscreenCanvas)
//   The producer yields ONE draw item (the full-viewport wallpaper tile) once it is ready, else [] (transparent).

const enc = (s) => s;   // key is a plain string; the lens caches textures by it

export function makeWallProducer({ source, size, raster = defaultRaster, key = defaultKey } = {}) {
  if (typeof source !== "function" || typeof size !== "function") throw new Error("holo-wall-producer: needs source() and size()");
  const tiles = new Map();     // key → canvas/bitmap (ready)
  const pending = new Set();   // key → being rastered (kick once)
  let firstEmit = new Set();   // keys not yet handed to the lens with their src (so we upload once)

  function producer() {
    const url = source() || "";
    const { w, h } = size() || {};
    if (!url || !w || !h) return [];                         // no wallpaper / not sized → transparent back layer
    const k = key(url, w, h);
    const tile = tiles.get(k);
    if (!tile) {
      if (!pending.has(k)) {
        pending.add(k);
        Promise.resolve(raster(url, w, h)).then((t) => { if (t) { tiles.set(k, t); firstEmit.add(k); } pending.delete(k); trim(); })
          .catch(() => { pending.delete(k); });
      }
      return [];                                             // still decoding → nothing this frame (page stays transparent)
    }
    // hand src ONLY the first frame after it's ready (the lens uploads once, then caches by key).
    const withSrc = firstEmit.delete(k);
    return [{ key: enc(k), src: withSrc ? tile : undefined, x: 0, y: 0, w, h, alpha: 1 }];
  }

  function trim() { if (tiles.size > 4) { const f = tiles.keys().next().value; const t = tiles.get(f); tiles.delete(f); firstEmit.delete(f); try { t && t.close && t.close(); } catch {} } }
  return producer;
}

const defaultKey = (url, w, h) => "wall:" + url + "@" + (w | 0) + "x" + (h | 0);

// default raster: fetch (same-origin/κ → untainted, GPU-safe) → ImageBitmap → cover-fit into an OffscreenCanvas.
async function defaultRaster(url, w, h) {
  const res = await fetch(url); if (!res.ok) throw new Error("wallpaper http " + res.status);
  const bmp = await createImageBitmap(await res.blob());
  const cv = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const g = cv.getContext("2d"); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  const ar = bmp.width / bmp.height, boxAr = w / h; let sw, sh, sx, sy;
  if (ar > boxAr) { sh = bmp.height; sw = sh * boxAr; sx = (bmp.width - sw) / 2; sy = 0; } else { sw = bmp.width; sh = sw / boxAr; sx = 0; sy = (bmp.height - sh) / 2; }
  g.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  try { bmp.close && bmp.close(); } catch {}
  return cv;
}

export default { makeWallProducer };
