// m13b-moe.mjs — ROUTED-EXPERT STREAMING (the huge-model lever), mechanism proof on a MoE CONSTRUCTED
// FROM REAL TENSORS. LABELED: the "experts" are real per-layer ffn_down weights of qwen2.5-0.5b assembled
// into an E-expert stack — NOT a trained MoE. What's proven is the DATA-PLANE mechanism: with a per-expert
// κ directory, only the router-selected k experts are FETCHED + VERIFIED per token; the inactive E−k never
// load. Output byte-identical to computing over all E (dense combine). => a model with E experts runs
// holding only k. Combine with 13a tiling → resident = one tile of one expert.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { forgeGguf } from "./gguf-forge.mjs";
import { matvec } from "./gguf-forge-exec.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const MODEL = ".models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
const DIR = "C:/Users/pavel/AppData/Local/Temp/claude/C--Users-pavel-Desktop-HOLOGRAM/9be01320-de05-4b56-a1ab-35f38d512e16/scratchpad/_m13moe";
const MiB = 1024 * 1024, hexOf = (k) => String(k).split(":").pop();

const f = forgeGguf(new Uint8Array(readFileSync(MODEL)));
// take real ffn_down weights from distinct layers as "experts" (identical shape/type = a valid expert stack)
const allFfn = f.plan.tensors.filter((t) => /ffn_down\.weight$/.test(t.name));
const ref = allFfn[0];   // uniform expert stack: identical dims + quant type (Q4_K_M mixes types across layers)
const experts = allFfn.filter((t) => t.type === ref.type && t.dims[0] === ref.dims[0] && (t.dims[1] || 1) === (ref.dims[1] || 1)).slice(0, 8);
const E = experts.length, w0 = experts[0], K = w0.dims[0], N = w0.dims.length > 1 ? w0.dims[1] : 1;
const expertMiB = w0.nbytes / MiB;
console.log(`CONSTRUCTED MoE (LABELED: real per-layer ffn_down weights as experts, NOT a trained MoE)`);
console.log(`  E=${E} experts, each ${w0.dims.join("x")} ${w0.typeName} = ${expertMiB.toFixed(1)} MiB; full expert stack = ${(E * expertMiB).toFixed(0)} MiB`);

// per-expert κ directory on disk (verified on read) — the sparse-fetch substrate
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const expertHex = experts.map((e) => { const b = f.blocks.get(hexOf(e.kappa)); const hex = sha256hex(b); writeFileSync(`${DIR}/${hex}.bin`, Buffer.from(b)); return hex; });

const x = new Float32Array(K); for (let i = 0; i < K; i++) x[i] = Math.sin(i * 0.013) * 0.4;
// router: deterministic gate scores → top-k experts + softmax combine weights (values arbitrary; the point is WHICH load)
const K_ACTIVE = 2;
const scores = experts.map((_, e) => Math.sin(e * 1.7 + 0.3));
const order = [...scores.keys()].sort((a, b) => scores[b] - scores[a]);
const sel = order.slice(0, K_ACTIVE);
const sm = sel.map((e) => Math.exp(scores[e])); const smSum = sm.reduce((a, b) => a + b, 0); const g = sel.map((_, i) => sm[i] / smSum);
console.log(`  router: top-${K_ACTIVE} of ${E} → experts [${sel.join(",")}] (combine weights ${g.map((v) => v.toFixed(3)).join(",")})`);

let loadReads = 0;
const loadVerified = (hex) => { const b = new Uint8Array(readFileSync(`${DIR}/${hex}.bin`)); loadReads++; if (sha256hex(b) !== hex) throw new Error("L5 expert refuse"); return b; };
const expertOut = (e) => { const b = loadVerified(expertHex[e]); return matvec({ get: () => b }, { kappa: "sha256:" + expertHex[e], dims: w0.dims, type: w0.type }, x, (st) => st.get()); };

// SPARSE (routed): fetch + verify + compute ONLY the k selected experts
loadReads = 0; let t0 = performance.now();
const ySparse = new Float32Array(N);
for (let i = 0; i < sel.length; i++) { const ye = expertOut(sel[i]); for (let n = 0; n < N; n++) ySparse[n] += g[i] * ye[n]; }
const sparseMs = performance.now() - t0, sparseReads = loadReads;

// DENSE (load ALL E, combine the same selected k) — the reference; must match byte-for-byte
loadReads = 0; t0 = performance.now();
const yDense = new Float32Array(N); const outCache = experts.map((_, e) => expertOut(e));   // loads all E
for (let i = 0; i < sel.length; i++) { const ye = outCache[sel[i]]; for (let n = 0; n < N; n++) yDense[n] += g[i] * ye[n]; }
const denseMs = performance.now() - t0, denseReads = loadReads;

const kb = (f32) => new Uint8Array(f32.buffer);
const eq = (a, b) => { const A = kb(a), B = kb(b); for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return false; return true; };
console.log(`\n              experts loaded   bytes fetched   peak resident   time     output`);
console.log(`  DENSE (all)      ${String(denseReads).padStart(2)}/${E}          ${(E * expertMiB).toFixed(0).padStart(4)} MiB       ${expertMiB.toFixed(1)} MiB      ${denseMs.toFixed(0).padStart(4)}ms   (reference)`);
console.log(`  ROUTED (sparse)  ${String(sparseReads).padStart(2)}/${E}          ${(K_ACTIVE * expertMiB).toFixed(0).padStart(4)} MiB       ${expertMiB.toFixed(1)} MiB      ${sparseMs.toFixed(0).padStart(4)}ms   ${eq(ySparse, yDense) ? "BYTE-IDENTICAL ✓" : "MISMATCH ✗"}`);
console.log(`  → routed loads ${K_ACTIVE}/${E} experts (${(100 * K_ACTIVE / E).toFixed(0)}%); inactive ${E - K_ACTIVE} never fetched. Peak resident = 1 expert (streamed one-at-a-time), or 1 TILE with 13a tiling.`);

console.log(`\nEXTRAPOLATION (labeled estimate — real large MoE, k active of E total):`);
for (const [name, Et, kt, esz] of [["Mixtral-8x7B", 8, 2, 176], ["a 128-expert MoE", 128, 8, 44], ["GLM-class 744B", 160, 8, 300]]) {
  console.log(`  ${name.padEnd(18)}: load ${kt}/${Et} experts/token = ${(100 * kt / Et).toFixed(1)}% of experts; resident = ${kt} experts (${(kt * esz)} MiB) or ~1 TILE with 13a — a fraction of the model, verified.`);
}
console.log(`\nHONEST: constructed MoE (real weights, not trained routing) proves the FETCH mechanism only. Cost: still I/O-bound (fetch k experts/token); locality (13c: cache hot experts + prewarm next) recovers it. Full fidelity, no compression.`);
rmSync(DIR, { recursive: true, force: true });
