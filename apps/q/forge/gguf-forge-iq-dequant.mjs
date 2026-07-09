// IQ-quant dequantization, transcribed line-for-line from ggml-quants.c
// (llama.cpp b7248): dequantize_row_iq2_xxs:3077 iq2_xs:3105 iq2_s:3132
// iq3_xxs:3164 iq3_s:3196 iq1_s:3239 iq1_m:3264 iq4_nl:3314 iq4_xs:3332.
// Block layouts: ggml-common.h:485-563.
//
// ONE source of truth, two behaviours: makeIQ(fr, f16ToF32) binds the rounding
// function. The Tier-A oracle passes Math.fround (binary32-exact, witnessed
// bit-for-bit vs ggml to_float in gguf-forge-iq.test.mjs); the runtime passes
// identity (float64, fine for the GPU engine which re-quantizes anyway).
//
// Codebook grids are flattened little-endian byte runs (gguf-forge-iq-grids.mjs):
// an entry `idx` of stride S occupies bytes [idx*S .. idx*S+S). iq2*/iq3* read
// uint8, iq1s_grid / kvalues_iq4nl read int8.

import {
  iq2xxs_grid, iq2xs_grid, iq2s_grid, iq3xxs_grid, iq3s_grid, iq1s_grid,
  ksigns_iq2xs, kmask_iq2xs, kvalues_iq4nl,
} from "./gguf-forge-iq-grids.mjs";

const QK_K = 256;
const IQ1S_DELTA = 0.125, IQ1M_DELTA = 0.125;
const s8 = (b) => (b << 24) >> 24; // uint8 -> int8

