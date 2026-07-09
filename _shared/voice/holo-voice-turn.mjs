// holo-voice-turn.mjs — on-device SEMANTIC TURN-DETECTION for Holo Voice (deep-research RANK 1).
//
// Reads the (partial) transcript and predicts whether the USER IS DONE — so the live loop can end the
// turn the instant an utterance is semantically complete (firing before trailing silence) and, just as
// importantly, can VETO a premature endpoint when the user only paused mid-thought. This is the single
// biggest lever toward a human-call response onset (<300ms median): the 550ms fixed silence is the
// largest fixed cost in a turn, and a turn-end model removes it.
//
// Model: LiveKit's open-weights turn-detector (a small fine-tuned LLM; ONNX builds at
//   onnx-community/turn-detector-ONNX · livekit/turn-detector). CPU-only via ONNX Runtime Web, ~25ms,
//   q4f16 ≈118MB (verified specs; the "~50ms" figure was refuted — it's ~25ms). It outputs the
//   probability that the turn is COMPLETE given the conversation so far.
//
// SERVERLESS like the other engines: weights load same-origin from the vendored κ-disk (vendor it with
//   `node tools/vendor-voice-model.mjs --turn`), nothing leaves the device. Imported lazily and GATED by
//   HOLO_VOICE_CONFIG.turnModel — until it's both vendored AND enabled, holo-voice.js uses its heuristic
//   turn-completion scorer, so this module never blocks or breaks the working path.
//
// ⚠ EXPERIMENTAL / UNVERIFIED-ON-REAL-HW: the exact end-of-utterance read below (chat-format → forward →
//   P(EOU token) at the last position) follows LiveKit's documented recipe, but the deep-research pass
//   verified the model's existence/specs, NOT this transformers.js invocation. predict() returns null on
//   ANY mismatch so the caller falls back to the heuristic. Verify on real hardware before trusting it,
//   and re-pin the q4f16 inference once confirmed.

const DEFAULTS = {
  lib: "vendor/transformers/transformers.js",
  libRemote: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2",
  ortPath: "vendor/transformers/",
  model: "onnx-community/turn-detector-ONNX",
  localPath: "vendor/models/",
  remote: false,
  dtype: "q4f16",                       // ~118MB; falls back to q8 if the model lacks a q4f16 file
  // candidate end-of-turn marker tokens (Qwen-style chat end). The first that resolves to an id is used.
  eouTokens: ["<|im_end|>", "<|endoftext|>"],
};

function moduleBase() {
  try { return new URL("./", import.meta.url).href; }
  catch (e) { return new URL("./", location.href).href; }
}

export function createTurnDetector(opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  let model = null, tok = null, Tensor = null, eouId = null, info = { ready: false, model: cfg.model, device: null };
  let loading = null;

  async function load(onProgress) {
    if (model) return info;
    if (loading) return loading;
    loading = (async () => {
      const base = moduleBase();
      const libUrl = cfg.remote ? cfg.libRemote : new URL(cfg.lib, base).href;
      const tf = await import(/* @vite-ignore */ libUrl);             // throws if not vendored → caller falls back
      const { AutoTokenizer, AutoModelForCausalLM, env } = tf; Tensor = tf.Tensor;
      if (env) {
        env.allowRemoteModels = !!cfg.remote;
        env.allowLocalModels = !cfg.remote;
        if (!cfg.remote) {
          env.localModelPath = new URL(cfg.localPath, base).href;
          const wasmPaths = new URL(cfg.ortPath, base).href;
          if (env.backends && env.backends.onnx && env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = wasmPaths;
        }
      }
      const prog = (p) => { try { onProgress && onProgress({ phase: p.status || "load", file: p.file, loaded: p.loaded, total: p.total, model: cfg.model }); } catch (e) {} };
      tok = await AutoTokenizer.from_pretrained(cfg.model, { progress_callback: prog });
      let dtype = cfg.dtype;
      try { model = await AutoModelForCausalLM.from_pretrained(cfg.model, { device: "wasm", dtype, progress_callback: prog }); }
      catch (e) { dtype = "q8"; model = await AutoModelForCausalLM.from_pretrained(cfg.model, { device: "wasm", dtype, progress_callback: prog }); }
      // resolve the end-of-turn token id once (the marker whose probability == "the turn is complete").
      for (const t of cfg.eouTokens) { try { const ids = tok.encode(t, { add_special_tokens: false }); if (ids && ids.length === 1) { eouId = ids[0]; break; } } catch (e) {} }
      info = { ready: true, model: cfg.model, device: "wasm", dtype, eouId };
      return info;
    })().catch((e) => { loading = null; throw e; });
    return loading;
  }

  // predict(text) → probability in [0,1] that the user's turn is COMPLETE. null on any failure.
  async function predict(text) {
    try {
      if (!model || eouId == null || !Tensor) return null;
      const enc = tok.apply_chat_template([{ role: "user", content: String(text || "") }], { add_generation_prompt: false, tokenize: true });
      const ids = Array.isArray(enc) ? enc : (enc && enc.input_ids) || null;
      if (!ids || !ids.length) return null;
      const input_ids = new Tensor("int64", BigInt64Array.from(ids.map((x) => BigInt(x))), [1, ids.length]);
      const attention_mask = new Tensor("int64", BigInt64Array.from(ids.map(() => 1n)), [1, ids.length]);
      const out = await model({ input_ids, attention_mask });
      const logits = out && (out.logits || out.last_hidden_state);
      if (!logits || !logits.dims) return null;
      const [, seq, vocab] = logits.dims;                              // [1, seq, vocab]
      const off = (seq - 1) * vocab;                                   // logits at the final position
      const data = logits.data;
      let max = -Infinity; for (let i = 0; i < vocab; i++) { const v = data[off + i]; if (v > max) max = v; }
      let sum = 0; for (let i = 0; i < vocab; i++) sum += Math.exp(data[off + i] - max);
      return Math.exp(data[off + eouId] - max) / sum;                  // softmax prob of the EOU token
    } catch (e) { return null; }
  }

  return { id: "holo-voice-turn", load, predict, info: () => info };
}

export default createTurnDetector;
