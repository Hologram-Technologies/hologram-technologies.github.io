// BitNet (b1.58) end-to-end test. Build a tiny bitnet with random F32 weights AND
// per-linear ternary weight-scales, forge → synthesize → run forward, and compare
// logits to an INDEPENDENT float64 reference that reproduces src/models/bitnet.cpp:
// dense attention (NEOX RoPE, GQA) + attn_sub_norm (RMS on the attention output
// before wo) + SwiGLU FFN + ffn_sub_norm (RMS on the activation before ffn_down) +
// scalar weight-scales on every quantized linear + tied lm_head. Plus a structural
// check against a real bitnet header when present.

import assert from "node:assert";
import { existsSync, openSync, readSync, closeSync } from "node:fs";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";
import { parseGgufHeader } from "../qvac-ingest.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

// HD = D/NH so the attention output is length n_embd (what attn_sub_norm normalizes).
const D = 8, NH = 2, NHKV = 1, HD = 4, FF = 16, VOCAB = 5, NL = 2, EPS = 1e-5, FREQ = 1000000;
const QD = NH * HD, KV = NHKV * HD, ASCALE = 1 / Math.sqrt(HD);

function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const r = prng(11);
const randF = (n, scale = 0.3) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * scale; return a; };
const normW = (n) => randF(n, 1).map((x) => Math.abs(x) + 0.5);
const scal = (v) => Float32Array.from([v]); // {1} ternary weight-scale

const L = [];
for (let il = 0; il < NL; il++) L.push({
  attn_norm: normW(D), attn_sub: normW(D), ffn_norm: normW(D), ffn_sub: normW(FF),
  wq: randF(QD * D), wk: randF(KV * D), wv: randF(KV * D), wo: randF(D * QD),
  wgate: randF(FF * D), wup: randF(FF * D), wdown: randF(D * FF),
  // scalar ternary scales (exercise the build_lora_mm scale path)
  sq: 0.7 + 0.1 * il, sk: 0.6, sv: 1.3, so: 0.9, sg: 1.1, su: 0.8, sd: 1.2,
});
const w = { tok_embd: randF(VOCAB * D), output_norm: normW(D) };

function buildGguf(meta, tensors) {
  const ALIGN = 32; let off = 0;
  const infos = tensors.map((x) => { const o = off; off = Math.ceil((o + x.bytes.length) / ALIGN) * ALIGN; return { ...x, offset: o }; });
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
const f32b = (arr) => new Uint8Array(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength));

const meta = {
  "general.architecture": "bitnet", "bitnet.block_count": NL, "bitnet.embedding_length": D,
  "bitnet.attention.head_count": NH, "bitnet.attention.head_count_kv": NHKV,
  "bitnet.feed_forward_length": FF, "bitnet.rope.dimension_count": HD, "bitnet.rope.freq_base": FREQ,
  "bitnet.attention.layer_norm_rms_epsilon": EPS,
};
const tensors = [["token_embd.weight", [D, VOCAB], w.tok_embd], ["output_norm.weight", [D], w.output_norm]];
for (let il = 0; il < NL; il++) { const p = `blk.${il}.`, x = L[il]; tensors.push(
  [p + "attn_norm.weight", [D], x.attn_norm], [p + "attn_sub_norm.weight", [D], x.attn_sub],
  [p + "attn_q.weight", [D, QD], x.wq], [p + "attn_q.scale", [1], scal(x.sq)],
  [p + "attn_k.weight", [D, KV], x.wk], [p + "attn_k.scale", [1], scal(x.sk)],
  [p + "attn_v.weight", [D, KV], x.wv], [p + "attn_v.scale", [1], scal(x.sv)],
  [p + "attn_output.weight", [QD, D], x.wo], [p + "attn_output.scale", [1], scal(x.so)],
  [p + "ffn_norm.weight", [D], x.ffn_norm], [p + "ffn_sub_norm.weight", [FF], x.ffn_sub],
  [p + "ffn_gate.weight", [D, FF], x.wgate], [p + "ffn_gate.scale", [1], scal(x.sg)],
  [p + "ffn_up.weight", [D, FF], x.wup], [p + "ffn_up.scale", [1], scal(x.su)],
  [p + "ffn_down.weight", [FF, D], x.wdown], [p + "ffn_down.scale", [1], scal(x.sd)]);
}
const ggufTensors = tensors.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32b(arr) }));

