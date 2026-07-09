import { writeFileSync } from "node:fs";
import { quantizeRowQ4K, quantizeRowQ8_0 } from "./gguf-forge-quantize.mjs";
import { dequantizeExact } from "./gguf-forge-dequant.mjs";
let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff * 2 - 1; };
function gen(tag, type, quant, bpb, K) {
  const N = 32, nb = K / (bpb === 34 ? 32 : 256), rowBytes = nb * bpb;
  const bin = new Uint8Array(N * rowBytes), y = new Float32Array(N), act = new Float32Array(K);
  for (let i = 0; i < K; i++) act[i] = rnd() * 0.1;
  for (let n = 0; n < N; n++) {
    const x = new Float32Array(K); for (let i = 0; i < K; i++) x[i] = rnd();
    const q = quant(x, K); bin.set(q, n * rowBytes);
    const deq = dequantizeExact(type, q, K); let acc = 0; for (let i = 0; i < K; i++) acc += deq[i] * act[i]; y[n] = acc;
  }
  writeFileSync(`gpu/_qtest/${tag}.bin`, Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength));
  writeFileSync(`gpu/_qtest/${tag}.json`, JSON.stringify({ ggmlType: type, N, K, act: [...act], y: [...y] }));
  console.log(`${tag}: type=${type} N=${N} K=${K} nb=${nb} bytes=${bin.byteLength}`);
}
gen("q4k2048", 12, quantizeRowQ4K, 144, 2048);   // Q4_K, attn + gate/up experts
gen("q8_1408", 8, quantizeRowQ8_0, 34, 1408);     // Q8_0, down experts
