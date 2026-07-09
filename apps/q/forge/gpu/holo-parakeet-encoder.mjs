// holo-parakeet-encoder.mjs — the 24-layer FastConformer encoder of Parakeet-TDT-0.6B as a DOM-free,
// content-addressed module. Weights stream from the encoder .holo BY κ (openHoloStream — HTTP-Range per
// block + per-block L5 + OPFS warm), never a flat download. This is the proven runner of
// holo-q-voice-pack/s3/parakeet-encoder-gpu.html (24 conformer layers, cosine 0.989 vs onnxruntime,
// decodes to the exact transcript) lifted out of the test page into a reusable engine.
//
//   createParakeetEncoder({ getWeight, manifest, rescale, rescaleBin, backend }) →
//     { encode(features /*Float32Array [T*1024], stem output*/, T) -> Float32Array [T*1024], free() }
//
// Seams (so it runs both in production and headless in node):
//   • getWeight(kappa) -> Promise<Uint8Array>   the int8 weight body, L5-verified. Production wraps ONE
//     openHoloStream over the full encoder .holo; the node witness opens the per-layer .holo files.
//   • rescale = encoder-rescale.json  (per-weight κ + scale + zp + bias offset, per-layer LayerNorms, pos_bias)
//   • rescaleBin = Uint8Array of encoder-rescale.bin (the small f32 values: LN γ/β, conv bias, pos_bias_u/v)
//   • backend: "cpu" (default — pure JS, node-witnessable) | "gpu" (the WGSL path of the proven page; the
//     module exposes the seam, the GPU port lifts the page's orchestration — pending, falls back to cpu).
//
// MATH is ref-encoder24.py exactly (the validated numpy spec that decodes to the exact transcript): macaron
// conformer block — x += ½·FFN(LN); x += MHSA_relpos(LN); x += Conv(LN); x += ½·FFN(LN); x = LN(x). Weights
// dequantize on load: w = (uint8 − zp)·scale (per-tensor). Attn linears are bias-free (NeMo design — only the
// depthwise conv carries a bias), matching the reference. Rel-pos is COMPUTED (sinusoid), not stored.

const D = 1024, H = 8, DK = 128, KER = 9;   // d_model, heads, head dim, depthwise kernel
const sig = (x) => 1 / (1 + Math.exp(-x));
const swish = (x) => x * sig(x);

// relative positional encoding — standard sinusoid, centered: length 2T−1, row (T−1) ↔ rel-pos 0. Matches
// the real /pos_enc/ dump (holo-asr-posenc.mjs, witnessed 1.12e-5). Inlined so the module is self-contained.
function relPosEncoding(T) {
  const L = 2 * T - 1, pe = new Float32Array(L * D), half = D >> 1, div = new Float64Array(half);
  for (let k = 0; k < half; k++) div[k] = Math.exp(-(2 * k) * Math.log(10000) / D);
  for (let i = 0; i < L; i++) {
    const pos = (T - 1) - i, base = i * D;
    for (let k = 0; k < half; k++) { const a = pos * div[k]; pe[base + 2 * k] = Math.sin(a); pe[base + 2 * k + 1] = Math.cos(a); }
  }
  return pe;   // [2T-1, D] row-major
}

const f32 = (bin, e) => new Float32Array(bin.buffer, bin.byteOffset + e.off * 4, e.len);   // {off,len in f32 ELEMENTS}

// h[T,inn] @ W[inn,out] → [T,out]  (W row-major [inn,out]; k-outer/j-inner = sequential W + out access)
function matmul(h, T, inn, W, out) {
  const y = new Float32Array(T * out);
  for (let t = 0; t < T; t++) {
    const ho = t * inn, yo = t * out;
    for (let k = 0; k < inn; k++) {
      const a = h[ho + k]; if (a === 0) continue;
      const wo = k * out;
      for (let j = 0; j < out; j++) y[yo + j] += a * W[wo + j];
    }
  }
  return y;
}
// W[out,inn] @ xt[inn,T] → [out,T]  (conv pointwise: weight is [out,in])
function matmulOT(W, out, inn, xt, T) {
  const y = new Float32Array(out * T);
  for (let o = 0; o < out; o++) {
    const wo = o * inn, yo = o * T;
    for (let k = 0; k < inn; k++) {
      const w = W[wo + k]; if (w === 0) continue;
      const xo = k * T;
      for (let t = 0; t < T; t++) y[yo + t] += w * xt[xo + t];
    }
  }
  return y;
}
// LayerNorm over last dim D, with γ/β. x:[T,D] in place into a fresh buffer.
function layerNorm(x, T, g, b) {
  const y = new Float32Array(T * D);
  for (let t = 0; t < T; t++) {
    const o = t * D; let mu = 0; for (let i = 0; i < D; i++) mu += x[o + i]; mu /= D;
    let v = 0; for (let i = 0; i < D; i++) { const d = x[o + i] - mu; v += d * d; } v /= D;
    const inv = 1 / Math.sqrt(v + 1e-5);
    for (let i = 0; i < D; i++) y[o + i] = (x[o + i] - mu) * inv * g[i] + b[i];
  }
  return y;
}

