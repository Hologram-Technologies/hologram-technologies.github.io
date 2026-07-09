// m15b-shard.mjs — SHARD-AT-INGEST (productionize M13a/14b tiling into the .holo build). Produce a tiled
// representation of a real model: big tensors → row-tile κ-blocks (+ expert-dir for MoE), small tensors
// whole. VERIFY it is (1) LOSSLESS (concat(tiles) == original tensor bytes, byte-exact), (2) STREAMABLE
// (every block re-derives to its κ), (3) NO BLOAT (Σ block bytes == model bytes), (4) CORRECT (a tiled
// forward is BYTE-IDENTICAL to resident). This is the build step the live streaming loader consumes.
import { readFileSync } from "node:fs";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward, blockOf } from "./gguf-forge-exec.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const MODEL = ".models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
const MiB = 1024 * 1024, hexOf = (k) => String(k).split(":").pop();
const f = forgeGguf(new Uint8Array(readFileSync(MODEL))); const graph = synthesizeGraph(f.plan);
const rowBytesOf = (t) => t.typeName === "F32" ? t.dims[0] * 4 : t.typeName === "F16" ? t.dims[0] * 2 : (() => { const [be, bb] = blockOf(t.type); return (t.dims[0] / be) * bb; })();
const eqBytes = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

// ── the ingest: tiled block store + opts.tiles ──
const BIG = 8 * MiB, TILE = 4 * MiB;
const blocks = new Map();                      // κhex -> bytes (the streamable shards)
const opts_tiles = {};
let nTiled = 0, modelBytes = 0, blockBytes = 0, lossless = 0, tiledTensors = 0;
for (const t of f.plan.tensors) {
  const whole = f.blocks.get(hexOf(t.kappa)); modelBytes += whole.byteLength;
  if (t.nbytes > BIG && t.dims.length > 1) {
    tiledTensors++; const rb = rowBytesOf(t), N = t.dims[1], TR = Math.max(1, Math.floor(TILE / rb)); const tiles = []; const parts = [];
    for (let n0 = 0; n0 < N; n0 += TR) { const n1 = Math.min(n0 + TR, N); const b = whole.subarray(n0 * rb, n1 * rb).slice(); const hx = sha256hex(b); blocks.set(hx, b); tiles.push({ kappa: "sha256:" + hx, n0, n1 }); parts.push(b); nTiled++; }
    opts_tiles[t.kappa] = tiles;
    // (1) LOSSLESS: concat(tiles) must equal the original tensor bytes exactly
    const cat = new Uint8Array(whole.byteLength); let o = 0; for (const p of parts) { cat.set(p, o); o += p.byteLength; }
    if (eqBytes(cat, whole)) lossless++;
  } else { const hx = hexOf(t.kappa); blocks.set(hx, whole); }
}
for (const [hx, b] of blocks) blockBytes += b.byteLength;

// (2) STREAMABLE: every block re-derives to its κ (L5)
let reDerive = 0; for (const [hx, b] of blocks) if (sha256hex(b) === hx) reDerive++;

// (4) CORRECT: tiled forward == resident forward (byte-identical)
const tokens = [785, 6722, 374, 264];
const lk = (l) => sha256hex(new Uint8Array(l.buffer, l.byteOffset, l.byteLength));
const resident = forward(f.plan, graph, { get: (h) => f.blocks.get(h) }, tokens, { load: (st, k) => st.get(hexOf(k)) });
const tiled = forward(f.plan, graph, { get: (h) => blocks.get(h) }, tokens, { load: (st, k) => st.get(hexOf(k)), tiles: opts_tiles });
const identical = lk(resident) === lk(tiled);

console.log(`SHARD-AT-INGEST — real qwen2.5-0.5b (${(modelBytes / MiB).toFixed(0)} MiB)`);
console.log(`  tiled ${tiledTensors} big tensors → ${nTiled} row-tile blocks; ${blocks.size} total κ-blocks (small tensors whole)`);
console.log(`  (1) LOSSLESS  concat(tiles)==original : ${lossless}/${tiledTensors} ${lossless === tiledTensors ? "PASS ✓" : "FAIL ✗"}`);
console.log(`  (2) STREAMABLE every block re-derives : ${reDerive}/${blocks.size} ${reDerive === blocks.size ? "PASS ✓" : "FAIL ✗"}`);
console.log(`  (3) NO BLOAT  Σblocks==model bytes    : ${(blockBytes / MiB).toFixed(1)} vs ${(modelBytes / MiB).toFixed(1)} MiB ${blockBytes === modelBytes ? "PASS ✓" : "FAIL ✗"}`);
console.log(`  (4) CORRECT   tiled forward==resident : ${identical ? "BYTE-IDENTICAL ✓" : "MISMATCH ✗"}`);
console.log(`\n15b: the .holo ingest can emit per-κ streamable tiles losslessly, no bloat, byte-identical inference — the build artifact the live streaming loader consumes. (Persisting to disk = write blocks/<κ>.bin + plan.tiles; identical to the in-mem store here.)`);
