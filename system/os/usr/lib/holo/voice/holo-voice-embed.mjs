// holo-voice-embed.mjs — on-device text EMBEDDINGS for Holo Q (semantic memory · RAG · recall · skills).
//
// EmbeddingGemma-300m (q8) via transformers.js feature-extraction — the top text embedder under 500M on
// MTEB (ADR-0096), 100% serverless, WASM (any browser) + WebGPU where available. Binds into the QVAC
// embed seam (HoloQVAC.useEmbed) so HoloQVAC.embed() returns REAL semantic vectors instead of the FNV-1a
// reference floor. Mean-pooled + L2-normalized → cosine similarity is a dot product. Same vendoring
// pattern as holo-voice-asr.mjs (transformers.js + ORT wasm + a sha256-pinned κ-disk, Law L5, offline).

const DEFAULTS = {
  // EmbeddingGemma is a Gemma3TextModel — the main vendored transformers.js (3.0.2) doesn't know that
  // architecture, so the embedder rides its OWN isolated, newer transformers.js (3.8.1, in
  // vendor/transformers-embed/), leaving the proven ASR/LLM/TTS stack on 3.0.2 untouched. Same pattern as
  // the Kokoro 2nd instance — multiple transformers.js instances coexist (separate ESM module + env).
  lib: "vendor/transformers-embed/transformers.js",                    // resolved relative to THIS module
  ortPath: "vendor/transformers-embed/",
  model: "onnx-community/embeddinggemma-300m-ONNX",
  localPath: "vendor/models/",
  dtype: "q8",            // research: q8, NOT fp16
  proxy: true,            // ORT in a Web Worker → embedding a batch never freezes the UI / VAD loop
  // κ-served embedder (opt-in): serve EmbeddingGemma's ONNX files from its .holo (HTTP-Range + per-block L5 +
  // OPFS warm cache + serverless multi-source) into the SAME transformers.js engine — content-addressed
  // delivery, no engine change, identical to the κ-served voice. ANY failure restores fetch + falls back to
  // the vendored ONNX files below. null = off (vendored path). Same shim every ONNX faculty uses.
  knative: null,          // e.g. { module: "/apps/q/forge/gpu/holo-onnx-kserve.mjs", holoUrl: "…/embeddinggemma-300m.holo" }
};

// EmbeddingGemma's official task prompts — they materially improve retrieval. Stored items use the
// document prompt; a live query uses the query prompt (asymmetric retrieval). Default: document.
const PROMPTS = {
  query: (t) => "task: search result | query: " + t,
  document: (t) => "title: none | text: " + t,
  none: (t) => t,
};

function moduleBase() {
  try { return new URL("./", import.meta.url).href; }
  catch (e) { return new URL("./", location.href).href; }
}

export function createEmbed(opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  let pipe = null, info = { ready: false, model: cfg.model, device: null, dim: null }, loading = null;

  async function load(onProgress) {
    if (pipe) return info;
    if (loading) return loading;
    loading = (async () => {
      const base = moduleBase();
      const tf = await import(/* @vite-ignore */ new URL(cfg.lib, base).href);   // throws if not vendored → caller falls back
      const { pipeline, env } = tf;
      if (env) {
        env.allowRemoteModels = false; env.allowLocalModels = true;
        env.localModelPath = new URL(cfg.localPath, base).href;
        if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
          env.backends.onnx.wasm.wasmPaths = new URL(cfg.ortPath, base).href;
          env.backends.onnx.wasm.proxy = !!cfg.proxy;
        }
      }
      const prog = (p) => { try { onProgress && onProgress({ phase: p.status || "load", file: p.file, loaded: p.loaded, total: p.total }); } catch (e) {} };
      // κ-served embedder (opt-in): install the .holo fetch shim BEFORE the pipeline loads, so the model files
      // are served by content address. Transparently falls back to the vendored ONNX on any failure.
      let kserve = null;
      if (cfg.knative && cfg.knative.module && cfg.knative.holoUrl) {
        try {
          const km = await import(/* @vite-ignore */ new URL(cfg.knative.module, base).href);
          kserve = await (km.serveModelFromHolo || km.default)({ holoUrl: new URL(cfg.knative.holoUrl, base).href, modelId: cfg.knative.modelId || cfg.model, release: cfg.knative.release || "" });
        } catch (e) { try { console.warn("[HoloVoice Embed] κ-served model unavailable, using vendored ONNX:", e && e.message || e); } catch (_) {} kserve = null; }
      }
      try {
        pipe = await pipeline("feature-extraction", cfg.model, { dtype: cfg.dtype, progress_callback: prog });
      } catch (e) { if (kserve) { try { kserve.restore(); } catch (_) {} } throw e; }   // κ-served load failed → un-shim so the caller's fallback fetches the vendored files
      info = { ready: true, model: cfg.model, device: "wasm", dim: null, engine: kserve ? "embed-κserved" : "embed-onnx", servedFromHolo: kserve ? kserve.served.length : 0 };
      return info;
    })().catch((e) => { loading = null; throw e; });
    return loading;
  }

  // embed(text | text[], { kind:"document"|"query"|"none" }) → number[] | number[][]. L2-normalized.
  async function embed(input, o = {}) {
    if (!pipe) await load();
    const kind = PROMPTS[o.kind] ? o.kind : "document";
    const arr = Array.isArray(input) ? input : [input];
    const texts = arr.map((t) => PROMPTS[kind](String(t == null ? "" : t)));
    const out = await pipe(texts, { pooling: "mean", normalize: true });
    const vecs = out && out.tolist ? out.tolist() : out;
    if (info.dim == null && vecs && vecs[0]) info.dim = vecs[0].length;
    return Array.isArray(input) ? vecs : vecs[0];
  }

  return { id: "holo-voice-embed", load, embed, info: () => info, dim: () => info.dim };
}

export default createEmbed;
