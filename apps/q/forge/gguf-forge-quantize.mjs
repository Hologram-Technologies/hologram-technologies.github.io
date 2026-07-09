// GGUF Forge — κ-native deterministic QUANTIZER (the inverse of gguf-forge-dequant.mjs).
//
// Turns raw f32/f16 weights into the SAME verbatim-byte quant blocks the forge runs,
// so the whole pipeline is in-substrate: raw weights → quantize → κ-objects → run.
// Deterministic by construction (identical f32 in ⇒ identical bytes out ⇒ identical κ).
//
// Transcribed line-for-line from ggml-quants.c (llama.cpp b7248):
//   quantize_row_q4_0_ref:71  q5_0_ref:145  q8_0_ref:234
// Every float op is f32 (Math.fround) to match ggml's `float` arithmetic; the f16
// scale uses the same RNE conversion as the runtime (f32ToF16). Witnessed BIT-FOR-BIT
// vs ggml_quantize_chunk in gguf-forge-quantize.test.mjs (no tolerance — deterministic).

import { f32ToF16, nearestInt } from "./gguf-forge-matmul.mjs";
import { f16ToF32 } from "../qvac-ingest.mjs";
import { sha256hex, sriOf, kappa, didHolo, jcs } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";
import { GGML_TYPE_NAME } from "./gguf-forge.mjs";

const fr = Math.fround;
const QK_K = 256;
const fabsf = (v) => fr(Math.abs(v));
// C roundf: round half AWAY from zero (≠ JS Math.round, which rounds half toward +∞).
const roundf = (v) => (v >= 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5));
// C (int8_t)(float): truncate toward zero, then wrap to signed 8-bit.
const toI8 = (v) => { const t = Math.trunc(v) & 0xff; return t >= 128 ? t - 256 : t; };

// quantize_row_q8_0_ref (:234). Block 34 B: d:f16 + qs:int8[32]. d = amax/127.
export function quantizeRowQ8_0(x, k) {
  const nb = k / 32, out = new Uint8Array(nb * 34), dv = new DataView(out.buffer);
  for (let i = 0; i < nb; i++) {
    let amax = 0.0;
    for (let j = 0; j < 32; j++) { const a = fabsf(x[i * 32 + j]); if (a > amax) amax = a; }
    const d = fr(amax / 127), id = d ? fr(1.0 / d) : 0.0;
    dv.setUint16(i * 34, f32ToF16(d), true);
    for (let j = 0; j < 32; j++) out[i * 34 + 2 + j] = roundf(fr(x[i * 32 + j] * id)) & 0xff;
  }
  return out;
}

// quantize_row_q4_0_ref (:71). Block 18 B: d:f16 + qs:nibbles[16]. d = max/−8, signed
// max at the abs-max position; nibble = MIN(15, (int8_t)(x·id + 8.5)).
export function quantizeRowQ4_0(x, k) {
  const nb = k / 32, out = new Uint8Array(nb * 18), dv = new DataView(out.buffer);
  for (let i = 0; i < nb; i++) {
    let amax = 0.0, max = 0.0;
    for (let j = 0; j < 32; j++) { const v = x[i * 32 + j], a = fabsf(v); if (amax < a) { amax = a; max = v; } }
    const d = fr(max / -8), id = d ? fr(1.0 / d) : 0.0;
    dv.setUint16(i * 18, f32ToF16(d), true);
    for (let j = 0; j < 16; j++) {
      const xi0 = Math.min(15, toI8(fr(fr(x[i * 32 + j] * id) + 8.5)));
      const xi1 = Math.min(15, toI8(fr(fr(x[i * 32 + 16 + j] * id) + 8.5)));
      out[i * 18 + 2 + j] = ((xi0 & 0xff) | ((xi1 & 0xff) << 4)) & 0xff;
    }
  }
  return out;
}

