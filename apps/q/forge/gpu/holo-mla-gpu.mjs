// holo-mla-gpu.mjs — a full DeepSeek/GLM-class transformer-layer forward on WebGPU.
//
// Composes the witnessed GPU kernels (MATVECF + RMS + ROPENORM + MLAATTN + SWIGLU + ADD from
// holo-gguf-gpu.mjs) into one end-to-end forward: embd → RMS → MLA(latent decompression, NORM-rope,
// hk≠hv) → +res → RMS → MoE(mul_mat_id, sigmoid router, ungated shared) → +res → out_norm → lm_head.
// F32 weights isolate the arch orchestration; the K-quant matvec kernels (MATVECQ4KRAW/Q5KRAW/Q6KRAW,
// witnessed separately) slot into the mvF positions verbatim for a real quantized GLM/DeepSeek .holo.
// All arithmetic is on the GPU; only pure index assembly (Qcur/Kcur/Vcur interleave, KV cache, top-k
// scalar routing) is JS — it moves data, it can't hide a numeric error.
import { createGpuRuntime } from "./holo-gguf-gpu.mjs";

const G = (n) => Math.ceil(n / 64);
const sigmoid = (v) => 1 / (1 + Math.exp(-v));

export function makeMlaEngine(dev) {
  const rt = createGpuRuntime(dev);
  const { P, disp, u4, f4, sbuf, wF, resetUniforms } = rt;
  const readback = async (buf, n) => {
    const stg = dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = dev.createCommandEncoder(); enc.copyBufferToBuffer(buf, 0, stg, 0, n * 4); dev.queue.submit([enc.finish()]);
    await stg.mapAsync(GPUMapMode.READ); const out = Float32Array.from(new Float32Array(stg.getMappedRange().slice(0))); stg.unmap(); stg.destroy(); return out;
  };
  const one = async (pipe, bufs, groups, outBuf, outN) => { resetUniforms(); const enc = dev.createCommandEncoder(); disp(enc, pipe, bufs, groups); dev.queue.submit([enc.finish()]); return readback(outBuf, outN); };
  const fa = (a) => Float32Array.from(a);

  // heavy-math primitives — each a GPU dispatch + readback (tiny synthetic model → perf irrelevant)
  const mvF = async (W, N, K, x) => { const wb = wF(fa(W)), xb = wF(fa(x)), yb = sbuf(N); return one(P.f, [wb, xb, yb, u4([N, K, 0, 0])], G(N), yb, N); };
  const rms = async (x, w, N, eps) => { const xb = wF(fa(x)), wb = wF(fa(w)), yb = sbuf(N); return one(P.rms, [xb, wb, yb, f4([N, eps, 0, 0])], 1, yb, N); };
  const ropenorm = async (x, headDim, nRot, nHeads, pos, freqBase, y = null) => { const xb = wF(fa(x)), yb = sbuf(x.length); const b = y ? f4([freqBase, 1, y.freqScale, y.mscale]) : f4([freqBase, 0, 0, 0]); const cc = y ? f4([y.extFactor, y.lo, y.hi, 0]) : f4([0, 0, 0, 0]); return one(P.ropenorm, [xb, yb, f4([headDim, nRot, nHeads, pos]), b, cc], G(nHeads * (nRot / 2)), yb, x.length); };
  const mlaattn = async (q, kcFlat, vcFlat, nh, hk, hv, curPos, scale) => { const qb = wF(fa(q)), kcb = wF(fa(kcFlat)), vcb = wF(fa(vcFlat)), cb = sbuf(nh * hv); return one(P.mlaattn, [qb, kcb, vcb, cb, u4([nh, hk, hv, curPos]), f4([scale, 0, 0, 0])], G(nh), cb, nh * hv); };
  const swiglu = async (g, u, n) => { const gb = wF(fa(g)), ub = wF(fa(u)), yb = sbuf(n); return one(P.swiglu, [gb, ub, yb, u4([n, 0, 0, 0])], G(n), yb, n); };
  const add = async (a, b, n) => { const ab = wF(fa(a)), bb = wF(fa(b)), yb = sbuf(n); return one(P.add, [ab, bb, yb, u4([n, 0, 0, 0])], G(n), yb, n); };

  return { mvF, rms, ropenorm, mlaattn, swiglu, add };
}

