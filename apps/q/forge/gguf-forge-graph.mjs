// GGUF Forge — transformer graph-plan synthesizer.
//
// GGUF carries NO compute graph (unlike ONNX): only weights + hyperparameters. So
// the forge must SYNTHESIZE the forward-pass DAG from metadata, reproducing the
// per-arch builder in src/models/<arch>.cpp op-for-op. This module emits that DAG
// at the granularity of llama.cpp's graph helpers (build_norm / build_qkv /
// ggml_rope_ext / build_attn / build_ffn), with every weight resolved to its
// forge κ. The result is JSON-serializable and seals into the plan (L1).
//
// Reproduces qwen2.cpp (src/models/qwen2.cpp) — the dense RMSNorm+RoPE(NEOX)+SwiGLU
// family (llama/qwen2/qwen3-dense/mistral share this skeleton; per-arch deltas =
// qkv bias, qk-norm). MoE and other archs are flagged unsupported (honest, not
// silently wrong). LLM_FFN_SILU/LLM_FFN_PAR -> SwiGLU; scale = 1/sqrt(head_dim).

const RMS_EPS_DEFAULT = 1e-6, ROPE_BASE_DEFAULT = 10000;

// archs known to be the dense family this synthesizer reproduces faithfully.
// bitnet (BitNet b1.58) is dense attention + SwiGLU FFN with two EXTRA sub-norms
// (attn_sub_norm before wo, ffn_sub_norm before ffn_down) and optional per-linear
// ternary weight-scales — handled inline below. (src/models/bitnet.cpp)
const DENSE_FAMILY = new Set(["llama", "qwen2", "qwen3", "mistral", "minicpm", "phi3", "bitnet"]);
const BITNET_FAMILY = new Set(["bitnet"]);

// Gemma family — dense attention but a distinct skeleton (gemma3.cpp): embedding
// ×√n_embd, QK-norm, GeGLU FFN, FOUR norms/layer (pre+post on attn and ffn),
// per-layer RoPE base (sliding-window vs global), sliding-window attention.
const GEMMA_FAMILY = new Set(["gemma3"]);

// Mamba family — recurrent selective state-space (no attention, no FFN). A new
// kernel class: causal depthwise conv1d (ssm_conv) + selective scan (ssm_scan).
// mamba = Mamba-1 (per-channel decay); mamba2 = scalar-per-head decay + grouped
// B/C + grouped RMSNorm, with x/B/C all coming out of the conv (no x_proj/dt_proj).
const MAMBA_FAMILY = new Set(["mamba", "mamba2"]);

// RWKV7 — recurrent linear-attention (no softmax attention, no QKV). New kernel:
// delta-rule WKV (rwkv_wkv7) + token-shift, LayerNorm (not RMS), many LoRA gates,
// per-head group-norm, squared-relu channel-mix.
const RWKV7_FAMILY = new Set(["rwkv7"]);

// MoE archs whose attention skeleton == the dense family and whose FFN is the plain
// routed-expert block (softmax gating, separate gate/up, optional shared expert). The
// norm_w flag is hardcoded per-arch in the qvac builder (NOT a single metadata key) —
// values transcribed from each src/models/<arch>.cpp build_moe_ffn call:
//   llama/Mixtral :116 norm_w=true,  qwen2moe :77 norm_w=false +shared,
//   qwen3moe :86 norm_w=true,        olmoe :94 norm_w=false.
// Exotic variants (deepseek2 group-topk + exp_probs_b + fused gate_up, llama4
// weight-before-ffn) are deliberately excluded → flagged moe-unsupported.
const MOE_ARCH = {
  llama:    { normW: true,  shared: false },   // Mixtral (disambiguated by expert_count>0)
  qwen2moe: { normW: false, shared: true },
  qwen3moe: { normW: true,  shared: false },
  olmoe:    { normW: false, shared: false },
};

function metaNum(meta, arch, key) {
  const v = meta[`${arch}.${key}`];
  return typeof v === "number" ? v : undefined;
}

// Build a name->{kappa,dims,type} index from a forge plan's tensor list.
function weightIndex(planTensors) {
  const idx = {};
  for (const t of planTensors) idx[t.name] = { name: t.name, kappa: t.kappa, dims: t.dims, type: t.type, typeName: t.typeName };
  return idx;
}

