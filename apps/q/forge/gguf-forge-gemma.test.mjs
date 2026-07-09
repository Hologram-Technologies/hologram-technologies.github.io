// Gemma3 end-to-end test. Build a tiny gemma3 with random F32 weights, forge ->
// synthesize -> run forward, and compare logits to an INDEPENDENT float64 reference
// that reproduces gemma3.cpp exactly: embedding ×√n_embd, QK-norm, per-layer RoPE
// base (SWA vs global), sliding-window attention mask, GeGLU FFN, and FOUR norms per
// layer (pre+post on attn and ffn), tied lm_head. Two layers with swaPat=2 exercise
// BOTH a sliding-window layer (layer 0) and a global layer (layer 1); a 4-token
// prompt with n_swa=2 exercises the sliding-window mask. Plus a structural check
// against the real gemma-3-4b header when present.

import assert from "node:assert";
import { existsSync, openSync, readSync, closeSync } from "node:fs";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";
import { parseGgufHeader } from "../qvac-ingest.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

// ── tiny dims; HD≠D/NH (like Gemma's key_length), GQA, 2 layers, SWA period 2 ──
const D = 8, NH = 2, NHKV = 1, HD = 6, FF = 16, VOCAB = 5, NL = 2, EPS = 1e-6;
const FREQ = 1000000, FREQ_SWA = 10000, NSWA = 2, SWAPAT = 2;
const QD = NH * HD, KV = NHKV * HD, ESCALE = Math.sqrt(D), ASCALE = 1 / Math.sqrt(HD);
const isSwa = (il) => il % SWAPAT < SWAPAT - 1;

function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const r = prng(7);
const randF = (n, scale = 0.3) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * scale; return a; };
const normW = (n) => randF(n, 1).map((x) => Math.abs(x) + 0.5);

const L = []; // per-layer weights
for (let il = 0; il < NL; il++) L.push({
  attn_norm: normW(D), q_norm: normW(HD), k_norm: normW(HD), post_attn: normW(D), ffn_norm: normW(D), post_ffw: normW(D),
  wq: randF(QD * D), wk: randF(KV * D), wv: randF(KV * D), wo: randF(D * QD),
  wgate: randF(FF * D), wup: randF(FF * D), wdown: randF(D * FF),
});
const w = { tok_embd: randF(VOCAB * D), output_norm: normW(D) };

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
  "general.architecture": "gemma3", "gemma3.block_count": NL, "gemma3.embedding_length": D,
  "gemma3.attention.head_count": NH, "gemma3.attention.head_count_kv": NHKV, "gemma3.attention.key_length": HD,
  "gemma3.feed_forward_length": FF, "gemma3.rope.freq_base": FREQ, "gemma3.rope.freq_base_swa": FREQ_SWA,
  "gemma3.attention.sliding_window": NSWA, "gemma3.attention.sliding_window_pattern": SWAPAT,
  "gemma3.attention.layer_norm_rms_epsilon": EPS,
};
const tensors = [["token_embd.weight", [D, VOCAB], w.tok_embd], ["output_norm.weight", [D], w.output_norm]];
for (let il = 0; il < NL; il++) { const p = `blk.${il}.`, x = L[il]; tensors.push(
  [p + "attn_norm.weight", [D], x.attn_norm], [p + "attn_q.weight", [D, QD], x.wq], [p + "attn_k.weight", [D, KV], x.wk], [p + "attn_v.weight", [D, KV], x.wv],
  [p + "attn_q_norm.weight", [HD], x.q_norm], [p + "attn_k_norm.weight", [HD], x.k_norm], [p + "attn_output.weight", [QD, D], x.wo],
  [p + "post_attention_norm.weight", [D], x.post_attn], [p + "ffn_norm.weight", [D], x.ffn_norm],
  [p + "ffn_gate.weight", [D, FF], x.wgate], [p + "ffn_up.weight", [D, FF], x.wup], [p + "ffn_down.weight", [FF, D], x.wdown],
  [p + "post_ffw_norm.weight", [D], x.post_ffw]);
}
const ggufTensors = tensors.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32bytes(arr) }));