export function makeIQ(fr, f16ToF32) {
  const sign1 = (signs, j) => (signs & kmask_iq2xs[j] ? -1 : 1);

  // dequantize_row_iq2_xxs (:3077). Block 66 B: d:f16 qs:uint16[32].
  function dequantIQ2XXS(raw, elements) {
    const out = new Float32Array(elements);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const nb = elements / QK_K; let o = 0;
    for (let i = 0; i < nb; i++) {
      const bp = i * 66, qs = bp + 2;
      const d = f16ToF32(dv.getUint16(bp, true));
      for (let ib32 = 0; ib32 < QK_K / 32; ++ib32) {
        const a0 = dv.getUint32(qs + 8 * ib32, true), a1 = dv.getUint32(qs + 8 * ib32 + 4, true);
        const db = fr(fr(d * fr(0.5 + (a1 >>> 28))) * 0.25);
        for (let l = 0; l < 4; ++l) {
          const idx = (a0 >>> (8 * l)) & 0xff;
          const signs = ksigns_iq2xs[(a1 >>> (7 * l)) & 127];
          for (let j = 0; j < 8; ++j) out[o++] = sign1(signs, j) * fr(db * iq2xxs_grid[idx * 8 + j]);
        }
      }
    }
    return out;
  }

  // dequantize_row_iq2_xs (:3105). Block 74 B: d:f16 qs:uint16[32] scales:uint8[8].
  function dequantIQ2XS(raw, elements) {
    const out = new Float32Array(elements);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const nb = elements / QK_K; let o = 0;
    for (let i = 0; i < nb; i++) {
      const bp = i * 74, qs = bp + 2, scB = bp + 66;
      const d = f16ToF32(dv.getUint16(bp, true));
      for (let ib32 = 0; ib32 < QK_K / 32; ++ib32) {
        const db = [fr(fr(d * fr(0.5 + (raw[scB + ib32] & 0xf))) * 0.25),
                    fr(fr(d * fr(0.5 + (raw[scB + ib32] >> 4))) * 0.25)];
        for (let l = 0; l < 4; ++l) {
          const q = dv.getUint16(qs + (4 * ib32 + l) * 2, true);
          const idx = q & 511, signs = ksigns_iq2xs[q >> 9], dl = db[l >> 1];
          for (let j = 0; j < 8; ++j) out[o++] = sign1(signs, j) * fr(dl * iq2xs_grid[idx * 8 + j]);
        }
      }
    }
    return out;
  }

  // dequantize_row_iq2_s (:3132). Block 82 B: d:f16 qs:uint8[64] qh:uint8[8] scales:uint8[8].
  //   signs = qs + 32 (second half of qs); idx = qs[l] | ((qh[ib32]<<(8-2l)) & 0x300).
  function dequantIQ2S(raw, elements) {
    const out = new Float32Array(elements);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const nb = elements / QK_K; let o = 0;
    for (let i = 0; i < nb; i++) {
      const bp = i * 82, qhB = bp + 66, scB = bp + 74;
      const d = f16ToF32(dv.getUint16(bp, true));
      let qs = bp + 2, signs = bp + 2 + 32;
      for (let ib32 = 0; ib32 < QK_K / 32; ++ib32) {
        const db = [fr(fr(d * fr(0.5 + (raw[scB + ib32] & 0xf))) * 0.25),
                    fr(fr(d * fr(0.5 + (raw[scB + ib32] >> 4))) * 0.25)];
        for (let l = 0; l < 4; ++l) {
          const dl = db[l >> 1];
          const idx = raw[qs + l] | (((raw[qhB + ib32] << (8 - 2 * l)) & 0x300));
          for (let j = 0; j < 8; ++j) out[o++] = sign1(raw[signs + l], j) * fr(dl * iq2s_grid[idx * 8 + j]);
        }
        qs += 4; signs += 4;
      }
    }
    return out;
  }

  // dequantize_row_iq3_xxs (:3164). Block 98 B: d:f16 qs:uint8[96].
  //   qs[0..63]=grid idx; scales_and_signs = qs+64 (8 uint32). db scale uses *0.5.
  function dequantIQ3XXS(raw, elements) {
    const out = new Float32Array(elements);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const nb = elements / QK_K; let o = 0;
    for (let i = 0; i < nb; i++) {
      const bp = i * 98, ss = bp + 2 + 64;
      const d = f16ToF32(dv.getUint16(bp, true));
      let qs = bp + 2;
      for (let ib32 = 0; ib32 < QK_K / 32; ++ib32) {
        const a32 = dv.getUint32(ss + 4 * ib32, true);
        const db = fr(fr(d * fr(0.5 + (a32 >>> 28))) * 0.5);
        for (let l = 0; l < 4; ++l) {
          const signs = ksigns_iq2xs[(a32 >>> (7 * l)) & 127];
          const g1 = raw[qs + 2 * l] * 4, g2 = raw[qs + 2 * l + 1] * 4;
          for (let j = 0; j < 4; ++j) {
            out[o + j + 0] = sign1(signs, j + 0) * fr(db * iq3xxs_grid[g1 + j]);
            out[o + j + 4] = sign1(signs, j + 4) * fr(db * iq3xxs_grid[g2 + j]);
          }
          o += 8;
        }
        qs += 8;
      }
    }
    return out;
  }

  // dequantize_row_iq3_s (:3196). Block 110 B: d:f16 qs:uint8[64] qh:uint8[8] signs:uint8[32] scales:uint8[4].
  function dequantIQ3S(raw, elements) {
    const out = new Float32Array(elements);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const nb = elements / QK_K; let o = 0;
    for (let i = 0; i < nb; i++) {
      const bp = i * 110, scB = bp + 106;
      const d = f16ToF32(dv.getUint16(bp, true));
      let qs = bp + 2, qh = bp + 66, signs = bp + 74;
      for (let ib32 = 0; ib32 < QK_K / 32; ib32 += 2) {
        const db1 = fr(d * (1 + 2 * (raw[scB + (ib32 >> 1)] & 0xf)));
        const db2 = fr(d * (1 + 2 * (raw[scB + (ib32 >> 1)] >> 4)));
        for (let l = 0; l < 4; ++l) {
          const g1 = (raw[qs + 2 * l] | ((raw[qh] << (8 - 2 * l)) & 256)) * 4;
          const g2 = (raw[qs + 2 * l + 1] | ((raw[qh] << (7 - 2 * l)) & 256)) * 4;
          for (let j = 0; j < 4; ++j) {
            out[o + j + 0] = sign1(raw[signs + l], j + 0) * fr(db1 * iq3s_grid[g1 + j]);
            out[o + j + 4] = sign1(raw[signs + l], j + 4) * fr(db1 * iq3s_grid[g2 + j]);
          }
          o += 8;
        }
        qs += 8; signs += 4;
        for (let l = 0; l < 4; ++l) {
          const g1 = (raw[qs + 2 * l] | ((raw[qh + 1] << (8 - 2 * l)) & 256)) * 4;
          const g2 = (raw[qs + 2 * l + 1] | ((raw[qh + 1] << (7 - 2 * l)) & 256)) * 4;
          for (let j = 0; j < 4; ++j) {
            out[o + j + 0] = sign1(raw[signs + l], j + 0) * fr(db2 * iq3s_grid[g1 + j]);
            out[o + j + 4] = sign1(raw[signs + l], j + 4) * fr(db2 * iq3s_grid[g2 + j]);
          }
          o += 8;
        }
        qh += 2; qs += 8; signs += 4;
      }
    }
    return out;
  }

  // dequantize_row_iq1_s (:3239). Block 50 B: d:f16 qs:uint8[32] qh:uint16[8]. grid int8.
  function dequantIQ1S(raw, elements) {
    const out = new Float32Array(elements);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const nb = elements / QK_K; let o = 0;
    for (let i = 0; i < nb; i++) {
      const bp = i * 50, qhB = bp + 34;
      const d = f16ToF32(dv.getUint16(bp, true));
      let qs = bp + 2;
      for (let ib = 0; ib < QK_K / 32; ++ib) {
        const qh = dv.getUint16(qhB + 2 * ib, true);
        const dl = fr(d * (2 * ((qh >> 12) & 7) + 1));
        const delta = (qh & 0x8000) ? -IQ1S_DELTA : IQ1S_DELTA;
        for (let l = 0; l < 4; ++l) {
          const g = (raw[qs + l] | (((qh >> (3 * l)) & 7) << 8)) * 8;
          for (let j = 0; j < 8; ++j) out[o++] = fr(dl * fr(s8(iq1s_grid[g + j]) + delta));
        }
        qs += 4;
      }
    }
    return out;
  }

  // dequantize_row_iq1_m (:3264). Block 56 B: qs:uint8[32] qh:uint8[16] scales:uint8[8].
  //   No d field — f16 scale is woven from the four scale uint16s. grid int8.
  function dequantIQ1M(raw, elements) {
    const out = new Float32Array(elements);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const nb = elements / QK_K; let o = 0;
    const delta = new Float32Array(4), idx = new Uint16Array(4);
    for (let i = 0; i < nb; i++) {
      const bp = i * 56, scB = bp + 48;
      const sc = [dv.getUint16(scB, true), dv.getUint16(scB + 2, true), dv.getUint16(scB + 4, true), dv.getUint16(scB + 6, true)];
      const u16 = (sc[0] >> 12) | ((sc[1] >> 8) & 0x00f0) | ((sc[2] >> 4) & 0x0f00) | (sc[3] & 0xf000);
      const d = f16ToF32(u16);
      let qs = bp, qh = bp + 32;
      for (let ib = 0; ib < QK_K / 32; ++ib) {
        const dl1 = fr(d * (2 * ((sc[ib >> 1] >> (6 * (ib % 2) + 0)) & 0x7) + 1));
        const dl2 = fr(d * (2 * ((sc[ib >> 1] >> (6 * (ib % 2) + 3)) & 0x7) + 1));
        idx[0] = raw[qs + 0] | ((raw[qh + 0] << 8) & 0x700);
        idx[1] = raw[qs + 1] | ((raw[qh + 0] << 4) & 0x700);
        idx[2] = raw[qs + 2] | ((raw[qh + 1] << 8) & 0x700);
        idx[3] = raw[qs + 3] | ((raw[qh + 1] << 4) & 0x700);
        delta[0] = raw[qh + 0] & 0x08 ? -IQ1M_DELTA : IQ1M_DELTA;
        delta[1] = raw[qh + 0] & 0x80 ? -IQ1M_DELTA : IQ1M_DELTA;
        delta[2] = raw[qh + 1] & 0x08 ? -IQ1M_DELTA : IQ1M_DELTA;
        delta[3] = raw[qh + 1] & 0x80 ? -IQ1M_DELTA : IQ1M_DELTA;
        for (let l = 0; l < 2; ++l) {
          const g = idx[l] * 8;
          for (let j = 0; j < 8; ++j) out[o++] = fr(dl1 * fr(s8(iq1s_grid[g + j]) + delta[l]));
        }
        for (let l = 2; l < 4; ++l) {
          const g = idx[l] * 8;
          for (let j = 0; j < 8; ++j) out[o++] = fr(dl2 * fr(s8(iq1s_grid[g + j]) + delta[l]));
        }
        qs += 4; qh += 2;
      }
    }
    return out;
  }

  // dequantize_row_iq4_nl (:3314). Block 18 B / 32 elems: d:f16 qs:uint8[16]. kvalues int8.
  function dequantIQ4NL(raw, elements) {
    const out = new Float32Array(elements);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const nb = elements / 32; let o = 0;
    for (let i = 0; i < nb; i++) {
      const bp = i * 18, qs = bp + 2;
      const d = f16ToF32(dv.getUint16(bp, true));
      for (let j = 0; j < 16; ++j) {
        out[o + j] = fr(d * s8(kvalues_iq4nl[raw[qs + j] & 0xf]));
        out[o + 16 + j] = fr(d * s8(kvalues_iq4nl[raw[qs + j] >> 4]));
      }
      o += 32;
    }
    return out;
  }

  // dequantize_row_iq4_xs (:3332). Block 136 B: d:f16 scales_h:uint16 scales_l:uint8[4] qs:uint8[128].
  function dequantIQ4XS(raw, elements) {
    const out = new Float32Array(elements);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const nb = elements / QK_K; let o = 0;
    for (let i = 0; i < nb; i++) {
      const bp = i * 136, slB = bp + 4;
      const d = f16ToF32(dv.getUint16(bp, true));
      const sh = dv.getUint16(bp + 2, true);
      let qs = bp + 8;
      for (let ib = 0; ib < QK_K / 32; ++ib) {
        const ls = ((raw[slB + (ib >> 1)] >> (4 * (ib % 2))) & 0xf) | (((sh >> (2 * ib)) & 3) << 4);
        const dl = fr(d * (ls - 32));
        for (let j = 0; j < 16; ++j) {
          out[o + j] = fr(dl * s8(kvalues_iq4nl[raw[qs + j] & 0xf]));
          out[o + 16 + j] = fr(dl * s8(kvalues_iq4nl[raw[qs + j] >> 4]));
        }
        o += 32; qs += 16;
      }
    }
    return out;
  }

  return { dequantIQ2XXS, dequantIQ2XS, dequantIQ2S, dequantIQ3XXS, dequantIQ3S, dequantIQ1S, dequantIQ1M, dequantIQ4NL, dequantIQ4XS };
}
