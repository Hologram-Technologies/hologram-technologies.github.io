// Holo Whisper — S0: legacy-ggml format reader + κ-forge.
//
// Whisper ships in whisper.cpp's LEGACY ggml container (magic 0x67676d6c), NOT GGUF.
// Layout (all little-endian, NO inter-tensor alignment):
//   magic:u32
//   hparams: 11×i32 = n_vocab, n_audio_ctx, n_audio_state, n_audio_head, n_audio_layer,
//                     n_text_ctx, n_text_state, n_text_head, n_text_layer, n_mels, ftype
//   mel:     n_mel:i32, n_fft:i32, filters[n_mel*n_fft]:f32
//   vocab:   n_vocab:i32, then n_vocab × (len:i32, bytes[len])
//   tensors (until EOF): n_dims:i32, name_len:i32, ttype:i32, ne[n_dims]:i32, name[name_len], data
//
// Forging mirrors forgeGguf: each tensor's EXACT bytes are one κ-object (verbatim,
// no re-quant), the plan is the sealed manifest, rootKappa = did:holo over its JCS.

import { sha256hex, sriOf, kappa, didHolo, jcs } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";
import { ggmlNBytes, GGML_TYPE_NAME, loadByKappa } from "./gguf-forge.mjs";
import { dequantizeExact } from "./gguf-forge-dequant.mjs";
import { conv1d, gelu, layerNorm, softmax } from "./gguf-forge-kernels.mjs";

const fr = Math.fround;
const LN_EPS = 1e-5; // Whisper LayerNorm epsilon (torch default)

const WHISPER_MAGIC = 0x67676d6c;
const HPARAM_KEYS = ["n_vocab", "n_audio_ctx", "n_audio_state", "n_audio_head", "n_audio_layer",
  "n_text_ctx", "n_text_state", "n_text_head", "n_text_layer", "n_mels", "ftype"];

// Parse the legacy-ggml header into { hparams, mel, vocab, tensors }. Records byte
// offsets/spans (no large copies). `wantVocab` controls whether token bytes are kept.
export function parseWhisperHeader(bytes, { wantVocab = false } = {}) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const i32 = () => { const v = dv.getInt32(o, true); o += 4; return v; };
  if ((dv.getUint32(o, true)) !== WHISPER_MAGIC) throw new Error(`whisper: bad magic 0x${dv.getUint32(o, true).toString(16)} (want ggml)`);
  o += 4;

  const hparams = {}; for (const k of HPARAM_KEYS) hparams[k] = i32();

  const n_mel = i32(), n_fft = i32();
  const mel = { n_mel, n_fft, offset: o, nbytes: n_mel * n_fft * 4 };
  o += mel.nbytes;

  const nVocab = i32();
  const vocab = { count: nVocab, tokens: wantVocab ? [] : null };
  for (let i = 0; i < nVocab; i++) {
    const len = i32();
    if (wantVocab) vocab.tokens.push(bytes.subarray(o, o + len));
    o += len;
  }

  const tensors = [];
  while (o < bytes.byteLength) {
    const n_dims = i32(), name_len = i32(), ttype = i32();
    const ne = []; for (let d = 0; d < n_dims; d++) ne.push(i32());
    const name = new TextDecoder().decode(bytes.subarray(o, o + name_len)); o += name_len;
    const nElems = ne.reduce((a, b) => a * b, 1);
    const nbytes = ggmlNBytes(ttype, nElems);
    if (o + nbytes > bytes.byteLength) throw new Error(`whisper: tensor ${name} runs past EOF (${o + nbytes} > ${bytes.byteLength})`);
    tensors.push({ name, dims: ne, type: ttype, offset: o, nbytes });
    o += nbytes;
  }
  if (o !== bytes.byteLength) throw new Error(`whisper: trailing ${bytes.byteLength - o} bytes — format drift (alignment?)`);
  return { hparams, mel, vocab, tensors, bytesConsumed: o };
}

