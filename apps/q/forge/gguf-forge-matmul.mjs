// GGUF Forge — Tier-A integer-dot matmul oracle (float32-EXACT).
//
// This is ggml's ACTUAL quantized matmul path, distinct from dequant-then-float-
// GEMV: F32 activations are quantized to Q8_K, then a weight row (Q4_K/Q6_K) is
// dotted against it with INTEGER products (exact) and only the final scale in
// float32. Reproducing this — not a dequantized float dot — is what makes logits
// bit-exact to llama.cpp.
//
// Transcribed from qvac-fabric-llm.cpp (llama.cpp b7248):
//   ggml/src/ggml-quants.c       quantize_row_q8_K_ref (:3357), nearest_int (:559)
//   ggml/src/ggml-cpu/quants.c   ggml_vec_dot_q4_K_q8_K_generic (:1098)
//                                ggml_vec_dot_q6_K_q8_K_generic (:1253)

import { f16ToF32 } from "../qvac-ingest.mjs";

const fr = Math.fround;
const QK_K = 256;

// nearest_int (ggml-quants.c:559): the add-magic-constant round-to-nearest-even trick.
const _f32 = new Float32Array(1), _i32 = new Int32Array(_f32.buffer);
export function nearestInt(fval) {
  _f32[0] = fr(fval + 12582912.0);       // 1.5 * 2^23
  const i = _i32[0];
  return (i & 0x007fffff) - 0x00400000;
}

// quantize_row_q8_K_ref (ggml-quants.c:3357). x: Float32Array (k elements, k%256==0).
// Returns the Q8_K block fields the dot consumes.
export function quantizeRowQ8K(x, k = x.length) {
  const nb = k / QK_K;
  const d = new Float32Array(nb), qs = new Int8Array(k), bsums = new Int16Array(nb * 16);
  for (let i = 0; i < nb; i++) {
    const base = i * QK_K;
    let amax = 0, max = 0;
    for (let j = 0; j < QK_K; ++j) { const ax = Math.abs(x[base + j]); if (ax > amax) { amax = ax; max = x[base + j]; } }
    if (amax === 0) { d[i] = 0; continue; } // qs already zero
    const iscale = fr(-127.0 / max);
    for (let j = 0; j < QK_K; ++j) {
      const v = nearestInt(fr(iscale * x[base + j]));
      qs[base + j] = Math.min(127, v);     // note: ggml clamps only the +side
    }
    for (let j = 0; j < 16; ++j) {
      let sum = 0;
      for (let ii = 0; ii < 16; ++ii) sum += qs[base + j * 16 + ii];
      bsums[i * 16 + j] = sum;
    }
    d[i] = fr(1.0 / iscale);
  }
  return { d, qs, bsums };
}

// ── Q8_0-activation path (Q4_0/Q5_0/Q8_0 weights dot against a Q8_0-quantized
//    activation, vec_dot_type = Q8_0). ──

const roundAway = (x) => x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5); // roundf
// f32 -> f16 bits, round-to-nearest-even (matches GGML_FP32_TO_FP16 software path).
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
export function f32ToF16(val) {
  _f[0] = val; const x = _u[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = (x >>> 23) & 0xff, mant = x & 0x7fffff;
  if (exp === 0xff) return sign | (mant ? 0x7e00 : 0x7c00);
  exp = exp - 127 + 15;
  if (exp >= 0x1f) return sign | 0x7c00;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - exp, h = mant >> shift, rem = mant & ((1 << shift) - 1), half = 1 << (shift - 1);
    return sign | (h + ((rem > half || (rem === half && (h & 1))) ? 1 : 0));
  }
  const h = (exp << 10) | (mant >> 13), rem = mant & 0x1fff;
  return sign | (h + ((rem > 0x1000 || (rem === 0x1000 && (h & 1))) ? 1 : 0));
}

// quantize_row_q8_0_ref (ggml-quants.c:234). Returns {d: f16-roundtripped scale per
// block, qs: int8 quants}. qs uses the FULL-precision id; d is the stored fp16 value.
export function quantizeRowQ8_0(x, k = x.length) {
  const nb = k / 32, d = new Float32Array(nb), qs = new Int8Array(k);
  for (let i = 0; i < nb; i++) {
    const base = i * 32;
    let amax = 0; for (let j = 0; j < 32; j++) { const a = Math.abs(x[base + j]); if (a > amax) amax = a; }
    const dFull = fr(amax / 127), id = dFull ? fr(1.0 / dFull) : 0;
    d[i] = f16ToF32(f32ToF16(dFull));
    for (let j = 0; j < 32; j++) qs[base + j] = roundAway(fr(x[base + j] * id));
  }
  return { d, qs };
}

