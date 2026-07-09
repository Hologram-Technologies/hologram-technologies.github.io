// QVAC disk-streaming GGUF ingestion — pure JS, no wasm in the weight path.
//
// The wasm path holds the whole GGUF in wasm32 linear memory (~4 GB ceiling), so
// it can't ingest a 7B/14B model. This module reads a large GGUF straight off disk
// (HTTP Range against the served file) and converts each tensor to the engine's
// block format ON DEMAND, so RAM never holds more than one tensor at a time.
//
// It is a faithful port of qvac-gguf::dequantize_raw + qvac-layer::quant_blocks +
// model_specs, so the bytes it produces are what the GPU engine already consumes.
// The tokenizer stays in wasm: we feed wasm only the GGUF HEADER (the first
// data_offset bytes), which is all qvac_load_gpu needs for the BPE + manifest.

import { makeIQ } from "./forge/gguf-forge-iq-dequant.mjs";

// ── f16 → f32 (matches qvac_gguf::f16_to_f32) ──
export function f16ToF32(h) {
  const sign = (h >> 15) & 1, exp = (h >> 10) & 0x1f, mant = h & 0x3ff;
  let val;
  if (exp === 0) val = mant * Math.pow(2, -24);
  else if (exp === 0x1f) return mant ? NaN : (sign ? -Infinity : Infinity);
  else val = (1 + mant / 1024) * Math.pow(2, exp - 15);
  return sign ? -val : val;
}

const QK = 32, QK_K = 256;
export const GGML = {
  F32: 0, F16: 1, Q4_0: 2, Q4_1: 3, Q8_0: 8, Q2_K: 10, Q3_K: 11, Q4_K: 12, Q5_K: 13, Q6_K: 14,
  IQ2_XXS: 16, IQ2_XS: 17, IQ3_XXS: 18, IQ1_S: 19, IQ4_NL: 20, IQ3_S: 21, IQ2_S: 22, IQ4_XS: 23, IQ1_M: 29,
  TQ2_0: 35,
};
// IQ-quant byte layouts: [block elements, block bytes]. (ggml-common.h:485-563)
const IQ_BLOCK = {
  16: [QK_K, 66], 17: [QK_K, 74], 18: [QK_K, 98], 19: [QK_K, 50], 20: [32, 18],
  21: [QK_K, 110], 22: [QK_K, 82], 23: [QK_K, 136], 29: [QK_K, 56],
};
// BitNet ternary TQ2_0 (ggml-common.h:273): qs[64] + f16 d = 66 B / 256. Runtime
// dequant is float64 (the Tier-A oracle gguf-forge-dequant.mjs is the bit-exact ref).
const TQ_BLOCK = { 35: [QK_K, 66] };
function dequantTq2_0Rt(raw, elements) {
  const out = new Float32Array(elements);
  const nb = elements / QK_K;
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let o = 0, base = 0;
  for (let i = 0; i < nb; ++i) {
    const d = f16ToF32(dv.getUint16(base + 64, true));
    for (let j = 0; j < 64; j += 32)
      for (let l = 0; l < 4; ++l)
        for (let m = 0; m < 32; ++m) out[o++] = (((raw[base + j + m] >> (l * 2)) & 3) - 1) * d;
    base += 66;
  }
  return out;
}
const TQ_RT = { 35: dequantTq2_0Rt };
// Runtime IQ dequant (float64; the Tier-A oracle is the bit-exact reference).
const _iq = makeIQ((x) => x, f16ToF32);
const IQ_RT = {
  16: _iq.dequantIQ2XXS, 17: _iq.dequantIQ2XS, 18: _iq.dequantIQ3XXS, 19: _iq.dequantIQ1S,
  20: _iq.dequantIQ4NL, 21: _iq.dequantIQ3S, 22: _iq.dequantIQ2S, 23: _iq.dequantIQ4XS, 29: _iq.dequantIQ1M,
};

