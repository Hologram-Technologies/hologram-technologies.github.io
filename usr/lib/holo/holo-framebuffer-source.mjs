// holo-framebuffer-source.mjs — bring a PASSIVE framebuffer (a QEMU display surface, a captured web page, a
// remote video frame) into the projection substrate. This is the QEMU leg of the unified pipeline.
//
// The honest split (stated plainly): a game core is a DETERMINISTIC input-driven sim — it gets sim-side
// run-ahead (the picture IS a function of our input, so re-running from a κ-snapshot cancels input lag). A
// framebuffer source is PASSIVE — the picture is not a function of our input, there is nothing to roll back,
// so run-ahead does not apply. What a passive display DOES get from the substrate is everything downstream:
// novelty-only tile streaming (raster-ingest + projector), spatial/temporal dedup, super-resolution at the
// lens (sharpness from the projector, not the producer), and present-side reproject (timewarp by scroll/pan
// at the panel rate). So a QEMU framebuffer becomes a stream of κ tiles exactly like everything else — and an
// IDLE VM (an unchanged framebuffer) costs ZERO bandwidth, the same "work ∝ novelty" law as the rest.
//
// getFrame() -> RGBA bytes (the current framebuffer). For real qemu-wasm this reads its display surface; for
// the witness it is a synthetic VM console. The ONLY thing that differs for a real source is getFrame.
//
// node-/DOM-safe; the lens `paint` is injected (CPU framebuffer here; holo-webgpu-lens / holo-superres on the metal).
import { makeRasterIngest } from "./holo-raster-ingest.mjs";
import { makeProjector } from "./holo-projector.mjs";

// framebufferProducer(getFrame) — adapt a framebuffer to the FULL pipeline's producer interface when you DO
// have a deterministic snapshot (e.g. QEMU's whole-machine κ-snapshot wired to run-ahead). snapshot/restore
// are no-ops here; pass a real machine producer to holo-projection-pipeline when run-ahead is wanted.
export function framebufferProducer(getFrame) {
  return { snapshot: () => [], restore: () => {}, advance: () => getFrame() };
}

// makeFramebufferPipeline — the PASSIVE projection path: sample → tile (novelty-only) → project → lens. No
// run-ahead (nothing to predict). `dirtyRects` (optional) is the source's own damage (qemu reports changed
// scanlines; a web capture reports invalidation rects) — pass it to skip re-hashing the whole frame.
export function makeFramebufferPipeline({ getFrame, width, height, tile = 256, lens = null, dirtyRects = null }) {
  if (!getFrame || !width || !height) throw new Error("holo-framebuffer-source: needs { getFrame, width, height }");
  const fb = new Uint8Array(width * height * 4);
  const paint = lens ? (id, bytes) => lens.paint(id, bytes) : (id, bytes) => {
    const m = /^t(\d+)_(\d+)$/.exec(id); const cx = +m[1], ry = +m[2];
    const x0 = cx * tile, y0 = ry * tile, tw = Math.min(tile, width - x0), th = Math.min(tile, height - y0);
    for (let r = 0; r < th; r++) fb.set(bytes.subarray(r * tw * 4, (r + 1) * tw * 4), ((y0 + r) * width + x0) * 4);
  };
  const ingest = makeRasterIngest({ tile });
  const projector = makeProjector({ transform: ingest.transform, paint });

  // present one frame: sample the framebuffer, stream only the tiles that changed, project to the lens.
  async function present({ dirty = dirtyRects } = {}) {
    const frame = getFrame();
    const { regions, changed } = await ingest.ingest({ buffer: frame, width, height, dirtyRects: dirty });
    const r = await projector.render(regions);
    const recv = await projector.receive(r.wire);
    return { frame, changed, emitted: r.emitted, novelBytes: recv.novelBytes, composited: lens ? null : fb.slice() };
  }
  return { present, ingest, projector, framebuffer: () => fb };
}

export default { framebufferProducer, makeFramebufferPipeline };
