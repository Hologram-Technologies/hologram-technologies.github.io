// e8-lut.mjs — the substrate-native E₈ codebook for 2-bit inference (ADR-0054 arc, "E8P-lite").
// Format: 8 consecutive weights = ONE u16 codeword (8 shape bits → a 256-entry E₈ LUT + 8 sign bits),
// with a per-32-block MSE-SEARCHED scale (f16) — true 2.0 + 0.5 = 2.5 bits/weight, NO Hadamard, NO
// power-of-2 padding (Qwen dims aren't pow2 — padding is what bloated the old incoherent 2-bit path).
// The LUT is built from the E₈ lattice itself: snap a large sample of real (or Gaussian) 8-blocks via
// the Conway-Sloane decoder, keep the 256 most-probable |coordinate| patterns. The LUT bytes are a
// content-addressed UOR object (did:holo:sha256) — every model compiled against it references its κ,
// per the ATLAS E₈ standard (e8-standard.mjs). FALSIFICATION GATE built in: at equal bits the E₈
// codebook must beat the scalar {−3,−1,1,3} grid on real weights, or this path is dead (E8-SR died
// exactly this way — measure, don't believe).
import { nearestE8 } from "./e8-quant.mjs";

// ── LUT build: top-256 positional |pattern|s of δ-scaled E₈ snaps over a sample ──
// Patterns are POSITIONAL (the LUT row reproduces position), values doubled→integers (½ℤ → ℤ) for keys.
export function buildE8LUT(sample, { delta = null } = {}) {
  // working δ: MSE-ish default from the sample RMS (the per-block search at encode adapts around it)
  if (!delta) { let ss = 0; for (let i = 0; i < sample.length; i++) ss += sample[i] * sample[i]; delta = 0.6 * Math.sqrt(ss / sample.length) || 1e-8; }
  const counts = new Map(), v = new Float64Array(8), q = new Float64Array(8);
  const m = sample.length - (sample.length % 8);
  for (let o = 0; o < m; o += 8) {
    for (let i = 0; i < 8; i++) v[i] = sample[o + i] / delta;
    nearestE8(v, q);
    let key = "";
    for (let i = 0; i < 8; i++) key += (Math.abs(Math.round(q[i] * 2))) + ",";   // |2q| pattern (integer)
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256);
  while (top.length < 256) top.push(["0,0,0,0,0,0,0,0,", 0]);                    // pad (zero shape)
  // LUT = Float32Array[256*8] of |coordinates| (un-doubled); shape 0 forced to the zero pattern
  const lut = new Float32Array(256 * 8);
  const index = new Map();
  top.sort((a, b) => (a[0] === "0,0,0,0,0,0,0,0," ? -1 : b[0] === "0,0,0,0,0,0,0,0," ? 1 : b[1] - a[1]));
  for (let s = 0; s < 256; s++) {
    const parts = top[s][0].split(",").slice(0, 8).map(Number);
    for (let i = 0; i < 8; i++) lut[s * 8 + i] = parts[i] / 2;
    index.set(top[s][0], s);
  }
  const coverage = top.reduce((a, [, c]) => a + c, 0) / (m / 8);
  return { lut, index, delta, coverage };
}

