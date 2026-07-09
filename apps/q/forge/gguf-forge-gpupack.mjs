// Unpack a forge κ-block into a GPU-ready weight. Q5_0/Q8_0/Q4_0 -> per-32 f32
// scale + signed int8 quant (the proven GEMV rep); Q6_K/Q4_K/F32 -> dequantized
// f32. Lossless: the values are exactly what dequantizeExact yields from the
// original κ-block bytes, so the κ-fidelity chain holds onto the GPU.

import { GGML, dequantizeExact } from "./gguf-forge-dequant.mjs";
import { f16ToF32 } from "../qvac-ingest.mjs";

const Q_TYPES = new Set([GGML.Q5_0, GGML.Q8_0, GGML.Q4_0]);
export const isQ = (type) => Q_TYPES.has(type);

export function unpackWeight(raw, type, N, K) {
  if (!Q_TYPES.has(type)) return { kind: "f32", data: dequantizeExact(type, raw, N * K) };
  const nb = K / 32, scales = new Float32Array(N * nb), quants = new Int8Array(N * K);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const bsz = type === GGML.Q5_0 ? 22 : type === GGML.Q8_0 ? 34 : 18;
  for (let row = 0; row < N; row++) for (let b = 0; b < nb; b++) {
    const bp = (row * nb + b) * bsz, so = row * nb + b, qo = row * K + b * 32;
    scales[so] = f16ToF32(dv.getUint16(bp, true));
    if (type === GGML.Q8_0) { for (let j = 0; j < 32; j++) quants[qo + j] = (raw[bp + 2 + j] << 24) >> 24; }
    else if (type === GGML.Q4_0) { const q = bp + 2; for (let j = 0; j < 16; j++) { quants[qo + j] = (raw[q + j] & 0xf) - 8; quants[qo + 16 + j] = (raw[q + j] >> 4) - 8; } }
    else { const q = bp + 6, qh = dv.getUint32(bp + 2, true); for (let j = 0; j < 16; j++) { const xh0 = ((qh & (1 << j)) >>> j) << 4, xh1 = (qh & (1 << (j + 16))) >>> (j + 12); quants[qo + j] = ((raw[q + j] & 0xf) | xh0) - 16; quants[qo + 16 + j] = ((raw[q + j] >> 4) | xh1) - 16; } }
  }
  return { kind: "q", scales, quants };
}
