// Full-graph LoRA autograd witness. Authority = end-to-end finite-difference gradient
// checking: the analytic gradient of the masked-CE loss w.r.t. the LoRA params (flowing
// through lm_head → rms_norm → SwiGLU → causal attention → RoPE → adapted QKV) must match
// central finite differences. Then a convergence run proves the adapters actually train
// through the whole transformer. Also exercises the κ-native optimizer/checkpoint path.
import assert from "node:assert";
import { forwardCache, backward, lossAndGrads } from "./gguf-forge-lora-graph.mjs";
import { maskedCrossEntropy, adamwStep, lrForStep, saveTrainState, loadTrainState } from "./gguf-forge-lora-train.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const r = rnd(0x6a17);
const rf = (n, sc = 0.3) => Float64Array.from({ length: n }, () => r() * sc);
const nrm = (n) => Float64Array.from({ length: n }, () => Math.abs(r()) + 0.5);

const D = 8, NH = 2, HD = 4, FF = 12, V = 6, rank = 2;
const M = {
  D, NH, HD, FF, V, rank, eps: 1e-5, freqBase: 10000, scale: 1.5,
  tok_embd: rf(V * D, 0.5), attn_norm: nrm(D), ffn_norm: nrm(D), out_norm: nrm(D),
  Wq: rf(D * D), Wk: rf(D * D), Wv: rf(D * D), Wo: rf(D * D),
  Wg: rf(FF * D), Wu: rf(FF * D), Wd: rf(D * FF),
  Aq: rf(rank * D), Bq: rf(D * rank), Av: rf(rank * D), Bv: rf(D * rank),
};
const tokens = [3, 1, 4, 2], targets = [1, 4, 0, 5], mask = [0, 1, 1, 1]; // first token masked (prompt)

const lossOf = () => { const c = forwardCache(M, tokens); return maskedCrossEntropy(c.logits, targets, mask, c.T, V).loss; };

// ── 1. END-TO-END GRADIENT CHECK over all four LoRA tensors ──
{
  const { grads } = lossAndGrads(M, tokens, targets, mask);
  const EPS = 1e-5;
  const check = (name, arr, g) => {
    let maxRel = 0, worst = 0;
    for (let i = 0; i < arr.length; i++) {
      const o = arr[i]; arr[i] = o + EPS; const lp = lossOf(); arr[i] = o - EPS; const lm = lossOf(); arr[i] = o;
      const ng = (lp - lm) / (2 * EPS), rel = Math.abs(g[i] - ng) / (Math.abs(ng) + 1e-6);
      if (rel > maxRel) { maxRel = rel; worst = i; }
    }
    ok(maxRel < 1e-4, `${name} grad == finite-diff (maxRel ${maxRel.toExponential(1)} @${worst})`);
  };
  check("Aq", M.Aq, grads.dAq); check("Bq", M.Bq, grads.dBq);
  check("Av", M.Av, grads.dAv); check("Bv", M.Bv, grads.dBv);
}

// ── 2. CONVERGENCE: AdamW on the LoRA params reduces the full-graph loss ──
{
  const mAq = new Float64Array(M.Aq.length), vAq = new Float64Array(M.Aq.length), mBq = new Float64Array(M.Bq.length), vBq = new Float64Array(M.Bq.length);
  const mAv = new Float64Array(M.Av.length), vAv = new Float64Array(M.Av.length), mBv = new Float64Array(M.Bv.length), vBv = new Float64Array(M.Bv.length);
  const L0 = lossAndGrads(M, tokens, targets, mask).loss;
  for (let step = 1; step <= 60; step++) {
    const { grads } = lossAndGrads(M, tokens, targets, mask);
    const lr = lrForStep({ schedule: "cosine", lrInit: 0.08, lrMin: 0.001, totalSteps: 60, warmupSteps: 5 }, step);
    adamwStep(M.Aq, grads.dAq, mAq, vAq, step, lr, {}); adamwStep(M.Bq, grads.dBq, mBq, vBq, step, lr, {});
    adamwStep(M.Av, grads.dAv, mAv, vAv, step, lr, {}); adamwStep(M.Bv, grads.dBv, mBv, vBv, step, lr, {});
  }
  const Lf = lossAndGrads(M, tokens, targets, mask).loss;
  ok(Lf < L0 * 0.5, `full-graph LoRA training reduces masked-CE ${L0.toFixed(4)} → ${Lf.toFixed(4)}`);
}

// ── 3. κ-native: the trained adapters checkpoint to a content-addressed κ + L5 resume ──
{
  const st = { t: 60, A: Float32Array.from(M.Aq), B: Float32Array.from(M.Bq), mA: new Float32Array(M.Aq.length), vA: new Float32Array(M.Aq.length), mB: new Float32Array(M.Bq.length), vB: new Float32Array(M.Bq.length) };
  const ck = saveTrainState(st), re = loadTrainState(ck.bytes, ck.kappa);
  ok(re.A.every((v, i) => v === st.A[i]), `trained adapter checkpoints by κ (${ck.kappa.slice(0, 22)}…) + L5 resume`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
