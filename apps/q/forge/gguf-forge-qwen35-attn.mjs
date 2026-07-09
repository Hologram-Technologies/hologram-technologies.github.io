// gguf-forge-qwen35-attn.mjs — the qwen35 (Qwen3-Next) FULL-attention layer (every full_attention_interval-th
// layer; 8 of 32). Distinct from vanilla GQA: a sigmoid OUTPUT GATE packed into q_proj, per-head QK-norm, and
// PARTIAL NEOX RoPE. Transcribed from HF Qwen3NextAttention; numerically parity-checked
// (gguf-forge-qwen35-attn-parity.test.mjs) vs the reference.
//
// Dims (real model): n_head 16 (q), n_kv 4, head_dim 256 (key_length), rope_dim 64 (partial). q_proj output is
// n_head·head_dim·2 = q | gate per head (that's why attn_q is [4096→8192]); attn_output = n_head·head_dim → d_model.
//
// forward(W, D, xSeq, cosSeq, sinSeq): xSeq pre-mixer hidden states (input_layernorm applied here unless
// opts.inputNormed). cosSeq/sinSeq: per-token rope vectors (length rope_dim). Returns { ySeq } (the mixer delta).

import { matvec } from "./gguf-forge-qwen35.mjs";
import { sigmoid } from "./gguf-forge-gated-delta.mjs";

function rmsNormVec(x, w, eps) {                       // Qwen3NextRMSNorm: Gemma-style x·rsqrt(mean(x²)+eps)·(1+weight)
  let ss = 0; for (let i = 0; i < x.length; i++) ss += x[i] * x[i];
  const inv = 1 / Math.sqrt(ss / x.length + eps), o = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) o[i] = x[i] * inv * (1 + w[i]);
  return o;
}
// partial NEOX RoPE on a head vector. HF rotate_half splits at HEAD_DIM/2 (dim i pairs with i+head_dim/2), and
// only the first rope_dim dims carry nonzero cos/sin (the rest pass through). cos/sin have length rope_dim.
function applyRope(v, cos, sin) {
  const rd = cos.length, half = v.length / 2, o = Float32Array.from(v);
  for (let i = 0; i < rd; i++) { const rot = i < half ? -v[i + half] : v[i - half]; o[i] = v[i] * cos[i] + rot * sin[i]; }
  return o;
}

export function qwen35Attention(W, D, xSeq, cosSeq, sinSeq, opts = {}) {
  const T = xSeq.length, hd = D.head_dim, nh = D.n_head, nkv = D.n_kv, grp = nh / nkv, scaling = 1 / Math.sqrt(hd);
  const Q = [], G = [], Kc = [], Vc = [];
  for (let t = 0; t < T; t++) {
    const xn = opts.inputNormed ? xSeq[t] : rmsNormVec(xSeq[t], W.attn_norm, D.eps);
    const qg = matvec(W.attn_q, xn, D.d_model, nh * hd * 2);     // [head: q(hd) | gate(hd)] ×nh
    const qh = new Float32Array(nh * hd), gh = new Float32Array(nh * hd);
    for (let h = 0; h < nh; h++) {
      const base = h * hd * 2;
      let q = rmsNormVec(qg.subarray(base, base + hd), W.attn_q_norm, D.eps);
      q = applyRope(q, cosSeq[t], sinSeq[t]);
      qh.set(q, h * hd); gh.set(qg.subarray(base + hd, base + 2 * hd), h * hd);
    }
    const kk = matvec(W.attn_k, xn, D.d_model, nkv * hd), vv = matvec(W.attn_v, xn, D.d_model, nkv * hd);
    const kh = new Float32Array(nkv * hd);
    for (let kv = 0; kv < nkv; kv++) { let k = rmsNormVec(kk.subarray(kv * hd, kv * hd + hd), W.attn_k_norm, D.eps); k = applyRope(k, cosSeq[t], sinSeq[t]); kh.set(k, kv * hd); }
    Q.push(qh); G.push(gh); Kc.push(kh); Vc.push(vv);
  }
  const ySeq = [];
  for (let t = 0; t < T; t++) {
    const attnOut = new Float32Array(nh * hd);
    for (let h = 0; h < nh; h++) {
      const kv = Math.floor(h / grp), qv = Q[t].subarray(h * hd, h * hd + hd);
      const sc = new Float32Array(t + 1); let mx = -Infinity;
      for (let p = 0; p <= t; p++) { let s = 0; const kp = Kc[p], o = kv * hd; for (let d = 0; d < hd; d++) s += qv[d] * kp[o + d]; s *= scaling; sc[p] = s; if (s > mx) mx = s; }
      let den = 0; for (let p = 0; p <= t; p++) { sc[p] = Math.exp(sc[p] - mx); den += sc[p]; }
      const ctx = attnOut.subarray(h * hd, h * hd + hd);
      for (let p = 0; p <= t; p++) { const w = sc[p] / den, vp = Vc[p], o = kv * hd; for (let d = 0; d < hd; d++) ctx[d] += w * vp[o + d]; }
    }
    for (let i = 0; i < attnOut.length; i++) attnOut[i] *= sigmoid(G[t][i]);   // output gate
    ySeq.push(matvec(W.attn_output, attnOut, nh * hd, D.d_model));
  }
  return { ySeq };
}

export default { qwen35Attention };
