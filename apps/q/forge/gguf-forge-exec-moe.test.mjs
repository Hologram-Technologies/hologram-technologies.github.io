// MoE executor end-to-end test. Build a tiny MoE (real random F32 weights, stacked
// expert κ-objects), forge → synthesize → run forward, and compare logits to an
// INDEPENDENT float64 MoE reference written from scratch here (router softmax →
// top-k → per-expert SwiGLU → weighted sum + optional shared expert). Covers the two
// S2 dialects: Mixtral (no shared, norm_w=true) and Qwen2-MoE (shared, norm_w=false).

import assert from "node:assert";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

const D = 8, NH = 2, NHKV = 1, HD = 4, FF = 6, VOCAB = 5, NL = 1, E = 4, USED = 2, EPS = 1e-6, FREQ = 10000;
const QD = NH * HD, KV = NHKV * HD;
function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const randF = (r, n, scale = 0.3) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * scale; return a; };

// ── GGUF writer (F32 + float meta) ──
function buildGguf(meta, tensors) {
  const ALIGN = 32; let off = 0;
  const infos = tensors.map((t) => { const o = off; off = Math.ceil((o + t.bytes.length) / ALIGN) * ALIGN; return { ...t, offset: o }; });
  let parts = [], len = 0; const push = (b) => { parts.push(b); len += b.length; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); push(b); };
  const f32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); push(b); };
  const u64 = (v) => { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, v >>> 0, true); dv.setUint32(4, Math.floor(v / 4294967296), true); push(b); };
  const str = (s) => { const e = new TextEncoder().encode(s); u64(e.length); push(e); };
  push(new TextEncoder().encode("GGUF")); u32(3); u64(tensors.length); u64(Object.keys(meta).length);
  for (const [k, val] of Object.entries(meta)) { str(k); if (typeof val === "string") { u32(8); str(val); } else if (Number.isInteger(val) && val >= 0 && val < 4294967296) { u32(4); u32(val); } else { u32(6); f32(val); } }
  for (const ti of infos) { str(ti.name); u32(ti.dims.length); for (const d of ti.dims) u64(d); u32(ti.type); u64(ti.offset); }
  if (len % ALIGN) push(new Uint8Array(ALIGN - (len % ALIGN)));
  const dataStart = len;
  for (const ti of infos) { while (len < dataStart + ti.offset) push(new Uint8Array(1)); push(ti.bytes); }
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
const f32bytes = (arr) => new Uint8Array(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength));

// ── reference helpers (f64) ──
function matvecRef(W, x, K, N, base = 0) { const y = new Float64Array(N); for (let n = 0; n < N; n++) { let s = 0; for (let k = 0; k < K; k++) s += W[base + n * K + k] * x[k]; y[n] = s; } return y; }
function rmsRef(x, wt) { let s = 0; for (const v of x) s += v * v; const sc = 1 / Math.sqrt(s / x.length + EPS); return x.map((v, i) => v * sc * wt[i]); }
const siluRef = (v) => v / (1 + Math.exp(-v));
const sigmoidRef = (v) => 1 / (1 + Math.exp(-v));
function ropeRef(vec, pos, headDim) { const half = headDim / 2, nHeads = vec.length / headDim, out = Float64Array.from(vec); for (let hh = 0; hh < nHeads; hh++) for (let ic = 0; ic < half; ic++) { const th = pos * Math.pow(FREQ, -2 * ic / headDim); const c = Math.cos(th), sn = Math.sin(th); const o = hh * headDim; const x0 = vec[o + ic], x1 = vec[o + ic + half]; out[o + ic] = x0 * c - x1 * sn; out[o + ic + half] = x0 * sn + x1 * c; } return out; }
const addV = (a, b) => a.map((x, i) => x + b[i]);
function softmaxRef(a) { const mx = Math.max(...a); let z = 0; const e = a.map((s) => { const x = Math.exp(s - mx); z += x; return x; }); return e.map((x) => x / z); }