// quantize_row_q5_0_ref (:145). Block 22 B: d:f16 + qh:u32 + qs:nibbles[16]. d = max/−16,
// 5-bit value: low nibble in qs, the 5th bit packed into qh.
export function quantizeRowQ5_0(x, k) {
  const nb = k / 32, out = new Uint8Array(nb * 22), dv = new DataView(out.buffer);
  for (let i = 0; i < nb; i++) {
    let amax = 0.0, max = 0.0;
    for (let j = 0; j < 32; j++) { const v = x[i * 32 + j], a = fabsf(v); if (amax < a) { amax = a; max = v; } }
    const d = fr(max / -16), id = d ? fr(1.0 / d) : 0.0;
    dv.setUint16(i * 22, f32ToF16(d), true);
    let qh = 0;
    for (let j = 0; j < 16; j++) {
      const xi0 = Math.min(31, toI8(fr(fr(x[i * 32 + j] * id) + 16.5))) & 0xff;
      const xi1 = Math.min(31, toI8(fr(fr(x[i * 32 + 16 + j] * id) + 16.5))) & 0xff;
      out[i * 22 + 6 + j] = (xi0 & 0x0f) | ((xi1 & 0x0f) << 4);
      qh = (qh | (((xi0 & 0x10) >> 4) << j) | (((xi1 & 0x10) >> 4) << (j + 16))) >>> 0;
    }
    dv.setUint32(i * 22 + 2, qh, true);
  }
  return out;
}

// make_qkx2_quants (:737): the K-quant scale/min optimizer. Picks (scale,min) per
// 32-element sub-block minimizing weighted error over a small grid search. f32-faithful.
// Writes L[Loff..], returns { scale, theMin }. (rmin=-1, rdelta=0.1, nstep=20, useMad=false for q4_K.)
function makeQkx2(n, nmax, x, xoff, weights, L, Loff, rmin, rdelta, nstep, useMad) {
  let min = x[xoff], max = x[xoff];
  let sum_w = weights[0], sum_x = fr(sum_w * x[xoff]);
  for (let i = 1; i < n; i++) { const xi = x[xoff + i]; if (xi < min) min = xi; if (xi > max) max = xi; const w = weights[i]; sum_w = fr(sum_w + w); sum_x = fr(sum_x + fr(w * xi)); }
  if (min > 0) min = 0;
  if (max === min) { for (let i = 0; i < n; i++) L[Loff + i] = 0; return { scale: 0, theMin: fr(-min) }; }
  let iscale = fr(nmax / fr(max - min)), scale = fr(1 / iscale), best_error = 0.0;
  for (let i = 0; i < n; i++) {
    let l = nearestInt(fr(iscale * fr(x[xoff + i] - min))); l = Math.max(0, Math.min(nmax, l)); L[Loff + i] = l;
    let diff = fr(fr(fr(scale * l) + min) - x[xoff + i]); diff = useMad ? fr(Math.abs(diff)) : fr(diff * diff);
    best_error = fr(best_error + fr(weights[i] * diff));
  }
  if (nstep < 1) return { scale, theMin: fr(-min) };
  for (let is = 0; is <= nstep; is++) {
    iscale = fr(fr(fr(rmin + fr(rdelta * is)) + nmax) / fr(max - min));
    let sum_l = 0.0, sum_l2 = 0.0, sum_xl = 0.0, Laux = makeQkx2._aux;
    for (let i = 0; i < n; i++) {
      let l = nearestInt(fr(iscale * fr(x[xoff + i] - min))); l = Math.max(0, Math.min(nmax, l)); Laux[i] = l;
      const w = weights[i]; sum_l = fr(sum_l + fr(w * l)); sum_l2 = fr(sum_l2 + fr(fr(w * l) * l)); sum_xl = fr(sum_xl + fr(fr(w * l) * x[xoff + i]));
    }
    const D = fr(fr(sum_w * sum_l2) - fr(sum_l * sum_l));
    if (D > 0) {
      let this_scale = fr(fr(fr(sum_w * sum_xl) - fr(sum_x * sum_l)) / D);
      let this_min = fr(fr(fr(sum_l2 * sum_x) - fr(sum_l * sum_xl)) / D);
      if (this_min > 0) { this_min = 0; this_scale = fr(sum_xl / sum_l2); }
      let cur_error = 0.0;
      for (let i = 0; i < n; i++) { let diff = fr(fr(fr(this_scale * Laux[i]) + this_min) - x[xoff + i]); diff = useMad ? fr(Math.abs(diff)) : fr(diff * diff); cur_error = fr(cur_error + fr(weights[i] * diff)); }
      if (cur_error < best_error) { for (let i = 0; i < n; i++) L[Loff + i] = Laux[i]; best_error = cur_error; scale = this_scale; min = this_min; }
    }
  }
  return { scale, theMin: fr(-min) };
}
makeQkx2._aux = new Uint8Array(32);

