// GLM-5.2 (glm-dsa) END-TO-END EXECUTION witness.
// glm-dsa = MLA + DeepSeek-MoE; LLM_ARCH_GLM_DSA dispatches to llm_build_deepseek2 in
// llama (deepseek2.cpp has no indexer code → dense), so it must decode EXACTLY as deepseek2
// with the DSA indexer tensors (blk.N.indexer.*) present-but-inert. This proves that on
// REAL forged bytes (not just the graph plan): forge the SAME weights as `deepseek2` and as
// `glm-dsa`(+indexer), and assert the forward logits are BIT-IDENTICAL, the graph never
// references the indexer tensors, and tampering the indexer bytes changes nothing.

import assert from "node:assert";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + (e.stack || e.message)); } };

const D = 32, NH = 4, HK = 24, ROPE = 8, NOPE = HK - ROPE, HV = 16, KVL = 12, FF = 20, VOCAB = 7, E = 4, USED = 2, EPS = 1e-6, FREQ = 10000, WSCALE = 2.5;
const QD = NH * HK, KVB = NH * (NOPE + HV), WOIN = NH * HV, IDXH = 8, IDXK = 16;   // indexer dims (inert here)
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

// Shared MLA+MoE weights; `arch` re-keys the hparams; `indexer` appends inert DSA tensors.
function makeModel(seed, arch, { indexer = false } = {}) {
  const r = prng(seed);
  const w = {
    tok_embd: rf(r, VOCAB * D), output_norm: pos(r, D), output: rf(r, VOCAB * D),
    attn_norm: pos(r, D), q: rf(r, QD * D), kv_a_mqa: rf(r, (KVL + ROPE) * D), kv_a_norm: pos(r, KVL), kv_b: rf(r, KVB * KVL), wo: rf(r, D * WOIN),
    ffn_norm: pos(r, D), gate_inp: rf(r, E * D), gate_exps: rf(r, E * FF * D), up_exps: rf(r, E * FF * D), down_exps: rf(r, E * D * FF),
    exp_probs_b: rf(r, E, 0.2), gate_shexp: rf(r, FF * D), up_shexp: rf(r, FF * D), down_shexp: rf(r, D * FF),
    idx_q_b: rf(r, IDXH * IDXK), idx_k: rf(r, IDXK * D), idx_proj: rf(r, IDXK * D), idx_k_norm: pos(r, IDXK),
  };
  const A = arch;
  const meta = {
    "general.architecture": A, [`${A}.block_count`]: 1, [`${A}.embedding_length`]: D,
    [`${A}.attention.head_count`]: NH, [`${A}.attention.key_length`]: HK, [`${A}.attention.value_length`]: HV,
    [`${A}.rope.dimension_count`]: ROPE, [`${A}.attention.kv_lora_rank`]: KVL, [`${A}.attention.q_lora_rank`]: 0,
    [`${A}.leading_dense_block_count`]: 0, [`${A}.expert_count`]: E, [`${A}.expert_used_count`]: USED,
    [`${A}.expert_shared_count`]: 1, [`${A}.expert_gating_func`]: 1, [`${A}.expert_weights_norm`]: true,
    [`${A}.expert_weights_scale`]: WSCALE, [`${A}.expert_group_count`]: 0,
    [`${A}.rope.freq_base`]: FREQ, [`${A}.attention.layer_norm_rms_epsilon`]: EPS,
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
  if (indexer) T.push(
    [p + "indexer.attn_q_b.weight", [IDXK, IDXH], w.idx_q_b], [p + "indexer.attn_k.weight", [D, IDXK], w.idx_k],
    [p + "indexer.proj.weight", [D, IDXK], w.idx_proj], [p + "indexer.k_norm.weight", [IDXK], w.idx_k_norm],
  );
  return { w, gguf: buildGguf(meta, T.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32b(arr) }))) };
}

const store = (f) => ({ get: (hex) => f.blocks.get(hex) });
const ids = [1, 5, 2, 3];

t("glm-dsa forges + synthesizes as mla-moe; DSA indexer tensors stored but NOT referenced by the forward", () => {
  const f = forgeGguf(makeModel(7, "glm-dsa", { indexer: true }).gguf);
  const g = synthesizeGraph(f.plan);
  assert.strictEqual(g.family, "mla-moe", `family ${g.family} ${g.reason || ""}`);
  // indexer tensors are physically forged (present in the κ-store)…
  assert.ok(f.tensors.some((x) => x.name.includes("indexer")), "indexer tensors forged");
  // …but the dense deepseek2 graph references NONE of them
  assert.ok(!Object.keys(g.weights).some((n) => n.includes("indexer")), "no indexer in graph weights");
  assert.ok(!g.ops.some((o) => JSON.stringify(o.w || {}).includes("indexer")), "no indexer in any op");
});

