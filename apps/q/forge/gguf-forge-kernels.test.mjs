// Tier-A kernel tests — correctness via mathematical invariants + hand values.
// (Bit-exact-vs-llama.cpp is gate task #4; these prove the algorithms are right.)

import assert from "node:assert";
import { rmsNorm, silu, swiglu, softmax, ropeNeox, sigmoid, moeTopK, moeRoute, moeCombine } from "./gguf-forge-kernels.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };
const close = (a, b, tol = 1e-5) => Math.abs(a - b) <= tol;
function prng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

t("rmsNorm(weight=1) yields unit mean-square", () => {
  const r = prng(3), n = 256, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (r() * 2 - 1) * 5;
  const w = new Float32Array(n).fill(1);
  const y = rmsNorm(x, w, 1e-6);
  let ms = 0; for (let i = 0; i < n; i++) ms += y[i] * y[i];
  ms /= n;
  assert.ok(close(ms, 1, 1e-3), `mean-square ${ms}`);
});

t("rmsNorm applies weight and matches f64 reference", () => {
  const x = Float32Array.from([1, 2, 3, 4]);
  const w = Float32Array.from([1, 0.5, 2, 1]);
  const eps = 1e-6;
  const y = rmsNorm(x, w, eps);
  // independent f64 reference
  let s = 0; for (const v of x) s += v * v;
  const scale = 1 / Math.sqrt(s / 4 + eps);
  for (let i = 0; i < 4; i++) assert.ok(close(y[i], x[i] * scale * w[i], 1e-5), `idx ${i}: ${y[i]}`);
});

t("silu known values", () => {
  assert.strictEqual(silu(0), 0);
  assert.ok(close(silu(1), 0.7310586, 1e-6));
  assert.ok(close(silu(-1), -0.26894143, 1e-6));
  assert.ok(close(silu(20), 20, 1e-3));   // saturates to x
});

t("swiglu == silu(gate)*up", () => {
  const g = Float32Array.from([1, -1, 2, 0]);
  const u = Float32Array.from([3, 4, -1, 9]);
  const y = swiglu(g, u);
  for (let i = 0; i < 4; i++) assert.ok(close(y[i], silu(g[i]) * u[i], 1e-6), `idx ${i}`);
});

t("softmax: sums to 1, scaled, causal mask zeroes future", () => {
  const s = Float32Array.from([1, 2, 3, 4]);
  const scale = 0.5;
  const mask = Float32Array.from([0, 0, -Infinity, -Infinity]); // attend to first 2 only
  const p = softmax(s, scale, mask);
  let sum = 0; for (const v of p) sum += v;
  assert.ok(close(sum, 1, 1e-6), `sum ${sum}`);
  assert.strictEqual(p[2], 0); assert.strictEqual(p[3], 0);
  // first two follow softmax(scale*[1,2]) = softmax([0.5,1.0])
  const e0 = Math.exp(0.5 - 1.0), e1 = Math.exp(1.0 - 1.0), z = e0 + e1;
  assert.ok(close(p[0], e0 / z, 1e-6) && close(p[1], e1 / z, 1e-6));
});

t("softmax matches f64 reference (random, unmasked)", () => {
  const r = prng(9), n = 64, s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = (r() * 2 - 1) * 8;
  const scale = 0.125;
  const p = softmax(s, scale);
  let mx = -Infinity; for (let i = 0; i < n; i++) mx = Math.max(mx, s[i] * scale);
  let z = 0; const ref = new Float64Array(n);
  for (let i = 0; i < n; i++) { ref[i] = Math.exp(s[i] * scale - mx); z += ref[i]; }
  for (let i = 0; i < n; i++) assert.ok(close(p[i], ref[i] / z, 1e-6), `idx ${i}`);
});

t("ropeNeox: pos=0 is identity", () => {
  const r = prng(5), hd = 64, x = new Float32Array(hd);
  for (let i = 0; i < hd; i++) x[i] = r() * 2 - 1;
  const y = ropeNeox(x, 0, hd, 1000000);
  for (let i = 0; i < hd; i++) assert.ok(close(y[i], x[i], 1e-6), `idx ${i}`);
});

t("ropeNeox: rotation preserves each pair's norm", () => {
  const r = prng(8), hd = 64, nRot = 64, half = nRot / 2, x = new Float32Array(hd);
  for (let i = 0; i < hd; i++) x[i] = (r() * 2 - 1) * 3;
  const y = ropeNeox(x, 7, nRot, 1000000);
  for (let ic = 0; ic < half; ic++) {
    const before = x[ic] * x[ic] + x[ic + half] * x[ic + half];
    const after = y[ic] * y[ic] + y[ic + half] * y[ic + half];
    assert.ok(close(before, after, 1e-3), `pair ${ic}: ${before} vs ${after}`);
  }
});

t("ropeNeox matches direct theta formula", () => {
  const hd = 8, nRot = 8, half = 4, freqBase = 10000, pos = 3;
  const x = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const y = ropeNeox(x, pos, nRot, freqBase);
  for (let ic = 0; ic < half; ic++) {
    const theta = pos * Math.pow(freqBase, -2 * ic / nRot);
    const c = Math.cos(theta), s = Math.sin(theta);
    const x0 = x[ic], x1 = x[ic + half];
    assert.ok(close(y[ic], x0 * c - x1 * s, 1e-4), `lo ${ic}`);
    assert.ok(close(y[ic + half], x0 * s + x1 * c, 1e-4), `hi ${ic}`);
  }
});

