// Holo Moonshine — κ-forge Tier-A CPU oracle. Mirrors gguf-forge-whisper.mjs but for the Moonshine
// architecture (usefulsensors/moonshine): raw-audio conv stem (NO mel) → RoPE encoder → RoPE causal
// decoder + cross-attn + gated-SwiGLU → tied lm_head. Reads safetensors directly. Goal: reproduce the
// HF transformers reference token ids exactly (Tier-A bar). Verified stage-by-stage vs Python goldens.
//
// Arch (moonshine-tiny, from config.json + safetensors + HF modeling source):
//   S=288, heads=8, hd=36, enc/dec layers=6, enc FF=1152 (GELU), dec FF=1152 gated-SwiGLU (fc1→2304).
//   conv1(k127,s64)→tanh → GroupNorm(1) → conv2(k7,s3)→gelu → conv3(k3,s2)→gelu → permute → [frames,288].
//   LayerNorm bias=FALSE (centers, eps 1e-5). attention_bias=FALSE. scale=hd^-0.5. GELU=exact(erf).
//   RoPE: interleaved pairs (2j,2j+1), rotary_dim=int(36*0.9)=32 (first 32 dims), theta 1e4; on q,k of
//   self-attn only (enc + dec), NOT cross-attn. Decode: start=bos(1), stop=eos(2), argmax over full vocab.
import { readFileSync } from "node:fs";

const S = 288, H = 8, HD = 36, NL = 6, IFF = 1152, SCALE = 1 / Math.sqrt(HD);
const ROT = 32, THETA = 10000.0, EPS = 1e-5, BOS = 1, EOS = 2, VOCAB = 32768;

// exact GELU (erf) — Moonshine uses nn.functional.gelu (erf), NOT tanh. High-accuracy erfc via Chebyshev
// (Numerical Recipes 3rd ed, ~1e-12) instead of A&S 7.1.26 (1.5e-7): the A&S error compounds over layers
// and flips greedy tokens on uncertain audio (diagnosed: our 9.83% vs HF exact-erf 8.26% on the held-out set).
const _ERFC = [-1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2, -9.561514786808631e-3, -9.46595344482036e-4, 3.66839497852761e-4, 4.2523324806907e-5, -2.0278578112534e-5, -1.624290004647e-6, 1.303655835580e-6, 1.5626441722e-8, -8.5238095915e-8, 6.529054439e-9, 5.059343495e-9, -9.91364156e-10, -2.27365122e-10, 9.6467911e-11, 2.394038e-12, -6.886027e-12, 8.94487e-13, 3.13092e-13, -1.12708e-13, 3.81e-16, 7.106e-15];
function erfccheb(z) { let d = 0, dd = 0; const t = 2 / (2 + z), ty = 4 * t - 2; for (let j = _ERFC.length - 1; j > 0; j--) { const tmp = d; d = ty * d - dd + _ERFC[j]; dd = tmp; } return t * Math.exp(-z * z + 0.5 * (_ERFC[0] + ty * d) - dd); }
function erf(x) { return x >= 0 ? 1 - erfccheb(x) : erfccheb(-x) - 1; }
const gelu = (x) => 0.5 * x * (1 + erf(x * 0.7071067811865476));
const silu = (x) => x / (1 + Math.exp(-x));

export function readSafetensors(path) {
  const buf = readFileSync(path);
  const n = Number(buf.readBigUInt64LE(0)), hdr = JSON.parse(buf.toString("utf8", 8, 8 + n)), base = 8 + n, W = new Map();
  for (const [name, info] of Object.entries(hdr)) {
    if (name === "__metadata__") continue;
    const [s, e] = info.data_offsets, sl = buf.subarray(base + s, base + e).slice();   // copy → 4-aligned
    W.set(name, { shape: info.shape, data: new Float32Array(sl.buffer, sl.byteOffset, (e - s) >> 2) });
  }
  return W;
}
const G = (W, name) => { const t = W.get(name); if (!t) throw new Error("no tensor " + name); return t.data; };

