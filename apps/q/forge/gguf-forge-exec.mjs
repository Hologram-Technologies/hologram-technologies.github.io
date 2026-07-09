// GGUF Forge — Tier-A CPU executor. Walks the synthesized graph and runs a real
// prefill forward pass using the float32-exact kernels + κ-store weights. Returns
// last-position logits. This is the golden reference the GPU runtime is checked
// against (and, once a model + llama.cpp reference exist, the bit-exact witness).
//
// The graph is an SSA-style named DAG (each op reads named inputs, writes named
// outputs), so execution is a simple value-environment walk — residuals are just
// `add` ops over named values, no implicit state. Supports the dense qwen2 family:
// embedding, RMSNorm, GQA QKV(+bias), NEOX RoPE, causal attention w/ KV-cache,
// SwiGLU FFN, lm_head. Weight matvec dispatches on ggml type.

import { loadByKappa, GGML_TYPE_NAME } from "./gguf-forge.mjs";
import { loadExpertSlice } from "./gguf-forge-expert-dir.mjs";
import { dequantizeExact, GGML } from "./gguf-forge-dequant.mjs";
import { quantizeRowQ8K, vecDotQ4K, vecDotQ6K, vecDotTq2_0, vecDotF16, f16Row, quantizeRowQ8_0, vecDotQ8_0, vecDotQ5_0, vecDotQ4_0 } from "./gguf-forge-matmul.mjs";
import { rmsNorm, layerNorm, swiglu, geglu, softmax, ropeNeox, sigmoid, silu, ssmConv1d, selectiveScan, selectiveScan2, wkv7, moeRoute, moeCombine } from "./gguf-forge-kernels.mjs";
import { tqRotate } from "./gguf-forge-turboquant.mjs";

const fr = Math.fround;
const QK_K = 256;

function blockOf(type) {
  switch (type) {
    case GGML.Q4_K: return [QK_K, 144];
    case GGML.Q6_K: return [QK_K, 210];
    case GGML.Q8_0: return [32, 34];
    case GGML.Q4_0: return [32, 18];
    case GGML.Q5_0: return [32, 22];
    case GGML.Q5_1: return [32, 24];
    case GGML.Q2_K: return [QK_K, 84];
    case GGML.Q3_K: return [QK_K, 110];
    case GGML.Q5_K: return [QK_K, 176];
    case GGML.TQ2_0: return [QK_K, 66];   // BitNet ternary (integer-dot matvec)
    default: throw new Error("exec: no block size for type " + (GGML_TYPE_NAME[type] || type));
  }
}

const _dv = new WeakMap();
const dvOf = (raw) => { let d = _dv.get(raw); if (!d) { d = new DataView(raw.buffer, raw.byteOffset, raw.byteLength); _dv.set(raw, d); } return d; };

// One row (length K) of a [K,N] weight, dequantized to f32. rowIdx in [0,N).
function rowFromRaw(raw, type, K, idx) {
  if (type === GGML.F32) return dequantizeExact(GGML.F32, raw.subarray(idx * K * 4, (idx + 1) * K * 4), K);
  if (type === GGML.F16) return dequantizeExact(GGML.F16, raw.subarray(idx * K * 2, (idx + 1) * K * 2), K);
  const [bElems, bBytes] = blockOf(type); const nb = K / bElems, off = idx * nb * bBytes;
  return dequantizeExact(type, raw.subarray(off, off + nb * bBytes), K);
}
function getRow(store, w, rowIdx, load = loadByKappa) {
  const K = w.dims[0];
  // M14: if the weight carries row-tiles, load ONLY the tile holding this row (streaming store evicts).
  if (w.tiles) { const t = w.tiles.find((t) => rowIdx >= t.n0 && rowIdx < t.n1); return rowFromRaw(load(store, t.kappa), w.type, K, rowIdx - t.n0); }
  return rowFromRaw(load(store, w.kappa), w.type, K, rowIdx);
}

// y = W · x for a [K,N] matrix whose bytes start at `base` in `raw`. Integer-dot
// path for the quant types; returns null for types without one (caller falls back).
// `base` lets one κ-object hold a stack of matrices (MoE experts) addressed by offset.
function matvecBytes(raw, type, K, N, x, base = 0) {
  // Witness hook: force the float dequant-dot fallback for non-F32 quant types (so the CPU oracle
  // matches the GPU raw K-quant kernels, which do float dequant-dot — the fast tier). Inert by default.
  if (globalThis.__HOLO_FORCE_FLOAT_DEQUANT && type !== GGML.F32) return null;
  const y = new Float32Array(N);
  if (type === GGML.F32) {
    const dv = dvOf(raw);
    for (let n = 0; n < N; n++) { let s = 0.0; const b = base + n * K * 4; for (let k = 0; k < K; k++) s += fr(dv.getFloat32(b + k * 4, true) * x[k]); y[n] = fr(s); }
    return y;
  }
  if (type === GGML.Q4_K || type === GGML.Q6_K) {
    const q8k = quantizeRowQ8K(x, K), nb = K / QK_K, bBytes = type === GGML.Q4_K ? 144 : 210;
    for (let n = 0; n < N; n++) y[n] = type === GGML.Q4_K ? vecDotQ4K(nb, raw, q8k, base + n * nb * bBytes) : vecDotQ6K(nb, raw, q8k, base + n * nb * bBytes);
    return y;
  }
  if (type === GGML.TQ2_0) {                 // BitNet ternary: Q8_K-activation integer dot
    const q8k = quantizeRowQ8K(x, K), nb = K / QK_K;
    for (let n = 0; n < N; n++) y[n] = vecDotTq2_0(nb, raw, q8k, base + n * nb * 66);
    return y;
  }
  if (type === GGML.F16) {                    // ggml f16·f16 dot, bit-exact to forge-ref (SSE3)
    const dv = dvOf(raw), xh = f16Row(x, K);  // activation → f16 grid ONCE, shared across rows
    for (let n = 0; n < N; n++) y[n] = vecDotF16(dv, K, xh, base + n * K * 2);
    return y;
  }
  if (type === GGML.Q8_0 || type === GGML.Q5_0 || type === GGML.Q4_0) {
    const q8a = quantizeRowQ8_0(x, K), nb = K / 32;
    const bBytes = type === GGML.Q8_0 ? 34 : type === GGML.Q5_0 ? 22 : 18;
    const dot = type === GGML.Q8_0 ? vecDotQ8_0 : type === GGML.Q5_0 ? vecDotQ5_0 : vecDotQ4_0;
    for (let n = 0; n < N; n++) y[n] = dot(nb, raw, q8a, base + n * nb * bBytes);
    return y;
  }
  return null;
}

