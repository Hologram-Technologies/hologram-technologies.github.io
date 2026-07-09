// κ-native LoRA fine-tuning witness. Authority = finite-difference gradient checking
// (rigorous, self-contained) for the autograd; transcribed-formula checks for AdamW and
// the LR schedulers; a convergence run proving learning works; and the κ-native training
// checkpoint (state → content-addressed κ, resume = load-by-κ + L5 re-derive).
import assert from "node:assert";
import {
  loraForward, loraBackward, adamwStep, lrForStep, maskedCrossEntropy,
  saveTrainState, loadTrainState, ADAMW_DEFAULTS,
} from "./gguf-forge-lora-train.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const r = rnd(0x10a7);
const randF = (n, sc = 0.3) => Float32Array.from({ length: n }, () => r() * sc);

const dims = { inn: 6, out: 4, r: 2 };
const { inn, out, r: rk } = dims;
const W0 = randF(out * inn), A = randF(rk * inn), B = randF(out * rk), x = randF(inn, 1.0), scale = 1.7;
const tgt = randF(out, 1.0); // a target vector → MSE loss

// scalar MSE loss over the LoRA output, and its dL/dy
function lossAndDy(A_, B_) {
  const { y, h } = loraForward(W0, A_, B_, scale, x, dims);
  let L = 0; const dy = new Float32Array(out);
  for (let o = 0; o < out; o++) { const e = y[o] - tgt[o]; L += e * e; dy[o] = 2 * e; }
  return { L, dy, h, y };
}

// ── 1. GRADIENT CHECK: analytic dA/dB vs central finite differences ──
{
  const { dy, h } = lossAndDy(A, B);
  const { dA, dB } = loraBackward(B, scale, x, h, dy, dims);
  const EPS = 1e-3;
  const numGrad = (arr, i) => { const o = arr[i]; arr[i] = o + EPS; const lp = lossAndDy(A, B).L; arr[i] = o - EPS; const lm = lossAndDy(A, B).L; arr[i] = o; return (lp - lm) / (2 * EPS); };
  let maxRelA = 0, maxRelB = 0;
  for (let i = 0; i < A.length; i++) { const ng = numGrad(A, i); maxRelA = Math.max(maxRelA, Math.abs(dA[i] - ng) / (Math.abs(ng) + 1e-4)); }
  for (let i = 0; i < B.length; i++) { const ng = numGrad(B, i); maxRelB = Math.max(maxRelB, Math.abs(dB[i] - ng) / (Math.abs(ng) + 1e-4)); }
  ok(maxRelA < 5e-3 && maxRelB < 5e-3, `gradient check: analytic dA/dB == finite-diff (relA ${maxRelA.toExponential(1)}, relB ${maxRelB.toExponential(1)})`);
}

// ── 2. AdamW step matches the exact ggml formula (hand-computed, t=1) ──
{
  const th = Float32Array.from([0.5]), g = Float32Array.from([0.2]), m = new Float32Array(1), v = new Float32Array(1);
  const alpha = 0.1, { beta1, beta2, eps } = ADAMW_DEFAULTS;
  adamwStep(th, g, m, v, 1, alpha, {});
  // expected (t=1): m=0.2(1-β1)=0.02; v=0.04(1-β2)=4e-5; b1h=1/(1-.9)=10 → mh=.2; b2h=1/(1-.999)=1000 → vh=√(.04)+ε=.2+ε; w=.5 - .1*.2/(.2)=.4
  const mE = 0.2 * (1 - beta1), vE = 0.04 * (1 - beta2);
  const mh = mE * (1 / (1 - beta1)), vh = Math.sqrt(vE * (1 / (1 - beta2))) + eps, wE = 0.5 - alpha * mh / vh;
  // module is f32 (fround), hand-check is f64 → ~1 ULP of f32 expected
  ok(Math.abs(th[0] - wE) < 1e-5 && Math.abs(m[0] - mE) < 1e-7 && Math.abs(v[0] - vE) < 1e-10, `AdamW step matches ggml formula (w=${th[0].toFixed(6)} exp ${wE.toFixed(6)})`);
}

