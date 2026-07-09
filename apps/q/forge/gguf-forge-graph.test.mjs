// Graph synthesizer tests.
//  (1) Synthetic qwen2: forge -> synthesize -> well-formed dense graph, op count,
//      bias/tied detection, every weight resolves to a forge κ.
//  (2) REAL headers: build a plan straight from parseGgufHeader (data absent) and
//      synthesize — proves every weight the qwen2/llama builder references actually
//      exists in a real 7B model's tensor directory. This is the structural witness.
//  (3) MoE / unknown arch are flagged, not silently mis-synthesized.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { forgeGguf } from "./gguf-forge.mjs";
import { parseGgufHeader } from "../qvac-ingest.mjs";
import { synthesizeGraph, expectedDenseOpCount } from "./gguf-forge-graph.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

// ── GGUF writer with float metadata support (type 6) ──
function buildGguf(meta, tensors) {
  const ALIGN = 32;
  let off = 0;
  const infos = tensors.map((t) => { const o = off; off = Math.ceil((o + t.bytes.length) / ALIGN) * ALIGN; return { ...t, offset: o }; });
  let parts = [], len = 0;
  const push = (b) => { parts.push(b); len += b.length; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); push(b); };
  const f32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); push(b); };
  const u64 = (v) => { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, v >>> 0, true); dv.setUint32(4, Math.floor(v / 4294967296), true); push(b); };
  const str = (s) => { const e = new TextEncoder().encode(s); u64(e.length); push(e); };
  push(new TextEncoder().encode("GGUF")); u32(3); u64(tensors.length); u64(Object.keys(meta).length);
  for (const [k, val] of Object.entries(meta)) {
    str(k);
    if (typeof val === "string") { u32(8); str(val); }
    else if (Number.isInteger(val) && val >= 0 && val < 4294967296) { u32(4); u32(val); }
    else { u32(6); f32(val); }                       // float32 metadata (eps, freq_scale)
  }
  for (const ti of infos) { str(ti.name); u32(ti.dims.length); for (const d of ti.dims) u64(d); u32(ti.type); u64(ti.offset); }
  if (len % ALIGN) push(new Uint8Array(ALIGN - (len % ALIGN)));
  const dataStart = len;
  for (const ti of infos) { while (len < dataStart + ti.offset) push(new Uint8Array(1)); push(ti.bytes); }
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
const f32t = (dims) => { const n = dims.reduce((a, b) => a * b, 1); return { type: GGML.F32, dims, bytes: new Uint8Array(n * 4) }; };

function qwen2Synthetic({ nLayer = 2, tied = false } = {}) {
  const d = 64, nh = 4, nhkv = 2, hd = 16, ff = 128, vocab = 100, kv = nhkv * hd, qd = nh * hd;
  const meta = {
    "general.architecture": "qwen2", "qwen2.block_count": nLayer, "qwen2.embedding_length": d,
    "qwen2.attention.head_count": nh, "qwen2.attention.head_count_kv": nhkv, "qwen2.attention.key_length": hd,
    "qwen2.feed_forward_length": ff, "qwen2.rope.freq_base": 1000000, "qwen2.attention.layer_norm_rms_epsilon": 1e-6,
  };
  const T = [["token_embd.weight", [d, vocab]], ["output_norm.weight", [d]]];
  if (!tied) T.push(["output.weight", [d, vocab]]);
  for (let i = 0; i < nLayer; i++) {
    const p = `blk.${i}.`;
    T.push([p + "attn_norm.weight", [d]], [p + "attn_q.weight", [d, qd]], [p + "attn_q.bias", [qd]],
      [p + "attn_k.weight", [d, kv]], [p + "attn_k.bias", [kv]], [p + "attn_v.weight", [d, kv]], [p + "attn_v.bias", [kv]],
      [p + "attn_output.weight", [qd, d]], [p + "ffn_norm.weight", [d]],
      [p + "ffn_gate.weight", [d, ff]], [p + "ffn_up.weight", [d, ff]], [p + "ffn_down.weight", [ff, d]]);
  }
  return buildGguf(meta, T.map(([name, dims]) => ({ name, ...f32t(dims) })));
}

