// RWKV7 end-to-end test. Build a tiny rwkv7 with random F32 weights, forge ->
// synthesize -> run forward, and compare logits to an INDEPENDENT float64 reference
// reproducing rwkv7.cpp + rwkv7-base.cpp: LN(tok_norm) -> per layer [ LN(attn_norm)
// -> time-mix (6-way token-shift lerp, w/a/v/g LoRA gates, k_k L2-norm, k_a, value-
// residual mix, delta-rule WKV with recurrent state, per-head group-norm, r_k bonus,
// gating, out_proj) -> residual -> LN(attn_norm_2) -> channel-mix (squared-relu) ->
// residual ] -> LN(output_norm) -> lm_head. 4 tokens exercise the recurrent token-
// shift + WKV state. The WKV primitive itself is ggml-witnessed separately.

import assert from "node:assert";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

// ── tiny dims ──
const E = 8, HS = 4, HC = E / HS, DEC = 4, ICLR = 4, VRM = 4, GATE = 4, FF = 16, VOCAB = 5, NL = 2, EPS = 1e-5;

function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const r = prng(77);
const randF = (n, sc = 0.3) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * sc; return a; };
const normW = (n) => randF(n, 1).map((x) => Math.abs(x) + 0.5);

const L = [];
for (let il = 0; il < NL; il++) L.push({
  attn_norm: normW(E), attn_norm_b: randF(E), attn_norm_2: normW(E), attn_norm_2_b: randF(E),
  lerp_fused: randF(6 * E), receptance: randF(E * E), w0: randF(E), w1: randF(DEC * E), w2: randF(E * DEC),
  key: randF(E * E), value: randF(E * E), a0: randF(E), a1: randF(ICLR * E), a2: randF(E * ICLR),
  v0: randF(E), v1: randF(VRM * E), v2: randF(E * VRM), g1: randF(GATE * E), g2: randF(E * GATE),
  k_k: randF(E), k_a: randF(E), r_k: randF(E), ln: normW(E), ln_b: randF(E), output: randF(E * E),
  cm_lerp_k: randF(E), cm_key: randF(FF * E), cm_value: randF(E * FF),
});
const w = { tok_embd: randF(VOCAB * E), tok_norm: normW(E), tok_norm_b: randF(E), output_norm: normW(E), output_norm_b: randF(E), output: randF(VOCAB * E) };

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
  "general.architecture": "rwkv7", "rwkv7.block_count": NL, "rwkv7.embedding_length": E, "rwkv7.feed_forward_length": FF,
  "rwkv7.wkv.head_size": HS, "rwkv7.attention.decay_lora_rank": DEC, "rwkv7.attention.iclr_lora_rank": ICLR,
  "rwkv7.attention.value_residual_mix_lora_rank": VRM, "rwkv7.attention.gate_lora_rank": GATE,
  "rwkv7.attention.layer_norm_epsilon": EPS, "rwkv7.token_shift_count": 2,
};
const tensors = [
  ["token_embd.weight", [E, VOCAB], w.tok_embd], ["token_embd_norm.weight", [E], w.tok_norm], ["token_embd_norm.bias", [E], w.tok_norm_b],
  ["output_norm.weight", [E], w.output_norm], ["output_norm.bias", [E], w.output_norm_b], ["output.weight", [E, VOCAB], w.output],
];
for (let il = 0; il < NL; il++) { const p = `blk.${il}.`, x = L[il]; tensors.push(
  [p + "attn_norm.weight", [E], x.attn_norm], [p + "attn_norm.bias", [E], x.attn_norm_b],
  [p + "attn_norm_2.weight", [E], x.attn_norm_2], [p + "attn_norm_2.bias", [E], x.attn_norm_2_b],
  [p + "time_mix_lerp_fused.weight", [E, 1, 1, 6], x.lerp_fused], [p + "time_mix_receptance.weight", [E, E], x.receptance],
  [p + "time_mix_w0.weight", [E], x.w0], [p + "time_mix_w1.weight", [E, DEC], x.w1], [p + "time_mix_w2.weight", [DEC, E], x.w2],
  [p + "time_mix_key.weight", [E, E], x.key], [p + "time_mix_value.weight", [E, E], x.value],
  [p + "time_mix_a0.weight", [E], x.a0], [p + "time_mix_a1.weight", [E, ICLR], x.a1], [p + "time_mix_a2.weight", [ICLR, E], x.a2],
  [p + "time_mix_v0.weight", [E], x.v0], [p + "time_mix_v1.weight", [E, VRM], x.v1], [p + "time_mix_v2.weight", [VRM, E], x.v2],
  [p + "time_mix_g1.weight", [E, GATE], x.g1], [p + "time_mix_g2.weight", [GATE, E], x.g2],
  [p + "time_mix_k_k.weight", [E], x.k_k], [p + "time_mix_k_a.weight", [E], x.k_a], [p + "time_mix_r_k.weight", [E], x.r_k],
  [p + "time_mix_ln.weight", [E], x.ln], [p + "time_mix_ln.bias", [E], x.ln_b], [p + "time_mix_output.weight", [E, E], x.output],
  [p + "channel_mix_lerp_k.weight", [E], x.cm_lerp_k], [p + "channel_mix_key.weight", [E, FF], x.cm_key], [p + "channel_mix_value.weight", [FF, E], x.cm_value]);
}
const ggufTensors = tensors.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32bytes(arr) }));