// On-disk byte length of `elements` of a ggml type (matches type_byte_len).
export function typeByteLen(t, elements) {
  switch (t) {
    case GGML.F32: return elements * 4;
    case GGML.F16: return elements * 2;
    case GGML.Q8_0: return (elements / QK) * (2 + QK);
    case GGML.Q4_0: return (elements / QK) * (2 + QK / 2);
    case GGML.Q4_1: return (elements / QK) * (2 + 2 + QK / 2);
    case GGML.Q2_K: return (elements / QK_K) * 84;
    case GGML.Q3_K: return (elements / QK_K) * 110;
    case GGML.Q4_K: return (elements / QK_K) * 144;
    case GGML.Q5_K: return (elements / QK_K) * 176;
    case GGML.Q6_K: return (elements / QK_K) * 210;
    default:
      if (t in IQ_BLOCK) { const [be, bb] = IQ_BLOCK[t]; return (elements / be) * bb; }
      if (t in TQ_BLOCK) { const [be, bb] = TQ_BLOCK[t]; return (elements / be) * bb; }
      throw new Error("unsupported ggml type " + t);
  }
}
// (block elements, block bytes) for the range reader.
function blockShape(t) {
  switch (t) {
    case GGML.F32: return [1, 4];
    case GGML.F16: return [1, 2];
    case GGML.Q8_0: return [QK, 2 + QK];
    case GGML.Q4_0: return [QK, 2 + QK / 2];
    case GGML.Q4_1: return [QK, 2 + 2 + QK / 2];
    case GGML.Q2_K: return [QK_K, 84];
    case GGML.Q3_K: return [QK_K, 110];
    case GGML.Q4_K: return [QK_K, 144];
    case GGML.Q5_K: return [QK_K, 176];
    case GGML.Q6_K: return [QK_K, 210];
    default:
      if (t in IQ_BLOCK) return IQ_BLOCK[t];
      if (t in TQ_BLOCK) return TQ_BLOCK[t];
      throw new Error("unsupported ggml type " + t);
  }
}

