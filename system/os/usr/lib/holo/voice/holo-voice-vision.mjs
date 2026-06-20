// holo-voice-vision.mjs — on-device SIGHT for Holo Q (image understanding · VLM · "what's on screen").
//
// SmolVLM-256M-Instruct (q8) via transformers.js — tiny (~254MB: vision 92 + embed 28 + decoder 134),
// 100% serverless, WASM (any browser). Like the embedder, it rides the ISOLATED transformers.js 3.8.1
// (vendor/transformers-embed/) — the main 3.0.2 has no Idefics3/SmolVLM architecture — so the proven
// ASR/LLM/TTS stack on 3.0.2 stays untouched. A 3-part model (vision_encoder · embed_tokens ·
// decoder_model_merged), each its own q8 ONNX session (dtype is per-component). sha256-pinned, offline.
//
//   createVision().see(image, prompt) → caption/answer.  image = URL · data-URL · Blob · canvas · <img>.

const DEFAULTS = {
  lib: "vendor/transformers-embed/transformers.js",                    // the isolated newer runtime (shared with the embedder)
  ortPath: "vendor/transformers-embed/",
  model: "HuggingFaceTB/SmolVLM-256M-Instruct",
  localPath: "vendor/models/",
  dtype: { embed_tokens: "q8", vision_encoder: "q8", decoder_model_merged: "q8" },   // q8 → the _quantized ONNX files
  maxTokens: 256,
  proxy: true,            // ORT in a Web Worker → encoding + generation never freeze the UI
  // κ-served sight (opt-in): serve SmolVLM's 3 ONNX files + configs from its .holo (HTTP-Range + per-block L5
  // + OPFS warm cache + serverless multi-source) into the SAME transformers.js engine — content-addressed
  // delivery, no engine change. ANY failure restores fetch + falls back to the vendored ONNX. null = off.
  knative: null,          // e.g. { module: "/apps/q/forge/gpu/holo-onnx-kserve.mjs", holoUrl: "…/smolvlm-256m.holo" }
};

function moduleBase() {
  try { return new URL("./", import.meta.url).href; }
  catch (e) { return new URL("./", location.href).href; }
}

export function createVision(opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  let model = null, processor = null, RawImage = null, info = { ready: false, model: cfg.model, device: null }, loading = null;

  async function load(onProgress) {
    if (model) return info;
    if (loading) return loading;
    loading = (async () => {
      const base = moduleBase();
      const tf = await import(/* @vite-ignore */ new URL(cfg.lib, base).href);   // throws if not vendored → caller falls back
      const { AutoProcessor, AutoModelForVision2Seq, env } = tf; RawImage = tf.RawImage;
      if (env) {
        env.allowRemoteModels = false; env.allowLocalModels = true;
        env.localModelPath = new URL(cfg.localPath, base).href;
        if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
          env.backends.onnx.wasm.wasmPaths = new URL(cfg.ortPath, base).href;
          env.backends.onnx.wasm.proxy = !!cfg.proxy;
        }
      }
      const prog = (p) => { try { onProgress && onProgress({ phase: p.status || "load", file: p.file, loaded: p.loaded, total: p.total }); } catch (e) {} };
      // κ-served sight (opt-in): install the .holo fetch shim BEFORE the model loads, so SmolVLM's 3 ONNX
      // sessions + configs are served by content address. Transparently falls back to vendored ONNX on failure.
      let kserve = null;
      if (cfg.knative && cfg.knative.module && cfg.knative.holoUrl) {
        try {
          const km = await import(/* @vite-ignore */ new URL(cfg.knative.module, base).href);
          kserve = await (km.serveModelFromHolo || km.default)({ holoUrl: new URL(cfg.knative.holoUrl, base).href, modelId: cfg.knative.modelId || cfg.model, release: cfg.knative.release || "" });
        } catch (e) { try { console.warn("[HoloVoice Vision] κ-served model unavailable, using vendored ONNX:", e && e.message || e); } catch (_) {} kserve = null; }
      }
      try {
        processor = await AutoProcessor.from_pretrained(cfg.model, { progress_callback: prog });
        model = await AutoModelForVision2Seq.from_pretrained(cfg.model, { dtype: cfg.dtype, device: "wasm", progress_callback: prog });
      } catch (e) { if (kserve) { try { kserve.restore(); } catch (_) {} } throw e; }   // κ-served load failed → un-shim so the caller's fallback fetches the vendored files
      info = { ready: true, model: cfg.model, device: "wasm", engine: kserve ? "vision-κserved" : "vision-onnx", servedFromHolo: kserve ? kserve.served.length : 0 };
      return info;
    })().catch((e) => { loading = null; throw e; });
    return loading;
  }

  // see(image, prompt) → text. image: URL / data-URL / Blob / canvas / <img> / RawImage.
  async function see(image, prompt, o = {}) {
    if (!model) await load();
    const img = (image && image.data && image.width) ? image : await RawImage.read(image);
    const messages = [{ role: "user", content: [{ type: "image" }, { type: "text", text: String(prompt || "Describe this image in detail.") }] }];
    const text = processor.apply_chat_template(messages, { add_generation_prompt: true });
    const inputs = await processor(text, [img]);
    const out = await model.generate({ ...inputs, max_new_tokens: o.maxTokens || cfg.maxTokens, do_sample: false });
    const gen = out.slice(null, [inputs.input_ids.dims.at(-1), null]);   // drop the prompt tokens → just the answer
    const decoded = processor.batch_decode(gen, { skip_special_tokens: true });
    return (decoded[0] || "").trim();
  }

  return { id: "holo-voice-vision", load, see, info: () => info };
}

export default createVision;
