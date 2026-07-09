// GGUF Forge — full-graph LoRA autograd (Tier-A). Backprop through the WHOLE dense
// transformer forward so LoRA adapters train end-to-end, not just an isolated linear.
//
// This is the piece the inference forge lacked: the vector-Jacobian product (vjp) of
// every op between the loss and the adapted linears — rms_norm, LoRA-adapted QKV, NEOX
// RoPE, causal multi-head attention (softmax jacobian), SwiGLU FFN, tied lm_head, and
// assistant-masked cross-entropy. Base weights are FROZEN; gradients flow only to the
// LoRA A/B params. Reuses the optimizer/checkpoint primitives in gguf-forge-lora-train.
//
// Computed in float64: this is an autograd-CORRECTNESS proof, witnessed by end-to-end
// finite-difference gradient checking (gguf-forge-lora-graph.test.mjs). The f32 fidelity
// of the underlying kernels is established separately in the inference path.
//
// Backward derivations (standard, hand-derived):
//   rms_norm:  dx = r·(g∘dy) − (r³/n)·x·Σ(x∘g∘dy),  r = 1/√(mean(x²)+eps)
//   linear(W frozen):  dx = Wᵀ·dy ;  LoRA: y=W·x+s·B(A·x) → dx += s·Aᵀ(Bᵀ·dy)
//   RoPE (rotation):   backward = rotate by −θ (orthogonal)
//   attention:  dv[s]=Σ_t p[t,s]dctx[t]; dscore[t,:]=p[t,:]∘(dp[t,:]−Σp[t,·]dp[t,·]);
//               dq[t]=Σ_s dscore[t,s]k[s]/√d; dk[s]=Σ_t dscore[t,s]q[t]/√d
//   SwiGLU:  a=silu(g)∘u; dg=da∘u∘silu'(g); du=da∘silu(g); silu'(z)=σ(1+z(1−σ))

import { maskedCrossEntropy, adamwStep, lrForStep } from "./gguf-forge-lora-train.mjs";
import { sha256hex, kappa } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

// Pure-f64 LoRA forward/backward for the autograd-correctness proof (the f32 inference
// versions in gguf-forge-lora-train.mjs round to binary32, whose ~1e-7 noise would swamp
// finite-difference gradient checking). Same math: y = W0·x + scale·B·(A·x).
function loraForward(W0, A, B, scale, x, { inn, out, r }) {
  const h = new Float64Array(r);
  for (let k = 0; k < r; k++) { let s = 0; for (let i = 0; i < inn; i++) s += A[k * inn + i] * x[i]; h[k] = s; }
  const y = new Float64Array(out);
  for (let o = 0; o < out; o++) { let s = 0; for (let i = 0; i < inn; i++) s += W0[o * inn + i] * x[i]; let bh = 0; for (let k = 0; k < r; k++) bh += B[o * r + k] * h[k]; y[o] = s + scale * bh; }
  return { y, h };
}
function loraBackward(B, scale, x, h, dy, { inn, out, r }) {
  const dB = new Float64Array(out * r), dA = new Float64Array(r * inn), dh = new Float64Array(r);
  for (let o = 0; o < out; o++) for (let k = 0; k < r; k++) dB[o * r + k] = scale * dy[o] * h[k];
  for (let k = 0; k < r; k++) { let s = 0; for (let o = 0; o < out; o++) s += B[o * r + k] * dy[o]; dh[k] = scale * s; }
  for (let k = 0; k < r; k++) for (let i = 0; i < inn; i++) dA[k * inn + i] = dh[k] * x[i];
  return { dA, dB };
}

const sig = (z) => 1 / (1 + Math.exp(-z));
const silu = (z) => z * sig(z);
const siluP = (z) => { const s = sig(z); return s * (1 + z * (1 - s)); };
const mv = (W, x, K, N) => { const y = new Float64Array(N); for (let n = 0; n < N; n++) { let s = 0; for (let k = 0; k < K; k++) s += W[n * K + k] * x[k]; y[n] = s; } return y; };
const mvT = (W, dy, K, N) => { const dx = new Float64Array(K); for (let n = 0; n < N; n++) for (let k = 0; k < K; k++) dx[k] += W[n * K + k] * dy[n]; return dx; };
const add = (a, b) => a.map((v, i) => v + b[i]);

