// gen-mla-gpu-data.mjs — oracle export for the MLA GPU kernel witnesses (ROPENORM + MLAATTN).
//
// Builds the synthetic DeepSeek-MoE model (same shape as gguf-forge-exec-moe-deepseek.test.mjs),
// runs the CPU Tier-A `forward` with a dbg collector, and dumps the MLA intermediates (Qcur/Kcur/
// Vcur/ctx/kqScale per position) so the browser can run the NEW GPU kernels over identical inputs
// and match the oracle. Also emits a standalone plain-NORM-rope golden (ROPENORM is a pure math op).
// Writes gpu/_qtest/mla.json. Run: node gen-mla-gpu-data.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";

const fr = Math.fround;
const D = 32, NH = 4, HK = 24, ROPE = 8, NOPE = HK - ROPE, HV = 16, KVL = 12, FF = 20, VOCAB = 7, E = 4, USED = 2, EPS = 1e-6, FREQ = 10000, WSCALE = 2.5;
const QD = NH * HK, KVB = NH * (NOPE + HV), WOIN = NH * HV;
function prng(s) { s >>>= 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const rf = (r, n, sc = 0.3) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * sc; return a; };
const pos = (r, n) => rf(r, n).map((x) => Math.abs(x) + 0.5);
const f32b = (a) => new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));

function buildGguf(meta, tensors) {
  const ALIGN = 32; let off = 0;
  const infos = tensors.map((tn) => { const o = off; off = Math.ceil((o + tn.bytes.length) / ALIGN) * ALIGN; return { ...tn, offset: o }; });
  let parts = [], len = 0; const push = (b) => { parts.push(b); len += b.length; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); push(b); };
  const f32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); push(b); };
  const u64 = (v) => { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, v >>> 0, true); dv.setUint32(4, Math.floor(v / 4294967296), true); push(b); };
  const str = (s) => { const e = new TextEncoder().encode(s); u64(e.length); push(e); };
  push(new TextEncoder().encode("GGUF")); u32(3); u64(tensors.length); u64(Object.keys(meta).length);
  for (const [k, val] of Object.entries(meta)) { str(k); if (typeof val === "string") { u32(8); str(val); } else if (typeof val === "boolean") { u32(7); push(new Uint8Array([val ? 1 : 0])); } else if (Number.isInteger(val) && val >= 0 && val < 4294967296) { u32(4); u32(val); } else { u32(6); f32(val); } }
  for (const ti of infos) { str(ti.name); u32(ti.dims.length); for (const d of ti.dims) u64(d); u32(ti.type); u64(ti.offset); }
  if (len % ALIGN) push(new Uint8Array(ALIGN - (len % ALIGN)));
  const dataStart = len;
  for (const ti of infos) { while (len < dataStart + ti.offset) push(new Uint8Array(1)); push(ti.bytes); }
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}

function makeModel(seed) {
  const r = prng(seed);
  const w = {
    tok_embd: rf(r, VOCAB * D), output_norm: pos(r, D), output: rf(r, VOCAB * D),
    attn_norm: pos(r, D), q: rf(r, QD * D), kv_a_mqa: rf(r, (KVL + ROPE) * D), kv_a_norm: pos(r, KVL), kv_b: rf(r, KVB * KVL), wo: rf(r, D * WOIN),
    ffn_norm: pos(r, D), gate_inp: rf(r, E * D), gate_exps: rf(r, E * FF * D), up_exps: rf(r, E * FF * D), down_exps: rf(r, E * D * FF),
    exp_probs_b: rf(r, E, 0.2), gate_shexp: rf(r, FF * D), up_shexp: rf(r, FF * D), down_shexp: rf(r, D * FF),
  };
  const meta = {
    "general.architecture": "deepseek2", "deepseek2.block_count": 1, "deepseek2.embedding_length": D,
    "deepseek2.attention.head_count": NH, "deepseek2.attention.key_length": HK, "deepseek2.attention.value_length": HV,
    "deepseek2.rope.dimension_count": ROPE, "deepseek2.attention.kv_lora_rank": KVL,
    "deepseek2.leading_dense_block_count": 0, "deepseek2.expert_count": E, "deepseek2.expert_used_count": USED, "deepseek2.attention.q_lora_rank": 0,
    "deepseek2.expert_shared_count": 1, "deepseek2.expert_gating_func": 2, "deepseek2.expert_weights_norm": true,
    "deepseek2.expert_weights_scale": WSCALE, "deepseek2.expert_group_count": 0,
    "deepseek2.rope.freq_base": FREQ, "deepseek2.attention.layer_norm_rms_epsilon": EPS,
  };
  const p = "blk.0.";
  const T = [
    ["token_embd.weight", [D, VOCAB], w.tok_embd], ["output_norm.weight", [D], w.output_norm], ["output.weight", [D, VOCAB], w.output],
    [p + "attn_norm.weight", [D], w.attn_norm], [p + "attn_q.weight", [D, QD], w.q],
    [p + "attn_kv_a_mqa.weight", [D, KVL + ROPE], w.kv_a_mqa], [p + "attn_kv_a_norm.weight", [KVL], w.kv_a_norm],
    [p + "attn_kv_b.weight", [KVL, KVB], w.kv_b], [p + "attn_output.weight", [WOIN, D], w.wo], [p + "ffn_norm.weight", [D], w.ffn_norm],
    [p + "ffn_gate_inp.weight", [D, E], w.gate_inp], [p + "ffn_gate_exps.weight", [D, FF, E], w.gate_exps], [p + "ffn_up_exps.weight", [D, FF, E], w.up_exps], [p + "ffn_down_exps.weight", [FF, D, E], w.down_exps],
    [p + "exp_probs_b", [E], w.exp_probs_b], [p + "ffn_gate_shexp.weight", [D, FF], w.gate_shexp], [p + "ffn_up_shexp.weight", [D, FF], w.up_shexp], [p + "ffn_down_shexp.weight", [FF, D], w.down_shexp],
  ];
  return { gguf: buildGguf(meta, T.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32b(arr) }))), w };
}

