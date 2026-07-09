// TQ2_0 in-shader GEMV test data: a weight matrix [N×K] with each ROW TQ2_0-quantized
// (ggml-bit-exact), an activation x[K], and the oracle y[n]=Σ_k dequant(W[n])[k]·x[k]
// computed via the CPU dequant oracle. The WGSL GEMV dequant-and-accumulates from the
// same verbatim κ-block bytes → must match (cosine≈1; float reduction ≠ bit-exact).
import { writeFileSync } from "node:fs";
import { quantizeRowTq2_0 } from "./gguf-forge-quantize.mjs";
import { dequantizeExact, GGML } from "./gguf-forge-dequant.mjs";

const N = 6, K = 512, blocksPerRow = K / 256;            // 2 TQ2_0 blocks per row
let s = 424242 >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
const rowBytes = blocksPerRow * 66, bytes = new Uint8Array(N * rowBytes);
const expected = new Float32Array(N);
const x = new Float32Array(K); for (let k = 0; k < K; k++) x[k] = rnd() * 1.2;

for (let n = 0; n < N; n++) {
  const w = new Float32Array(K); for (let k = 0; k < K; k++) w[k] = rnd() * (0.5 + (k % 4) * 0.4);
  const qb = quantizeRowTq2_0(w, K); bytes.set(qb, n * rowBytes);
  const wd = dequantizeExact(GGML.TQ2_0, qb, K);          // dequant the row (oracle)
  let acc = 0; for (let k = 0; k < K; k++) acc += wd[k] * x[k]; expected[n] = acc;
}
writeFileSync(new URL("./gpu/_bitgemv_data.json", import.meta.url),
  JSON.stringify({ N, K, blocksPerRow, rowBytes, bytes: Array.from(bytes), x: Array.from(x), expected: Array.from(expected) }));
console.log(`wrote gpu/_bitgemv_data.json: ${N}×${K} TQ2_0 GEMV (${bytes.length} weight bytes)`);
