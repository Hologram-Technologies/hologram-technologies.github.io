// Executor end-to-end test. Build a tiny qwen2 with real random F32 weights, forge
// -> synthesize -> run forward, and compare logits to an INDEPENDENT float64
// reference transformer written from scratch here. Agreement validates the
// executor's graph-walk wiring and op order (kernel internals are unit-tested
// separately). Deterministic-output check included.

import assert from "node:assert";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

// ── tiny dims ──
const D = 8, NH = 2, NHKV = 1, HD = 4, FF = 16, VOCAB = 5, NL = 1, EPS = 1e-6, FREQ = 10000;
const QD = NH * HD, KV = NHKV * HD;

function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const r = prng(2024);
const randF = (n, scale = 0.3) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * scale; return a; };

// weights (Float32Array each), kept for the reference forward
const w = {
  tok_embd: randF(VOCAB * D), output_norm: randF(D, 1).map((x) => Math.abs(x) + 0.5),
  output: randF(VOCAB * D),
  attn_norm: randF(D, 1).map((x) => Math.abs(x) + 0.5), ffn_norm: randF(D, 1).map((x) => Math.abs(x) + 0.5),
  wq: randF(QD * D), bq: randF(QD), wk: randF(KV * D), bk: randF(KV), wv: randF(KV * D), bv: randF(KV),
  wo: randF(D * QD), wgate: randF(FF * D), wup: randF(FF * D), wdown: randF(D * FF),
};

// ── build the GGUF (F32, float-meta writer) ──
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
const meta = {
  "general.architecture": "qwen2", "qwen2.block_count": NL, "qwen2.embedding_length": D,
  "qwen2.attention.head_count": NH, "qwen2.attention.head_count_kv": NHKV, "qwen2.attention.key_length": HD,
  "qwen2.feed_forward_length": FF, "qwen2.rope.freq_base": FREQ, "qwen2.attention.layer_norm_rms_epsilon": EPS,
};
const tensors = [
  ["token_embd.weight", [D, VOCAB], w.tok_embd], ["output_norm.weight", [D], w.output_norm], ["output.weight", [D, VOCAB], w.output],
  ["blk.0.attn_norm.weight", [D], w.attn_norm], ["blk.0.attn_q.weight", [D, QD], w.wq], ["blk.0.attn_q.bias", [QD], w.bq],
  ["blk.0.attn_k.weight", [D, KV], w.wk], ["blk.0.attn_k.bias", [KV], w.bk], ["blk.0.attn_v.weight", [D, KV], w.wv], ["blk.0.attn_v.bias", [KV], w.bv],
  ["blk.0.attn_output.weight", [QD, D], w.wo], ["blk.0.ffn_norm.weight", [D], w.ffn_norm],
  ["blk.0.ffn_gate.weight", [D, FF], w.wgate], ["blk.0.ffn_up.weight", [D, FF], w.wup], ["blk.0.ffn_down.weight", [FF, D], w.wdown],
].map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32bytes(arr) }));

// ── independent float64 reference forward ──
function matvecRef(W, x, K, N) { const y = new Float64Array(N); for (let n = 0; n < N; n++) { let s = 0; for (let k = 0; k < K; k++) s += W[n * K + k] * x[k]; y[n] = s; } return y; }
function rmsRef(x, wt) { let s = 0; for (const v of x) s += v * v; const sc = 1 / Math.sqrt(s / x.length + EPS); return x.map((v, i) => v * sc * wt[i]); }
const siluRef = (v) => v / (1 + Math.exp(-v));
function ropeRef(vec, pos, headDim) { const half = headDim / 2, nHeads = vec.length / headDim, out = Float64Array.from(vec); for (let hh = 0; hh < nHeads; hh++) { for (let ic = 0; ic < half; ic++) { const th = pos * Math.pow(FREQ, -2 * ic / headDim); const c = Math.cos(th), sn = Math.sin(th); const o = hh * headDim; const x0 = vec[o + ic], x1 = vec[o + ic + half]; out[o + ic] = x0 * c - x1 * sn; out[o + ic + half] = x0 * sn + x1 * c; } } return out; }
const addV = (a, b) => a.map((x, i) => x + b[i]);