// Forge a whole in-memory whisper model (Uint8Array) into κ-objects + sealed plan.
export function forgeWhisper(bytes) {
  const { hparams, mel, vocab, tensors } = parseWhisperHeader(bytes);
  const blocks = new Map();
  const planTensors = [];
  for (const t of tensors) {
    const blob = bytes.subarray(t.offset, t.offset + t.nbytes); // EXACT bytes = the κ-object
    const hex = sha256hex(blob);
    if (!blocks.has(hex)) blocks.set(hex, blob.slice());        // own bytes; L2 dedup by content
    planTensors.push({
      name: t.name, dims: t.dims, type: t.type, typeName: GGML_TYPE_NAME[t.type] || String(t.type),
      nbytes: t.nbytes, kappa: kappa("sha256", hex), sri: sriOf(blob),
    });
  }
  // Mel filterbank is a fixed model asset (used by the preprocessor) → its own κ.
  const melBlob = bytes.subarray(mel.offset, mel.offset + mel.nbytes);
  const melHex = sha256hex(melBlob);
  if (!blocks.has(melHex)) blocks.set(melHex, melBlob.slice());

  const plan = {
    format: "holo-whisper/1",
    arch: "whisper",
    hparams,
    mel: { n_mel: mel.n_mel, n_fft: mel.n_fft, kappa: kappa("sha256", melHex), nbytes: mel.nbytes },
    vocabCount: vocab.count,
    tensors: planTensors,
  };
  const rootKappa = didHolo("sha256", sha256hex(jcs(plan)));
  return { hparams, mel, vocabCount: vocab.count, tensors: planTensors, blocks, plan, rootKappa };
}

// ── S1: audio → log-mel spectrogram ──
// Parse a PCM16 mono WAV → Float32 samples in [-1,1] (skips to the `data` chunk).
export function readWavPCM16(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 12; // past RIFF/size/WAVE
  while (o + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    const sz = dv.getUint32(o + 4, true);
    if (id === "data") { const n = sz >> 1, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = dv.getInt16(o + 8 + i * 2, true) / 32768; return x; }
    o += 8 + sz + (sz & 1);
  }
  throw new Error("wav: no data chunk");
}

// Whisper log-mel (matches whisper.cpp log_mel_spectrogram): periodic Hann window,
// n_fft=400, hop=160; |DFT|² over 201 bins; mel filterbank (stored); log10 + the
// (max−8)/((+4)/4) normalization. Pads/truncates to 30 s = 480000 samples → 3000
// frames. Returns mel [n_mel, n_frames] (mel[k*nFrames+f]) — the conv-stem input.
export function logMelSpectrogram(samples, filters, { nMel = 80, nFft = 400, hop = 160, nBins = 201, nSamples = 480000 } = {}) {
  const x = new Float32Array(nSamples + nFft); x.set(samples.subarray(0, Math.min(samples.length, nSamples))); // +nFft tail pad
  const nFrames = (nSamples / hop) | 0;
  const hann = new Float32Array(nFft); for (let i = 0; i < nFft; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nFft);
  // DFT cos/sin tables: cosT[bin*nFft+n]
  const cosT = new Float32Array(nBins * nFft), sinT = new Float32Array(nBins * nFft);
  for (let b = 0; b < nBins; b++) for (let n = 0; n < nFft; n++) { const a = (-2 * Math.PI * b * n) / nFft; cosT[b * nFft + n] = Math.cos(a); sinT[b * nFft + n] = Math.sin(a); }
  const mel = new Float32Array(nMel * nFrames), win = new Float32Array(nFft), pw = new Float64Array(nBins);
  let mmax = -Infinity;
  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    for (let n = 0; n < nFft; n++) win[n] = hann[n] * x[off + n];   // off+n < nSamples always (last frame off=479840)
    // power spectrum |DFT|² computed ONCE per frame (was recomputed inside the per-mel loop —
    // an 80× redundancy). Same arithmetic + accumulation order ⇒ bit-identical mel, ~80× faster.
    for (let b = 0; b < nBins; b++) { let re = 0.0, im = 0.0; const tb = b * nFft; for (let n = 0; n < nFft; n++) { re += win[n] * cosT[tb + n]; im += win[n] * sinT[tb + n]; } pw[b] = re * re + im * im; }
    for (let k = 0; k < nMel; k++) {
      let s = 0.0; const fb = k * nBins;
      for (let b = 0; b < nBins; b++) s += filters[fb + b] * pw[b];
      let lv = Math.log10(Math.max(s, 1e-10));
      mel[k * nFrames + f] = lv; if (lv > mmax) mmax = lv;
    }
  }
  const floor = mmax - 8.0;
  for (let i = 0; i < mel.length; i++) mel[i] = (Math.max(mel[i], floor) + 4.0) / 4.0;
  return { mel, nFrames, nMel };
}

