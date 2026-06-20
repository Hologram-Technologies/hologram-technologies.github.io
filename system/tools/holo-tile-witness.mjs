#!/usr/bin/env node
// holo-tile-witness.mjs — TARGET (RED until implemented), per holospaces vv discipline: define "done" for
// the FRAMEBUFFER TILING + DELTA codec — the streaming-substrate core. A pixel surface is split into
// content-addressed TILES (tile→κ); a frame is a manifest of tile κs (spatial cousin of the shard
// manifest). Between frames, only CHANGED tiles stream — an unchanged tile has the SAME κ, so it is a
// cache hit, never re-sent. That is the high-FPS win: bytes-on-wire ∝ what changed, not frame size.
//
// Checks (all must hold for GREEN):
//   1 exports               — tileFrame() · reconstruct() · diff().
//   2 tilesAreKappaObjects   — every tile κ re-derives (blake3 σ-axis, like shards).
//   3 fullRoundtrip          — reconstruct(from all tiles) === the frame, BYTE-EXACT (lossless tiling).
//   4 frameKappaIsContent    — manifest.kappa === blake3(frame) — identity is the pixels (L1).
//   5 diffFindsChanged       — frame2 = frame1 with N tiles changed ⇒ diff() returns EXACTLY those N indices.
//   6 deltaReconstructs      — reconstruct frame2 from frame1's tile-cache + only the changed (delta) tiles → byte-exact.
//   7 crossFrameDedup        — an UNCHANGED tile has the same κ across frames (content-addressed cache hit).
//   8 bandwidthWin           — delta bytes ≪ full-frame bytes when few tiles change (the streaming claim, measured).
//
// Authority: lossless tiling (reconstruct ≡ original) + content-addressing (κ = blake3 of tile bytes) —
// not self-reference. Pure Node → gated live (LIVE_EXIT).
//   node tools/holo-tile-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os/usr/lib/holo");
let T = null;
try { T = await import(pathToFileURL(join(OS, "holo-tile.mjs"))); } catch (e) { /* RED until built */ }
const { blake3hex } = await import(pathToFileURL(join(OS, "holo-blake3.mjs")));

const checks = {}; let passed = 0, failed = 0;
const rec = (n, ok, d) => { checks[n] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

rec("holo-tile.mjs exports tileFrame() + reconstruct() + diff()", !!T && typeof T.tileFrame === "function" && typeof T.reconstruct === "function" && typeof T.diff === "function");
if (!T || typeof T.tileFrame !== "function") {
  writeFileSync(join(here, "holo-tile-witness.result.json"), JSON.stringify({ spec: "framebuffer tiling + delta: content-addressed tiles, only changed tiles stream, byte-exact reconstruct", status: "target", witnessed: false, checks, passed, failed }, null, 2) + "\n");
  console.log(`\nholo-tile-witness: ${passed} passed, ${failed} failed — RED (target; expected until implemented)`);
  process.exit(1);
}

const W = 64, H = 64, TILE = 16;                                  // 4×4 = 16 tiles, RGBA
const frame = (mut) => { const p = new Uint8Array(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; p[i] = (x * 4) & 0xff; p[i + 1] = (y * 4) & 0xff; p[i + 2] = ((x + y) * 2) & 0xff; p[i + 3] = 255; } if (mut) mut(p); return p; };
const f1 = frame();
// f2 = f1 with two tiles changed: tile (0,0) and tile (3,2)
const f2 = frame((p) => { const paint = (tx, ty) => { for (let y = ty * TILE; y < ty * TILE + TILE; y++) for (let x = tx * TILE; x < tx * TILE + TILE; x++) { const i = (y * W + x) * 4; p[i] = 200; p[i + 1] = 10; p[i + 2] = 60; } }; paint(0, 0); paint(3, 2); });

const a = await T.tileFrame(f1, { width: W, height: H, tile: TILE });
const b = await T.tileFrame(f2, { width: W, height: H, tile: TILE });

// 2 · tiles are κ-objects
rec("every tile is a κ-object that re-derives (blake3)", a.tiles.length === 16 && a.tiles.every((t) => t.kappa === "did:holo:blake3:" + blake3hex(t.bytes)));
// 3 · lossless full roundtrip
{ const m = new Map(a.tiles.map((t) => [t.index, t.bytes])); rec("full roundtrip is byte-exact (lossless tiling)", eq(await T.reconstruct(a.manifest, (i) => m.get(i)), f1)); }
// 4 · frame κ is its content
rec("frame κ is the content hash (identity is the pixels, L1)", a.manifest.kappa === "did:holo:blake3:" + blake3hex(f1));
// 5 · diff finds exactly the changed tiles
const d = T.diff(a.manifest, b.manifest);
{ const changed = [...d.changed].sort((x, y) => x - y); const expect = [a.manifest.tiles.find((t) => t.tx === 0 && t.ty === 0).index, a.manifest.tiles.find((t) => t.tx === 3 && t.ty === 2).index].sort((x, y) => x - y); rec("diff returns EXACTLY the changed tiles", eq(changed, expect), `changed ${changed.join(",")}`); }
// 6 · delta reconstruct: rebuild f2 from f1's cache + only the changed tiles
{
  const cache = new Map(a.tiles.map((t) => [t.index, t.bytes]));        // what the client already has from f1
  const deltaTiles = new Map(d.changed.map((i) => [i, b.tiles.find((t) => t.index === i).bytes]));
  const get = (i) => deltaTiles.has(i) ? deltaTiles.get(i) : cache.get(i);
  rec("delta reconstruct is byte-exact (f1 cache + changed tiles → f2)", eq(await T.reconstruct(b.manifest, get), f2));
}
// 7 · cross-frame dedup: an unchanged tile shares its κ across frames
{ const un = a.manifest.tiles.find((t) => !d.changed.includes(t.index)); const bk = b.manifest.tiles.find((t) => t.index === un.index); rec("an unchanged tile has the same κ across frames (cache hit, not re-sent)", un.kappa === bk.kappa); }
// 8 · bandwidth win
{ const full = f2.length; const delta = d.changed.reduce((s, i) => s + b.tiles.find((t) => t.index === i).bytes.length, 0); rec("delta bytes ≪ full frame (streaming win)", delta < full * 0.25, `${delta} vs ${full} bytes (${(100 * delta / full).toFixed(0)}%)`); }

const witnessed = failed === 0;
writeFileSync(join(here, "holo-tile-witness.result.json"), JSON.stringify({
  spec: "Framebuffer tiling + delta codec: content-addressed tiles (tile→κ); a frame is a manifest of tile κs; only CHANGED tiles stream (unchanged = same κ = cache hit); reconstruct is byte-exact. The streaming-substrate core: bytes-on-wire ∝ what changed.",
  authority: "lossless tiling (reconstruct ≡ original) · content-addressing (κ = blake3 of tile bytes) · holospaces Laws L1·L2·L3 · couples to holo-erasure shard ordering",
  status: witnessed ? "live" : "target",
  witnessed, params: { width: W, height: H, tile: TILE },
  covers: ["framebuffer-tiling", "delta-stream", "content-addressed-tiles", "cross-frame-dedup", "byte-exact", "streaming-substrate"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-tile-witness: ${passed} passed, ${failed} failed — ${witnessed ? "GREEN (promote to live)" : "RED"}`);
process.exit(witnessed ? 0 : 1);