function rms(x, g, eps) { let s = 0; for (const v of x) s += v * v; const r = 1 / Math.sqrt(s / x.length + eps); const y = x.map((v, i) => v * r * g[i]); return { y, r }; }
function rmsBack(x, g, r, dy) {
  const n = x.length; let dot = 0; for (let i = 0; i < n; i++) dot += x[i] * g[i] * dy[i];
  const c = (r * r * r) / n * dot; return x.map((xi, i) => r * g[i] * dy[i] - c * xi);
}
// NEOX RoPE on a [nHead·hd] vector at position pos; back = same with sin negated.
function rope(vec, pos, hd, freqBase, sign = 1) {
  const half = hd / 2, nH = vec.length / hd, out = Float64Array.from(vec);
  for (let h = 0; h < nH; h++) for (let i = 0; i < half; i++) {
    const th = pos * Math.pow(freqBase, -2 * i / hd), c = Math.cos(th), sn = sign * Math.sin(th), o = h * hd;
    const x0 = vec[o + i], x1 = vec[o + i + half];
    out[o + i] = x0 * c - x1 * sn; out[o + i + half] = x0 * sn + x1 * c;
  }
  return out;
}

// layersOf(M) — back-compat shim: a flat single-block M (legacy) reads as a 1-element layer stack.
// A1 multi-layer model supplies M.layers = [{attn_norm,Wq,Aq,Bq,Wk,Wv,Av,Bv,Wo,ffn_norm,Wg,Wu,Wd}, …];
// shared: tok_embd, out_norm, D/NH/HD/FF/V/eps/freqBase/scale/rank. The WHOLE transformer, any depth.
export function layersOf(M) {
  if (M.layers && M.layers.length) return M.layers;
  return [{ attn_norm: M.attn_norm, Wq: M.Wq, Aq: M.Aq, Bq: M.Bq, Wk: M.Wk, Wv: M.Wv, Av: M.Av, Bv: M.Bv, Wo: M.Wo, ffn_norm: M.ffn_norm, Wg: M.Wg, Wu: M.Wu, Wd: M.Wd }];
}

// one transformer block forward at hidden `hin` (per token) → block output hidden + a per-layer cache.
function blockForward(M, L, hin, T) {
  const { D, NH, HD, FF, eps, freqBase, scale, rank } = M, ASC = 1 / Math.sqrt(HD);
  const lc = { xn: [], rA: [], q: [], k: [], v: [], qr: [], kr: [], p: [], ctx: [], h1: [], xn2: [], rF: [], gate: [], up: [], act: [], loraQ: [], loraV: [], hin };
  const hout = [];
  for (let t = 0; t < T; t++) {                                       // projections first (attention needs all k/v)
    const { y: xn, r: rA } = rms(hin[t], L.attn_norm, eps); lc.xn[t] = xn; lc.rA[t] = rA;
    const fq = loraForward(L.Wq, L.Aq, L.Bq, scale, xn, { inn: D, out: D, r: rank }); lc.loraQ[t] = fq.h;
    const fv = loraForward(L.Wv, L.Av, L.Bv, scale, xn, { inn: D, out: D, r: rank }); lc.loraV[t] = fv.h;
    lc.q[t] = fq.y; lc.v[t] = fv.y; lc.k[t] = mv(L.Wk, xn, D, D);
    lc.qr[t] = rope(lc.q[t], t, HD, freqBase); lc.kr[t] = rope(lc.k[t], t, HD, freqBase);
  }
  for (let t = 0; t < T; t++) {
    const ctx = new Float64Array(D), pT = [];
    for (let h = 0; h < NH; h++) {
      const sc = new Float64Array(t + 1);
      for (let s = 0; s <= t; s++) { let d = 0; for (let i = 0; i < HD; i++) d += lc.qr[t][h * HD + i] * lc.kr[s][h * HD + i]; sc[s] = d * ASC; }
      let mx = -Infinity; for (const z of sc) mx = Math.max(mx, z); let Z = 0; const p = new Float64Array(t + 1);
      for (let s = 0; s <= t; s++) { p[s] = Math.exp(sc[s] - mx); Z += p[s]; } for (let s = 0; s <= t; s++) p[s] /= Z;
      for (let i = 0; i < HD; i++) { let a = 0; for (let s = 0; s <= t; s++) a += p[s] * lc.v[s][h * HD + i]; ctx[h * HD + i] = a; }
      pT.push(p);
    }
    lc.p[t] = pT; lc.ctx[t] = ctx;
    const ao = mv(L.Wo, ctx, D, D); lc.h1[t] = add(hin[t], ao);
    const { y: xn2, r: rF } = rms(lc.h1[t], L.ffn_norm, eps); lc.xn2[t] = xn2; lc.rF[t] = rF;
    const gate = mv(L.Wg, xn2, D, FF), up = mv(L.Wu, xn2, D, FF), act = new Float64Array(FF);
    for (let i = 0; i < FF; i++) act[i] = silu(gate[i]) * up[i];
    lc.gate[t] = gate; lc.up[t] = up; lc.act[t] = act;
    const ff = mv(L.Wd, act, FF, D); hout[t] = add(lc.h1[t], ff);     // h2 = h1 + ff → next layer's input
  }
  return { hout, lc };
}

