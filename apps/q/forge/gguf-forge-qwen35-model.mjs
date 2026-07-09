// gguf-forge-qwen35-model.mjs — the WHOLE qwen35 model forward: embed → 32 decoder layers (each = residual +
// mixer(input_norm(h)) ; residual + SwiGLU-MLP(post_attn_norm(h))) → final norm → lm_head → logits. The mixer is
// the proven gated-DeltaNet linear layer or the proven gated-attention layer, per the qwen35Schedule. Pure
// composition of parity-verified parts (gguf-forge-qwen35{,-attn}.mjs); validated end-to-end vs HF
// Qwen3NextForCausalLM by gguf-forge-qwen35-model-parity.test.mjs.
//
// model = { D, layers:[{type:'linear'|'attn', W:{…}}], token_embd, output_norm, lm_head, cos?, sin? }.
// D carries the union of linear + attention dims + { d_model, ffn, n_layer, vocab, eps, rope_dim, rope_theta? }.

import { qwen35LinearLayer, newLayerState, matvec } from "./gguf-forge-qwen35.mjs";
import { qwen35Attention } from "./gguf-forge-qwen35-attn.mjs";
import { sigmoid } from "./gguf-forge-gated-delta.mjs";

function rmsNorm(x, w, eps) {                  // Qwen3NextRMSNorm: ·(1+weight)
  let ss = 0; for (let i = 0; i < x.length; i++) ss += x[i] * x[i];
  const inv = 1 / Math.sqrt(ss / x.length + eps), o = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) o[i] = x[i] * inv * (1 + w[i]);
  return o;
}
const silu = (x) => x * sigmoid(x);
function swiglu(W, xn, D) {                     // Qwen3NextMLP: down(silu(gate(x)) ⊙ up(x))
  const g = matvec(W.ffn_gate, xn, D.d_model, D.ffn), u = matvec(W.ffn_up, xn, D.d_model, D.ffn);
  const h = new Float32Array(D.ffn); for (let i = 0; i < D.ffn; i++) h[i] = silu(g[i]) * u[i];
  return matvec(W.ffn_down, h, D.ffn, D.d_model);
}
// default-RoPE cos/sin tables (used when the model carries no cos/sin override). cat(freqs,freqs), length rope_dim.
export function ropeTables(D, T) {
  const rd = D.rope_dim, half = rd / 2, theta = D.rope_theta || 1e7, inv = new Float32Array(half);
  for (let i = 0; i < half; i++) inv[i] = 1 / Math.pow(theta, (2 * i) / rd);
  const cos = [], sin = [];
  for (let t = 0; t < T; t++) { const c = new Float32Array(rd), s = new Float32Array(rd); for (let i = 0; i < half; i++) { const f = t * inv[i]; c[i] = c[i + half] = Math.cos(f); s[i] = s[i + half] = Math.sin(f); } cos.push(c); sin.push(s); }
  return { cos, sin };
}

export function qwen35Forward(model, tokenIds) {
  const D = model.D, T = tokenIds.length;
  let h = tokenIds.map((id) => model.token_embd.slice(id * D.d_model, id * D.d_model + D.d_model));
  const { cos, sin } = model.cos && model.sin ? { cos: model.cos, sin: model.sin } : ropeTables(D, T);

  for (let L = 0; L < D.n_layer; L++) {
    const lay = model.layers[L], W = lay.W;
    const out = lay.type === "attn"
      ? qwen35Attention(W, D, h, cos, sin, {}).ySeq
      : qwen35LinearLayer(W, D, h, newLayerState(D), {}).ySeq;
    for (let t = 0; t < T; t++) for (let i = 0; i < D.d_model; i++) h[t][i] += out[t][i];   // residual (mixer)
    for (let t = 0; t < T; t++) { const mn = rmsNorm(h[t], W.post_attention_norm, D.eps), f = swiglu(W, mn, D); for (let i = 0; i < D.d_model; i++) h[t][i] += f[i]; }  // residual (MLP)
  }
  return h.map((ht) => matvec(model.lm_head, rmsNorm(ht, model.output_norm, D.eps), D.d_model, D.vocab));
}

export const argmax = (v) => { let bi = 0, bv = -Infinity; for (let i = 0; i < v.length; i++) if (v[i] > bv) { bv = v[i]; bi = i; } return bi; };
export default { qwen35Forward, ropeTables, argmax };