// Load the stored mel filterbank (κ in the plan) as f32 [nMel*nBins].
export function whisperMelFilters(plan, store) {
  return dequantizeExact(0, loadByKappa(store, plan.mel.kappa), plan.mel.n_mel * plan.mel.n_fft);
}

// ── S2: audio conv stem ──
// Load a forged tensor's full f32 values by name (L5-verified via loadByKappa).
function tensorF32(plan, store, name) {
  const t = plan.tensors.find((x) => x.name === name);
  if (!t) throw new Error(`whisper: no tensor ${name}`);
  return dequantizeExact(t.type, loadByKappa(store, t.kappa), t.dims.reduce((a, b) => a * b, 1));
}

// Whisper audio front-end (AudioEncoder stem): log-mel [n_mels, n_frames] →
//   Conv1d(k3,s1,p1)·+bias·GELU → Conv1d(k3,s2,p1)·+bias·GELU → transpose → +pos_embd
// → encoder input [n_audio_ctx, n_audio_state] (one 768-vec per audio position).
// conv weights are stored F16 (already F16-valued); ggml rounds the conv INPUT to F16
// (handled inside conv1d). pos_embd is a stored tensor — no sinusoid computed.
export function whisperConvStem(plan, store, mel) {
  const { n_mels, n_audio_state: S } = plan.hparams;
  const nFrames = mel.length / n_mels;                      // 3000
  const w1 = tensorF32(plan, store, "encoder.conv1.weight"), b1 = tensorF32(plan, store, "encoder.conv1.bias");
  const w2 = tensorF32(plan, store, "encoder.conv2.weight"), b2 = tensorF32(plan, store, "encoder.conv2.bias");
  const pos = tensorF32(plan, store, "encoder.positional_embedding");

  const c1 = conv1d(mel, w1, n_mels, S, 3, nFrames, 1, 1);   // [S, nFrames]
  for (let oc = 0; oc < S; oc++) for (let l = 0; l < nFrames; l++) { const i = oc * nFrames + l; c1[i] = gelu(fr(c1[i] + b1[oc])); }

  const OL = (((nFrames - 1) / 2) | 0) + 1;                  // 1500 = n_audio_ctx
  const c2 = conv1d(c1, w2, S, S, 3, nFrames, 2, 1);         // [S, OL]
  for (let oc = 0; oc < S; oc++) for (let l = 0; l < OL; l++) { const i = oc * OL + l; c2[i] = gelu(fr(c2[i] + b2[oc])); }

  const x = new Float32Array(OL * S);                        // transpose [S,OL]→[OL,S], + pos
  for (let p = 0; p < OL; p++) for (let d = 0; d < S; d++) x[p * S + d] = fr(c2[d * OL + p] + pos[p * S + d]);
  return { x, n_ctx: OL, n_state: S };
}

// ── S3: audio encoder ──
// Batched linear: X[n,inDim] · W[outDim,inDim] (+bias) → Y[n,outDim]. W stored
// [out,in] (ggml ne [in,out]: W[o*inDim+i]); pre-dequantized f32.
function linear(X, n, W, inDim, outDim, bias) {
  const Y = new Float32Array(n * outDim);
  for (let p = 0; p < n; p++) {
    const xb = p * inDim;
    for (let o = 0; o < outDim; o++) {
      let s = bias ? bias[o] : 0.0; const wb = o * inDim;
      for (let i = 0; i < inDim; i++) s = fr(s + fr(X[xb + i] * W[wb + i]));
      Y[p * outDim + o] = fr(s);
    }
  }
  return Y;
}
// LayerNorm every row (position) of X[n,S].
function lnRows(X, n, S, w, b) {
  const Y = new Float32Array(n * S);
  for (let p = 0; p < n; p++) Y.set(layerNorm(X.subarray(p * S, p * S + S), w, b, LN_EPS, S), p * S);
  return Y;
}
// Non-causal multi-head self-attention: q,k,v are [n, H*hd]; every query attends to
// ALL keys (no causal mask — bidirectional encoder). scale = 1/√hd. → ctx [n, H*hd].
function mha(q, k, v, n, H, hd, scale) {
  const S = H * hd, out = new Float32Array(n * S);
  for (let h = 0; h < H; h++) {
    const ho = h * hd;
    for (let i = 0; i < n; i++) {
      const scores = new Float32Array(n), qb = i * S + ho;
      for (let j = 0; j < n; j++) { let s = 0.0; const kb = j * S + ho; for (let d = 0; d < hd; d++) s = fr(s + fr(q[qb + d] * k[kb + d])); scores[j] = fr(s); }
      const pr = softmax(scores, scale);
      const ob = i * S + ho;
      for (let d = 0; d < hd; d++) { let acc = 0.0; for (let j = 0; j < n; j++) acc = fr(acc + fr(pr[j] * v[j * S + ho + d])); out[ob + d] = fr(acc); }
    }
  }
  return out;
}

