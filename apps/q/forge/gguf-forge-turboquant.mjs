// GGUF Forge — TurboQuant / PolarQuant KV-cache quant (Tier-A, float32-EXACT).
//
// qvac-EXCLUSIVE feature (Zandieh et al., ICLR 2026). These quantize the KV cache,
// not model weights: a K/V vector → rotation (graph-level) → Lloyd-Max codebook
// scalar quant + bit-pack (Stage 1 = PolarQuant) → optional 1-bit QJL residual
// sketch (Stage 2 = TurboQuant). The per-block to_float / from_float kernels (what
// ggml's type_traits expose, and what this module reproduces bit-for-bit) do NOT
// include the rotation — that's applied to whole tensors at graph level (optRot).
//
// Transcribed line-for-line from qvac-fabric-llm.cpp ggml/src/ggml-quants.c:
//   tq3_dequantize_block:2658  tq4_dequantize_block:2685  tq{3,4}_quantize_block:2560,2612
//   tq_compute_boundaries:2540  tq{3,4}_quantize_val:2505,2522
//   qjl_encode_residual:2828  qjl_project_inplace:2820  tq_fht:2486
//   xoshiro256** tq_rng_*:2410  codebooks TQ{3,4}_CODEBOOK_{128,64}:2369
// Witnessed BIT-FOR-BIT vs ggml to_float / quantize_chunk (types 42-49) in
// gguf-forge-turboquant.test.mjs.

import { f16ToF32 } from "../qvac-ingest.mjs";
import { f32ToF16 } from "./gguf-forge-matmul.mjs";

const fr = Math.fround;
const fsqrt = (v) => fr(Math.sqrt(v));

// Lloyd-Max codebooks (Float32Array → entries are binary32-exact like C's `const float`).
const TQ3_CB_128 = Float32Array.from([
  -0.18839718597003241, -0.11813976699668613, -0.06658560804735174, -0.02160431064212660,
   0.02160431064212660,  0.06658560804735174,  0.11813976699668613,  0.18839718597003241]);
const TQ4_CB_128 = Float32Array.from([
  -0.23762692286887249, -0.18079342531272283, -0.14176134070424901, -0.11024676790280842,
  -0.08279230816984559, -0.05774433563409530, -0.03413390187425037, -0.01129645493594766,
   0.01129645493594766,  0.03413390187425037,  0.05774433563409530,  0.08279230816984559,
   0.11024676790280842,  0.14176134070424901,  0.18079342531272283,  0.23762692286887249]);
const TQ3_CB_64 = Float32Array.from([
  -0.26391393084454512, -0.16616785892516461, -0.09383226321833739, -0.03046917893115905,
   0.03046917893115905,  0.09383226321833739,  0.16616785892516461,  0.26391393084454512]);
const TQ4_CB_64 = Float32Array.from([
  -0.33074821159014389, -0.25285715281341298, -0.19879720552558833, -0.15486925951295250,
  -0.11643764752566743, -0.08127367507061777, -0.04806567112944460, -0.01591077077846402,
   0.01591077077846402,  0.04806567112944460,  0.08127367507061777,  0.11643764752566743,
   0.15486925951295250,  0.19879720552558833,  0.25285715281341298,  0.33074821159014389]);
const cb3 = (d) => (d === 128 ? TQ3_CB_128 : TQ3_CB_64);
const cb4 = (d) => (d === 128 ? TQ4_CB_128 : TQ4_CB_64);

// midpoints between adjacent centroids (tq_compute_boundaries)
function boundaries(cb) { const b = new Float32Array(cb.length - 1); for (let i = 0; i < b.length; i++) b[i] = fr((cb[i] + cb[i + 1]) * 0.5); return b; }
const B3_128 = boundaries(TQ3_CB_128), B3_64 = boundaries(TQ3_CB_64), B4_128 = boundaries(TQ4_CB_128), B4_64 = boundaries(TQ4_CB_64);
const bnd3 = (d) => (d === 128 ? B3_128 : B3_64);
const bnd4 = (d) => (d === 128 ? B4_128 : B4_64);