// ── encode one row segment: 32 weights → 4 u16 codewords + 1 MSE-searched scale ──
// Scale search mirrors packQ3's k-quant trick: candidates around absmax, pick min block MSE.
// LUT misses (~90%) take a NORM-WINDOW-PRUNED nearest-shape search (sorted by ‖shape‖, scan ±W)
// instead of all 256 — ~8× faster encode, near-identical MSE (nearest shape has a near norm).
const _v = new Float64Array(8), _q = new Float64Array(8);
export function lutNormIndex(lut) {                       // precompute once per LUT: shapes sorted by norm
  const arr = Array.from({ length: 256 }, (_, c) => { let n2 = 0; for (let i = 0; i < 8; i++) n2 += lut[c * 8 + i] * lut[c * 8 + i]; return [Math.sqrt(n2), c]; });
  arr.sort((a, b) => a[0] - b[0]);
  return { norms: new Float64Array(arr.map((x) => x[0])), order: new Uint16Array(arr.map((x) => x[1])) };
}
const WIN = 28;
function encode8(w, o, s, lut, index, ni) {               // → {code, mse} for 8 weights at scale s
  for (let i = 0; i < 8; i++) _v[i] = w[o + i] / s;
  nearestE8(_v, _q);
  let key = "";
  for (let i = 0; i < 8; i++) key += Math.abs(Math.round(_q[i] * 2)) + ",";
  let shape = index.get(key), best = -1, bestErr = Infinity;
  if (shape === undefined) {                              // miss → norm-window-pruned nearest |shape|
    let yn = 0; for (let i = 0; i < 8; i++) { const a = Math.abs(w[o + i]) / s; yn += a * a; } yn = Math.sqrt(yn);
    let lo = 0, hi = 255;                                  // binary search the sorted norms
    while (lo < hi) { const m = (lo + hi) >> 1; if (ni.norms[m] < yn) lo = m + 1; else hi = m; }
    const from = Math.max(0, lo - WIN), to = Math.min(255, lo + WIN);
    for (let k = from; k <= to; k++) {
      const c = ni.order[k]; let e = 0;
      for (let i = 0; i < 8; i++) { const d = Math.abs(w[o + i]) / s - lut[c * 8 + i]; e += d * d; }
      if (e < bestErr) { bestErr = e; best = c; }
    }
    shape = best;
  }
  let code = shape, mse = 0;
  for (let i = 0; i < 8; i++) {
    const mag = lut[shape * 8 + i], sgn = w[o + i] < 0 ? -1 : 1;
    if (w[o + i] < 0 && mag > 0) code |= 1 << (8 + i);
    const r = sgn * mag * s, d = w[o + i] - r; mse += d * d;
  }
  return { code, mse };
}
export function encodeBlock32(w, o, lut, index, ni) {     // 32 weights → {codes:[4×u16], scale, mse}
  ni = ni || lutNormIndex(lut);
  let mx = 0; for (let i = 0; i < 32; i++) { const a = Math.abs(w[o + i]); if (a > mx) mx = a; }
  let bestS = (mx / 3) || 1e-12, bestMse = Infinity, bestCodes = null;
  for (let c = 0; c < 6; c++) {                           // 6-candidate scale search (k-quant trick — THE Q3 coherence fix)
    const s = (mx * (0.30 + c * 0.09)) || 1e-12;
    let mse = 0; const codes = new Uint16Array(4);
    for (let b = 0; b < 4; b++) { const r = encode8(w, o + b * 8, s, lut, index, ni); codes[b] = r.code; mse += r.mse; }
    if (mse < bestMse) { bestMse = mse; bestS = s; bestCodes = codes; }
  }
  return { codes: bestCodes, scale: bestS, mse: bestMse };
}

// ── pack a whole [N,K] f32 matrix → e8q blob: [u16 codewords N·K/8 bytes][f16 scales N·K/32·2 bytes] ──
export function packE8(W, N, K, lut, index, f32ToF16) {
  const nb = K / 32, codes = new Uint16Array(N * nb * 4), sc = new Uint16Array(N * nb);
  const ni = lutNormIndex(lut);
  let mse = 0;
  for (let n = 0; n < N; n++) for (let b = 0; b < nb; b++) {
    const r = encodeBlock32(W, n * K + b * 32, lut, index, ni);
    codes.set(r.codes, (n * nb + b) * 4); sc[n * nb + b] = f32ToF16(r.scale); mse += r.mse;
  }
  const blob = new Uint8Array(codes.byteLength + sc.byteLength);
  blob.set(new Uint8Array(codes.buffer), 0); blob.set(new Uint8Array(sc.buffer), codes.byteLength);
  return { blob, mse: mse / (N * K) };
}
export function decodeBlock32(codes, scale, lut, out, o) { // CPU reference decode (mirrors the kernel)
  for (let b = 0; b < 4; b++) {
    const code = codes[b], shape = code & 0xff;
    for (let i = 0; i < 8; i++) { const mag = lut[shape * 8 + i]; out[o + b * 8 + i] = ((code >> (8 + i)) & 1 ? -1 : 1) * mag * scale; }
  }
}

