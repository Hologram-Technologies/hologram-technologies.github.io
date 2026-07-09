// gguf-forge-qwen35-real.mjs — run the PROVEN qwen35 decoder on the REAL 9B .holo weights, memory-bounded.
// Never fully dequantizes (9.4B F32 ≈ 37 GB). Strategy: dequantize ONE layer's weights at a time (small), feed
// the parity-verified F32 mixers (gguf-forge-qwen35{,-attn}.mjs), free; GATHER only the input rows of the 834 MB
// token_embd; STREAM the lm_head matvec row-by-row (last position only). Peak ≈ one layer + embed/lm_head bytes.
//
// Convention toggle (resolved empirically): normPlusOne — HF Qwen3NextRMSNorm is x·rsqrt(·)·(1+weight). If the
// GGUF stores the norm weight RAW (Gemma zero-centred) keep 1+w (pass w to the (1+w) mixers); if it BAKED +1,
// pass w-1 so (1+(w-1))=w. Default true (matches HF). ssm_norm (RMSNormGated) is always plain w (no toggle).

import { openHoloStream } from "./holo-archive.mjs";
import { parseGgufHeader } from "../qvac-ingest.mjs";
import { dequantizeExact } from "./gguf-forge-dequant.mjs";
import { qwen35LinearLayer, newLayerState, qwen35Dims, qwen35Schedule, matvec } from "./gguf-forge-qwen35.mjs";
import { qwen35Attention } from "./gguf-forge-qwen35-attn.mjs";
import { ropeTables, argmax } from "./gguf-forge-qwen35-model.mjs";
import { sigmoid } from "./gguf-forge-gated-delta.mjs";
import { openSync, readSync, closeSync, statSync } from "node:fs";

const BLOCK_BYTES = { 0: [1, 4], 1: [1, 2], 12: [256, 144], 13: [256, 176], 14: [256, 210], 8: [32, 34] };  // ggmlType → [elems, bytes]

// llama.cpp stores the qwen3_5 linear-attn V-HEADS deinterleaved (even HF heads first, then odd): HF v-head s
// ← GGUF index vperm[s]. q/k heads are identity. (Discovered by comparing GGUF↔safetensors: q/k cos 0.999,
// v cos 0.064→0.999 under this perm; ssm_dt/ssm_a cos 1.0.) Also ssm_a stores -exp(A_log), not A_log.
const vheadPerm = (n) => { const p = new Int32Array(n); for (let s = 0; s < n; s++) p[s] = (s % 2 === 0) ? (s >> 1) : (n / 2 + ((s - 1) >> 1)); return p; };
const permVec = (w, perm) => { const o = new Float32Array(w.length); for (let s = 0; s < perm.length; s++) o[s] = w[perm[s]]; return o; };
function permRows(w, nIn, off, B, perm) { const o = Float32Array.from(w); for (let s = 0; s < perm.length; s++) { const len = B * nIn; o.set(w.subarray((off + perm[s] * B) * nIn, (off + perm[s] * B) * nIn + len), (off + s * B) * nIn); } return o; }  // reorder out-rows (heads of B rows from row `off`)
function permCols(w, nIn, nOut, B, perm) { const o = Float32Array.from(w); for (let r = 0; r < nOut; r++) { const rb = r * nIn; for (let s = 0; s < perm.length; s++) o.set(w.subarray(rb + perm[s] * B, rb + perm[s] * B + B), rb + s * B); } return o; }  // reorder in-cols per row (heads of B cols)
function permConvV(conv, K, C, vOff, B, perm) { const o = Float32Array.from(conv); for (let j = 0; j < K; j++) { const base = j * C + vOff; for (let s = 0; s < perm.length; s++) o.set(conv.subarray(base + perm[s] * B, base + perm[s] * B + B), base + s * B); } return o; }  // reorder v-channels per kernel
const silu = (x) => x * sigmoid(x);
const rmsNorm1p = (x, w, eps) => { let ss = 0; for (let i = 0; i < x.length; i++) ss += x[i] * x[i]; const inv = 1 / Math.sqrt(ss / x.length + eps), o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] * inv * (1 + w[i]); return o; };