// binary-search nearest-centroid (tq3/tq4_quantize_val)
function qv3(v, b) { return v < b[3] ? (v < b[1] ? (v < b[0] ? 0 : 1) : (v < b[2] ? 2 : 3)) : (v < b[5] ? (v < b[4] ? 4 : 5) : (v < b[6] ? 6 : 7)); }
function qv4(v, b) {
  if (v < b[7]) return v < b[3] ? (v < b[1] ? (v < b[0] ? 0 : 1) : (v < b[2] ? 2 : 3)) : (v < b[5] ? (v < b[4] ? 4 : 5) : (v < b[6] ? 6 : 7));
  return v < b[11] ? (v < b[9] ? (v < b[8] ? 8 : 9) : (v < b[10] ? 10 : 11)) : (v < b[13] ? (v < b[12] ? 12 : 13) : (v < b[14] ? 14 : 15));
}

// ── Stage-1 dequant (codebook × norm); covers PQ and the Stage-1 part of TBQ ──
function tq3DequantBlock(qs, base, normH, dst, o, d, cb) {
  const norm = f16ToF32(normH);
  if (Math.abs(norm) < 1e-15) { for (let r = 0; r < d; r++) dst[o + r] = 0; return; }
  let bit = 0;
  for (let r = 0; r < d; r++) { let idx = 0; for (let b = 0; b < 3; b++) { if (qs[base + (bit >> 3)] & (1 << (bit & 7))) idx |= 1 << b; bit++; } dst[o + r] = fr(cb[idx] * norm); }
}
function tq4DequantBlock(qs, base, normH, dst, o, d, cb) {
  const norm = f16ToF32(normH);
  if (Math.abs(norm) < 1e-15) { for (let r = 0; r < d; r++) dst[o + r] = 0; return; }
  for (let r = 0; r < d; r += 2) { const byte = qs[base + (r >> 1)]; dst[o + r] = fr(cb[byte & 0xf] * norm); dst[o + r + 1] = fr(cb[byte >> 4] * norm); }
}

// ── Stage-1 quant (norm + binary-search + pack); writes qs[index_bytes] + d(f16) ──
function tq3QuantBlock(src, so, out, base, d, cb, b) {
  let n = 0; for (let j = 0; j < d; j++) n = fr(n + fr(src[so + j] * src[so + j])); n = fsqrt(n);
  const idxBytes = (d * 3 + 7) >> 3;
  if (n < 1e-15) { for (let i = 0; i < idxBytes; i++) out[base + i] = 0; writeF16(out, base + idxBytes, 0); return; }
  const inv = fr(1 / n);
  for (let g = 0; g < d / 8; g++) { let acc = 0; for (let i = 0; i < 8; i++) acc |= qv3(fr(src[so + g * 8 + i] * inv), b) << (i * 3); const bb = base + g * 3; out[bb] = acc & 0xff; out[bb + 1] = (acc >> 8) & 0xff; out[bb + 2] = (acc >> 16) & 0xff; }
  writeF16(out, base + idxBytes, n);
}
function tq4QuantBlock(src, so, out, base, d, cb, b) {
  let n = 0; for (let j = 0; j < d; j++) n = fr(n + fr(src[so + j] * src[so + j])); n = fsqrt(n);
  const idxBytes = d / 2;
  if (n < 1e-15) { for (let i = 0; i < idxBytes; i++) out[base + i] = 0; writeF16(out, base + idxBytes, 0); return; }
  const inv = fr(1 / n);
  for (let r = 0; r < d; r += 2) out[base + (r >> 1)] = qv4(fr(src[so + r] * inv), b) | (qv4(fr(src[so + r + 1] * inv), b) << 4);
  writeF16(out, base + idxBytes, n);
}