// LayerNorm over last dim S, bias-false: y=(x-mean)/sqrt(var+eps)*w
function layerNorm(x, n, w) {
  const y = new Float32Array(n * S);
  for (let r = 0; r < n; r++) { const b = r * S; let m = 0; for (let i = 0; i < S; i++) m += x[b + i]; m /= S; let v = 0; for (let i = 0; i < S; i++) { const d = x[b + i] - m; v += d * d; } v /= S; const sc = 1 / Math.sqrt(v + EPS); for (let i = 0; i < S; i++) y[b + i] = (x[b + i] - m) * sc * w[i]; }
  return y;
}
// y[r,o] = bias?[o] + Σ_i x[r,i]·W[o,i]  (W row-major [outD,inD])
function linear(x, n, inD, outD, w, bias) {
  const y = new Float32Array(n * outD);
  for (let r = 0; r < n; r++) { const xb = r * inD; for (let o = 0; o < outD; o++) { let s = bias ? bias[o] : 0; const wb = o * inD; for (let i = 0; i < inD; i++) s += x[xb + i] * w[wb + i]; y[r * outD + o] = s; } }
  return y;
}
// conv1d: inp[Cin,L], w[Cout,Cin,K], stride, pad=0 → [Cout,Lout]
function conv1d(inp, Cin, L, w, Cout, K, bias, stride) {
  const Lout = ((L - K) / stride | 0) + 1, y = new Float32Array(Cout * Lout);
  for (let oc = 0; oc < Cout; oc++) { const wb = oc * Cin * K; for (let ol = 0; ol < Lout; ol++) { let s = bias ? bias[oc] : 0; const st = ol * stride; for (let ic = 0; ic < Cin; ic++) { const ib = ic * L, wcb = wb + ic * K; for (let k = 0; k < K; k++) s += inp[ib + st + k] * w[wcb + k]; } y[oc * Lout + ol] = s; } }
  return { y, Lout };
}
// GroupNorm(num_groups=1) over [C,T]: mean/var over ALL C·T, then per-channel scale+bias
function groupNorm1(x, C, T, w, b) {
  const N = C * T; let m = 0; for (let i = 0; i < N; i++) m += x[i]; m /= N; let v = 0; for (let i = 0; i < N; i++) { const d = x[i] - m; v += d * d; } v /= N; const sc = 1 / Math.sqrt(v + EPS);
  const y = new Float32Array(N); for (let c = 0; c < C; c++) for (let t = 0; t < T; t++) y[c * T + t] = (x[c * T + t] - m) * sc * w[c] + b[c];
  return y;
}
// interleaved partial RoPE in-place on q/k [n, S=H·HD]; rotate pairs (2j,2j+1) for j<ROT/2; position=row
function rope(vec, n) {
  const half = ROT / 2;
  for (let p = 0; p < n; p++) for (let h = 0; h < H; h++) { const base = p * S + h * HD;
    for (let j = 0; j < half; j++) { const ang = p * Math.pow(THETA, -(2 * j) / ROT), c = Math.cos(ang), s = Math.sin(ang); const i0 = base + 2 * j, i1 = i0 + 1, a = vec[i0], b = vec[i1]; vec[i0] = a * c - b * s; vec[i1] = b * c + a * s; }
  }
}
// multi-head attention; causal optional. q[nQ,S], k/v[nK,S] → [nQ,S]
function attend(q, nQ, k, v, nK, causal) {
  const out = new Float32Array(nQ * S);
  for (let h = 0; h < H; h++) { const ho = h * HD;
    for (let i = 0; i < nQ; i++) { const lim = causal ? i + 1 : nK, qb = i * S + ho, sc = new Float64Array(lim); let mx = -Infinity;
      for (let j = 0; j < lim; j++) { let s = 0; const kb = j * S + ho; for (let d = 0; d < HD; d++) s += q[qb + d] * k[kb + d]; s *= SCALE; sc[j] = s; if (s > mx) mx = s; }
      let den = 0; for (let j = 0; j < lim; j++) { sc[j] = Math.exp(sc[j] - mx); den += sc[j]; }
      const ob = i * S + ho; for (let d = 0; d < HD; d++) { let a = 0; for (let j = 0; j < lim; j++) a += sc[j] * v[j * S + ho + d]; out[ob + d] = a / den; }
    }
  }
  return out;
}
const addInto = (x, y) => { for (let i = 0; i < x.length; i++) x[i] += y[i]; };