// scalar 2-bit grid {−3,−1,1,3}·s with the SAME 6-candidate scale search — the equal-bits baseline
export function scalarBlock32(w, o) {
  let mx = 0; for (let i = 0; i < 32; i++) { const a = Math.abs(w[o + i]); if (a > mx) mx = a; }
  let bestMse = Infinity;
  for (let c = 0; c < 6; c++) {
    const s = (mx * (0.30 + c * 0.09)) || 1e-12; let mse = 0;
    for (let i = 0; i < 32; i++) { let q = Math.round((w[o + i] / s + 3) / 2); if (q < 0) q = 0; else if (q > 3) q = 3; const d = w[o + i] - (q * 2 - 3) * s; mse += d * d; }
    if (mse < bestMse) bestMse = mse;
  }
  return bestMse;
}

// κ of the LUT (the substrate anchor): sha256 over the raw f32 bytes
export async function lutKappa(lut) {
  const h = await crypto.subtle.digest("SHA-256", new Uint8Array(lut.buffer, lut.byteOffset, lut.byteLength));
  return "did:holo:sha256:" + [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── node self-test + FALSIFICATION GATE: E₈-LUT vs scalar grid at equal bits, Gaussian + real-ish ──
if (typeof process !== "undefined" && process.argv[1] && process.argv[1].endsWith("e8-lut.mjs")) {
  let s = 7; const nx = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const gauss = () => { const u = Math.max(1e-12, nx()), v = nx(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const N = 1 << 17;
  const sample = new Float32Array(N); for (let i = 0; i < N; i++) sample[i] = gauss();
  const { lut, index, delta, coverage } = buildE8LUT(sample);
  console.log(`LUT built: δ=${delta.toFixed(3)} coverage=${(coverage * 100).toFixed(1)}% (top-256 patterns) κ=${(await lutKappa(lut)).slice(0, 40)}…`);
  for (const tail of [1.0, 1.6]) {                        // 1.0 = Gaussian; 1.6 = heavy-tailed (outliers, the hard case)
    const w = new Float32Array(N); for (let i = 0; i < N; i++) { const g = gauss(); w[i] = g * (tail === 1 ? 1 : Math.exp(Math.abs(g) * (tail - 1) * 0.4)); }
    let e8mse = 0, scmse = 0;
    const dec = new Float32Array(32);
    for (let o = 0; o + 32 <= N; o += 32) { const r = encodeBlock32(w, o, lut, index); e8mse += r.mse; scmse += scalarBlock32(w, o); }
    const ratio = e8mse / scmse;
    console.log(`tail=${tail}  E8-LUT MSE=${(e8mse / N).toFixed(5)}  scalar-2bit MSE=${(scmse / N).toFixed(5)}  ratio=${ratio.toFixed(3)}  ${ratio < 1 ? "E8 WINS ✓" : "E8 LOSES ✗ (falsified at this δ)"}`);
  }
  // round-trip determinism
  const w = new Float32Array(32); for (let i = 0; i < 32; i++) w[i] = gauss();
  const r1 = encodeBlock32(w, 0, lut, index), r2 = encodeBlock32(w, 0, lut, index);
  console.log("encode deterministic:", r1.codes.every((c, i) => c === r2.codes[i]) && r1.scale === r2.scale ? "✓" : "✗");
}