// get_scale_min_k4 (:818) — read back the packed 6-bit scale/min for the L-quant step.
function scaleMinK4(j, sc) {
  if (j < 4) return [sc[j] & 63, sc[j + 4] & 63];
  return [(sc[j + 4] & 0xf) | ((sc[j - 4] >> 6) << 4), (sc[j + 4] >> 4) | ((sc[j] >> 6) << 4)];
}

// make_qkx3_quants (:931): like make_qkx2 but weight falls back to x² when no imatrix,
// uses max<=min, and tracks best_mad. (q4_K imatrix path: rmin=-0.9, rdelta=0.05, nstep=36.)
function makeQkx3(n, nmax, x, xoff, weights, L, Loff, rmin, rdelta, nstep, useMad) {
  const wOf = (i) => weights ? weights[i] : fr(x[xoff + i] * x[xoff + i]);
  let min = x[xoff], max = x[xoff], sum_w = wOf(0), sum_x = fr(sum_w * x[xoff]);
  for (let i = 1; i < n; i++) { const xi = x[xoff + i]; if (xi < min) min = xi; if (xi > max) max = xi; const w = wOf(i); sum_w = fr(sum_w + w); sum_x = fr(sum_x + fr(w * xi)); }
  if (min > 0) min = 0;
  if (max <= min) { for (let i = 0; i < n; i++) L[Loff + i] = 0; return { scale: 0, theMin: fr(-min) }; }
  let iscale = fr(nmax / fr(max - min)), scale = fr(1 / iscale), best_mad = 0.0;
  for (let i = 0; i < n; i++) {
    const l = Math.max(0, Math.min(nmax, nearestInt(fr(iscale * fr(x[xoff + i] - min))))); L[Loff + i] = l;
    let diff = fr(fr(fr(scale * l) + min) - x[xoff + i]); diff = useMad ? fr(Math.abs(diff)) : fr(diff * diff);
    best_mad = fr(best_mad + fr(wOf(i) * diff));
  }
  if (nstep < 1) return { scale, theMin: fr(-min) };
  const Laux = makeQkx3._aux;
  for (let is = 0; is <= nstep; is++) {
    const isc = fr(fr(fr(rmin + fr(rdelta * is)) + nmax) / fr(max - min));
    let sum_l = 0.0, sum_l2 = 0.0, sum_xl = 0.0;
    for (let i = 0; i < n; i++) {
      const l = Math.max(0, Math.min(nmax, nearestInt(fr(isc * fr(x[xoff + i] - min))))); Laux[i] = l;
      const w = wOf(i); sum_l = fr(sum_l + fr(w * l)); sum_l2 = fr(sum_l2 + fr(fr(w * l) * l)); sum_xl = fr(sum_xl + fr(fr(w * l) * x[xoff + i]));
    }
    const D = fr(fr(sum_w * sum_l2) - fr(sum_l * sum_l));
    if (D > 0) {
      let this_scale = fr(fr(fr(sum_w * sum_xl) - fr(sum_x * sum_l)) / D), this_min = fr(fr(fr(sum_l2 * sum_x) - fr(sum_l * sum_xl)) / D);
      if (this_min > 0) { this_min = 0; this_scale = fr(sum_xl / sum_l2); }
      let mad = 0.0; for (let i = 0; i < n; i++) { let diff = fr(fr(fr(this_scale * Laux[i]) + this_min) - x[xoff + i]); diff = useMad ? fr(Math.abs(diff)) : fr(diff * diff); mad = fr(mad + fr(wOf(i) * diff)); }
      if (mad < best_mad) { for (let i = 0; i < n; i++) L[Loff + i] = Laux[i]; best_mad = mad; scale = this_scale; min = this_min; }
    }
  }
  return { scale, theMin: fr(-min) };
}
makeQkx3._aux = new Uint8Array(32);