// ── run the oracle, collect MLA intermediates per position ──
const model = makeModel(23), gguf = model.gguf, W = model.w, ids = [1, 5, 2];
const f = forgeGguf(gguf), g = synthesizeGraph(f.plan);
const cap = {};   // label -> [ per-pos Array ]
const dbg = (label, arr, p) => { (cap[label] ||= [])[p] = Array.from(arr); };
const logits = forward(f.plan, g, { get: (hex) => f.blocks.get(hex) }, ids, { dbg });
const T = ids.length;

// ── standalone plain-NORM-rope golden (mirror gguf-forge-exec.ropeNormMla, y=null) ──
function ropeNormPlain(vec, p, nRot, freqBase, headDim) {
  const nH = vec.length / headDim, out = Float32Array.from(vec), half = nRot >> 1;
  const thetaScale = fr(Math.pow(freqBase, -2 / nRot));
  for (let h = 0; h < nH; h++) {
    let te = fr(p);
    for (let k = 0; k < half; k++) {
      const c = fr(Math.cos(te)), s = fr(Math.sin(te));
      const b = h * headDim, x0 = vec[b + 2 * k], x1 = vec[b + 2 * k + 1];
      out[b + 2 * k] = fr(fr(x0 * c) - fr(x1 * s));
      out[b + 2 * k + 1] = fr(fr(x0 * s) + fr(x1 * c));
      te = fr(te * thetaScale);
    }
  }
  return out;
}
const rr = prng(99);
const ropeIn = Array.from(rf(rr, NH * ROPE, 1.0));
const ropePos = 2;
const ropeOut = Array.from(ropeNormPlain(Float32Array.from(ropeIn), ropePos, ROPE, FREQ, ROPE));

// ── YaRN rope golden (mirror gguf-forge-exec.mjs mla_attn YaRN branch + ropeNormMla y-path) with real
// DeepSeek-V2-Lite constants: rope dim 64, freq_base 10000, factor 40, orig_ctx 4096, yarn_log_mul 0.707. ──
const Y_NROT = 64, Y_NH = 4, Y_POS = 5, Y_FB = 10000, Y_FACTOR = 40, Y_ORIGCTX = 4096, Y_LOGMUL = 0.707;
function yarnUniforms(rope, fb, factor, origCtx, logMul) {
  const freqScale = 1 / factor, ext = 1.0, lf = Math.log(factor);
  const corrDim = (beta) => rope * Math.log(origCtx / (beta * 2 * Math.PI)) / (2 * Math.log(fb));
  const lo = Math.max(0, Math.floor(corrDim(32))), hi = Math.min(rope - 1, Math.ceil(corrDim(1)));
  const getMscale = (s, m) => s <= 1 ? 1 : (0.1 * m * Math.log(s) + 1);
  const mAll = logMul, mSc = (logMul !== 0 && mAll !== 1) ? mAll : 1;
  let attnFactor = logMul !== 0 ? getMscale(factor, mSc) / getMscale(factor, mAll) : getMscale(factor, 1);
  if (ext !== 0) attnFactor *= 1 / (1 + 0.1 * lf);
  const ropeMscale = ext !== 0 ? attnFactor * (1 + 0.1 * lf) : attnFactor;
  const kqMscale = attnFactor * (1 + 0.1 * lf) * (1 + 0.1 * logMul * lf);
  return { freqScale, extFactor: ext, lo, hi, mscale: ropeMscale, kqMscale };
}
function ropeNormYarn(vec, p, nRot, freqBase, headDim, y) {
  const nH = vec.length / headDim, out = Float32Array.from(vec), half = nRot >> 1;
  const thetaScale = fr(Math.pow(freqBase, -2 / nRot));
  for (let h = 0; h < nH; h++) {
    let te = fr(p);
    for (let k = 0; k < half; k++) {
      const ti = fr(y.freqScale * te);
      const ramp = 1 - Math.min(1, Math.max(0, (k - y.lo) / Math.max(0.001, y.hi - y.lo)));
      const mix = ramp * y.extFactor;
      const theta = fr(ti * (1 - mix) + te * mix), ms = y.mscale;
      const c = fr(Math.cos(theta) * ms), s = fr(Math.sin(theta) * ms);
      const b = h * headDim, x0 = vec[b + 2 * k], x1 = vec[b + 2 * k + 1];
      out[b + 2 * k] = fr(fr(x0 * c) - fr(x1 * s));
      out[b + 2 * k + 1] = fr(fr(x0 * s) + fr(x1 * c));
      te = fr(te * thetaScale);
    }
  }
  return out;
}
const yU = yarnUniforms(Y_NROT, Y_FB, Y_FACTOR, Y_ORIGCTX, Y_LOGMUL);
const ropeYIn = Array.from(rf(rr, Y_NH * Y_NROT, 1.0));
const ropeYOut = Array.from(ropeNormYarn(Float32Array.from(ropeYIn), Y_POS, Y_NROT, Y_FB, Y_NROT, yU));

