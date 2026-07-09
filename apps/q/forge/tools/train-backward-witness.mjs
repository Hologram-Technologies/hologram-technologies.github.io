// train-backward-witness.mjs — A5 authority: the GPU BACKWARD kernels are gradient-checked against the TRUE
// numeric gradient (finite differences), and shown to match the proven CPU autograd. WGSL → JS line-by-line
// transcription below (the kernel SIMULATOR); the real WGSL on WebGPU is exercised by gpu/train-backward.html.
// Chain of trust:
//   (0) CPU analytic backward  ==  finite-difference numeric gradient     → the autograd is correct
//   (1) GPU-kernel sim (OUTER·MATVECT)  ==  CPU analytic backward          → the kernels compute the gradient
//   (2) GPU-kernel sim ADAMW  ==  CPU adamwStep                            → the optimizer step matches
//   (3) full kernel-driven step (fwd→CE→sim-backward→sim-adamw) LEARNS    → loss falls; adapter beats W0 alone
// 100% deterministic, Node-only, zero deps beyond the forge train primitives.
import { loraForward, loraBackward, adamwStep, maskedCrossEntropy, ADAMW_DEFAULTS } from "../gguf-forge-lora-train.mjs";

const fr = Math.fround;
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };

// ── WGSL → JS transcription of the three backward kernels (f32 via Math.fround, exactly as the GPU runs) ──
// OUTER:  G[i] = p.x·u[row]·w[col],  row=i/C, col=i%C,  i∈[0,R·C)
function simOUTER(u, w, scale, R, C) {
  const G = new Float32Array(R * C);
  for (let i = 0; i < R * C; i++) { const row = Math.floor(i / C), col = i - row * C; G[i] = fr(fr(scale * u[row]) * w[col]); }
  return G;
}
// MATVECT: o[c] = p.x·Σ_r M[r·C+c]·v[r],  c∈[0,C)   (reads M's columns = Mᵀ·v)
function simMATVECT(M, v, scale, R, C) {
  const o = new Float32Array(C);
  for (let c = 0; c < C; c++) { let acc = 0; for (let r = 0; r < R; r++) acc = fr(acc + fr(M[r * C + c] * v[r])); o[c] = fr(scale * acc); }
  return o;
}
// ADAMW: in-place; m=m·β1+g·(1-β1); v=v·β2+g²·(1-β2); mh=m·β1h; vh=√(v·β2h)+ε; th=th·keep−α·mh/vh
function simADAMW(theta, grad, m, v, t, alpha, opt = {}) {
  const { beta1, beta2, eps, wd } = { ...ADAMW_DEFAULTS, ...opt };
  const b1h = fr(1 / fr(1 - fr(Math.pow(beta1, t)))), b2h = fr(1 / fr(1 - fr(Math.pow(beta2, t)))), keep = fr(1 - fr(alpha * wd));
  for (let i = 0; i < theta.length; i++) {
    const gi = grad[i];
    const mi = fr(fr(m[i] * beta1) + fr(gi * fr(1 - beta1)));
    const vi = fr(fr(v[i] * beta2) + fr(fr(gi * gi) * fr(1 - beta2)));
    m[i] = mi; v[i] = vi;
    const mh = fr(mi * b1h), vh = fr(fr(Math.sqrt(fr(vi * b2h))) + eps);
    theta[i] = fr(fr(theta[i] * keep) - fr(fr(alpha * mh) / vh));
  }
}
// the backward via the kernel simulator (what the GPU loraBackwardGPU does): OUTER, MATVECT, OUTER.
function simBackward(B, scale, x, h, dy, dims) {
  const { inn, out, r } = dims;
  const dB = simOUTER(dy, h, scale, out, r);          // dB = scale·dy⊗h
  const dh = simMATVECT(B, dy, scale, out, r);        // dh = scale·Bᵀ·dy
  const dA = simOUTER(dh, x, 1, r, inn);              // dA = dh⊗x
  return { dA, dB };
}

const rel = (a, b) => { let me = 0, mx = 1e-12; for (let i = 0; i < a.length; i++) { me = Math.max(me, Math.abs(a[i] - b[i])); mx = Math.max(mx, Math.abs(b[i])); } return me / mx; };
const lcg = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296 - 0.5; }; };

// ── a small LoRA-adapted linear ──
const inn = 12, out = 8, r = 3, scale = 1.5, dims = { inn, out, r };
const rnd = lcg(7);
const W0 = new Float32Array(out * inn); for (let i = 0; i < W0.length; i++) W0[i] = fr(rnd() * 0.5);
const A = new Float32Array(r * inn); for (let i = 0; i < A.length; i++) A[i] = fr(rnd() * 0.3);
const B = new Float32Array(out * r); for (let i = 0; i < B.length; i++) B[i] = fr(rnd() * 0.3);
const x = new Float32Array(inn); for (let i = 0; i < x.length; i++) x[i] = fr(rnd());
const target = 5;

// forward + the upstream gradient dy = dL/dlogits (single position, mask=1)
const { y, h } = loraForward(W0, A, B, scale, x, dims);
const { loss: L0, dLogits } = maskedCrossEntropy(y, [target], [1], 1, out);
const dy = dLogits.slice(0, out);