// per-expert byte stride within a stacked [K,N,n_expert] κ-object.
function expertStride(type, K, N) {
  if (type === GGML.F32) return K * N * 4;
  const [bElems, bBytes] = blockOf(type);
  return N * (K / bElems) * bBytes;
}

// y = W · x, W is [K,N] (ne0=K input, ne1=N output). Returns Float32Array(N).
function matvec(store, w, x, load = loadByKappa) {
  const K = w.dims[0], N = w.dims.length > 1 ? w.dims[1] : 1;
  // M14: tiled weight → stream row-tiles through the (row-independent) GEMV, evict per tile. Peak
  // resident = one tile, byte-identical to the whole-tensor path. Default-safe: no tiles → unchanged.
  if (w.tiles) {
    const y = new Float32Array(N);
    for (const t of w.tiles) { const raw = load(store, t.kappa); const r = matvecBytes(raw, w.type, K, t.n1 - t.n0, x, 0);
      if (r) y.set(r, t.n0); else for (let n = t.n0; n < t.n1; n++) { const row = rowFromRaw(raw, w.type, K, n - t.n0); let s = 0.0; for (let k = 0; k < K; k++) s += fr(row[k] * x[k]); y[n] = fr(s); } }
    return y;
  }
  const raw = load(store, w.kappa);
  const r = matvecBytes(raw, w.type, K, N, x, 0);
  if (r) return r;
  const y = new Float32Array(N);
  for (let n = 0; n < N; n++) { const row = getRow(store, w, n, load); let s = 0.0; for (let k = 0; k < K; k++) s += fr(row[k] * x[k]); y[n] = fr(s); }
  return y;
}

// ggml_mul_mat_id for one expert. With a per-expert κ directory present, fetch ONLY
// expert e's sub-block κ (sparse — the routed-expert streaming win); otherwise load
// the whole stacked [K,N,E] κ-object and address the slice by byte offset (fallback).
// Either way the matvec math is identical (sparse fetch is pure data-plane memoization).
function matvecExpert(store, w, x, e, load = loadByKappa, dir = null) {
  const K = w.dims[0], N = w.dims[1];
  const td = dir && dir.tensors ? dir.tensors[w.name] : null;
  const raw = td ? loadExpertSlice(store, dir, w.name, e, load) : load(store, w.kappa);
  const base = td ? 0 : e * expertStride(w.type, K, N);
  const r = matvecBytes(raw, w.type, K, N, x, base);
  if (r) return r;
  // float dequant-dot fallback (the __HOLO_FORCE_FLOAT_DEQUANT witness path, and any type without an
  // integer-dot kernel) — dequantize each expert row and dot in f32, byte-addressed from `base`.
  const [bElems, bBytes] = blockOf(w.type), nb = K / bElems, y = new Float32Array(N);
  for (let n = 0; n < N; n++) { const off = base + n * nb * bBytes; const row = dequantizeExact(w.type, raw.subarray(off, off + nb * bBytes), K); let s = 0.0; for (let k = 0; k < K; k++) s += fr(row[k] * x[k]); y[n] = fr(s); }
  return y;
}

// exposed for M13 tiled/streamed GEMV: each output row n is independent (base + n·rowBytes), so a
// weight can be streamed in row-tiles and matvec'd tile-by-tile, byte-identical to the whole-tensor path.
export { matvec, matvecBytes, blockOf };

// Whole [K,N] weight dequantized to a flat row-major f32 array (row n at n*K).
// For the small SSM tensors (A {d_state,d_inner}, D {d_inner}, conv1d {d_conv,d_inner}).
function loadFull(store, w, load = loadByKappa) {
  const K = w.dims[0], N = w.dims.length > 1 ? w.dims[1] : 1, out = new Float32Array(K * N);
  for (let n = 0; n < N; n++) out.set(getRow(store, w, n, load), n * K);
  return out;
}

// Whole tensor (product of all dims) dequantized to f32 — for multi-dim small
// params like RWKV7's lerp_fused {n_embd,1,1,6}. (F32/F16 in practice.)
function loadVec(store, w, load = loadByKappa) {
  const n = w.dims.reduce((a, b) => a * (b || 1), 1);
  return dequantizeExact(w.type, load(store, w.kappa), n);
}

const addInto = (a, b) => { const y = new Float32Array(a.length); for (let i = 0; i < a.length; i++) y[i] = fr(a[i] + b[i]); return y; };
const addBias = (v, bias, store, load) => { if (!bias) return v; const b = getRow(store, bias, 0, load); for (let i = 0; i < v.length; i++) v[i] = fr(v[i] + b[i]); return v; };
const layerOf = (name) => { const m = name.match(/^l(\d+)\./); return m ? +m[1] : -1; };

function ropeHeads(vec, pos, nRot, freqBase, headDim) {
  const nHeads = vec.length / headDim, out = new Float32Array(vec.length);
  for (let hh = 0; hh < nHeads; hh++) out.set(ropeNeox(vec.subarray(hh * headDim, (hh + 1) * headDim), pos, nRot, freqBase, headDim), hh * headDim);
  return out;
}