// Whisper audio encoder: x [n_ctx, n_audio_state] → encoder output [n_ctx, n_audio_state].
// Per block: x += attn(LN(x)); x += mlp(LN(x)). attn is NON-causal; K proj has no bias.
// Final encoder.ln_post. (Linears are f32 here — Tier-B; f16-activation rounding to match
// ggml mul_mat is a later tightening, like the LLM integer-dot path.)
export function whisperEncoder(plan, store, x0, n_ctx, { nLayers } = {}) {
  const { n_audio_state: S, n_audio_head: H, n_audio_layer: NL } = plan.hparams;
  const hd = S / H, scale = 1 / Math.sqrt(hd), FF = 4 * S;
  const D = (name) => tensorF32(plan, store, name);
  let x = Float32Array.from(x0);
  const last = nLayers ?? NL;                                  // optional cap (for fast large-model smoke runs)
  for (let il = 0; il < last; il++) {
    const p = `encoder.blocks.${il}.`;
    const an = lnRows(x, n_ctx, S, D(p + "attn_ln.weight"), D(p + "attn_ln.bias"));
    const q = linear(an, n_ctx, D(p + "attn.query.weight"), S, S, D(p + "attn.query.bias"));
    const k = linear(an, n_ctx, D(p + "attn.key.weight"), S, S, null);          // K: no bias (Whisper quirk)
    const v = linear(an, n_ctx, D(p + "attn.value.weight"), S, S, D(p + "attn.value.bias"));
    const ao = linear(mha(q, k, v, n_ctx, H, hd, scale), n_ctx, D(p + "attn.out.weight"), S, S, D(p + "attn.out.bias"));
    for (let i = 0; i < x.length; i++) x[i] = fr(x[i] + ao[i]);
    const mn = lnRows(x, n_ctx, S, D(p + "mlp_ln.weight"), D(p + "mlp_ln.bias"));
    const h1 = linear(mn, n_ctx, D(p + "mlp.0.weight"), S, FF, D(p + "mlp.0.bias"));
    for (let i = 0; i < h1.length; i++) h1[i] = gelu(h1[i]);
    const h2 = linear(h1, n_ctx, D(p + "mlp.2.weight"), FF, S, D(p + "mlp.2.bias"));
    for (let i = 0; i < x.length; i++) x[i] = fr(x[i] + h2[i]);
  }
  return lnRows(x, n_ctx, S, D("encoder.ln_post.weight"), D("encoder.ln_post.bias"));
}

// ── S4: cross-attention + decoder ──
// General attention: q [nQ,H*hd], k/v [nK,H*hd] → out [nQ,H*hd]. causal → query i sees
// keys 0..i (self-attn); else all nK keys (encoder self / cross-attn). Covers all three.
function attend(q, k, v, nQ, nK, H, hd, scale, causal) {
  const Sd = H * hd, out = new Float32Array(nQ * Sd);
  for (let h = 0; h < H; h++) {
    const ho = h * hd;
    for (let i = 0; i < nQ; i++) {
      const lim = causal ? i + 1 : nK, scores = new Float32Array(lim), qb = i * Sd + ho;
      for (let j = 0; j < lim; j++) { let s = 0.0; const kb = j * Sd + ho; for (let d = 0; d < hd; d++) s = fr(s + fr(q[qb + d] * k[kb + d])); scores[j] = fr(s); }
      const pr = softmax(scores, scale), ob = i * Sd + ho;
      for (let d = 0; d < hd; d++) { let acc = 0.0; for (let j = 0; j < lim; j++) acc = fr(acc + fr(pr[j] * v[j * Sd + ho + d])); out[ob + d] = fr(acc); }
    }
  }
  return out;
}

