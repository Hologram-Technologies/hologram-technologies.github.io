// GGUF Forge — Tier-A dequantization oracle (float32-EXACT).
//
// This is the fidelity authority, NOT the runtime. Every floating op is wrapped
// in Math.fround so the evaluation matches ggml's `float` (binary32) arithmetic
// bit-for-bit, including intermediate rounding and left-to-right associativity.
// The substrate's qvac-ingest.mjs `dequantizeRaw` computes the same algebra in
// float64 — fine for the GPU engine (which re-quantizes anyway), but a few ULPs
// off the C++ truth. This module exists to be the bit-exact reference.
//
// Transcribed line-for-line from qvac-fabric-llm.cpp (llama.cpp b7248):
//   ggml/src/ggml-quants.c  dequantize_row_q4_K  (:1467)
//                            dequantize_row_q6_K  (:1877)
//                            get_scale_min_k4     (:818)
//                            dequantize_row_q8_0 / q4_0
//   ggml/src/ggml-common.h  block layouts: q4_K(:431) q6_K(:466) q8_0(:242)
//
// FP16->FP32 is exact (binary32 is a superset of binary16), so f16ToF32 needs no
// fround. The hazards are the scale/quant multiplies and the min subtraction.

import { f16ToF32 } from "../qvac-ingest.mjs";
import { makeIQ } from "./gguf-forge-iq-dequant.mjs";

const fr = Math.fround;
const QK_K = 256, K_SCALE_SIZE = 12;

// Tier-A IQ dequant: bound to Math.fround for binary32-exact output (witnessed
// bit-for-bit vs ggml to_float in gguf-forge-iq.test.mjs).
const {
  dequantIQ2XXS, dequantIQ2XS, dequantIQ2S, dequantIQ3XXS, dequantIQ3S,
  dequantIQ1S, dequantIQ1M, dequantIQ4NL, dequantIQ4XS,
} = makeIQ(fr, f16ToF32);

export const GGML = {
  F32: 0, F16: 1, Q4_0: 2, Q4_1: 3, Q5_0: 6, Q5_1: 7, Q8_0: 8,
  Q2_K: 10, Q3_K: 11, Q4_K: 12, Q5_K: 13, Q6_K: 14,
  IQ2_XXS: 16, IQ2_XS: 17, IQ3_XXS: 18, IQ1_S: 19, IQ4_NL: 20, IQ3_S: 21, IQ2_S: 22, IQ4_XS: 23, IQ1_M: 29,
  TQ2_0: 35,
};

// BitNet ternary. block_tq2_0 (ggml-common.h:273): uint8_t qs[QK_K/4]=64, ggml_half d.
// 66 B / 256 elems = 2.0625 bpw. dequantize_row_tq2_0 (ggml-quants.c:3056): each weight
// is {-1,0,1}: q = (qs[j+m] >> (l*2)) & 3 over j∈{0,32} l∈0..3 m∈0..31, y = (q-1)·d.
export function dequantTq2_0(raw, elements) {
  const out = new Float32Array(elements);
  const nb = elements / QK_K;
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let o = 0, base = 0;
  for (let i = 0; i < nb; ++i) {
    const d = f16ToF32(dv.getUint16(base + 64, true)); // qs[0..63] then d
    for (let j = 0; j < 64; j += 32)
      for (let l = 0; l < 4; ++l)
        for (let m = 0; m < 32; ++m) {
          const q = (raw[base + j + m] >> (l * 2)) & 3;
          out[o++] = fr((q - 1) * d);
        }
    base += 66;
  }
  return out;
}