const _f16buf = new DataView(new ArrayBuffer(2));
function writeF16(arr, off, v) { _f16buf.setUint16(0, f32ToF16(v), true); arr[off] = _f16buf.getUint8(0); arr[off + 1] = _f16buf.getUint8(1); }
const readF16 = (arr, off) => (arr[off] | (arr[off + 1] << 8));

// ── QJL Stage-2: xoshiro256** PRNG → sign array → Fast Walsh-Hadamard → sign bits ──
const U64 = (1n << 64n) - 1n;
const rotl = (x, k) => ((x << BigInt(k)) | (x >> BigInt(64 - k))) & U64;
function rngSeed(seed) {
  const s = [0n, 0n, 0n, 0n]; let z;
  for (let i = 0; i < 4; i++) { seed = (seed + 0x9e3779b97f4a7c15n) & U64; z = seed; z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & U64; z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & U64; s[i] = z ^ (z >> 31n); }
  return s;
}
function rngNext(s) {
  const result = (rotl((s[1] * 5n) & U64, 7) * 9n) & U64;
  const t = (s[1] << 17n) & U64;
  s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl(s[3], 45);
  return result;
}
function generateSigns(d, seed) { const s = rngSeed(BigInt(seed)), out = new Float32Array(d); for (let i = 0; i < d; i++) out[i] = (rngNext(s) & 1n) ? 1 : -1; return out; }
const _qjlSigns = {};
const qjlSigns = (d) => (_qjlSigns[d] ||= generateSigns(d, d === 128 ? 137 : 139)); // QJL_SIGN_SEED_{128,64}

// In-place Fast Walsh-Hadamard (tq_fht), f32-exact.
function fht(x, d) { for (let half = 1; half < d; half <<= 1) for (let i = 0; i < d; i += half << 1) for (let j = i; j < i + half; j++) { const a = x[j], b = x[j + half]; x[j] = fr(a + b); x[j + half] = fr(a - b); } }

// qjl_encode_residual: project residual by H·D_qjl (no 1/√d), pack sign bits, store ‖r‖.
function qjlEncode(residual, d, out, base, qjlBytes) {
  let rn = 0; for (let j = 0; j < d; j++) rn = fr(rn + fr(residual[j] * residual[j])); rn = fsqrt(rn);
  writeF16(out, base + qjlBytes, rn); // d_r stored after the qjl bitfield
  for (let i = 0; i < qjlBytes; i++) out[base + i] = 0;
  if (rn < 1e-15) return;
  const tmp = Float32Array.from(residual.subarray(0, d)), sg = qjlSigns(d);
  for (let i = 0; i < d; i++) tmp[i] = fr(tmp[i] * sg[i]);
  fht(tmp, d);
  for (let j = 0; j < d; j++) if (tmp[j] > 0) out[base + (j >> 3)] |= 1 << (j & 7);
}

// ── Per-type table: bits, block elements d, index bytes, has-QJL, qjl bytes, total ──
//    PQ3_0=46 PQ3_0_64=47 PQ4_0=48 PQ4_0_64=49 | TBQ3_0=42 TBQ4_0=43 TBQ3_0_64=44 TBQ4_0_64=45
export const TQ_TYPES = {
  46: { name: "PQ3_0",    bits: 3, d: 128, idx: 48, qjl: 0,  total: 50 },
  47: { name: "PQ3_0_64", bits: 3, d: 64,  idx: 24, qjl: 0,  total: 26 },
  48: { name: "PQ4_0",    bits: 4, d: 128, idx: 64, qjl: 0,  total: 66 },
  49: { name: "PQ4_0_64", bits: 4, d: 64,  idx: 32, qjl: 0,  total: 34 },
  42: { name: "TBQ3_0",   bits: 3, d: 128, idx: 48, qjl: 16, total: 68 },
  43: { name: "TBQ4_0",   bits: 4, d: 128, idx: 64, qjl: 16, total: 84 },
  44: { name: "TBQ3_0_64",bits: 3, d: 64,  idx: 24, qjl: 8,  total: 36 },
  45: { name: "TBQ4_0_64",bits: 4, d: 64,  idx: 32, qjl: 8,  total: 44 },
};

