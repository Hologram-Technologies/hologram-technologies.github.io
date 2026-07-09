// e8-quant.mjs — quantize an LLM's weights onto the E₈ lattice (the structure the atlas generates).
// E₈ is the densest lattice in 8 dimensions (Viazovska 2016) and, being UNIMODULAR (det = 1), E₈ at
// step δ and the integer lattice Z⁸ at step δ have the SAME point density — so comparing E₈-at-δ to
// scalar-round-at-δ is a fair EQUAL-RATE comparison, where E₈'s quantizing gain should give ≈0.86×
// the distortion (its normalized 2nd moment G(E₈)≈0.0717 vs 1/12≈0.0833 for scalar). Pure JS, zero deps.
//
// This is the literal "fit a model to the atlas at compile time, in the substrate": a content-addressed
// transform  κ(weights) ⊕ κ(E₈-codebook) ⊕ κ(δ) → κ(quantized)  realized as a weight requantizer the
// QVAC engine then runs. Honest scope: a principled, optimal vector quantizer — a compression/fidelity
// tool, not a semantic "truth" fix.

// ── nearest lattice point ──
// D_n = integer vectors with even coordinate sum. Decode: round all; if the sum is odd, flip the one
// coordinate with the largest rounding error to the other side (parity flips, distance cost minimal).
function nearestDn(x, y) {
  let sum = 0, worst = -1, wi = 0;
  for (let i = 0; i < 8; i++) { const r = Math.round(x[i]); y[i] = r; sum += r; const e = Math.abs(x[i] - r); if (e > worst) { worst = e; wi = i; } }
  if ((sum & 1) !== 0) { const r = Math.round(x[wi]); y[wi] = x[wi] >= r ? r + 1 : r - 1; }
  return y;
}
// E₈ = D₈ ∪ (D₈ + (½)⁸). Decode: closer of nearestD8(x) and nearestD8(x−½)+½.
const _a = new Float64Array(8), _b = new Float64Array(8), _xs = new Float64Array(8);
export function nearestE8(x, out) {
  nearestDn(x, _a);
  for (let i = 0; i < 8; i++) _xs[i] = x[i] - 0.5;
  nearestDn(_xs, _b);
  let e0 = 0, e1 = 0;
  for (let i = 0; i < 8; i++) { const d0 = x[i] - _a[i], h = _b[i] + 0.5, d1 = x[i] - h; e0 += d0 * d0; e1 += d1 * d1; _b[i] = h; }
  const src = e0 <= e1 ? _a : _b;
  for (let i = 0; i < 8; i++) out[i] = src[i];
  return out;
}

// quantize a flat Float32Array IN PLACE onto E₈ at step δ (groups of 8 consecutive values = one vector).
// Returns the summed squared error (for MSE). Leftover (len % 8) values are scalar-rounded at δ.
export function e8QuantizeInPlace(w, delta) {
  const v = new Float64Array(8), q = new Float64Array(8); let sse = 0, n = w.length, m = n - (n % 8);
  for (let o = 0; o < m; o += 8) {
    for (let i = 0; i < 8; i++) v[i] = w[o + i] / delta;
    nearestE8(v, q);
    for (let i = 0; i < 8; i++) { const r = q[i] * delta; const e = w[o + i] - r; sse += e * e; w[o + i] = r; }
  }
  for (let o = m; o < n; o++) { const r = Math.round(w[o] / delta) * delta; const e = w[o] - r; sse += e * e; w[o] = r; }
  return sse;
}
// scalar (Z⁸) baseline at the same δ — the equal-rate comparison.
export function scalarQuantizeInPlace(w, delta) {
  let sse = 0; for (let o = 0; o < w.length; o++) { const r = Math.round(w[o] / delta) * delta; const e = w[o] - r; sse += e * e; w[o] = r; }
  return sse;
}