function makeModel(seed, { arch, shared, normW }) {
  const r = prng(seed);
  const w = {
    tok_embd: randF(r, VOCAB * D), output_norm: randF(r, D, 1).map((x) => Math.abs(x) + 0.5), output: randF(r, VOCAB * D),
    attn_norm: randF(r, D, 1).map((x) => Math.abs(x) + 0.5), ffn_norm: randF(r, D, 1).map((x) => Math.abs(x) + 0.5),
    wq: randF(r, QD * D), bq: randF(r, QD), wk: randF(r, KV * D), bk: randF(r, KV), wv: randF(r, KV * D), bv: randF(r, KV),
    wo: randF(r, D * QD),
    gate_inp: randF(r, E * D), gate_exps: randF(r, E * FF * D), up_exps: randF(r, E * FF * D), down_exps: randF(r, E * D * FF),
  };
  if (shared) Object.assign(w, { gate_inp_shexp: randF(r, D), gate_shexp: randF(r, FF * D), up_shexp: randF(r, FF * D), down_shexp: randF(r, D * FF) });
  const meta = {
    "general.architecture": arch, [`${arch}.block_count`]: NL, [`${arch}.embedding_length`]: D,
    [`${arch}.attention.head_count`]: NH, [`${arch}.attention.head_count_kv`]: NHKV, [`${arch}.attention.key_length`]: HD,
    [`${arch}.feed_forward_length`]: FF, [`${arch}.expert_count`]: E, [`${arch}.expert_used_count`]: USED,
    [`${arch}.expert_feed_forward_length`]: FF, [`${arch}.rope.freq_base`]: FREQ, [`${arch}.attention.layer_norm_rms_epsilon`]: EPS,
  };
  const T = [
    ["token_embd.weight", [D, VOCAB], w.tok_embd], ["output_norm.weight", [D], w.output_norm], ["output.weight", [D, VOCAB], w.output],
    ["blk.0.attn_norm.weight", [D], w.attn_norm], ["blk.0.attn_q.weight", [D, QD], w.wq], ["blk.0.attn_k.weight", [D, KV], w.wk],
    ["blk.0.attn_v.weight", [D, KV], w.wv], ["blk.0.attn_output.weight", [QD, D], w.wo], ["blk.0.ffn_norm.weight", [D], w.ffn_norm],
    ["blk.0.ffn_gate_inp.weight", [D, E], w.gate_inp],
    ["blk.0.ffn_gate_exps.weight", [D, FF, E], w.gate_exps], ["blk.0.ffn_up_exps.weight", [D, FF, E], w.up_exps], ["blk.0.ffn_down_exps.weight", [FF, D, E], w.down_exps],
  ];
  if (shared) T.push(["blk.0.ffn_gate_inp_shexp.weight", [D, 1], w.gate_inp_shexp], ["blk.0.ffn_gate_shexp.weight", [D, FF], w.gate_shexp],
    ["blk.0.ffn_up_shexp.weight", [D, FF], w.up_shexp], ["blk.0.ffn_down_shexp.weight", [FF, D], w.down_shexp]);
  const gguf = buildGguf(meta, T.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32bytes(arr) })));
  return { w, gguf, cfg: { arch, shared, normW } };
}