export function tqDequant(typeId, raw, elements) {
  const t = TQ_TYPES[typeId]; if (!t) throw new Error("turboquant: not a TQ/PQ type " + typeId);
  const out = new Float32Array(elements), nb = elements / t.d, cb = t.bits === 3 ? cb3(t.d) : cb4(t.d);
  for (let i = 0; i < nb; i++) {
    const base = i * t.total, normH = readF16(raw, base + t.idx);
    if (t.bits === 3) tq3DequantBlock(raw, base, normH, out, i * t.d, t.d, cb);
    else tq4DequantBlock(raw, base, normH, out, i * t.d, t.d, cb);
  }
  return out;
}

// ── Randomized Hadamard rotation R = (1/√d)·H·D (tq_forward/inverse_inplace) ──
// Applied to each head_dim-slice of a K/V vector BEFORE quant (graph-level optRot in
// qvac). Orthogonal: inverse(forward(x)) = x. Rotation signs use seeds 42/43 (distinct
// from the QJL signs 137/139). (ggml-quants.c tq_forward_inplace:2476 / inverse:2483)
const _tqSigns = {};
const tqSigns = (d) => (_tqSigns[d] ||= generateSigns(d, d === 128 ? 42 : 43)); // TQ_SIGN_SEED_{128,64}
function tqForward(buf, o, d, sg) { for (let i = 0; i < d; i++) buf[o + i] = fr(buf[o + i] * sg[i]); fhtAt(buf, o, d); const inv = fr(1 / fsqrt(d)); for (let i = 0; i < d; i++) buf[o + i] = fr(buf[o + i] * inv); }
function tqInverse(buf, o, d, sg) { fhtAt(buf, o, d); const inv = fr(1 / fsqrt(d)); for (let i = 0; i < d; i++) buf[o + i] = fr(buf[o + i] * fr(sg[i] * inv)); }
function fhtAt(x, o, d) { for (let half = 1; half < d; half <<= 1) for (let i = 0; i < d; i += half << 1) for (let j = i; j < i + half; j++) { const a = x[o + j], b = x[o + j + half]; x[o + j] = fr(a + b); x[o + j + half] = fr(a - b); } }

export const isTqType = (typeId) => typeId in TQ_TYPES;
export const tqBlockElems = (typeId) => TQ_TYPES[typeId]?.d;
// The rotation sign diagonal D (seeds 42/43) — exposed so a GPU KV-decode kernel can
// upload it and reproduce tq_inverse_inplace (fht then ×signs/√d) in-shader.
export const rotationSigns = (d) => tqSigns(d);
// The QJL sketch sign diagonal D_qjl (seeds 137/139) — exposed so a GPU score-correction
// kernel can upload it and reproduce qjl_project_inplace (×signs then FHT, no 1/√d).
export const qjlSketchSigns = (d) => qjlSigns(d);

