// holo-render-tile.mjs — the renderer for a tiled framebuffer (holo-tile.mjs) on the κ-render registry.
// A holo:FrameManifest κ-object (grid of tile κs) mounts a <canvas>; tiles are drawn by putImageData. The
// STREAMING path is drawTiles(): on a new frame, redraw ONLY the changed tiles (holo-tile.diff) — unchanged
// tiles stay on the canvas, so per-frame work ∝ what changed, not frame size (the high-FPS property). Tile
// bytes are content-addressed (each re-derives to its κ); a getTile(index)→bytes provider supplies them
// (the shell wires it to the κ-route / resolver; the witness injects a cache). Registered like media (L4).
const dec = new TextDecoder();
const specOf = (b) => (b instanceof Uint8Array ? JSON.parse(dec.decode(b)) : (typeof b === "string" ? JSON.parse(b) : b));

// draw a set of tiles (by index) onto a 2D context from a getTile(index) → RGBA bytes provider.
export async function drawTiles(ctx2d, manifest, indices, getTile) {
  const byIndex = new Map(manifest.tiles.map((t) => [t.index, t]));
  for (const i of indices) {
    const t = byIndex.get(i); if (!t) continue;
    const bytes = await getTile(i); if (!bytes) continue;
    const img = new ImageData(new Uint8ClampedArray(bytes.buffer ? bytes.slice() : bytes), t.w, t.h);
    ctx2d.putImageData(img, t.x, t.y);
  }
  return indices.length;
}

// mount(el, bytes, ctx) — draw a full holo:FrameManifest into a fresh <canvas>. ctx.getTile(index) → bytes.
export async function mountTiledFrame(el, bytes, ctx = {}) {
  const m = specOf(bytes);
  const canvas = document.createElement("canvas");
  canvas.width = m.width; canvas.height = m.height; canvas.style.maxWidth = "100%";
  const ctx2d = canvas.getContext("2d");
  const getTile = ctx.getTile || (async () => null);
  await drawTiles(ctx2d, m, m.tiles.map((t) => t.index), getTile);
  el.replaceChildren(canvas);
  return { kind: "holo:FrameManifest", canvas, ctx2d, manifest: m };
}

// register the tiled-frame kind onto a HoloRender instance (same shape as the media builtins).
export function register(HoloRender) { HoloRender.register("holo:FrameManifest", mountTiledFrame); return ["holo:FrameManifest"]; }

export default { mountTiledFrame, drawTiles, register };
