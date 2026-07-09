// MLA executor witness (S1). Build a tiny deepseek2-lite (MLA attention + dense SwiGLU
// FFN, expert_count=0), forge → synthesize → run a multi-token prefill, and compare the
// last-position logits to an INDEPENDENT float64 reference written from scratch here that
// re-implements the deepseek2.cpp decompression/MHA-equivalent path (low-rank Q+KV,
// decoupled NEOX RoPE on the pe split, wkv_b decompress, cached MHA). Internal-correctness
// (executor == spec), the same bar gguf-forge-exec-moe.test.mjs uses for MoE.

import assert from "node:assert";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

// dims: n_embd D, heads NH, key head HK = NOPE+ROPE, value head HV, kv-lora KVL, q-lora QL
const D = 32, NH = 4, HK = 24, ROPE = 8, NOPE = HK - ROPE, HV = 16, KVL = 12, FF = 20, VOCAB = 7, NL = 2, EPS = 1e-6, FREQ = 10000;
const QD = NH * HK, KVB = NH * (NOPE + HV), WOIN = NH * HV;
function prng(s) { s >>>= 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const randF = (r, n, sc = 0.3) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * sc; return a; };
const f32bytes = (a) => new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));

function buildGguf(meta, tensors) {
  const ALIGN = 32; let off = 0;
  const infos = tensors.map((tn) => { const o = off; off = Math.ceil((o + tn.bytes.length) / ALIGN) * ALIGN; return { ...tn, offset: o }; });
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

function makeModel(seed, lite) {
  const r = prng(seed);
  const L = (suf, n) => { const o = {}; for (let il = 0; il < NL; il++) o[il] = randF(r, n); return o; };
  const w = {
    tok_embd: randF(r, VOCAB * D), output_norm: randF(r, D).map((x) => Math.abs(x) + 0.5), output: randF(r, VOCAB * D),
    attn_norm: L("", D), ffn_norm: L("", D), q: L("", QD * D), q_a: L("", (D * 8)), q_a_norm: L("", 8), q_b: L("", QD * 8),
    kv_a_mqa: L("", (KVL + ROPE) * D), kv_a_norm: L("", KVL), kv_b: L("", KVB * KVL), wo: L("", D * WOIN),
    ffn_gate: L("", FF * D), ffn_up: L("", FF * D), ffn_down: L("", D * FF),
  };
  for (let il = 0; il < NL; il++) { w.attn_norm[il] = w.attn_norm[il].map((x) => Math.abs(x) + 0.5); w.ffn_norm[il] = w.ffn_norm[il].map((x) => Math.abs(x) + 0.5); w.kv_a_norm[il] = w.kv_a_norm[il].map((x) => Math.abs(x) + 0.5); w.q_a_norm[il] = w.q_a_norm[il].map((x) => Math.abs(x) + 0.5); }
  const QL = lite ? 0 : 8;
  const meta = {
    "general.architecture": "deepseek2", "deepseek2.block_count": NL, "deepseek2.embedding_length": D,
    "deepseek2.attention.head_count": NH, "deepseek2.attention.key_length": HK, "deepseek2.attention.value_length": HV,
    "deepseek2.rope.dimension_count": ROPE, "deepseek2.attention.kv_lora_rank": KVL, "deepseek2.attention.q_lora_rank": QL,
    "deepseek2.leading_dense_block_count": NL, "deepseek2.expert_count": 0,
    "deepseek2.rope.freq_base": FREQ, "deepseek2.attention.layer_norm_rms_epsilon": EPS,
  };
  const T = [["token_embd.weight", [D, VOCAB], w.tok_embd], ["output_norm.weight", [D], w.output_norm], ["output.weight", [D, VOCAB], w.output]];
  for (let il = 0; il < NL; il++) {
    const p = `blk.${il}.`;
    T.push([p + "attn_norm.weight", [D], w.attn_norm[il]]);
    if (lite) T.push([p + "attn_q.weight", [D, QD], w.q[il]]);
    else T.push([p + "attn_q_a.weight", [D, 8], w.q_a[il]], [p + "attn_q_a_norm.weight", [8], w.q_a_norm[il]], [p + "attn_q_b.weight", [8, QD], w.q_b[il]]);
    T.push([p + "attn_kv_a_mqa.weight", [D, KVL + ROPE], w.kv_a_mqa[il]], [p + "attn_kv_a_norm.weight", [KVL], w.kv_a_norm[il]],
      [p + "attn_kv_b.weight", [KVL, KVB], w.kv_b[il]], [p + "attn_output.weight", [WOIN, D], w.wo[il]], [p + "ffn_norm.weight", [D], w.ffn_norm[il]],
      [p + "ffn_gate.weight", [D, FF], w.ffn_gate[il]], [p + "ffn_up.weight", [D, FF], w.ffn_up[il]], [p + "ffn_down.weight", [FF, D], w.ffn_down[il]]);
  }
  return { w, lite, QL, gguf: buildGguf(meta, T.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32bytes(arr) }))) };
}