// RoPE for the MLA q_pe/k_pe path (deepseek2 / glm-dsa). deepseek2 uses NORM rope
// (GGML_ROPE_TYPE_NORM, llama_rope_type) — pairs of CONSECUTIVE values (2k, 2k+1) —
// NOT NEOX (k, k+n/2). `y` carries YaRN params (ggml rope_yarn: blend interpolation
// freqScale·θ and extrapolation θ by a ramp over corr_dims [lo,hi], cos/sin × mscale);
// y=null → plain rope (no scaling).
function ropeNormMla(vec, pos, nRot, freqBase, headDim, y) {
  const nH = vec.length / headDim, out = Float32Array.from(vec), half = nRot >> 1;
  const thetaScale = fr(Math.pow(freqBase, -2 / nRot));
  for (let h = 0; h < nH; h++) {
    const b = h * headDim; let te = fr(pos);
    for (let k = 0; k < half; k++) {
      let theta, ms = 1;
      if (y) {
        const ti = fr(y.freqScale * te);
        const ramp = 1 - Math.min(1, Math.max(0, (k - y.lo) / Math.max(0.001, y.hi - y.lo)));
        const mix = ramp * y.extFactor;
        theta = fr(ti * (1 - mix) + te * mix); ms = y.mscale;
      } else theta = te;
      const c = fr(Math.cos(theta) * ms), s = fr(Math.sin(theta) * ms);
      const x0 = vec[b + 2 * k], x1 = vec[b + 2 * k + 1];   // NORM: consecutive pair
      out[b + 2 * k] = fr(fr(x0 * c) - fr(x1 * s));
      out[b + 2 * k + 1] = fr(fr(x0 * s) + fr(x1 * c));
      te = fr(te * thetaScale);
    }
  }
  return out;
}

// BitNet ternary weight-scale: the {1} scalar from build_lora_mm's scale arg.
function scalarOf(store, w, load) { return getRow(store, w, 0, load)[0]; }
function scaleVec(vec, s) { for (let i = 0; i < vec.length; i++) vec[i] = fr(vec[i] * s); return vec; }

// Per-head RMSNorm over each head_dim slice with a shared weight (QK-norm).
function normHeads(vec, weight, eps, headDim) {
  const nHeads = vec.length / headDim, out = new Float32Array(vec.length);
  for (let hh = 0; hh < nHeads; hh++) out.set(rmsNorm(vec.subarray(hh * headDim, (hh + 1) * headDim), weight, eps, headDim), hh * headDim);
  return out;
}

