// gen-real-layer-float-oracle.mjs — add a FLOAT-dequant-dot oracle to real-layer.json.
//
// The GPU raw K-quant kernels (MATVECQ4KRAW/Q8RAW/Q6KRAW) do float dequant-dot; the full CPU `forward`
// used integer dot (Q8_K-quantized activation, like llama.cpp) — a different algorithm (the fast-vs-hifi
// two-tier seam, ~1-2% relMax). To prove the GPU KERNELS are correct on real weights, recompute the same
// tensors via float dequant-dot from the exact bin bytes (no re-forge) and store as `expectedFloat`.
import { readFileSync, writeFileSync } from "node:fs";
import { dequantizeExact } from "./gguf-forge-dequant.mjs";

const J = "gpu/_qtest/real-layer.json", B = "gpu/_qtest/real-layer.bin";
const data = JSON.parse(readFileSync(J, "utf8"));
const bin = new Uint8Array(readFileSync(B));
const man = data.manifest, slice = (nm) => bin.subarray(man[nm].off, man[nm].off + man[nm].len);
const silu = (v) => v / (1 + Math.exp(-v));
// float dequant-dot: weight [N][K] (row n at n*K), y[n] = Σ_k deq[n*K+k]·x[k]
const mvFloat = (name, type, N, K, x) => { const deq = dequantizeExact(type, slice(name), N * K); const y = new Float64Array(N); for (let n = 0; n < N; n++) { let s = 0; const b = n * K; for (let k = 0; k < K; k++) s += deq[b + k] * x[k]; y[n] = s; } return y; };

// attn_q (Q4_K)
const aq = data.attnQ;
data.attnQ.expectedFloat = Array.from(mvFloat("attn_q", aq.type, aq.N, aq.K, aq.x));

// MoE float oracle: routed experts (Q4_K gate/up, Q8_0 down) + ungated 2×shared (Q6_K down)
const m = data.moe, D = data.cfg.D, x = m.x, out = new Float64Array(D);
for (let i = 0; i < m.selected.length; i++) {
  const g = mvFloat(`gate_${i}`, m.gateType, m.gateN, m.gateK, x);
  const u = mvFloat(`up_${i}`, m.upType, m.gateN, m.gateK, x);
  const act = g.map((v, j) => silu(v) * u[j]);
  const dn = mvFloat(`down_${i}`, m.downType, m.downN, m.downK, act);
  for (let j = 0; j < D; j++) out[j] += m.weights[i] * dn[j];
}
const sg = mvFloat("sgate", m.sgateType, m.sgateN, m.sgateK, x);
const su = mvFloat("sup", m.supType, m.sgateN, m.sgateK, x);
const sact = sg.map((v, j) => silu(v) * su[j]);
const sh = mvFloat("sdown", m.sdownType, m.sdownN, m.sdownK, sact);
for (let j = 0; j < D; j++) out[j] += sh[j];
data.moe.expectedFloat = Array.from(out);

writeFileSync(J, JSON.stringify(data));
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
console.log(`added float-dequant oracle: attnQ |q|rms ${rms(data.attnQ.expectedFloat).toFixed(4)}, MoE |out|rms ${rms(data.moe.expectedFloat).toFixed(4)}`);
console.log(`(compare: integer-dot expected |out|rms ${rms(data.moe.expected).toFixed(4)})`);