// ── MoE router + combine ──────────────────────────────────────────────────────
t("sigmoid known values", () => {
  assert.ok(close(sigmoid(0), 0.5, 1e-7));
  assert.ok(close(sigmoid(2), 0.880797, 1e-6));
  assert.ok(close(sigmoid(-2), 0.119203, 1e-6));
});

t("moeTopK: descending by value, ties → lower index", () => {
  assert.deepStrictEqual(moeTopK(Float32Array.from([0.1, 0.9, 0.3, 0.7]), 2), [1, 3]);
  // exact ties (0.5) resolve to ascending index: picks 0 then 2
  assert.deepStrictEqual(moeTopK(Float32Array.from([0.5, 0.4, 0.5, 0.5]), 2), [0, 2]);
  assert.deepStrictEqual(moeTopK(Float32Array.from([3, 1, 2]), 3), [0, 2, 1]);
});

t("moeRoute softmax + norm_w (Mixtral/Qwen2-MoE path)", () => {
  const logits = Float32Array.from([2.0, 1.0, 0.5, -1.0]); // 4 experts, use 2
  const { selected, weights } = moeRoute(logits, { gatingOp: "softmax", nExpertUsed: 2, normW: true });
  // hand ref: softmax over all 4, take top-2 (experts 0,1), renormalize that pair
  const ex = logits.map((v) => Math.exp(v)); const Z = ex.reduce((a, b) => a + b);
  const p = ex.map((v) => v / Z);
  assert.deepStrictEqual([...selected], [0, 1]);
  const s = p[0] + p[1];
  assert.ok(close(weights[0], p[0] / s, 1e-6) && close(weights[1], p[1] / s, 1e-6), `weights ${weights}`);
  assert.ok(close(weights[0] + weights[1], 1, 1e-6), "norm_w sums to 1");
});

t("moeRoute sigmoid gating + norm_w (DeepSeek-style)", () => {
  const logits = Float32Array.from([1.0, -0.5, 2.0, 0.0]);
  const { selected, weights } = moeRoute(logits, { gatingOp: "sigmoid", nExpertUsed: 2, normW: true });
  const sg = logits.map((v) => 1 / (1 + Math.exp(-v)));
  // top-2 sigmoid: experts 2 (sg=0.880) then 0 (sg=0.731)
  assert.deepStrictEqual([...selected], [2, 0]);
  const s = sg[2] + sg[0];
  assert.ok(close(weights[0], sg[2] / s, 1e-6) && close(weights[1], sg[0] / s, 1e-6), `weights ${weights}`);
});

t("moeRoute softmax_weight: probs=logits, softmax over selected", () => {
  const logits = Float32Array.from([0.2, 3.0, 1.0, 2.5]);
  const { selected, weights } = moeRoute(logits, { gatingOp: "softmax_weight", nExpertUsed: 2 });
  assert.deepStrictEqual([...selected], [1, 3]);          // top-2 raw logits
  const e1 = Math.exp(3.0 - 3.0), e3 = Math.exp(2.5 - 3.0), z = e1 + e3; // softmax over [3.0,2.5]
  assert.ok(close(weights[0], e1 / z, 1e-6) && close(weights[1], e3 / z, 1e-6), `weights ${weights}`);
});

t("moeRoute: selection bias steers top-k but weights stay unbiased (DeepSeek-V3)", () => {
  const logits = Float32Array.from([2.0, 1.0, 0.5, -1.0]);
  // bias huge-boosts expert 3 so it gets selected over expert 1, but its weight = unbiased prob.
  const selBias = Float32Array.from([0, 0, 0, 10]);
  const { selected, weights } = moeRoute(logits, { gatingOp: "softmax", nExpertUsed: 2, selBias, normW: false });
  const ex = logits.map((v) => Math.exp(v)); const Z = ex.reduce((a, b) => a + b);
  const p = ex.map((v) => v / Z);
  assert.deepStrictEqual([...selected], [3, 0]);          // expert 3 ranks first via bias, then expert 0
  assert.ok(close(weights[0], p[3], 1e-6) && close(weights[1], p[0], 1e-6), `unbiased weights ${weights}`);
});

t("moeRoute: w_scale multiplies weights", () => {
  const logits = Float32Array.from([1.0, 0.0]);
  const { weights } = moeRoute(logits, { gatingOp: "softmax", nExpertUsed: 2, normW: true, wScale: 2.5 });
  assert.ok(close(weights[0] + weights[1], 2.5, 1e-6), `scaled sum ${weights[0] + weights[1]}`);
});

t("moeCombine: weighted sum of expert outputs", () => {
  const e0 = Float32Array.from([1, 2, 3]);
  const e1 = Float32Array.from([10, 20, 30]);
  const out = moeCombine([e0, e1], Float32Array.from([0.25, 0.75]), 3);
  for (let j = 0; j < 3; j++) assert.ok(close(out[j], 0.25 * e0[j] + 0.75 * e1[j], 1e-6), `idx ${j}: ${out[j]}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