// ── independent float64 reference forward (reproduces gemma3.cpp) ──
function matvecRef(W, x, K, N) { const y = new Float64Array(N); for (let n = 0; n < N; n++) { let s = 0; for (let k = 0; k < K; k++) s += W[n * K + k] * x[k]; y[n] = s; } return y; }
function rmsRef(x, wt) { let s = 0; for (const v of x) s += v * v; const sc = 1 / Math.sqrt(s / x.length + EPS); return Array.from(x, (v, i) => v * sc * wt[i]); }
function normHeadsRef(vec, wt) { const out = Array.from(vec); for (let h = 0; h < vec.length / HD; h++) { const sl = vec.slice(h * HD, h * HD + HD), n = rmsRef(sl, wt); for (let d = 0; d < HD; d++) out[h * HD + d] = n[d]; } return out; }
const GA = 0.044715, GS = 0.7978845608028654;
const geluRef = (x) => 0.5 * x * (1 + Math.tanh(GS * (x + GA * x * x * x)));
function ropeRef(vec, pos, freqBase) { const half = HD / 2, nHeads = vec.length / HD, out = Float64Array.from(vec); for (let hh = 0; hh < nHeads; hh++) for (let ic = 0; ic < half; ic++) { const th = pos * Math.pow(freqBase, -2 * ic / HD); const c = Math.cos(th), sn = Math.sin(th); const o = hh * HD; const x0 = vec[o + ic], x1 = vec[o + ic + half]; out[o + ic] = x0 * c - x1 * sn; out[o + ic + half] = x0 * sn + x1 * c; } return out; }
const addV = (a, b) => a.map((x, i) => x + b[i]);

function referenceForward(tokens) {
  const H = tokens.map((tk) => Array.from(w.tok_embd.slice(tk * D, tk * D + D), (v) => v * ESCALE));
  const Kc = Array.from({ length: NL }, () => []), Vc = Array.from({ length: NL }, () => []);
  for (let pos = 0; pos < tokens.length; pos++) {
    let h = H[pos];
    for (let il = 0; il < NL; il++) {
      const x = L[il], fb = isSwa(il) ? FREQ_SWA : FREQ, swa = isSwa(il) ? NSWA : 0, lo = swa ? Math.max(0, pos - swa + 1) : 0;
      const xn = rmsRef(h, x.attn_norm);
      let q = Array.from(matvecRef(x.wq, xn, D, QD)), k = Array.from(matvecRef(x.wk, xn, D, KV)); const v = Array.from(matvecRef(x.wv, xn, D, KV));
      q = normHeadsRef(q, x.q_norm); k = normHeadsRef(k, x.k_norm);
      q = Array.from(ropeRef(q, pos, fb)); k = Array.from(ropeRef(k, pos, fb));
      Kc[il].push(k); Vc[il].push(v);
      const grp = NH / NHKV, ctx = new Array(QD).fill(0);
      for (let hh = 0; hh < NH; hh++) {
        const kvh = Math.floor(hh / grp), sc = [];
        for (let tp = 0; tp <= pos; tp++) { if (tp < lo) { sc.push(-Infinity); continue; } let s = 0; for (let d = 0; d < HD; d++) s += q[hh * HD + d] * Kc[il][tp][kvh * HD + d]; sc.push(s * ASCALE); }
        const mx = Math.max(...sc); let z = 0; const e = sc.map((s) => { const ex = Math.exp(s - mx); z += ex; return ex; });
        for (let d = 0; d < HD; d++) { let acc = 0; for (let tp = 0; tp <= pos; tp++) acc += (e[tp] / z) * Vc[il][tp][kvh * HD + d]; ctx[hh * HD + d] = acc; }
      }
      const attnOut = Array.from(matvecRef(x.wo, ctx, QD, D));
      const saOut = addV(rmsRef(attnOut, x.post_attn), h);
      const xn2 = rmsRef(saOut, x.ffn_norm);
      const g = matvecRef(x.wgate, xn2, D, FF), u = matvecRef(x.wup, xn2, D, FF);
      const act = Array.from({ length: FF }, (_, i) => geluRef(g[i]) * u[i]);
      const ffnOut = Array.from(matvecRef(x.wdown, act, FF, D));
      h = addV(rmsRef(ffnOut, x.post_ffw), saOut);
      H[pos] = h;
    }
  }
  const fn = rmsRef(H[tokens.length - 1], w.output_norm);
  return Array.from(matvecRef(w.tok_embd, fn, D, VOCAB)); // tied lm_head
}