// On-disk bytes per `elements` of a ggml type (mirror of type_byte_len / ggml.c block table).
export function typeByteLen(t, elements) {
  switch (t) {
    case GGML.F32: return elements * 4;
    case GGML.F16: return elements * 2;
    case GGML.Q8_0: return (elements / 32) * 34;
    case GGML.Q4_0: return (elements / 32) * 18;
    case GGML.Q4_1: return (elements / 32) * 20;
    case GGML.Q5_0: return (elements / 32) * 22;
    case GGML.Q5_1: return (elements / 32) * 24;
    case GGML.Q2_K: return (elements / QK_K) * 84;
    case GGML.Q3_K: return (elements / QK_K) * 110;
    case GGML.Q4_K: return (elements / QK_K) * 144;
    case GGML.Q5_K: return (elements / QK_K) * 176;
    case GGML.Q6_K: return (elements / QK_K) * 210;
    case GGML.IQ2_XXS: return (elements / QK_K) * 66;
    case GGML.IQ2_XS:  return (elements / QK_K) * 74;
    case GGML.IQ2_S:   return (elements / QK_K) * 82;
    case GGML.IQ3_XXS: return (elements / QK_K) * 98;
    case GGML.IQ3_S:   return (elements / QK_K) * 110;
    case GGML.IQ1_S:   return (elements / QK_K) * 50;
    case GGML.IQ1_M:   return (elements / QK_K) * 56;
    case GGML.IQ4_NL:  return (elements / 32) * 18;
    case GGML.IQ4_XS:  return (elements / QK_K) * 136;
    case GGML.TQ2_0:   return (elements / QK_K) * 66;
    default: throw new Error("oracle: unsupported ggml type " + t);
  }
}

// get_scale_min_k4 (ggml-quants.c:818). `q` is a Uint8Array view, `base` the
// byte offset of the 12-byte scales array. Returns [scale6bit, min6bit].
function scaleMinK4(j, q, base) {
  if (j < 4) {
    return [q[base + j] & 63, q[base + j + 4] & 63];
  }
  return [
    (q[base + j + 4] & 0x0f) | ((q[base + j - 4] >> 6) << 4),
    (q[base + j + 4] >> 4) | ((q[base + j - 0] >> 6) << 4),
  ];
}

// dequantize_row_q4_K (ggml-quants.c:1467). Block = 144 B:
//   d:f16(2) dmin:f16(2) scales:12 qs:128(=256 nibbles).
export function dequantQ4K(raw, elements) {
  const out = new Float32Array(elements);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const nb = elements / QK_K;
  let o = 0;
  for (let i = 0; i < nb; i++) {
    const bp = i * 144;
    const d = f16ToF32(dv.getUint16(bp, true));        // float32 (exact)
    const min = f16ToF32(dv.getUint16(bp + 2, true));  // float32 (exact)
    const scBase = bp + 4, qBase = bp + 16;
    let is = 0, q = qBase;
    for (let j = 0; j < QK_K; j += 64) {
      let [sc, m] = scaleMinK4(is + 0, raw, scBase);
      const d1 = fr(d * sc), m1 = fr(min * m);
      [sc, m] = scaleMinK4(is + 1, raw, scBase);
      const d2 = fr(d * sc), m2 = fr(min * m);
      for (let l = 0; l < 32; ++l) out[o++] = fr(fr(d1 * (raw[q + l] & 0x0f)) - m1);
      for (let l = 0; l < 32; ++l) out[o++] = fr(fr(d2 * (raw[q + l] >> 4)) - m2);
      q += 32; is += 2;
    }
  }
  return out;
}