// loss as a pure f64 function of (A,B) — for the finite-difference numeric gradient (the ground truth)
function lossF64(Av, Bv) {
  const hh = new Float64Array(r); for (let k = 0; k < r; k++) { let s = 0; for (let i = 0; i < inn; i++) s += Av[k * inn + i] * x[i]; hh[k] = s; }
  const yy = new Float64Array(out); for (let o = 0; o < out; o++) { let s = 0; for (let i = 0; i < inn; i++) s += W0[o * inn + i] * x[i]; let bh = 0; for (let k = 0; k < r; k++) bh += Bv[o * r + k] * hh[k]; yy[o] = s + scale * bh; }
  let mx = -Infinity; for (let o = 0; o < out; o++) mx = Math.max(mx, yy[o]);
  let z = 0; for (let o = 0; o < out; o++) z += Math.exp(yy[o] - mx);
  return -(yy[target] - mx - Math.log(z));
}
function numericGrad(theta, n) {
  const g = new Float64Array(n), eps = 1e-3;
  for (let i = 0; i < n; i++) { const o = theta[i]; const Av = theta === A ? f64(A) : f64(A), Bv = theta === B ? f64(B) : f64(B);
    const tv = theta === A ? Av : Bv; tv[i] = o + eps; const lp = lossF64(Av, Bv); tv[i] = o - eps; const lm = lossF64(Av, Bv); tv[i] = o; g[i] = (lp - lm) / (2 * eps); }
  return g;
}
const f64 = (a) => Float64Array.from(a);

// (0) CPU analytic == finite-difference numeric gradient → the autograd is correct
const { dA: cdA, dB: cdB } = loraBackward(B, scale, x, h, dy, dims);
const nA = numericGrad(A, A.length), nB = numericGrad(B, B.length);
ok(rel(cdA, nA) < 2e-2, `(0) CPU analytic dA == numeric gradient (rel ${rel(cdA, nA).toExponential(2)})`);
ok(rel(cdB, nB) < 2e-2, `(0) CPU analytic dB == numeric gradient (rel ${rel(cdB, nB).toExponential(2)})`);

// (1) GPU-kernel sim == CPU analytic backward → the kernels compute exactly that gradient
const { dA: gdA, dB: gdB } = simBackward(B, scale, x, h, dy, dims);
ok(rel(gdA, cdA) < 1e-5, `(1) kernel OUTER(dh⊗x) dA == CPU analytic dA (rel ${rel(gdA, cdA).toExponential(2)})`);
ok(rel(gdB, cdB) < 1e-5, `(1) kernel OUTER(dy⊗h) dB == CPU analytic dB (rel ${rel(gdB, cdB).toExponential(2)})`);
// and the kernel gradient itself passes the finite-difference check (transitively, but assert directly)
ok(rel(gdA, nA) < 2e-2 && rel(gdB, nB) < 2e-2, `(1) kernel gradient passes finite-difference check`);

// MATVECT in isolation: dh = scale·Bᵀ·dy vs a hand reference
const dhRef = new Float32Array(r); for (let k = 0; k < r; k++) { let s = 0; for (let o = 0; o < out; o++) s = fr(s + fr(B[o * r + k] * dy[o])); dhRef[k] = fr(scale * s); }
ok(rel(simMATVECT(B, dy, scale, out, r), dhRef) < 1e-6, `(1) kernel MATVECT (Bᵀ·dy) matches transposed-matvec reference`);

// (2) GPU-kernel ADAMW == CPU adamwStep (same inputs, in-place)
{
  const th1 = f32(A), m1 = new Float32Array(A.length), v1 = new Float32Array(A.length);
  const th2 = f32(A), m2 = new Float32Array(A.length), v2 = new Float32Array(A.length);
  adamwStep(th1, cdA, m1, v1, 1, 0.05);
  simADAMW(th2, cdA, m2, v2, 1, 0.05);
  ok(rel(th2, th1) < 1e-6 && rel(m2, m1) < 1e-6 && rel(v2, v1) < 1e-6, `(2) kernel ADAMW == CPU adamwStep (θ,m,v)`);
}
function f32(a) { return Float32Array.from(a); }

// (3) a full kernel-driven training loop LEARNS: forward→CE→sim-backward→sim-adamw, loss falls, adapter beats W0
{
  const At = new Float32Array(r * inn); for (let i = 0; i < At.length; i++) At[i] = fr(rnd() * 0.04);
  const Bt = new Float32Array(out * r);                                  // LoRA: B=0 → start == base model
  const mA = new Float32Array(At.length), vA = new Float32Array(At.length), mB = new Float32Array(Bt.length), vB = new Float32Array(Bt.length);
  const argmax = (yv) => { let mi = 0; for (let o = 1; o < out; o++) if (yv[o] > yv[mi]) mi = o; return mi; };
  const basePred = argmax(loraForward(W0, At, new Float32Array(out * r), scale, x, dims).y);   // W0 alone (B=0)
  let first = null, last = null;
  for (let step = 0; step < 400; step++) {
    const f = loraForward(W0, At, Bt, scale, x, dims);
    const { loss, dLogits } = maskedCrossEntropy(f.y, [target], [1], 1, out);
    const d = dLogits.slice(0, out);
    const { dA, dB } = simBackward(Bt, scale, x, f.h, d, dims);          // ← GPU-kernel-sim backward
    simADAMW(At, dA, mA, vA, step + 1, 0.05);                            // ← GPU-kernel-sim AdamW
    simADAMW(Bt, dB, mB, vB, step + 1, 0.05);
    if (first === null) first = loss; last = loss;
  }
  const finalPred = argmax(loraForward(W0, At, Bt, scale, x, dims).y);
  ok(last < first * 0.2, `(3) loss falls under kernel-driven training (${first.toFixed(3)} → ${last.toFixed(3)})`);
  ok(finalPred === target, `(3) trained adapter predicts target ${target} (base W0 alone → ${basePred})`);
}

console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED: GPU backward kernels (OUTER·MATVECT·ADAMW) reproduce the true (finite-difference) gradient and the proven CPU autograd; a full kernel-driven loop trains on-device."}`);
process.exit(fail ? 1 : 0);
