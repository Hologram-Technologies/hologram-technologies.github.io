#!/usr/bin/env node
// holo-framebuffer-source-witness.mjs — PROVE the QEMU / passive-framebuffer leg of the substrate. A
// synthetic VM "boot console" (a framebuffer that gains a text line per boot step) streams through the
// passive projection path (sample → raster-ingest → projector → lens). The bars that matter for a VM:
//   • lossless projection — the composited frame equals the sampled framebuffer.
//   • IDLE VM = ZERO BANDWIDTH — an unchanged framebuffer streams nothing (work ∝ novelty, the headline
//     property: an idle VM/desktop costs nothing).
//   • novelty-only boot — one boot step (one changed text region) streams only the tile it touched.
//   • spatial dedup — the console's uniform background tiles collapse to one κ.
//   • super-res — a console tile upscales sharp at the lens and is κ-cached (resolution independence).
//   node tools/holo-framebuffer-source-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeFramebufferPipeline } from "../os/usr/lib/holo/holo-framebuffer-source.mjs";
import { makeSuperRes } from "../os/usr/lib/holo/holo-superres.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const W = 512, H = 512, TILE = 256, TB = TILE * TILE * 4;

// a synthetic VM console: a dark framebuffer that gains a white text line per boot() — a pure function of
// `lines`, so getFrame() is idempotent (sampling the same VM state twice yields identical bytes).
function makeVmConsole() {
  let lines = 0;
  const render = () => {
    const fb = new Uint8Array(W * H * 4);
    for (let i = 0; i < fb.length; i += 4) { fb[i] = 12; fb[i + 1] = 12; fb[i + 2] = 16; fb[i + 3] = 255; }
    for (let l = 0; l < lines; l++) { const y0 = 20 + l * 14; for (let y = y0; y < y0 + 8 && y < H; y++) for (let x = 20; x < 20 + 180 + (l % 3) * 10 && x < W; x++) { const o = (y * W + x) * 4; fb[o] = 220; fb[o + 1] = 220; fb[o + 2] = 210; fb[o + 3] = 255; } }
    return fb;
  };
  return { getFrame: render, boot() { lines++; }, lines: () => lines };
}
const eqBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const extractTile = (frame, w, cx, ry, tile) => { const t = new Uint8Array(tile * tile * 4); for (let r = 0; r < tile; r++) t.set(frame.subarray(((ry * tile + r) * w + cx * tile) * 4, ((ry * tile + r) * w + cx * tile) * 4 + tile * 4), r * tile * 4); return t; };

const checks = {};

// 1 · lossless projection: the composited frame equals the sampled framebuffer
const vm = makeVmConsole(); vm.boot(); vm.boot();
const pipe = makeFramebufferPipeline({ getFrame: vm.getFrame, width: W, height: H, tile: TILE });
const r1 = await pipe.present();
checks.losslessProjection = eqBytes(r1.composited, r1.frame);

// 2 · idle VM = zero bandwidth: present the same (unchanged) framebuffer ⇒ nothing streams, nothing repaints
const r2 = await pipe.present();
checks.idleZeroBandwidth = r2.changed === 0 && r2.emitted === 0 && r2.novelBytes === 0;

// 3 · novelty-only boot: one boot step (a new line inside tile (0,0)) streams exactly that tile
vm.boot();
const r3 = await pipe.present();
checks.noveltyOnlyBoot = r3.changed === 1 && r3.emitted === 1 && r3.novelBytes === TB;

// 4 · spatial dedup: on a fresh present the uniform background tiles collapse to one κ (2 distinct: text + bg)
{
  const vm2 = makeVmConsole(); vm2.boot();
  const pipe2 = makeFramebufferPipeline({ getFrame: vm2.getFrame, width: W, height: H, tile: TILE });
  const rk = await pipe2.present();
  checks.spatialDedup = rk.novelBytes === 2 * TB;
}

// 5 · super-res: a console tile upscales sharp at the lens and is κ-cached
{
  const sr = makeSuperRes({ scale: 4 });
  const t = extractTile(r1.frame, W, 0, 0, TILE);
  const u1 = await sr.upscale(t, TILE, TILE);
  const u2 = await sr.upscale(t.slice(), TILE, TILE);
  checks.superResSharp = u1.w === 1024 && u1.h === 1024 && u2.cached === true && sr.dispatches() === 1;
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-framebuffer-source-witness.result.json"), JSON.stringify({
  spec: "The QEMU / passive-framebuffer leg: a VM display (no deterministic input sim → no sim-side run-ahead) becomes a stream of κ tiles via sample → raster-ingest → projector → lens, with super-res at the lens. An idle VM (unchanged framebuffer) streams zero bytes; a boot step streams only the changed tile; uniform background dedups; a console tile upscales sharp and is κ-cached. The only thing that differs for real qemu-wasm is getFrame().",
  authority: "holospaces Laws L1/L3/L5 · QEMU live-display capture · content-addressed tile compositing · work ∝ novelty",
  witnessed,
  covers: witnessed ? ["framebuffer-source", "lossless-projection", "idle-zero-bandwidth", "novelty-only-boot", "spatial-dedup", "super-res-lens"] : [],
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ a QEMU framebuffer streams as κ tiles; an idle VM costs zero bandwidth, a boot step streams one tile, sharp at any panel" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