// ── independent float64 reference forward ──
function mv(W, x, K, N) { const y = new Float64Array(N); for (let n = 0; n < N; n++) { let s = 0; for (let k = 0; k < K; k++) s += W[n * K + k] * x[k]; y[n] = s; } return y; }
function lnRef(x, wt, bs) { let m = 0; for (const v of x) m += v; m /= x.length; let s2 = 0; for (const v of x) s2 += (v - m) ** 2; const sc = 1 / Math.sqrt(s2 / x.length + EPS); return Array.from(x, (v, i) => (v - m) * sc * wt[i] + bs[i]); }
const sig = (v) => 1 / (1 + Math.exp(-v));

function referenceForward(tokens) {
  const attSh = Array.from({ length: NL }, () => new Float64Array(E));
  const ffnSh = Array.from({ length: NL }, () => new Float64Array(E));
  const wkv = Array.from({ length: NL }, () => new Float64Array(HC * HS * HS));
  const logitsRows = [];
  for (let pos = 0; pos < tokens.length; pos++) {
    let h = lnRef(Array.from(w.tok_embd.slice(tokens[pos] * E, tokens[pos] * E + E)), w.tok_norm, w.tok_norm_b);
    let vfirst = null;
    for (let il = 0; il < NL; il++) {
      const x = L[il];
      const cur = lnRef(h, x.attn_norm, x.attn_norm_b);
      // time-mix
      const xprev = Array.from(attSh[il]); attSh[il] = Float64Array.from(cur);
      const sx = cur.map((c, i) => xprev[i] - c);
      const lerp = (c) => cur.map((cu, i) => sx[i] * x.lerp_fused[c * E + i] + cu);
      const xr = lerp(0), xw = lerp(1), xk = lerp(2), xv = lerp(3), xa = lerp(4), xg = lerp(5);
      const rr = Array.from(mv(x.receptance, xr, E, E));
      const w1 = Array.from(mv(x.w1, xw, E, DEC)).map(Math.tanh);
      const ww = Array.from(mv(x.w2, w1, DEC, E)).map((v, i) => Math.exp(sig(v + x.w0[i]) * -0.606531));
      let kk2 = Array.from(mv(x.key, xk, E, E));
      let vv = Array.from(mv(x.value, xv, E, E));
      if (il === 0) vfirst = vv.slice();
      else { const v1 = Array.from(mv(x.v1, xv, E, VRM)); const v2 = Array.from(mv(x.v2, v1, VRM, E)); vv = vv.map((v, i) => v + (vfirst[i] - v) * sig(v2[i] + x.v0[i])); }
      const g1 = Array.from(mv(x.g1, xg, E, GATE)).map(sig); const gg = Array.from(mv(x.g2, g1, GATE, E));
      const a1 = Array.from(mv(x.a1, xa, E, ICLR)); const aa = Array.from(mv(x.a2, a1, ICLR, E)).map((v, i) => sig(v + x.a0[i]));
      const kk = new Array(E);
      for (let hh = 0; hh < HC; hh++) { let ss = 0; const ho = hh * HS; for (let i = 0; i < HS; i++) { kk[ho + i] = kk2[ho + i] * x.k_k[ho + i]; ss += kk[ho + i] ** 2; } const sc = 1 / Math.max(Math.sqrt(ss), 1e-12); for (let i = 0; i < HS; i++) kk[ho + i] *= sc; }
      const kU = kk2.map((kv, i) => kv + kv * x.k_a[i] * (aa[i] - 1));
      const nkk = kk.map((v) => -v), kka = kk.map((v, i) => v * aa[i]);
      // wkv7 (f64)
      const st = wkv[il], out = new Array(E);
      for (let hh = 0; hh < HC; hh++) { const ho = hh * HS, h2 = hh * HS * HS;
        for (let i = 0; i < HS; i++) { const vi = vv[ho + i], rowi = h2 + i * HS; let sa = 0; for (let j = 0; j < HS; j++) sa += nkk[ho + j] * st[rowi + j];
          let res = 0; for (let j = 0; j < HS; j++) { const s = st[rowi + j] * ww[ho + j] + vi * kU[ho + j] + sa * kka[ho + j]; st[rowi + j] = s; res += s * rr[ho + j]; } out[ho + i] = res; } }
      // group norm + affine
      const gn = new Array(E);
      for (let hh = 0; hh < HC; hh++) { const ho = hh * HS; let m = 0; for (let i = 0; i < HS; i++) m += out[ho + i]; m /= HS; let s2 = 0; for (let i = 0; i < HS; i++) s2 += (out[ho + i] - m) ** 2; const sc = 1 / Math.sqrt(s2 / HS + 64e-5); for (let i = 0; i < HS; i++) gn[ho + i] = (out[ho + i] - m) * sc; }
      for (let i = 0; i < E; i++) gn[i] = gn[i] * x.ln[i] + x.ln_b[i];
      for (let hh = 0; hh < HC; hh++) { const ho = hh * HS; let rk = 0; for (let i = 0; i < HS; i++) rk += kU[ho + i] * rr[ho + i] * x.r_k[ho + i]; for (let i = 0; i < HS; i++) gn[ho + i] += vv[ho + i] * rk; }
      for (let i = 0; i < E; i++) gn[i] *= gg[i];
      const tmix = Array.from(mv(x.output, gn, E, E));
      const ffnInp = tmix.map((v, i) => v + h[i]);
      // channel-mix
      const cn = lnRef(ffnInp, x.attn_norm_2, x.attn_norm_2_b);
      const fprev = Array.from(ffnSh[il]); ffnSh[il] = Float64Array.from(cn);
      const xk2 = cn.map((c, i) => (fprev[i] - c) * x.cm_lerp_k[i] + c);
      const ck = Array.from(mv(x.cm_key, xk2, E, FF)).map((v) => { const rl = v > 0 ? v : 0; return rl * rl; });
      const cmix = Array.from(mv(x.cm_value, ck, FF, E));
      h = cmix.map((v, i) => v + ffnInp[i]);
    }
    const rn = lnRef(h, w.output_norm, w.output_norm_b);
    logitsRows.push(Array.from(mv(w.output, rn, E, VOCAB)));
  }
  return logitsRows[tokens.length - 1];
}

