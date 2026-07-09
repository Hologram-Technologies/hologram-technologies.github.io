// GGUF Forge — κ-native on-device LoRA fine-tuning (Tier-A).
//
// qvac-EXCLUSIVE feature (src/llama-lora-training.cpp, examples/training/finetune-lora.cpp).
// The forge has been inference-only; this adds the training primitives: a LoRA-adapted
// linear's forward + analytic BACKWARD (the autograd the inference path never needed),
// the AdamW optimizer step, the LR schedulers, and assistant-masked cross-entropy (SFT).
//
// κ-native angle: training STATE (adapters A,B + AdamW moments m,v + step t) is a
// content-addressed κ-object. Each optimizer step yields a NEW κ → a training run is an
// immutable, L5-verifiable κ-DAG of checkpoints; resume = load-by-κ + re-derive. That is
// the substrate's contribution over qvac's in-RAM/file checkpoints.
//
// LoRA: y = W0·x + scale·B·(A·x),  A:[r,in]  B:[out,r]  W0 frozen (scale = alpha_lora/r).
// Formulas transcribed from qvac:
//   AdamW   ggml/src/ggml-cpu/ops.cpp:11616  (beta1h=1/(1-β1^t), decoupled wd: keep=1-αλ)
//   defaults ggml/src/ggml-opt.cpp:319       (α=1e-3 β1=.9 β2=.999 ε=1e-8 wd=0)
//   LR sched examples/training/finetune-lora.cpp:87 (constant/cosine/linear + warmup)
// Witness authority = finite-difference gradient checking (self-contained, rigorous).

import { sha256hex, kappa } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const fr = Math.fround;

// ── LoRA-adapted linear ──────────────────────────────────────────────────────
// W0: [out*in] row-major (frozen). A: [r*in]. B: [out*r]. x: [in]. → y: [out].
export function loraForward(W0, A, B, scale, x, dims) {
  const { inn, out, r } = dims;
  const h = new Float32Array(r);                 // h = A·x
  for (let k = 0; k < r; k++) { let s = 0; for (let i = 0; i < inn; i++) s = fr(s + fr(A[k * inn + i] * x[i])); h[k] = s; }
  const y = new Float32Array(out);               // y = W0·x + scale·B·h
  for (let o = 0; o < out; o++) {
    let s = 0; for (let i = 0; i < inn; i++) s = fr(s + fr(W0[o * inn + i] * x[i]));
    let bh = 0; for (let k = 0; k < r; k++) bh = fr(bh + fr(B[o * r + k] * h[k]));
    y[o] = fr(s + fr(scale * bh));
  }
  return { y, h };
}

// Backward: given dL/dy, return gradients for the TRAINABLE params A and B (W0 frozen).
//   dB[o,k] = scale·dy[o]·h[k]       dh[k] = scale·Σ_o B[o,k]·dy[o]       dA[k,i] = dh[k]·x[i]
export function loraBackward(B, scale, x, h, dy, dims) {
  const { inn, out, r } = dims;
  const dB = new Float32Array(out * r), dA = new Float32Array(r * inn), dh = new Float32Array(r);
  for (let o = 0; o < out; o++) for (let k = 0; k < r; k++) dB[o * r + k] = fr(fr(scale * dy[o]) * h[k]);
  for (let k = 0; k < r; k++) { let s = 0; for (let o = 0; o < out; o++) s = fr(s + fr(B[o * r + k] * dy[o])); dh[k] = fr(scale * s); }
  for (let k = 0; k < r; k++) for (let i = 0; i < inn; i++) dA[k * inn + i] = fr(dh[k] * x[i]);
  return { dA, dB };
}

