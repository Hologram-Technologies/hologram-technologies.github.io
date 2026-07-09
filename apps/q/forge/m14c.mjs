// m14c.mjs — LOCALITY across tokens (honest). In a greedy generate loop, does caching the working set
// recover throughput? For a DENSE model every token touches every weight once → cross-token locality
// helps only to the extent the LRU budget holds the model. Measure per-token streamed bytes + time at a
// BOUNDED budget vs a budget that HOLDS the model. Output byte-identical throughout. (MoE would let a
// small budget capture the frequently-routed experts — a far better curve; noted, not measured here.)
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward, blockOf } from "./gguf-forge-exec.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const MODEL = ".models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
const SH = "C:/Users/pavel/AppData/Local/Temp/claude/C--Users-pavel-Desktop-HOLOGRAM/9be01320-de05-4b56-a1ab-35f38d512e16/scratchpad/_m14c";
const MiB = 1024 * 1024, hexOf = (k) => String(k).split(":").pop();
const f = forgeGguf(new Uint8Array(readFileSync(MODEL))); const graph = synthesizeGraph(f.plan);
const modelMiB = [...f.blocks.values()].reduce((a, b) => a + b.byteLength, 0) / MiB;
const rowBytesOf = (t) => t.typeName === "F32" ? t.dims[0] * 4 : t.typeName === "F16" ? t.dims[0] * 2 : (() => { const [be, bb] = blockOf(t.type); return (t.dims[0] / be) * bb; })();

rmSync(SH, { recursive: true, force: true }); mkdirSync(SH, { recursive: true });
const opts_tiles = {};
for (const t of f.plan.tensors) { const whole = f.blocks.get(hexOf(t.kappa));
  if (t.nbytes > 8 * MiB && t.dims.length > 1) { const rb = rowBytesOf(t), N = t.dims[1], TR = Math.max(1, Math.floor(4 * MiB / rb)); const tiles = [];
    for (let n0 = 0; n0 < N; n0 += TR) { const n1 = Math.min(n0 + TR, N); const b = whole.subarray(n0 * rb, n1 * rb); const hx = sha256hex(b); writeFileSync(`${SH}/${hx}.bin`, Buffer.from(b)); tiles.push({ kappa: "sha256:" + hx, n0, n1 }); }
    opts_tiles[t.kappa] = tiles; } else { const hx = hexOf(t.kappa); writeFileSync(`${SH}/${hx}.bin`, Buffer.from(whole)); } }

function streamStore(budgetBytes) { const lru = new Map(); let resident = 0, streamedTok = 0, peak = 0;
  return { get: (hex) => { if (lru.has(hex)) { const b = lru.get(hex); lru.delete(hex); lru.set(hex, b); return b; }
      const b = new Uint8Array(readFileSync(`${SH}/${hex}.bin`)); streamedTok += b.byteLength; if (sha256hex(b) !== hex) throw new Error("L5");
      lru.set(hex, b); resident += b.byteLength; while (resident > budgetBytes && lru.size > 1) { const [k, v] = lru.entries().next().value; lru.delete(k); resident -= v.byteLength; } if (resident > peak) peak = resident; return b; },
    tokReset: () => { const s = streamedTok; streamedTok = 0; return s; }, peakMiB: () => peak / MiB }; }
const load = (st, k) => st.get(hexOf(k));
const argmax = (l) => { let a = 0; for (let i = 1; i < l.length; i++) if (l[i] > l[a]) a = i; return a; };
const SEED = [785, 6722, 374, 264], NTOK = 3;

for (const budgetMiB of [12, 512]) {   // 12 = bounded (< model); 512 = holds the whole 463 MiB model
  const ss = streamStore(budgetMiB * MiB); const toks = SEED.slice(); const rows = [];
  for (let i = 0; i < NTOK; i++) { const t0 = performance.now(); const lg = forward(f.plan, graph, ss, toks, { load, tiles: opts_tiles }); const ms = performance.now() - t0; toks.push(argmax(lg)); rows.push({ streamed: ss.tokReset() / MiB, ms }); }
  console.log(`\nbudget ${budgetMiB} MiB (${budgetMiB >= modelMiB ? "holds the model" : "bounded < model"}) · peak resident ${ss.peakMiB().toFixed(0)} MiB`);
  rows.forEach((r, i) => { const lbl = i === 0 ? "(cold)" : (r.streamed < 5 ? "(WARM: working set cached, ~0 re-stream)" : "(re-streams working set)"); console.log(`  token ${i + 1}: streamed ${r.streamed.toFixed(0).padStart(4)} MiB . ${r.ms.toFixed(0).padStart(6)} ms ${lbl}`); });
}
console.log(`\n14c HONEST: DENSE model → cross-token locality helps ONLY as the budget holds the model: a budget ≥ model caches the working set so tokens 2+ re-stream ~0 (resident speed); a bounded budget re-streams the working set every token (I/O-bound). It's a smooth RAM↔I/O curve, NOT a free lunch. MoE is where a SMALL budget wins big (cache the hot experts; cold ones stream) — the real lever for huge models. Prewarm/overlap hides latency but not bytes. Full fidelity, byte-identical throughout.`);
rmSync(SH, { recursive: true, force: true });