// ── MoE (mul_mat_id) witness data at the LAST position ──
// experts stored as full stacks; the GPU indexes expert e's slice, matching matvecExpert's byte base.
// gate/up_exps: [D,FF,E] → expert e at e*D*FF, layout [FF][D] (MATVECF N=FF,K=D).
// down_exps:    [FF,D,E] → expert e at e*FF*D, layout [D][FF] (MATVECF N=D,K=FF).
const moeIn = cap["l0.moe_in"][T - 1];
const sel = cap["l0.moesel"][T - 1].map((x) => x | 0);
const wts = cap["l0.moewt"][T - 1];
const moeOut = cap["l0.moe_out"][T - 1], shexp = cap["l0.shexp"][T - 1];
const moeFinal = moeOut.map((v, j) => fr(v + shexp[j]));   // DeepSeek ungated shared add
const moe = {
  D, FF, E, USED, x: moeIn, selected: sel, weights: wts,
  gate_exps: Array.from(W.gate_exps), up_exps: Array.from(W.up_exps), down_exps: Array.from(W.down_exps),
  gate_shexp: Array.from(W.gate_shexp), up_shexp: Array.from(W.up_shexp), down_shexp: Array.from(W.down_shexp),
  expected: moeFinal, moe_out: moeOut, shexp,
};

mkdirSync("gpu/_qtest", { recursive: true });
const data = {
  dims: { D, NH, HK, HV, ROPE, NOPE, KVL, VOCAB, E, USED, FREQ }, ids, T,
  // MLA attention witness at the LAST position: q=Qcur[T-1], Kc=[Kcur[0..T-1]], Vc=[Vcur[0..T-1]]
  mla: {
    kqScale: cap["l0.kqScale"][T - 1][0],
    q: cap["l0.Qcur"][T - 1],
    Kc: cap["l0.Kcur"],      // [T][NH*HK]
    Vc: cap["l0.Vcur"],      // [T][NH*HV]
    ctx: cap["l0.ctx"][T - 1],   // [NH*HV] expected
  },
  rope: { headDim: ROPE, nRot: ROPE, nHeads: NH, pos: ropePos, freqBase: FREQ, in: ropeIn, out: ropeOut },
  ropeYarn: { headDim: Y_NROT, nRot: Y_NROT, nHeads: Y_NH, pos: Y_POS, freqBase: Y_FB, in: ropeYIn, out: ropeYOut,
    yarn: { freqScale: yU.freqScale, extFactor: yU.extFactor, lo: yU.lo, hi: yU.hi, mscale: yU.mscale } },
  moe,
  // full weight set + config for the end-to-end GPU forward witness (greedy parity vs this oracle)
  full: {
    cfg: { D, VOCAB, NH, HK, HV, ROPE, NOPE, KVL, FF, E, USED, EPS, FREQ, WSCALE, QD, KVB, WOIN, kqScale: fr(1 / Math.sqrt(HK)), gating: "sigmoid" },
    w: Object.fromEntries(Object.entries(W).map(([k, v]) => [k, Array.from(v)])),
  },
  logits: Array.from(logits),
};
writeFileSync("gpu/_qtest/mla.json", JSON.stringify(data));
console.log(`wrote gpu/_qtest/mla.json — MLA ctx ${data.mla.ctx.length}, Kc ${data.mla.Kc.length}×${data.mla.Kc[0].length}, kqScale ${data.mla.kqScale.toExponential(3)}`);
console.log(`  moe: ${USED}/${E} experts selected [${sel}], weights [${wts.map((x) => x.toFixed(3))}], out dim ${moeFinal.length}`);
console.log(`rope golden: ${NH}×${ROPE} at pos ${ropePos}`);