// make_qp_quants (:1014): positive-quantity quantizer (the q4_K block scales/mins),
// iscale grid search then coordinate-descent refinement. quant_weights required.
function makeQpQuants(n, nmax, x, L, qw) {
  let max = 0.0; for (let i = 0; i < n; i++) max = Math.max(max, x[i]);
  if (max < GROUP_MAX_EPS) { for (let i = 0; i < n; i++) L[i] = 0; return 0.0; }
  let iscale = fr(nmax / max);
  for (let i = 0; i < n; i++) L[i] = nearestInt(fr(iscale * x[i]));
  const scale = fr(1 / iscale); let best_mse = 0.0;
  for (let i = 0; i < n; i++) { const diff = fr(x[i] - fr(scale * L[i])); best_mse = fr(best_mse + fr(fr(qw[i] * diff) * diff)); }
  for (let is = -4; is <= 4; is++) {
    if (is === 0) continue;
    const iscale_is = fr(fr(fr(0.1 * is) + nmax) / max), scale_is = fr(1 / iscale_is); let mse = 0.0;
    for (let i = 0; i < n; i++) { const l = Math.min(nmax, nearestInt(fr(iscale_is * x[i]))); const diff = fr(x[i] - fr(scale_is * l)); mse = fr(mse + fr(fr(qw[i] * diff) * diff)); }
    if (mse < best_mse) { best_mse = mse; iscale = iscale_is; }
  }
  let sumlx = 0.0, suml2 = 0.0;
  for (let i = 0; i < n; i++) { const l = Math.min(nmax, nearestInt(fr(iscale * x[i]))); L[i] = l; sumlx = fr(sumlx + fr(fr(qw[i] * x[i]) * l)); suml2 = fr(suml2 + fr(fr(qw[i] * l) * l)); }
  for (let itry = 0; itry < 5; itry++) {
    let n_changed = 0;
    for (let i = 0; i < n; i++) {
      const w = qw[i]; let slx = fr(sumlx - fr(fr(w * x[i]) * L[i])), sl2 = fr(suml2 - fr(fr(w * L[i]) * L[i]));
      if (slx > 0 && sl2 > 0) {
        const new_l = Math.min(nmax, nearestInt(fr(fr(x[i] * sl2) / slx)));
        if (new_l !== L[i]) {
          slx = fr(slx + fr(fr(w * x[i]) * new_l)); sl2 = fr(sl2 + fr(fr(w * new_l) * new_l));
          if (fr(fr(slx * slx) * suml2) > fr(fr(sumlx * sumlx) * sl2)) { L[i] = new_l; sumlx = slx; suml2 = sl2; n_changed++; }
        }
      }
    }
    if (!n_changed) break;
  }
  return suml2 > 0 ? fr(sumlx / suml2) : 0.0;
}