// ── 3. LR schedulers (constant / cosine / linear + warmup) match qvac formula ──
{
  const S = { lrInit: 0.01, lrMin: 0.001, totalSteps: 100, warmupSteps: 10 };
  const warm = lrForStep({ ...S, schedule: "cosine" }, 5);          // halfway through warmup → 0.5·lrInit
  const cosMid = lrForStep({ ...S, schedule: "cosine" }, 55);        // progress 0.5 → 0.5·(1+cos(π/2))=0.5 → lrMin+(init-min)·0.5
  const cosEnd = lrForStep({ ...S, schedule: "cosine" }, 100);       // progress 1 → cos(π)=-1 → 0 → lrMin
  const lin = lrForStep({ ...S, schedule: "linear" }, 55);           // init+(min-init)·0.5
  const con = lrForStep({ ...S, schedule: "constant" }, 80);
  ok(Math.abs(warm - 0.005) < 1e-6, `warmup ramp @5/10 = ${warm.toFixed(5)} (exp 0.00500)`);
  ok(Math.abs(cosMid - (0.001 + 0.009 * 0.5)) < 1e-5, `cosine mid = ${cosMid.toFixed(5)} (exp 0.00550)`);
  ok(Math.abs(cosEnd - 0.001) < 1e-6, `cosine end = ${cosEnd.toFixed(5)} (exp lrMin 0.00100)`);
  ok(Math.abs(lin - (0.01 - 0.009 * 0.5)) < 1e-6, `linear mid = ${lin.toFixed(5)} (exp 0.00550)`);
  ok(Math.abs(con - 0.01) < 1e-9, `constant = ${con.toFixed(5)}`);
}

// ── 4. LEARNING: forward→loss→backward→AdamW reduces MSE monotonically ──
{
  const At = A.slice(), Bt = B.slice(), mA = new Float32Array(A.length), vA = new Float32Array(A.length), mB = new Float32Array(B.length), vB = new Float32Array(B.length);
  let L0 = lossAndDy(At, Bt).L;
  for (let step = 1; step <= 30; step++) {
    const { dy, h } = lossAndDy(At, Bt);
    const { dA, dB } = loraBackward(Bt, scale, x, h, dy, dims);
    const lr = lrForStep({ schedule: "cosine", lrInit: 0.05, lrMin: 0.001, totalSteps: 30, warmupSteps: 3 }, step);
    adamwStep(At, dA, mA, vA, step, lr, {}); adamwStep(Bt, dB, mB, vB, step, lr, {});
  }
  const Lf = lossAndDy(At, Bt).L;
  // AdamW (momentum + warmup) is not strictly monotone by design; the witnessed property
  // is substantial convergence — here a >5× MSE reduction over 30 steps.
  ok(Lf < L0 * 0.2, `training reduces MSE ${L0.toFixed(4)} → ${Lf.toFixed(4)} (>5× drop)`);
}

// ── 5. masked cross-entropy: gradient check + masked positions contribute 0 ──
{
  const T = 3, V = 5, logits = randF(T * V, 1.0), targets = [2, 0, 4], mask = [1, 0, 1];
  const { dLogits } = maskedCrossEntropy(logits, targets, mask, T, V);
  // masked position t=1 must have zero gradient
  let maskedZero = true; for (let j = 0; j < V; j++) if (dLogits[1 * V + j] !== 0) maskedZero = false;
  // finite-diff check on an unmasked logit
  const EPS = 1e-3, idx = 0 * V + 3, o = logits[idx];
  logits[idx] = o + EPS; const lp = maskedCrossEntropy(logits, targets, mask, T, V).loss;
  logits[idx] = o - EPS; const lm = maskedCrossEntropy(logits, targets, mask, T, V).loss;
  logits[idx] = o; const ng = (lp - lm) / (2 * EPS);
  ok(maskedZero && Math.abs(dLogits[idx] - ng) / (Math.abs(ng) + 1e-4) < 5e-3, `masked-CE: masked pos →0 grad; unmasked grad == finite-diff`);
}

// ── 6. κ-NATIVE CHECKPOINT: state → κ; mutate; resume-by-κ + L5; tamper refused ──
{
  const st = { t: 7, A: A.slice(), B: B.slice(), mA: randF(A.length), vA: randF(A.length, 0.01).map(Math.abs), mB: randF(B.length), vB: randF(B.length, 0.01).map(Math.abs) };
  const ck = saveTrainState(st);
  // resume reproduces the exact state
  const re = loadTrainState(ck.bytes, ck.kappa);
  let exact = re.t === st.t && re.A.every((v, i) => v === st.A[i]) && re.vB.every((v, i) => v === st.vB[i]);
  ok(exact, `checkpoint round-trips by κ (${ck.kappa.slice(0, 24)}…)`);
  // a different step → different κ (immutable DAG of checkpoints)
  const ck2 = saveTrainState({ ...st, t: 8 });
  ok(ck2.kappa !== ck.kappa, `optimizer step yields a NEW κ (immutable checkpoint DAG)`);
  // L5: tamper one byte → load refuses against the pinned κ
  ck.bytes[20] ^= 0xff;
  let refused = false; try { loadTrainState(ck.bytes, ck.kappa); } catch { refused = true; }
  ok(refused, `L5 tamper refused on checkpoint`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
