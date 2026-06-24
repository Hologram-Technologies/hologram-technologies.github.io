#!/usr/bin/env node
// holo-raster-ingest-witness.mjs — PROVE the RASTER EDGE: an engine's painted BGRA framebuffer + its dirty
// rects become a κ region-scene that drives holo-projector, so web pixels enter the SAME κ channel as
// everything else. This is the exact CPU step CefRenderHandler::OnPaint will call; proving it in Node means
// the native host is a thin shim over a witnessed law, not new untested logic.
//
// Checks: a keyframe tiles into N content-addressed regions the projector paints; ONE dirty rect re-extracts
// exactly ONE tile (no full-frame re-hash); identical tiles (flat background) collapse to ONE κ and stream
// once (spatial dedup); re-ingesting an unchanged frame yields zero changed tiles ⇒ zero wire (temporal
// reuse); a one-tile change streams only that tile's bytes (novelty-only); a second device holding the base
// re-projects the whole frame in zero novel bytes, pixel-identical.
//   node tools/holo-raster-ingest-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeRasterIngest } from "../os/usr/lib/holo/holo-raster-ingest.mjs";
import { makeProjector } from "../os/usr/lib/holo/holo-projector.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const W = 512, H = 512, TILE = 256, TILEBYTES = TILE * TILE * 4;   // 2×2 = 4 tiles, each 262144 bytes

// a framebuffer whose every tile is filled with fn(cx,ry) — lets us make distinct or identical tiles at will
const frame = (fn) => {
  const buf = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = fn(Math.floor(x / TILE), Math.floor(y / TILE));
    const o = (y * W + x) * 4; buf[o] = v; buf[o + 1] = v; buf[o + 2] = v; buf[o + 3] = 255;
  }
  return buf;
};
const gradient = () => frame((cx, ry) => 20 + (ry * 2 + cx) * 50);   // 4 distinct tiles
const solid = () => frame(() => 128);                                 // 4 identical tiles

const checks = {}; let model = null;

// ── 1 · keyframe: 4 distinct tiles ⇒ 4 content-addressed regions, projector paints all 4 ──────────
{
  const ing = makeRasterIngest({ tile: TILE });
  const p = makeProjector({ transform: ing.transform });
  const { regions, changed } = await ing.ingest({ buffer: gradient(), width: W, height: H });
  const distinct = new Set(regions.map((r) => r.in)).size;
  const r = await p.receive((await p.render(regions)).wire);
  checks.keyframeTilesScene = regions.length === 4 && distinct === 4 && changed === 4 && r.painted === 4 && r.novelBytes === 4 * TILEBYTES;
}

// ── 2 · one dirty rect ⇒ exactly one tile re-extracted, one region changes, one repaint ───────────
{
  const ing = makeRasterIngest({ tile: TILE });
  const p = makeProjector({ transform: ing.transform });
  await p.receive((await p.render((await ing.ingest({ buffer: gradient(), width: W, height: H })).regions)).wire);
  // mutate a 10×10 patch inside tile (1,1); report only that dirty rect (Chromium's damage)
  const b2 = gradient(); const px = (260 * W + 260) * 4; for (let i = 0; i < 10; i++) b2[px + i * 4] = 7;
  const { regions, changed } = await ing.ingest({ buffer: b2, width: W, height: H, dirtyRects: [{ x: 256, y: 256, width: 16, height: 16 }] });
  const f = await p.render(regions); const r = await p.receive(f.wire);
  checks.oneDirtyTile = changed === 1 && f.emitted === 1 && f.wire[0].id === "t1_1" && r.painted === 1 && r.novelBytes === TILEBYTES;
}

// ── 3 · spatial dedup: a flat frame ⇒ 4 tiles collapse to ONE κ, streamed once ────────────────────
{
  const ing = makeRasterIngest({ tile: TILE });
  const p = makeProjector({ transform: ing.transform });
  const { regions, dedup } = await ing.ingest({ buffer: solid(), width: W, height: H });
  const f = await p.render(regions); const r = await p.receive(f.wire);
  const objs = f.wire.filter((w) => w.event.kind === "obj").length, refs = f.wire.filter((w) => w.event.kind === "ref").length;
  checks.spatialDedup = dedup === 3 && objs === 1 && refs === 3 && r.painted === 4 && r.novelBytes === TILEBYTES;
}

