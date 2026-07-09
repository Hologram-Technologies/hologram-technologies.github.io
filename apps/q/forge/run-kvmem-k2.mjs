// K2 greedy-parity — branch a real decode via content-addressed seq_cp + materialize.
// Prefill a prefix into seq 0, seq_cp 0→1 (zero-copy κ-share), materialize seq 1's KV as
// the executor inKV, decode the next token from the SHARED prefix, and prove it equals a
// full from-scratch run. f32 memory → BIT-IDENTICAL (no quant seam). Proves the κ-native
// multi-sequence cache produces correct continuations.
import { readFileSync } from "node:fs";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { KvMemory } from "./gguf-forge-kvmem.mjs";

const f = forgeGguf(new Uint8Array(readFileSync("./.models/qwen2.5-0.5b-instruct-q4_k_m.gguf")));
const graph = synthesizeGraph(f.plan);
const { n_layer: NL, n_head_kv, head_dim } = graph.stats, kvDim = n_head_kv * head_dim;
const cache = new Map(); const load = (store, ref) => { const h = String(ref).split(":").pop(); let b = cache.get(h); if (!b) { b = store.get(h); cache.set(h, b); } return b; };
const store = { get: (h) => f.blocks.get(h) };
const am = (a) => { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; };
const prefix = [785, 6722, 374, 264]; // "The capital of France is"

// 1) prefill the prefix into seq 0, capture its KV
const mem = new KvMemory({ typeK: 0, typeV: 0, nLayer: NL });   // f32 KV → exact parity
const pl = forward(f.plan, graph, store, prefix, { load, memory: mem });
const next = am(pl);
console.log(`prefill prefix (${prefix.length} tok) → next token ${next}; seq0 posMax=${mem.seqPosMax(0)}, ${mem.blocks.size} κ`);

// 2) seq_cp 0→1 (content-addressed share — 0 new κ), materialize as inKV
const before = mem.blocks.size;
mem.seqCp(0, 1);
console.log(`seq_cp 0→1: ${mem.blocks.size === before ? "0 new κ (shared)" : "ADDED " + (mem.blocks.size - before)}`);
const inKV = mem.materialize(1, kvDim);

// 3) decode the next token from the SHARED prefix vs a full from-scratch run
const branch = [...prefix, next];
const fromShared = forward(f.plan, graph, store, branch, { load, inKV });   // decodes pos 4 only
const fromScratch = forward(f.plan, graph, store, branch, { load });        // full run
let maxAbs = 0; for (let i = 0; i < fromShared.length; i++) maxAbs = Math.max(maxAbs, Math.abs(fromShared[i] - fromScratch[i]));
console.log(`\nbranch decode from shared prefix vs full run: argmax ${am(fromShared)} vs ${am(fromScratch)} (${am(fromShared) === am(fromScratch) ? "MATCH" : "DIFF"}); max|Δlogit|=${maxAbs.toExponential(2)}`);
console.log(am(fromShared) === am(fromScratch) && maxAbs === 0
  ? "\n✓ κ-native seq_cp + materialize: branch decode from the SHARED prefix is BIT-IDENTICAL to a full run (multi-sequence works, zero-copy)."
  : "\n(branch differs — investigate)");