// Run a prefill over tokenIds; return logits (Float32Array, length vocab) at the last position.
// opts.load(store, kappa) overrides the L5 loader (e.g. a verify-once memoizing loader
// for large real models, so weights aren't re-hashed on every matvec).
export function forward(plan, graph, store, tokenIds, opts = {}) {
  const load = opts.load || loadByKappa;
  const dir = opts.expertDir || null;   // per-expert κ directory → sparse routed-expert fetch (else whole-stack)
  const { n_head, n_head_kv, head_dim, eps, n_layer } = graph.stats;
  const grp = n_head / n_head_kv;
  const T = tokenIds.length;
  const Kc = Array.from({ length: n_layer }, () => []);   // KV cache: per layer, per position
  const Vc = Array.from({ length: n_layer }, () => []);
  const kvmem = opts.memory || null;                      // optional κ-native KV memory (quantized/content-addressed)
  const posOffset = opts.posOffset || 0;                  // shift all RoPE positions (K3 position-shift / context-window slide)
  // Recurrent state for SSM/Mamba layers: fixed-size per layer, updated in place each
  // token (no growing cache). Lazily allocated on first use, zero-initialized = clean state.
  const convState = {}, ssmState = {};
  // RWKV7 recurrent state: per-layer token-shift (prev att/ffn normed x) + WKV matrix.
  const attShift = {}, ffnShift = {}, wkvState = {};
  // resume from a cached prefix KV (substrate-convergence): seed the cache and skip
  // re-prefilling the covered positions. Behavior-preserving — KV is deterministic in
  // the tokens, so decoding the suffix yields identical logits to a full forward.
  let startPos = 0;
  if (opts.inKV) {
    const kv = opts.inKV;
    if (kv.nLayer !== n_layer || kv.kvDim !== n_head_kv * head_dim) throw new Error("exec: inKV shape mismatch");
    if (kv.nPos >= T) throw new Error("exec: inKV covers the whole sequence (no suffix to decode)");
    for (let il = 0; il < n_layer; il++) for (let p = 0; p < kv.nPos; p++) { Kc[il].push(kv.Kc[il][p]); Vc[il].push(kv.Vc[il][p]); }
    startPos = kv.nPos;
  }
  // κ -> weight descriptor (graph.weights keyed by name)
  const byK = {}; for (const nm in graph.weights) { const w = graph.weights[nm]; byK[w.kappa] = (opts.tiles && opts.tiles[w.kappa]) ? { ...w, tiles: opts.tiles[w.kappa] } : w; }  // M14: attach row-tiles
  const W = (kappa) => kappa ? byK[kappa] : null;
  // LoRA adapter inference: y += scale·B·(A·x) on a target linear. opts.adapter[weightκ] = {A,B,scale,inn,out,r}.
  const loraDelta = (ad, x) => { const h = new Float32Array(ad.r); for (let k = 0; k < ad.r; k++) { let s = 0; for (let i = 0; i < ad.inn; i++) s = fr(s + fr(ad.A[k * ad.inn + i] * x[i])); h[k] = s; } const d = new Float32Array(ad.out); for (let o = 0; o < ad.out; o++) { let bh = 0; for (let k = 0; k < ad.r; k++) bh = fr(bh + fr(ad.B[o * ad.r + k] * h[k])); d[o] = fr(ad.scale * bh); } return d; };
  const adapterAdd = (y, x, ww) => { const ad = ww && opts.adapter ? opts.adapter[ww.kappa] : null; if (ad) { const d = loraDelta(ad, x); for (let i = 0; i < y.length; i++) y[i] = fr(y[i] + d[i]); } return y; };

  let logits = null;
  for (let pos = startPos; pos < T; pos++) {
    const env = new Map();
    for (const op of graph.ops) {
      switch (op.op) {
        case "embd": {
          const e = getRow(store, W(op.w.tok_embd), tokenIds[pos], load).slice();
          if (op.attrs?.scale) for (let i = 0; i < e.length; i++) e[i] = fr(e[i] * op.attrs.scale); // Gemma: ×√n_embd
          env.set(op.out, e);
          break;
        }
        case "rms_norm":
          env.set(op.out, rmsNorm(env.get(op.in), getRow(store, W(op.w.weight), 0, load), op.attrs.eps ?? eps));
          break;
        case "qkv": {
          const x = env.get(op.in);
          const wqW = W(op.w.wq);
          let q = addBias(adapterAdd(matvec(store, wqW, x, load), x, wqW), W(op.w.bq), store, load);
          let k = addBias(matvec(store, W(op.w.wk), x, load), W(op.w.bk), store, load);
          const v = addBias(matvec(store, W(op.w.wv), x, load), W(op.w.bv), store, load);
          // BitNet ternary weight-scales (build_lora_mm scale arg): scalar per linear.
          if (op.w.wq_s) { scaleVec(q, scalarOf(store, W(op.w.wq_s), load)); scaleVec(k, scalarOf(store, W(op.w.wk_s), load)); scaleVec(v, scalarOf(store, W(op.w.wv_s), load)); }
          // optional per-head QK-norm (qwen3 / Gemma3): RMSNorm over each head's
          // head_dim slice with a shared weight. (gemma3.cpp:53,61)
          if (op.w.q_norm) {
            const qn = getRow(store, W(op.w.q_norm), 0, load), kn = getRow(store, W(op.w.k_norm), 0, load), e = op.attrs.qk_norm_eps ?? eps;
            q = normHeads(q, qn, e, head_dim); k = normHeads(k, kn, e, head_dim);
          }
          env.set(op.out.q, q); env.set(op.out.k, k); env.set(op.out.v, v);
          break;
        }
        case "rope":
          env.set(op.target, ropeHeads(env.get(op.target), pos + posOffset, op.attrs.n_rot, op.attrs.freq_base, head_dim));
          break;
        case "attn": {
          const il = layerOf(op.out);
          const q = env.get(op.in.q), k = env.get(op.in.k), v = env.get(op.in.v);
          // κ-native KV memory (optional): each K/V vector → content-addressed quant
          // κ-block; attention sees the round-tripped value. Default = raw f32 (fast).
          if (kvmem) { Kc[il].push(kvmem.storeK(il, pos, k)); Vc[il].push(kvmem.storeV(il, pos, v)); }
          else { Kc[il].push(k); Vc[il].push(v); }
          const ctx = new Float32Array(n_head * head_dim);
          // sliding-window attention (Gemma3 SWA layers): only the last `swa`
          // positions are visible. Equivalent to full causal when pos < swa, so
          // short-prompt witnesses are unaffected. (llama-hparams is_swa / n_swa)
          const swa = op.attrs.swa || 0, lo = swa ? Math.max(0, pos - swa + 1) : 0;
          // TBQ KV: add the QJL stage-2 score correction (decoded K dropped the residual).
          const qjlOn = kvmem && kvmem.qjlActive();
          for (let hh = 0; hh < n_head; hh++) {
            const kvh = Math.floor(hh / grp);
            // forward-rotate this head's query ONCE (shared across positions) for the correction
            const qhr = qjlOn ? tqRotate(q.subarray(hh * head_dim, (hh + 1) * head_dim), head_dim) : null;
            const scores = new Float32Array(pos + 1);
            for (let tp = 0; tp <= pos; tp++) {
              if (tp < lo) { scores[tp] = -Infinity; continue; }
              let s = 0.0; for (let d = 0; d < head_dim; d++) s += fr(q[hh * head_dim + d] * Kc[il][tp][kvh * head_dim + d]);
              if (qjlOn) s = fr(s + kvmem.kCorrection(il, tp, kvh, qhr));
              scores[tp] = fr(s);
            }
            const p = softmax(scores, op.attrs.scale);
            // window only (p[tp<lo]=0 exactly) → identical result, and never reads evicted V
            for (let d = 0; d < head_dim; d++) { let acc = 0.0; for (let tp = lo; tp <= pos; tp++) acc += fr(p[tp] * Vc[il][tp][kvh * head_dim + d]); ctx[hh * head_dim + d] = fr(acc); }
          }
          // K4 SWA eviction: drop the K/V that just fell out of the window (pos−swa) — it
          // is masked for every future query, so memory stays O(n_swa) with no output change.
          if (swa && pos - swa >= 0) { Kc[il][pos - swa] = null; Vc[il][pos - swa] = null; }
          // BitNet attn_sub_norm: RMSNorm on the attention output BEFORE wo (bitnet.cpp:54).
          let attnCtx = ctx;
          if (op.w.attn_sub_norm) attnCtx = rmsNorm(ctx, getRow(store, W(op.w.attn_sub_norm), 0, load), op.attrs.subEps ?? eps);
          let attnOut = addBias(matvec(store, W(op.w.wo), attnCtx, load), W(op.w.bo), store, load);
          if (op.w.wo_s) scaleVec(attnOut, scalarOf(store, W(op.w.wo_s), load));
          env.set(op.out, attnOut);
          break;
        }
        case "mla_attn": {
          // Multi-head Latent Attention — decompression / MHA-equivalent path
          // (deepseek2.cpp !is_mla, lines 187-223). Low-rank Q and KV, decoupled NEOX
          // RoPE on the pe split, decompress KV via wkv_b, then standard cached MHA.
          const il = layerOf(op.out), a = op.attrs, x = env.get(op.in), p = pos + posOffset;
          if (opts.dbg) opts.dbg(`l${il}.mla_in`, x, pos);
          if (a.ropeScaling && a.ropeScaling !== "yarn") throw new Error(`mla_attn: rope scaling '${a.ropeScaling}' not supported (only plain NEOX + YaRN)`);
          const nh = a.n_head, hk = a.n_embd_head_k, hv = a.n_embd_head_v, nope = a.qk_nope, rope = a.qk_rope, kvl = a.kv_lora;
          const epsM = a.eps ?? eps, fb = a.freq_base, fs = a.freq_scale || 1;
          // Q: lite (wq) or LoRA (wq_a → q_a_norm → wq_b) → [nh*hk]
          let q;
          if (a.lite) q = matvec(store, W(op.w.q), x, load);
          else { const qa = rmsNorm(matvec(store, W(op.w.q_a), x, load), getRow(store, W(op.w.q_a_norm), 0, load), epsM); q = matvec(store, W(op.w.q_b), qa, load); }
          // KV compress: kv_a_mqa·x → [kv_lora | rope]; RMSNorm the compressed part
          const kvc = matvec(store, W(op.w.kv_a_mqa), x, load);
          const kvCmpr = rmsNorm(kvc.subarray(0, kvl), getRow(store, W(op.w.kv_a_norm), 0, load), epsM);
          // decoupled RoPE on q_pe (per head, rope tail) + k_pe (shared). YaRN when scaled.
          const qPe = new Float32Array(nh * rope);
          for (let h = 0; h < nh; h++) for (let d = 0; d < rope; d++) qPe[h * rope + d] = q[h * hk + nope + d];
          const kPeRaw = Float32Array.from(kvc.subarray(kvl, kvl + rope));
          let qPeR, kPeR, kqScale;
          if (a.ropeScaling === "yarn") {
            // ggml rope_yarn + llama-context attn_factor chain + deepseek2.cpp:19-29 mscale.
            const factor = a.yarnFactor, freqScale = 1 / factor, ext = 1.0, logMul = a.yarn_log_mul || 0, lf = Math.log(factor);
            const corrDim = (beta) => rope * Math.log(a.yarnOrigCtx / (beta * 2 * Math.PI)) / (2 * Math.log(fb));
            const lo = Math.max(0, Math.floor(corrDim(32))), hi = Math.min(rope - 1, Math.ceil(corrDim(1)));   // beta_fast=32, beta_slow=1
            const getMscale = (s, m) => s <= 1 ? 1 : (0.1 * m * Math.log(s) + 1);
            const mAll = logMul, mSc = (logMul !== 0 && mAll !== 1) ? mAll : 1;                                 // deepseek2 special-case
            let attnFactor = logMul !== 0 ? getMscale(factor, mSc) / getMscale(factor, mAll) : getMscale(factor, 1);
            if (ext !== 0) attnFactor *= 1 / (1 + 0.1 * lf);                                                    // [TAG_DEEPSEEK2_YARN_LOG_MUL_FIX]
            const ropeMscale = ext !== 0 ? attnFactor * (1 + 0.1 * lf) : attnFactor;                            // rope_yarn internal mscale adj
            const kqMscale = attnFactor * (1 + 0.1 * lf) * (1 + 0.1 * logMul * lf);                             // deepseek2.cpp:25,28
            kqScale = (kqMscale * kqMscale) / Math.sqrt(hk);
            const yp = { freqScale, extFactor: ext, lo, hi, mscale: ropeMscale };
            qPeR = ropeNormMla(qPe, p, rope, fb, rope, yp); kPeR = ropeNormMla(kPeRaw, p, rope, fb, rope, yp);
          } else {
            qPeR = ropeNormMla(qPe, p, rope, fb, rope, null); kPeR = ropeNormMla(kPeRaw, p, rope, fb, rope, null);
            const mscale = 1 + 0.1 * (a.yarn_log_mul || 0) * Math.log(1 / fs);
            kqScale = (mscale * mscale) / Math.sqrt(hk);
          }
          // decompress: wkv_b·kvCmpr → per head [k_nope(nope) | v(hv)]
          const kv = matvec(store, W(op.w.kv_b), kvCmpr, load), stepKV = nope + hv;
          const Kcur = new Float32Array(nh * hk), Vcur = new Float32Array(nh * hv), Qcur = new Float32Array(nh * hk);
          for (let h = 0; h < nh; h++) {
            for (let d = 0; d < nope; d++) { Kcur[h * hk + d] = kv[h * stepKV + d]; Qcur[h * hk + d] = q[h * hk + d]; }
            for (let d = 0; d < rope; d++) { Kcur[h * hk + nope + d] = kPeR[d]; Qcur[h * hk + nope + d] = qPeR[h * rope + d]; }
            for (let d = 0; d < hv; d++) Vcur[h * hv + d] = kv[h * stepKV + nope + d];
          }
          if (opts.dbg) { opts.dbg(`l${il}.q`, q, pos); opts.dbg(`l${il}.kvCmpr`, kvCmpr, pos); opts.dbg(`l${il}.Qcur`, Qcur, pos); opts.dbg(`l${il}.Kcur`, Kcur, pos); opts.dbg(`l${il}.Vcur`, Vcur, pos); opts.dbg(`l${il}.kqScale`, new Float32Array([kqScale]), pos); }
          Kc[il].push(Kcur); Vc[il].push(Vcur);
          const ctx = new Float32Array(nh * hv);
          for (let h = 0; h < nh; h++) {                          // MHA: each head attends its own K/V
            const scores = new Float32Array(pos + 1);
            for (let tp = 0; tp <= pos; tp++) { let s = 0.0; const Kt = Kc[il][tp]; for (let d = 0; d < hk; d++) s += fr(Qcur[h * hk + d] * Kt[h * hk + d]); scores[tp] = fr(s); }
            const pr = softmax(scores, kqScale);
            if (opts.dbg && il === 0 && h === 0 && pos === T - 1) { opts.dbg("l0.h0.scores", scores, pos); opts.dbg("l0.h0.weights", pr, pos); }
            for (let d = 0; d < hv; d++) { let acc = 0.0; for (let tp = 0; tp <= pos; tp++) acc += fr(pr[tp] * Vc[il][tp][h * hv + d]); ctx[h * hv + d] = fr(acc); }
          }
          if (opts.dbg) opts.dbg(`l${il}.ctx`, ctx, pos);
          env.set(op.out, matvec(store, W(op.w.wo), ctx, load));
          break;
        }
        case "add":
          env.set(op.out, addInto(env.get(op.in[0]), env.get(op.in[1])));
          break;
        case "ffn_swiglu": {
          const x = env.get(op.in);
          const g = matvec(store, W(op.w.gate), x, load), u = matvec(store, W(op.w.up), x, load);
          if (op.w.gate_s) { scaleVec(g, scalarOf(store, W(op.w.gate_s), load)); scaleVec(u, scalarOf(store, W(op.w.up_s), load)); }
          let act = op.attrs?.act === "gelu" ? geglu(g, u) : swiglu(g, u); // Gemma: GeGLU
          // BitNet ffn_sub_norm: RMSNorm on the activation BEFORE ffn_down (bitnet.cpp:88).
          if (op.w.ffn_sub_norm) act = rmsNorm(act, getRow(store, W(op.w.ffn_sub_norm), 0, load), op.attrs.subEps ?? eps);
          let ffnOut = matvec(store, W(op.w.down), act, load);
          if (op.w.down_s) scaleVec(ffnOut, scalarOf(store, W(op.w.down_s), load));
          env.set(op.out, ffnOut);
          break;
        }
        case "ffn_moe": {
          const x = env.get(op.in), a = op.attrs;
          if (opts.dbg) opts.dbg(`${op.out.split(".")[0]}.moe_in`, x, pos);
          if (a.groupCount > 1) throw new Error(`ffn_moe: group-topk (expert_group_count=${a.groupCount}) not yet implemented`);  // gate, don't mis-route
          // router: logits = gate_inp · x  → select top-k experts + combine weights.
          // DeepSeek-V3 adds exp_probs_b as a SELECTION bias (top-k only; weights stay unbiased).
          const logitsE = matvec(store, W(op.w.gate_inp), x, load);
          const selBias = op.w.exp_probs_b ? getRow(store, W(op.w.exp_probs_b), 0, load) : null;
          const { selected, weights } = moeRoute(logitsE, { gatingOp: a.gating, nExpertUsed: a.n_expert_used, normW: a.normW, wScale: a.wScale, selBias });
          if (opts.onExpertSelect) opts.onExpertSelect(op.out, selected);   // routed-expert set (for streaming/witness)
          if (opts.dbg) { const L = op.out.split(".")[0]; opts.dbg(`${L}.moesel`, Float32Array.from(selected), pos); opts.dbg(`${L}.moewt`, Float32Array.from(weights), pos); }
          const gW = W(op.w.gate_exps), uW = W(op.w.up_exps), dW = W(op.w.down_exps);
          const expertOuts = [];
          for (const e of selected) {                              // mul_mat_id per selected expert (sparse fetch via dir)
            const g = matvecExpert(store, gW, x, e, load, dir), u = matvecExpert(store, uW, x, e, load, dir);
            expertOuts.push(matvecExpert(store, dW, swiglu(g, u), e, load, dir));
          }
          let out = moeCombine(expertOuts, weights, x.length);     // Σ expert·weight
          if (opts.dbg) opts.dbg(`${op.out.split(".")[0]}.moe_out`, out, pos);
          if (a.shared) {                                          // shared expert (always-on)
            const g = matvec(store, W(op.w.gate_shexp), x, load), u = matvec(store, W(op.w.up_shexp), x, load);
            const sh = matvec(store, W(op.w.down_shexp), swiglu(g, u), load);
            if (opts.dbg) opts.dbg(`${op.out.split(".")[0]}.shexp`, sh, pos);
            if (a.sharedGate === false) for (let j = 0; j < out.length; j++) out[j] = fr(out[j] + sh[j]);  // DeepSeek: ungated add
            else { const gate = sigmoid(matvec(store, W(op.w.gate_inp_shexp), x, load)[0]); for (let j = 0; j < out.length; j++) out[j] = fr(out[j] + fr(sh[j] * gate)); }  // qwen2moe: sigmoid-gated
          }
          env.set(op.out, out);
          break;
        }
        case "mamba": {
          // Mamba-1 mixer (build_mamba_layer): in_proj → causal conv1d → x_proj
          // (Δt,B,C) → dt_proj → selective scan with recurrent state → D skip →
          // z-gate (silu) → out_proj. State is per-layer conv_state + ssm_state,
          // updated in place — one token at a time, exactly matching incremental decode.
          const a = op.attrs, il = a.layer, { d_conv, d_inner, d_state, dt_rank } = a;
          const x0 = env.get(op.in);
          // in_proj → [x | z]
          const xz = matvec(store, W(op.w.in), x0, load);
          const xin = xz.subarray(0, d_inner), z = xz.subarray(d_inner, 2 * d_inner);
          // lazily allocate recurrent state for this layer (zeros = fresh)
          if (!convState[il]) { convState[il] = new Float32Array(d_inner * (d_conv - 1)); ssmState[il] = new Float32Array(d_inner * d_state); }
          const cs = convState[il], ss = ssmState[il];
          // causal depthwise conv1d over the [conv_state ‖ x] window, then +bias, silu
          const cw = loadFull(store, W(op.w.conv1d), load);          // [d_inner,d_conv] row-major: cw[ch*d_conv+k]
          const cb = getRow(store, W(op.w.conv1d_b), 0, load);
          const rawc = ssmConv1d(xin, cs, cw, d_inner, d_conv);
          const xc = new Float32Array(d_inner);
          for (let ch = 0; ch < d_inner; ch++) xc[ch] = silu(fr(rawc[ch] + cb[ch]));
          // x_proj → Δt(rank), B(d_state), C(d_state); Δt = dt_proj·Δt + bias
          const xdb = matvec(store, W(op.w.x), xc, load);
          const B = xdb.subarray(dt_rank, dt_rank + d_state), C = xdb.subarray(dt_rank + d_state, dt_rank + 2 * d_state);
          const dt = matvec(store, W(op.w.dt), xdb.subarray(0, dt_rank), load), dtb = getRow(store, W(op.w.dt_b), 0, load);
          for (let h = 0; h < d_inner; h++) dt[h] = fr(dt[h] + dtb[h]);
          // selective scan (state updated in place), then D skip + z-gate
          const A = loadFull(store, W(op.w.a), load), D = loadFull(store, W(op.w.d), load); // A {d_state,d_inner}, D {d_inner}
          const yraw = selectiveScan(xc, dt, A, B, C, ss, d_inner, d_state);
          const y = new Float32Array(d_inner);
          for (let h = 0; h < d_inner; h++) y[h] = fr(silu(z[h]) * fr(yraw[h] + fr(xc[h] * D[h])));
          env.set(op.out, matvec(store, W(op.w.out), y, load)); // out_proj
          break;
        }
        case "mamba2": {
          // Mamba-2 mixer (build_mamba2_layer): in_proj→[z|xBC|Δt], conv1d over xBC
          // (x,B,C), scalar-decay selective scan, D skip, z-gate, grouped RMSNorm,
          // out_proj. n_head heads of head_dim; B/C shared per group.
          const a = op.attrs, il = a.layer, { d_conv, d_inner, d_state, n_head, head_dim, n_group } = a;
          const convCh = d_inner + 2 * n_group * d_state;
          const zxBCdt = matvec(store, W(op.w.in), env.get(op.in), load);
          const z = zxBCdt.subarray(0, d_inner), xBCin = zxBCdt.subarray(d_inner, d_inner + convCh), dtRaw = zxBCdt.subarray(d_inner + convCh, d_inner + convCh + n_head);
          if (!convState[il]) { convState[il] = new Float32Array(convCh * (d_conv - 1)); ssmState[il] = new Float32Array(n_head * head_dim * d_state); }
          const cs = convState[il], ss = ssmState[il];
          // conv1d over xBC, +bias, silu
          const cw = loadFull(store, W(op.w.conv1d), load), cb = getRow(store, W(op.w.conv1d_b), 0, load);
          const rawc = ssmConv1d(xBCin, cs, cw, convCh, d_conv), xbc = new Float32Array(convCh);
          for (let i = 0; i < convCh; i++) xbc[i] = silu(fr(rawc[i] + cb[i]));
          const x = xbc.subarray(0, d_inner), B = xbc.subarray(d_inner, d_inner + n_group * d_state), C = xbc.subarray(d_inner + n_group * d_state, d_inner + 2 * n_group * d_state);
          // Δt = in_proj Δt + bias ; scalar-decay scan
          const dtb = getRow(store, W(op.w.dt_b), 0, load), dt = new Float32Array(n_head);
          for (let h = 0; h < n_head; h++) dt[h] = fr(dtRaw[h] + dtb[h]);
          const A = loadFull(store, W(op.w.a), load), D = loadFull(store, W(op.w.d), load); // both {1,n_head}
          const yraw = selectiveScan2(x, dt, A, B, C, ss, n_head, head_dim, d_state, n_group);
          // D skip + z-gate
          const y = new Float32Array(d_inner);
          for (let h = 0; h < n_head; h++) for (let i1 = 0; i1 < head_dim; i1++) { const ii = i1 + h * head_dim; y[ii] = fr(silu(z[ii]) * fr(yraw[ii] + fr(x[ii] * D[h]))); }
          // grouped RMSNorm (per group of d_inner/n_group), then out_proj
          const gs = d_inner / n_group, nw = loadFull(store, W(op.w.norm), load), yn = new Float32Array(d_inner);
          for (let gp = 0; gp < n_group; gp++) yn.set(rmsNorm(y.subarray(gp * gs, (gp + 1) * gs), nw.subarray(gp * gs, (gp + 1) * gs), eps, gs), gp * gs);
          env.set(op.out, matvec(store, W(op.w.out), yn, load));
          break;
        }
        case "layer_norm": {
          const wt = getRow(store, W(op.w.weight), 0, load), bs = op.w.bias ? getRow(store, W(op.w.bias), 0, load) : null;
          env.set(op.out, layerNorm(env.get(op.in), wt, bs, op.attrs.eps));
          break;
        }
        case "rwkv7_tmix": {
          // RWKV7 time mixing (build_rwkv7_time_mix). cur = att_norm; x_prev = token-shift.
          const a = op.attrs, il = a.layer, { n_embd, head_size, head_count } = a, gate = !!op.w.g1;
          const cur = env.get(op.in);
          if (!attShift[il]) { attShift[il] = new Float32Array(n_embd); wkvState[il] = new Float32Array(head_count * head_size * head_size); }
          const xprev = attShift[il]; attShift[il] = cur.slice();           // shift: store current for next token
          const sx = new Float32Array(n_embd); for (let i = 0; i < n_embd; i++) sx[i] = fr(xprev[i] - cur[i]);
          const lf = loadVec(store, W(op.w.lerp_fused), load);              // [6][n_embd]
          const lerp = (c) => { const x = new Float32Array(n_embd); for (let i = 0; i < n_embd; i++) x[i] = fr(fr(sx[i] * lf[c * n_embd + i]) + cur[i]); return x; };
          const xr = lerp(0), xw = lerp(1), xk = lerp(2), xv = lerp(3), xa = lerp(4), xg = gate ? lerp(5) : null;
          const r = matvec(store, W(op.w.receptance), xr, load);
          // w = exp(sigmoid(w2·tanh(w1·xw) + w0) · -0.606531)
          const w1 = matvec(store, W(op.w.w1), xw, load); for (let i = 0; i < w1.length; i++) w1[i] = fr(Math.tanh(w1[i]));
          const w = matvec(store, W(op.w.w2), w1, load), w0 = getRow(store, W(op.w.w0), 0, load);
          for (let i = 0; i < n_embd; i++) w[i] = fr(Math.exp(fr(sigmoid(fr(w[i] + w0[i])) * -0.606531)));
          let k = matvec(store, W(op.w.key), xk, load);
          let v = matvec(store, W(op.w.value), xv, load);
          if (il === 0) env.set("__vfirst", v.slice());
          else {                                                            // value-residual mix
            const vf = env.get("__vfirst"), v1 = matvec(store, W(op.w.v1), xv, load), v2 = matvec(store, W(op.w.v2), v1, load), v0 = getRow(store, W(op.w.v0), 0, load);
            for (let i = 0; i < n_embd; i++) v[i] = fr(v[i] + fr(fr(vf[i] - v[i]) * sigmoid(fr(v2[i] + v0[i]))));
          }
          let g = null;
          if (gate) { const g1 = matvec(store, W(op.w.g1), xg, load); for (let i = 0; i < g1.length; i++) g1[i] = sigmoid(g1[i]); g = matvec(store, W(op.w.g2), g1, load); }
          // a (in-context learning rate)
          const a1 = matvec(store, W(op.w.a1), xa, load), a2 = matvec(store, W(op.w.a2), a1, load), a0 = getRow(store, W(op.w.a0), 0, load);
          const aa = new Float32Array(n_embd); for (let i = 0; i < n_embd; i++) aa[i] = sigmoid(fr(a2[i] + a0[i]));
          // kk = l2norm_per_head(k · k_k); k = k + k·k_a·(a−1)
          const kk_w = getRow(store, W(op.w.k_k), 0, load), ka_w = getRow(store, W(op.w.k_a), 0, load);
          const kk = new Float32Array(n_embd);
          for (let h = 0; h < head_count; h++) {
            let ss = 0.0; const ho = h * head_size;
            for (let i = 0; i < head_size; i++) { kk[ho + i] = fr(k[ho + i] * kk_w[ho + i]); ss += fr(kk[ho + i] * kk[ho + i]); }
            const sc = 1 / Math.max(Math.sqrt(ss), 1e-12);
            for (let i = 0; i < head_size; i++) kk[ho + i] = fr(kk[ho + i] * sc);
          }
          for (let i = 0; i < n_embd; i++) { const ka = fr(k[i] * ka_w[i]); k[i] = fr(k[i] + fr(ka * fr(aa[i] - 1))); }
          // WKV: a_in = −kk, b_in = kk·a
          const nkk = new Float32Array(n_embd), kka = new Float32Array(n_embd);
          for (let i = 0; i < n_embd; i++) { nkk[i] = fr(-kk[i]); kka[i] = fr(kk[i] * aa[i]); }
          let out = wkv7(r, w, k, v, nkk, kka, wkvState[il], head_count, head_size);
          // per-head group norm (eps 64e-5) then ·ln + ln_b
          const ln = getRow(store, W(op.w.ln), 0, load), lnb = getRow(store, W(op.w.ln_b), 0, load), gn = new Float32Array(n_embd);
          for (let h = 0; h < head_count; h++) {
            const ho = h * head_size; let m = 0; for (let i = 0; i < head_size; i++) m += out[ho + i]; m /= head_size;
            let v2 = 0; for (let i = 0; i < head_size; i++) { const d = out[ho + i] - m; v2 += d * d; } const sc = 1 / Math.sqrt(v2 / head_size + 64e-5);
            for (let i = 0; i < head_size; i++) gn[ho + i] = fr(out[ho + i] - m) * sc;
          }
          for (let i = 0; i < n_embd; i++) gn[i] = fr(fr(gn[i] * ln[i]) + lnb[i]);
          // r·k bonus: rk[h] = Σ_i k[i]·r[i]·r_k[i]; out += v·rk (per head)
          const rkw = getRow(store, W(op.w.r_k), 0, load);
          for (let h = 0; h < head_count; h++) {
            const ho = h * head_size; let rk = 0.0;
            for (let i = 0; i < head_size; i++) rk = fr(rk + fr(fr(k[ho + i] * r[ho + i]) * rkw[ho + i]));
            for (let i = 0; i < head_size; i++) gn[ho + i] = fr(gn[ho + i] + fr(v[ho + i] * rk));
          }
          if (gate) for (let i = 0; i < n_embd; i++) gn[i] = fr(gn[i] * g[i]);
          env.set(op.out, matvec(store, W(op.w.output), gn, load));
          break;
        }
        case "rwkv7_cmix": {
          // RWKV7 channel mixing: xk = lerp(x_prev,cur); k = relu(W_k·xk)²; out = W_v·k.
          const a = op.attrs, il = a.layer, n_embd = a.n_embd;
          const cur = env.get(op.in);
          if (!ffnShift[il]) ffnShift[il] = new Float32Array(n_embd);
          const xprev = ffnShift[il]; ffnShift[il] = cur.slice();
          const lk = getRow(store, W(op.w.lerp_k), 0, load), xk = new Float32Array(n_embd);
          for (let i = 0; i < n_embd; i++) xk[i] = fr(fr(fr(xprev[i] - cur[i]) * lk[i]) + cur[i]);
          const k = matvec(store, W(op.w.key), xk, load);
          for (let i = 0; i < k.length; i++) { const rl = k[i] > 0 ? k[i] : 0; k[i] = fr(rl * rl); } // relu²
          env.set(op.out, matvec(store, W(op.w.value), k, load));
          break;
        }
        case "lm_head": {
          logits = addBias(matvec(store, W(op.w.weight), env.get(op.in), load), W(op.w.bias), store, load);
          const sc = op.attrs?.softcap; // final logit soft-cap (Gemma2; usually absent in Gemma3)
          if (sc) for (let i = 0; i < logits.length; i++) logits[i] = fr(sc * Math.tanh(fr(logits[i] / sc)));
          break;
        }
      }
      if (opts.dbg && typeof op.out === "string" && env.has(op.out)) opts.dbg(op.out, env.get(op.out), pos);
    }
  }
  // expose the KV state (substrate-convergence: serializable, κ-addressable prefix state)
  if (opts.outKV) { opts.outKV.nLayer = n_layer; opts.outKV.nPos = T; opts.outKV.kvDim = n_head_kv * head_dim; opts.outKV.Kc = Kc; opts.outKV.Vc = Vc; }
  return logits;
}