// QJL Stage-2 dot-correction (qjl_dot_correction, ggml-quants.c:2923). Estimates the inner
// product lost to stage-1 quantization: score += √(π/2)/d · ‖residual‖ · Σ_j sign_j·(R_qjl·b)_j,
// R_qjl = H·D_qjl (qjl signs seed 137/139, NO 1/√d). `b` must be in stage-1-ROTATED space —
// i.e. tqRotate(query). Added to the (rotated-space) base dot to recover the full <q,k>.
function qjlProject(buf, d) { const sg = qjlSigns(d); for (let i = 0; i < d; i++) buf[i] = fr(buf[i] * sg[i]); fht(buf, d); }
export function qjlDotCorrection(qjlBytes, qjlOff, d_r, b, d) {
  if (d_r < 1e-15) return 0;
  const proj = Float32Array.from(b.subarray ? b.subarray(0, d) : b.slice(0, d));
  qjlProject(proj, d);
  let sum = 0;
  for (let j = 0; j < d; j++) { const sign = ((qjlBytes[qjlOff + (j >> 3)] >> (j & 7)) & 1) ? 1 : -1; sum = fr(sum + fr(sign * proj[j])); }
  return fr(fr(d_r * fr(Math.sqrt(1.5707963) / d)) * sum);
}
// Forward stage-1 rotation R = (1/√d)·H·D of each d-block of a vector (the query, so its
// dot with a rotated-space K matches; orthogonal so it does not change the true inner product).
export function tqRotate(vec, d) { const out = Float32Array.from(vec), sg = tqSigns(d); for (let bk = 0; bk < vec.length / d; bk++) tqForward(out, bk * d, d, sg); return out; }

// κ-native KV codec: a K/V vector (length = multiple of head_dim block) → rotate each
// block (Hadamard) → TurboQuant bytes. decode reverses it. This is the substrate KV
// plane: the bytes are content-addressed + L5-verifiable; the round-trip is lossy by
// design (3–4 bpw). `elements` must be a multiple of the type's block size.
export function tqEncodeKV(typeId, vec) {
  const d = TQ_TYPES[typeId].d, n = vec.length;
  if (n % d) throw new Error(`turboquant KV: length ${n} not a multiple of block ${d}`);
  const rot = Float32Array.from(vec), sg = tqSigns(d);
  for (let b = 0; b < n / d; b++) tqForward(rot, b * d, d, sg);
  return tqQuant(typeId, rot, n);
}
export function tqDecodeKV(typeId, blob, elements) {
  const d = TQ_TYPES[typeId].d, out = tqDequant(typeId, blob, elements), sg = tqSigns(d);
  for (let b = 0; b < elements / d; b++) tqInverse(out, b * d, d, sg);
  return out;
}

// GPU-side tables for a TQ/PQ type: the codebook, the nearest-centroid boundaries, the Hadamard
// rotation signs, and the byte layout. run-native uploads these so the in-shader encode/decode
// reproduce tqEncodeKV/tqDecodeKV exactly.
export function tqTables(typeId) {
  const t = TQ_TYPES[typeId]; if (!t) throw new Error("turboquant: not a TQ/PQ type " + typeId);
  const d = t.d, threeBit = t.bits === 3;
  return { d, total: t.total, idx: t.idx, qjl: t.qjl, bits: t.bits, codebook: threeBit ? cb3(d) : cb4(d), boundaries: threeBit ? bnd3(d) : bnd4(d), signs: tqSigns(d) };
}

export function tqQuant(typeId, x, k) {
  const t = TQ_TYPES[typeId]; if (!t) throw new Error("turboquant: not a TQ/PQ type " + typeId);
  const nb = k / t.d, out = new Uint8Array(nb * t.total);
  const cb = t.bits === 3 ? cb3(t.d) : cb4(t.d), b = t.bits === 3 ? bnd3(t.d) : bnd4(t.d);
  const deq = new Float32Array(t.d), res = new Float32Array(t.d);
  for (let i = 0; i < nb; i++) {
    const base = i * t.total, so = i * t.d;
    if (t.bits === 3) tq3QuantBlock(x, so, out, base, t.d, cb, b); else tq4QuantBlock(x, so, out, base, t.d, cb, b);
    if (t.qjl) { // Stage 2: re-dequant this block, sketch the residual
      const normH = readF16(out, base + t.idx);
      if (t.bits === 3) tq3DequantBlock(out, base, normH, deq, 0, t.d, cb); else tq4DequantBlock(out, base, normH, deq, 0, t.d, cb);
      for (let j = 0; j < t.d; j++) res[j] = fr(x[so + j] - deq[j]);
      qjlEncode(res, t.d, out, base + t.idx + 2, t.qjl);
    }
  }
  return out;
}
