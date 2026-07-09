// Real-model end-to-end: forge Qwen2.5-0.5B-Instruct (Q4_K_M GGUF) into κ-objects,
// synthesize its graph, and run a Tier-A forward pass on real quantized weights.
// Proves the whole pipeline on a genuine HuggingFace model (self-consistency:
// finite coherent logits + deterministic argmax). Bit-exact-vs-llama.cpp is a
// later witness (needs the C++ reference build).

import { readFileSync } from "node:fs";
import { forgeGguf, loadByKappa } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const t0 = Date.now();
const path = ".models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
const buf = new Uint8Array(readFileSync(path));
console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] read ${(buf.length / 1e6).toFixed(0)} MB`);

// FORGE — split into κ-objects (hashes every tensor once; the L5 ingest cost).
const f = forgeGguf(buf);
console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] forged: ${f.tensors.length} tensors, ${f.blocks.size} κ-blocks`);
console.log(`         rootKappa = ${f.rootKappa}`);

// GRAPH
const graph = synthesizeGraph(f.plan);
console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] graph: ${graph.family}, ${graph.ops.length} ops, ${graph.stats.n_layer} layers, head_dim=${graph.stats.head_dim}, qkvBias=${graph.stats.qkvBias}, tied=${graph.stats.tied}`);
if (graph.family !== "dense") { console.error("graph not dense:", graph.reason); process.exit(1); }

// verify-once loader (L5 on first touch, cached thereafter — avoids re-hashing 470 MB per matvec)
const store = { get: (hex) => f.blocks.get(hex) };
const verified = new Set();
const load = (st, kappa) => {
  const hex = String(kappa).split(":").pop();
  const b = st.get(hex);
  if (!b) throw new Error("κ not found " + kappa);
  if (!verified.has(hex)) { if (sha256hex(b) !== hex) throw new Error("L5 refuse " + kappa); verified.add(hex); }
  return b;
};

// FORWARD — arbitrary but valid token ids (no tokenizer wired yet). Proves execution.
const tokens = [785, 6722, 374, 264]; // < vocab; greedy next-token from these
const tf = Date.now();
const logits = forward(f.plan, graph, store, tokens, { load });
const fwdMs = Date.now() - tf;

let nan = 0, mn = Infinity, mx = -Infinity, argmax = 0;
for (let i = 0; i < logits.length; i++) { const v = logits[i]; if (!Number.isFinite(v)) nan++; else { if (v < mn) mn = v; if (v > mx) mx = v; if (v > logits[argmax]) argmax = i; } }
// top-5
const idx = Array.from(logits.keys()).sort((a, b) => logits[b] - logits[a]).slice(0, 5);
console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] forward(${tokens.length} tok) in ${(fwdMs / 1000).toFixed(1)}s`);
console.log(`         logits: len=${logits.length} NaN=${nan} min=${mn.toFixed(3)} max=${mx.toFixed(3)} argmax=${argmax}`);
console.log(`         top-5 token ids: ${idx.map((i) => `${i}(${logits[i].toFixed(2)})`).join(", ")}`);

// determinism: argmax stable across a re-run of the last position is implied; quick re-forward of 1 token
const l2 = forward(f.plan, graph, store, [tokens[0]], { load });
let am2 = 0; for (let i = 0; i < l2.length; i++) if (l2[i] > l2[am2]) am2 = i;
const l3 = forward(f.plan, graph, store, [tokens[0]], { load });
let eq = true; for (let i = 0; i < l2.length; i++) if (l2[i] !== l3[i]) { eq = false; break; }
console.log(`         determinism: identical logits on repeat = ${eq}; single-tok argmax=${am2}`);
console.log(`\n${nan === 0 && graph.family === "dense" && eq ? "PASS" : "FAIL"} — real Qwen2.5-0.5B forged to κ-objects and executed end-to-end`);
