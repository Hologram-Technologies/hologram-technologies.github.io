// Generate TQ2_0 GPU-kernel test data: quantize random vectors with OUR (ggml-bit-exact)
// quantizer, dump the verbatim block bytes + the CPU-oracle dequant floats. The WGSL
// kernel in gpu/bitnet-gpu.html must reproduce the oracle from the SAME bytes (cosine=1).
import { writeFileSync } from "node:fs";
import { quantizeRowTq2_0 } from "./gguf-forge-quantize.mjs";
import { dequantizeExact, GGML } from "./gguf-forge-dequant.mjs";

const nb = 5, n = 256 * nb;                 // 5 TQ2_0 superblocks
const x = new Float32Array(n);
let s = 123456789 >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
for (let i = 0; i < n; i++) x[i] = rnd() * (0.5 + (i % 6) * 0.3);

const bytes = quantizeRowTq2_0(x, n);                    // nb*66 bytes
const expected = dequantizeExact(GGML.TQ2_0, bytes, n);  // CPU oracle (bit-exact vs ggml)

writeFileSync(new URL("./gpu/_bitnet_data.json", import.meta.url),
  JSON.stringify({ nb, n, bytes: Array.from(bytes), expected: Array.from(expected) }));
console.log(`wrote gpu/_bitnet_data.json: ${nb} blocks, ${bytes.length} bytes, ${n} floats`);