// ── f64 reference ──
const mv = (W, x, K, N) => { const y = new Float64Array(N); for (let n = 0; n < N; n++) { let s = 0; for (let k = 0; k < K; k++) s += W[n * K + k] * x[k]; y[n] = s; } return y; };
const rms = (x, wt) => { let s = 0; for (const v of x) s += v * v; const sc = 1 / Math.sqrt(s / x.length + EPS); return x.map((v, i) => v * sc * wt[i]); };
const silu = (v) => v / (1 + Math.exp(-v));
// deepseek2 uses NORM rope (consecutive pairs 2k,2k+1), not NEOX.
function ropeNeoxRef(vec, pos, headDim) { const half = headDim / 2, nH = vec.length / headDim, out = Float64Array.from(vec); for (let h = 0; h < nH; h++) for (let k = 0; k < half; k++) { const th = pos * Math.pow(FREQ, -2 * k / headDim); const c = Math.cos(th), sn = Math.sin(th), o = h * headDim, x0 = vec[o + 2 * k], x1 = vec[o + 2 * k + 1]; out[o + 2 * k] = x0 * c - x1 * sn; out[o + 2 * k + 1] = x0 * sn + x1 * c; } return out; }
function softmax(a, scale) { const z = a.map((v) => v * scale); const mx = Math.max(...z); let s = 0; const e = z.map((v) => { const x = Math.exp(v - mx); s += x; return x; }); return e.map((x) => x / s); }

function refLogits(model, ids) {
  const { w, lite } = model, T = ids.length;
  const Kc = Array.from({ length: NL }, () => []), Vc = Array.from({ length: NL }, () => []);
  const kqScale = 1 / Math.sqrt(HK);
  let last = null;
  for (let t0 = 0; t0 < T; t0++) {
    let h = Float64Array.from(w.tok_embd.subarray(ids[t0] * D, ids[t0] * D + D));
    for (let il = 0; il < NL; il++) {
      const an = rms(h, w.attn_norm[il]);
      let q;
      if (lite) q = mv(w.q[il], an, D, QD);
      else { const qa = rms(mv(w.q_a[il], an, D, 8), w.q_a_norm[il]); q = mv(w.q_b[il], qa, 8, QD); }
      const kvc = mv(w.kv_a_mqa[il], an, D, KVL + ROPE);
      const kvCmpr = rms(kvc.slice(0, KVL), w.kv_a_norm[il]);
      const qPe = new Float64Array(NH * ROPE); for (let hh = 0; hh < NH; hh++) for (let d = 0; d < ROPE; d++) qPe[hh * ROPE + d] = q[hh * HK + NOPE + d];
      const qPeR = ropeNeoxRef(qPe, t0, ROPE), kPeR = ropeNeoxRef(kvc.slice(KVL, KVL + ROPE), t0, ROPE);
      const kv = mv(w.kv_b[il], kvCmpr, KVL, KVB), step = NOPE + HV;
      const Q = new Float64Array(NH * HK), K = new Float64Array(NH * HK), V = new Float64Array(NH * HV);
      for (let hh = 0; hh < NH; hh++) { for (let d = 0; d < NOPE; d++) { Q[hh * HK + d] = q[hh * HK + d]; K[hh * HK + d] = kv[hh * step + d]; } for (let d = 0; d < ROPE; d++) { Q[hh * HK + NOPE + d] = qPeR[hh * ROPE + d]; K[hh * HK + NOPE + d] = kPeR[d]; } for (let d = 0; d < HV; d++) V[hh * HV + d] = kv[hh * step + NOPE + d]; }
      Kc[il].push(K); Vc[il].push(V);
      const ctx = new Float64Array(NH * HV);
      for (let hh = 0; hh < NH; hh++) {
        const sc = new Float64Array(t0 + 1);
        for (let tp = 0; tp <= t0; tp++) { let s = 0; for (let d = 0; d < HK; d++) s += Q[hh * HK + d] * Kc[il][tp][hh * HK + d]; sc[tp] = s; }
        const pr = softmax(sc, kqScale);
        for (let d = 0; d < HV; d++) { let acc = 0; for (let tp = 0; tp <= t0; tp++) acc += pr[tp] * Vc[il][tp][hh * HV + d]; ctx[hh * HV + d] = acc; }
      }
      const ao = mv(w.wo[il], ctx, WOIN, D);
      const h2 = h.map((v, i) => v + ao[i]);
      const fn = rms(h2, w.ffn_norm[il]);
      const g = mv(w.ffn_gate[il], fn, D, FF), u = mv(w.ffn_up[il], fn, D, FF);
      const act = g.map((v, i) => silu(v) * u[i]);
      const down = mv(w.ffn_down[il], act, FF, D);
      h = h2.map((v, i) => v + down[i]);
    }
    last = h;
  }
  const rn = rms(last, w.output_norm);
  return mv(w.output, rn, D, VOCAB);
}