// Whisper text decoder over a token sequence (prefill). Returns last-position logits.
// Per block: x += self_attn(LN(x), causal); x += cross_attn(LN(x), encoder K/V);
// x += mlp(LN(x)). Cross-attn K/V depend only on the encoder output → computed ONCE
// per layer. Final decoder.ln; logits via tied token_embedding. (K projections: no bias.)
export function whisperDecoder(plan, store, tokenIds, encoderOut, n_enc) {
  const { n_text_state: S, n_text_head: H, n_text_layer: NL, n_vocab } = plan.hparams;
  const hd = S / H, scale = 1 / Math.sqrt(hd), FF = 4 * S, N = tokenIds.length;
  const D = (name) => tensorF32(plan, store, name);
  const tokEmb = D("decoder.token_embedding.weight"), posEmb = D("decoder.positional_embedding");
  const x = new Float32Array(N * S);
  for (let p = 0; p < N; p++) for (let d = 0; d < S; d++) x[p * S + d] = fr(tokEmb[tokenIds[p] * S + d] + posEmb[p * S + d]);

  for (let il = 0; il < NL; il++) {
    const p = `decoder.blocks.${il}.`;
    // cross-attn K/V from the encoder output (constant across decode steps)
    const cK = linear(encoderOut, n_enc, D(p + "cross_attn.key.weight"), S, S, null);
    const cV = linear(encoderOut, n_enc, D(p + "cross_attn.value.weight"), S, S, D(p + "cross_attn.value.bias"));
    // causal self-attention
    const an = lnRows(x, N, S, D(p + "attn_ln.weight"), D(p + "attn_ln.bias"));
    const q = linear(an, N, D(p + "attn.query.weight"), S, S, D(p + "attn.query.bias"));
    const k = linear(an, N, D(p + "attn.key.weight"), S, S, null);
    const v = linear(an, N, D(p + "attn.value.weight"), S, S, D(p + "attn.value.bias"));
    const so = linear(attend(q, k, v, N, N, H, hd, scale, true), N, D(p + "attn.out.weight"), S, S, D(p + "attn.out.bias"));
    for (let i = 0; i < x.length; i++) x[i] = fr(x[i] + so[i]);
    // cross-attention (decoder Q × encoder K/V, non-causal)
    const cn = lnRows(x, N, S, D(p + "cross_attn_ln.weight"), D(p + "cross_attn_ln.bias"));
    const cq = linear(cn, N, D(p + "cross_attn.query.weight"), S, S, D(p + "cross_attn.query.bias"));
    const co = linear(attend(cq, cK, cV, N, n_enc, H, hd, scale, false), N, D(p + "cross_attn.out.weight"), S, S, D(p + "cross_attn.out.bias"));
    for (let i = 0; i < x.length; i++) x[i] = fr(x[i] + co[i]);
    // mlp
    const mn = lnRows(x, N, S, D(p + "mlp_ln.weight"), D(p + "mlp_ln.bias"));
    const h1 = linear(mn, N, D(p + "mlp.0.weight"), S, FF, D(p + "mlp.0.bias"));
    for (let i = 0; i < h1.length; i++) h1[i] = gelu(h1[i]);
    const h2 = linear(h1, N, D(p + "mlp.2.weight"), FF, S, D(p + "mlp.2.bias"));
    for (let i = 0; i < x.length; i++) x[i] = fr(x[i] + h2[i]);
  }
  const fn = lnRows(x, N, S, D("decoder.ln.weight"), D("decoder.ln.bias"));
  const last = fn.subarray((N - 1) * S, N * S), logits = new Float32Array(n_vocab); // tied lm_head
  for (let tk = 0; tk < n_vocab; tk++) { let s = 0.0; const tb = tk * S; for (let d = 0; d < S; d++) s = fr(s + fr(last[d] * tokEmb[tb + d])); logits[tk] = s; }
  return logits;
}

