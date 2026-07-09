// GGUF Forge — Tier-A element-wise / norm / attention kernels (float32-exact).
//
// These turn the synthesized graph into a runnable forward pass. Transcribed from
// qvac-fabric-llm.cpp ggml/src/ggml-cpu/ops.cpp + vec.*:
//   rms_norm   ggml_compute_forward_rms_norm_f32 (:3907) — sum of squares in f64
//   silu       ggml_silu_f32 (vec.h:1071)  = x/(1+expf(-x))
//   swiglu     ggml_vec_swiglu_f32         = silu(gate)*up
//   soft_max   ggml_compute_forward_soft_max_f32 (:5552) — scale, +mask, max-sub, exp/sum
//   rope NEOX  ggml_compute_forward_rope_flt (:6052) + rotate_pairs (:6038)
//
// Transcendental seams: ggml uses libm expf/cosf/sinf and SIMD polynomial approxes;
// we use fround(Math.exp/cos/sin) (the scalar reference), which agrees to a few ULP
// but is not guaranteed bit-identical to a specific libm. The conformance gate's
// tolerance covers this; greedy-token parity is unaffected at these magnitudes.

const fr = Math.fround;

// rms_norm over one row of length n, then multiply by `weight` (build_norm LLM_NORM_RMS).
// sum of squares accumulates in float64 (ggml_float), matching ggml exactly.
export function rmsNorm(x, weight, eps, n = x.length) {
  let sum = 0.0;                                  // ggml_float (f64)
  for (let i = 0; i < n; i++) sum += fr(x[i] * x[i]);
  const mean = fr(sum / n);
  const scale = fr(1.0 / fr(Math.sqrt(fr(mean + eps))));
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = fr(x[i] * scale);
    y[i] = weight ? fr(v * weight[i]) : v;
  }
  return y;
}

export const silu = (x) => fr(x / fr(1.0 + fr(Math.exp(fr(-x)))));

// softplus = log(1+exp(x)), with the x>20 fast path (ggml_compute_softplus_f32).
// Used by the Mamba selective-scan to make Δt positive.
export const softplus = (x) => (x > 20 ? x : fr(Math.log1p(fr(Math.exp(fr(x))))));

import { f16ToF32 } from "../qvac-ingest.mjs";
import { f32ToF16 } from "./gguf-forge-matmul.mjs";
const f16r = (x) => f16ToF32(f32ToF16(x)); // f32 → f16 → f32 round-trip

// ggml_conv_1d (ggml.c:4580): multi-channel strided 1D conv via im2col-in-F16 + matmul.
// input [IC][L] (channel-major: input[ic*L+l]), weight [OC][IC][K] (= ggml ne [K,IC,OC]:
// weight[oc*IC*K + ic*K + k]), output [OC][OL] (out[oc*OL+ol]). ggml casts the im2col
// patches to F16 → we round inputs likewise; the stored conv weight is already F16-valued.
// RAW conv only — bias add + GELU are separate ggml ops applied by the caller (Whisper stem).
export function conv1d(input, weight, IC, OC, K, L, stride, pad) {
  const OL = (((L + 2 * pad - K) / stride) | 0) + 1, out = new Float32Array(OC * OL);
  const inH = new Float32Array(input.length);                  // im2col casts each input element to F16 ONCE
  for (let i = 0; i < input.length; i++) inH[i] = f16r(input[i]);
  for (let oc = 0; oc < OC; oc++) {
    const wb = oc * IC * K;
    for (let ol = 0; ol < OL; ol++) {
      let s = 0.0;
      for (let ic = 0; ic < IC; ic++) {
        const ib = ic * L, wcb = wb + ic * K;
        for (let k = 0; k < K; k++) { const ip = ol * stride - pad + k; if (ip < 0 || ip >= L) continue; s = fr(s + fr(inH[ib + ip] * weight[wcb + k])); }
      }
      out[oc * OL + ol] = fr(s);
    }
  }
  return out;
}

// LayerNorm (ggml_norm + affine): mean/var over n (double accum like ggml), then
// (x−mean)/√(var+eps) · weight + bias. RWKV uses LayerNorm (not RMS), with bias.
export function layerNorm(x, weight, bias, eps, n = x.length) {
  let sum = 0; for (let i = 0; i < n; i++) sum += x[i];
  const mean = sum / n;
  let s2 = 0; for (let i = 0; i < n; i++) { const d = x[i] - mean; s2 += d * d; }
  const scale = 1 / Math.sqrt(s2 / n + eps), y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = fr(fr(fr(fr(x[i] - mean) * scale) * weight[i]) + (bias ? bias[i] : 0));
  return y;
}