const gguf = buildGguf(meta, ggufTensors);
const f = forgeGguf(gguf);
const graph = synthesizeGraph(f.plan);
const store = { get: (hex) => f.blocks.get(hex) };
const tokens = [3, 1, 4, 2]; // 4 tokens > n_swa=2 → exercises sliding-window mask

t("graph is family=gemma, tied, correct op count + all weights resolve", () => {
  assert.strictEqual(graph.family, "gemma", graph.reason);
  assert.strictEqual(graph.stats.n_layer, NL);
  assert.strictEqual(graph.stats.tied, true);
  assert.strictEqual(graph.stats.head_dim, HD);
  assert.strictEqual(graph.stats.ops, 3 + 11 * NL);
  assert.strictEqual(graph.stats.weightsUsed, tensors.length);
  assert.ok(Math.abs(graph.stats.embdScale - ESCALE) < 1e-6 && Math.abs(graph.stats.attnScale - ASCALE) < 1e-6);
});

t("per-layer RoPE base: SWA layer 0 uses freq_base_swa, global layer 1 uses freq_base", () => {
  const ropes = graph.ops.filter((o) => o.op === "rope");
  assert.strictEqual(ropes[0].attrs.freq_base, FREQ_SWA); // layer 0 Q (SWA)
  assert.strictEqual(ropes[2].attrs.freq_base, FREQ);     // layer 1 Q (global)
  const attns = graph.ops.filter((o) => o.op === "attn");
  assert.strictEqual(attns[0].attrs.swa, NSWA); assert.strictEqual(attns[1].attrs.swa, 0);
});

t("executor logits match independent f64 reference (gemma3 forward)", () => {
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
  assert.strictEqual(am(Array.from(forward(f.plan, graph, store, tokens))), am(referenceForward(tokens)));
});

t("executor is deterministic", () => {
  const a = forward(f.plan, graph, store, tokens), b = forward(f.plan, graph, store, tokens);
  for (let i = 0; i < VOCAB; i++) assert.strictEqual(a[i], b[i]);
});

// ── structural check against the REAL gemma-3-4b header (skipped if absent) ──
const REAL = "C:/Users/pavel/.lmstudio/models/lmstudio-community/gemma-3-4b-it-GGUF/gemma-3-4b-it-Q4_K_M.gguf";
t("real gemma-3-4b header: family=gemma, every tensor resolves, hparams correct", () => {
  if (!existsSync(REAL)) { console.log("      (skipped — model not present)"); return; }
  const fd = openSync(REAL, "r"); const buf = Buffer.alloc(96 * 1024 * 1024); readSync(fd, buf, 0, buf.length, 0); closeSync(fd);
  const h = parseGgufHeader(new Uint8Array(buf));
  const plan = { arch: h.meta["general.architecture"], meta: h.meta,
    tensors: h.tensors.map((x) => ({ name: x.name, dims: x.dims, type: x.ggmlType, typeName: String(x.ggmlType), kappa: "sha256:" + "0".repeat(64) })) };
  const g = synthesizeGraph(plan);
  assert.strictEqual(g.family, "gemma", g.reason);
  assert.strictEqual(g.stats.weightsUsed, h.tensors.length, "every tensor referenced by builder");
  assert.strictEqual(g.stats.ops, 3 + 11 * g.stats.n_layer);
  assert.strictEqual(g.stats.head_dim, 256); assert.strictEqual(g.stats.nSwa, 1024);
  assert.ok(Math.abs(g.stats.attnScale - 1 / 16) < 1e-6);
  console.log(`      gemma-3-4b: ${g.stats.n_layer}L, head_dim ${g.stats.head_dim}, ${g.stats.weightsUsed}/${h.tensors.length} tensors, ${g.stats.ops} ops`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
