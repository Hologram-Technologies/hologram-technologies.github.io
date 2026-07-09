// holo-qwen35-gpu-real-forward.mjs — INCREMENTAL forward + generate for the real qwen35 GPU brain. Each token
// is O(1) layer work: linear layers carry a fixed-size recurrent state {S, convTail}; attention layers append
// to a growing K/V cache and attend single-query over it (decode-step attention == full causal, verified). No
// full-sequence reprocessing. Weights stay quantized in VRAM (loaded once); reuses the parity-verified kernels
// (readback-chained — the on-GPU-resident chaining is the next optimization). Correct by composition: every op
// matches the CPU oracle that produces "Paris"; absolute RoPE positions + state carry across prefill→decode.

import { conv1dStepGPU, qwenPrepGPU, gatedRMSNormGPU, rmsNorm1pGPU, headNormRopeGPU, singleQAttnGPU } from "./holo-qwen35-kernels.mjs";
import { gatedDeltaStepGPU } from "./holo-gated-delta-gpu.mjs";
import { dequantizeExact } from "../gguf-forge-dequant.mjs";

export function makeBrain(ctx) {
  const { device, rt, D, BPB, embed, lmHead, outNorm, layers, sched, ropeTables, tok, EOS, G, onProgress } = ctx;
  const readBack = async (buf, n) => { const r = device.createBuffer({ size: n * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); const e = device.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, r, 0, n * 4); device.queue.submit([e.finish()]); await r.mapAsync(GPUMapMode.READ); return new Float32Array(r.getMappedRange().slice(0)); };
  async function mvq(wq, act, rows = wq.N) {
    const pipe = wq.type === 12 ? rt.P.q4kraw : wq.type === 13 ? rt.P.q5kraw : rt.P.q6kraw;
    const ab = rt.wF(act), ov = rt.sbuf(rows);
    const p = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(p, 0, new Uint32Array([rows, wq.K, 0, 0]));   // own uniform — never the shared pool (exhausts after 1024)
    const enc = device.createCommandEncoder(); rt.disp(enc, pipe, [wq.buf, ab, ov, p], G(rows)); device.queue.submit([enc.finish()]);
    const r = await readBack(ov, rows); ab.destroy(); ov.destroy(); p.destroy(); return r;   // free transient buffers (long gens)
  }
  const normCache = new Map(); const normW = async (buf, n) => { if (!normCache.has(buf)) normCache.set(buf, await readBack(buf, n)); return normCache.get(buf); };
  const gather = (id) => { const t = embed.t, K = t.dims[0], rowBytes = (K / 256) * BPB[t.ggmlType]; return dequantizeExact(t.ggmlType, embed.bytes.subarray(id * rowBytes, (id + 1) * rowBytes), K); };
  const silu = (x) => x / (1 + Math.exp(-x));
  let outNormF; const ensureOutNorm = async () => { if (!outNormF) outNormF = await readBack(outNorm, D.d_model); };
  const rope = ropeTables(D.rope_dim ? 4096 : 4096);   // cos/sin for positions 0..4095 (chat context cap)

  // fresh per-conversation state
  function newState() {
    return layers.map((l) => l.type === "linear"
      ? { S: new Float32Array(D.num_v_heads * D.head_k * D.head_v), convTail: new Float32Array((D.conv_k - 1) * D.conv_dim) }
      : { K: [], V: [] });
  }

  async function linearStep(W, x, st) {
    const an = await normW(W.attn_norm, D.d_model), sn = await normW(W.ssm_norm, D.head_v), sa = await normW(W.ssm_a, D.num_v_heads), sdt = await normW(W.ssm_dt, D.num_v_heads);
    const nx = await rmsNorm1pGPU(device, x, an, D.eps);
    const qkv = await mvq(W.attn_qkv, nx), z = await mvq(W.attn_gate, nx), aP = await mvq(W.ssm_alpha, nx), bP = await mvq(W.ssm_beta, nx);
    const conv = await conv1dStepGPU(device, st.convTail, qkv, await normW(W.ssm_conv1d, D.conv_k * D.conv_dim), D.conv_dim, D.conv_k);
    const nt = new Float32Array((D.conv_k - 1) * D.conv_dim); nt.set(st.convTail.subarray(D.conv_dim), 0); nt.set(qkv, (D.conv_k - 2) * D.conv_dim); st.convTail = nt;
    const qS = conv.slice(0, D.key_dim), kS = conv.slice(D.key_dim, 2 * D.key_dim), vS = conv.slice(2 * D.key_dim, 2 * D.key_dim + D.value_dim);
    const prep = await qwenPrepGPU(device, { qS, kS, aP, bP, sA: sa, sDt: sdt, nvh: D.num_v_heads, nkh: D.num_k_heads, headK: D.head_k });
    const gd = await gatedDeltaStepGPU(device, { S: st.S, q: prep.qE, k: prep.kE, v: vS, decay: prep.decay, beta: prep.beta, nHeads: D.num_v_heads, headK: D.head_k, headV: D.head_v }); st.S = gd.S;
    const on = await gatedRMSNormGPU(device, gd.o, sn, z, D.num_v_heads, D.head_v, D.eps);
    // ssm_out weight kept in GGUF v-head order (in-cols) → permute the HF-ordered activation back to GGUF: onG[g]=on[vpermInv[g]]
    const nvh = D.num_v_heads, hv = D.head_v, onG = new Float32Array(on.length);
    for (let g = 0; g < nvh; g++) { const hf = g < nvh / 2 ? 2 * g : 2 * (g - nvh / 2) + 1; onG.set(on.subarray(hf * hv, (hf + 1) * hv), g * hv); }
    return mvq(W.ssm_out, onG);
  }
  async function attnStep(W, x, pos, st) {
    const hd = D.head_dim, nh = D.n_head, nkv = D.n_kv;
    const an = await normW(W.attn_norm, D.d_model), qn = await normW(W.attn_q_norm, hd), kn = await normW(W.attn_k_norm, hd);
    const nx = await rmsNorm1pGPU(device, x, an, D.eps);
    const qg = await mvq(W.attn_q, nx); const qraw = new Float32Array(nh * hd), g = new Float32Array(nh * hd);
    for (let h = 0; h < nh; h++) for (let i = 0; i < hd; i++) { qraw[h * hd + i] = qg[h * 2 * hd + i]; g[h * hd + i] = qg[h * 2 * hd + hd + i]; }
    const q = await headNormRopeGPU(device, qraw, qn, rope.cos[pos], rope.sin[pos], nh, hd, D.rope_dim, D.eps);
    const k = await headNormRopeGPU(device, await mvq(W.attn_k, nx), kn, rope.cos[pos], rope.sin[pos], nkv, hd, D.rope_dim, D.eps);
    const v = await mvq(W.attn_v, nx);
    st.K.push(k); st.V.push(v); const P = st.K.length;
    const Kc = new Float32Array(P * nkv * hd), Vc = new Float32Array(P * nkv * hd); for (let p = 0; p < P; p++) { Kc.set(st.K[p], p * nkv * hd); Vc.set(st.V[p], p * nkv * hd); }
    const c = await singleQAttnGPU(device, q, Kc, Vc, P, nh, hd, nkv, 1 / Math.sqrt(hd));
    for (let i = 0; i < c.length; i++) c[i] *= 1 / (1 + Math.exp(-g[i]));
    return mvq(W.attn_output, c);
  }
  // one token → next-token logits, advancing all per-layer state at absolute position `pos`.
  async function step(id, pos, state) {
    await ensureOutNorm();
    let h = gather(id);
    for (let L = 0; L < D.n_layer; L++) {
      const { type, W } = layers[L];
      const delta = type === "attn" ? await attnStep(W, h, pos, state[L]) : await linearStep(W, h, state[L]);
      for (let i = 0; i < D.d_model; i++) h[i] += delta[i];
      const pn = await normW(W.post_attention_norm, D.d_model);
      const mn = await rmsNorm1pGPU(device, h, pn, D.eps);
      const gp = await mvq(W.ffn_gate, mn), up = await mvq(W.ffn_up, mn), hh = new Float32Array(D.ffn);
      for (let i = 0; i < D.ffn; i++) hh[i] = silu(gp[i]) * up[i];
      const fd = await mvq(W.ffn_down, hh); for (let i = 0; i < D.d_model; i++) h[i] += fd[i];
    }
    const hn = await rmsNorm1pGPU(device, h, outNormF, D.eps);
    return mvq(lmHead, hn, D.vocab);
  }
  const argmax = (v) => { let bi = 0, bv = -Infinity; for (let i = 0; i < v.length; i++) if (v[i] > bv) { bv = v[i]; bi = i; } return bi; };
  function frame(messages) { let s = ""; for (const m of messages) s += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`; return s + "<|im_start|>assistant\n"; }

  async function* generate(messages, { maxTokens = 256, temperature = 0 } = {}) {
    const ids = tok.encode(frame(messages), { addSpecial: false, parseSpecial: true });
    const state = newState();
    let logits, pos = 0;
    for (; pos < ids.length; pos++) { logits = await step(ids[pos], pos, state); onProgress && onProgress(`prefill ${pos + 1}/${ids.length}`, (pos + 1) / ids.length); }   // prefill (last logits = first prediction)
    let text = "", gen = [];
    for (let n = 0; n < maxTokens; n++) {
      let tk;
      if (temperature <= 0) tk = argmax(logits);
      else { const l = logits.map((x) => x / temperature); const mx = Math.max(...l); let sum = 0; const pr = l.map((x) => { const e = Math.exp(x - mx); sum += e; return e; }); let r = Math.random() * sum, i = 0; for (; i < pr.length; i++) { r -= pr[i]; if (r <= 0) break; } tk = i; }
      if (EOS.has(tk)) return;
      gen.push(tk); const full = tok.decode(gen), delta = full.slice(text.length); text = full; yield delta;
      logits = await step(tk, pos++, state);
    }
  }
  async function chat(messages, o) { let s = ""; for await (const d of generate(messages, o)) s += d; return s.trim(); }
  return { D, tok, generate, chat, step, newState, argmax, info: () => ({ arch: "qwen35", layers: D.n_layer, vocab: D.vocab }) };
}
