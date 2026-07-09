// DeepSeek-MoE executor witness (S2). Build a deepseek2 layer with MLA attention + a
// DeepSeek MoE FFN (sigmoid gating, exp_probs_b selection bias, weight-norm + scale, and
// an UNGATED shared expert — unlike qwen2moe's sigmoid-gated one), forge → synthesize →
// run, and compare to an independent f64 reference. Also asserts group-topk is gated (a
// loud failure, not a silent miscompute). Pairs with gguf-forge-exec-mla.test.mjs.

import assert from "node:assert";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

const D = 32, NH = 4, HK = 24, ROPE = 8, NOPE = HK - ROPE, HV = 16, KVL = 12, FF = 20, VOCAB = 7, E = 4, USED = 2, EPS = 1e-6, FREQ = 10000, WSCALE = 2.5;
const QD = NH * HK, KVB = NH * (NOPE + HV), WOIN = NH * HV;
function prng(s) { s >>>= 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const rf = (r, n, sc = 0.3) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * sc; return a; };
const pos = (r, n) => rf(r, n).map((x) => Math.abs(x) + 0.5);
const f32b = (a) => new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));

function buildGguf(meta, tensors) {
  const ALIGN = 32; let off = 0;
  const infos = tensors.map((tn) => { const o = off; off = Math.ceil((o + tn.bytes.length) / ALIGN) * ALIGN; return { ...tn, offset: o }; });
  let parts = [], len = 0; const push = (b) => { parts.push(b); len += b.length; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); push(b); };
  const f32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); push(b); };
  const u64 = (v) => { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, v >>> 0, true); dv.setUint32(4, Math.floor(v / 4294967296), true); push(b); };
  const str = (s) => { const e = new TextEncoder().encode(s); u64(e.length); push(e); };
  push(new TextEncoder().encode("GGUF")); u32(3); u64(tensors.length); u64(Object.keys(meta).length);
  for (const [k, val] of Object.entries(meta)) { str(k); if (typeof val === "string") { u32(8); str(val); } else if (typeof val === "boolean") { u32(7); push(new Uint8Array([val ? 1 : 0])); } else if (Number.isInteger(val) && val >= 0 && val < 4294967296) { u32(4); u32(val); } else { u32(6); f32(val); } }
  for (const ti of infos) { str(ti.name); u32(ti.dims.length); for (const d of ti.dims) u64(d); u32(ti.type); u64(ti.offset); }
  if (len % ALIGN) push(new Uint8Array(ALIGN - (len % ALIGN)));
  const dataStart = len;
  for (const ti of infos) { while (len < dataStart + ti.offset) push(new Uint8Array(1)); push(ti.bytes); }
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}