function runExec(model, ids) {
  const f = forgeGguf(model.gguf), g = synthesizeGraph(f.plan);
  return { g, logits: forward(f.plan, g, { get: (hex) => f.blocks.get(hex) }, ids) };
}
const close = (a, b, tol = 2e-3) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m <= tol ? null : `maxabs ${m.toExponential(2)}`; };
const argmax = (a) => { let m = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[m]) m = i; return m; };

for (const lite of [true, false]) {
  t(`MLA forward (${lite ? "lite wq" : "LoRA q_a→q_b"}) matches independent f64 reference`, () => {
    const model = makeModel(11, lite);
    const ids = [1, 4, 2];
    const { g, logits } = runExec(model, ids);
    assert.strictEqual(g.family, "mla-moe", `got ${g.family}`);
    assert.strictEqual(g.stats.lite, lite);
    assert.ok(g.ops.some((o) => o.op === "mla_attn"), "graph emits mla_attn");
    const ref = refLogits(model, ids);
    const bad = close(logits, ref);
    assert.ok(!bad, `logits diverge from f64 ref: ${bad}`);
    assert.strictEqual(argmax(logits), argmax(ref), "greedy argmax matches reference");
  });
}

t("unsupported rope scaling is gated (loud refuse, not mis-rotated)", () => {
  const model = makeModel(11, true);
  const f = forgeGguf(model.gguf);
  f.plan.meta["deepseek2.rope.scaling.type"] = "longrope";          // not implemented → must refuse
  const g = synthesizeGraph(f.plan);
  assert.throws(() => forward(f.plan, g, { get: (hex) => f.blocks.get(hex) }, [1, 2]), /not supported/);
});

t("YaRN rope runs (finite logits) and changes the result vs plain NEOX", () => {
  const model = makeModel(11, true), ids = [1, 4, 2];
  const base = runExec(model, ids).logits;
  const f = forgeGguf(model.gguf);
  Object.assign(f.plan.meta, {
    "deepseek2.rope.scaling.type": "yarn", "deepseek2.rope.scaling.factor": 40,
    "deepseek2.rope.scaling.original_context_length": 4096, "deepseek2.rope.scaling.yarn_log_multiplier": 0.0707,
  });
  const yl = forward(f.plan, synthesizeGraph(f.plan), { get: (hex) => f.blocks.get(hex) }, ids);
  assert.ok(yl.every(Number.isFinite), "yarn logits finite");
  let diff = 0; for (let i = 0; i < yl.length; i++) diff = Math.max(diff, Math.abs(yl[i] - base[i]));
  assert.ok(diff > 1e-4, "yarn changes the result vs plain NEOX");
});

t("MLA executor is deterministic", () => {
  const model = makeModel(5, true), ids = [3, 1, 0, 2];
  const a = runExec(model, ids).logits, b = runExec(model, ids).logits;
  for (let i = 0; i < a.length; i++) assert.strictEqual(a[i], b[i], `logit ${i}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