function referenceForward(tokens) {
  const H = tokens.map((tk) => Array.from(w.tok_embd.slice(tk * D, tk * D + D)));
  const Kc = [], Vc = [];
  for (let pos = 0; pos < tokens.length; pos++) {
    const x = H[pos];
    const xn = rmsRef(x, w.attn_norm);
    let q = addV(Array.from(matvecRef(w.wq, xn, D, QD)), Array.from(w.bq));
    let k = addV(Array.from(matvecRef(w.wk, xn, D, KV)), Array.from(w.bk));
    const v = addV(Array.from(matvecRef(w.wv, xn, D, KV)), Array.from(w.bv));
    q = Array.from(ropeRef(q, pos, HD)); k = Array.from(ropeRef(k, pos, HD));
    Kc.push(k); Vc.push(v);
    const grp = NH / NHKV, scale = 1 / Math.sqrt(HD), ctx = new Array(QD).fill(0);
    for (let hh = 0; hh < NH; hh++) {
      const kvh = Math.floor(hh / grp), sc = [];
      for (let tp = 0; tp <= pos; tp++) { let s = 0; for (let d = 0; d < HD; d++) s += q[hh * HD + d] * Kc[tp][kvh * HD + d]; sc.push(s * scale); }
      const mx = Math.max(...sc); let z = 0; const e = sc.map((s) => { const ex = Math.exp(s - mx); z += ex; return ex; });
      for (let d = 0; d < HD; d++) { let acc = 0; for (let tp = 0; tp <= pos; tp++) acc += (e[tp] / z) * Vc[tp][kvh * HD + d]; ctx[hh * HD + d] = acc; }
    }
    const attnOut = Array.from(matvecRef(w.wo, ctx, QD, D));
    const ffnInp = addV(x, attnOut);
    const xn2 = rmsRef(ffnInp, w.ffn_norm);
    const g = matvecRef(w.wgate, xn2, D, FF), u = matvecRef(w.wup, xn2, D, FF);
    const s = Array.from({ length: FF }, (_, i) => siluRef(g[i]) * u[i]);
    const ffnOut = Array.from(matvecRef(w.wdown, s, FF, D));
    H[pos] = addV(ffnInp, ffnOut);
  }
  const fn = rmsRef(H[tokens.length - 1], w.output_norm);
  return Array.from(matvecRef(w.output, fn, D, VOCAB));
}

const gguf = buildGguf(meta, tensors);
const f = forgeGguf(gguf);
const graph = synthesizeGraph(f.plan);
const store = { get: (hex) => f.blocks.get(hex) };
const tokens = [3, 1, 4];

t("graph is dense and complete for tiny qwen2", () => {
  assert.strictEqual(graph.family, "dense", graph.reason);
  assert.strictEqual(graph.stats.n_layer, 1);
});

t("executor logits match independent f64 reference", () => {
  const got = forward(f.plan, graph, store, tokens);
  const ref = referenceForward(tokens);
  assert.strictEqual(got.length, VOCAB);
  for (let i = 0; i < VOCAB; i++) {
    const rel = Math.abs(got[i] - ref[i]) / (Math.abs(ref[i]) + 1e-4);
    assert.ok(rel < 5e-3, `logit ${i}: got ${got[i]} ref ${ref[i]} rel ${rel}`);
  }
  console.log(`      logits: [${Array.from(got).map((x) => x.toFixed(4)).join(", ")}]`);
});

t("argmax (greedy token) matches reference", () => {
  const got = forward(f.plan, graph, store, tokens), ref = referenceForward(tokens);
  const am = (a) => a.indexOf(Math.max(...a));
  assert.strictEqual(am(Array.from(got)), am(ref));
});

t("executor is deterministic", () => {
  const a = forward(f.plan, graph, store, tokens), b = forward(f.plan, graph, store, tokens);
  for (let i = 0; i < VOCAB; i++) assert.strictEqual(a[i], b[i]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
