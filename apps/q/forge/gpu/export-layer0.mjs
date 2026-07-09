// Export real-model layer-0 weights (dequantized to f32) + a 4-token prefill input
// + the CPU-oracle expected layer-0 outputs, for the in-browser GPU orchestration
// witness. f32 weights isolate the orchestration (op-chaining + attention + KV)
// from the quant kernels (already witnessed separately).

import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { parseGgufHeader } from "../../qvac-ingest.mjs";
import { dequantizeExact } from "../gguf-forge-dequant.mjs";
import { ggmlNBytes } from "../gguf-forge.mjs";
import { rmsNorm, ropeNeox, softmax, swiglu } from "../gguf-forge-kernels.mjs";

const fr = Math.fround;
const MODEL = "../.models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
const buf = new Uint8Array(readFileSync(new URL(MODEL, import.meta.url)));
const h = parseGgufHeader(buf);
const meta = h.meta, arch = "qwen2";
const D = meta[`${arch}.embedding_length`], NH = meta[`${arch}.attention.head_count`], NHKV = meta[`${arch}.attention.head_count_kv`];
const HD = meta[`${arch}.attention.key_length`] || Math.floor(D / NH);
const FF = meta[`${arch}.feed_forward_length`], EPS = meta[`${arch}.attention.layer_norm_rms_epsilon`], FREQ = meta[`${arch}.rope.freq_base`] || 10000;
const KV = NHKV * HD, QD = NH * HD;

const tdir = {}; for (const t of h.tensors) tdir[t.name] = t;
function deqTensor(name) {
  const t = tdir[name]; const n = t.dims.reduce((a, b) => a * b, 1);
  const raw = buf.subarray(h.dataOffset + t.offset, h.dataOffset + t.offset + ggmlNBytes(t.ggmlType, n));
  return dequantizeExact(t.ggmlType, raw, n);
}
function embRow(tok) { // token_embd row -> f32 D-vector
  const t = tdir["token_embd.weight"]; const raw = buf.subarray(h.dataOffset + t.offset, h.dataOffset + t.offset + ggmlNBytes(t.ggmlType, t.dims[0] * t.dims[1]));
  // dims = [D, vocab]; row=tok at tok*D
  const all = dequantizeExact(t.ggmlType, raw, t.dims[0] * t.dims[1]);
  return all.subarray(tok * D, tok * D + D);
}

const W = {
  attn_norm: deqTensor("blk.0.attn_norm.weight"), ffn_norm: deqTensor("blk.0.ffn_norm.weight"),
  wq: deqTensor("blk.0.attn_q.weight"), bq: deqTensor("blk.0.attn_q.bias"),
  wk: deqTensor("blk.0.attn_k.weight"), bk: deqTensor("blk.0.attn_k.bias"),
  wv: deqTensor("blk.0.attn_v.weight"), bv: deqTensor("blk.0.attn_v.bias"),
  wo: deqTensor("blk.0.attn_output.weight"),
  gate: deqTensor("blk.0.ffn_gate.weight"), up: deqTensor("blk.0.ffn_up.weight"), down: deqTensor("blk.0.ffn_down.weight"),
};

// f32-faithful matvec: f32 running-sum accumulation (matches ggml CPU f32 dot and
// the GPU kernel's f32 accumulator — not an f64 accumulator).
const matvec = (Wt, x, N, K) => { const y = new Float32Array(N); for (let n = 0; n < N; n++) { let s = 0; const b = n * K; for (let k = 0; k < K; k++) s = fr(s + fr(Wt[b + k] * x[k])); y[n] = s; } return y; };
const addB = (v, b) => { const y = new Float32Array(v.length); for (let i = 0; i < v.length; i++) y[i] = fr(v[i] + b[i]); return y; };
const addV = (a, b) => { const y = new Float32Array(a.length); for (let i = 0; i < a.length; i++) y[i] = fr(a[i] + b[i]); return y; };
const ropeHeads = (vec, pos) => { const out = new Float32Array(vec.length); for (let hh = 0; hh < vec.length / HD; hh++) out.set(ropeNeox(vec.subarray(hh * HD, hh * HD + HD), pos, HD, FREQ, HD), hh * HD); return out; };

const tokens = [785, 6722, 374, 264];
const T = tokens.length, grp = NH / NHKV, scale = 1 / Math.sqrt(HD);
const embeds = tokens.map((tk) => Float32Array.from(embRow(tk)));
const Kc = [], Vc = [], outs = [];
for (let pos = 0; pos < T; pos++) {
  const x = embeds[pos];
  const xn = rmsNorm(x, W.attn_norm, EPS);
  let q = addB(matvec(W.wq, xn, QD, D), W.bq);
  let k = addB(matvec(W.wk, xn, KV, D), W.bk);
  const v = addB(matvec(W.wv, xn, KV, D), W.bv);
  q = ropeHeads(q, pos); k = ropeHeads(k, pos);
  Kc.push(k); Vc.push(v);
  const ctx = new Float32Array(QD);
  for (let hh = 0; hh < NH; hh++) {
    const kvh = Math.floor(hh / grp), sc = new Float32Array(pos + 1);
    for (let tp = 0; tp <= pos; tp++) { let s = 0; for (let d = 0; d < HD; d++) s += fr(q[hh * HD + d] * Kc[tp][kvh * HD + d]); sc[tp] = fr(s); }
    const p = softmax(sc, scale);
    for (let d = 0; d < HD; d++) { let acc = 0; for (let tp = 0; tp <= pos; tp++) acc += fr(p[tp] * Vc[tp][kvh * HD + d]); ctx[hh * HD + d] = fr(acc); }
  }
  const attnOut = matvec(W.wo, ctx, D, QD);
  const ffnInp = addV(x, attnOut);
  const xn2 = rmsNorm(ffnInp, W.ffn_norm, EPS);
  const g = matvec(W.gate, xn2, FF, D), u = matvec(W.up, xn2, FF, D);
  const ffnOut = matvec(W.down, swiglu(g, u), D, FF);
  outs.push(addV(ffnInp, ffnOut));
}

// pack: concat all f32 buffers into one blob + a layout
const blobs = [], layout = {};
const add = (name, arr) => { layout[name] = { off: blobs.reduce((a, b) => a + b.length, 0), len: arr.length }; blobs.push(Float32Array.from(arr)); };
for (const [k, v] of Object.entries(W)) add(k, v);
for (let i = 0; i < T; i++) add(`emb${i}`, embeds[i]);
for (let i = 0; i < T; i++) add(`exp${i}`, outs[i]);
const total = blobs.reduce((a, b) => a + b.length, 0);
const flat = new Float32Array(total); { let o = 0; for (const b of blobs) { flat.set(b, o); o += b.length; } }
writeFileSync(new URL("./layer0.bin", import.meta.url), Buffer.from(flat.buffer));
writeFileSync(new URL("./layer0.json", import.meta.url), JSON.stringify({ D, NH, NHKV, HD, FF, KV, QD, EPS, FREQ, T, scale, grp, layout }));
console.log(`exported layer0.bin (${(flat.byteLength / 1e6).toFixed(1)} MB), T=${T}, D=${D} NH=${NH} NHKV=${NHKV} HD=${HD} FF=${FF}`);
console.log(`expected out[0][0..3] = ${[...outs[0].slice(0, 3)].map((x) => x.toFixed(4))}`);