const f = forgeGguf(buildGguf(meta, ggufTensors));
const graph = synthesizeGraph(f.plan);
const store = { get: (hex) => f.blocks.get(hex) };
const tokens = [3, 1, 4, 2];

t("graph is family=rwkv7, gated, weights resolve (layer-0 v0/v1/v2 unused)", () => {
  assert.strictEqual(graph.family, "rwkv7", graph.reason);
  assert.strictEqual(graph.stats.n_layer, NL);
  assert.strictEqual(graph.stats.head_size, HS);
  assert.strictEqual(graph.stats.gate, true);
  assert.strictEqual(graph.stats.weightsUsed, tensors.length - 3); // blk.0 v0/v1/v2 not referenced
  const hist = {}; for (const o of graph.ops) hist[o.op] = (hist[o.op] || 0) + 1;
  assert.strictEqual(hist.rwkv7_tmix, NL); assert.strictEqual(hist.rwkv7_cmix, NL);
});

t("executor logits match independent f64 reference (rwkv7 forward)", () => {
  const got = forward(f.plan, graph, store, tokens), ref = referenceForward(tokens);
  assert.strictEqual(got.length, VOCAB);
  for (let i = 0; i < VOCAB; i++) {
    const rel = Math.abs(got[i] - ref[i]) / (Math.abs(ref[i]) + 1e-4);
    assert.ok(rel < 5e-3, `logit ${i}: got ${got[i]} ref ${ref[i]} rel ${rel}`);
  }
  console.log(`      logits: [${Array.from(got).map((x) => x.toFixed(4)).join(", ")}]`);
});

t("argmax matches reference + deterministic", () => {
  const am = (a) => a.indexOf(Math.max(...a));
  const a = forward(f.plan, graph, store, tokens), b = forward(f.plan, graph, store, tokens);
  assert.strictEqual(am(Array.from(a)), am(referenceForward(tokens)));
  for (let i = 0; i < VOCAB; i++) assert.strictEqual(a[i], b[i]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