// Full forward over a token sequence through ALL layers; caches everything backward needs.
export function forwardCache(M, tokens) {
  const { D, V, eps } = M, T = tokens.length, layers = layersOf(M);
  const c = { T, layers: [], xf: [], rO: [], logits: new Float64Array(T * V) };
  let hid = [];
  for (let t = 0; t < T; t++) hid.push(Float64Array.from(M.tok_embd.slice(tokens[t] * D, tokens[t] * D + D)));
  for (let l = 0; l < layers.length; l++) { const { hout, lc } = blockForward(M, layers[l], hid, T); c.layers[l] = lc; hid = hout; }
  c.finalHid = hid;                                                   // top layer's output hidden (out_norm input)
  for (let t = 0; t < T; t++) {                                       // out_norm + tied lm_head on the final hidden
    const { y: xf, r: rO } = rms(hid[t], M.out_norm, eps); c.xf[t] = xf; c.rO[t] = rO;
    const lg = mv(M.tok_embd, xf, D, V); for (let j = 0; j < V; j++) c.logits[t * V + j] = lg[j];
  }
  return c;
}

// one block backward: given dHout (grad wrt this layer's OUTPUT hidden), return its LoRA grads AND dHin
// (grad wrt its INPUT hidden) — the piece that chains layers. dHin flows through BOTH residual identities
// (h1=hin+ao, h2=h1+ff) and through attn_norm via the q/k/v projections.
function blockBackward(M, L, lc, dHout) {
  const { D, NH, HD, FF, freqBase, scale, rank } = M, T = lc.h1.length, ASC = 1 / Math.sqrt(HD);
  const dAq = new Float64Array(rank * D), dBq = new Float64Array(D * rank), dAv = new Float64Array(rank * D), dBv = new Float64Array(D * rank);
  const dQr = Array.from({ length: T }, () => new Float64Array(D)), dKr = Array.from({ length: T }, () => new Float64Array(D)), dV = Array.from({ length: T }, () => new Float64Array(D));
  const dCtx = Array.from({ length: T }, () => new Float64Array(D)), dH1 = Array.from({ length: T }, () => new Float64Array(D));
  // pass 1: ffn + residual → dh1 ; dctx
  for (let t = 0; t < T; t++) {
    const dh2 = dHout[t];                                              // grad arriving at h2 (this layer's output)
    const dact = mvT(L.Wd, dh2, FF, D), dgate = new Float64Array(FF), dup = new Float64Array(FF);
    for (let i = 0; i < FF; i++) { dgate[i] = dact[i] * lc.up[t][i] * siluP(lc.gate[t][i]); dup[i] = dact[i] * silu(lc.gate[t][i]); }
    const dxn2 = add(mvT(L.Wg, dgate, D, FF), mvT(L.Wu, dup, D, FF));
    const dh1 = add(dh2, rmsBack(lc.h1[t], L.ffn_norm, lc.rF[t], dxn2)); // residual h2=h1+ff
    dH1[t] = dh1;
    dCtx[t] = mvT(L.Wo, dh1, D, D);                                    // h1 = hin + Wo·ctx
  }
  // pass 2: attention backward (couples positions) → dqr/dkr/dv
  for (let t = 0; t < T; t++) for (let h = 0; h < NH; h++) {
    const p = lc.p[t][h], dp = new Float64Array(t + 1);
    for (let s = 0; s <= t; s++) { let d = 0; for (let i = 0; i < HD; i++) d += dCtx[t][h * HD + i] * lc.v[s][h * HD + i]; dp[s] = d; }
    for (let s = 0; s <= t; s++) for (let i = 0; i < HD; i++) dV[s][h * HD + i] += p[s] * dCtx[t][h * HD + i];
    let psum = 0; for (let s = 0; s <= t; s++) psum += p[s] * dp[s];
    const dsc = new Float64Array(t + 1); for (let s = 0; s <= t; s++) dsc[s] = p[s] * (dp[s] - psum);
    for (let i = 0; i < HD; i++) for (let s = 0; s <= t; s++) { dQr[t][h * HD + i] += dsc[s] * lc.kr[s][h * HD + i] * ASC; dKr[s][h * HD + i] += dsc[s] * lc.qr[t][h * HD + i] * ASC; }
  }
  // pass 3: rope back → dq/dk ; linears → LoRA grads + dxn ; rms back + residual → dHin (chains to lower layer)
  const dHin = Array.from({ length: T }, () => new Float64Array(D));
  for (let t = 0; t < T; t++) {
    const dq = rope(dQr[t], t, HD, freqBase, -1), dk = rope(dKr[t], t, HD, freqBase, -1); // rotation transpose
    const gq = loraBackward(L.Bq, scale, lc.xn[t], lc.loraQ[t], dq, { inn: D, out: D, r: rank });
    const gv = loraBackward(L.Bv, scale, lc.xn[t], lc.loraV[t], dV[t], { inn: D, out: D, r: rank });
    for (let i = 0; i < dAq.length; i++) { dAq[i] += gq.dA[i]; dAv[i] += gv.dA[i]; }
    for (let i = 0; i < dBq.length; i++) { dBq[i] += gq.dB[i]; dBv[i] += gv.dB[i]; }
    // dxn = Σ over q,v (base Wᵀ·dy + scale·Aᵀ(Bᵀ·dy)) + k (frozen Wkᵀ·dk) — grad into the attn_norm output
    const dxn = add(add(
      add(mvT(L.Wq, dq, D, D), mvT(L.Aq, mvT(L.Bq, dq, rank, D), D, rank).map((x) => x * scale)),
      add(mvT(L.Wv, dV[t], D, D), mvT(L.Av, mvT(L.Bv, dV[t], rank, D), D, rank).map((x) => x * scale))),
      mvT(L.Wk, dk, D, D));
    // hin → xn=rms(hin) (attn path) AND hin → h1 residual AND h1 → h2 residual:  dHin = dh1 + rmsBack(hin)
    dHin[t] = add(dH1[t], rmsBack(lc.hin[t], L.attn_norm, lc.rA[t], dxn));
  }
  return { grads: { dAq, dBq, dAv, dBv }, dHin };
}

