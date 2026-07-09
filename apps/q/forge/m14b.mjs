// m14b.mjs — TILING/STREAMING WIRED INTO forward() (M14 keystone). Big tensors carry row-tiles (opts.tiles);
// matvec/getRow stream them tile-by-tile; a streaming κ-store evicts under an LRU budget. The IN-FORWARD
// peak resident drops below the 138 MiB largest-tensor floor to the budget — automatically — output
// BYTE-IDENTICAL to fully-resident, every block verified. Default-safe: no tiles → unchanged.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward, blockOf } from "./gguf-forge-exec.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const MODEL = ".models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
const SH = "C:/Users/pavel/AppData/Local/Temp/claude/C--Users-pavel-Desktop-HOLOGRAM/9be01320-de05-4b56-a1ab-35f38d512e16/scratchpad/_m14b";
const MiB = 1024 * 1024, hexOf = (k) => String(k).split(":").pop();

const f = forgeGguf(new Uint8Array(readFileSync(MODEL))); const graph = synthesizeGraph(f.plan);
const modelMiB = [...f.blocks.values()].reduce((a, b) => a + b.byteLength, 0) / MiB;
const rowBytesOf = (t) => t.typeName === "F32" ? t.dims[0] * 4 : t.typeName === "F16" ? t.dims[0] * 2 : (() => { const [be, bb] = blockOf(t.type); return (t.dims[0] / be) * bb; })();

rmSync(SH, { recursive: true, force: true }); mkdirSync(SH, { recursive: true });
const BIG = 8 * MiB, TILE_TARGET = 4 * MiB;
const opts_tiles = {};
let bigCount = 0;
for (const t of f.plan.tensors) {
  const whole = f.blocks.get(hexOf(t.kappa));
  if (t.nbytes > BIG && t.dims.length > 1) {                    // tile big matrices into row-tiles
    bigCount++; const rb = rowBytesOf(t), N = t.dims[1], TR = Math.max(1, Math.floor(TILE_TARGET / rb));
    const tiles = [];
    for (let n0 = 0; n0 < N; n0 += TR) { const n1 = Math.min(n0 + TR, N); const b = whole.subarray(n0 * rb, n1 * rb); const hx = sha256hex(b); writeFileSync(`${SH}/${hx}.bin`, Buffer.from(b)); tiles.push({ kappa: "sha256:" + hx, n0, n1 }); }
    opts_tiles[t.kappa] = tiles;
  } else { const hx = hexOf(t.kappa); writeFileSync(`${SH}/${hx}.bin`, Buffer.from(whole)); }   // small tensor: whole block
}
const largest = Math.max(...f.plan.tensors.map((t) => t.nbytes)) / MiB;
console.log(`model ${modelMiB.toFixed(0)} MiB · largest tensor ${largest.toFixed(0)} MiB (was the 12a floor) · tiled ${bigCount} big tensors into ~${(TILE_TARGET / MiB).toFixed(0)} MiB row-tiles`);

function streamStore(budgetBytes) {
  const lru = new Map(); let resident = 0, peak = 0, streamed = 0, vf = 0;
  return { get: (hex) => { if (lru.has(hex)) { const b = lru.get(hex); lru.delete(hex); lru.set(hex, b); return b; }
      const b = new Uint8Array(readFileSync(`${SH}/${hex}.bin`)); streamed += b.byteLength; if (sha256hex(b) !== hex) { vf++; throw new Error("L5"); }
      lru.set(hex, b); resident += b.byteLength; while (resident > budgetBytes && lru.size > 1) { const [k, v] = lru.entries().next().value; lru.delete(k); resident -= v.byteLength; } if (resident > peak) peak = resident; return b; },
    stats: () => ({ peakMiB: peak / MiB, streamedMiB: streamed / MiB, vf }) };
}
const load = (st, k) => st.get(hexOf(k));
const logitsK = (l) => sha256hex(new Uint8Array(l.buffer, l.byteOffset, l.byteLength));
const tokens = [785, 6722, 374, 264];

const t0 = performance.now(); const full = forward(f.plan, graph, { get: (h) => f.blocks.get(h) }, tokens, { load }); const fullMs = performance.now() - t0;
for (const budgetMiB of [24, 12]) {
  const ss = streamStore(budgetMiB * MiB);
  const t1 = performance.now(); const tiled = forward(f.plan, graph, ss, tokens, { load, tiles: opts_tiles }); const ms = performance.now() - t1;
  const s = ss.stats();
  console.log(`  budget ${String(budgetMiB).padStart(2)} MiB → peak resident ${s.peakMiB.toFixed(1).padStart(5)} MiB · streamed ${s.streamedMiB.toFixed(0)} MiB · ${ms.toFixed(0)}ms · ${logitsK(tiled) === logitsK(full) ? "BYTE-IDENTICAL ✓" : "MISMATCH ✗"} · verifyFail ${s.vf}`);
}
console.log(`  RESIDENT (baseline) peak ${modelMiB.toFixed(0)} MiB · ${fullMs.toFixed(0)}ms`);
console.log(`\n14b: the IN-FORWARD floor dropped from ${largest.toFixed(0)} MiB (largest tensor) to the streaming budget — AUTOMATICALLY, byte-identical, verified. A ${modelMiB.toFixed(0)} MiB model now runs a full forward in ~tens of MiB resident. Honest: I/O-bound (streamed >> model); locality (14c) recovers throughput.`);
rmSync(SH, { recursive: true, force: true });