function referenceForward(w, cfg, tokens) {
  const H = tokens.map((tk) => Array.from(w.tok_embd.slice(tk * D, tk * D + D)));
  const Kc = [], Vc = [];
  for (let pos = 0; pos < tokens.length; pos++) {
    const x = H[pos], xn = rmsRef(x, w.attn_norm);
    // these synthetic MoE models carry no attention bias (Mixtral has none), so the
    // graph omits it and the executor adds none — the reference must match.
    let q = Array.from(matvecRef(w.wq, xn, D, QD));
    let k = Array.from(matvecRef(w.wk, xn, D, KV));
    const v = Array.from(matvecRef(w.wv, xn, D, KV));
    q = Array.from(ropeRef(q, pos, HD)); k = Array.from(ropeRef(k, pos, HD));
    Kc.push(k); Vc.push(v);
    const grp = NH / NHKV, scale = 1 / Math.sqrt(HD), ctx = new Array(QD).fill(0);
    for (let hh = 0; hh < NH; hh++) {
      const kvh = Math.floor(hh / grp), sc = [];
      for (let tp = 0; tp <= pos; tp++) { let s = 0; for (let d = 0; d < HD; d++) s += q[hh * HD + d] * Kc[tp][kvh * HD + d]; sc.push(s * scale); }
      const mx = Math.max(...sc); let z = 0; const e = sc.map((s) => { const ex = Math.exp(s - mx); z += ex; return ex; });
      for (let d = 0; d < HD; d++) { let acc = 0; for (let tp = 0; tp <= pos; tp++) acc += (e[tp] / z) * Vc[tp][kvh * HD + d]; ctx[hh * HD + d] = acc; }
    }
    const ffnInp = addV(x, Array.from(matvecRef(w.wo, ctx, QD, D)));
    const xn2 = rmsRef(ffnInp, w.ffn_norm);
    // MoE router
    const logits = Array.from(matvecRef(w.gate_inp, xn2, D, E));
    const probs = softmaxRef(logits);
    const idx = Array.from({ length: E }, (_, i) => i).sort((a, b) => (probs[a] > probs[b] ? -1 : probs[a] < probs[b] ? 1 : a - b)).slice(0, USED);
    let weights = idx.map((e2) => probs[e2]);
    if (cfg.normW) { let sm = weights.reduce((a, b) => a + b, 0); sm = Math.max(sm, 6.103515625e-5); weights = weights.map((w2) => w2 / sm); }
    const out = new Array(D).fill(0);
    idx.forEach((e2, i) => {
      const g = matvecRef(w.gate_exps, xn2, D, FF, e2 * FF * D), u = matvecRef(w.up_exps, xn2, D, FF, e2 * FF * D);
      const act = Array.from({ length: FF }, (_, j) => siluRef(g[j]) * u[j]);
      const dn = matvecRef(w.down_exps, act, FF, D, e2 * D * FF);
      for (let j = 0; j < D; j++) out[j] += dn[j] * weights[i];
    });
    if (cfg.shared) {
      const gate = sigmoidRef(matvecRef(w.gate_inp_shexp, xn2, D, 1)[0]);
      const g = matvecRef(w.gate_shexp, xn2, D, FF), u = matvecRef(w.up_shexp, xn2, D, FF);
      const act = Array.from({ length: FF }, (_, j) => siluRef(g[j]) * u[j]);
      const dn = matvecRef(w.down_shexp, act, FF, D);
      for (let j = 0; j < D; j++) out[j] += dn[j] * gate;
    }
    H[pos] = addV(ffnInp, out);
  }
  const fn = rmsRef(H[tokens.length - 1], w.output_norm);
  return Array.from(matvecRef(w.output, fn, D, VOCAB));
}

const tokens = [3, 1, 4];
for (const cfg of [
  { arch: "llama", shared: false, normW: true, label: "Mixtral (no shared, norm_w=true)" },
  { arch: "qwen2moe", shared: true, normW: false, label: "Qwen2-MoE (shared, norm_w=false)" },
]) {
  const { w, gguf } = makeModel(7 + cfg.arch.length, cfg);
  const f = forgeGguf(gguf);
  const graph = synthesizeGraph(f.plan);
  const store = { get: (hex) => f.blocks.get(hex) };

  t(`${cfg.label}: graph family=moe`, () => {
    assert.strictEqual(graph.family, "moe", graph.reason);
    assert.strictEqual(graph.stats.normW, cfg.normW);
    assert.strictEqual(graph.stats.sharedExpert, cfg.shared);
  });

  t(`${cfg.label}: executor logits match independent f64 MoE reference`, () => {
    const got = forward(f.plan, graph, store, tokens);
    const ref = referenceForward(w, cfg, tokens);
    assert.strictEqual(got.length, VOCAB);
    for (let i = 0; i < VOCAB; i++) {
      const rel = Math.abs(got[i] - ref[i]) / (Math.abs(ref[i]) + 1e-4);
      assert.ok(rel < 5e-3, `logit ${i}: got ${got[i]} ref ${ref[i]} rel ${rel}`);
    }
    const am = (a) => a.indexOf(Math.max(...a));
    assert.strictEqual(am(Array.from(got)), am(ref), "argmax matches");
    console.log(`      ${cfg.label}: argmax ${am(Array.from(got))}, logits [${Array.from(got).map((x) => x.toFixed(3)).join(", ")}]`);
  });
}

t("executor is deterministic on MoE", () => {
  const { w, gguf } = makeModel(99, { arch: "llama", shared: false, normW: true });
  const f = forgeGguf(gguf); const graph = synthesizeGraph(f.plan); const store = { get: (hex) => f.blocks.get(hex) };
  const a = forward(f.plan, graph, store, tokens), b = forward(f.plan, graph, store, tokens);
  for (let i = 0; i < VOCAB; i++) assert.strictEqual(a[i], b[i]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