// Backward through ALL layers: given dLogits (per position), return per-layer LoRA grads.
export function backward(M, tokens, c, dLogits) {
  const { D, V } = M, T = c.T, layers = layersOf(M);
  // top: lm_head (frozen, tied) + out_norm → grad wrt the final hidden (top layer's output h2)
  let dHout = Array.from({ length: T }, (_, t) => rmsBack(/*final hid*/ rmsInputAt(c, t), M.out_norm, c.rO[t], mvT(M.tok_embd, dLogits.subarray(t * V, t * V + V), D, V)));
  const perLayer = new Array(layers.length);
  for (let l = layers.length - 1; l >= 0; l--) {                      // top → bottom, gradient chaining via dHin
    const { grads, dHin } = blockBackward(M, layers[l], c.layers[l], dHout);
    perLayer[l] = grads; dHout = dHin;
  }
  // flat aliases (back-compat): layer-0 grads as dAq/dBq/dAv/dBv
  return { layers: perLayer, dAq: perLayer[0].dAq, dBq: perLayer[0].dBq, dAv: perLayer[0].dAv, dBv: perLayer[0].dBv };
}
// the final hidden (top layer's output h2) reconstructed at position t: it is the input to out_norm. The
// forward stored xf=rms(hid) but not hid itself; recover hid as the top layer's h1+ff is already gone, so we
// keep it: forwardCache stashes the final hidden on c for the backward's out_norm step.
function rmsInputAt(c, t) { return c.finalHid[t]; }