// ── RWKV7 delta-rule WKV (ggml_rwkv_wkv7, ggml-cpu/ops.cpp:10989; one token) ──
// Per head h, per i: sa = Σ_j a[j]·state[i,j]; state[i,j] = state[i,j]·w[j] + v[i]·k[j]
// + sa·b[j]; out[i] = Σ_j state[i,j]·r[j]. state is [H][S][S] (row i = state[i,:]),
// updated in place. r/w/k/v/a/b are length C=H·S (per head h: slice [h*S, h*S+S)).
export function wkv7(r, w, k, v, a, b, state, H, S) {
  const out = new Float32Array(H * S);
  for (let h = 0; h < H; h++) {
    const ho = h * S, h2 = h * S * S;
    for (let i = 0; i < S; i++) {
      const vi = v[ho + i], rowi = h2 + i * S;
      let sa = 0.0;
      for (let j = 0; j < S; j++) sa = fr(sa + fr(a[ho + j] * state[rowi + j]));
      let res = 0.0;
      for (let j = 0; j < S; j++) {
        const st = fr(fr(state[rowi + j] * w[ho + j]) + fr(fr(vi * k[ho + j]) + fr(sa * b[ho + j])));
        state[rowi + j] = st;
        res = fr(res + fr(st * r[ho + j]));
      }
      out[ho + i] = res;
    }
  }
  return out;
}

// ── Mamba recurrent kernels (one token; state updated in place) ──
// ggml_ssm_conv (ggml-cpu/ops.cpp:9575). Causal depthwise conv1d over the window
// [convState ‖ xin] with weight convW {d_inner,d_conv} (row-major: convW[ch*d_conv+k]).
// Returns the RAW conv output (no bias, no activation — those are separate ggml ops),
// and slides convState (length d_inner*(d_conv-1)) forward by one (drop oldest, append xin).
export function ssmConv1d(xin, convState, convW, dInner, dConv) {
  const out = new Float32Array(dInner);
  for (let ch = 0; ch < dInner; ch++) {
    const base = ch * (dConv - 1), wb = ch * dConv;
    let s = 0.0;
    for (let k = 0; k < dConv - 1; k++) s = fr(s + fr(convState[base + k] * convW[wb + k]));
    out[ch] = fr(s + fr(xin[ch] * convW[wb + dConv - 1]));
    for (let k = 0; k < dConv - 2; k++) convState[base + k] = convState[base + k + 1];
    convState[base + dConv - 2] = xin[ch];
  }
  return out;
}

// ggml_ssm_scan Mamba-1 path (ggml-cpu/ops.cpp:9797). Per channel h: Δ=softplus(dt[h]),
// state = state·exp(Δ·A) + Δ·B·x, y = Σ state·C. A {d_state,d_inner} (=−exp(A_log), neg),
// B/C length d_state (n_group=1, shared). dt is the post-bias Δt; softplus is applied here.
// Returns RAW scan y [d_inner] (no D skip / z gate); ssmState [d_inner*d_state] updated.
export function selectiveScan(x, dt, A, B, C, ssmState, dInner, dState) {
  const y = new Float32Array(dInner);
  for (let h = 0; h < dInner; h++) {
    const dtsp = softplus(dt[h]), xdt = fr(x[h] * dtsp), sb = h * dState;
    let acc = 0.0;
    for (let i0 = 0; i0 < dState; i0++) {
      const st = fr(fr(ssmState[sb + i0] * fr(Math.exp(fr(dtsp * A[sb + i0])))) + fr(B[i0] * xdt));
      acc = fr(acc + fr(st * C[i0])); ssmState[sb + i0] = st;
    }
    y[h] = acc;
  }
  return y;
}

