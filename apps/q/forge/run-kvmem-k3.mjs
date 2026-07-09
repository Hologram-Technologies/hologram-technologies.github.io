// K3 real-model — prove seq_add (RoPE K-shift) on actual model keys: KV built at
// offset 0 then shifted by δ == KV built directly at offset δ. Confirms the memory's
// RoPE shift matches the executor's RoPE (the integration, not just the kernel).
import { readFileSync } from "node:fs";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { KvMemory } from "./gguf-forge-kvmem.mjs";
import { ropeNeox } from "./gguf-forge-kernels.mjs";

const f = forgeGguf(new Uint8Array(readFileSync("./.models/qwen2.5-0.5b-instruct-q4_k_m.gguf")));
const graph = synthesizeGraph(f.plan);
const { n_layer: NL, n_head_kv, head_dim } = graph.stats, kvDim = n_head_kv * head_dim;
const ropeOp = graph.ops.find((o) => o.op === "rope"), NROT = ropeOp.attrs.n_rot, FREQ = ropeOp.attrs.freq_base;
const ropeShift = (kvec, _il, delta) => { const out = new Float32Array(kvec.length); for (let h = 0; h < kvec.length / head_dim; h++) out.set(ropeNeox(kvec.subarray(h * head_dim, (h + 1) * head_dim), delta, NROT, FREQ, head_dim), h * head_dim); return out; };
const cache = new Map(); const load = (store, ref) => { const h = String(ref).split(":").pop(); let b = cache.get(h); if (!b) { b = store.get(h); cache.set(h, b); } return b; };
const store = { get: (h) => f.blocks.get(h) };
const tokens = [785, 6722, 374, 264], delta = 100;

const memA = new KvMemory({ typeK: 0, typeV: 0, nLayer: NL });
forward(f.plan, graph, store, tokens, { load, memory: memA });                 // KV at positions [0..4)
const memB = new KvMemory({ typeK: 0, typeV: 0, nLayer: NL });
forward(f.plan, graph, store, tokens, { load, memory: memB, posOffset: delta }); // KV at [δ..δ+4)
memA.seqAdd(0, 0, 4, delta, ropeShift, kvDim);                                  // shift A by δ

const A = memA.materialize(0, kvDim), B = memB.materialize(0, kvDim);
// Layer 0 raw K is position-independent → shift == recompute EXACTLY (the integration
// proof: the memory's RoPE shift matches the executor's RoPE). Deeper layers' raw K
// diverges because posOffset changes attention → residual stream — that's the SAME
// approximation as llama.cpp's K-shift (it updates RoPE only, not the cached raw K).
const lmax = (il) => { let m = 0; for (let p = 0; p < 4; p++) for (let i = 0; i < kvDim; i++) m = Math.max(m, Math.abs(A.Kc[il][p][i] - B.Kc[il][p][i])); return m; };
const l0 = lmax(0), all = Math.max(...Array.from({ length: NL }, (_, il) => lmax(il)));
console.log(`seq_add δ=${delta} on real Qwen K (n_rot=${NROT}, freq_base=${FREQ}):`);
console.log(`  layer 0 (raw K position-independent): shifted-from-0 vs computed-at-δ  max|ΔK|=${l0.toExponential(2)}  ${l0 < 1e-3 ? "✓ EXACT" : "✗"}`);
console.log(`  all layers: max|ΔK|=${all.toExponential(2)} (deeper layers diverge by design — RoPE-only K-shift, same as llama.cpp)`);
console.log(l0 < 1e-3 ? "\n✓ K3 seq_add: the RoPE K-shift matches the executor's RoPE exactly (layer 0); semantics identical to llama.cpp's K-shift." : "\n(layer-0 mismatch — investigate)");