// ── independent float64 reference forward (reproduces bitnet.cpp) ──
const mv = (W, x, K, N) => { const y = new Float64Array(N); for (let n = 0; n < N; n++) { let s = 0; for (let k = 0; k < K; k++) s += W[n * K + k] * x[k]; y[n] = s; } return y; };
const mvs = (W, x, K, N, s) => Array.from(mv(W, x, K, N), (v) => v * s); // scaled linear
const rms = (x, wt) => { let s = 0; for (const v of x) s += v * v; const sc = 1 / Math.sqrt(s / x.length + EPS); return Array.from(x, (v, i) => v * sc * wt[i]); };
const silu = (x) => x / (1 + Math.exp(-x));
const addV = (a, b) => a.map((x, i) => x + b[i]);
function ropeRef(vec, pos) { const half = HD / 2, nH = vec.length / HD, out = Float64Array.from(vec); for (let hh = 0; hh < nH; hh++) for (let ic = 0; ic < half; ic++) { const th = pos * Math.pow(FREQ, -2 * ic / HD), c = Math.cos(th), sn = Math.sin(th), o = hh * HD, x0 = vec[o + ic], x1 = vec[o + ic + half]; out[o + ic] = x0 * c - x1 * sn; out[o + ic + half] = x0 * sn + x1 * c; } return out; }

function referenceForward(tokens) {
  const H = tokens.map((tk) => Array.from(w.tok_embd.slice(tk * D, tk * D + D)));
  const Kc = Array.from({ length: NL }, () => []), Vc = Array.from({ length: NL }, () => []);
  for (let pos = 0; pos < tokens.length; pos++) {
    let h = H[pos];
    for (let il = 0; il < NL; il++) {
      const x = L[il];
      const xn = rms(h, x.attn_norm);
      let q = mvs(x.wq, xn, D, QD, x.sq), k = mvs(x.wk, xn, D, KV, x.sk); const v = mvs(x.wv, xn, D, KV, x.sv);
      q = Array.from(ropeRef(q, pos)); k = Array.from(ropeRef(k, pos));
      Kc[il].push(k); Vc[il].push(v);
      const grp = NH / NHKV, ctx = new Array(QD).fill(0);
      for (let hh = 0; hh < NH; hh++) {
        const kvh = Math.floor(hh / grp), sc = [];
        for (let tp = 0; tp <= pos; tp++) { let s = 0; for (let d = 0; d < HD; d++) s += q[hh * HD + d] * Kc[il][tp][kvh * HD + d]; sc.push(s * ASCALE); }
        const mx = Math.max(...sc); let z = 0; const e = sc.map((s) => { const ex = Math.exp(s - mx); z += ex; return ex; });
        for (let d = 0; d < HD; d++) { let acc = 0; for (let tp = 0; tp <= pos; tp++) acc += (e[tp] / z) * Vc[il][tp][kvh * HD + d]; ctx[hh * HD + d] = acc; }
      }
      const subC = rms(ctx, x.attn_sub);                 // attn_sub_norm BEFORE wo
      const attnOut = mvs(x.wo, subC, QD, D, x.so);
      const ffnInp = addV(attnOut, h);
      const xn2 = rms(ffnInp, x.ffn_norm);
      const g = mvs(x.wgate, xn2, D, FF, x.sg), u = mvs(x.wup, xn2, D, FF, x.su);
      const act = Array.from({ length: FF }, (_, i) => silu(g[i]) * u[i]);
      const subA = rms(act, x.ffn_sub);                  // ffn_sub_norm BEFORE ffn_down
      const ffnOut = mvs(x.wdown, subA, FF, D, x.sd);
      h = addV(ffnOut, ffnInp);
      H[pos] = h;
    }
  }
  return mv(w.tok_embd, rms(H[tokens.length - 1], w.output_norm), D, VOCAB); // tied lm_head
}

