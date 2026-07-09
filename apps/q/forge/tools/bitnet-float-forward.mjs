// Decisive test: does a FULL-F32 forward (dequant every weight, full f32 activations — exactly what the
// GPU run-native does) reproduce the GPU's next-token argmax? If yes, the GPU is correct-but-different
// from llama.cpp only because llama.cpp quantizes activations to Q8_K + integer-dots (a Tier-B gap, not a
// bug). If it instead gives the llama.cpp token, the GPU has a real structural bug.
import { readFileSync } from "node:fs";
import { openGgufHolo } from "../gguf-forge-kstream.mjs";
import { synthesizeGraph } from "../gguf-forge-graph.mjs";
import { makeTokenizer } from "../gguf-forge-tokenizer.mjs";
import { dequantizeExact } from "../gguf-forge-dequant.mjs";
import { rmsNorm, ropeNeox, silu } from "../gguf-forge-kernels.mjs";
import { quantizeRowQ8K, vecDotQ6K } from "../gguf-forge-matmul.mjs";

const { plan, store, headerBytes } = openGgufHolo(new Uint8Array(readFileSync("./.models/bitnet-xl-tq2_0.holo")));
const g = synthesizeGraph(plan), S = g.stats;
const byName = Object.fromEntries(plan.tensors.map((t) => [t.name, t]));
const blk = (n) => store.get(byName[n].kappa.split(":").pop());
const deq = (n) => { const t = byName[n]; const el = t.dims.reduce((a, b) => a * b, 1); return dequantizeExact(t.type, blk(n), el); };  // [N*K] row-major or [N] for norms
const has = (n) => !!byName[n];

const { n_embd: D, n_head: NH, n_head_kv: NHKV, head_dim: HD, eps: EPS, freq_base: FREQ, n_layer: NL } = S;
const QD = NH * HD, KV = NHKV * HD, FF = byName["blk.0.ffn_gate.weight"].dims[1], grp = NH / NHKV, scale = 1 / Math.sqrt(HD);
const tok = makeTokenizer(headerBytes);
const ids = tok.encode("The capital of France is", { addSpecial: false });
console.log("ids", ids.join(","), "D", D, "FF", FF, "NH", NH, "HD", HD);

const matmul = (W, x, N, K) => { const y = new Float32Array(N); for (let n = 0; n < N; n++) { let a = 0; const b = n * K; for (let k = 0; k < K; k++) a += W[b + k] * x[k]; y[n] = a; } return y; };
const teT = byName["token_embd.weight"], teRaw = blk("token_embd.weight"), teBpr = (teT.dims[0] / 256) * 0 + (function () { const QK = 256; const bb = { 14: 210 }; return null; })();
const embedRow = (t) => dequantizeExact(teT.type, teRaw.subarray(t * Math.round(teRaw.length / teT.dims[1]), (t + 1) * Math.round(teRaw.length / teT.dims[1])), D);

// weights (dequant once)
const w = {}; const W = (n) => (w[n] ||= deq(n));
const Kc = [], Vc = []; for (let l = 0; l < NL; l++) { Kc.push([]); Vc.push([]); }
let lastH = null;
for (let pos = 0; pos < ids.length; pos++) {
  let h = embedRow(ids[pos]);
  for (let l = 0; l < NL; l++) {
    const p = `blk.${l}.`;
    const xn = rmsNorm(h, W(p + "attn_norm.weight"), EPS);
    let q = matmul(W(p + "attn_q.weight"), xn, QD, D), k = matmul(W(p + "attn_k.weight"), xn, KV, D), v = matmul(W(p + "attn_v.weight"), xn, KV, D);
    // NEOX rope per head
    const rope = (vec, nh) => { const o = new Float32Array(vec.length); for (let hh = 0; hh < nh; hh++) o.set(ropeNeox(vec.subarray(hh * HD, hh * HD + HD), pos, HD, FREQ, HD), hh * HD); return o; };
    q = rope(q, NH); k = rope(k, NHKV);
    Kc[l].push(k); Vc[l].push(v);
    const ctx = new Float32Array(QD);
    for (let hh = 0; hh < NH; hh++) { const kvh = (hh / grp) | 0, qo = hh * HD, ko = kvh * HD; const sc = []; let mx = -3e38; for (let s = 0; s <= pos; s++) { let d = 0; for (let i = 0; i < HD; i++) d += q[qo + i] * Kc[l][s][ko + i]; d *= scale; sc[s] = d; if (d > mx) mx = d; } let sum = 0; for (let s = 0; s <= pos; s++) { sc[s] = Math.exp(sc[s] - mx); sum += sc[s]; } for (let i = 0; i < HD; i++) { let a = 0; for (let s = 0; s <= pos; s++) a += (sc[s] / sum) * Vc[l][s][ko + i]; ctx[qo + i] = a; } }
    let woIn = ctx; if (has(p + "attn_sub_norm.weight")) woIn = rmsNorm(ctx, W(p + "attn_sub_norm.weight"), EPS);
    const ao = matmul(W(p + "attn_output.weight"), woIn, D, QD);
    const fi = new Float32Array(D); for (let i = 0; i < D; i++) fi[i] = h[i] + ao[i];
    const xn2 = rmsNorm(fi, W(p + "ffn_norm.weight"), EPS);
    const gt = matmul(W(p + "ffn_gate.weight"), xn2, FF, D), up = matmul(W(p + "ffn_up.weight"), xn2, FF, D);
    const sw = new Float32Array(FF); for (let i = 0; i < FF; i++) sw[i] = silu(gt[i]) * up[i];
    let downIn = sw; if (has(p + "ffn_sub_norm.weight")) downIn = rmsNorm(sw, W(p + "ffn_sub_norm.weight"), EPS);
    const fo = matmul(W(p + "ffn_down.weight"), downIn, D, FF);
    const h2 = new Float32Array(D); for (let i = 0; i < D; i++) h2[i] = fi[i] + fo[i];
    h = h2;
  }
  if (pos === ids.length - 1) lastH = h;
}
const hn = rmsNorm(lastH, W("output_norm.weight"), EPS);
const lmName = has("output.weight") ? "output.weight" : "token_embd.weight";
const lmW = W(lmName), V = byName[lmName].dims[1];
const logits = matmul(lmW, hn, V, D);
let am = 0; for (let i = 1; i < V; i++) if (logits[i] > logits[am]) am = i;
console.log("FLOAT lm_head argmax =", am);
// same hn, but lm_head via the REAL Q6_K·Q8_K integer dot (llama.cpp's lm_head arithmetic)
const lmT = byName[lmName], lmRaw = blk(lmName), q8k = quantizeRowQ8K(hn, D), nb = D / 256;
const logitsI = new Float32Array(V); for (let n = 0; n < V; n++) logitsI[n] = vecDotQ6K(nb, lmRaw, q8k, n * nb * 210);
let amI = 0; for (let i = 1; i < V; i++) if (logitsI[i] > logitsI[amI]) amI = i;
console.log("INT-lm_head argmax  =", amI, "  (float-forward + int lm_head; GPU=825, llama=263)");