// Dequantize raw tensor bytes → Float32Array (port of dequantize_raw).
export function dequantizeRaw(t, raw, elements) {
  const out = new Float32Array(elements);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let o = 0;
  if (t === GGML.F32) {
    for (let i = 0; i < elements; i++) out[i] = dv.getFloat32(i * 4, true);
  } else if (t === GGML.F16) {
    for (let i = 0; i < elements; i++) out[i] = f16ToF32(dv.getUint16(i * 2, true));
  } else if (t === GGML.Q8_0) {
    const bb = 2 + QK;
    for (let p = 0; p + bb <= raw.byteLength; p += bb) {
      const d = f16ToF32(dv.getUint16(p, true));
      for (let j = 0; j < QK; j++) out[o++] = d * (raw[p + 2 + j] << 24 >> 24);
    }
  } else if (t === GGML.Q4_0) {
    const bb = 2 + QK / 2;
    for (let p = 0; p + bb <= raw.byteLength; p += bb) {
      const d = f16ToF32(dv.getUint16(p, true));
      const qs = p + 2;
      for (let j = 0; j < QK / 2; j++) out[o + j] = d * ((raw[qs + j] & 0x0f) - 8);       // low nibble → j
      for (let j = 0; j < QK / 2; j++) out[o + QK / 2 + j] = d * ((raw[qs + j] >> 4) - 8); // high → j+16
      o += QK;
    }
  } else if (t === GGML.Q4_1) {
    const bb = 2 + 2 + QK / 2;
    for (let p = 0; p + bb <= raw.byteLength; p += bb) {
      const d = f16ToF32(dv.getUint16(p, true)), m = f16ToF32(dv.getUint16(p + 2, true));
      const qs = p + 4;
      for (let j = 0; j < QK / 2; j++) out[o + j] = (raw[qs + j] & 0x0f) * d + m;
      for (let j = 0; j < QK / 2; j++) out[o + QK / 2 + j] = (raw[qs + j] >> 4) * d + m;
      o += QK;
    }
  } else if (t === GGML.Q4_K) {
    // Q4_K: 256-element super-block of 144 B = d(f16) + dmin(f16) + 12 packed 6-bit scales/mins + 128 nibble qs.
    const bb = 144;
    for (let p = 0; p + bb <= raw.byteLength; p += bb) {
      const d = f16ToF32(dv.getUint16(p, true)), dmin = f16ToF32(dv.getUint16(p + 2, true));
      const sc = p + 4, qs = p + 16;
      const sm = (j) => j < 4 ? [raw[sc + j] & 63, raw[sc + j + 4] & 63]
                              : [(raw[sc + j + 4] & 0xF) | ((raw[sc + j - 4] >> 6) << 4), (raw[sc + j + 4] >> 4) | ((raw[sc + j] >> 6) << 4)];
      let q = 0, is = 0;
      for (let j = 0; j < QK_K; j += 64) {
        const [s1, m1] = sm(is), [s2, m2] = sm(is + 1);
        for (let l = 0; l < 32; l++) out[o + l] = d * s1 * (raw[qs + q + l] & 0xF) - dmin * m1;
        for (let l = 0; l < 32; l++) out[o + 32 + l] = d * s2 * (raw[qs + q + l] >> 4) - dmin * m2;
        o += 64; q += 32; is += 2;
      }
    }
  } else if (t === GGML.Q6_K) {
    const bb = 210;
    for (let p = 0; p + bb <= raw.byteLength; p += bb) {
      const ql = p, qh = p + 128, sc = p + 192, d = f16ToF32(dv.getUint16(p + 208, true));
      for (let n = 0; n < 2; n++) {
        const qlo = ql + n * 64, qho = qh + n * 32, sco = sc + n * 8, yo = o + n * 128;
        for (let l = 0; l < 32; l++) {
          const is = (l / 16) | 0;
          const q1 = ((raw[qlo + l] & 0x0f) | (((raw[qho + l] >> 0) & 3) << 4)) - 32;
          const q2 = ((raw[qlo + l + 32] & 0x0f) | (((raw[qho + l] >> 2) & 3) << 4)) - 32;
          const q3 = ((raw[qlo + l] >> 4) | (((raw[qho + l] >> 4) & 3) << 4)) - 32;
          const q4 = ((raw[qlo + l + 32] >> 4) | (((raw[qho + l] >> 6) & 3) << 4)) - 32;
          out[yo + l] = d * (raw[sco + is] << 24 >> 24) * q1;
          out[yo + l + 32] = d * (raw[sco + is + 2] << 24 >> 24) * q2;
          out[yo + l + 64] = d * (raw[sco + is + 4] << 24 >> 24) * q3;
          out[yo + l + 96] = d * (raw[sco + is + 6] << 24 >> 24) * q4;
        }
      }
      o += QK_K;
    }
  } else if (t === GGML.Q2_K) {
    // 84 B: scales[16] qs[64] d(f16) dmin(f16). y = d*(sc&0xF)*q2 - dmin*(sc>>4).
    const bb = 84;
    for (let p = 0; p + bb <= raw.byteLength; p += bb) {
      const sc = p, qs = p + 16, d = f16ToF32(dv.getUint16(p + 80, true)), dmin = f16ToF32(dv.getUint16(p + 82, true));
      let is = 0;
      for (let n = 0; n < QK_K; n += 128) {
        const q = qs + (n >> 7) * 32;
        for (let shift = 0; shift < 8; shift += 2) {
          let s = raw[sc + is++];
          for (let l = 0; l < 16; l++) out[o++] = d * (s & 0xf) * ((raw[q + l] >> shift) & 3) - dmin * (s >> 4);
          s = raw[sc + is++];
          for (let l = 0; l < 16; l++) out[o++] = d * (s & 0xf) * ((raw[q + l + 16] >> shift) & 3) - dmin * (s >> 4);
        }
      }
    }
  } else if (t === GGML.Q3_K) {
    // 110 B: hmask[32] qs[64] scales[12] d(f16). 6-bit signed scales via kmask unpack.
    const bb = 110, km1 = 0x03030303, km2 = 0x0f0f0f0f;
    const aux = new Uint32Array(4), sb = new Int8Array(aux.buffer);
    for (let p = 0; p + bb <= raw.byteLength; p += bb) {
      const hm = p, qs = p + 32, sco = p + 96, d = f16ToF32(dv.getUint16(p + 108, true));
      aux[0] = dv.getUint32(sco, true); aux[1] = dv.getUint32(sco + 4, true); aux[2] = dv.getUint32(sco + 8, true);
      const tmp = aux[2];
      aux[2] = ((aux[0] >>> 4) & km2) | (((tmp >>> 4) & km1) << 4);
      aux[3] = ((aux[1] >>> 4) & km2) | (((tmp >>> 6) & km1) << 4);
      aux[0] = (aux[0] & km2) | (((tmp >>> 0) & km1) << 4);
      aux[1] = (aux[1] & km2) | (((tmp >>> 2) & km1) << 4);
      let is = 0, m = 1;
      for (let n = 0; n < QK_K; n += 128) {
        const q = qs + (n >> 7) * 32;
        for (let shift = 0; shift < 8; shift += 2) {
          let dl = d * (sb[is++] - 32);
          for (let l = 0; l < 16; l++) out[o++] = dl * (((raw[q + l] >> shift) & 3) - ((raw[hm + l] & m) ? 0 : 4));
          dl = d * (sb[is++] - 32);
          for (let l = 0; l < 16; l++) out[o++] = dl * (((raw[q + l + 16] >> shift) & 3) - ((raw[hm + l + 16] & m) ? 0 : 4));
          m <<= 1;
        }
      }
    }
  } else if (t === GGML.Q5_K) {
    // 176 B: d(f16) dmin(f16) scales[12] qh[32] ql[128]. Q4_K nibbles + 5th bit from qh.
    const bb = 176;
    const smk4 = (sc, j) => j < 4 ? [raw[sc + j] & 63, raw[sc + j + 4] & 63]
                                  : [(raw[sc + j + 4] & 0xF) | ((raw[sc + j - 4] >> 6) << 4), (raw[sc + j + 4] >> 4) | ((raw[sc + j] >> 6) << 4)];
    for (let p = 0; p + bb <= raw.byteLength; p += bb) {
      const d = f16ToF32(dv.getUint16(p, true)), dmin = f16ToF32(dv.getUint16(p + 2, true));
      const sc = p + 4, qh = p + 16; let ql = p + 48, is = 0, u1 = 1, u2 = 2;
      for (let j = 0; j < QK_K; j += 64) {
        const [s1, m1] = smk4(sc, is), [s2, m2] = smk4(sc, is + 1);
        const d1 = d * s1, mm1 = dmin * m1, d2 = d * s2, mm2 = dmin * m2;
        for (let l = 0; l < 32; l++) out[o++] = d1 * ((raw[ql + l] & 0xF) + ((raw[qh + l] & u1) ? 16 : 0)) - mm1;
        for (let l = 0; l < 32; l++) out[o++] = d2 * ((raw[ql + l] >> 4) + ((raw[qh + l] & u2) ? 16 : 0)) - mm2;
        ql += 32; is += 2; u1 <<= 2; u2 <<= 2;
      }
    }
  } else if (t in IQ_RT) {
    return IQ_RT[t](raw, elements); // IQ-quants (float64 runtime; oracle is the bit-exact ref)
  } else if (t in TQ_RT) {
    return TQ_RT[t](raw, elements); // BitNet TQ2_0 (float64 runtime; oracle is the bit-exact ref)
  } else throw new Error("unsupported ggml type " + t);
  return out;
}