t("synthetic qwen2: dense graph, correct op count, all weights resolve", () => {
  const f = forgeGguf(qwen2Synthetic({ nLayer: 2 }));
  const g = synthesizeGraph(f.plan);
  assert.strictEqual(g.family, "dense", g.reason);
  assert.strictEqual(g.ops.length, expectedDenseOpCount(2)); // 3 + 9*2 = 21
  assert.strictEqual(g.stats.qkvBias, true, "qwen2 has qkv bias");
  assert.strictEqual(g.stats.tied, false, "untied (output.weight present)");
  // every op's weight refs are real κ strings
  for (const op of g.ops) for (const k of Object.values(op.w || {})) assert.match(k, /^sha256:[0-9a-f]{64}$/, `${op.op} κ`);
});

t("synthetic qwen2 tied: lm_head falls back to token_embd", () => {
  const f = forgeGguf(qwen2Synthetic({ nLayer: 1, tied: true }));
  const g = synthesizeGraph(f.plan);
  assert.strictEqual(g.stats.tied, true);
  const lm = g.ops.find((o) => o.op === "lm_head");
  const embd = g.ops.find((o) => o.op === "embd");
  assert.strictEqual(lm.w.weight, embd.w.tok_embd, "tied lm_head shares tok_embd κ");
});

t("op order matches qwen2.cpp (per-layer sequence)", () => {
  const f = forgeGguf(qwen2Synthetic({ nLayer: 1 }));
  const seq = synthesizeGraph(f.plan).ops.map((o) => o.op);
  assert.deepStrictEqual(seq, [
    "embd", "rms_norm", "qkv", "rope", "rope", "attn", "add", "rms_norm", "ffn_swiglu", "add", "rms_norm", "lm_head",
  ]);
});

// ── REAL header structural witness: does the qwen2 builder resolve on a real 7B? ──
function planFromHeader(path) {
  const h = parseGgufHeader(new Uint8Array(readFileSync(path)));
  const tensors = h.tensors.map((x) => ({ name: x.name, dims: x.dims, type: x.ggmlType, typeName: String(x.ggmlType), kappa: "sha256:" + "0".repeat(64) }));
  return { format: "gguf-forge/1", arch: h.meta["general.architecture"], ggufVersion: h.version, meta: h.meta, tensors };
}

t("REAL qwen2-7b header: every builder weight resolves", () => {
  const plan = planFromHeader("../models/qwen-coder-7b/tokenizer.gguf");
  const g = synthesizeGraph(plan);
  assert.strictEqual(g.family, "dense", g.reason);
  const nL = g.stats.n_layer;
  assert.strictEqual(g.ops.length, expectedDenseOpCount(nL), `ops for ${nL} layers`);
  assert.strictEqual(g.stats.qkvBias, true);   // qwen2 has qkv biases
  console.log(`      qwen2-7b: ${nL} layers, ${g.ops.length} ops, ${g.stats.weightsUsed} weights, tied=${g.stats.tied}`);
});

t("REAL olmoe header: MoE graph, every expert weight resolves", () => {
  const plan = planFromHeader("../models/olmoe-1b-7b/tokenizer.gguf");
  const g = synthesizeGraph(plan);
  assert.strictEqual(g.family, "moe", `got ${g.family}: ${g.reason}`);
  const nL = g.stats.n_layer;
  assert.strictEqual(g.ops.length, expectedDenseOpCount(nL), `ops for ${nL} layers`);
  assert.strictEqual(g.stats.normW, false, "olmoe norm_w=false");
  // every ffn_moe op references real expert κ-objects (gate_inp + 3 expert stacks)
  const moe = g.ops.filter((o) => o.op === "ffn_moe");
  assert.strictEqual(moe.length, nL);
  for (const o of moe) for (const k of Object.values(o.w)) assert.match(k, /^sha256:[0-9a-f]{64}$/);
  console.log(`      olmoe: ${nL} layers, ${g.stats.n_expert} experts (use ${g.stats.n_expert_used}), ${g.stats.weightsUsed} weights`);
});

