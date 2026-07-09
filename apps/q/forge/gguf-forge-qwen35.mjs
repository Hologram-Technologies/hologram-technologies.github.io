// gguf-forge-qwen35.mjs — the qwen35 (Qwen3-Next) HYBRID layer assembly. Wires the proven gated-DeltaNet
// kernel (gguf-forge-gated-delta.mjs) together with the causal conv, the q/k/v/z/a/b projections, and the
// gated RMSNorm into ONE linear-attention layer forward; plus the per-layer schedule (which of the 32 layers
// are linear vs full attention). The full-attention layers reuse the existing GQA path (not here).
//
// Dimension decode (from GGUF hparams, cross-checked vs the blk.0 tensor shapes):
//   value_dim = ssm.inner_size (4096)   head_k = ssm.state_size (128)   num_k_heads = ssm.group_count (16)
//   key_dim   = num_k_heads·head_k (2048)   head_v = head_k (128)   num_v_heads = value_dim/head_v (32)
//   conv_dim  = 2·key_dim + value_dim (8192)  = the [q | k | v] the depthwise conv runs over.
//
// Layer state = { S (gated-delta recurrent state, fixed size), convTail (last conv_k−1 pre-conv qkv tokens) }.
// BOTH are fixed-size → the layer state is a κ-object: stateBytes/stateKappa make chunked decode resumable and
// roamable, and a one-shot prefill is BIT-IDENTICAL to chunked stepping (witnessed). Numerical parity vs the
// llama.cpp quantized build (and confirming the HF head-expansion order) is a separate gate (S4.7).

import { gatedDeltaDecay, gatedDeltaStep, gatedRMSNormGated, newState, sigmoid, l2normHeads } from "./gguf-forge-gated-delta.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

// which layers are full attention (every full_attention_interval-th, 1-indexed in llama.cpp → index%interval==interval-1)
export function qwen35Schedule(nLayer, interval) {
  const out = [];
  for (let i = 0; i < nLayer; i++) out.push((interval && (i + 1) % interval === 0) ? "attn" : "linear");
  return out;
}

export function qwen35Dims(meta) {
  const g = (k) => meta[`qwen35.${k}`];
  const d_model = g("embedding_length");
  const value_dim = g("ssm.inner_size");
  const head_k = g("ssm.state_size");
  const num_k_heads = g("ssm.group_count");
  const head_v = head_k;
  const key_dim = num_k_heads * head_k;
  const num_v_heads = Math.round(value_dim / head_v);
  return { d_model, value_dim, head_k, head_v, num_k_heads, num_v_heads, key_dim, conv_dim: 2 * key_dim + value_dim, conv_k: g("ssm.conv_kernel"), eps: g("attention.layer_norm_rms_epsilon") || 1e-6, n_layer: g("block_count"), interval: g("full_attention_interval") };
}

// y[o] = Σ_i W[o·nIn + i]·x[i]   (GGUF weights are out-major, in-minor)
export function matvec(W, x, nIn, nOut) {
  const y = new Float32Array(nOut);
  for (let o = 0; o < nOut; o++) { let acc = 0; const base = o * nIn; for (let i = 0; i < nIn; i++) acc += W[base + i] * x[i]; y[o] = acc; }
  return y;
}
function rmsNorm(x, w, eps) {                 // Qwen3NextRMSNorm (input_layernorm): Gemma-style ·(1+weight)
  let ss = 0; for (let i = 0; i < x.length; i++) ss += x[i] * x[i];
  const inv = 1 / Math.sqrt(ss / x.length + eps), o = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) o[i] = x[i] * inv * (1 + w[i]);
  return o;
}

export const newLayerState = (D) => ({ S: newState(D.num_v_heads, D.head_k, D.head_v), convTail: new Float32Array((D.conv_k - 1) * D.conv_dim) });
export function layerStateBytes(st) { const f = new Float32Array(st.S.length + st.convTail.length); f.set(st.S, 0); f.set(st.convTail, st.S.length); return new Uint8Array(f.buffer); }
export const layerStateKappa = (st) => "did:holo:sha256:" + sha256hex(layerStateBytes(st));