// ── AdamW (decoupled weight decay), in-place on theta/m/v. t = 1-based step. ──
export const ADAMW_DEFAULTS = { beta1: 0.9, beta2: 0.999, eps: 1e-8, wd: 0.0 };
export function adamwStep(theta, grad, m, v, t, alpha, opt = {}) {
  const { beta1, beta2, eps, wd } = { ...ADAMW_DEFAULTS, ...opt };
  const beta1h = fr(1 / fr(1 - fr(Math.pow(beta1, t))));
  const beta2h = fr(1 / fr(1 - fr(Math.pow(beta2, t))));
  const keep = fr(1 - fr(alpha * wd));
  for (let i = 0; i < theta.length; i++) {
    const g = grad[i];
    m[i] = fr(fr(m[i] * beta1) + fr(g * fr(1 - beta1)));
    v[i] = fr(fr(v[i] * beta2) + fr(fr(g * g) * fr(1 - beta2)));
    const mh = fr(m[i] * beta1h);
    const vh = fr(fr(Math.sqrt(fr(v[i] * beta2h))) + eps);
    theta[i] = fr(fr(theta[i] * keep) - fr(fr(alpha * mh) / vh));
  }
}

// ── LR schedulers (finetune-lora.cpp lora_scheduler_lr_for_step) ──
// schedule ∈ {"constant","cosine","linear"}; warmup is a linear ramp 0→lrInit.
export function lrForStep(state, step) {
  const { schedule = "cosine", lrInit, lrMin = 0, totalSteps, warmupSteps = 0 } = state;
  if (totalSteps <= 0) return Math.max(lrInit, 0);
  const cs = Math.min(Math.max(step, 0), totalSteps);
  const wu = Math.min(Math.max(warmupSteps, 0), totalSteps);
  if (wu > 0 && cs < wu) return Math.max(fr(lrInit * fr(cs / wu)), 0);
  const adj = cs - wu; let rem = totalSteps - wu; if (rem <= 0) rem = 1;
  const progress = Math.min(fr(adj / rem), 1);
  let lr = lrInit;
  if (schedule === "cosine") { const c = fr(0.5 * fr(1 + Math.cos(fr(progress * Math.PI)))); lr = fr(lrMin + fr(fr(lrInit - lrMin) * c)); }
  else if (schedule === "linear") lr = fr(lrInit + fr(fr(lrMin - lrInit) * progress));
  return Math.max(lr, 0);
}

// ── Assistant-masked cross-entropy (SFT loss). logits: [T*V], target/mask: [T]. ──
// Returns mean loss over UNMASKED positions + dL/dlogits (0 at masked positions).
export function maskedCrossEntropy(logits, targets, mask, T, V) {
  const dL = new Float32Array(T * V); let loss = 0, n = 0;
  for (let t = 0; t < T; t++) {
    if (!mask[t]) continue; n++;
    let mx = -Infinity; for (let j = 0; j < V; j++) mx = Math.max(mx, logits[t * V + j]);
    let z = 0; const p = new Float64Array(V);
    for (let j = 0; j < V; j++) { p[j] = Math.exp(logits[t * V + j] - mx); z += p[j]; }
    for (let j = 0; j < V; j++) p[j] /= z;
    loss += -Math.log(p[targets[t]] + 1e-30);
    for (let j = 0; j < V; j++) dL[t * V + j] = p[j];
    dL[t * V + targets[t]] -= 1;
  }
  if (n > 0) { loss /= n; for (let i = 0; i < dL.length; i++) dL[i] /= n; }
  return { loss, dLogits: dL, count: n };
}

// ── κ-native training-state checkpoint: {A,B,m*,v*,t} → content-addressed κ-object ──
const f32cat = (...arrs) => { const n = arrs.reduce((a, x) => a + x.length, 0); const o = new Float32Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; };
export function saveTrainState(st) {
  const head = Float32Array.from([st.t, st.A.length, st.B.length]);
  const all = f32cat(head, st.A, st.B, st.mA, st.vA, st.mB, st.vB);
  const blob = new Uint8Array(all.buffer, all.byteOffset, all.byteLength).slice();
  const hex = sha256hex(blob);
  return { bytes: blob, kappa: kappa("sha256", hex), hex };
}
export function loadTrainState(blob, expectKappa) {
  const hex = sha256hex(blob);
  if (expectKappa && kappa("sha256", hex) !== expectKappa) throw new Error("lora-train: L5 REFUSE checkpoint κ");
  const f = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  const t = f[0], na = f[1], nb = f[2]; let p = 3;            // header = [t, |A|, |B|]
  const take = (n) => { const s = f.slice(p, p + n); p += n; return s; };
  return { t, A: take(na), B: take(nb), mA: take(na), vA: take(na), mB: take(nb), vB: take(nb) };
}