// quantize_row_q4_K_impl (:1491): the imatrix path. weights[l] = imatrix·√(σ²+x²); block
// scales/mins quantized by make_qp_quants. (σ² = 2·Σx²/QK_K.)
function quantizeRowQ4KImpl(x, k, imatrix) {
  const nb = k / QK_K, out = new Uint8Array(nb * 144), dv = new DataView(out.buffer);
  const L = new Uint8Array(QK_K), weights = new Float32Array(32), sw = new Float32Array(8), mins = new Float32Array(8), scales = new Float32Array(8), Ls = new Uint8Array(8), Lm = new Uint8Array(8);
  for (let i = 0; i < nb; i++) {
    const xo = i * QK_K, bp = i * 144, scB = bp + 4;
    let sum_x2 = 0.0; for (let l = 0; l < QK_K; l++) sum_x2 = fr(sum_x2 + fr(x[xo + l] * x[xo + l]));
    const sigma2 = fr(fr(2 * sum_x2) / QK_K);
    for (let j = 0; j < 8; j++) {
      for (let l = 0; l < 32; l++) weights[l] = fr(imatrix[xo + 32 * j + l] * fr(Math.sqrt(fr(sigma2 + fr(x[xo + 32 * j + l] * x[xo + 32 * j + l])))));
      let sumw = 0.0; for (let l = 0; l < 32; l++) sumw = fr(sumw + weights[l]); sw[j] = sumw;
      const r = makeQkx3(32, 15, x, xo + 32 * j, weights, L, 32 * j, -0.9, 0.05, 36, false); scales[j] = r.scale; mins[j] = r.theMin;
    }
    const d_block = makeQpQuants(8, 63, scales, Ls, sw), m_block = makeQpQuants(8, 63, mins, Lm, sw);
    for (let j = 0; j < 8; j++) {
      const ls = Ls[j], lm = Lm[j];
      if (j < 4) { out[scB + j] = ls; out[scB + j + 4] = lm; }
      else { out[scB + j + 4] = (ls & 0xf) | ((lm & 0xf) << 4); out[scB + j - 4] |= (ls >> 4) << 6; out[scB + j] |= (lm >> 4) << 6; }
    }
    dv.setUint16(bp, f32ToF16(d_block), true); dv.setUint16(bp + 2, f32ToF16(m_block), true);
    const dAll = f16ToF32(dv.getUint16(bp, true)), dminAll = f16ToF32(dv.getUint16(bp + 2, true));
    for (let j = 0; j < 8; j++) {
      const [sc, m] = scaleMinK4(j, out.subarray(scB, scB + 12));
      const d = fr(dAll * sc); if (!d) continue; const dm = fr(dminAll * m);
      for (let ii = 0; ii < 32; ii++) { let l = nearestInt(fr(fr(x[xo + 32 * j + ii] + dm) / d)); L[32 * j + ii] = Math.max(0, Math.min(15, l)); }
    }
    let q = bp + 16;
    for (let j = 0; j < QK_K; j += 64) { for (let l = 0; l < 32; l++) out[q + l] = L[j + l] | (L[j + l + 32] << 4); q += 32; }
  }
  return out;
}