// ggml_ssm_scan Mamba-2 path (ggml-cpu/ops.cpp:9700). Scalar decay per head:
// dA = exp(softplus(dt[h])·A[h]) (A {1,n_head}); state = state·dA + Δ·B·x, y = Σ state·C.
// Heads carry head_dim channels; B/C are per-group (g = h/(n_head/n_group)). x layout
// {head_dim,n_head}, state {d_state,head_dim,n_head}. Returns RAW y [n_head*head_dim].
export function selectiveScan2(x, dt, A, B, C, ssmState, nHead, headDim, dState, nGroup) {
  const y = new Float32Array(nHead * headDim), hpg = nHead / nGroup;
  for (let h = 0; h < nHead; h++) {
    const dtsp = softplus(dt[h]), dA = fr(Math.exp(fr(dtsp * A[h]))), gb = Math.floor(h / hpg) * dState;
    for (let i1 = 0; i1 < headDim; i1++) {
      const ii = i1 + h * headDim, xdt = fr(x[ii] * dtsp), sb = ii * dState;
      let acc = 0.0;
      for (let i0 = 0; i0 < dState; i0++) {
        const st = fr(fr(ssmState[sb + i0] * dA) + fr(B[gb + i0] * xdt));
        acc = fr(acc + fr(st * C[gb + i0])); ssmState[sb + i0] = st;
      }
      y[ii] = acc;
    }
  }
  return y;
}

// swiglu: out[i] = silu(gate[i]) * up[i]  (LLM_FFN_SILU / LLM_FFN_PAR).
export function swiglu(gate, up, n = gate.length) {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = fr(silu(gate[i]) * up[i]);
  return y;
}

// gelu — tanh approximation (ggml_vec_gelu_f32 / GELU_COEF_A, SQRT_2_OVER_PI;
// = gelu_pytorch_tanh, what Gemma uses). ggml's CPU path routes through an f16
// lookup table; we compute the formula in f32 (greedy-parity tolerance, not
// bit-exact). y = 0.5x(1 + tanh(√(2/π)·x·(1 + 0.044715x²))).
const GELU_COEF_A = 0.044715, SQRT_2_OVER_PI = 0.7978845608028654;
export const gelu = (x) => fr(fr(0.5 * x) * fr(1.0 + Math.tanh(fr(SQRT_2_OVER_PI * fr(x * fr(1.0 + fr(GELU_COEF_A * fr(x * x))))))));

// geglu: out[i] = gelu(gate[i]) * up[i]  (LLM_FFN_GELU / LLM_FFN_PAR — Gemma).
export function geglu(gate, up, n = gate.length) {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = fr(gelu(gate[i]) * up[i]);
  return y;
}

// scaled + (optional) masked softmax over one row. max_bias/ALiBi/sinks omitted
// (slope=1) — the LLM attention path. `mask` is a Float32Array of additive bias
// (0 or -Infinity for causal), or null. Returns a new normalized Float32Array.
export function softmax(scores, scale, mask = null, n = scores.length) {
  const wp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = fr(scores[i] * scale);
    if (mask) v = fr(v + mask[i]);               // slope=1
    wp[i] = v;
  }
  let max = -Infinity;
  for (let i = 0; i < n; i++) if (wp[i] > max) max = wp[i];
  const dp = new Float32Array(n);
  let sum = 0.0;                                  // ggml_float (f64)
  for (let i = 0; i < n; i++) { const e = fr(Math.exp(fr(wp[i] - max))); dp[i] = e; sum += e; }
  const inv = fr(1.0 / sum);
  for (let i = 0; i < n; i++) dp[i] = fr(dp[i] * inv);
  return dp;
}

// ── MoE router + combine (build_moe_ffn, src/llama-graph.cpp:1396-1749) ──────────
// The only structural difference between a dense and an MoE layer: the FFN is
// replaced by (router → top-k expert select → per-expert FFN → weighted sum). These
// kernels are the routing + combine math; the per-expert matmul (mul_mat_id) reuses
// the existing GEMV path. Transcribed op-for-op with citations below.

// ggml_vec_sigmoid_f32: 1/(1+e^-x).
export const sigmoid = (x) => fr(1.0 / fr(1.0 + fr(Math.exp(fr(-x)))));

// ggml_argsort_top_k (ggml.c:5363) = full DESC argsort then first k. The sort is an
// UNSTABLE std::sort with strict `>` (ops.cpp:8361); exact-value ties are therefore
// unspecified in ggml — we break them by ascending index (deterministic). Router
// logits from a matmul don't tie in practice, and the combine is a commutative sum,
// so intra-set order never changes the emitted token.
export function moeTopK(vals, k) {
  const idx = Array.from({ length: vals.length }, (_, i) => i);
  idx.sort((a, b) => (vals[a] > vals[b] ? -1 : vals[a] < vals[b] ? 1 : a - b));
  return idx.slice(0, k);
}