// full forward over token ids → last-position logits. `full` = { cfg, w } exported by gen-mla-gpu-data.
export async function runMlaGpuForward(dev, full, ids, onRoute) {
  const E = makeMlaEngine(dev), c = full.cfg, w = full.w;
  const { D, VOCAB, NH, HK, HV, ROPE, NOPE, KVL, FF, USED, WSCALE, QD, KVB, WOIN, kqScale, EPS, FREQ } = c;
  const step = NOPE + HV, Kc = [], Vc = [];
  const slice = (a, o, n) => a.slice(o, o + n);
  let h = null;

  for (let pos = 0; pos < ids.length; pos++) {
    h = slice(w.tok_embd, ids[pos] * D, D);                                   // embd (gather)
    const an = await E.rms(h, w.attn_norm, D, EPS);
    const q = await E.mvF(w.q, QD, D, an);                                    // attn_q (lite)
    const kvc = await E.mvF(w.kv_a_mqa, KVL + ROPE, D, an);
    const kvCmpr = await E.rms(slice(kvc, 0, KVL), w.kv_a_norm, KVL, EPS);
    const qPe = new Float32Array(NH * ROPE);
    for (let hh = 0; hh < NH; hh++) for (let d = 0; d < ROPE; d++) qPe[hh * ROPE + d] = q[hh * HK + NOPE + d];
    const yarn = c.yarn || null;   // deepseek2/glm YaRN uniforms (freqScale/extFactor/lo/hi/mscale) or null=plain
    const qPeR = await E.ropenorm(qPe, ROPE, ROPE, NH, pos, FREQ, yarn);
    const kPeR = await E.ropenorm(slice(kvc, KVL, ROPE), ROPE, ROPE, 1, pos, FREQ, yarn);
    const kv = await E.mvF(w.kv_b, KVB, KVL, kvCmpr);                         // decompress
    const Qcur = new Float32Array(NH * HK), Kcur = new Float32Array(NH * HK), Vcur = new Float32Array(NH * HV);
    for (let hh = 0; hh < NH; hh++) {
      for (let d = 0; d < NOPE; d++) { Kcur[hh * HK + d] = kv[hh * step + d]; Qcur[hh * HK + d] = q[hh * HK + d]; }
      for (let d = 0; d < ROPE; d++) { Kcur[hh * HK + NOPE + d] = kPeR[d]; Qcur[hh * HK + NOPE + d] = qPeR[hh * ROPE + d]; }
      for (let d = 0; d < HV; d++) Vcur[hh * HV + d] = kv[hh * step + NOPE + d];
    }
    Kc.push(Kcur); Vc.push(Vcur);
    const ctx = await E.mlaattn(Qcur, Float32Array.from(Kc.flatMap((a) => [...a])), Float32Array.from(Vc.flatMap((a) => [...a])), NH, HK, HV, pos, kqScale);
    const attnOut = await E.mvF(w.wo, D, WOIN, ctx);
    const h2 = await E.add(h, attnOut, D);
    const fn = await E.rms(h2, w.ffn_norm, D, EPS);

    // ── MoE (mul_mat_id): sigmoid router + selection bias → per-expert GPU matvecs + ungated shared ──
    const logitsE = await E.mvF(w.gate_inp, c.E, D, fn);
    const probs = Array.from(logitsE, sigmoid);
    const biased = probs.map((p, i) => p + (w.exp_probs_b ? w.exp_probs_b[i] : 0));
    const sel = [...biased.keys()].sort((a, b) => biased[b] - biased[a] || a - b).slice(0, USED);
    let wt = sel.map((e) => probs[e]); const s = wt.reduce((a, b) => a + b, 0), denom = Math.max(s, 6.103515625e-5);
    wt = wt.map((v) => (v / denom) * WSCALE);
    if (onRoute && pos === ids.length - 1) onRoute(sel, wt);
    const out = new Float32Array(D);
    for (let i = 0; i < sel.length; i++) {
      const e = sel[i];
      const g = await E.mvF(slice(w.gate_exps, e * D * FF, D * FF), FF, D, fn);
      const u = await E.mvF(slice(w.up_exps, e * D * FF, D * FF), FF, D, fn);
      const act = await E.swiglu(g, u, FF);
      const dn = await E.mvF(slice(w.down_exps, e * FF * D, FF * D), D, FF, act);
      for (let j = 0; j < D; j++) out[j] += wt[i] * dn[j];
    }
    const sg = await E.mvF(w.gate_shexp, FF, D, fn), su = await E.mvF(w.up_shexp, FF, D, fn);
    const sact = await E.swiglu(sg, su, FF);
    const sh = await E.mvF(w.down_shexp, D, FF, sact);
    for (let j = 0; j < D; j++) out[j] += sh[j];                              // ungated shared
    h = await E.add(h2, out, D);
  }
  const rn = await E.rms(h, w.output_norm, D, EPS);
  return E.mvF(w.output, VOCAB, D, rn);
}