t("glm-dsa decode is BIT-IDENTICAL to deepseek2 on the same weights (DSA indexer inert)", () => {
  const ds = makeModel(7, "deepseek2");
  const glm = makeModel(7, "glm-dsa", { indexer: true });          // same prng seed → same MLA+MoE weights
  const fds = forgeGguf(ds.gguf), fglm = forgeGguf(glm.gguf);
  const lds = forward(fds.plan, synthesizeGraph(fds.plan), store(fds), ids);
  const lglm = forward(fglm.plan, synthesizeGraph(fglm.plan), store(fglm), ids);
  assert.strictEqual(lds.length, lglm.length);
  for (let i = 0; i < lds.length; i++) assert.strictEqual(lglm[i], lds[i], `logit ${i} differs (${lglm[i]} vs ${lds[i]})`);
});

t("changing the DSA indexer bytes does NOT change glm-dsa output (proves inert in the dense path)", () => {
  const f1 = forgeGguf(makeModel(7, "glm-dsa", { indexer: true }).gguf);   // indexer weights from seed 7
  const f2 = forgeGguf(makeModelWithIndexerNoise(7).gguf);                  // same core, indexer reseeded to 999
  const base = forward(f1.plan, synthesizeGraph(f1.plan), store(f1), ids);
  const noisy = forward(f2.plan, synthesizeGraph(f2.plan), store(f2), ids);
  for (let i = 0; i < base.length; i++) assert.strictEqual(noisy[i], base[i], `logit ${i} changed when indexer bytes changed`);
});

// helper: same MLA+MoE weights (seed 7) but RANDOM indexer bytes (seed 999) → must not affect output
function makeModelWithIndexerNoise(seed) {
  const m = makeModel(seed, "glm-dsa", { indexer: true });
  const r = prng(999);
  for (const k of ["idx_q_b", "idx_k", "idx_proj", "idx_k_norm"]) for (let i = 0; i < m.w[k].length; i++) m.w[k][i] = r();
  // rebuild gguf with the noised indexer weights but identical core weights
  const A = "glm-dsa", w = m.w, p = "blk.0.";
  const meta = {
    "general.architecture": A, [`${A}.block_count`]: 1, [`${A}.embedding_length`]: D,
    [`${A}.attention.head_count`]: NH, [`${A}.attention.key_length`]: HK, [`${A}.attention.value_length`]: HV,
    [`${A}.rope.dimension_count`]: ROPE, [`${A}.attention.kv_lora_rank`]: KVL, [`${A}.attention.q_lora_rank`]: 0,
    [`${A}.leading_dense_block_count`]: 0, [`${A}.expert_count`]: E, [`${A}.expert_used_count`]: USED,
    [`${A}.expert_shared_count`]: 1, [`${A}.expert_gating_func`]: 1, [`${A}.expert_weights_norm`]: true,
    [`${A}.expert_weights_scale`]: WSCALE, [`${A}.expert_group_count`]: 0,
    [`${A}.rope.freq_base`]: FREQ, [`${A}.attention.layer_norm_rms_epsilon`]: EPS,
  };
  const T = [
    ["token_embd.weight", [D, VOCAB], w.tok_embd], ["output_norm.weight", [D], w.output_norm], ["output.weight", [D, VOCAB], w.output],
    [p + "attn_norm.weight", [D], w.attn_norm], [p + "attn_q.weight", [D, QD], w.q],
    [p + "attn_kv_a_mqa.weight", [D, KVL + ROPE], w.kv_a_mqa], [p + "attn_kv_a_norm.weight", [KVL], w.kv_a_norm],
    [p + "attn_kv_b.weight", [KVL, KVB], w.kv_b], [p + "attn_output.weight", [WOIN, D], w.wo], [p + "ffn_norm.weight", [D], w.ffn_norm],
    [p + "ffn_gate_inp.weight", [D, E], w.gate_inp], [p + "ffn_gate_exps.weight", [D, FF, E], w.gate_exps], [p + "ffn_up_exps.weight", [D, FF, E], w.up_exps], [p + "ffn_down_exps.weight", [FF, D, E], w.down_exps],
    [p + "exp_probs_b", [E], w.exp_probs_b], [p + "ffn_gate_shexp.weight", [D, FF], w.gate_shexp], [p + "ffn_up_shexp.weight", [D, FF], w.up_shexp], [p + "ffn_down_shexp.weight", [FF, D], w.down_shexp],
    [p + "indexer.attn_q_b.weight", [IDXK, IDXH], w.idx_q_b], [p + "indexer.attn_k.weight", [D, IDXK], w.idx_k],
    [p + "indexer.proj.weight", [D, IDXK], w.idx_proj], [p + "indexer.k_norm.weight", [IDXK], w.idx_k_norm],
  ];
  return { w, gguf: buildGguf(meta, T.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32b(arr) }))) };
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