// dequantize_row_q6_K (ggml-quants.c:1877). Block = 210 B:
//   ql:128 qh:64 scales:int8[16] d:f16(2).
export function dequantQ6K(raw, elements) {
  const out = new Float32Array(elements);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const nb = elements / QK_K;
  const s8 = (b) => (b << 24) >> 24; // int8 reinterpret
  let o = 0;
  for (let i = 0; i < nb; i++) {
    const bp = i * 210;
    const d = f16ToF32(dv.getUint16(bp + 208, true));
    let ql = bp, qh = bp + 128, sc = bp + 192;
    let y = o;
    for (let n = 0; n < QK_K; n += 128) {
      for (let l = 0; l < 32; ++l) {
        const is = (l / 16) | 0;
        const q1 = s8((raw[ql + l +  0] & 0x0f) | (((raw[qh + l] >> 0) & 3) << 4)) - 32;
        const q2 = s8((raw[ql + l + 32] & 0x0f) | (((raw[qh + l] >> 2) & 3) << 4)) - 32;
        const q3 = s8((raw[ql + l +  0] >>   4) | (((raw[qh + l] >> 4) & 3) << 4)) - 32;
        const q4 = s8((raw[ql + l + 32] >>   4) | (((raw[qh + l] >> 6) & 3) << 4)) - 32;
        out[y + l +  0] = fr(fr(d * s8(raw[sc + is + 0])) * q1);
        out[y + l + 32] = fr(fr(d * s8(raw[sc + is + 2])) * q2);
        out[y + l + 64] = fr(fr(d * s8(raw[sc + is + 4])) * q3);
        out[y + l + 96] = fr(fr(d * s8(raw[sc + is + 6])) * q4);
      }
      y += 128; ql += 64; qh += 32; sc += 8;
    }
    o += QK_K;
  }
  return out;
}

// dequantize_row_q2_K (ggml-quants.c:899). Block = 84 B: scales[16] qs[64] d:f16 dmin:f16.
//   16 sub-blocks of 16; y = d*(sc&0xF)*q2 - dmin*(sc>>4), q2 = (qs>>shift)&3.
export function dequantQ2K(raw, elements) {
  const out = new Float32Array(elements);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const nb = elements / QK_K;
  let o = 0;
  for (let i = 0; i < nb; i++) {
    const bp = i * 84, scB = bp, qB = bp + 16;
    const d = f16ToF32(dv.getUint16(bp + 80, true)), min = f16ToF32(dv.getUint16(bp + 82, true));
    let is = 0;
    for (let n = 0; n < QK_K; n += 128) {
      const q = qB + (n / 128) * 32;
      for (let shift = 0; shift < 8; shift += 2) {
        let sc = raw[scB + is++], dl = fr(d * (sc & 0xf)), ml = fr(min * (sc >> 4));
        for (let l = 0; l < 16; ++l) out[o++] = fr(fr(dl * ((raw[q + l] >> shift) & 3)) - ml);
        sc = raw[scB + is++]; dl = fr(d * (sc & 0xf)); ml = fr(min * (sc >> 4));
        for (let l = 0; l < 16; ++l) out[o++] = fr(fr(dl * ((raw[q + l + 16] >> shift) & 3)) - ml);
      }
    }
  }
  return out;
}

// dequantize_row_q3_K (ggml-quants.c:1243). Block = 110 B: hmask[32] qs[64] scales[12] d:f16.
//   6-bit signed scales (unpacked via the kmask trick); y = d*(sc-32)*(q2 - (hbit?0:4)).
export function dequantQ3K(raw, elements) {
  const out = new Float32Array(elements);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const nb = elements / QK_K, km1 = 0x03030303, km2 = 0x0f0f0f0f;
  const aux = new Uint32Array(4), sb = new Int8Array(aux.buffer);
  let o = 0;
  for (let i = 0; i < nb; i++) {
    const bp = i * 110, hmB = bp, qB = bp + 32, scB = bp + 96;
    const dAll = f16ToF32(dv.getUint16(bp + 108, true));
    aux[0] = dv.getUint32(scB, true); aux[1] = dv.getUint32(scB + 4, true); aux[2] = dv.getUint32(scB + 8, true);
    const tmp = aux[2];
    aux[2] = ((aux[0] >>> 4) & km2) | (((tmp >>> 4) & km1) << 4);
    aux[3] = ((aux[1] >>> 4) & km2) | (((tmp >>> 6) & km1) << 4);
    aux[0] = (aux[0] & km2) | (((tmp >>> 0) & km1) << 4);
    aux[1] = (aux[1] & km2) | (((tmp >>> 2) & km1) << 4);
    let is = 0, m = 1;
    for (let n = 0; n < QK_K; n += 128) {
      const q = qB + (n / 128) * 32;
      for (let shift = 0; shift < 8; shift += 2) {
        let dl = fr(dAll * (sb[is++] - 32));
        for (let l = 0; l < 16; ++l) out[o++] = fr(dl * (((raw[q + l] >> shift) & 3) - ((raw[hmB + l] & m) ? 0 : 4)));
        dl = fr(dAll * (sb[is++] - 32));
        for (let l = 0; l < 16; ++l) out[o++] = fr(dl * (((raw[q + l + 16] >> shift) & 3) - ((raw[hmB + l + 16] & m) ? 0 : 4)));
        m <<= 1;
      }
    }
  }
  return out;
}

