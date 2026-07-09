import { writeFileSync } from "node:fs";
import { quantizeRowQ6K } from "./gguf-forge-quantize.mjs";
import { dequantizeExact } from "./gguf-forge-dequant.mjs";
const N = 32, K = 2048, nb = K / 256, BB = 210;
let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff * 2 - 1; };
const rowBytes = nb * BB, bin = new Uint8Array(N * rowBytes);
const y = new Float32Array(N), act = new Float32Array(K);
for (let i = 0; i < K; i++) act[i] = rnd() * 0.1;
for (let n = 0; n < N; n++) {
  const x = new Float32Array(K); for (let i = 0; i < K; i++) x[i] = rnd();
  const q = quantizeRowQ6K(x, K);                 // 1680 bytes
  bin.set(q, n * rowBytes);
  const deq = dequantizeExact(14, q, K); let acc = 0; for (let i = 0; i < K; i++) acc += deq[i] * act[i]; y[n] = acc;
}
writeFileSync("gpu/_qtest/q6k2048.bin", Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength));
writeFileSync("gpu/_qtest/q6k2048.json", JSON.stringify({ ggmlType: 14, N, K, act: [...act], y: [...y] }));
console.log(`wrote q6k2048 fixture: N=${N} K=${K} bytes=${bin.byteLength}`);