// Convenience: forward + masked-CE loss + backward → loss and per-layer LoRA grads.
export function lossAndGrads(M, tokens, targets, mask) {
  const c = forwardCache(M, tokens);
  const { loss, dLogits } = maskedCrossEntropy(c.logits, targets, mask, c.T, M.V);
  return { loss, grads: backward(M, tokens, c, dLogits), logits: c.logits };
}

// predictGraph — argmax next-token at the LAST position (greedy). Shows the adapter changed behaviour.
export function predictGraph(M, tokens) {
  const c = forwardCache(M, tokens), V = M.V, t = c.T - 1;
  let mi = 0; for (let j = 1; j < V; j++) if (c.logits[t * V + j] > c.logits[t * V + mi]) mi = j;
  return mi;
}

// adapterParams(M) — every trainable LoRA tensor across ALL layers, in a fixed order, each with its AdamW
// moment buffers. This is the optimizer's view of "what becomes yours": only adapters, base weights frozen.
function adapterParams(M) {
  const ps = [];
  for (const L of layersOf(M)) for (const key of ["Aq", "Bq", "Av", "Bv"]) {
    if (!L["_m" + key]) { L["_m" + key] = new Float64Array(L[key].length); L["_v" + key] = new Float64Array(L[key].length); }
    ps.push({ theta: L[key], m: L["_m" + key], v: L["_v" + key], key });
  }
  return ps;
}
const gradFor = (grads, li, key) => grads.layers[li]["d" + key];

// trainGraphLoRA — the WHOLE-transformer per-user fine-tune LOOP (A1). AdamW on every layer's adapters over
// assistant-masked SFT samples; base weights frozen; cosine LR + warmup. Returns losses + the all-layers
// adapter κ-checkpoint. This is the loop the production run wraps around the streamed-by-κ base weights.
export function trainGraphLoRA(M, samples, { steps = 200, lr = 0.05, schedule = "cosine", warmupSteps = 0, lrMin = null } = {}) {
  const params = adapterParams(M), layers = layersOf(M);
  const sch = { schedule, lrInit: lr, lrMin: lrMin == null ? lr * 0.1 : lrMin, totalSteps: steps, warmupSteps };
  const losses = [];
  for (let step = 0; step < steps; step++) {
    const s = samples[step % samples.length];
    const { loss, grads } = lossAndGrads(M, s.ids, s.targets, s.mask);
    const a = lrForStep(sch, step), t = step + 1;
    let pi = 0;
    for (let li = 0; li < layers.length; li++) for (const key of ["Aq", "Bq", "Av", "Bv"]) {
      const p = params[pi++]; adamwStep(p.theta, gradFor(grads, li, key), p.m, p.v, t, a);
    }
    losses.push(loss);
  }
  return { losses, checkpoint: sealAdapters(M), M };
}

// ── all-layers adapter κ-checkpoint (L5): concat every layer's Aq,Bq,Av,Bv → content-addressed κ-object ──
export function sealAdapters(M) {
  const layers = layersOf(M); let n = 0;
  for (const L of layers) for (const key of ["Aq", "Bq", "Av", "Bv"]) n += L[key].length;
  const all = new Float32Array(2 + n); all[0] = layers.length; all[1] = M.rank; let p = 2;
  for (const L of layers) for (const key of ["Aq", "Bq", "Av", "Bv"]) { all.set(Float32Array.from(L[key]), p); p += L[key].length; }
  const blob = new Uint8Array(all.buffer, all.byteOffset, all.byteLength).slice();
  const hex = sha256hex(blob);
  return { bytes: blob, kappa: kappa("sha256", hex), hex };
}
// loadAdapters — restore an adapter checkpoint into M (L5: refuse a tampered κ). Resume = load-by-κ.
export function loadAdapters(M, blob, expectKappa) {
  const hex = sha256hex(blob);
  if (expectKappa && kappa("sha256", hex) !== expectKappa) throw new Error("graph-lora: L5 REFUSE adapter κ");
  const f = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  const layers = layersOf(M); let p = 2;
  for (const L of layers) for (const key of ["Aq", "Bq", "Av", "Bv"]) { for (let i = 0; i < L[key].length; i++) L[key][i] = f[p + i]; p += L[key].length; }
  return M;
}
