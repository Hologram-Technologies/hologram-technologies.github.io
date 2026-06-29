// holo-projection-pipeline.mjs — the WHOLE projection substrate as one path. It composes all six primitives
// so a deterministic producer (a game core, a QEMU framebuffer, the browser OSR origin) reaches the eye with
// negative latency, novelty-only streaming, and a panel-rate present — the unified pipeline the QEMU+retro
// prompt calls for:
//
//   producer ──run-ahead──▶ presented frame (L ahead) ──raster-ingest──▶ κ tiles ──projector(L5)──▶ lens
//                │                                                                                     │
//                └─ committed (authoritative, untouched) ──┐                            composited framebuffer
//                                                          │                                          │
//   present loop (panel rate) ──mailbox.acquire latest OR reproject the held front toward fresh input─┘
//
// PRODUCE runs at the producer's rate (sacred, deterministic); PRESENT runs at the panel's refresh — between
// produced frames it reprojects the held frame to the freshest input (async timewarp). The DETERMINISM FENCE
// is end-to-end: ingest/projector/reproject/mailbox are ALL read-only on the producer, and run-ahead's
// committed trajectory is bit-identical to a plain run — so the whole pipeline cannot corrupt sim state.
//
// node-/DOM-safe. The lens `paint` is injected (CPU framebuffer here; holo-webgpu-lens on the metal).
import { makeRunAhead } from "./holo-runahead.mjs";
import { makeRasterIngest } from "./holo-raster-ingest.mjs";
import { makeProjector } from "./holo-projector.mjs";
import { makeFrameMailbox } from "./holo-present-mailbox.mjs";
import { reproject, ReprojectionTracker } from "./holo-reproject.mjs";

export function makeProjectionPipeline({ producer, frames = 1, tile = 256, width, height, lens = null }) {
  if (!producer || !width || !height) throw new Error("holo-projection-pipeline: needs { producer, width, height }");
  const fb = new Uint8Array(width * height * 4);             // the composited surface (the CPU lens target)
  // the lens: blit a κ tile into the framebuffer at its grid slot (or hand off to an injected GPU lens)
  const paint = (id, bytes) => {
    if (lens) return lens.paint(id, bytes);
    const m = /^t(\d+)_(\d+)$/.exec(id); const cx = +m[1], ry = +m[2];
    const x0 = cx * tile, y0 = ry * tile, tw = Math.min(tile, width - x0), th = Math.min(tile, height - y0);
    for (let r = 0; r < th; r++) fb.set(bytes.subarray(r * tw * 4, (r + 1) * tw * 4), ((y0 + r) * width + x0) * 4);
  };

  const runAhead = makeRunAhead(producer, { frames });
  const ingest = makeRasterIngest({ tile });
  const projector = makeProjector({ transform: ingest.transform, paint });
  const mbox = makeFrameMailbox(width * height * 4);
  const tracker = new ReprojectionTracker();

  // PRODUCE one authoritative step. inputPos = the input the frame is rendered with (for reprojection delta).
  async function produce(input, inputPos = { x: 0, y: 0 }) {
    const { presented, committed } = await runAhead.step(input);              // presented = L ahead; committed = truth
    const { regions, changed } = await ingest.ingest({ buffer: presented, width, height });
    const r = await projector.render(regions);                               // novelty-only κ tiles
    const recv = await projector.receive(r.wire);                            // L5 verify-before-paint → lens → fb
    mbox.producer.publish(fb);                                               // hand the composited frame to present
    tracker.setFrameInput(inputPos.x, inputPos.y);
    return { presented, committed, changed, emitted: r.emitted, novelBytes: recv.novelBytes, composited: fb.slice() };
  }

  // PRESENT one panel tick at the freshest input. Returns what hits the eye: the newest composited frame, or
  // the held front reprojected toward `latestPos` (present-side negative latency). Never touches the producer.
  function present(latestPos = { x: 0, y: 0 }) {
    const fresh = mbox.consumer.acquire();
    const base = fresh || mbox.consumer.front();
    tracker.setLatestInput(latestPos.x, latestPos.y);
    const d = tracker.delta();
    if (fresh || (d.dx === 0 && d.dy === 0)) return base;                     // fresh frame (or no motion) → as-is
    return reproject(base, width, height, d.dx, d.dy);                        // re-present held front, warped
  }

  return { produce, present, framebuffer: () => fb, projector, ingest, runAhead, tracker };
}

export default { makeProjectionPipeline };
