// quant-floor-eval.mjs — C: make "4-bit is the floor for POST-HOC quant" reproducible instead of asserted.
// It measures the per-bit-width reconstruction error of naive symmetric per-block quantization (GGUF-style
// 32-wide blocks, absmax scale) on a realistic weight distribution, and shows the error CLIFF below 4 bits.
// This is a labeled RECONSTRUCTION PROXY, not an end-task eval — it isolates the quantizer's own damage. The
// real production path (compile2bit.mjs) confirms the mechanism: sub-4-bit needs full QuIP#-grade incoherence +
// a per-layer Hessian, and only a PROXY embedding Hessian exists here (no GPU calibration box). The two regimes:
//   • post-hoc quant of a normal fp model below 4-bit → collapses (this script) → floor = 4-bit.
//   • NATIVELY-TERNARY BitNet → 2-bit runs with bit-exact parity (committed: gguf-forge-tq2 / -bitnet tests).
// Pure Node, deterministic (seeded), no model download. Every number is computed in this run.

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };

// deterministic Gaussian weights (Box–Muller over a seeded LCG) — the standard proxy for transformer weights.
const lcg = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; };
const rnd = lcg(12345);
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const N = 1 << 20, BLK = 32;                                   // 1M weights, 32-wide quant blocks
const W = new Float64Array(N); for (let i = 0; i < N; i++) W[i] = gauss() * 0.02;   // ~N(0, 0.02) like real weights

// symmetric per-block round-trip at `bits`; returns reconstruction RMSE / signal-RMS = relative error.
function roundTripRelErr(bits) {
  const qmax = (1 << (bits - 1)) - 1;                          // signed: ±qmax (e.g. 4-bit → ±7, 2-bit → ±1)
  let se = 0, sig = 0;
  for (let b = 0; b < N; b += BLK) {
    let amax = 0; for (let i = 0; i < BLK; i++) { const a = Math.abs(W[b + i]); if (a > amax) amax = a; }
    const scale = amax > 0 ? amax / qmax : 1;
    for (let i = 0; i < BLK; i++) {
      const w = W[b + i];
      const q = Math.max(-qmax, Math.min(qmax, Math.round(w / scale)));
      const r = q * scale, e = w - r;
      se += e * e; sig += w * w;
    }
  }
  return Math.sqrt(se / N) / Math.sqrt(sig / N);
}

console.log("post-hoc symmetric per-block quant — reconstruction error vs fp (lower = better):\n");
console.log("  bits   levels   relative-error    SNR(dB)");
const rel = {};
for (const bits of [8, 6, 5, 4, 3, 2]) {
  const e = roundTripRelErr(bits); rel[bits] = e;
  const snr = -20 * Math.log10(e);
  console.log(`   ${bits}     ±${String((1 << (bits - 1)) - 1).padStart(3)}     ${(e * 100).toFixed(2).padStart(7)} %     ${snr.toFixed(1).padStart(6)}`);
}

console.log("");
// monotonic degradation + a sharp drop below 4-bit is the whole point.
ok(rel[8] < rel[6] && rel[6] < rel[5] && rel[5] < rel[4] && rel[4] < rel[3] && rel[3] < rel[2], "error increases monotonically as bits fall");
ok(rel[4] < 0.12, `naive 4-bit error is moderate (${(rel[4] * 100).toFixed(2)} %) — the lowest usable tier; real GGUF k-quant (Q4_K superblocks) does better still`);
ok(rel[3] > rel[4] * 1.7, `3-bit error jumps vs 4-bit (${(rel[3] * 100).toFixed(2)} % vs ${(rel[4] * 100).toFixed(2)} %)`);
ok(rel[2] > 0.25, `2-bit error is severe (${(rel[2] * 100).toFixed(2)} %) — naive post-hoc 2-bit collapses`);
ok(rel[2] / rel[4] > 5, `2-bit is >5× worse than 4-bit (${(rel[2] / rel[4]).toFixed(1)}×) — the floor is 4-bit for post-hoc quant`);

console.log(`\nREGIME LABELS (honest):`);
console.log(`  • This proxy isolates the quantizer's own error. Real GGUF k-quants (Q4_K…) add codebooks/superblocks,`);
console.log(`    so 4-bit stays usable — but sub-4-bit still needs QuIP#-grade incoherence + a per-layer Hessian to`);
console.log(`    survive; compile2bit.mjs ships only a PROXY embedding Hessian (no GPU calibration box) → research-grade.`);
console.log(`  • EXCEPTION — natively-ternary BitNet: its 2-bit is bit-exact (committed: gguf-forge-tq2 / -bitnet tests).`);
console.log(`    "sub-4-bit fails" is therefore POST-HOC-quant-specific, not a blanket claim.`);

console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED: post-hoc quant below 4 bits collapses (measured), so 4-bit is the realistic floor for a normal fp model; natively-ternary BitNet 2-bit is the labeled exception, proven elsewhere by parity tests."}`);
process.exit(fail ? 1 : 0);