// Re-quantize a [n,k] f32 tensor into the engine's per-32-block format
// (port of qvac-layer::quant_blocks). bits=4 → (nibble-8)*scale, scale=amax/7,
// sequential nibble packing; bits=8 → int8, scale=amax/127. Returns {q,s}.
// Arithmetic is done in f32 (Math.fround) with round-half-away-from-zero to match
// Rust's f32 `round()` byte-for-byte, so the frames are bit-identical to wasm's.
const fr = Math.fround;
const rnd = (x) => x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5); // half away from zero (Rust f32::round)
export function quantBlocks(f, n, k, bits) {
  const nb = k / 32;
  const s = new Float32Array(n * nb);
  let si = 0;
  if (bits === 4) {
    const q = new Uint8Array(n * k / 2);
    for (let row = 0; row < n; row++) {
      const base = row * k;
      for (let b = 0; b < nb; b++) {
        const bo = base + b * 32;
        let amax = 0; for (let j = 0; j < 32; j++) { const a = Math.abs(f[bo + j]); if (a > amax) amax = a; }
        amax = Math.max(amax, 1e-9); const scale = fr(amax / 7); s[si++] = scale;
        for (let j = 0; j < 32; j++) {
          let qv = rnd(fr(f[bo + j] / scale)); qv = qv < -8 ? -8 : qv > 7 ? 7 : qv; qv = (qv + 8) & 0xf;
          const g = bo + j;
          if ((g & 1) === 0) q[g >> 1] |= qv; else q[g >> 1] |= qv << 4;
        }
      }
    }
    return { q, s };
  } else {
    const q = new Uint8Array(n * k);
    for (let row = 0; row < n; row++) {
      const base = row * k;
      for (let b = 0; b < nb; b++) {
        const bo = base + b * 32;
        let amax = 0; for (let j = 0; j < 32; j++) { const a = Math.abs(f[bo + j]); if (a > amax) amax = a; }
        amax = Math.max(amax, 1e-9); const scale = fr(amax / 127); s[si++] = scale;
        for (let j = 0; j < 32; j++) { let qv = rnd(fr(f[bo + j] / scale)); qv = qv < -127 ? -127 : qv > 127 ? 127 : qv; q[bo + j] = qv & 0xff; }
      }
    }
    return { q, s };
  }
}

