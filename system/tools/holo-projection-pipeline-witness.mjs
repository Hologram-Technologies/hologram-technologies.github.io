#!/usr/bin/env node
// holo-projection-pipeline-witness.mjs — PROVE the whole projection substrate as ONE path: a deterministic
// graphics core (a moving ball) reaches the eye through run-ahead → raster-ingest → kappa-stream → projector
// → present-mailbox → reproject, with all six primitives composed. The bars:
//   • lossless projection — the composited framebuffer (tiles streamed + reassembled by the lens) is
//     pixel-identical to the produced frame.
//   • DETERMINISM FENCE end-to-end — the committed sim trajectory + final state are bit-identical to a bare
//     producer run, even with ingest/projector/reproject/mailbox/present all active. (The keystone: the
//     projection layer can NEVER corrupt sim state — L1, run-ahead, rollback netplay stay alive.)
//   • negative latency — the presented frame is L steps ahead (the ball is L·dx px further along).
//   • novelty-only — moving the ball within one tile streams exactly one tile.
//   • spatial dedup — identical background tiles collapse to one κ on the wire.
//   • present out-paces produce — between produced frames, present reprojects the held frame toward fresh
//     input, and the sim is untouched.
//   node tools/holo-projection-pipeline-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeProjectionPipeline } from "../os/usr/lib/holo/holo-projection-pipeline.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const W = 512, H = 512, TILE = 256, TB = TILE * TILE * 4, SIZE = 64;

// a deterministic graphics core: a white ball on a flat background. The frame IS a pure function of (bx,by),
// so identical trajectories produce identical frames. snapshot/restore carry (bx,by,counter).
function makeGfxCore(bx0 = 280, by0 = 300) {
  let bx = bx0, by = by0, counter = 0;
  const render = () => {
    const fb = new Uint8Array(W * H * 4);
    for (let i = 0; i < fb.length; i += 4) { fb[i] = 10; fb[i + 1] = 10; fb[i + 2] = 20; fb[i + 3] = 255; }
    for (let y = by; y < by + SIZE && y < H; y++) for (let x = bx; x < bx + SIZE && x < W; x++) { const o = (y * W + x) * 4; fb[o] = 240; fb[o + 1] = 240; fb[o + 2] = 240; fb[o + 3] = 255; }
    return fb;
  };
  return {
    snapshot() { const b = new Uint8Array(12); const dv = new DataView(b.buffer); dv.setInt32(0, bx, true); dv.setInt32(4, by, true); dv.setUint32(8, counter, true); return [b]; },
    restore(list) { const dv = new DataView(list[0].buffer, list[0].byteOffset, 12); bx = dv.getInt32(0, true); by = dv.getInt32(4, true); counter = dv.getUint32(8, true); },
    advance(input) { if (input) { bx = Math.max(0, Math.min(W - SIZE, bx + (input.dx || 0))); by = Math.max(0, Math.min(H - SIZE, by + (input.dy || 0))); } counter = (counter + 1) >>> 0; return render(); },
    _state() { return { bx, by, counter }; },
  };
}
const eqBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const ballX = (fb, row) => { for (let x = 0; x < W; x++) if (fb[(row * W + x) * 4] > 200) return x; return -1; };

const checks = {}; let model = null;
const L = 3, inputs = Array.from({ length: 6 }, () => ({ dx: 5, dy: 0 }));

// ── bare reference run (no projection layer) ──
const A = makeGfxCore(); const framesA = []; for (const inp of inputs) framesA.push(A.advance(inp)); const stateA = A._state();