// Synthesize the forward graph for a forge plan. Returns { arch, family, ops, weights, stats }.
// Throws on a missing referenced weight; flags unsupported archs via family:"unsupported".
export function synthesizeGraph(plan) {
  const meta = plan.meta, arch = plan.arch;
  const W = weightIndex(plan.tensors);
  const has = (n) => n in W;

  const n_layer = metaNum(meta, arch, "block_count");
  const n_embd = metaNum(meta, arch, "embedding_length");
  const n_head = metaNum(meta, arch, "attention.head_count");
  const n_head_kv = metaNum(meta, arch, "attention.head_count_kv") ?? n_head;
  const head_dim = metaNum(meta, arch, "attention.key_length") ?? (n_head ? Math.floor(n_embd / n_head) : 0);
  const n_rot = metaNum(meta, arch, "rope.dimension_count") ?? head_dim;
  const eps = metaNum(meta, arch, "attention.layer_norm_rms_epsilon") ?? RMS_EPS_DEFAULT;
  const freq_base = metaNum(meta, arch, "rope.freq_base") ?? ROPE_BASE_DEFAULT;
  const freq_scale = metaNum(meta, arch, "rope.scaling.factor") ?? 1.0;
  const n_expert = metaNum(meta, arch, "expert_count") ?? 0;
  const n_expert_used = metaNum(meta, arch, "expert_used_count") ?? 0;
  const w_scale = metaNum(meta, arch, "expert_weights_scale") ?? 1.0;
  const moeCfg = n_expert > 0 ? MOE_ARCH[arch] : null;

  // MLA + sparse-attention archs (DeepSeek-V2/V3, GLM-4.6/GLM-5.2 "glm-dsa"):
  // their attention is Multi-head Latent Attention — Q and KV are compressed through
  // LoRA projections (attn_q_a→attn_q_b, attn_kv_a_mqa→attn_kv_b) with a DECOUPLED
  // RoPE split — NOT the GQA wq/wk/wv block every builder below assumes. GLM-5.2
  // additionally uses DeepSeek Sparse Attention with a SHARED indexer (index_topk_freq
  // ≈ 4 → only ~1 layer in 4 carries indexer weights; the rest reuse it, "IndexShare").
  // Stock llama.cpp could not even load it (it assumed an indexer per layer); a custom
  // patch was required. Faithful synthesis needs NEW ops (mla_attn with kv_a/kv_b LoRA
  // + decoupled-RoPE concat, a sparse top-k indexer, and shared-indexer reuse across a
  // layer group) verified against that patched llama.cpp — none of which exists yet.
  // Detect by arch name OR by the MLA tensor signature, and flag honestly so nobody
  // drops the arch into MOE_ARCH and emits the GQA graph below, which would be
  // silently wrong (the attention, not just the gating, is the exotic part).
  // deepseek2 / deepseek2ocr / glm-dsa all use llm_build_deepseek2 (MLA + MoE, NORM rope)
  // — verified in llama-model.cpp (GLM_DSA → llm_build_deepseek2; deepseek2.cpp has no
  // indexer code). GLM-5.2's DSA sparse SHARED indexer (blk.N.indexer.*) is a LONG-CONTEXT
  // optimization: a no-op when seq ≤ index_topk (top-k selects all positions), and this
  // llama build runs glm-dsa DENSE (indexer tensors load but are unused in the forward).
  // So glm-dsa runs through the deepseek2 builder below, matching llama; the indexer
  // tensors are simply unreferenced. (True sparse-DSA for very long context = future work
  // when a DSA-enabled reference exists — see hologram-glm-dsa-indexer prompt.)
  const DEEPSEEK_FAMILY = new Set(["deepseek2", "deepseek2ocr", "glm-dsa"]);
  const mlaTensors = has("blk.0.attn_kv_a_mqa.weight") || has("blk.0.attn_kv_b.weight") || has("blk.0.attn_q_b.weight");
  if (mlaTensors && !DEEPSEEK_FAMILY.has(arch)) {                // unknown MLA arch → gate honestly
    const needs = ["MLA latent attention (kv_a/kv_b LoRA + decoupled RoPE), not GQA"];
    if (has("blk.0.indexer.attn_q_b.weight")) needs.push("DeepSeek sparse attention shared indexer (IndexShare)");
    if (n_expert > 0) needs.push(`routed MoE (${n_expert} experts, ${n_expert_used} used/token)`);
    return { arch, family: "moe-unsupported", reason: `arch '${arch}' needs ${needs.join(" + ")} — not yet synthesized`, stats: { n_layer, n_expert, n_expert_used, mla: true } };
  }

  // Qwen3.5 / Qwen3-Next HYBRID: gated-DeltaNet linear-attention layers interleaved with PERIODIC full
  // attention (every full_attention_interval-th layer). The linear layers carry an ssm_* tensor set
  // (ssm_a, ssm_alpha, ssm_beta, ssm_conv1d, ssm_dt, ssm_norm, ssm_out + a fused attn_qkv and an attn_gate)
  // implementing the Gated DeltaNet recurrence — NOT Mamba2's selective scan (different math: a delta-rule
  // state update S_t = S_{t-1}(diag α_t − β_t k_t k_tᵀ) + β_t v_t k_tᵀ, with a per-step β gate and α decay,
  // then an output gate + ssm RMSNorm). The attention layers are qwen3-style GQA + QK-norm. Faithful
  // synthesis needs a NEW gated-deltanet kernel (causal depthwise conv1d + delta-rule scan + output gate +
  // ssm norm) AND a hybrid scheduler that picks linear-vs-attention per layer by full_attention_interval —
  // verified against the llama.cpp build that quantized this. None exists yet; gate honestly so the think
  // faculty fails-soft with a TRUE reason instead of emitting a dense graph that would be silently wrong.
  const ssmHybrid = has("blk.0.ssm_conv1d.weight") && (has("blk.0.ssm_alpha.weight") || has("blk.0.ssm_beta.weight"));
  if (ssmHybrid && !MAMBA_FAMILY.has(arch)) {
    const interval = metaNum(meta, arch, "full_attention_interval") ?? 0;
    const attnLayers = interval ? Math.floor(n_layer / interval) : 0;
    return { arch, family: "hybrid-unsupported",
      reason: `arch '${arch}' is a gated-DeltaNet × full-attention hybrid — needs a gated-deltanet linear-attention kernel + per-layer interleave (full_attention_interval=${interval}); not yet synthesized`,
      stats: { n_layer, attnLayers, linearLayers: n_layer - attnLayers, fullAttentionInterval: interval, hybrid: true } };
  }

  // arch gating — be honest about coverage
  if (n_expert > 0) {
    if (!moeCfg && !DEEPSEEK_FAMILY.has(arch)) return { arch, family: "moe-unsupported", reason: `MoE arch '${arch}' not yet synthesized (exotic gating/routing)`, stats: { n_layer, n_expert } };
    if (has("blk.0.ffn_gate_up_exps.weight")) return { arch, family: "moe-unsupported", reason: "fused gate_up_exps not yet synthesized", stats: { n_layer, n_expert } };
    if (!n_expert_used) return { arch, family: "incomplete", reason: "missing expert_used_count", stats: { n_layer, n_expert } };
  } else if (!DENSE_FAMILY.has(arch) && !GEMMA_FAMILY.has(arch) && !MAMBA_FAMILY.has(arch) && !RWKV7_FAMILY.has(arch) && !DEEPSEEK_FAMILY.has(arch)) {
    return { arch, family: "unsupported", reason: `arch '${arch}' not in dense family`, stats: { n_layer } };
  }
  // Recurrent archs (Mamba/RWKV7) have no attention — need n_layer/n_embd but not head_count.
  const recurrent = MAMBA_FAMILY.has(arch) || RWKV7_FAMILY.has(arch);
  if (!n_layer || !n_embd || (!recurrent && !n_head)) return { arch, family: "incomplete", reason: "missing core hparams (block_count/embedding_length/head_count)", stats: { n_layer, n_embd, n_head } };

  const qkvBias = has("blk.0.attn_q.bias");
  const qkNorm = has("blk.0.attn_q_norm.weight");
  const bitnet = BITNET_FAMILY.has(arch);             // BitNet b1.58: + attn/ffn sub-norms
  const tied = !has("output.weight");                 // lm_head shares tok_embd
  const lmHeadName = tied ? "token_embd.weight" : "output.weight";
  const outBias = has("output.bias");

  const ops = [];
  const used = new Set();
  const ref = (name) => { if (!has(name)) throw new Error(`graph: missing weight '${name}' referenced by ${arch} builder`); used.add(name); return W[name].kappa; };

  // ── Mamba-1 (mamba.cpp / mamba-base.cpp build_mamba_layer) ────────────────
  // Recurrent SSM: per layer = RMSNorm → mamba mixer → residual. NO attention,
  // NO separate FFN. ssm_a is stored pre-transformed (A = −exp(A_log)). The mixer
  // op carries the conv1d + selective-scan; the executor holds the recurrent state.
  if (MAMBA_FAMILY.has(arch)) {
    const d_conv = metaNum(meta, arch, "ssm.conv_kernel");
    const d_inner = metaNum(meta, arch, "ssm.inner_size");
    const d_state = metaNum(meta, arch, "ssm.state_size");
    const dt_rank = metaNum(meta, arch, "ssm.time_step_rank");
    const n_group = metaNum(meta, arch, "ssm.group_count") ?? 1;
    if (!d_conv || !d_inner || !d_state || !dt_rank) return { arch, family: "incomplete", reason: "missing ssm hparams (conv_kernel/inner_size/state_size/time_step_rank)", stats: { n_layer, d_conv, d_inner, d_state, dt_rank } };
    const mamba2 = arch === "mamba2";
    const n_head = mamba2 ? dt_rank : d_inner;        // Mamba-2: n_head = time_step_rank
    const head_dim = mamba2 ? d_inner / n_head : 1;
    const tiedM = !has("output.weight"), lmM = tiedM ? "token_embd.weight" : "output.weight";
    ops.push({ op: "embd", out: "h", w: { tok_embd: ref("token_embd.weight") } });
    for (let il = 0; il < n_layer; il++) {
      const p = `blk.${il}.`, prev = il === 0 ? "h" : `l${il - 1}.out`;
      ops.push({ op: "rms_norm", out: `l${il}.norm`, in: prev, w: { weight: ref(p + "attn_norm.weight") }, attrs: { eps } });
      if (mamba2) {
        ops.push({ op: "mamba2", out: `l${il}.mixer`, in: `l${il}.norm`,
          w: { in: ref(p + "ssm_in.weight"), conv1d: ref(p + "ssm_conv1d.weight"), conv1d_b: ref(p + "ssm_conv1d.bias"),
               dt_b: ref(p + "ssm_dt.bias"), a: ref(p + "ssm_a"), d: ref(p + "ssm_d"), norm: ref(p + "ssm_norm.weight"), out: ref(p + "ssm_out.weight") },
          attrs: { d_conv, d_inner, d_state, n_head, head_dim, n_group, layer: il } });
      } else {
        ops.push({ op: "mamba", out: `l${il}.mixer`, in: `l${il}.norm`,
          w: { in: ref(p + "ssm_in.weight"), conv1d: ref(p + "ssm_conv1d.weight"), conv1d_b: ref(p + "ssm_conv1d.bias"),
               x: ref(p + "ssm_x.weight"), dt: ref(p + "ssm_dt.weight"), dt_b: ref(p + "ssm_dt.bias"),
               a: ref(p + "ssm_a"), d: ref(p + "ssm_d"), out: ref(p + "ssm_out.weight") },
          attrs: { d_conv, d_inner, d_state, dt_rank, layer: il } });
      }
      ops.push({ op: "add", out: `l${il}.out`, in: [`l${il}.mixer`, prev] });
    }
    ops.push({ op: "rms_norm", out: "result_norm", in: `l${n_layer - 1}.out`, w: { weight: ref("output_norm.weight") }, attrs: { eps } });
    ops.push({ op: "lm_head", out: "logits", in: "result_norm", w: { weight: ref(lmM) }, attrs: { tied: tiedM } });
    const weightsM = {}; for (const n of used) weightsM[n] = W[n];
    const statsM = { n_layer, n_embd, head_dim, n_head, n_head_kv: n_head, eps, d_conv, d_inner, d_state, dt_rank, n_group, mamba2, tied: tiedM, ops: ops.length, weightsUsed: used.size };
    return { arch, family: "ssm", ops, weights: weightsM, stats: statsM };
  }

  // ── RWKV7 (rwkv7.cpp / rwkv7-base.cpp) ───────────────────────────────────
  if (RWKV7_FAMILY.has(arch)) {
    const head_size = metaNum(meta, arch, "wkv.head_size");
    const lnEps = metaNum(meta, arch, "attention.layer_norm_epsilon") ?? 1e-5;
    if (!head_size) return { arch, family: "incomplete", reason: "missing wkv.head_size", stats: { n_layer, n_embd } };
    const head_count = n_embd / head_size, gate = has("blk.0.time_mix_g1.weight");
    const LN = (out, inp, base) => ({ op: "layer_norm", out, in: inp, w: { weight: ref(base + ".weight"), bias: ref(base + ".bias") }, attrs: { eps: lnEps } });
    ops.push({ op: "embd", out: "e", w: { tok_embd: ref("token_embd.weight") } });
    ops.push(LN("h_norm", "e", "token_embd_norm"));
    for (let il = 0; il < n_layer; il++) {
      const p = `blk.${il}.`, prev = il === 0 ? "h_norm" : `l${il - 1}.out`;
      ops.push(LN(`l${il}.att_norm`, prev, p + "attn_norm"));
      const tw = { lerp_fused: ref(p + "time_mix_lerp_fused.weight"), receptance: ref(p + "time_mix_receptance.weight"),
        w0: ref(p + "time_mix_w0.weight"), w1: ref(p + "time_mix_w1.weight"), w2: ref(p + "time_mix_w2.weight"),
        key: ref(p + "time_mix_key.weight"), value: ref(p + "time_mix_value.weight"),
        a0: ref(p + "time_mix_a0.weight"), a1: ref(p + "time_mix_a1.weight"), a2: ref(p + "time_mix_a2.weight"),
        k_k: ref(p + "time_mix_k_k.weight"), k_a: ref(p + "time_mix_k_a.weight"), r_k: ref(p + "time_mix_r_k.weight"),
        ln: ref(p + "time_mix_ln.weight"), ln_b: ref(p + "time_mix_ln.bias"), output: ref(p + "time_mix_output.weight") };
      if (il > 0) { tw.v0 = ref(p + "time_mix_v0.weight"); tw.v1 = ref(p + "time_mix_v1.weight"); tw.v2 = ref(p + "time_mix_v2.weight"); }
      if (gate) { tw.g1 = ref(p + "time_mix_g1.weight"); tw.g2 = ref(p + "time_mix_g2.weight"); }
      ops.push({ op: "rwkv7_tmix", out: `l${il}.tmix`, in: `l${il}.att_norm`, w: tw, attrs: { n_embd, head_size, head_count, layer: il } });
      ops.push({ op: "add", out: `l${il}.ffn_inp`, in: [`l${il}.tmix`, prev] });
      ops.push(LN(`l${il}.ffn_norm`, `l${il}.ffn_inp`, p + "attn_norm_2"));
      ops.push({ op: "rwkv7_cmix", out: `l${il}.cmix`, in: `l${il}.ffn_norm`,
        w: { lerp_k: ref(p + "channel_mix_lerp_k.weight"), key: ref(p + "channel_mix_key.weight"), value: ref(p + "channel_mix_value.weight") }, attrs: { n_embd, layer: il } });
      ops.push({ op: "add", out: `l${il}.out`, in: [`l${il}.cmix`, `l${il}.ffn_inp`] });
    }
    ops.push(LN("result_norm", `l${n_layer - 1}.out`, "output_norm"));
    ops.push({ op: "lm_head", out: "logits", in: "result_norm", w: { weight: ref("output.weight") }, attrs: { tied: false } });
    const weightsR = {}; for (const n of used) weightsR[n] = W[n];
    const statsR = { n_layer, n_embd, head_size, head_count, gate, lnEps, ops: ops.length, weightsUsed: used.size };
    return { arch, family: "rwkv7", ops, weights: weightsR, stats: statsR };
  }

  // ── Gemma3 (gemma3.cpp) ──────────────────────────────────────────────────
  if (GEMMA_FAMILY.has(arch)) {
    const tiedG = !has("output.weight");
    const lmG = tiedG ? "token_embd.weight" : "output.weight";
    // f_attention_scale (llama-model.cpp:1601): 27B uses n_embd/n_head, else head_dim.
    const attnScale = n_layer === 62 ? 1 / Math.sqrt(n_embd / n_head) : 1 / Math.sqrt(head_dim);
    const embdScale = Math.sqrt(n_embd);                                   // inp ×√n_embd (gemma3.cpp:13)
    const freqBaseSwa = metaNum(meta, arch, "rope.freq_base_swa") ?? 10000; // SWA layers' RoPE base
    const nSwa = metaNum(meta, arch, "attention.sliding_window") ?? 0;
    const swaPat = metaNum(meta, arch, "attention.sliding_window_pattern") ?? 6;
    const softcap = metaNum(meta, arch, "final_logit_softcapping") ?? 0;   // removed in Gemma3 (usually 0)
    const isSwa = (il) => nSwa > 0 && (il % swaPat < swaPat - 1);          // is_swa: last of each group is global

    ops.push({ op: "embd", out: "h", w: { tok_embd: ref("token_embd.weight") }, attrs: { scale: embdScale } });
    for (let il = 0; il < n_layer; il++) {
      const p = `blk.${il}.`, prev = il === 0 ? "h" : `l${il - 1}.out`;
      const fb = isSwa(il) ? freqBaseSwa : freq_base, swa = isSwa(il) ? nSwa : 0;
      ops.push({ op: "rms_norm", out: `l${il}.attn_norm`, in: prev, w: { weight: ref(p + "attn_norm.weight") }, attrs: { eps } });
      ops.push({ op: "qkv", out: { q: `l${il}.Q`, k: `l${il}.K`, v: `l${il}.V` }, in: `l${il}.attn_norm`,
        w: { wq: ref(p + "attn_q.weight"), wk: ref(p + "attn_k.weight"), wv: ref(p + "attn_v.weight"),
             q_norm: ref(p + "attn_q_norm.weight"), k_norm: ref(p + "attn_k_norm.weight") },
        attrs: { n_head, n_head_kv, head_dim, qk_norm_eps: eps } });
      ops.push({ op: "rope", target: `l${il}.Q`, attrs: { n_rot, type: "neox", freq_base: fb, freq_scale } });
      ops.push({ op: "rope", target: `l${il}.K`, attrs: { n_rot, type: "neox", freq_base: fb, freq_scale } });
      ops.push({ op: "attn", out: `l${il}.attn_out`, in: { q: `l${il}.Q`, k: `l${il}.K`, v: `l${il}.V` },
        w: { wo: ref(p + "attn_output.weight") }, attrs: { n_head, n_head_kv, head_dim, scale: attnScale, causal: true, swa } });
      ops.push({ op: "rms_norm", out: `l${il}.post_attn`, in: `l${il}.attn_out`, w: { weight: ref(p + "post_attention_norm.weight") }, attrs: { eps } });
      ops.push({ op: "add", out: `l${il}.sa_out`, in: [`l${il}.post_attn`, prev] });
      ops.push({ op: "rms_norm", out: `l${il}.ffn_norm`, in: `l${il}.sa_out`, w: { weight: ref(p + "ffn_norm.weight") }, attrs: { eps } });
      ops.push({ op: "ffn_swiglu", out: `l${il}.ffn_act`, in: `l${il}.ffn_norm`,
        w: { gate: ref(p + "ffn_gate.weight"), up: ref(p + "ffn_up.weight"), down: ref(p + "ffn_down.weight") }, attrs: { act: "gelu" } });
      ops.push({ op: "rms_norm", out: `l${il}.post_ffw`, in: `l${il}.ffn_act`, w: { weight: ref(p + "post_ffw_norm.weight") }, attrs: { eps } });
      ops.push({ op: "add", out: `l${il}.out`, in: [`l${il}.post_ffw`, `l${il}.sa_out`] });
    }
    ops.push({ op: "rms_norm", out: "result_norm", in: `l${n_layer - 1}.out`, w: { weight: ref("output_norm.weight") }, attrs: { eps } });
    const lmg = { op: "lm_head", out: "logits", in: "result_norm", w: { weight: ref(lmG) }, attrs: { tied: tiedG } };
    if (softcap) lmg.attrs.softcap = softcap;
    ops.push(lmg);
    const weightsG = {}; for (const n of used) weightsG[n] = W[n];
    const statsG = { n_layer, n_embd, n_head, n_head_kv, head_dim, n_rot, eps, freq_base, freqBaseSwa, nSwa, swaPat, attnScale, embdScale, tied: tiedG, ops: ops.length, weightsUsed: used.size };
    return { arch, family: "gemma", ops, weights: weightsG, stats: statsG };
  }

  // ── DeepSeek-V2 / V2-Lite (deepseek2.cpp) — MLA attention + DeepSeek MoE ───────
  // Multi-head Latent Attention: Q and KV are low-rank. Q = wq (lite) or
  // wq_a→q_a_norm→wq_b. KV: wkv_a_mqa → [kv_cmpr | k_pe]; kv_a_norm(kv_cmpr); then the
  // DECOMPRESSION path wkv_b → [k_nope | v] (the MHA-equivalent that yields reference
  // logits — the wk_b/wv_b "absorption" path is a runtime MQA optimization, not built
  // here). Decoupled NEOX RoPE on q_pe/k_pe only; kq_scale carries YaRN mscale params.
  // FFN: dense for the leading `leading_dense_block_count` layers, else routed experts
  // (+ an UNGATED shared expert, unlike qwen2moe's sigmoid-gated one). mla_attn is one
  // composite op (like `attn`/`qkv`); the executor expands it. GLM's DSA indexer is not
  // here (glm-dsa stays gated above). This is the structural/op-order builder; numeric
  // parity awaits a DeepSeek GGUF + patched llama.cpp reference.
  if (DEEPSEEK_FAMILY.has(arch)) {
    const n_embd_head_k = metaNum(meta, arch, "attention.key_length") ?? head_dim;
    const n_embd_head_v = metaNum(meta, arch, "attention.value_length") ?? head_dim;
    const qk_rope = n_rot, qk_nope = n_embd_head_k - qk_rope;          // decoupled-RoPE split
    const kv_lora = metaNum(meta, arch, "attention.kv_lora_rank") ?? 0;
    const q_lora = metaNum(meta, arch, "attention.q_lora_rank") ?? 0;
    const n_dense_lead = metaNum(meta, arch, "leading_dense_block_count") ?? 0;
    const n_shared = metaNum(meta, arch, "expert_shared_count") ?? 0;
    const gating = (metaNum(meta, arch, "expert_gating_func") ?? 1) === 2 ? "sigmoid" : "softmax";
    const normW = !!(metaNum(meta, arch, "expert_weights_norm") ?? meta[`${arch}.expert_weights_norm`]);
    const groupCount = metaNum(meta, arch, "expert_group_count") ?? 0;
    const groupUsed = metaNum(meta, arch, "expert_group_used_count") ?? 0;
    // [TAG_DEEPSEEK2_YARN_LOG_MUL_FIX] (llama-model.cpp:1996): the GGUF stores 0.1×mscale_all_dim,
    // so llama divides the stored yarn_log_multiplier by 0.1 to recover the real value.
    const yarnLogMul = (metaNum(meta, arch, "rope.scaling.yarn_log_multiplier") ?? 0) / 0.1;
    const ropeScaling = meta[`${arch}.rope.scaling.type`];            // "yarn" → needs the YaRN ramp (not yet in mla_attn)
    const lite = has("blk.0.attn_q.weight");                          // V2-Lite: direct wq (== deepseek2.cpp is_lite)
    if (!kv_lora) return { arch, family: "incomplete", reason: "deepseek2 missing attention.kv_lora_rank", stats: { n_layer } };
    if (has("blk.0.ffn_gate_up_exps.weight")) return { arch, family: "moe-unsupported", reason: "deepseek2 fused gate_up_exps not yet synthesized", stats: { n_layer, n_expert } };

    const tiedD = !has("output.weight"), lmD = tiedD ? "token_embd.weight" : "output.weight";
    ops.push({ op: "embd", out: "h", w: { tok_embd: ref("token_embd.weight") } });
    for (let il = 0; il < n_layer; il++) {
      const p = `blk.${il}.`, prev = il === 0 ? "h" : `l${il - 1}.out`;
      ops.push({ op: "rms_norm", out: `l${il}.attn_norm`, in: prev, w: { weight: ref(p + "attn_norm.weight") }, attrs: { eps } });
      const mla = { op: "mla_attn", out: `l${il}.attn_out`, in: `l${il}.attn_norm`,
        w: { kv_a_mqa: ref(p + "attn_kv_a_mqa.weight"), kv_a_norm: ref(p + "attn_kv_a_norm.weight"),
             kv_b: ref(p + "attn_kv_b.weight"), wo: ref(p + "attn_output.weight") },
        attrs: { n_head, n_embd_head_k, n_embd_head_v, qk_nope, qk_rope, kv_lora, q_lora, eps,
                 freq_base, freq_scale, yarn_log_mul: yarnLogMul, ropeScaling,
                 yarnFactor: metaNum(meta, arch, "rope.scaling.factor"), yarnOrigCtx: metaNum(meta, arch, "rope.scaling.original_context_length"),
                 rope_type: "neox", lite, causal: true } };
      if (lite) mla.w.q = ref(p + "attn_q.weight");
      else { mla.w.q_a = ref(p + "attn_q_a.weight"); mla.w.q_a_norm = ref(p + "attn_q_a_norm.weight"); mla.w.q_b = ref(p + "attn_q_b.weight"); }
      ops.push(mla);
      ops.push({ op: "add", out: `l${il}.ffn_inp`, in: [`l${il}.attn_out`, prev] });
      ops.push({ op: "rms_norm", out: `l${il}.ffn_norm`, in: `l${il}.ffn_inp`, w: { weight: ref(p + "ffn_norm.weight") }, attrs: { eps } });
      if (n_expert > 0 && il >= n_dense_lead) {
        const moe = { op: "ffn_moe", out: `l${il}.ffn_out`, in: `l${il}.ffn_norm`,
          w: { gate_inp: ref(p + "ffn_gate_inp.weight"), gate_exps: ref(p + "ffn_gate_exps.weight"),
               up_exps: ref(p + "ffn_up_exps.weight"), down_exps: ref(p + "ffn_down_exps.weight") },
          attrs: { n_expert, n_expert_used, gating, normW, wScale: w_scale, act: "silu",
                   groupCount, groupUsed, shared: n_shared > 0, sharedGate: false } };
        if (has(p + "exp_probs_b")) moe.w.exp_probs_b = ref(p + "exp_probs_b");   // V3 selection bias (no .weight)
        if (n_shared > 0) {   // DeepSeek shared expert: ungated build_ffn, added to moe_out
          moe.w.gate_shexp = ref(p + "ffn_gate_shexp.weight");
          moe.w.up_shexp = ref(p + "ffn_up_shexp.weight");
          moe.w.down_shexp = ref(p + "ffn_down_shexp.weight");
        }
        ops.push(moe);
      } else {
        ops.push({ op: "ffn_swiglu", out: `l${il}.ffn_out`, in: `l${il}.ffn_norm`,
          w: { gate: ref(p + "ffn_gate.weight"), up: ref(p + "ffn_up.weight"), down: ref(p + "ffn_down.weight") }, attrs: { act: "silu" } });
      }
      ops.push({ op: "add", out: `l${il}.out`, in: [`l${il}.ffn_out`, `l${il}.ffn_inp`] });
    }
    ops.push({ op: "rms_norm", out: "result_norm", in: `l${n_layer - 1}.out`, w: { weight: ref("output_norm.weight") }, attrs: { eps } });
    ops.push({ op: "lm_head", out: "logits", in: "result_norm", w: { weight: ref(lmD) }, attrs: { tied: tiedD } });
    const weightsD = {}; for (const n of used) weightsD[n] = W[n];
    const statsD = { n_layer, n_embd, n_head, n_head_kv: n_head, head_dim: n_embd_head_k, eps,
      n_embd_head_k, n_embd_head_v, qk_nope, qk_rope, kv_lora, q_lora,
      n_dense_lead, n_expert, n_expert_used, n_shared, gating, normW, groupCount, groupUsed, lite, mla: true,
      tied: tiedD, ops: ops.length, weightsUsed: used.size };
    return { arch, family: "mla-moe", ops, weights: weightsD, stats: statsD };
  }

  // token embedding
  ops.push({ op: "embd", out: "h", w: { tok_embd: ref("token_embd.weight") } });

  const scale = head_dim ? 1 / Math.sqrt(head_dim) : 1;
  for (let il = 0; il < n_layer; il++) {
    const p = `blk.${il}.`;
    // attn rms-norm
    ops.push({ op: "rms_norm", out: `l${il}.attn_norm`, in: il === 0 ? "h" : `l${il - 1}.out`, w: { weight: ref(p + "attn_norm.weight") }, attrs: { eps } });
    // qkv projections (+bias on qwen2), optional qk-norm
    const qkv = { op: "qkv", out: { q: `l${il}.Q`, k: `l${il}.K`, v: `l${il}.V` }, in: `l${il}.attn_norm`,
      w: { wq: ref(p + "attn_q.weight"), wk: ref(p + "attn_k.weight"), wv: ref(p + "attn_v.weight") },
      attrs: { n_head, n_head_kv, head_dim } };
    if (qkvBias) { qkv.w.bq = ref(p + "attn_q.bias"); qkv.w.bk = ref(p + "attn_k.bias"); qkv.w.bv = ref(p + "attn_v.bias"); }
    if (qkNorm) { qkv.w.q_norm = ref(p + "attn_q_norm.weight"); qkv.w.k_norm = ref(p + "attn_k_norm.weight"); qkv.attrs.qk_norm_eps = eps; }
    // BitNet optional ternary weight-scales (TENSOR_NOT_REQUIRED, scalar per linear)
    if (bitnet && has(p + "attn_q.scale")) { qkv.w.wq_s = ref(p + "attn_q.scale"); qkv.w.wk_s = ref(p + "attn_k.scale"); qkv.w.wv_s = ref(p + "attn_v.scale"); }
    ops.push(qkv);
    // RoPE (NEOX) on Q and K
    ops.push({ op: "rope", target: `l${il}.Q`, attrs: { n_rot, type: "neox", freq_base, freq_scale } });
    ops.push({ op: "rope", target: `l${il}.K`, attrs: { n_rot, type: "neox", freq_base, freq_scale } });
    // attention: kq -> scaled+masked softmax -> kqv -> wo (+bo)
    const attn = { op: "attn", out: `l${il}.attn_out`, in: { q: `l${il}.Q`, k: `l${il}.K`, v: `l${il}.V` },
      w: { wo: ref(p + "attn_output.weight") }, attrs: { n_head, n_head_kv, head_dim, scale, causal: true } };
    if (has(p + "attn_output.bias")) attn.w.bo = ref(p + "attn_output.bias");
    if (bitnet) {  // attn_sub_norm (RMS) on the attention output before wo; optional wo scale
      attn.w.attn_sub_norm = ref(p + "attn_sub_norm.weight"); attn.attrs.subEps = eps;
      if (has(p + "attn_output.scale")) attn.w.wo_s = ref(p + "attn_output.scale");
    }
    ops.push(attn);
    // residual
    ops.push({ op: "add", out: `l${il}.ffn_inp`, in: [`l${il}.attn_out`, il === 0 ? "h" : `l${il - 1}.out`] });
    // ffn rms-norm
    ops.push({ op: "rms_norm", out: `l${il}.ffn_norm`, in: `l${il}.ffn_inp`, w: { weight: ref(p + "ffn_norm.weight") }, attrs: { eps } });
    if (moeCfg) {
      // MoE ffn: route → per-expert SwiGLU (mul_mat_id) → weighted sum (+ optional shared expert).
      // Expert weights are the stacked 3D κ-objects ffn_{gate,up,down}_exps (verbatim quant bytes).
      const moe = { op: "ffn_moe", out: `l${il}.ffn_out`, in: `l${il}.ffn_norm`,
        w: { gate_inp: ref(p + "ffn_gate_inp.weight"), gate_exps: ref(p + "ffn_gate_exps.weight"),
             up_exps: ref(p + "ffn_up_exps.weight"), down_exps: ref(p + "ffn_down_exps.weight") },
        attrs: { n_expert, n_expert_used, gating: "softmax", normW: moeCfg.normW, wScale: w_scale, act: "silu", shared: moeCfg.shared } };
      if (moeCfg.shared) {   // qwen2moe: shared expert gated by sigmoid(gate_inp_shexp·x), added to moe_out
        moe.w.gate_inp_shexp = ref(p + "ffn_gate_inp_shexp.weight");
        moe.w.gate_shexp = ref(p + "ffn_gate_shexp.weight");
        moe.w.up_shexp = ref(p + "ffn_up_shexp.weight");
        moe.w.down_shexp = ref(p + "ffn_down_shexp.weight");
      }
      ops.push(moe);
    } else {
      // SwiGLU ffn: down( silu(gate(x)) * up(x) )
      const ffn = { op: "ffn_swiglu", out: `l${il}.ffn_out`, in: `l${il}.ffn_norm`,
        w: { gate: ref(p + "ffn_gate.weight"), up: ref(p + "ffn_up.weight"), down: ref(p + "ffn_down.weight") }, attrs: { act: "silu" } };
      if (bitnet) {  // ffn_sub_norm (RMS) on the swiglu activation before ffn_down; optional scales
        ffn.w.ffn_sub_norm = ref(p + "ffn_sub_norm.weight"); ffn.attrs.subEps = eps;
        if (has(p + "ffn_gate.scale")) { ffn.w.gate_s = ref(p + "ffn_gate.scale"); ffn.w.up_s = ref(p + "ffn_up.scale"); ffn.w.down_s = ref(p + "ffn_down.scale"); }
      }
      ops.push(ffn);
    }
    // residual
    ops.push({ op: "add", out: `l${il}.out`, in: [`l${il}.ffn_out`, `l${il}.ffn_inp`] });
  }
  // final norm + lm_head
  ops.push({ op: "rms_norm", out: "result_norm", in: `l${n_layer - 1}.out`, w: { weight: ref("output_norm.weight") }, attrs: { eps } });
  const lm = { op: "lm_head", out: "logits", in: "result_norm", w: { weight: ref(lmHeadName) }, attrs: { tied } };
  if (outBias) lm.w.bias = ref("output.bias");
  ops.push(lm);

  // collect resolved weights actually used
  const weights = {}; for (const n of used) weights[n] = W[n];
  const stats = { n_layer, n_embd, n_head, n_head_kv, head_dim, n_rot, eps, freq_base, qkvBias, qkNorm, bitnet, tied, ops: ops.length, weightsUsed: used.size };
  if (moeCfg) Object.assign(stats, { n_expert, n_expert_used, normW: moeCfg.normW, wScale: w_scale, sharedExpert: moeCfg.shared });
  return { arch, family: moeCfg ? "moe" : "dense", ops, weights, stats };
}

// Expected op count for a dense layer model: embd + 9·n_layer + result_norm + lm_head.
export const expectedDenseOpCount = (n_layer) => 3 + 9 * n_layer;
