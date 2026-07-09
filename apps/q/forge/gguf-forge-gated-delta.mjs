// gguf-forge-gated-delta.mjs — CPU reference for the Qwen3-Next / qwen35 gated-DeltaNet linear-attention
// layer. This is the NEW kernel the hybrid `qwen35` brain needs (24 of 32 layers); the attention layers
// reuse the existing GQA path. Transcribed from the HF reference (modeling_qwen3_next.py
// torch_recurrent_gated_delta_rule + Qwen3NextRMSNormGated), mapped to the GGUF tensor layout:
//   attn_qkv → q,k,v  ·  attn_gate → z  ·  ssm_beta → b  ·  ssm_alpha → a  ·  ssm_a → A_log  ·  ssm_dt.bias
//   ssm_conv1d → causal depthwise conv  ·  ssm_norm → gated RMSNorm  ·  ssm_out → out_proj
//
// THE recurrence (per v-head, state S ∈ ℝ^{head_k_dim × head_v_dim}):
//   decay : S    ← S · exp(g_t)            g_t = -exp(A_log)·softplus(a_t + dt_bias)   (scalar/head)
//   read-mem: kv ← kᵀ·S                    (over k_dim → v_dim)
//   delta : δ    ← β_t · (v_t − kv)        β_t = sigmoid(b_t)                          (scalar/head)
//   write : S    ← S + k_t ⊗ δ
//   out   : o_t  ← qᵀ·S
//
// CRITICAL PROPERTY (the whole streaming vision rests on it): S is a SMALL, FIXED-SIZE tensor —
// independent of context length. So S is content-addressable: it serializes to bytes → a κ. That makes the
// thinking-prefix state memoizable (holo-kmemo) and roamable (session-roam). stateBytes/stateFromBytes +
// stateKappa expose it as a first-class κ-object. (A softmax-attention KV cache cannot do this — it grows.)

import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

export const softplus = (x) => (x > 20 ? x : Math.log1p(Math.exp(x)));   // numerically stable
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// L2-normalize each head's slice in place: x ← x·rsqrt(Σx²+eps). qwen3-next applies this to q and k
// before the delta rule (use_qk_l2norm_in_kernel=True) — FLA-aligned (modeling_qwen3_next l2norm).
export function l2normHeads(x, nHeads, headDim, eps = 1e-6) {
  for (let h = 0; h < nHeads; h++) {
    const o = h * headDim; let ss = 0;
    for (let i = 0; i < headDim; i++) ss += x[o + i] * x[o + i];
    const inv = 1 / Math.sqrt(ss + eps);
    for (let i = 0; i < headDim; i++) x[o + i] *= inv;
  }
  return x;
}

// per-step decay exp(g_t) for each v-head. a: Float32Array[nHeads] (the `a` projection at this token);
// aLog (ssm_a) and dtBias (ssm_dt.bias): Float32Array[nHeads]. Returns Float32Array[nHeads] in (0,1].
export function gatedDeltaDecay(a, aLog, dtBias, nHeads) {
  const out = new Float32Array(nHeads);
  for (let h = 0; h < nHeads; h++) {
    const g = -Math.exp(aLog[h]) * softplus(a[h] + dtBias[h]);   // g ≤ 0
    out[h] = Math.exp(g);                                        // decay ∈ (0,1]
  }
  return out;
}

// a fresh zero state. layout: flat [h * headK*headV + ki*headV + vj].
export const newState = (nHeads, headK, headV) => new Float32Array(nHeads * headK * headV);

// ONE recurrent step, IN PLACE on S. q,k: [nHeads*headK]; v: [nHeads*headV]; decay,beta: [nHeads].
// Returns o_t: Float32Array[nHeads*headV]. This is the optimized path (decay fused into the read).
export function gatedDeltaStep(S, q, k, v, decay, beta, nHeads, headK, headV) {
  const o = new Float32Array(nHeads * headV);
  const kvmem = new Float32Array(headV), delta = new Float32Array(headV);
  for (let h = 0; h < nHeads; h++) {
    const base = h * headK * headV, dec = decay[h], b = beta[h];
    const ko = h * headK, vo = h * headV;
    kvmem.fill(0);
    for (let ki = 0; ki < headK; ki++) {                    // decay + kv_mem = kᵀ·S
      const kk = k[ko + ki], row = base + ki * headV;
      for (let vj = 0; vj < headV; vj++) { const s = S[row + vj] * dec; S[row + vj] = s; kvmem[vj] += s * kk; }
    }
    for (let vj = 0; vj < headV; vj++) delta[vj] = (v[vo + vj] - kvmem[vj]) * b;   // δ = β(v − kv)
    for (let ki = 0; ki < headK; ki++) {                    // S += k ⊗ δ  ; o = qᵀ·S
      const kk = k[ko + ki], qq = q[ko + ki], row = base + ki * headV;
      for (let vj = 0; vj < headV; vj++) { const s = S[row + vj] + kk * delta[vj]; S[row + vj] = s; o[vo + vj] += qq * s; }
    }
  }
  return o;
}

// Independent reference (per-head 2D arrays, textbook order) — a cross-check on the flat optimized path.
export function gatedDeltaStepRef(S2, q, k, v, decay, beta, nHeads, headK, headV) {
  const o = new Float32Array(nHeads * headV);
  for (let h = 0; h < nHeads; h++) {
    const M = S2[h], dec = decay[h], b = beta[h], ko = h * headK, vo = h * headV;
    for (let i = 0; i < M.length; i++) M[i] *= dec;                         // 1) decay
    const kv = new Float32Array(headV);
    for (let vj = 0; vj < headV; vj++) { let acc = 0; for (let ki = 0; ki < headK; ki++) acc += M[ki * headV + vj] * k[ko + ki]; kv[vj] = acc; }  // 2) kᵀS
    for (let ki = 0; ki < headK; ki++) for (let vj = 0; vj < headV; vj++) M[ki * headV + vj] += k[ko + ki] * (b * (v[vo + vj] - kv[vj]));           // 3,4) δ, write
    for (let vj = 0; vj < headV; vj++) { let acc = 0; for (let ki = 0; ki < headK; ki++) acc += q[ko + ki] * M[ki * headV + vj]; o[vo + vj] = acc; } // 5) qᵀS
  }
  return o;
}

// gated RMSNorm over head_v_dim, then ⊙ SiLU(z): o ← (o/√(mean(o²)+eps)) · weight · silu(z). In place on o.
export function gatedRMSNormGated(o, weight, z, nHeads, headV, eps = 1e-6) {
  for (let h = 0; h < nHeads; h++) {
    const vo = h * headV; let ss = 0;
    for (let vj = 0; vj < headV; vj++) ss += o[vo + vj] * o[vo + vj];
    const inv = 1 / Math.sqrt(ss / headV + eps);
    for (let vj = 0; vj < headV; vj++) { const zz = z[vo + vj]; o[vo + vj] = o[vo + vj] * inv * weight[vj] * (zz * sigmoid(zz)); }
  }
  return o;
}

// ── the κ-object surface: S ⇄ bytes ⇄ κ (this is what makes the thinking state memoizable + roamable) ──
export const stateBytes = (S) => new Uint8Array(S.buffer, S.byteOffset, S.byteLength).slice();
export const stateFromBytes = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
export const stateKappa = (S) => "did:holo:sha256:" + sha256hex(stateBytes(S));

export default { gatedDeltaDecay, newState, gatedDeltaStep, gatedDeltaStepRef, gatedRMSNormGated, stateBytes, stateFromBytes, stateKappa, softplus, sigmoid };