// Router: logits[n_expert] (= gate_inp·cur, already incl. gate_inp_b) → selected
// expert indices + their combine weights. Mirrors build_moe_ffn :1438-1544:
//   probs = gating(logits)                       softmax | sigmoid | softmax_weight
//   selection_probs = probs (+ exp_probs_b)      selection bias is added for top-k ONLY
//   selected = top_k(selection_probs, used)
//   weights  = probs[selected]                   gathered from UNBIASED probs (:1515)
//   softmax_weight: weights = softmax(weights)   (:1519)
//   norm_w: weights /= clamp(sum, 6.1e-5, inf)   (:1526)   wScale: weights *= w_scale (:1541)
export function moeRoute(logits, opts = {}) {
  const { gatingOp = "softmax", nExpertUsed, selBias = null, normW = false, wScale = 1.0 } = opts;
  const nExpert = logits.length;
  let probs;
  if (gatingOp === "softmax") probs = softmax(logits, 1.0);          // ggml_soft_max, scale=1
  else if (gatingOp === "sigmoid") { probs = new Float32Array(nExpert); for (let i = 0; i < nExpert; i++) probs[i] = sigmoid(logits[i]); }
  else probs = Float32Array.from(logits);                            // softmax_weight: probs = logits
  let selProbs = probs;
  if (selBias) { selProbs = new Float32Array(nExpert); for (let i = 0; i < nExpert; i++) selProbs[i] = fr(probs[i] + selBias[i]); }
  const selected = moeTopK(selProbs, nExpertUsed);
  let weights = new Float32Array(nExpertUsed);
  for (let i = 0; i < nExpertUsed; i++) weights[i] = probs[selected[i]];
  if (gatingOp === "softmax_weight") weights = softmax(weights, 1.0);
  if (normW) {
    let s = 0.0;                                                     // ggml_sum_rows accumulates in ggml_float (f64)
    for (let i = 0; i < nExpertUsed; i++) s += weights[i];
    let denom = fr(s); if (denom < 6.103515625e-5) denom = 6.103515625e-5;  // ggml_clamp min = smallest f16 normal
    for (let i = 0; i < nExpertUsed; i++) weights[i] = fr(weights[i] / denom);
  }
  if (wScale !== 0.0 && wScale !== 1.0) for (let i = 0; i < nExpertUsed; i++) weights[i] = fr(weights[i] * wScale);
  return { selected, weights };
}

// Combine: moe_out = Σ_i expertOut[i] * weight[i] over the selected experts, summed
// in selected order (build_moe_ffn :1712-1739; post-FFN weighting, the non-llama4
// path). expertOuts = array of Float32Array(nEmbd), one per selected expert.
export function moeCombine(expertOuts, weights, nEmbd) {
  const out = new Float32Array(nEmbd);
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i], e = expertOuts[i];
    for (let j = 0; j < nEmbd; j++) out[j] = fr(out[j] + fr(e[j] * w));
  }
  return out;
}

// RoPE NEOX on one head vector `x` (length headDim), in place into a new array.
// Pairs (ic, ic+n_rot/2) rotated by theta = pos * freq_base^(-2*ic/n_rot). Channels
// >= n_rot pass through. No YaRN (ext_factor=0, freq_scale=1, attn_factor=1).
export function ropeNeox(x, pos, nRot, freqBase, headDim = x.length) {
  const out = Float32Array.from(x);
  const thetaScale = fr(Math.pow(freqBase, fr(-2.0 / nRot)));
  const half = nRot >> 1;
  let theta = fr(pos);
  for (let ic = 0; ic < half; ic++) {
    const cos = fr(Math.cos(theta)), sin = fr(Math.sin(theta));
    const x0 = x[ic], x1 = x[ic + half];
    out[ic] = fr(fr(x0 * cos) - fr(x1 * sin));
    out[ic + half] = fr(fr(x0 * sin) + fr(x1 * cos));
    theta = fr(theta * thetaScale);
  }
  return out;                                     // channels [nRot, headDim) already copied
}
