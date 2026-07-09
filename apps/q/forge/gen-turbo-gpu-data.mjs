// TurboQuant PQ4_0 GPU-kernel test data: quantize random vectors (ggml-bit-exact) and
// dump block bytes + the CPU-oracle to_float dequant. The WGSL kernel reproduces the
// codebook×norm dequant from the same bytes (cosine=1). PQ4_0: block 66 B = qs[64] nibbles
// (2 codebook indices/byte) + f16 d at offset 64; codebook = TQ4_CODEBOOK_128 (16 entries).
import { writeFileSync } from "node:fs";
import { tqQuant, tqDequant } from "./gguf-forge-turboquant.mjs";

const TYPE = 48, d = 128, nb = 5, n = d * nb;   // PQ4_0
let s = 987654321 >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = rnd() * (0.4 + (i % 7) * 0.25);

const bytes = tqQuant(TYPE, x, n), expected = tqDequant(TYPE, bytes, n);
writeFileSync(new URL("./gpu/_turbo_data.json", import.meta.url),
  JSON.stringify({ type: TYPE, d, nb, n, bytes: Array.from(bytes), expected: Array.from(expected) }));
console.log(`wrote gpu/_turbo_data.json: PQ4_0 ${nb} blocks, ${bytes.length} bytes, ${n} floats`);