// raw PCM(16k) → conv stem → [frames, S]; returns stage tensors for witnessing
export function moonshineConvStem(W, pcm) {
  const c1 = conv1d(pcm, 1, pcm.length, G(W, "model.encoder.conv1.weight"), S, 127, null, 64);  // [288,T1]
  const t = new Float32Array(c1.y.length); for (let i = 0; i < t.length; i++) t[i] = Math.tanh(c1.y[i]);
  const gn = groupNorm1(t, S, c1.Lout, G(W, "model.encoder.groupnorm.weight"), G(W, "model.encoder.groupnorm.bias"));
  const c2 = conv1d(gn, S, c1.Lout, G(W, "model.encoder.conv2.weight"), 576, 7, G(W, "model.encoder.conv2.bias"), 3); // [576,T2]
  const g2 = new Float32Array(c2.y.length); for (let i = 0; i < g2.length; i++) g2[i] = gelu(c2.y[i]);
  const c3 = conv1d(g2, 576, c2.Lout, G(W, "model.encoder.conv3.weight"), S, 3, G(W, "model.encoder.conv3.bias"), 2); // [288,T3]
  const frames = c3.Lout, x0 = new Float32Array(frames * S);
  for (let c = 0; c < S; c++) for (let f = 0; f < frames; f++) x0[f * S + c] = gelu(c3.y[c * frames + f]);   // gelu + permute→[frames,S]
  return { x0, frames, conv1: c1.y, conv2: c2.y, conv3: c3.y };
}

export function moonshineEncoder(W, x0, frames) {
  let x = x0.slice();
  for (let il = 0; il < NL; il++) {
    const p = `model.encoder.layers.${il}.`;
    const an = layerNorm(x, frames, G(W, p + "input_layernorm.weight"));
    const q = linear(an, frames, S, S, G(W, p + "self_attn.q_proj.weight"), null);
    const k = linear(an, frames, S, S, G(W, p + "self_attn.k_proj.weight"), null);
    const v = linear(an, frames, S, S, G(W, p + "self_attn.v_proj.weight"), null);
    rope(q, frames); rope(k, frames);
    const ao = linear(attend(q, frames, k, v, frames, false), frames, S, S, G(W, p + "self_attn.o_proj.weight"), null);
    addInto(x, ao);
    const mn = layerNorm(x, frames, G(W, p + "post_attention_layernorm.weight"));
    const h1 = linear(mn, frames, S, IFF, G(W, p + "mlp.fc1.weight"), G(W, p + "mlp.fc1.bias"));
    for (let i = 0; i < h1.length; i++) h1[i] = gelu(h1[i]);
    addInto(x, linear(h1, frames, IFF, S, G(W, p + "mlp.fc2.weight"), G(W, p + "mlp.fc2.bias")));
  }
  return layerNorm(x, frames, G(W, "model.encoder.layer_norm.weight"));
}