// ── synthetic MoE: Mixtral (arch=llama, no shared) + Qwen2-MoE (shared + qkv bias) ──
function moeSynthetic({ arch, shared = false, qkvBias = false, nLayer = 2, nExpert = 4, nUsed = 2 } = {}) {
  const d = 64, nh = 4, nhkv = 2, hd = 16, ff = 32, vocab = 100, kv = nhkv * hd, qd = nh * hd;
  const meta = {
    "general.architecture": arch, [`${arch}.block_count`]: nLayer, [`${arch}.embedding_length`]: d,
    [`${arch}.attention.head_count`]: nh, [`${arch}.attention.head_count_kv`]: nhkv, [`${arch}.attention.key_length`]: hd,
    [`${arch}.feed_forward_length`]: ff, [`${arch}.expert_count`]: nExpert, [`${arch}.expert_used_count`]: nUsed,
    [`${arch}.expert_feed_forward_length`]: ff, [`${arch}.rope.freq_base`]: 1000000, [`${arch}.attention.layer_norm_rms_epsilon`]: 1e-6,
  };
  const T = [["token_embd.weight", [d, vocab]], ["output_norm.weight", [d]], ["output.weight", [d, vocab]]];
  for (let i = 0; i < nLayer; i++) {
    const p = `blk.${i}.`;
    T.push([p + "attn_norm.weight", [d]], [p + "attn_q.weight", [d, qd]], [p + "attn_k.weight", [d, kv]],
      [p + "attn_v.weight", [d, kv]], [p + "attn_output.weight", [qd, d]], [p + "ffn_norm.weight", [d]],
      [p + "ffn_gate_inp.weight", [d, nExpert]],
      [p + "ffn_gate_exps.weight", [d, ff, nExpert]], [p + "ffn_up_exps.weight", [d, ff, nExpert]], [p + "ffn_down_exps.weight", [ff, d, nExpert]]);
    if (qkvBias) T.push([p + "attn_q.bias", [qd]], [p + "attn_k.bias", [kv]], [p + "attn_v.bias", [kv]]);
    if (shared) T.push([p + "ffn_gate_inp_shexp.weight", [d, 1]], [p + "ffn_gate_shexp.weight", [d, ff]],
      [p + "ffn_up_shexp.weight", [d, ff]], [p + "ffn_down_shexp.weight", [ff, d]]);
  }
  return buildGguf(meta, T.map(([name, dims]) => ({ name, ...f32t(dims) })));
}

t("synthetic Mixtral (llama+experts): MoE graph, norm_w=true, no shared", () => {
  const f = forgeGguf(moeSynthetic({ arch: "llama", nLayer: 2, nExpert: 8, nUsed: 2 }));
  const g = synthesizeGraph(f.plan);
  assert.strictEqual(g.family, "moe", g.reason);
  assert.strictEqual(g.ops.length, expectedDenseOpCount(2));
  assert.strictEqual(g.stats.normW, true);
  assert.strictEqual(g.stats.sharedExpert, false);
  const moe = g.ops.find((o) => o.op === "ffn_moe");
  assert.strictEqual(moe.attrs.n_expert, 8);
  assert.strictEqual(moe.attrs.n_expert_used, 2);
  assert.ok(moe.w.gate_inp && moe.w.gate_exps && moe.w.up_exps && moe.w.down_exps, "routed expert κ refs");
  assert.ok(!moe.w.gate_shexp, "no shared expert for Mixtral");
  for (const k of Object.values(moe.w)) assert.match(k, /^sha256:[0-9a-f]{64}$/);
});

t("synthetic Qwen2-MoE: shared expert + qkv bias, norm_w=false", () => {
  const f = forgeGguf(moeSynthetic({ arch: "qwen2moe", shared: true, qkvBias: true, nLayer: 1, nExpert: 6, nUsed: 2 }));
  const g = synthesizeGraph(f.plan);
  assert.strictEqual(g.family, "moe", g.reason);
  assert.strictEqual(g.stats.normW, false);
  assert.strictEqual(g.stats.qkvBias, true);
  assert.strictEqual(g.stats.sharedExpert, true);
  const moe = g.ops.find((o) => o.op === "ffn_moe");
  assert.ok(moe.attrs.shared, "shared flag set");
  assert.ok(moe.w.gate_inp_shexp && moe.w.gate_shexp && moe.w.up_shexp && moe.w.down_shexp, "shared expert κ refs");
});