function makeModel(seed, { groupCount = 0, gating = "sigmoid", qLora = 0 } = {}) {
  const r = prng(seed);
  const w = {
    tok_embd: rf(r, VOCAB * D), output_norm: pos(r, D), output: rf(r, VOCAB * D),
    attn_norm: pos(r, D), q: rf(r, QD * D), kv_a_mqa: rf(r, (KVL + ROPE) * D), kv_a_norm: pos(r, KVL), kv_b: rf(r, KVB * KVL), wo: rf(r, D * WOIN),
    ffn_norm: pos(r, D), gate_inp: rf(r, E * D), gate_exps: rf(r, E * FF * D), up_exps: rf(r, E * FF * D), down_exps: rf(r, E * D * FF),
    exp_probs_b: rf(r, E, 0.2), gate_shexp: rf(r, FF * D), up_shexp: rf(r, FF * D), down_shexp: rf(r, D * FF),
  };
  // non-lite MLA (GLM-5.2 / DeepSeek-V2 full): Q is low-rank wq_a→q_a_norm→wq_b. Allocate
  // AFTER the lite weights so the prng sequence (and the lite tests) is unchanged.
  if (qLora > 0) { w.q_a = rf(r, qLora * D); w.q_a_norm = pos(r, qLora); w.q_b = rf(r, QD * qLora); }
  const meta = {
    "general.architecture": "deepseek2", "deepseek2.block_count": 1, "deepseek2.embedding_length": D,
    "deepseek2.attention.head_count": NH, "deepseek2.attention.key_length": HK, "deepseek2.attention.value_length": HV,
    "deepseek2.rope.dimension_count": ROPE, "deepseek2.attention.kv_lora_rank": KVL,
    "deepseek2.leading_dense_block_count": 0, "deepseek2.expert_count": E, "deepseek2.expert_used_count": USED, "deepseek2.attention.q_lora_rank": qLora,
    "deepseek2.expert_shared_count": 1, "deepseek2.expert_gating_func": gating === "sigmoid" ? 2 : 1, "deepseek2.expert_weights_norm": true,
    "deepseek2.expert_weights_scale": WSCALE, "deepseek2.expert_group_count": groupCount,
    "deepseek2.rope.freq_base": FREQ, "deepseek2.attention.layer_norm_rms_epsilon": EPS,
  };
  const p = "blk.0.";
  const T = [
    ["token_embd.weight", [D, VOCAB], w.tok_embd], ["output_norm.weight", [D], w.output_norm], ["output.weight", [D, VOCAB], w.output],
    [p + "attn_norm.weight", [D], w.attn_norm],
    ...(qLora > 0
      ? [[p + "attn_q_a.weight", [D, qLora], w.q_a], [p + "attn_q_a_norm.weight", [qLora], w.q_a_norm], [p + "attn_q_b.weight", [qLora, QD], w.q_b]]
      : [[p + "attn_q.weight", [D, QD], w.q]]),
    [p + "attn_kv_a_mqa.weight", [D, KVL + ROPE], w.kv_a_mqa], [p + "attn_kv_a_norm.weight", [KVL], w.kv_a_norm],
    [p + "attn_kv_b.weight", [KVL, KVB], w.kv_b], [p + "attn_output.weight", [WOIN, D], w.wo], [p + "ffn_norm.weight", [D], w.ffn_norm],
    [p + "ffn_gate_inp.weight", [D, E], w.gate_inp], [p + "ffn_gate_exps.weight", [D, FF, E], w.gate_exps], [p + "ffn_up_exps.weight", [D, FF, E], w.up_exps], [p + "ffn_down_exps.weight", [FF, D, E], w.down_exps],
    [p + "exp_probs_b", [E], w.exp_probs_b], [p + "ffn_gate_shexp.weight", [D, FF], w.gate_shexp], [p + "ffn_up_shexp.weight", [D, FF], w.up_shexp], [p + "ffn_down_shexp.weight", [FF, D], w.down_shexp],
  ];
  return { w, gating, qLora, gguf: buildGguf(meta, T.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32b(arr) }))) };
}

// ── f64 reference (MLA + DeepSeek MoE) ──
const mv = (W, x, K, N, base = 0) => { const y = new Float64Array(N); for (let n = 0; n < N; n++) { let s = 0; for (let k = 0; k < K; k++) s += W[base + n * K + k] * x[k]; y[n] = s; } return y; };
const rms = (x, wt) => { let s = 0; for (const v of x) s += v * v; const sc = 1 / Math.sqrt(s / x.length + EPS); return x.map((v, i) => v * sc * wt[i]); };
const silu = (v) => v / (1 + Math.exp(-v));
const sig = (v) => 1 / (1 + Math.exp(-v));
// deepseek2 uses NORM rope (consecutive pairs 2k,2k+1), not NEOX.
function ropeRef(vec, p, hd) { const half = hd / 2, nH = vec.length / hd, o = Float64Array.from(vec); for (let h = 0; h < nH; h++) for (let k = 0; k < half; k++) { const th = p * Math.pow(FREQ, -2 * k / hd); const c = Math.cos(th), sn = Math.sin(th), b = h * hd, x0 = vec[b + 2 * k], x1 = vec[b + 2 * k + 1]; o[b + 2 * k] = x0 * c - x1 * sn; o[b + 2 * k + 1] = x0 * sn + x1 * c; } return o; }
function topk(arr, k) { return [...arr.keys()].sort((a, b) => arr[b] - arr[a] || a - b).slice(0, k); }