// vec_dot_q8_0_q8_0_generic (quants.c:740)
export function vecDotQ8_0(nb, q8w, q8a, wOff = 0, aBlk = 0) {
  const dv = new DataView(q8w.buffer, q8w.byteOffset, q8w.byteLength);
  let sumf = 0;
  for (let ib = 0; ib < nb; ib++) {
    const bp = wOff + ib * 34, qb = bp + 2, ab = (aBlk + ib) * 32;
    let sumi = 0; for (let j = 0; j < 32; j++) sumi += ((q8w[qb + j] << 24) >> 24) * q8a.qs[ab + j];
    sumf = fr(sumf + fr(fr(f16ToF32(dv.getUint16(bp, true)) * q8a.d[aBlk + ib]) * sumi));
  }
  return sumf;
}

// vec_dot_q5_0_q8_0_generic (quants.c:654)
export function vecDotQ5_0(nb, q5w, q8a, wOff = 0, aBlk = 0) {
  const dv = new DataView(q5w.buffer, q5w.byteOffset, q5w.byteLength);
  let sumf = 0;
  for (let ib = 0; ib < nb; ib++) {
    const bp = wOff + ib * 22, qs = bp + 6, ab = (aBlk + ib) * 32;
    const qh = dv.getUint32(bp + 2, true);
    let s0 = 0, s1 = 0;
    for (let j = 0; j < 16; j++) {
      const xh0 = ((qh & (1 << j)) >>> j) << 4;
      const xh1 = (qh & (1 << (j + 16))) >>> (j + 12);
      const x0 = (((q5w[qs + j] & 0x0f) | xh0) - 16) << 24 >> 24;
      const x1 = (((q5w[qs + j] >> 4) | xh1) - 16) << 24 >> 24;
      s0 += x0 * q8a.qs[ab + j]; s1 += x1 * q8a.qs[ab + j + 16];
    }
    sumf = fr(sumf + fr(fr(f16ToF32(dv.getUint16(bp, true)) * q8a.d[aBlk + ib]) * (s0 + s1)));
  }
  return sumf;
}

// vec_dot_q4_0_q8_0_generic (quants.c:514)
export function vecDotQ4_0(nb, q4w, q8a, wOff = 0, aBlk = 0) {
  const dv = new DataView(q4w.buffer, q4w.byteOffset, q4w.byteLength);
  let sumf = 0;
  for (let ib = 0; ib < nb; ib++) {
    const bp = wOff + ib * 18, qs = bp + 2, ab = (aBlk + ib) * 32;
    let s0 = 0, s1 = 0;
    for (let j = 0; j < 16; j++) { s0 += ((q4w[qs + j] & 0x0f) - 8) * q8a.qs[ab + j]; s1 += ((q4w[qs + j] >> 4) - 8) * q8a.qs[ab + j + 16]; }
    sumf = fr(sumf + fr(fr(f16ToF32(dv.getUint16(bp, true)) * q8a.d[aBlk + ib]) * (s0 + s1)));
  }
  return sumf;
}

// 65536-entry f16→f32 LUT (== f16ToF32, branch-free). Every f16 is exactly representable
// in f32, so lut[h] is the exact decoded weight element.
let _f16lut = null;
function f16Lut() {
  if (_f16lut) return _f16lut;
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) t[h] = f16ToF32(h);
  return (_f16lut = t);
}
// ggml_fp32_to_fp16_row: round an f32 activation row to the f16 grid (the from_float for
// vec_dot_type=GGML_TYPE_F16). Returns a Float32Array of the f16-rounded values; compute
// ONCE per matvec and share across all output rows (exec.mjs F16 case does this).
export function f16Row(x, K = x.length) {
  const out = new Float32Array(K), lut = f16Lut();
  for (let i = 0; i < K; i++) out[i] = lut[f32ToF16(x[i])];
  return out;
}

