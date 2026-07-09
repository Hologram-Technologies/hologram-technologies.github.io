// In-shader ENCODE test data (PQ4_0, d=128): random K vectors + the CPU oracle tqEncodeKV
// bytes (rotate → stage-1 quant). The GPU kernel reproduces the bytes; a single thread per
// block keeps the Hadamard FHT + norm reductions in the same sequential f32 order as the CPU,
// so it can match bit-for-bit. Output is read back per-block and compared to tqEncodeKV.
import { writeFileSync } from "node:fs";
import { tqEncodeKV, rotationSigns, TQ_TYPES } from "./gguf-forge-turboquant.mjs";

const TYPE = 48, d = TQ_TYPES[TYPE].d, total = TQ_TYPES[TYPE].total, nb = 5, n = d * nb; // PQ4_0
let s = 0x1234 >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = r() * (0.4 + (i % 6) * 0.3);

const expected = []; // per-block 66-byte tqEncodeKV output
for (let b = 0; b < nb; b++) { const blk = tqEncodeKV(TYPE, x.subarray(b * d, b * d + d)); expected.push(Array.from(blk)); }
// codebook midpoint boundaries (exact fround values — uploaded so the GPU uses the SAME f32)
const CB = [-0.23762692286887249, -0.18079342531272283, -0.14176134070424901, -0.11024676790280842, -0.08279230816984559, -0.05774433563409530, -0.03413390187425037, -0.01129645493594766, 0.01129645493594766, 0.03413390187425037, 0.05774433563409530, 0.08279230816984559, 0.11024676790280842, 0.14176134070424901, 0.18079342531272283, 0.23762692286887249];
const boundaries = []; for (let i = 0; i < 15; i++) boundaries.push(Math.fround((CB[i] + CB[i + 1]) * 0.5));
writeFileSync(new URL("./gpu/_turboenc_data.json", import.meta.url),
  JSON.stringify({ d, nb, n, total, x: Array.from(x), signs: Array.from(rotationSigns(d)), boundaries, expected }));
console.log(`wrote gpu/_turboenc_data.json: PQ4_0 encode, ${nb}×${d}`);