function refLogits(model, ids) {
  const { w } = model, T = ids.length, Kc = [], Vc = [], kq = 1 / Math.sqrt(HK), QL = model.qLora || 0;
  let last = null;
  for (let t0 = 0; t0 < T; t0++) {
    let h = Float64Array.from(w.tok_embd.subarray(ids[t0] * D, ids[t0] * D + D));
    const an = rms(h, w.attn_norm);
    const q = QL > 0 ? mv(w.q_b, rms(mv(w.q_a, an, D, QL), w.q_a_norm), QL, QD) : mv(w.q, an, D, QD);
    const kvc = mv(w.kv_a_mqa, an, D, KVL + ROPE);
    const kvCmpr = rms(kvc.slice(0, KVL), w.kv_a_norm);
    const qPe = new Float64Array(NH * ROPE); for (let hh = 0; hh < NH; hh++) for (let d = 0; d < ROPE; d++) qPe[hh * ROPE + d] = q[hh * HK + NOPE + d];
    const qPeR = ropeRef(qPe, t0, ROPE), kPeR = ropeRef(kvc.slice(KVL, KVL + ROPE), t0, ROPE);
    const kv = mv(w.kv_b, kvCmpr, KVL, KVB), step = NOPE + HV;
    const Q = new Float64Array(NH * HK), K = new Float64Array(NH * HK), V = new Float64Array(NH * HV);
    for (let hh = 0; hh < NH; hh++) { for (let d = 0; d < NOPE; d++) { Q[hh * HK + d] = q[hh * HK + d]; K[hh * HK + d] = kv[hh * step + d]; } for (let d = 0; d < ROPE; d++) { Q[hh * HK + NOPE + d] = qPeR[hh * ROPE + d]; K[hh * HK + NOPE + d] = kPeR[d]; } for (let d = 0; d < HV; d++) V[hh * HV + d] = kv[hh * step + NOPE + d]; }
    Kc.push(K); Vc.push(V);
    const ctx = new Float64Array(NH * HV);
    for (let hh = 0; hh < NH; hh++) {
      const sc = new Float64Array(t0 + 1); for (let tp = 0; tp <= t0; tp++) { let s = 0; for (let d = 0; d < HK; d++) s += Q[hh * HK + d] * Kc[tp][hh * HK + d]; sc[tp] = s * kq; }
      const mx = Math.max(...sc); let z = 0; const ex = sc.map((v) => { const e = Math.exp(v - mx); z += e; return e; }); const pr = ex.map((e) => e / z);
      for (let d = 0; d < HV; d++) { let acc = 0; for (let tp = 0; tp <= t0; tp++) acc += pr[tp] * Vc[tp][hh * HV + d]; ctx[hh * HV + d] = acc; }
    }
    const h2 = h.map((v, i) => v + mv(w.wo, ctx, WOIN, D)[i]);
    // DeepSeek MoE: sigmoid gating + exp_probs_b selection bias + normW + wScale + UNGATED shared
    const fn = rms(h2, w.ffn_norm);
    const logits = mv(w.gate_inp, fn, D, E);
    const probs = model.gating === "softmax"
      ? (() => { const mx = Math.max(...logits); let z = 0; const e = logits.map((v) => { const x = Math.exp(v - mx); z += x; return x; }); return e.map((x) => x / z); })()
      : logits.map(sig);
    const sel = topk(probs.map((p2, i) => p2 + w.exp_probs_b[i]), USED);
    let wt = sel.map((e) => probs[e]); let s = wt.reduce((a, b) => a + b, 0); const denom = Math.max(s, 6.103515625e-5);
    wt = wt.map((v) => (v / denom) * WSCALE);
    const out = new Float64Array(D);
    sel.forEach((e, i) => { const g = mv(w.gate_exps, fn, D, FF, e * D * FF), u = mv(w.up_exps, fn, D, FF, e * D * FF); const act = g.map((v, j) => silu(v) * u[j]); const dn = mv(w.down_exps, act, FF, D, e * D * FF); for (let j = 0; j < D; j++) out[j] += dn[j] * wt[i]; });
    const sg = mv(w.gate_shexp, fn, D, FF), su = mv(w.up_shexp, fn, D, FF); const sact = sg.map((v, j) => silu(v) * su[j]); const sh = mv(w.down_shexp, sact, FF, D);
    for (let j = 0; j < D; j++) out[j] += sh[j];                     // ungated
    h = h2.map((v, j) => v + out[j]);
    last = h;
  }
  const rn = rms(last, w.output_norm);
  return mv(w.output, rn, D, VOCAB);
}