// ── 4 · temporal reuse: re-ingest an unchanged frame ⇒ zero changed tiles, zero wire ──────────────
{
  const ing = makeRasterIngest({ tile: TILE });
  const p = makeProjector({ transform: ing.transform });
  const b = gradient();
  await p.receive((await p.render((await ing.ingest({ buffer: b, width: W, height: H })).regions)).wire);
  const { changed } = await ing.ingest({ buffer: b, width: W, height: H });    // same pixels again (keyframe re-extract)
  const f = await p.render((await ing.ingest({ buffer: b, width: W, height: H })).regions);
  const r = await p.receive(f.wire);
  checks.temporalReuse = changed === 0 && f.emitted === 0 && r.painted === 0 && r.novelBytes === 0;
}

// ── 5 · novelty-only on the wire: after a keyframe, a one-tile change costs one tile of bytes ──────
{
  const ing = makeRasterIngest({ tile: TILE });
  const p = makeProjector({ transform: ing.transform });
  await p.receive((await p.render((await ing.ingest({ buffer: gradient(), width: W, height: H })).regions)).wire);
  const b2 = gradient(); b2[(10 * W + 10) * 4] = 3;                              // change tile (0,0)
  const r = await p.receive((await p.render((await ing.ingest({ buffer: b2, width: W, height: H, dirtyRects: [{ x: 0, y: 0, width: 16, height: 16 }] })).regions)).wire);
  checks.noveltyOnlyDelta = r.novelBytes === TILEBYTES;
  model = { frameBytes: W * H * 4, oneTileDeltaBytes: r.novelBytes, reduction: +((W * H * 4) / r.novelBytes).toFixed(1) };
}

// ── 6 · cross-device: a second device holding the base re-projects the frame in 0 novel bytes ─────
{
  const ingA = makeRasterIngest({ tile: TILE });
  const a = makeProjector({ transform: ingA.transform });
  const sceneA = (await ingA.ingest({ buffer: gradient(), width: W, height: H })).regions;
  await a.receive((await a.render(sceneA)).wire);
  const base = new Map(a.cache);                                                // the deduped tile base everyone holds
  // device B: its own ingest of the same frame (same pixels ⇒ same κ), cache pre-seeded with the base
  const ingB = makeRasterIngest({ tile: TILE });
  const b = makeProjector({ transform: ingB.transform, cache: base });
  const sceneB = (await ingB.ingest({ buffer: gradient(), width: W, height: H })).regions;
  const f = await b.render(sceneB, { keyframe: true }); const r = await b.receive(f.wire);
  const identical = ["t0_0", "t1_0", "t0_1", "t1_1"].every((id) => { const x = a.pixels(id), y = b.pixels(id); return x && y && x.length === y.length && x.every((v, i) => v === y[i]); });
  checks.crossDeviceFromCache = f.wire.every((w) => w.event.kind === "ref") && r.novelBytes === 0 && r.painted === 4 && identical;
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-raster-ingest-witness.result.json"), JSON.stringify({
  spec: "Raster edge of the projection browser: an engine's painted BGRA framebuffer + dirty rects become a κ region-scene (fixed tile grid, content-addressed tiles, damage-driven re-extraction) that drives holo-projector. Temporal reuse (untouched tile keeps its κ) + spatial dedup (identical tiles collapse to one κ) fall out of content addressing. This is the CPU step CefRenderHandler::OnPaint calls.",
  authority: "holospaces Laws L1/L2/L3/L5 · Chromium damage/dirty-rect tracking · tile-based content-addressed compositing",
  witnessed,
  covers: witnessed ? ["raster-ingest", "tile-grid", "damage-driven-extraction", "spatial-dedup", "temporal-reuse", "novelty-only-wire", "cross-device-from-cache"] : [],
  model,
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
if (model) console.log(`· novelty: a one-tile change on a ${model.frameBytes}-byte frame crosses ${model.oneTileDeltaBytes} bytes = ${model.reduction}× less`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ web pixels enter the κ channel: tiled, content-addressed, damage-driven — only novelty streams, identical tiles dedup, any device re-projects from cache" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