// ── S5: greedy decode (cached) + detokenize ──
// Whisper special tokens. EOT/SOT/first-language are fixed; the rest float with the
// vocab size (large-v3 added a language → +1 shift). Derive everything from n_vocab so
// the same code is correct for tiny…large-v3: timestamp_begin = n_vocab − 1501.
export function whisperSpecials(nVocab) {
  const TS_BEGIN = nVocab - 1501;
  return { EOT: 50257, SOT: 50258, LANG_EN: 50259, TRANSLATE: TS_BEGIN - 6, TRANSCRIBE: TS_BEGIN - 5, NO_TIMESTAMPS: TS_BEGIN - 1, TS_BEGIN };
}

const oneAttn = (q, Kc, Vc, nK, H, hd, scale) => { // single-query attention over cached/encoder K,V
  const S = H * hd, out = new Float32Array(S);
  for (let h = 0; h < H; h++) {
    const ho = h * hd, scores = new Float32Array(nK);
    for (let j = 0; j < nK; j++) { let s = 0.0; const kb = j * S + ho; for (let d = 0; d < hd; d++) s = fr(s + fr(q[ho + d] * Kc[kb + d])); scores[j] = fr(s); }
    const pr = softmax(scores, scale);
    for (let d = 0; d < hd; d++) { let a = 0.0; for (let j = 0; j < nK; j++) a = fr(a + fr(pr[j] * Vc[j * S + ho + d])); out[ho + d] = fr(a); }
  }
  return out;
};