t("per-layer op order for MoE matches builder", () => {
  const f = forgeGguf(moeSynthetic({ arch: "llama", nLayer: 1 }));
  const seq = synthesizeGraph(f.plan).ops.map((o) => o.op);
  assert.deepStrictEqual(seq, [
    "embd", "rms_norm", "qkv", "rope", "rope", "attn", "add", "rms_norm", "ffn_moe", "add", "rms_norm", "lm_head",
  ]);
});

// ── DeepSeek-V2 MLA builder: structural + op-order witness vs deepseek2.cpp ──
// No DeepSeek GGUF is present, so this proves the builder references exactly the
// tensors deepseek2.cpp uses, in the right op order. Numeric parity is deferred to
// when a DeepSeek GGUF + patched llama.cpp reference exist (mla_attn executor op).
const dsT = (name, dims = [8, 8]) => ({ name, kappa: "k:" + name, dims, type: 0, typeName: "F32" });
function deepseekLitePlan() {
  const meta = {
    "general.architecture": "deepseek2", "deepseek2.block_count": 2, "deepseek2.embedding_length": 16,
    "deepseek2.attention.head_count": 2, "deepseek2.attention.key_length": 192, "deepseek2.attention.value_length": 128,
    "deepseek2.rope.dimension_count": 64, "deepseek2.attention.kv_lora_rank": 512, "deepseek2.attention.q_lora_rank": 0,
    "deepseek2.leading_dense_block_count": 1, "deepseek2.expert_count": 4, "deepseek2.expert_used_count": 2,
    "deepseek2.expert_shared_count": 1, "deepseek2.expert_gating_func": 2, "deepseek2.expert_weights_norm": true,
    "deepseek2.expert_weights_scale": 2.5,
  };
  const T = [dsT("token_embd.weight"), dsT("output_norm.weight"), dsT("output.weight")];
  for (let il = 0; il < 2; il++) {
    const p = `blk.${il}.`;
    T.push(dsT(p + "attn_norm.weight"), dsT(p + "attn_q.weight"), dsT(p + "attn_kv_a_mqa.weight"),
      dsT(p + "attn_kv_a_norm.weight"), dsT(p + "attn_kv_b.weight"), dsT(p + "attn_output.weight"), dsT(p + "ffn_norm.weight"));
    if (il < 1) T.push(dsT(p + "ffn_gate.weight"), dsT(p + "ffn_up.weight"), dsT(p + "ffn_down.weight"));
    else T.push(dsT(p + "ffn_gate_inp.weight"), dsT(p + "ffn_gate_exps.weight"), dsT(p + "ffn_up_exps.weight"),
      dsT(p + "ffn_down_exps.weight"), dsT(p + "exp_probs_b"), dsT(p + "ffn_gate_shexp.weight"),
      dsT(p + "ffn_up_shexp.weight"), dsT(p + "ffn_down_shexp.weight"));
  }
  return { arch: "deepseek2", meta, tensors: T };
}

t("DeepSeek-V2-Lite (deepseek2): MLA + DeepSeek-MoE graph, every weight resolves", () => {
  const g = synthesizeGraph(deepseekLitePlan());
  assert.strictEqual(g.family, "mla-moe", `got ${g.family}`);
  assert.ok(g.stats.lite, "detected lite (direct wq)");
  assert.strictEqual(g.stats.kv_lora, 512);
  assert.strictEqual(g.stats.qk_nope, 128, "192 key_length − 64 rope = 128 nope");
  assert.strictEqual(g.stats.gating, "sigmoid");
  assert.strictEqual(g.stats.n_dense_lead, 1);
  assert.deepStrictEqual(g.ops.map((o) => o.op), [
    "embd",
    "rms_norm", "mla_attn", "add", "rms_norm", "ffn_swiglu", "add",   // L0 dense (leading)
    "rms_norm", "mla_attn", "add", "rms_norm", "ffn_moe", "add",       // L1 MoE
    "rms_norm", "lm_head",
  ]);
  const mla = g.ops.find((o) => o.op === "mla_attn");
  assert.ok(mla.w.q && mla.w.kv_a_mqa && mla.w.kv_a_norm && mla.w.kv_b && mla.w.wo, "MLA tensor refs");
  assert.strictEqual(mla.attrs.kv_lora, 512);
  const moe = g.ops.find((o) => o.op === "ffn_moe");
  assert.ok(moe.w.exp_probs_b, "selection-bias ref");
  assert.ok(moe.w.gate_shexp && moe.w.up_shexp && moe.w.down_shexp, "ungated shared expert refs");
  assert.strictEqual(moe.attrs.sharedGate, false, "DeepSeek shared expert is ungated (unlike qwen2moe)");
});