export async function openRealModel(holoPath) {
  const fd = openSync(holoPath, "r"), size = statSync(holoPath).size;
  const rr = async (o, l) => { const b = Buffer.alloc(l); let g = 0; while (g < l) { const r = readSync(fd, b, g, l - g, o + g); if (!r) break; g += r; } return new Uint8Array(b.buffer, b.byteOffset, g); };
  const h = await openHoloStream(rr);
  const { meta, tensors } = parseGgufHeader(h.headerBytes);
  const info = new Map(tensors.map((t) => [t.name, t]));
  const kByName = new Map(h.order.map((o) => [o.name, String(o.kappa).split(":").pop()]));
  const bytesCache = new Map();
  const getBytes = async (name) => { if (!bytesCache.has(name)) bytesCache.set(name, await h.getBody(kByName.get(name))); return bytesCache.get(name); };
  const deq = async (name) => { const t = info.get(name), els = t.dims.reduce((a, b) => a * b, 1); return dequantizeExact(t.ggmlType, await getBytes(name), els); };
  return { fd, meta, info, getBytes, deq, close: () => closeSync(fd) };
}

// gather embeddings for token ids from the quantized token_embd (row v = [v*d_model : +d_model], block-aligned).
async function gatherEmbed(M, ids, d_model) {
  const t = M.info.get("token_embd.weight"), bytes = await M.getBytes("token_embd.weight");
  const [be, bb] = BLOCK_BYTES[t.ggmlType], blocksPerRow = d_model / be, rowBytes = blocksPerRow * bb;
  return ids.map((v) => dequantizeExact(t.ggmlType, bytes.subarray(v * rowBytes, v * rowBytes + rowBytes), d_model));
}

// streaming lm_head: logits[v] = Σ_i out[v][i]·hidden[i], dequantizing each row's blocks on the fly (bounded memory).
async function lmHead(M, hidden, d_model, vocab) {
  const t = M.info.get("output.weight"), bytes = await M.getBytes("output.weight");
  const [be, bb] = BLOCK_BYTES[t.ggmlType], rowBytes = (d_model / be) * bb, logits = new Float32Array(vocab);
  for (let v = 0; v < vocab; v++) { const row = dequantizeExact(t.ggmlType, bytes.subarray(v * rowBytes, v * rowBytes + rowBytes), d_model); let s = 0; for (let i = 0; i < d_model; i++) s += row[i] * hidden[i]; logits[v] = s; }
  return logits;
}