// F16 weight · F16 activation, BIT-EXACT to ggml's ggml_vec_dot_f16 (vec.cpp:264) — and,
// for f16 operands, to BOTH x86 CPU tiers at once:
//   • SSE3   (forge-ref's build: GGML_FMA/F16C/AVX OFF, SSE42 ON; simd-mappings.h:887):
//     GGML_F16_STEP=32, EPR=4, ARR=8; FMA macro'd to add(mul(b,c),a) → two f32 roundings.
//   • AVX/AVX2 (+F16C+FMA; simd-mappings.h:568/622/583): STEP=32, EPR=8, ARR=4;
//     _mm256_fmadd_ps → one fused rounding.
// These two produce IDENTICAL bits for f16·f16: (1) STEP=32 in both ⇒ the 32 position-in-
// block accumulators sum element i+p across blocks in the same order, and their reduce
// folds to the same tree (16→8→4 then two horizontal adds); (2) each product is exact in
// f32 — an f16 has an ≤11-bit significand, so w·x has ≤22 bits ≤ f32's 24 — hence the
// intermediate rounding in SSE3's two-step FMA is a no-op and equals AVX's fused FMA.
// Proven empirically below + by witness vs vecdot-ref.exe (SSE3) AND vecdot-ref-avx2.exe.
// NOT covered: AVX512F (STEP=64 ⇒ different reduce tree) and AVX512-FP16 (native f16
// accumulate) — neither is forge-ref; if a build ever uses them this needs its own model.
// `dv` is a DataView over the weight bytes, `wOff` the byte offset of the row; `xh` is the
// f16-rounded activation from f16Row().
export function vecDotF16(dv, K, xh, wOff = 0) {
  const lut = f16Lut();
  const np = K & ~31;                      // largest multiple of GGML_F16_STEP (32)
  const acc = new Float32Array(32);        // 32 position-in-block accumulators
  for (let i = 0; i < np; i += 32)
    for (let p = 0; p < 32; p++) { const idx = i + p; acc[p] = fr(acc[p] + fr(lut[dv.getUint16(wOff + idx * 2, true)] * xh[idx])); }
  // reduce: fold 16→8→4 lane-wise (f32), then two horizontal adds (identical across tiers)
  for (let p = 0; p < 16; p++) acc[p] = fr(acc[p] + acc[p + 16]);
  for (let p = 0; p < 8; p++) acc[p] = fr(acc[p] + acc[p + 8]);
  for (let p = 0; p < 4; p++) acc[p] = fr(acc[p] + acc[p + 4]);
  const h0 = fr(acc[0] + acc[1]), h1 = fr(acc[2] + acc[3]);
  let sumf = fr(h0 + h1);                   // f32 horizontal sum → promoted to double
  for (let i = np; i < K; i++) sumf += fr(lut[dv.getUint16(wOff + i * 2, true)] * xh[i]); // tail in double
  return fr(sumf);                          // *s = (float) sumf
}

// ggml_vec_dot_tq2_0_q8_K_generic (quants.c:851). BitNet ternary weight (block_tq2_0:
// qs[QK_K/4]=64 bytes of 2-bit codes, f16 d at offset 64; 66 B/256 elems) dotted against
// a Q8_K-quantized activation. Each code is {0,1,2} → ternary value (code-1) ∈ {-1,0,1};
// the dot is a pure integer sum, scaled once per block by y.d·f16(x.d).
export function vecDotTq2_0(nb, qw, q8k, wOff = 0, q8kBlk = 0) {
  const dv = new DataView(qw.buffer, qw.byteOffset, qw.byteLength);
  let sumf = 0;
  for (let i = 0; i < nb; ++i) {
    const bp = wOff + i * 66, q8 = q8k.qs, q8base = (q8kBlk + i) * QK_K;
    let sumi = 0;
    for (let j = 0; j < 64; j += 32)
      for (let l = 0; l < 4; ++l)
        for (let k = 0; k < 32; ++k)
          sumi += q8[q8base + j * 4 + l * 32 + k] * ((((qw[bp + j + k] >> (l * 2)) & 3)) - 1);
    const d = fr(q8k.d[q8kBlk + i] * f16ToF32(dv.getUint16(bp + 64, true)));
    sumf = fr(sumf + fr(sumi * d));
  }
  return sumf;
}

const kmask1 = 0x3f3f3f3f, kmask2 = 0x0f0f0f0f, kmask3 = 0x03030303;