// W: { attn_norm, attn_qkv, attn_gate, ssm_alpha, ssm_beta, ssm_a, ssm_dt, ssm_conv1d, ssm_norm, ssm_out } (F32).
// xSeq: Array<Float32Array[d_model]>. state: from newLayerState(D). Returns { ySeq, state } (S mutated in place,
// convTail fresh) so chunks chain. ySeq is the layer DELTA (caller adds the residual).
export function qwen35LinearLayer(W, D, xSeq, state, opts = {}) {
  const T = xSeq.length, C = D.conv_dim, K = D.conv_k, group = D.num_v_heads / D.num_k_heads;
  const qScale = 1 / Math.sqrt(D.head_k);          // scale q after l2norm (recurrent kernel: query *= 1/√d)
  // phase 1 — per-token projections
  const qkv = [], zArr = [], aArr = [], bArr = [];
  for (let t = 0; t < T; t++) {
    const xn = opts.inputNormed ? xSeq[t] : rmsNorm(xSeq[t], W.attn_norm, D.eps);
    qkv.push(matvec(W.attn_qkv, xn, D.d_model, C));
    zArr.push(matvec(W.attn_gate, xn, D.d_model, D.value_dim));
    aArr.push(matvec(W.ssm_alpha, xn, D.d_model, D.num_v_heads));
    bArr.push(matvec(W.ssm_beta, xn, D.d_model, D.num_v_heads));
  }
  // phase 2 — causal depthwise conv1d + SiLU over qkv, seeded by convTail (left context across chunks)
  const ctx = [];
  for (let j = 0; j < K - 1; j++) ctx.push(state.convTail.subarray(j * C, (j + 1) * C));
  for (let t = 0; t < T; t++) ctx.push(qkv[t]);
  const conv = [];
  for (let t = 0; t < T; t++) {
    const out = new Float32Array(C);
    for (let c = 0; c < C; c++) { let acc = 0; for (let j = 0; j < K; j++) acc += W.ssm_conv1d[j * C + c] * ctx[t + j][c]; out[c] = acc * sigmoid(acc); }
    conv.push(out);
  }
  const convTail = new Float32Array((K - 1) * C);            // carry the last K−1 PRE-conv qkv tokens
  for (let j = 0; j < K - 1; j++) convTail.set(ctx[T + j], j * C);
  // phase 3 — per-token gated-delta recurrence
  const S = state.S, ySeq = [];
  for (let t = 0; t < T; t++) {
    const cv = conv[t];
    const qP = cv.subarray(0, D.key_dim), kP = cv.subarray(D.key_dim, 2 * D.key_dim), vP = cv.subarray(2 * D.key_dim, 2 * D.key_dim + D.value_dim);
    const qE = new Float32Array(D.num_v_heads * D.head_k), kE = new Float32Array(D.num_v_heads * D.head_k);
    for (let h = 0; h < D.num_v_heads; h++) { const kh = Math.floor(h / group) * D.head_k; qE.set(qP.subarray(kh, kh + D.head_k), h * D.head_k); kE.set(kP.subarray(kh, kh + D.head_k), h * D.head_k); }
    l2normHeads(qE, D.num_v_heads, D.head_k); l2normHeads(kE, D.num_v_heads, D.head_k);   // qwen3-next: L2-norm q,k per head
    for (let i = 0; i < qE.length; i++) qE[i] *= qScale;                                   // then scale q by 1/√head_k
    const decay = gatedDeltaDecay(aArr[t], W.ssm_a, W.ssm_dt, D.num_v_heads);
    const beta = new Float32Array(D.num_v_heads); for (let h = 0; h < D.num_v_heads; h++) beta[h] = sigmoid(bArr[t][h]);
    const o = gatedDeltaStep(S, qE, kE, vP, decay, beta, D.num_v_heads, D.head_k, D.head_v);
    gatedRMSNormGated(o, W.ssm_norm, zArr[t], D.num_v_heads, D.head_v, D.eps);
    ySeq.push(matvec(W.ssm_out, o, D.value_dim, D.d_model));
  }
  return { ySeq, state: { S, convTail } };
}

export default { qwen35Schedule, qwen35Dims, qwen35LinearLayer, newLayerState, layerStateBytes, layerStateKappa, matvec };