// build a F32 weight set for layer L (dequantized), applying the norm convention. convNames = the (1+w) norms.
async function loadLayer(M, L, type, normPlusOne) {
  const N = `blk.${L}.`, W = {};
  const norm = async (g, key) => { const w = await M.deq(g); W[key] = normPlusOne ? w : w.map((x) => x - 1); };
  await norm(N + "attn_norm.weight", "attn_norm");
  await norm(N + "post_attention_norm.weight", "post_attention_norm");
  W.ffn_gate = await M.deq(N + "ffn_gate.weight"); W.ffn_up = await M.deq(N + "ffn_up.weight"); W.ffn_down = await M.deq(N + "ffn_down.weight");
  if (type === "linear") {
    const nvh = M.meta["qwen35.ssm.inner_size"] / M.meta["qwen35.ssm.state_size"], hv = M.meta["qwen35.ssm.state_size"];  // 32 v-heads, 128 head_v
    const keyDim2 = 2 * M.meta["qwen35.ssm.group_count"] * M.meta["qwen35.ssm.state_size"];                                // 2*key_dim = 4096 (q|k before v)
    const vp = vheadPerm(nvh), dm = M.meta["qwen35.embedding_length"], vd = M.meta["qwen35.ssm.inner_size"];
    // v-heads are deinterleaved in the GGUF → reorder every v-head-indexed tensor into HF order
    W.attn_qkv = permRows(await M.deq(N + "attn_qkv.weight"), dm, keyDim2, hv, vp);      // out rows: q|k identity, v reordered
    W.attn_gate = permRows(await M.deq(N + "attn_gate.weight"), dm, 0, hv, vp);          // z: all v-heads
    W.ssm_alpha = permRows(await M.deq(N + "ssm_alpha.weight"), dm, 0, 1, vp);           // a: 32 out rows
    W.ssm_beta = permRows(await M.deq(N + "ssm_beta.weight"), dm, 0, 1, vp);             // b: 32 out rows
    W.ssm_out = permCols(await M.deq(N + "ssm_out.weight"), vd, dm, hv, vp);             // in cols: v-heads
    W.ssm_dt = permVec(await M.deq(N + "ssm_dt.bias"), vp);
    const aRaw = permVec(await M.deq(N + "ssm_a"), vp);                                  // GGUF ssm_a = -exp(A_log)
    W.ssm_a = aRaw.map((v) => Math.log(-v));                                             // → A_log, so gatedDeltaDecay's -exp(A_log) matches
    W.ssm_norm = await M.deq(N + "ssm_norm.weight");                                     // per-dim, head-agnostic — no perm
    const cw = await M.deq(N + "ssm_conv1d.weight"), C = M.info.get(N + "ssm_conv1d.weight").dims[1], K = M.info.get(N + "ssm_conv1d.weight").dims[0];
    const conv = new Float32Array(K * C); for (let c = 0; c < C; c++) for (let j = 0; j < K; j++) conv[j * C + c] = cw[c * K + j];
    W.ssm_conv1d = permConvV(conv, K, C, keyDim2, hv, vp);                               // v-channels reordered
  } else {
    W.attn_q = await M.deq(N + "attn_q.weight"); W.attn_k = await M.deq(N + "attn_k.weight"); W.attn_v = await M.deq(N + "attn_v.weight");
    W.attn_output = await M.deq(N + "attn_output.weight");
    await norm(N + "attn_q_norm.weight", "attn_q_norm"); await norm(N + "attn_k_norm.weight", "attn_k_norm");
  }
  return W;
}

export function realDims(meta) {
  const D = qwen35Dims(meta);
  D.ffn = meta["qwen35.feed_forward_length"]; D.vocab = 248320;
  D.n_head = meta["qwen35.attention.head_count"]; D.n_kv = meta["qwen35.attention.head_count_kv"]; D.head_dim = meta["qwen35.attention.key_length"];
  D.rope_dim = meta["qwen35.rope.dimension_count"]; D.rope_theta = meta["qwen35.rope.freq_base"];
  return D;
}

// ONE forward over the prompt; returns the LAST position's logits (next-token distribution). onLayer for progress.
export async function realForward(M, ids, { normPlusOne = true, onLayer } = {}) {
  const D = realDims(M.meta), T = ids.length, sched = qwen35Schedule(D.n_layer, D.interval);
  let h = await gatherEmbed(M, ids, D.d_model);
  const { cos, sin } = ropeTables(D, T);
  for (let L = 0; L < D.n_layer; L++) {
    const type = sched[L] === "attn" ? "attn" : "linear", W = await loadLayer(M, L, type, normPlusOne);
    const out = type === "attn" ? qwen35Attention(W, D, h, cos, sin, {}).ySeq : qwen35LinearLayer(W, D, h, newLayerState(D), {}).ySeq;
    for (let t = 0; t < T; t++) for (let i = 0; i < D.d_model; i++) h[t][i] += out[t][i];
    for (let t = 0; t < T; t++) { const mn = rmsNorm1p(h[t], W.post_attention_norm, D.eps), g = matvec(W.ffn_gate, mn, D.d_model, D.ffn), u = matvec(W.ffn_up, mn, D.d_model, D.ffn), hd = new Float32Array(D.ffn); for (let i = 0; i < D.ffn; i++) hd[i] = silu(g[i]) * u[i]; const f = matvec(W.ffn_down, hd, D.ffn, D.d_model); for (let i = 0; i < D.d_model; i++) h[t][i] += f[i]; }
    onLayer && onLayer(L, type, h);
  }
  const outNormRaw = await M.deq("output_norm.weight"), outNorm = normPlusOne ? outNormRaw : outNormRaw.map((x) => x - 1);
  return lmHead(M, rmsNorm1p(h[T - 1], outNorm, D.eps), D.d_model, D.vocab);
}

export { argmax };