const gguf = buildGguf(meta, ggufTensors);
const f = forgeGguf(gguf);
const graph = synthesizeGraph(f.plan);
const store = { get: (hex) => f.blocks.get(hex) };
const tokens = [3, 1, 4, 2];

t("graph is dense family, bitnet flag, tied, all weights resolve", () => {
  assert.strictEqual(graph.family, "dense", graph.reason);
  assert.strictEqual(graph.stats.bitnet, true);
  assert.strictEqual(graph.stats.tied, true);
  assert.strictEqual(graph.stats.n_layer, NL);
  assert.strictEqual(graph.stats.ops, 3 + 9 * NL);          // sub-norms fold into attn/ffn ops
  assert.strictEqual(graph.stats.weightsUsed, tensors.length);
});

t("attn op carries attn_sub_norm + wo scale; ffn op carries ffn_sub_norm + scales", () => {
  const attn = graph.ops.find((o) => o.op === "attn");
  assert.ok(attn.w.attn_sub_norm && attn.w.wo_s, "attn sub-norm + wo scale present");
  const ffn = graph.ops.find((o) => o.op === "ffn_swiglu");
  assert.ok(ffn.w.ffn_sub_norm && ffn.w.gate_s && ffn.w.down_s, "ffn sub-norm + scales present");
});

t("executor logits match independent f64 reference (bitnet forward)", () => {
  const got = forward(f.plan, graph, store, tokens), ref = referenceForward(tokens);
  assert.strictEqual(got.length, VOCAB);
  for (let i = 0; i < VOCAB; i++) {
    const rel = Math.abs(got[i] - ref[i]) / (Math.abs(ref[i]) + 1e-4);
    assert.ok(rel < 5e-3, `logit ${i}: got ${got[i]} ref ${ref[i]} rel ${rel}`);
  }
  console.log(`      logits: [${Array.from(got).map((x) => x.toFixed(4)).join(", ")}]`);
});

t("argmax (greedy token) matches reference", () => {
  const am = (a) => a.indexOf(Math.max(...a));
  assert.strictEqual(am(Array.from(forward(f.plan, graph, store, tokens))), am(Array.from(referenceForward(tokens))));
});

t("executor is deterministic", () => {
  const a = forward(f.plan, graph, store, tokens), b = forward(f.plan, graph, store, tokens);
  for (let i = 0; i < VOCAB; i++) assert.strictEqual(a[i], b[i]);
});

// ── structural check against a REAL bitnet header (skipped if absent) ──
const REAL = process.env.BITNET_GGUF || "";
t("real bitnet header: family=dense+bitnet, every tensor resolves", () => {
  if (!REAL || !existsSync(REAL)) { console.log("      (skipped — no bitnet GGUF; set BITNET_GGUF=path)"); return; }
  const fd = openSync(REAL, "r"); const buf = Buffer.alloc(64 * 1024 * 1024); readSync(fd, buf, 0, buf.length, 0); closeSync(fd);
  const h = parseGgufHeader(new Uint8Array(buf));
  const plan = { arch: h.meta["general.architecture"], meta: h.meta,
    tensors: h.tensors.map((x) => ({ name: x.name, dims: x.dims, type: x.ggmlType, typeName: String(x.ggmlType), kappa: "sha256:" + "0".repeat(64) })) };
  const g = synthesizeGraph(plan);
  assert.strictEqual(g.stats.bitnet, true);
  assert.strictEqual(g.stats.weightsUsed, h.tensors.length, "every tensor referenced");
  console.log(`      bitnet: ${g.stats.n_layer}L, ${g.stats.weightsUsed}/${h.tensors.length} tensors, ${g.stats.ops} ops`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