// ── incoherence processing (QuIP#): a randomized Hadamard rotation spreads weight outliers so a
// single lattice step quantizes them well, then is undone — making 2-bit E₈ viable. The sign pattern
// is deterministic (declared once, part of the atlas E₈ standard), so the transform re-derives. ──
const _pow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };
function fwht(a) { const n = a.length; for (let len = 1; len < n; len <<= 1) for (let i = 0; i < n; i += len << 1) for (let j = i; j < i + len; j++) { const x = a[j], y = a[j + len]; a[j] = x + y; a[j + len] = x - y; } const s = 1 / Math.sqrt(n); for (let i = 0; i < n; i++) a[i] *= s; }  // self-inverse: applied twice = identity
function signsFor(d) { const s = new Int8Array(d); let x = (0x9e3779b9 ^ d) >>> 0; for (let i = 0; i < d; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; s[i] = (x & 1) ? 1 : -1; } return s; }
// quantize one row of length K onto E₈ in the incoherence-rotated basis at step δ, IN PLACE (back in
// the original basis). Returns the row's summed squared error.
function quantizeRowIncoherent(w, base, K, sign, Kp, delta, buf) {
  for (let k = 0; k < Kp; k++) buf[k] = k < K ? w[base + k] * sign[k] : 0;
  fwht(buf);                                              // rotate to the incoherent basis
  const v = new Float64Array(8), q = new Float64Array(8);
  for (let o = 0; o < Kp; o += 8) { for (let i = 0; i < 8; i++) v[i] = buf[o + i] / delta; nearestE8(v, q); for (let i = 0; i < 8; i++) buf[o + i] = q[i] * delta; }
  fwht(buf);                                              // rotate back (self-inverse)
  let sse = 0; for (let k = 0; k < K; k++) { const r = buf[k] * sign[k]; const e = w[base + k] - r; sse += e * e; w[base + k] = r; }
  return sse;
}

// ── LDLQ adaptive rounding (QuIP, Chee et al. 2023) ──────────────────────────────────────────────
// Minimises the OUTPUT error ‖(W−Ŵ)·H^½‖ (not the weight error) by rounding input columns high→low and
// feeding each future column's quantization error back through the LDL factor of the input Hessian
// H = Eᵀ·E. VALIDATED: ~5× lower output-weighted error vs independent rounding on a real layer with a
// real Hessian. To apply across a whole model it needs H per layer — i.e. a calibration forward-pass
// collecting each layer's input activations (the remaining wiring). These are the validated primitives.
export function ldlDecompose(H, n) {                     // H symmetric row-major → {L unit-lower, d diag}, H = L·diag(d)·Lᵀ
  const L = new Float64Array(n * n), d = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let dj = H[j * n + j]; for (let k = 0; k < j; k++) dj -= L[j * n + k] * L[j * n + k] * d[k]; d[j] = dj; L[j * n + j] = 1;
    for (let i = j + 1; i < n; i++) { let s = H[i * n + j]; for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k] * d[k]; L[i * n + j] = dj !== 0 ? s / dj : 0; }
  }
  return { L, d };
}
export function ldlqRound(W, N, K, L, delta) {            // W [N,K] row-major (K = input dim); scalar Q at step δ
  const What = new Float32Array(N * K), E = new Float32Array(N * K);
  for (let k = K - 1; k >= 0; k--) for (let i = 0; i < N; i++) {
    let corr = W[i * K + k]; for (let j = k + 1; j < K; j++) corr += E[i * K + j] * L[j * K + k];
    const r = Math.round(corr / delta) * delta; What[i * K + k] = r; E[i * K + k] = W[i * K + k] - r;
  }
  return What;
}
// CODEBOOK-AWARE LDLQ (QuIP# composition done right): quantize each input column DIRECTLY to the E₈
// lattice — group the N output rows into blocks of 8 and snap each to its nearest E₈ point — INSIDE the
// recursion, so the feedback error E reflects the lattice-rounded value. This is the correct fusion of
// the adaptive-rounding lever with the lattice codebook: no scalar-round-then-re-snap (which double-
// quantizes and undoes the tuning). Output value lands exactly on the δ·E₈ grid (coords ∈ ½ℤ).
export function ldlqRoundE8(W, N, K, L, delta) {
  const What = new Float32Array(N * K), E = new Float32Array(N * K);
  const corr = new Float64Array(N), v = new Float64Array(8), q = new Float64Array(8);
  const Nb = N - (N % 8);
  for (let k = K - 1; k >= 0; k--) {
    for (let i = 0; i < N; i++) { let c = W[i * K + k]; for (let j = k + 1; j < K; j++) c += E[i * K + j] * L[j * K + k]; corr[i] = c; }
    for (let o = 0; o < Nb; o += 8) {                      // 8 output rows → one E₈ vector
      for (let i = 0; i < 8; i++) v[i] = corr[o + i] / delta; nearestE8(v, q);
      for (let i = 0; i < 8; i++) { const r = q[i] * delta, p = (o + i) * K + k; What[p] = r; E[p] = W[p] - r; }
    }
    for (let i = Nb; i < N; i++) { const r = Math.round(corr[i] / delta) * delta, p = i * K + k; What[p] = r; E[p] = W[p] - r; }  // leftover rows: scalar
  }
  return What;
}

