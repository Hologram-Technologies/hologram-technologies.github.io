// S3 CPU witness: the QJL Stage-2 dot-correction (TurboQuant TBQ types) recovers the inner
// product lost to stage-1 quantization. For a TBQ-quantized K and a query q, the corrected
// score (base dot + qjl_dot_correction) must be substantially CLOSER to the true <q,k> than
// the uncorrected base. This is the TBQ accuracy benefit PQ types don't have. Authority =
// the true f64 inner product; the kernels themselves are bit-exact vs ggml (turboquant 16/16).
import assert from "node:assert";
import { tqEncodeKV, tqDecodeKV, tqRotate, qjlDotCorrection, TQ_TYPES } from "./gguf-forge-turboquant.mjs";
import { f16ToF32 } from "../qvac-ingest.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// per TBQ type: encode random K, score a CORRELATED query (q = k + noise — the real
// attention regime where a token attends to similar keys). Stage-1 quant systematically
// UNDERESTIMATES such dots; QJL is an unbiased estimator that removes that bias.
for (const [id, t] of [["43", TQ_TYPES[43]], ["45", TQ_TYPES[45]]]) { // TBQ4_0 (d128), TBQ4_0_64 (d64)
  const typeId = Number(id), d = t.d, N = 300, r = rng(0xc0de + typeId);
  let baseBias = 0, corrBias = 0, baseErr = 0, corrErr = 0;
  for (let n = 0; n < N; n++) {
    const k = new Float32Array(d), q = new Float32Array(d);
    for (let i = 0; i < d; i++) { k[i] = r() * 1.0; q[i] = k[i] + r() * 0.5; } // correlated query
    const blk = tqEncodeKV(typeId, k);
    const trueDot = dot(q, k);
    const decoded = tqDecodeKV(typeId, blk, d);        // dequant + inverse-rotate (original space)
    const base = dot(q, decoded);                      // uncorrected score (= rotated-space base)
    const d_r = f16ToF32(blk[t.idx + 2 + t.qjl] | (blk[t.idx + 2 + t.qjl + 1] << 8)); // d_r after qjl bitfield
    const Rq = tqRotate(q, d);                          // stage-1-rotated query (R·q)
    const corr = qjlDotCorrection(blk, t.idx + 2, d_r, Rq, d);
    baseBias += base - trueDot; corrBias += (base + corr) - trueDot;
    baseErr += Math.abs(base - trueDot); corrErr += Math.abs(base + corr - trueDot);
  }
  baseBias /= N; corrBias /= N; baseErr /= N; corrErr /= N;
  // QJL is UNBIASED: base systematically underestimates (mean signed error < 0), the
  // corrected mean signed error is ~0 — and mean |error| drops too.
  ok(baseBias < -0.05 && Math.abs(corrBias) < Math.abs(baseBias) * 0.4,
     `${t.name.padEnd(9)} QJL removes the bias: mean signed err ${baseBias.toFixed(4)} → ${corrBias.toFixed(4)}`);
  ok(corrErr < baseErr, `${t.name.padEnd(9)} QJL reduces mean |score−true|: ${baseErr.toFixed(4)} → ${corrErr.toFixed(4)} (${(baseErr / corrErr).toFixed(2)}×)`);
}

// determinism + zero-residual edge (d_r≈0 → correction 0)
{
  const d = 128, blk = tqEncodeKV(43, new Float32Array(d)); // all-zero K → zero residual
  const d_r = f16ToF32(blk[64 + 2 + 16] | (blk[64 + 2 + 16 + 1] << 8));
  const q = Float32Array.from({ length: d }, (_, i) => (i % 5) - 2);
  const c1 = qjlDotCorrection(blk, 66, d_r, tqRotate(q, d), d), c2 = qjlDotCorrection(blk, 66, d_r, tqRotate(q, d), d);
  ok(c1 === c2, `correction is deterministic`);
  ok(c1 === 0, `zero-residual block → zero correction (d_r=${d_r})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