t("DeepSeek-V2 non-lite: q_a→q_a_norm→q_b LoRA path resolves", () => {
  const plan = deepseekLitePlan();
  plan.meta["deepseek2.attention.q_lora_rank"] = 1536;
  plan.tensors = plan.tensors.filter((tn) => !tn.name.endsWith("attn_q.weight"));
  for (let il = 0; il < 2; il++) {
    const p = `blk.${il}.`;
    plan.tensors.push(dsT(p + "attn_q_a.weight"), dsT(p + "attn_q_a_norm.weight"), dsT(p + "attn_q_b.weight"));
  }
  const g = synthesizeGraph(plan);
  assert.strictEqual(g.family, "mla-moe", `got ${g.family}`);
  assert.ok(!g.stats.lite, "non-lite (LoRA Q)");
  const mla = g.ops.find((o) => o.op === "mla_attn");
  assert.ok(mla.w.q_a && mla.w.q_a_norm && mla.w.q_b && !mla.w.q, "Q LoRA refs, no direct wq");
});

t("GLM-5.2 (glm-dsa) runs via the deepseek2 builder; DSA indexer tensors unused (dense, matches llama build)", () => {
  // GLM_DSA → llm_build_deepseek2 in llama (no indexer code); the DSA shared indexer is a
  // long-ctx optimization (no-op for seq ≤ index_topk), this build runs it dense.
  const base = deepseekLitePlan();
  const meta = { "general.architecture": "glm-dsa" };
  for (const k in base.meta) if (k !== "general.architecture") meta["glm-dsa." + k.split(".").slice(1).join(".")] = base.meta[k];
  const tensors = [...base.tensors, { name: "blk.0.indexer.attn_q_b.weight", kappa: "k:idx", dims: [8, 8], type: 0, typeName: "F32" }];
  const g = synthesizeGraph({ arch: "glm-dsa", meta, tensors });
  assert.strictEqual(g.family, "mla-moe", `got ${g.family} ${g.reason || ""}`);
  assert.ok(g.stats.mla && g.ops.some((o) => o.op === "mla_attn"), "MLA forward synthesized");
  assert.ok(!Object.keys(g.weights).some((n) => n.includes("indexer")), "DSA indexer tensors are NOT referenced by the dense forward");
});

t("MLA tensor signature (deepseek-style) flagged even without a known arch name", () => {
  // Defense in depth: a model carrying attn_kv_a_mqa/attn_kv_b is MLA regardless of
  // the arch string, so it must be gated by tensor signature, not silently synthesized.
  const plan = { arch: "some_future_mla", meta: { "general.architecture": "some_future_mla", "some_future_mla.block_count": 2, "some_future_mla.embedding_length": 64, "some_future_mla.attention.head_count": 4 },
    tensors: [{ name: "blk.0.attn_kv_a_mqa.weight", kappa: "k", dims: [64, 64], type: 0, typeName: "F32" }] };
  const g = synthesizeGraph(plan);
  assert.strictEqual(g.family, "moe-unsupported", `got ${g.family}`);
  assert.ok(g.stats.mla, "flagged as MLA by tensor signature");
});

t("unknown arch flagged unsupported", () => {
  // jamba is a real arch not yet synthesized (mamba/rwkv7 are now supported, so
  // they're no longer the example). Should be flagged, not silently mis-synthesized.
  const plan = { arch: "jamba", meta: { "general.architecture": "jamba", "jamba.block_count": 4, "jamba.embedding_length": 64, "jamba.attention.head_count": 4 }, tensors: [] };
  const g = synthesizeGraph(plan);
  assert.strictEqual(g.family, "unsupported");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
