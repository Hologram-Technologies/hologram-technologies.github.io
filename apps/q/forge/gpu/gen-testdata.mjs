// Generate deterministic Q5_0 GEMV test data + the CPU-oracle expected output,
// for the in-browser WGSL kernel witness. Writes _testdata.json into this dir
// (served to the browser). Expected uses the REAL oracle (dequantQ5_0), so the
// GPU kernel is checked against the same dequant llama.cpp parity rests on.

import { writeFileSync } from "node:fs";
import { dequantQ5_0 } from "../gguf-forge-dequant.mjs";
import { f16ToF32 } from "../../qvac-ingest.mjs";

const N = 8, K = 256, nb = K / 32;          // 8 output rows, 256 inputs
function prng(s) { s >>>= 0; return () => (s = (s * 1664525 + 1013904223) >>> 0); }
const r = prng(0x5eed);

// random Q5_0 weight bytes (N rows × nb blocks × 22 B), f16 exp sanitized (no Inf/NaN)
const wbytes = new Uint8Array(N * nb * 22);
for (let i = 0; i < wbytes.length; i++) wbytes[i] = r() & 0xff;
for (let blk = 0; blk < N * nb; blk++) wbytes[blk * 22 + 1] &= 0xbf;

// activation
const act = new Float32Array(K);
for (let i = 0; i < K; i++) act[i] = ((r() / 4294967296) * 2 - 1) * 2;

// unpack each row's Q5_0 blocks → f32 scales + signed int8 quants (lossless)
const scales = new Float32Array(N * nb), quants = new Int8Array(N * K);
const dv = new DataView(wbytes.buffer);
for (let row = 0; row < N; row++) {
  for (let b = 0; b < nb; b++) {
    const bp = (row * nb + b) * 22, qs = bp + 6;
    scales[row * nb + b] = f16ToF32(dv.getUint16(bp, true));
    const qh = dv.getUint32(bp + 2, true);
    for (let j = 0; j < 16; j++) {
      const xh0 = ((qh & (1 << j)) >>> j) << 4;
      const xh1 = (qh & (1 << (j + 16))) >>> (j + 12);
      quants[row * K + b * 32 + j] = ((wbytes[qs + j] & 0x0f) | xh0) - 16;
      quants[row * K + b * 32 + 16 + j] = ((wbytes[qs + j] >> 4) | xh1) - 16;
    }
  }
}

// oracle expected: Σ dequant(weight_row)[k] * act[k]  (f64 accumulation)
const expected = new Array(N);
for (let row = 0; row < N; row++) {
  const w = dequantQ5_0(wbytes.subarray(row * nb * 22, (row + 1) * nb * 22), K);
  let s = 0; for (let k = 0; k < K; k++) s += w[k] * act[k];
  expected[row] = s;
}

writeFileSync(new URL("./_testdata.json", import.meta.url), JSON.stringify({
  N, K, scales: [...scales], quants: [...quants], act: [...act], expected,
}));
console.log(`wrote _testdata.json: N=${N} K=${K}, expected[0..2]=${expected.slice(0, 3).map((x) => x.toFixed(4))}`);