// quantize_row_q4_K_ref (:1395) / _impl (:1491). Block 144 B: d:f16 dmin:f16 scales[12] qs[128].
export function quantizeRowQ4K(x, k, imatrix = null) {
  if (imatrix) return quantizeRowQ4KImpl(x, k, imatrix);
  const nb = k / QK_K, out = new Uint8Array(nb * 144), dv = new DataView(out.buffer);
  const L = new Uint8Array(QK_K), weights = new Float32Array(32), mins = new Float32Array(8), scales = new Float32Array(8);
  for (let i = 0; i < nb; i++) {
    const xo = i * QK_K, bp = i * 144, scB = bp + 4;
    let max_scale = 0.0, max_min = 0.0;
    for (let j = 0; j < 8; j++) {
      let sum_x2 = 0.0; for (let l = 0; l < 32; l++) sum_x2 = fr(sum_x2 + fr(x[xo + 32 * j + l] * x[xo + 32 * j + l]));
      const av_x = fr(Math.sqrt(fr(sum_x2 / 32)));
      for (let l = 0; l < 32; l++) weights[l] = fr(av_x + fr(Math.abs(x[xo + 32 * j + l])));
      const r = makeQkx2(32, 15, x, xo + 32 * j, weights, L, 32 * j, -1, 0.1, 20, false);
      scales[j] = r.scale; mins[j] = r.theMin;
      if (r.scale > max_scale) max_scale = r.scale;
      if (r.theMin > max_min) max_min = r.theMin;
    }
    const inv_scale = max_scale > 0 ? fr(63 / max_scale) : 0.0, inv_min = max_min > 0 ? fr(63 / max_min) : 0.0;
    for (let j = 0; j < 8; j++) {
      let ls = Math.min(63, nearestInt(fr(inv_scale * scales[j]))), lm = Math.min(63, nearestInt(fr(inv_min * mins[j])));
      if (j < 4) { out[scB + j] = ls; out[scB + j + 4] = lm; }
      else { out[scB + j + 4] = (ls & 0xf) | ((lm & 0xf) << 4); out[scB + j - 4] |= (ls >> 4) << 6; out[scB + j] |= (lm >> 4) << 6; }
    }
    dv.setUint16(bp, f32ToF16(fr(max_scale / 63)), true);
    dv.setUint16(bp + 2, f32ToF16(fr(max_min / 63)), true);
    const dAll = f16ToF32(dv.getUint16(bp, true)), dminAll = f16ToF32(dv.getUint16(bp + 2, true));
    for (let j = 0; j < 8; j++) {
      const [sc, m] = scaleMinK4(j, out.subarray(scB, scB + 12));
      const d = fr(dAll * sc); if (!d) continue;
      const dm = fr(dminAll * m);
      for (let ii = 0; ii < 32; ii++) { let l = nearestInt(fr(fr(x[xo + 32 * j + ii] + dm) / d)); L[32 * j + ii] = Math.max(0, Math.min(15, l)); }
    }
    let q = bp + 16;
    for (let j = 0; j < QK_K; j += 64) { for (let l = 0; l < 32; l++) out[q + l] = L[j + l] | (L[j + l + 32] << 4); q += 32; }
  }
  return out;
}

// make_qx_quants (:566): symmetric (signed) scale optimizer. n=16,nmax=32,rmse_type=1,
// qw=NULL for q6_K. Returns the best scale; L (scratch) is recomputed by the caller.
const GROUP_MAX_EPS = 1e-15;
function makeQxQuants(n, nmax, x, xoff, L, rmseType, qw, qwoff) {
  let max = 0.0, amax = 0.0;
  for (let i = 0; i < n; i++) { const ax = fabsf(x[xoff + i]); if (ax > amax) { amax = ax; max = x[xoff + i]; } }
  if (amax < GROUP_MAX_EPS) { for (let i = 0; i < n; i++) L[i] = 0; return 0.0; }
  let iscale = fr(-nmax / max);
  const wOf = (i) => qw ? qw[qwoff + i] : rmseType === 1 ? fr(x[xoff + i] * x[xoff + i]) : rmseType === 2 ? 1 : rmseType === 3 ? fabsf(x[xoff + i]) : fr(Math.sqrt(fabsf(x[xoff + i])));
  let sumlx = 0.0, suml2 = 0.0;
  for (let i = 0; i < n; i++) {
    let l = Math.max(-nmax, Math.min(nmax - 1, nearestInt(fr(iscale * x[xoff + i])))); L[i] = l + nmax;
    const w = wOf(i); sumlx = fr(sumlx + fr(fr(w * x[xoff + i]) * l)); suml2 = fr(suml2 + fr(fr(w * l) * l));
  }
  let scale = suml2 ? fr(sumlx / suml2) : 0.0, best = fr(scale * sumlx);
  for (let is = -9; is <= 9; is++) {
    if (is === 0) continue;
    iscale = fr(-fr(nmax + fr(0.1 * is)) / max); sumlx = 0.0; suml2 = 0.0;
    for (let i = 0; i < n; i++) {
      let l = Math.max(-nmax, Math.min(nmax - 1, nearestInt(fr(iscale * x[xoff + i]))));
      const w = wOf(i); sumlx = fr(sumlx + fr(fr(w * x[xoff + i]) * l)); suml2 = fr(suml2 + fr(fr(w * l) * l));
    }
    if (suml2 > 0 && fr(sumlx * sumlx) > fr(best * suml2)) {
      for (let i = 0; i < n; i++) L[i] = nmax + Math.max(-nmax, Math.min(nmax - 1, nearestInt(fr(iscale * x[xoff + i]))));
      scale = fr(sumlx / suml2); best = fr(scale * sumlx);
    }
  }
  return scale;
}