// Autoregressive greedy transcription. Cross-attn K/V computed once; self-attn K/V
// cached and grown one token per step (true incremental decode). Suppresses the
// non-text special/timestamp tokens (keeps EOT as the stop). Returns generated text ids.
export function whisperDecodeGreedy(plan, store, encoderOut, n_enc, opts = {}) {
  const { n_text_state: S, n_text_head: H, n_text_layer: NL, n_vocab } = plan.hparams;
  const W = whisperSpecials(n_vocab);
  const { lang = W.LANG_EN, task = W.TRANSCRIBE, maxNew = 224 } = opts;
  const hd = S / H, scale = 1 / Math.sqrt(hd), FF = 4 * S;
  const D = (name) => tensorF32(plan, store, name);
  const tokEmb = D("decoder.token_embedding.weight"), posEmb = D("decoder.positional_embedding");
  const dlnW = D("decoder.ln.weight"), dlnB = D("decoder.ln.bias");
  const Lw = [], cK = [], cV = [];
  for (let il = 0; il < NL; il++) {
    const p = `decoder.blocks.${il}.`;
    Lw[il] = {
      aw: D(p + "attn_ln.weight"), ab: D(p + "attn_ln.bias"), qw: D(p + "attn.query.weight"), qb: D(p + "attn.query.bias"),
      kw: D(p + "attn.key.weight"), vw: D(p + "attn.value.weight"), vb: D(p + "attn.value.bias"), ow: D(p + "attn.out.weight"), ob: D(p + "attn.out.bias"),
      cw: D(p + "cross_attn_ln.weight"), cb: D(p + "cross_attn_ln.bias"), cqw: D(p + "cross_attn.query.weight"), cqb: D(p + "cross_attn.query.bias"), cow: D(p + "cross_attn.out.weight"), cob: D(p + "cross_attn.out.bias"),
      mw: D(p + "mlp_ln.weight"), mb: D(p + "mlp_ln.bias"), m0: D(p + "mlp.0.weight"), m0b: D(p + "mlp.0.bias"), m2: D(p + "mlp.2.weight"), m2b: D(p + "mlp.2.bias"),
    };
    cK[il] = linear(encoderOut, n_enc, D(p + "cross_attn.key.weight"), S, S, null);
    cV[il] = linear(encoderOut, n_enc, D(p + "cross_attn.value.weight"), S, S, D(p + "cross_attn.value.bias"));
  }
  const Kc = Array.from({ length: NL }, () => []), Vc = Array.from({ length: NL }, () => []);
  const prompt = [W.SOT, lang, task, W.NO_TIMESTAMPS], gen = [];
  const lin1 = (x, W, inD, outD, b) => linear(x, 1, W, inD, outD, b);
  for (let p = 0; ; p++) {
    const tok = p < prompt.length ? prompt[p] : gen[gen.length - 1];
    const x = new Float32Array(S);
    for (let d = 0; d < S; d++) x[d] = fr(tokEmb[tok * S + d] + posEmb[p * S + d]);
    for (let il = 0; il < NL; il++) {
      const w = Lw[il];
      const an = layerNorm(x, w.aw, w.ab, LN_EPS);
      const k = lin1(an, w.kw, S, S, null), v = lin1(an, w.vw, S, S, w.vb);
      const kc = Kc[il], vc = Vc[il]; const base = kc.length; kc.length = base + S; vc.length = base + S;
      for (let d = 0; d < S; d++) { kc[base + d] = k[d]; vc[base + d] = v[d]; }
      const sa = oneAttn(lin1(an, w.qw, S, S, w.qb), kc, vc, p + 1, H, hd, scale);
      const so = lin1(sa, w.ow, S, S, w.ob);
      for (let d = 0; d < S; d++) x[d] = fr(x[d] + so[d]);
      const cn = layerNorm(x, w.cw, w.cb, LN_EPS);
      const co = lin1(oneAttn(lin1(cn, w.cqw, S, S, w.cqb), cK[il], cV[il], n_enc, H, hd, scale), w.cow, S, S, w.cob);
      for (let d = 0; d < S; d++) x[d] = fr(x[d] + co[d]);
      const mn = layerNorm(x, w.mw, w.mb, LN_EPS);
      const h1 = lin1(mn, w.m0, S, FF, w.m0b); for (let i = 0; i < FF; i++) h1[i] = gelu(h1[i]);
      const h2 = lin1(h1, w.m2, FF, S, w.m2b);
      for (let d = 0; d < S; d++) x[d] = fr(x[d] + h2[d]);
    }
    if (p >= prompt.length - 1) {
      const fn = layerNorm(x, dlnW, dlnB, LN_EPS);
      let best = -1, bv = -Infinity;
      for (let tk = 0; tk < n_vocab; tk++) {
        if (tk > 50256 && tk !== W.EOT) continue;       // text tokens + EOT only
        let s = 0.0; const tb = tk * S; for (let d = 0; d < S; d++) s = fr(s + fr(fn[d] * tokEmb[tb + d]));
        if (s > bv) { bv = s; best = tk; }
      }
      if (best === W.EOT || gen.length >= maxNew) break;
      gen.push(best);
    }
  }
  return gen;
}

// Detokenize text ids by concatenating the stored vocab token bytes, then UTF-8
// decode. whisper.cpp stores tokens as RAW UTF-8 text (literal spaces, multi-byte
// fallbacks) — NOT GPT-2 byte-encoded — so no byte-decoder is applied.
export function whisperDetok(modelBytes, ids) {
  const { vocab } = parseWhisperHeader(modelBytes, { wantVocab: true });
  let total = 0; for (const id of ids) if (id < vocab.tokens.length) total += vocab.tokens[id].length;
  const out = new Uint8Array(total); let o = 0;
  for (const id of ids) { if (id < vocab.tokens.length) { out.set(vocab.tokens[id], o); o += vocab.tokens[id].length; } }
  return new TextDecoder().decode(out);
}

// Full pipeline: 16 kHz PCM16 WAV bytes → transcription text.
export function whisperTranscribe(forged, modelBytes, wavBytes, opts = {}) {
  const { plan, blocks } = forged, store = { get: (h) => blocks.get(h) };
  const filters = whisperMelFilters(plan, store);
  const { mel } = logMelSpectrogram(readWavPCM16(wavBytes), filters, { nMel: plan.hparams.n_mels, nBins: plan.mel.n_fft }); // n_mels=128 on large-v3
  const stem = whisperConvStem(plan, store, mel);
  const enc = whisperEncoder(plan, store, stem.x, stem.n_ctx);
  const ids = whisperDecodeGreedy(plan, store, enc, stem.n_ctx, opts);
  return { ids, text: whisperDetok(modelBytes, ids) };
}