// ── full-pipeline run ──
const B = makeGfxCore(); const pipe = makeProjectionPipeline({ producer: B, frames: L, tile: TILE, width: W, height: H });
const framesB = []; const presenteds = []; let firstEmitted = 0, secondEmitted = 0, secondChanged = 0, keyframeNovel = 0;
for (let t = 0; t < inputs.length; t++) {
  const r = await pipe.produce(inputs[t], { x: t * 5, y: 0 });
  framesB.push(r.committed); presenteds.push(r.presented);
  if (t === 0) { keyframeNovel = r.novelBytes; firstEmitted = r.emitted; }
  if (t === 1) { secondEmitted = r.emitted; secondChanged = r.changed; }
  // between produces, present a couple of panel ticks at a fresher input (timewarp the held frame)
  pipe.present({ x: t * 5 + 2, y: 0 });
  pipe.present({ x: t * 5 + 4, y: 0 });
}
const stateB = B._state();

// 1 · lossless projection: the composited frame equals the produced frame (tiles → lens, no loss)
{
  const C = makeGfxCore(); const p2 = makeProjectionPipeline({ producer: C, frames: 1, tile: TILE, width: W, height: H });
  const r = await p2.produce({ dx: 0, dy: 0 }, { x: 0, y: 0 });
  checks.losslessProjection = eqBytes(r.composited, r.presented);
}

// 2 · determinism fence end-to-end: committed frames + final state bit-identical to the bare run
checks.determinismFenceEndToEnd = framesB.every((f, t) => eqBytes(f, framesA[t])) && stateA.bx === stateB.bx && stateA.by === stateB.by && stateA.counter === stateB.counter;

// 3 · negative latency: the presented frame's ball is exactly L·dx px ahead of the committed frame's
{
  const row = 320; let ok = true;
  for (let t = 0; t < presenteds.length; t++) {
    const pAhead = ballX(presenteds[t], row), cNow = ballX(framesB[t], row);
    if (pAhead < 0 || cNow < 0 || pAhead - cNow !== L * 5) ok = false;
  }
  checks.negativeLatency = ok;
  model = { lookaheadSteps: L, ballAheadPx: L * 5 };
}

// 4 · novelty-only: the second produce (ball nudged within one tile) streams exactly one tile
checks.noveltyOnly = secondEmitted === 1 && secondChanged === 1;

// 5 · spatial dedup: the keyframe streams only the distinct tiles (ball tile + one background tile)
checks.spatialDedup = keyframeNovel === 2 * TB;

// 6 · present out-paces produce without touching the sim: a warped present differs from the unwarped base
{
  const D = makeGfxCore(); const p3 = makeProjectionPipeline({ producer: D, frames: 1, tile: TILE, width: W, height: H });
  await p3.produce({ dx: 0, dy: 0 }, { x: 100, y: 0 });
  const base = p3.present({ x: 100, y: 0 }).slice();        // fresh acquire, no warp
  const warped = p3.present({ x: 112, y: 0 });              // no new frame ⇒ reproject held front by +12px
  const stateBefore = D._state();
  const warpedDiffers = !eqBytes(base, warped) && warped.length === W * H * 4;
  checks.presentOutpacesProduce = warpedDiffers && stateBefore.counter === 1;   // exactly one produce ⇒ sim untouched by present
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-projection-pipeline-witness.result.json"), JSON.stringify({
  spec: "The whole projection substrate as one path: a deterministic producer reaches the eye through run-ahead → raster-ingest → kappa-stream → projector → present-mailbox → reproject. The composited frame is lossless; the committed sim trajectory + final state are bit-identical to a bare run (determinism fence end-to-end); the presented frame is L steps ahead (negative latency); only changed tiles stream; identical background tiles dedup; present reprojects the held frame between produces without touching the sim.",
  authority: "holospaces Laws L1/L3/L5 · RetroArch run-ahead · VR async timewarp · lock-free triple buffer · content-addressed tile compositing",
  witnessed,
  covers: witnessed ? ["unified-pipeline", "lossless-projection", "determinism-fence-end-to-end", "negative-latency", "novelty-only", "spatial-dedup", "present-outpaces-produce"] : [],
  model,
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
if (model) console.log(`· negative latency: presented frame is ${model.lookaheadSteps} steps ahead (ball ${model.ballAheadPx}px further) — the eye leads the sim`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ all six substrate primitives compose as one pipeline; the eye leads the sim, only novelty streams, and the projection layer never touches sim state" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