// ggml_vec_dot_q4_K_q8_K_generic (quants.c:1098). q4k: Uint8Array(nb*144). q8k: {d,qs,bsums}.
// Returns the float32 dot of `nb*256` weights against the activation block.
export function vecDotQ4K(nb, q4k, q8k, q4kOff = 0, q8kBlk = 0) {
  const dv = new DataView(q4k.buffer, q4k.byteOffset, q4k.byteLength);
  const aux8 = new Int8Array(QK_K), aux16 = new Int16Array(8), aux32 = new Int32Array(8);
  const sums = new Float32Array(8);
  const utmp = new Uint32Array(4), ubytes = new Uint8Array(utmp.buffer); // scales=ubytes[0..7], mins=ubytes[8..15]
  let sumf = 0;
  for (let i = 0; i < nb; ++i) {
    const bp = q4kOff + i * 144;
    const dW = f16ToF32(dv.getUint16(bp, true)), dminW = f16ToF32(dv.getUint16(bp + 2, true));
    const scBase = bp + 4, q4Base = bp + 16;
    // unpack nibbles into aux8 (low32 then high32 per 64-group) — raw 0..15
    let a = 0, q4 = q4Base;
    for (let j = 0; j < QK_K / 64; ++j) {
      for (let l = 0; l < 32; ++l) aux8[a + l] = q4k[q4 + l] & 0x0f;
      a += 32;
      for (let l = 0; l < 32; ++l) aux8[a + l] = q4k[q4 + l] >> 4;
      a += 32; q4 += 32;
    }
    // 6-bit scales/mins via the kmask trick (== get_scale_min_k4, vectorised)
    utmp[0] = dv.getUint32(scBase, true); utmp[1] = dv.getUint32(scBase + 4, true); utmp[2] = dv.getUint32(scBase + 8, true);
    utmp[3] = ((utmp[2] >>> 4) & kmask2) | (((utmp[1] >>> 6) & kmask3) << 4);
    const uaux = utmp[1] & kmask1;
    utmp[1] = (utmp[2] & kmask2) | (((utmp[0] >>> 6) & kmask3) << 4);
    utmp[2] = uaux;
    utmp[0] = utmp[0] & kmask1;

    aux32.fill(0);
    const q8 = q8k.qs, q8base = (q8kBlk + i) * QK_K, bs = q8k.bsums, bsBase = (q8kBlk + i) * 16;
    let sumi = 0;
    for (let j = 0; j < 16; ++j) sumi += bs[bsBase + j] * ubytes[8 + (j >> 1)]; // mins[j/2]
    a = 0; let qi = q8base, is = 0;
    for (let j = 0; j < QK_K / 32; ++j) {
      const scale = ubytes[is++];
      for (let g = 0; g < 4; ++g) {
        for (let l = 0; l < 8; ++l) aux16[l] = q8[qi + l] * aux8[a + l];
        for (let l = 0; l < 8; ++l) aux32[l] += scale * aux16[l];
        qi += 8; a += 8;
      }
    }
    const d = fr(fr(dW * q8k.d[q8kBlk + i]));
    for (let l = 0; l < 8; ++l) sums[l] = fr(sums[l] + fr(d * aux32[l]));
    const dmin = fr(dminW * q8k.d[q8kBlk + i]);
    sumf = fr(sumf - fr(dmin * sumi));
  }
  for (let l = 0; l < 8; ++l) sumf = fr(sumf + sums[l]);
  return sumf;
}

// ggml_vec_dot_q6_K_q8_K_generic (quants.c:1253). q6k: Uint8Array(nb*210).
export function vecDotQ6K(nb, q6k, q8k, q6kOff = 0, q8kBlk = 0) {
  const dv = new DataView(q6k.buffer, q6k.byteOffset, q6k.byteLength);
  const s8 = (b) => (b << 24) >> 24;
  const aux8 = new Int8Array(QK_K), aux16 = new Int16Array(8), aux32 = new Int32Array(8);
  const sums = new Float32Array(8);
  let sumf = 0;
  for (let i = 0; i < nb; ++i) {
    const bp = q6kOff + i * 210;
    const dW = f16ToF32(dv.getUint16(bp + 208, true));
    let ql = bp, qh = bp + 128, sc = bp + 192;
    // build aux8 (signed 6-bit q - 32)
    let a = 0;
    for (let j = 0; j < QK_K; j += 128) {
      for (let l = 0; l < 32; ++l) {
        aux8[a + l +  0] = s8((q6k[ql + l +  0] & 0x0f) | (((q6k[qh + l] >> 0) & 3) << 4)) - 32;
        aux8[a + l + 32] = s8((q6k[ql + l + 32] & 0x0f) | (((q6k[qh + l] >> 2) & 3) << 4)) - 32;
        aux8[a + l + 64] = s8((q6k[ql + l +  0] >>   4) | (((q6k[qh + l] >> 4) & 3) << 4)) - 32;
        aux8[a + l + 96] = s8((q6k[ql + l + 32] >>   4) | (((q6k[qh + l] >> 6) & 3) << 4)) - 32;
      }
      a += 128; ql += 64; qh += 32;
    }
    aux32.fill(0);
    const q8 = q8k.qs, q8base = (q8kBlk + i) * QK_K;
    a = 0; let qi = q8base, is = 0;
    for (let j = 0; j < QK_K / 16; ++j) {
      const scale = s8(q6k[sc + is++]);
      for (let g = 0; g < 2; ++g) {
        for (let l = 0; l < 8; ++l) aux16[l] = q8[qi + l] * aux8[a + l];
        for (let l = 0; l < 8; ++l) aux32[l] += scale * aux16[l];
        qi += 8; a += 8;
      }
    }
    const d = fr(dW * q8k.d[q8kBlk + i]);
    for (let l = 0; l < 8; ++l) sums[l] = fr(sums[l] + fr(d * aux32[l]));
  }
  for (let l = 0; l < 8; ++l) sumf = fr(sumf + sums[l]);
  return sumf;
}