// dequantize_row_q5_K (ggml-quants.c:1669). Block = 176 B: d:f16 dmin:f16 scales[12] qh[32] qs[128].
//   like Q4_K (6-bit scales/mins via get_scale_min_k4) + a high 5th bit from qh.
export function dequantQ5K(raw, elements) {
  const out = new Float32Array(elements);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const nb = elements / QK_K;
  let o = 0;
  for (let i = 0; i < nb; i++) {
    const bp = i * 176, scB = bp + 4, qhB = bp + 16, qlB = bp + 48;
    const d = f16ToF32(dv.getUint16(bp, true)), min = f16ToF32(dv.getUint16(bp + 2, true));
    let is = 0, ql = qlB, u1 = 1, u2 = 2;
    for (let j = 0; j < QK_K; j += 64) {
      let [sc, m] = scaleMinK4(is + 0, raw, scB);
      const d1 = fr(d * sc), m1 = fr(min * m);
      [sc, m] = scaleMinK4(is + 1, raw, scB);
      const d2 = fr(d * sc), m2 = fr(min * m);
      for (let l = 0; l < 32; ++l) out[o++] = fr(fr(d1 * ((raw[ql + l] & 0xf) + ((raw[qhB + l] & u1) ? 16 : 0))) - m1);
      for (let l = 0; l < 32; ++l) out[o++] = fr(fr(d2 * ((raw[ql + l] >> 4) + ((raw[qhB + l] & u2) ? 16 : 0))) - m2);
      ql += 32; is += 2; u1 <<= 2; u2 <<= 2;
    }
  }
  return out;
}

// dequantize_row_q8_0. Block = 34 B: d:f16(2) qs:int8[32]. y = d * qs.
export function dequantQ8_0(raw, elements) {
  const out = new Float32Array(elements);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const nb = elements / 32;
  let o = 0;
  for (let i = 0; i < nb; i++) {
    const bp = i * 34;
    const d = f16ToF32(dv.getUint16(bp, true));
    for (let j = 0; j < 32; ++j) out[o++] = fr(d * ((raw[bp + 2 + j] << 24) >> 24));
  }
  return out;
}

// dequantize_row_q4_0. Block = 18 B: d:f16(2) qs:nibbles[16]. Interleaved halves:
//   y[j] = d*((qs[j]&0xF)-8); y[j+16] = d*((qs[j]>>4)-8).
export function dequantQ4_0(raw, elements) {
  const out = new Float32Array(elements);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const nb = elements / 32;
  let o = 0;
  for (let i = 0; i < nb; i++) {
    const bp = i * 18, qs = bp + 2;
    const d = f16ToF32(dv.getUint16(bp, true));
    for (let j = 0; j < 16; ++j) out[o + j] = fr(d * ((raw[qs + j] & 0x0f) - 8));
    for (let j = 0; j < 16; ++j) out[o + 16 + j] = fr(d * ((raw[qs + j] >> 4) - 8));
    o += 32;
  }
  return out;
}