const argmax = (a) => { let m = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[m]) m = i; return m; };

t("MLA + DeepSeek-MoE forward matches independent f64 reference", () => {
  const model = makeModel(23);
  const ids = [1, 5, 2];
  const f = forgeGguf(model.gguf), g = synthesizeGraph(f.plan);
  assert.strictEqual(g.family, "mla-moe");
  assert.strictEqual(g.stats.gating, "sigmoid");
  assert.ok(g.ops.some((o) => o.op === "ffn_moe" && o.w.exp_probs_b && o.attrs.sharedGate === false), "ffn_moe carries exp_probs_b + ungated shared");
  const logits = forward(f.plan, g, { get: (hex) => f.blocks.get(hex) }, ids);
  const ref = refLogits(model, ids);
  let m = 0; for (let i = 0; i < logits.length; i++) m = Math.max(m, Math.abs(logits[i] - ref[i]));
  assert.ok(m <= 2e-3, `logits diverge from f64 ref: maxabs ${m.toExponential(2)}`);
  assert.strictEqual(argmax(logits), argmax(ref), "greedy argmax matches reference");
});

t("MLA + DeepSeek-MoE (SOFTMAX gating — the DeepSeek-V2-Lite path) matches f64 ref", () => {
  const model = makeModel(31, { gating: "softmax" });
  const ids = [1, 5, 2];
  const f = forgeGguf(model.gguf), g = synthesizeGraph(f.plan);
  assert.strictEqual(g.stats.gating, "softmax");
  const logits = forward(f.plan, g, { get: (hex) => f.blocks.get(hex) }, ids);
  const ref = refLogits(model, ids);
  let m = 0; for (let i = 0; i < logits.length; i++) m = Math.max(m, Math.abs(logits[i] - ref[i]));
  assert.ok(m <= 2e-3, `softmax MoE diverges from f64 ref: maxabs ${m.toExponential(2)}`);
  assert.strictEqual(argmax(logits), argmax(ref), "greedy argmax matches");
});

t("NON-LITE MLA + DeepSeek-MoE (the GLM-5.2 shape: q_lora>0) matches f64 ref", () => {
  // GLM-5.2 is non-lite (q_lora_rank=2048: wq_a→q_a_norm→wq_b) + sigmoid MoE. The lite path
  // is proven on DeepSeek-V2-Lite; this closes the combination GLM-5.2 uniquely needs.
  const model = makeModel(41, { qLora: 10 });
  const ids = [1, 5, 2];
  const f = forgeGguf(model.gguf), g = synthesizeGraph(model.gguf ? f.plan : null);
  assert.strictEqual(g.family, "mla-moe");
  assert.strictEqual(g.stats.lite, false, "non-lite MLA (q_a/q_b path)");
  assert.strictEqual(g.stats.q_lora, 10, "q_lora_rank carried");
  assert.ok(g.ops.some((o) => o.op === "mla_attn" && o.w.q_a && o.w.q_b && o.w.q_a_norm && !o.w.q), "mla_attn uses q_a/q_a_norm/q_b, not direct q");
  const logits = forward(f.plan, g, { get: (hex) => f.blocks.get(hex) }, ids);
  const ref = refLogits(model, ids);
  let m = 0; for (let i = 0; i < logits.length; i++) m = Math.max(m, Math.abs(logits[i] - ref[i]));
  assert.ok(m <= 2e-3, `non-lite MLA+MoE diverges from f64 ref: maxabs ${m.toExponential(2)}`);
  assert.strictEqual(argmax(logits), argmax(ref), "greedy argmax matches");
});

t("group-topk (expert_group_count>1) is gated, not silently miscomputed", () => {
  const model = makeModel(23, { groupCount: 2 });
  const f = forgeGguf(model.gguf), g = synthesizeGraph(f.plan);
  assert.strictEqual(g.stats.groupCount, 2);
  assert.throws(() => forward(f.plan, g, { get: (hex) => f.blocks.get(hex) }, [1, 2]), /group-topk/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
