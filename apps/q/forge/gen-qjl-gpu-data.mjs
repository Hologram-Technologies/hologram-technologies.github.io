// GPU QJL-correction kernel test data. Encode N TBQ4_0 K-vectors, pick a correlated query,
// forward-rotate it (R·q = tqRotate), and dump: the per-block QJL sidecars (bits + d_r), the
// QJL sketch signs, R·q, and the CPU-oracle correction per block (qjlDotCorrection). The WGSL
// kernel projects R·q (×qjl_signs + FHT) and sums signs → must match the oracle corrections.
import { writeFileSync } from "node:fs";
import { tqEncodeKV, tqRotate, qjlDotCorrection, qjlSketchSigns, TQ_TYPES } from "./gguf-forge-turboquant.mjs";
import { f16ToF32 } from "../qvac-ingest.mjs";

const TYPE = 43, t = TQ_TYPES[TYPE], d = t.d, N = 8;     // TBQ4_0, d=128, 8 cached positions
let s = 0x5151 >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };

// a query, forward-rotated (shared across positions)
const q = Float32Array.from({ length: d }, () => r());
const Rq = tqRotate(q, d);

// N TBQ K-blocks; export their qjl bitfields + d_r, and the oracle correction per block
const qjlBits = [], dr = [], expected = [];
for (let p = 0; p < N; p++) {
  const k = Float32Array.from({ length: d }, () => q[0] * 0 + r() * 1.0); // independent keys
  const blk = tqEncodeKV(TYPE, k);
  qjlBits.push(Array.from(blk.subarray(t.idx + 2, t.idx + 2 + t.qjl)));   // 16 bytes
  dr.push(f16ToF32(blk[t.idx + 2 + t.qjl] | (blk[t.idx + 2 + t.qjl + 1] << 8)));
  expected.push(qjlDotCorrection(blk, t.idx + 2, dr[p], Rq, d));
}
writeFileSync(new URL("./gpu/_qjl_data.json", import.meta.url), JSON.stringify({
  d, N, qjlBytes: t.qjl, Rq: Array.from(Rq), qjlSigns: Array.from(qjlSketchSigns(d)),
  qjlBits, dr, expected,
}));
console.log(`wrote gpu/_qjl_data.json: TBQ4_0 QJL correction, d=${d}, ${N} blocks`);
