// TurboQuant KV-plane DECODE test data (PQ4_0, d=128). Encode random KV vectors with the
// κ-native codec (per-head rotate → quant), and dump the blocks + rotation signs + the CPU
// oracle DECODE (tqDecodeKV = dequant + inverse Hadamard rotation). The GPU kernel must
// reproduce the decode in-shader (codebook dequant + Fast Walsh-Hadamard + ×signs/√d).
import { writeFileSync } from "node:fs";
import { tqEncodeKV, tqDecodeKV, rotationSigns, TQ_TYPES } from "./gguf-forge-turboquant.mjs";

const TYPE = 48, d = TQ_TYPES[TYPE].d, nb = 4, n = d * nb;   // PQ4_0, 4 blocks
let s = 7777771 >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = r() * 1.3;

const bytes = tqEncodeKV(TYPE, x);            // rotate per d-block + quant
const expected = tqDecodeKV(TYPE, bytes, n);  // dequant + inverse-rotate (oracle)
const signs = Array.from(rotationSigns(d));   // ±1 diagonal (seed 42 for d=128)

writeFileSync(new URL("./gpu/_turbokv_data.json", import.meta.url),
  JSON.stringify({ type: TYPE, d, nb, n, total: TQ_TYPES[TYPE].total, bytes: Array.from(bytes), signs, expected: Array.from(expected) }));
console.log(`wrote gpu/_turbokv_data.json: PQ4_0 KV decode, ${nb}×${d}, ${bytes.length} bytes`);