// Replicate my EXACT WGSL (Q8K + MATVECQ6KI) in JS to isolate formula-vs-GPU.
const ni = (f) => { const b = new Float32Array(1); b[0] = f + 12582912.0; const iv = new Int32Array(b.buffer)[0]; return (iv & 0x7fffff) - 0x400000; };
const s8 = (b) => (b << 24) >> 24;
// Q8K replica → ad (block scales), aq (int8 per element)
const NB = D / 256; const ad = new Float32Array(NB); const aq = new Int8Array(D);
for (let b = 0; b < NB; b++) { let amax = 0, maxv = 0; for (let i = 0; i < 256; i++) { const xv = hn[b * 256 + i]; const ax = Math.abs(xv); if (ax > amax) { amax = ax; maxv = xv; } } if (amax === 0) { ad[b] = 0; continue; } const isc = -127.0 / maxv; ad[b] = 1.0 / isc; for (let j = 0; j < 256; j++) aq[b * 256 + j] = Math.min(127, ni(isc * hn[b * 256 + j])); }
// q6ki replica
const q6raw = blk(lmName); const dvw = new DataView(q6raw.buffer, q6raw.byteOffset, q6raw.byteLength);
const f16 = (o) => { const h = dvw.getUint16(o, true); const s = (h >> 15) & 1, e = (h >> 10) & 0x1f, m = h & 0x3ff; let v; if (e === 0) v = Math.pow(2, -14) * (m / 1024); else if (e === 31) v = m ? NaN : Infinity; else v = Math.pow(2, e - 15) * (1 + m / 1024); return s ? -v : v; };
const myDot = (rowBase) => { let acc = 0; for (let bk = 0; bk < NB; bk++) { const bp = rowBase + bk * 210, dW = f16(bp + 208), q8base = bk * 256; let bsum = 0; for (let jg = 0; jg < 2; jg++) { const ql = bp + jg * 64, qh = bp + 128 + jg * 32, aBase = jg * 128; for (let l = 0; l < 32; l++) { const qhl = q6raw[qh + l]; const v0 = ((q6raw[ql + l] & 0xf) | ((qhl & 3) << 4)) - 32, v32 = ((q6raw[ql + l + 32] & 0xf) | (((qhl >> 2) & 3) << 4)) - 32, v64 = ((q6raw[ql + l] >> 4) | (((qhl >> 4) & 3) << 4)) - 32, v96 = ((q6raw[ql + l + 32] >> 4) | (((qhl >> 6) & 3) << 4)) - 32; const e0 = aBase + l, e32 = aBase + l + 32, e64 = aBase + l + 64, e96 = aBase + l + 96; bsum += s8(q6raw[bp + 192 + (e0 >> 4)]) * aq[q8base + e0] * v0 + s8(q6raw[bp + 192 + (e32 >> 4)]) * aq[q8base + e32] * v32 + s8(q6raw[bp + 192 + (e64 >> 4)]) * aq[q8base + e64] * v64 + s8(q6raw[bp + 192 + (e96 >> 4)]) * aq[q8base + e96] * v96; } } acc += dW * ad[bk] * bsum; } return acc; };
let amW = 0, bestW = -Infinity; for (let n = 0; n < V; n++) { const lv = myDot(n * NB * 210); if (lv > bestW) { bestW = lv; amW = n; } }
console.log("MY-WGSL-replica     =", amW, "  (if 263 → formula OK, GPU stale/cache; if 825 → formula bug)");
