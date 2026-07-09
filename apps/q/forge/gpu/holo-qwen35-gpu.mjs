// holo-qwen35-gpu.mjs — the WHOLE qwen35 model forward on WebGPU, composed from the parity-verified kernels.
// Mirrors the CPU oracle `qwen35Forward` (gguf-forge-qwen35-model.mjs) op-for-op: embed → 32 layers
// [residual + mixer(input_norm(h)); residual + SwiGLU-MLP(post_norm(h))] → final norm → lm_head. This f32 path
// is verified vs the CPU/HF fixture; the real path swaps matvecF → the engine's quantized-matvec on .holo bytes.

import { matvecFGPU, conv1dStepGPU, qwenPrepGPU, gatedRMSNormGPU, rmsNorm1pGPU, headNormRopeGPU, causalGQAGPU } from "./holo-qwen35-kernels.mjs";
import { gatedDeltaStepGPU } from "./holo-gated-delta-gpu.mjs";

const silu = (x) => x / (1 + Math.exp(-x));
const add = (a, b) => { for (let i = 0; i < a.length; i++) a[i] += b[i]; };

// linear mixer over the full sequence (state from zero), inputs already the residual stream (norm applied here).
async function linearMixer(dev, W, D, hSeq) {
  const T = hSeq.length; let S = new Float32Array(D.num_v_heads * D.head_k * D.head_v), tail = new Float32Array((D.conv_k - 1) * D.conv_dim);
  const out = [];
  for (let t = 0; t < T; t++) {
    const nx = await rmsNorm1pGPU(dev, hSeq[t], W.attn_norm, D.eps);
    const qkv = await matvecFGPU(dev, W.attn_qkv, nx, D.conv_dim, D.d_model);
    const z = await matvecFGPU(dev, W.attn_gate, nx, D.value_dim, D.d_model);
    const aP = await matvecFGPU(dev, W.ssm_alpha, nx, D.num_v_heads, D.d_model);
    const bP = await matvecFGPU(dev, W.ssm_beta, nx, D.num_v_heads, D.d_model);
    const conv = await conv1dStepGPU(dev, tail, qkv, W.ssm_conv1d, D.conv_dim, D.conv_k);
    const nt = new Float32Array((D.conv_k - 1) * D.conv_dim); nt.set(tail.subarray(D.conv_dim), 0); nt.set(qkv, (D.conv_k - 2) * D.conv_dim); tail = nt;
    const qS = conv.slice(0, D.key_dim), kS = conv.slice(D.key_dim, 2 * D.key_dim), vS = conv.slice(2 * D.key_dim, 2 * D.key_dim + D.value_dim);
    const prep = await qwenPrepGPU(dev, { qS, kS, aP, bP, sA: W.ssm_a, sDt: W.ssm_dt, nvh: D.num_v_heads, nkh: D.num_k_heads, headK: D.head_k });
    const gd = await gatedDeltaStepGPU(dev, { S, q: prep.qE, k: prep.kE, v: vS, decay: prep.decay, beta: prep.beta, nHeads: D.num_v_heads, headK: D.head_k, headV: D.head_v }); S = gd.S;
    const on = await gatedRMSNormGPU(dev, gd.o, W.ssm_norm, z, D.num_v_heads, D.head_v, D.eps);
    out.push(await matvecFGPU(dev, W.ssm_out, on, D.d_model, D.value_dim));
  }
  return out;
}

// gated GQA attention over the full sequence.
async function attnMixer(dev, W, D, hSeq, cos, sin) {
  const T = hSeq.length, hd = D.head_dim, nh = D.n_head, nkv = D.n_kv;
  const Q = new Float32Array(T * nh * hd), Kf = new Float32Array(T * nkv * hd), Vf = new Float32Array(T * nkv * hd), G = [];
  for (let t = 0; t < T; t++) {
    const nx = await rmsNorm1pGPU(dev, hSeq[t], W.attn_norm, D.eps);
    const qg = await matvecFGPU(dev, W.attn_q, nx, nh * hd * 2, D.d_model);
    const qraw = new Float32Array(nh * hd), g = new Float32Array(nh * hd);
    for (let h = 0; h < nh; h++) for (let i = 0; i < hd; i++) { qraw[h * hd + i] = qg[h * 2 * hd + i]; g[h * hd + i] = qg[h * 2 * hd + hd + i]; }
    Q.set(await headNormRopeGPU(dev, qraw, W.attn_q_norm, cos[t], sin[t], nh, hd, cos[t].length, D.eps), t * nh * hd);
    Kf.set(await headNormRopeGPU(dev, await matvecFGPU(dev, W.attn_k, nx, nkv * hd, D.d_model), W.attn_k_norm, cos[t], sin[t], nkv, hd, cos[t].length, D.eps), t * nkv * hd);
    Vf.set(await matvecFGPU(dev, W.attn_v, nx, nkv * hd, D.d_model), t * nkv * hd); G.push(g);
  }
  const ctx = await causalGQAGPU(dev, Q, Kf, Vf, T, nh, hd, nkv, 1 / Math.sqrt(hd));
  const out = [];
  for (let t = 0; t < T; t++) { const c = ctx.slice(t * nh * hd, (t + 1) * nh * hd); for (let i = 0; i < c.length; i++) c[i] *= 1 / (1 + Math.exp(-G[t][i])); out.push(await matvecFGPU(dev, W.attn_output, c, D.d_model, nh * hd)); }
  return out;
}

export async function qwen35ForwardGPU(dev, model, ids) {
  const D = model.D, T = ids.length;
  let h = ids.map((id) => model.token_embd.slice(id * D.d_model, id * D.d_model + D.d_model));
  const cos = model.cos, sin = model.sin;
  for (let L = 0; L < D.n_layer; L++) {
    const lay = model.layers[L], W = lay.W;
    const mix = lay.type === "attn" ? await attnMixer(dev, W, D, h, cos, sin) : await linearMixer(dev, W, D, h);
    for (let t = 0; t < T; t++) add(h[t], mix[t]);
    for (let t = 0; t < T; t++) {
      const mn = await rmsNorm1pGPU(dev, h[t], W.post_attention_norm, D.eps);
      const g = await matvecFGPU(dev, W.ffn_gate, mn, D.ffn, D.d_model), u = await matvecFGPU(dev, W.ffn_up, mn, D.ffn, D.d_model);
      const hd = new Float32Array(D.ffn); for (let i = 0; i < D.ffn; i++) hd[i] = silu(g[i]) * u[i];
      add(h[t], await matvecFGPU(dev, W.ffn_down, hd, D.d_model, D.ffn));
    }
  }
  const logits = [];
  for (let t = 0; t < T; t++) { const hn = await rmsNorm1pGPU(dev, h[t], model.output_norm, D.eps); logits.push(await matvecFGPU(dev, model.lm_head, hn, D.vocab, D.d_model)); }
  return logits;
}

export const argmax = (v) => { let bi = 0, bv = -Infinity; for (let i = 0; i < v.length; i++) if (v[i] > bv) { bv = v[i]; bi = i; } return bi; };
export default { qwen35ForwardGPU, argmax };