// last-position logits for a decoder prompt seq (full-prefix recompute; causal). Reuses precomputed cross K/V.
function decoderLogits(W, enc, frames, cK, cV, embed, seq) {
  const n = seq.length, x = new Float32Array(n * S);
  for (let p = 0; p < n; p++) { const tb = seq[p] * S; for (let d = 0; d < S; d++) x[p * S + d] = embed[tb + d]; }
  for (let il = 0; il < NL; il++) {
    const p = `model.decoder.layers.${il}.`;
    const an = layerNorm(x, n, G(W, p + "input_layernorm.weight"));
    const q = linear(an, n, S, S, G(W, p + "self_attn.q_proj.weight"), null);
    const k = linear(an, n, S, S, G(W, p + "self_attn.k_proj.weight"), null);
    const v = linear(an, n, S, S, G(W, p + "self_attn.v_proj.weight"), null);
    rope(q, n); rope(k, n);
    addInto(x, linear(attend(q, n, k, v, n, true), n, S, S, G(W, p + "self_attn.o_proj.weight"), null));
    const cn = layerNorm(x, n, G(W, p + "post_attention_layernorm.weight"));
    const cq = linear(cn, n, S, S, G(W, p + "encoder_attn.q_proj.weight"), null);   // cross-attn: NO rope
    addInto(x, linear(attend(cq, n, cK[il], cV[il], frames, false), n, S, S, G(W, p + "encoder_attn.o_proj.weight"), null));
    const fn = layerNorm(x, n, G(W, p + "final_layernorm.weight"));
    const h1 = linear(fn, n, S, 2 * IFF, G(W, p + "mlp.fc1.weight"), G(W, p + "mlp.fc1.bias"));   // gated SwiGLU
    const g = new Float32Array(n * IFF);
    for (let r = 0; r < n; r++) for (let o = 0; o < IFF; o++) g[r * IFF + o] = silu(h1[r * 2 * IFF + IFF + o]) * h1[r * 2 * IFF + o];
    addInto(x, linear(g, n, IFF, S, G(W, p + "mlp.fc2.weight"), G(W, p + "mlp.fc2.bias")));
  }
  const fn = layerNorm(x, n, G(W, "model.decoder.norm.weight"));
  const last = fn.subarray((n - 1) * S, n * S), logits = new Float32Array(VOCAB);
  for (let v = 0; v < VOCAB; v++) { let s = 0; const eb = v * S; for (let d = 0; d < S; d++) s += last[d] * embed[eb + d]; logits[v] = s; }
  return logits;
}

export function moonshineDecodeGreedy(W, enc, frames, { maxNew = 200 } = {}) {
  const embed = G(W, "model.decoder.embed_tokens.weight"), cK = [], cV = [];
  for (let il = 0; il < NL; il++) { const p = `model.decoder.layers.${il}.`; cK[il] = linear(enc, frames, S, S, G(W, p + "encoder_attn.k_proj.weight"), null); cV[il] = linear(enc, frames, S, S, G(W, p + "encoder_attn.v_proj.weight"), null); }
  const seq = [BOS], gen = [];
  while (gen.length < maxNew) {
    const logits = decoderLogits(W, enc, frames, cK, cV, embed, seq);
    let best = -1, bv = -Infinity; for (let v = 0; v < VOCAB; v++) if (logits[v] > bv) { bv = logits[v]; best = v; }
    if (best === EOS) break; gen.push(best); seq.push(best);
  }
  return gen;
}
// first-step logits (bos prompt) — for the logits0 witness
export function moonshineFirstLogits(W, enc, frames) {
  const embed = G(W, "model.decoder.embed_tokens.weight"), cK = [], cV = [];
  for (let il = 0; il < NL; il++) { const p = `model.decoder.layers.${il}.`; cK[il] = linear(enc, frames, S, S, G(W, p + "encoder_attn.k_proj.weight"), null); cV[il] = linear(enc, frames, S, S, G(W, p + "encoder_attn.v_proj.weight"), null); }
  return decoderLogits(W, enc, frames, cK, cV, embed, [BOS]);
}
export const MOON = { S, H, HD, NL, IFF, ROT, THETA, BOS, EOS, VOCAB };