export function createParakeetEncoder({ getWeight, rescale, rescaleBin, backend = "cpu" } = {}) {
  if (!getWeight) throw new Error("createParakeetEncoder needs getWeight(kappa)->Uint8Array");
  if (!rescale || !rescaleBin) throw new Error("createParakeetEncoder needs rescale + rescaleBin");
  const cfg = rescale.config || { layers: 24 };
  // role → {kappa, scale, zp, bias} for each conformer layer, indexed [layer][role]
  const byLayer = [];
  for (const w of rescale.weights) { if (w.layer < 0) continue; (byLayer[w.layer] ||= {})[w.role] = w; }
  const bin = rescaleBin instanceof Uint8Array ? rescaleBin : new Uint8Array(rescaleBin.buffer || rescaleBin);

  // dequantize one weight body (uint8) to f32 via its rescale entry
  async function dq(entry) {
    const bytes = await getWeight(entry.kappa);          // L5-verified int8 body
    const { scale, zp } = entry, n = bytes.length, out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = (bytes[i] - zp) * scale;
    return out;
  }

  async function conformerLayer(x, T, L, pe, P) {
    const ent = byLayer[L], nm = rescale.norms[L], pb = rescale.pos_bias[L];
    // ── macaron FFN1 ──  x += ½ · ( swish(LN(x)·W0) · W1 )
    let h = layerNorm(x, T, f32(bin, nm.feed_forward1.weight), f32(bin, nm.feed_forward1.bias));
    let z = matmul(h, T, D, await dq(ent["ff1.0"]), 4096); for (let i = 0; i < z.length; i++) z[i] = swish(z[i]);
    let ff = matmul(z, T, 4096, await dq(ent["ff1.1"]), D);
    for (let i = 0; i < x.length; i++) x[i] += 0.5 * ff[i];
    // ── self-attention (relative position) ──
    h = layerNorm(x, T, f32(bin, nm.self_att.weight), f32(bin, nm.self_att.bias));
    const q = matmul(h, T, D, await dq(ent["attn.linear_q"]), D);
    const k = matmul(h, T, D, await dq(ent["attn.linear_k"]), D);
    const v = matmul(h, T, D, await dq(ent["attn.linear_v"]), D);
    const p = matmul(pe, P, D, await dq(ent["attn.linear_pos"]), D);   // [P,D]
    const u = f32(bin, pb.u), vv = f32(bin, pb.v);                     // [D] = [H*DK]
    const ctx = new Float32Array(T * D);
    const scale = 1 / Math.sqrt(DK), sc = new Float32Array(T);         // one row of scores, reused
    for (let hd = 0; hd < H; hd++) {
      const hb = hd * DK;
      for (let t = 0; t < T; t++) {
        const qo = t * D + hb;
        // ac[t,s] = (q+u)·k[s] ; bd via rel_shift of (q+vv)·p
        let mx = -Infinity;
        for (let s = 0; s < T; s++) {
          let ac = 0; const ko = s * D + hb;
          for (let d = 0; d < DK; d++) ac += (q[qo + d] + u[hb + d]) * k[ko + d];
          // bd[t,s] = bdraw[tp, jj-1] with idx = t*P + s + T
          const idx = t * P + s + T, tp = (idx / (P + 1)) | 0, jj = idx - tp * (P + 1);
          let bd = 0;
          if (jj !== 0) { const pr = jj - 1, po = pr * D + hb, to = tp * D + hb; for (let d = 0; d < DK; d++) bd += (q[to + d] + vv[hb + d]) * p[po + d]; }
          const val = (ac + bd) * scale; sc[s] = val; if (val > mx) mx = val;
        }
        let sum = 0; for (let s = 0; s < T; s++) { const e = Math.exp(sc[s] - mx); sc[s] = e; sum += e; }
        const inv = 1 / sum, co = t * D + hb;
        for (let s = 0; s < T; s++) { const a = sc[s] * inv; const vo = s * D + hb; for (let d = 0; d < DK; d++) ctx[co + d] += a * v[vo + d]; }
      }
    }
    const ao = matmul(ctx, T, D, await dq(ent["attn.linear_out"]), D);
    for (let i = 0; i < x.length; i++) x[i] += ao[i];
    // ── conv module ──  LN → pw1 → GLU → depthwise(+bias) → swish → pw2 ; operate on [D,T]
    h = layerNorm(x, T, f32(bin, nm.conv.weight), f32(bin, nm.conv.bias));
    const xt = new Float32Array(D * T); for (let t = 0; t < T; t++) for (let d = 0; d < D; d++) xt[d * T + t] = h[t * D + d];
    const z2 = matmulOT(await dq(ent["conv.pointwise_conv1"]), 2 * D, D, xt, T);   // [2D,T]
    const glu = new Float32Array(D * T);
    for (let d = 0; d < D; d++) for (let t = 0; t < T; t++) glu[d * T + t] = z2[d * T + t] * sig(z2[(d + D) * T + t]);
    const dw = await dq(ent["conv.depthwise_conv"]);   // [D,1,9] → [D,9] row-major
    const dwb = ent["conv.depthwise_conv"].bias ? f32(bin, ent["conv.depthwise_conv"].bias) : null;
    const cv = new Float32Array(D * T), pad = (KER - 1) >> 1;
    for (let d = 0; d < D; d++) {
      const go = d * T, wo = d * KER, co = d * T, bias = dwb ? dwb[d] : 0;
      for (let t = 0; t < T; t++) {
        let acc = bias;
        for (let kk = 0; kk < KER; kk++) { const ti = t + kk - pad; if (ti >= 0 && ti < T) acc += glu[go + ti] * dw[wo + kk]; }
        cv[co + t] = swish(acc);
      }
    }
    const c2 = matmulOT(await dq(ent["conv.pointwise_conv2"]), D, D, cv, T);   // [D,T]
    for (let t = 0; t < T; t++) for (let d = 0; d < D; d++) x[t * D + d] += c2[d * T + t];
    // ── macaron FFN2 ──
    h = layerNorm(x, T, f32(bin, nm.feed_forward2.weight), f32(bin, nm.feed_forward2.bias));
    z = matmul(h, T, D, await dq(ent["ff2.0"]), 4096); for (let i = 0; i < z.length; i++) z[i] = swish(z[i]);
    ff = matmul(z, T, 4096, await dq(ent["ff2.1"]), D);
    for (let i = 0; i < x.length; i++) x[i] += 0.5 * ff[i];
    // ── final LayerNorm ──
    return layerNorm(x, T, f32(bin, nm.out.weight), f32(bin, nm.out.bias));
  }

  async function encodeCPU(features, T) {
    const P = 2 * T - 1, pe = relPosEncoding(T);
    let x = Float32Array.from(features);
    for (let L = 0; L < cfg.layers; L++) x = await conformerLayer(x, T, L, pe, P);
    return x;
  }

  let gpu = null;   // lazily-built WebGPU backend (holo-parakeet-encoder-gpu.mjs), kept resident across calls
  async function gpuEncode(features, T) {
    if (!gpu) { const { createParakeetEncoderGPU } = await import("./holo-parakeet-encoder-gpu.mjs"); gpu = createParakeetEncoderGPU({ getWeight, rescale, rescaleBin }); await gpu.ready(); }
    return gpu.encode(features, T);
  }

  return {
    backend,
    // run ONE conformer layer (the repeating unit) — used by the witness for fast per-layer parity.
    async layer(features, T, L) { const P = 2 * T - 1; return conformerLayer(Float32Array.from(features), T, L, relPosEncoding(T), P); },
    async encode(features, T) {
      if (backend === "gpu") {
        // GPU path = the witnessed WGSL encoder (holo-parakeet-encoder-gpu.mjs). Transparently falls back to the
        // CPU oracle on any failure (no WebGPU / device lost) so the ear never strands on a GPU hiccup.
        try { return await gpuEncode(features, T); } catch (e) { try { console.warn("[parakeet encoder] GPU path failed, using CPU:", e && e.message || e); } catch (_) {} }
      }
      return encodeCPU(features, T);
    },
    free() { try { gpu && gpu.free(); } catch (e) {} gpu = null; },
  };
}

export default createParakeetEncoder;