// dequantize_row_q5_0 (ggml-quants.c:438). Block = 22 B: d:f16(2) qh:u32(4) qs:16.
//   xh from the 5th-bit field qh; y = d*((nibble|xh) - 16).
export function dequantQ5_0(raw, elements) {
  const out = new Float32Array(elements);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const nb = elements / 32;
  let o = 0;
  for (let i = 0; i < nb; i++) {
    const bp = i * 22, qsB = bp + 6;
    const d = f16ToF32(dv.getUint16(bp, true));
    const qh = dv.getUint32(bp + 2, true);
    for (let j = 0; j < 16; ++j) {
      const xh0 = ((qh >>> (j + 0)) << 4) & 0x10;
      const xh1 = ((qh >>> (j + 12))) & 0x10;
      out[o + j] = fr(d * (((raw[qsB + j] & 0x0f) | xh0) - 16));
      out[o + 16 + j] = fr(d * (((raw[qsB + j] >> 4) | xh1) - 16));
    }
    o += 32;
  }
  return out;
}

// dequantize_row_q5_1 (ggml-quants.c:464). Block = 24 B: d:f16 m:f16 qh:u32 qs:16.
export function dequantQ5_1(raw, elements) {
  const out = new Float32Array(elements);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const nb = elements / 32;
  let o = 0;
  for (let i = 0; i < nb; i++) {
    const bp = i * 24, qsB = bp + 8;
    const d = f16ToF32(dv.getUint16(bp, true)), m = f16ToF32(dv.getUint16(bp + 2, true));
    const qh = dv.getUint32(bp + 4, true);
    for (let j = 0; j < 16; ++j) {
      const xh0 = ((qh >>> (j + 0)) << 4) & 0x10;
      const xh1 = ((qh >>> (j + 12))) & 0x10;
      out[o + j] = fr(fr(((raw[qsB + j] & 0x0f) | xh0) * d) + m);
      out[o + 16 + j] = fr(fr(((raw[qsB + j] >> 4) | xh1) * d) + m);
    }
    o += 32;
  }
  return out;
}

export function dequantF16(raw, elements) {
  const out = new Float32Array(elements);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < elements; ++i) out[i] = f16ToF32(dv.getUint16(i * 2, true));
  return out;
}

export function dequantF32(raw, elements) {
  const out = new Float32Array(elements);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < elements; ++i) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

// Dispatch: ggml type -> float32-exact Float32Array.
export function dequantizeExact(t, raw, elements) {
  switch (t) {
    case GGML.F32:  return dequantF32(raw, elements);
    case GGML.F16:  return dequantF16(raw, elements);
    case GGML.Q8_0: return dequantQ8_0(raw, elements);
    case GGML.Q4_0: return dequantQ4_0(raw, elements);
    case GGML.Q5_0: return dequantQ5_0(raw, elements);
    case GGML.Q5_1: return dequantQ5_1(raw, elements);
    case GGML.Q2_K: return dequantQ2K(raw, elements);
    case GGML.Q3_K: return dequantQ3K(raw, elements);
    case GGML.Q4_K: return dequantQ4K(raw, elements);
    case GGML.Q5_K: return dequantQ5K(raw, elements);
    case GGML.Q6_K: return dequantQ6K(raw, elements);
    case GGML.IQ2_XXS: return dequantIQ2XXS(raw, elements);
    case GGML.IQ2_XS:  return dequantIQ2XS(raw, elements);
    case GGML.IQ2_S:   return dequantIQ2S(raw, elements);
    case GGML.IQ3_XXS: return dequantIQ3XXS(raw, elements);
    case GGML.IQ3_S:   return dequantIQ3S(raw, elements);
    case GGML.IQ1_S:   return dequantIQ1S(raw, elements);
    case GGML.IQ1_M:   return dequantIQ1M(raw, elements);
    case GGML.IQ4_NL:  return dequantIQ4NL(raw, elements);
    case GGML.IQ4_XS:  return dequantIQ4XS(raw, elements);
    case GGML.TQ2_0:   return dequantTq2_0(raw, elements);
    default: throw new Error("oracle: unsupported ggml type " + t);
  }
}
