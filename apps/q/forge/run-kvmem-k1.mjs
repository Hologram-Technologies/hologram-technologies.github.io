// K1 greedy-parity — run the REAL Qwen2.5-0.5B with quantized (q8_0) KV vs f32 KV.
// The κ-native KV memory quantizes every K/V vector to a content-addressed κ-block;
// the contract is greedy-token PARITY within tolerance (quantized KV is lossy).
import { readFileSync } from "node:fs";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { KvMemory } from "./gguf-forge-kvmem.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";

const f = forgeGguf(new Uint8Array(readFileSync("./.models/qwen2.5-0.5b-instruct-q4_k_m.gguf")));
const graph = synthesizeGraph(f.plan);
const NL = graph.stats.n_layer;
const cache = new Map(); const load = (store, ref) => { const h = String(ref).split(":").pop(); let b = cache.get(h); if (!b) { b = store.get(h); cache.set(h, b); } return b; };
const store = { get: (h) => f.blocks.get(h) };
const tokens = [785, 6722, 374, 264]; // "The capital of France is"
const am = (a) => { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; };

function run(label, mem) {
  const t = Date.now();
  const logits = forward(f.plan, graph, store, tokens, { load, memory: mem });
  const a = am(logits);
  console.log(`  ${label}: argmax=${a} logit=${logits[a].toFixed(4)}${mem ? ` | KV ${(mem.bytes / 1024).toFixed(0)}KB (${mem.blocks.size} κ)` : ""} (${((Date.now() - t) / 1000).toFixed(0)}s)`);
  return { a, logits };
}

console.log(`Qwen2.5-0.5B, ${NL} layers — KV-quant parity:`);
const base = run("f32 KV  ", null);
const q8 = run("q8_0 KV ", new KvMemory({ typeK: GGML.Q8_0, typeV: GGML.Q8_0, nLayer: NL }));

let maxAbs = 0, cos = 0, na = 0, nb = 0; for (let i = 0; i < base.logits.length; i++) { maxAbs = Math.max(maxAbs, Math.abs(base.logits[i] - q8.logits[i])); cos += base.logits[i] * q8.logits[i]; na += base.logits[i] ** 2; nb += q8.logits[i] ** 2; }
console.log(`\nargmax: ${base.a === q8.a ? "MATCH (" + base.a + ")" : base.a + " vs " + q8.a}; max|Δlogit|=${maxAbs.toFixed(4)}; cos=${(cos / Math.sqrt(na * nb)).toFixed(6)}`);
console.log(base.a === q8.a ? "\n✓ quantized (q8_0) κ-native KV gives greedy-token PARITY with f32 KV on the real model." : "\n(argmax differs — KV quant too lossy / bug)");