// quantize_row_q6_K_ref (:1807) / _impl (:1908). Block 210 B: ql[128] qh[64] scales:int8[16] d:f16.
// imatrix (quant_weights, an f32 per element) is the high-quality path llama-quantize uses;
// null → plain RNE. The ONLY difference is the per-element weight in make_qx_quants.
export function quantizeRowQ6K(x, k, imatrix = null) {
  const nb = k / QK_K, out = new Uint8Array(nb * 210), dv = new DataView(out.buffer);
  const L = new Int8Array(QK_K), Lscratch = new Int8Array(16), scales = new Float32Array(16);
  for (let i = 0; i < nb; i++) {
    const xo = i * QK_K, bp = i * 210, qlB = bp, qhB = bp + 128, scB = bp + 192;
    let max_scale = 0.0, max_abs_scale = 0.0;
    for (let ib = 0; ib < 16; ib++) {
      const scale = makeQxQuants(16, 32, x, xo + 16 * ib, Lscratch, 1, imatrix, xo + 16 * ib);
      scales[ib] = scale; const a = fabsf(scale);
      if (a > max_abs_scale) { max_abs_scale = a; max_scale = scale; }
    }
    if (max_abs_scale < GROUP_MAX_EPS) { dv.setUint16(bp + 208, f32ToF16(0), true); continue; } // zero block
    const iscale = fr(-128 / max_scale);
    dv.setUint16(bp + 208, f32ToF16(fr(1 / iscale)), true);
    for (let ib = 0; ib < 16; ib++) out[scB + ib] = Math.min(127, nearestInt(fr(iscale * scales[ib]))) & 0xff;
    const dAll = f16ToF32(dv.getUint16(bp + 208, true));
    for (let j = 0; j < 16; j++) {
      const d = fr(dAll * ((out[scB + j] << 24) >> 24)); if (!d) continue;        // scales are int8
      for (let ii = 0; ii < 16; ii++) { let l = nearestInt(fr(x[xo + 16 * j + ii] / d)); L[16 * j + ii] = Math.max(-32, Math.min(31, l)) + 32; }
    }
    let ql = qlB, qh = qhB;
    for (let j = 0; j < QK_K; j += 128) {
      for (let l = 0; l < 32; l++) {
        const q1 = L[j + l] & 0xf, q2 = L[j + l + 32] & 0xf, q3 = L[j + l + 64] & 0xf, q4 = L[j + l + 96] & 0xf;
        out[ql + l] = q1 | (q3 << 4); out[ql + l + 32] = q2 | (q4 << 4);
        out[qh + l] = (L[j + l] >> 4) | ((L[j + l + 32] >> 4) << 2) | ((L[j + l + 64] >> 4) << 4) | ((L[j + l + 96] >> 4) << 6);
      }
      ql += 64; qh += 32;
    }
  }
  return out;
}