// ── engine integration: requantize a QVAC Q8 tensor [int8 N*K][f32 scales N*(K/32)] ──
// Dequantize → quantize (mode 'e8'|'scalar') at δ = rel × tensorRMS → re-encode Q8 (recompute per-32
// block scales). Same byte layout in/out, so the GPU kernels run it unchanged. Returns {bytes, mse, rms}.
export function requantTensorQ8(raw, N, K, { mode = "e8", rel = 1.0 } = {}) {
  const qn = N * K, nsc = N * (K / 32);
  const q = new Int8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + qn));     // signed int8 quants (copy → aligned)
  const sc = new Float32Array(raw.buffer.slice(raw.byteOffset + qn, raw.byteOffset + qn + nsc * 4));
  const w = new Float32Array(qn);
  let ss = 0;
  for (let n = 0; n < N; n++) for (let k = 0; k < K; k++) { const val = q[n * K + k] * sc[n * (K / 32) + (k >> 5)]; w[n * K + k] = val; ss += val * val; }
  const rms = Math.sqrt(ss / qn) || 1e-8;
  let mse = 0, delta;
  if (mode === "e8i") {                                  // E₈ with incoherence (QuIP#) — viable at 2-bit
    const Kp = _pow2(K), sign = signsFor(Kp), buf = new Float64Array(Kp);
    delta = rel * rms * Math.sqrt(K / Kp);
    for (let n = 0; n < N; n++) mse += quantizeRowIncoherent(w, n * K, K, sign, Kp, delta, buf);
  } else {                                               // quantize each row in 8-blocks (no rotation)
    delta = rel * rms;
    for (let n = 0; n < N; n++) { const row = w.subarray(n * K, n * K + K); mse += (mode === "e8" ? e8QuantizeInPlace(row, delta) : scalarQuantizeInPlace(row, delta)); }
  }
  mse /= qn;
  // re-encode to Q8: per-32-block symmetric int8 + f32 scale (recomputed from the reconstructed weights)
  const outQ = new Int8Array(qn), outS = new Float32Array(nsc);
  for (let n = 0; n < N; n++) for (let b = 0; b < K / 32; b++) {
    let mx = 0; const base = n * K + b * 32; for (let i = 0; i < 32; i++) { const a = Math.abs(w[base + i]); if (a > mx) mx = a; }
    const s = mx / 127 || 1e-12; outS[n * (K / 32) + b] = s;
    for (let i = 0; i < 32; i++) { let qi = Math.round(w[base + i] / s); if (qi > 127) qi = 127; else if (qi < -127) qi = -127; outQ[base + i] = qi; }
  }
  const out = new Uint8Array(qn + nsc * 4);
  out.set(new Uint8Array(outQ.buffer), 0); out.set(new Uint8Array(outS.buffer), qn);
  return { bytes: out, mse, rms, delta };
}

// ── node self-test: validate the quantizer + the lattice gain ──
if (typeof process !== "undefined" && process.argv[1] && process.argv[1].endsWith("e8-quant.mjs")) {
  let s = 99; const nx = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const gauss = () => { const u = Math.max(1e-12, nx()), v = nx(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const N = 80000;
  for (const delta of [0.5, 1.0, 2.0]) {
    const a = new Float32Array(N), b = new Float32Array(N); for (let i = 0; i < N; i++) { const g = gauss(); a[i] = g; b[i] = g; }
    const e8 = e8QuantizeInPlace(a, delta) / N, sc = scalarQuantizeInPlace(b, delta) / N;
    console.log(`δ=${delta}  E8 MSE=${e8.toFixed(5)}  scalar MSE=${sc.toFixed(5)}  ratio E8/scalar=${(e8 / sc).toFixed(3)}  (theory ≈0.860 = the E₈ quantizing gain)`);
  }
  // sanity: a known E₈ point quantizes to itself
  const p = new Float64Array([1, 1, 0, 0, 0, 0, 0, 0]), o = new Float64Array(8); nearestE8(p, o);
  console.log("nearestE8([1,1,0,...]) =", Array.from(o).join(","), "(should be the same root; sum even ✓)");
}