// FAST PATH: GGUF Q4_0 → engine Q4 with NO dequant/requant — a pure relayout.
// GGUF Q4_0 already stores (nibble-8)*d, exactly the engine's convention, so the
// nibble value maps straight across; we only reorder the interleaved (j, j+16)
// nibbles into the engine's sequential packing and widen the f16 scale to f32.
// This is both faster (integer-only) and bit-exact to the GGUF (no requant loss).
export function relayoutQ4(raw, n, k) {
  const nb = k / 32;
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const q = new Uint8Array(n * k / 2), s = new Float32Array(n * nb);
  let bo = 0, si = 0;
  for (let row = 0; row < n; row++) {
    const rowBase = row * k;
    for (let b = 0; b < nb; b++) {
      s[si++] = f16ToF32(dv.getUint16(bo, true));
      const qs = bo + 2, blkBase = rowBase + b * 32;
      for (let w = 0; w < 32; w++) {
        const nib = w < 16 ? (raw[qs + w] & 0x0f) : (raw[qs + (w - 16)] >> 4);
        const g = blkBase + w;
        if ((g & 1) === 0) q[g >> 1] |= nib; else q[g >> 1] |= nib << 4;
      }
      bo += 18;
    }
  }
  return { q, s };
}
// FAST PATH: GGUF Q8_0 → engine Q8 — copy the i8 quants, widen f16 scale to f32.
export function relayoutQ8(raw, n, k) {
  const nb = k / 32;
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const q = new Uint8Array(n * k), s = new Float32Array(n * nb);
  let bo = 0, si = 0, qi = 0;
  for (let row = 0; row < n; row++) {
    for (let b = 0; b < nb; b++) {
      s[si++] = f16ToF32(dv.getUint16(bo, true));
      for (let w = 0; w < 32; w++) q[qi++] = raw[bo + 2 + w];
      bo += 34;
    }
  }
  return { q, s };
}