// quantize_row_tq2_0_ref (:2313). Block 66 B: qs[64] (2 bits/elem) + d:f16. BitNet
// ternary: d = amax; each weight → lroundf(x·id)+1 ∈ {0,1,2} packed 4/byte. `roundf`
// here is lroundf semantics (ties away from zero). No imatrix (quant_weights unused).
export function quantizeRowTq2_0(x, k) {
  const nb = k / QK_K, out = new Uint8Array(nb * 66), dv = new DataView(out.buffer);
  for (let i = 0; i < nb; i++) {
    const xo = i * QK_K, bp = i * 66;
    let amax = 0.0;
    for (let j = 0; j < QK_K; j++) { const a = fabsf(x[xo + j]); if (a > amax) amax = a; }
    const d = amax, id = d ? fr(1.0 / d) : 0.0;
    dv.setUint16(bp + 64, f32ToF16(d), true);
    for (let j = 0; j < 64; j += 32) {        // two halves; each consumes 4*32 inputs
      const xh = xo + (j === 0 ? 0 : 128);
      for (let m = 0; m < 32; m++) {
        let q = 0;
        for (let n = 0; n < 4; n++) { const xi = roundf(fr(x[xh + m + n * 32] * id)) + 1; q += (xi & 3) << (2 * n); }
        out[bp + j + m] = q & 0xff;
      }
    }
  }
  return out;
}

// Dispatch by ggml type id (basic, round-to-nearest; no imatrix yet — S2).
export const quantizeRow = {
  8: quantizeRowQ8_0, 2: quantizeRowQ4_0, 6: quantizeRowQ5_0, 12: quantizeRowQ4K, 14: quantizeRowQ6K, 35: quantizeRowTq2_0,
};

// ── S3: κ-native model factory ──
// Quantize raw f32 weights INTO the substrate: each tensor → its verbatim quant bytes
// = one κ-object (the SAME the forge runner consumes), sealed into a plan with a root κ.
// Deterministic by construction: identical f32 in ⇒ identical bytes ⇒ identical κ/root.
// `tensors`: [{ name, dims, data:Float32Array, type?:ggmlTypeId }]. No external tool.
export function forgeQuantize(tensors, { defaultType = 12, format = "holo-quant/1" } = {}) {
  const blocks = new Map(), planTensors = [];
  for (const t of tensors) {
    const ty = t.type ?? defaultType, qfn = quantizeRow[ty];
    if (!qfn) throw new Error(`forgeQuantize: no quantizer for ggml type ${ty}`);
    const n = t.dims.reduce((a, b) => a * b, 1), nper = t.dims[0], nrows = n / nper;
    // optional per-row imatrix (length n_per_row, applied to every row) — its OWN κ-object
    let imRef = null, imFlat = null;
    if (t.imatrix) {
      if (t.imatrix.length !== nper) throw new Error(`forgeQuantize: imatrix len ${t.imatrix.length} ≠ n_per_row ${nper}`);
      const imBytes = new Uint8Array(t.imatrix.buffer, t.imatrix.byteOffset, t.imatrix.byteLength).slice();
      const imHex = sha256hex(imBytes);
      if (!blocks.has(imHex)) blocks.set(imHex, imBytes);
      imRef = kappa("sha256", imHex);
      if (nrows === 1) imFlat = t.imatrix;                       // tile per-row → flat for the quantizer
      else { imFlat = new Float32Array(n); for (let r = 0; r < nrows; r++) imFlat.set(t.imatrix, r * nper); }
    }
    const blob = qfn(t.data, n, imFlat);                         // EXACT quant bytes = the κ-object
    const hex = sha256hex(blob);
    if (!blocks.has(hex)) blocks.set(hex, blob);                 // L2 dedup by content
    const pt = { name: t.name, dims: t.dims, type: ty, typeName: GGML_TYPE_NAME[ty] || String(ty), nbytes: blob.length, kappa: kappa("sha256", hex), sri: sriOf(blob) };
    if (imRef) pt.imatrix = imRef;
    planTensors.push(pt);
  }
  const plan = { format, quantizer: "ggml-bit-exact", tensors: planTensors };
  const rootKappa = didHolo("sha256", sha256hex(jcs(plan)));
  return { tensors: planTensors, blocks, plan, rootKappa };
}