// ── GGUF header parser (just enough: tensor directory + data offset) ──
class Cur {
  constructor(buf) { this.b = buf; this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); this.p = 0; this.v1 = false; }
  need(n) { if (this.p + n > this.b.byteLength) throw new RangeError("short"); }
  u8() { this.need(1); return this.b[this.p++]; }
  u16() { this.need(2); const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  u32() { this.need(4); const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
  u64() { this.need(8); const lo = this.dv.getUint32(this.p, true), hi = this.dv.getUint32(this.p + 4, true); this.p += 8; return hi * 4294967296 + lo; }
  lenField() { return this.v1 ? this.u32() : this.u64(); }
  skipStr() { const n = this.lenField(); this.need(n); this.p += n; }
  skipValue(ty) {
    switch (ty) {
      case 0: case 1: case 7: this.p += 1; break;
      case 2: case 3: this.p += 2; break;
      case 4: case 5: case 6: this.p += 4; break;
      case 10: case 11: case 12: this.p += 8; break;
      case 8: this.skipStr(); break;
      case 9: { const ety = this.u32(); const cnt = this.lenField(); for (let i = 0; i < cnt; i++) this.skipValue(ety); break; }
      default: throw new Error("bad meta type " + ty);
    }
  }
  // Read a SCALAR metadata value (numbers/bool/string); arrays are skipped (return undefined).
  readScalar(ty) {
    switch (ty) {
      case 0: return this.u8();
      case 1: { const v = this.u8(); return v << 24 >> 24; }
      case 2: return this.u16();
      case 3: { const v = this.u16(); return v << 16 >> 16; }
      case 4: return this.u32();
      case 5: { const v = this.u32(); return v | 0; }
      case 6: { this.need(4); const v = this.dv.getFloat32(this.p, true); this.p += 4; return v; }
      case 7: return this.u8() !== 0;
      case 8: { const n = this.lenField(); const s = new TextDecoder().decode(this.b.subarray(this.p, this.p + n)); this.p += n; return s; }
      case 10: return this.u64();
      case 11: return this.u64();
      case 12: { this.need(8); const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; }
      case 9: { const ety = this.u32(); const cnt = this.lenField(); for (let i = 0; i < cnt; i++) this.skipValue(ety); return undefined; }
      default: throw new Error("bad meta type " + ty);
    }
  }
}

// Parse a GGUF header buffer → { version, dataOffset, tensors:[{name,dims,ggmlType,offset}] }.
// `buf` must contain at least up to the (aligned) end of the tensor-info table.
export function parseGgufHeader(buf) {
  const c = new Cur(buf);
  if (c.u32() !== 0x46554747) throw new Error("not GGUF");
  const version = c.u32();
  if (version !== 1 && version !== 2 && version !== 3) throw new Error("GGUF version " + version);
  c.v1 = version === 1;
  const tensorCount = c.lenField();
  const metaCount = c.lenField();
  let alignment = 32;
  const meta = {};
  for (let i = 0; i < metaCount; i++) {
    const keyLen = c.lenField(); const key = new TextDecoder().decode(buf.subarray(c.p, c.p + keyLen)); c.p += keyLen;
    const ty = c.u32();
    const v = c.readScalar(ty);                          // arrays → undefined (skipped)
    if (v !== undefined) meta[key] = v;
    if (key === "general.alignment" && typeof v === "number") alignment = v;
  }
  const tensors = [];
  for (let i = 0; i < tensorCount; i++) {
    const nl = c.lenField(); const name = new TextDecoder().decode(buf.subarray(c.p, c.p + nl)); c.p += nl;
    const nd = c.u32(); const dims = []; for (let j = 0; j < nd; j++) dims.push(c.lenField());
    const ggmlType = c.u32(); const offset = c.u64();
    tensors.push({ name, dims, ggmlType, offset });
  }
  alignment = Math.max(1, alignment);
  const dataOffset = Math.ceil(c.p / alignment) * alignment;
  return { version, dataOffset, tensors, meta };
}

// Build the engine manifest (dims + tensor list with N,K,blk) from a parsed GGUF
// header — a pure-JS port of qvac-layer::model_specs + gpu_export_manifest, so
// conversion/streaming needs no wasm. `tensors` is the header's tensor directory.
export function buildManifest(meta, tensors, bits) {
  const arch = meta["general.architecture"] || "llama";
  const mu = (k) => { const v = meta[`${arch}.${k}`]; return typeof v === "number" ? Math.round(v) : undefined; };
  const tset = new Set(tensors.map((t) => t.name));
  const tbyname = {}; for (const t of tensors) tbyname[t.name] = t;
  const d = mu("embedding_length") || 0;
  const n_layers = mu("block_count") || 0;
  const n_heads = mu("attention.head_count") || 0;
  const n_kv_heads = mu("attention.head_count_kv") || n_heads;
  // For MoE, the experts use expert_feed_forward_length (e.g. Qwen3-30B-A3B: 768),
  // which differs from the (unused) dense feed_forward_length (6144). OLMoE's two
  // values happen to be equal. `ff` everywhere downstream means the EXPERT ff for MoE.
  const ff = (mu("expert_feed_forward_length") || mu("feed_forward_length")) || 0;
  const hd = mu("attention.key_length") || (n_heads ? Math.floor(d / n_heads) : 0);
  const kv_dim = n_kv_heads * hd;
  const rope_base = (typeof meta[`${arch}.rope.freq_base`] === "number") ? meta[`${arch}.rope.freq_base`] : 10000;
  const attn_bias = tset.has("blk.0.attn_q.bias");
  const qk_norm = tset.has("blk.0.attn_q_norm.weight");
  const qk_norm_dim = qk_norm ? (tbyname["blk.0.attn_q_norm.weight"].dims[0] | 0) : 0; // hd (per-head, Qwen3) or d (full, OLMoE)
  const n_experts = mu("expert_count") || 0;               // >0 → MoE
  const n_used = mu("expert_used_count") || 0;
  const moe = n_experts > 0;
  const bitnet = /^bitnet/.test(arch);                     // BitNet b1.58: sub-norms before wo/w_down + ReLU² gated FFN
  const tied = !tset.has("output.weight");
  const vocab = d > 0 && tbyname["token_embd.weight"] ? Math.floor(tbyname["token_embd.weight"].dims.reduce((a, b) => a * b, 1) / d) : 0;
  const blk = (name, N, K) => ({ name, N, K, blk: true });
  const nrm = (name, K) => ({ name, N: 1, K, blk: false });
  const t = [];
  t.push(blk("embed", vocab, d));
  t.push(nrm("final_norm", d));
  t.push(blk("lm_head", vocab, d));
  for (let i = 0; i < n_layers; i++) {
    t.push(nrm(`l${i}.attn_norm`, d));
    t.push(blk(`l${i}.wq`, n_heads * hd, d));
    t.push(blk(`l${i}.wk`, kv_dim, d));
    t.push(blk(`l${i}.wv`, kv_dim, d));
    if (attn_bias) { t.push(nrm(`l${i}.bq`, n_heads * hd)); t.push(nrm(`l${i}.bk`, kv_dim)); t.push(nrm(`l${i}.bv`, kv_dim)); }
    if (qk_norm) { t.push(nrm(`l${i}.q_norm`, qk_norm_dim)); t.push(nrm(`l${i}.k_norm`, qk_norm_dim)); }
    if (bitnet) t.push(nrm(`l${i}.attn_sub_norm`, n_heads * hd));
    t.push(blk(`l${i}.wo`, d, n_heads * hd));
    t.push(nrm(`l${i}.ffn_norm`, d));
    if (bitnet) t.push(nrm(`l${i}.ffn_sub_norm`, ff));
    if (moe) {
      t.push(nrm(`l${i}.router`, n_experts * d));          // ffn_gate_inp [n_experts, d] f32 (CPU top-k)
      // experts are NOT enumerated here (n_layers·n_experts·3 is huge); the engine
      // generates `l{i}.e{e}.{gate,up,down}` names for the top-k it actually needs.
    } else {
      t.push(blk(`l${i}.w_gate`, ff, d));
      t.push(blk(`l${i}.w_up`, ff, d));
      t.push(blk(`l${i}.w_down`, d, ff));
    }
  }
  const out = { d, n_heads, n_kv_heads, ff, vocab, n_layers, hd, bits, rope_base, attn_bias, qk_norm, qk_norm_dim, tied, tensors: t };
  if (moe) out.moe = { n_experts, n_used };
  if (bitnet) { out.sub_norm = true; out.ffn_act = "relu2"; }
  return out;
}

// engine tensor name → GGUF tensor name (mirror of model_specs).
export function ggufNameFor(name, hasOutputWeight) {
  if (name === "embed") return "token_embd.weight";
  if (name === "final_norm") return "output_norm.weight";
  if (name === "lm_head") return hasOutputWeight ? "output.weight" : "token_embd.weight";
  const m = name.match(/^l(\d+)\.(.+)$/); if (!m) return null;
  const i = m[1], r = m[2], p = `blk.${i}.`;
  const map = {
    "attn_norm": "attn_norm.weight", "ffn_norm": "ffn_norm.weight",
    "attn_sub_norm": "attn_sub_norm.weight", "ffn_sub_norm": "ffn_sub_norm.weight",
    "wq": "attn_q.weight", "wk": "attn_k.weight", "wv": "attn_v.weight", "wo": "attn_output.weight",
    "bq": "attn_q.bias", "bk": "attn_k.bias", "bv": "attn_v.bias",
    "q_norm": "attn_q_norm.weight", "k_norm": "attn_k_norm.weight",
    "w_gate": "ffn_gate.weight", "w_up": "ffn_up.weight", "w_down": "ffn_down.weight",
  };
  return map[r] ? p + map[r] : null;
}

// Read the GGUF header from `url` (HTTP Range), growing the read until the tensor
// table fits. Returns { dataOffset, tensors, headerBytes } (headerBytes = the first
// dataOffset bytes, to hand to wasm qvac_load_gpu for the tokenizer + manifest).
export async function readHeader(url, readRange, initial = 48 * 1024 * 1024) {
  let n = initial, parsed = null, buf = null;
  for (let tries = 0; tries < 6; tries++) {
    buf = await readRange(url, 0, n);
    try { parsed = parseGgufHeader(buf); break; } catch (e) { if (e instanceof RangeError || /short/.test(String(e))) { n *= 2; continue; } throw e; }
  }
  if (!parsed) throw new Error("could not parse GGUF header");
  const headerBytes = buf.length >= parsed.dataOffset ? buf.subarray(0, parsed.dataOffset) : await readRange(url, 0, parsed.dataOffset);
  return { dataOffset: parsed.dataOffset, tensors: parsed.tensors, headerBytes };
}

// Build the per-tensor fetcher the GPU engine consumes. `manifest` is the wasm
// manifest (dims + tensors with N,K,blk). Returns fetchTensor(name) → Uint8Array,
// byte-identical to what qvac_gpu_tensor would return — but sourced from disk.
export function makeDiskFetcher({ url, readRange, dataOffset, tensors, manifest, bits }) {
  const tdir = {}; for (const t of tensors) tdir[t.name] = t;
  const hasOut = !!tdir["output.weight"];
  const mByName = {}; for (const t of manifest.tensors) mByName[t.name] = t;
  const ROW_CHUNK = 8192;
  const ffM = manifest.ff, dM = manifest.d;

  // Resolve an engine tensor name → { info, N, K, blk, eltOffset }. Handles MoE
  // expert slices `l{i}.e{e}.{gate,up,down}` (the e-th slab of the 3-D ffn_*_exps
  // tensor) and the router `l{i}.router` (ffn_gate_inp, f32) in addition to the
  // plain tensors in the manifest.
  const resolve = (name) => {
    let m = name.match(/^l(\d+)\.e(\d+)\.(gate|up|down)$/);
    if (m) {
      const i = m[1], e = +m[2], role = m[3];
      const info = tdir[`blk.${i}.ffn_${role}_exps.weight`]; if (!info) return null;
      const N = role === "down" ? dM : ffM, K = role === "down" ? ffM : dM;
      return { info, N, K, blk: true, eltOffset: e * N * K };
    }
    m = name.match(/^l(\d+)\.router$/);
    if (m) { const info = tdir[`blk.${m[1]}.ffn_gate_inp.weight`]; return info ? { info, N: 1, K: (manifest.moe.n_experts * dM), blk: false, eltOffset: 0 } : null; }
    const spec = mByName[name]; const gname = ggufNameFor(name, hasOut); const info = gname && tdir[gname];
    return (spec && info) ? { info, N: spec.N, K: spec.K, blk: spec.blk, eltOffset: 0 } : null;
  };

  return async function fetchTensor(name) {
    const r = resolve(name);
    if (!r) return new Uint8Array(0);
    const { info, N, K, blk, eltOffset } = r;
    const [bElems, bBytes] = blockShape(info.ggmlType);
    const tBase = dataOffset + info.offset + (eltOffset / bElems) * bBytes; // slab offset for experts
    if (!blk) {                                         // norm / bias / router → [f32]
      const elems = K;
      const raw = await readRange(url, tBase, typeByteLen(info.ggmlType, elems));
      const f = dequantizeRaw(info.ggmlType, raw, elems);
      return new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
    }
    // block weight → [all q bytes][all f32 scales], chunked by rows so a 152k-vocab
    // tensor never materialises whole as f32 (mirror of quant_tensor_chunked).
    const [blkElems, blkBytes] = blockShape(info.ggmlType);
    const qBytesTotal = bits === 4 ? (N * K) / 2 : N * K;
    const scaleCount = N * (K / 32);
    const out = new Uint8Array(qBytesTotal + scaleCount * 4);
    const scales = new Float32Array(out.buffer, qBytesTotal, scaleCount);
    // Fast relayout when the source quant matches the engine's width (the common
    // case: a Q4_0 model → 4-bit engine). No f32 ever materialises → also lets the
    // big embed/lm_head be done in one pass.
    const fast = (info.ggmlType === GGML.Q4_0 && bits === 4) || (info.ggmlType === GGML.Q8_0 && bits === 8);
    if (fast) {
      const raw = await readRange(url, tBase, typeByteLen(info.ggmlType, N * K));
      const { q, s } = info.ggmlType === GGML.Q4_0 ? relayoutQ4(raw, N, K) : relayoutQ8(raw, N, K);
      out.set(q, 0); scales.set(s, 0);
      return out;
    }
    let qPos = 0, sPos = 0;
    for (let r = 0; r < N; r += ROW_CHUNK) {
      const nr = Math.min(ROW_CHUNK, N - r);
      const startElem = r * K, countElem = nr * K;
      const byteStart = (startElem / blkElems) * blkBytes, byteLen = (countElem / blkElems) * blkBytes;
      const raw = await readRange(url, tBase + byteStart, byteLen);
      const f = dequantizeRaw(info.ggmlType, raw, countElem);
      const { q, s } = quantBlocks(f, nr, K, bits);
      out.set(q, qPos); qPos += q.length;
      scales.set(s, sPos); sPos += s.length;
    }
    return out;
  };
}

// HTTP Range reader against a same-origin URL.
export function rangeReader() {
  return async (url, start, len) => {
    const r = await fetch(url, { headers: { Range: `bytes=${start}-${start + len - 1}` } });
    if (!r.ok && r.status !== 206) throw new Error(`range ${start}+${len}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  };
}
