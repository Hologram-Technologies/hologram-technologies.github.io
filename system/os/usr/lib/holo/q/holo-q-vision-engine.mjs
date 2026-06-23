// holo-q-vision-engine.mjs — A REAL on-device OCR reader for the raster edge (browser tier). The native
// 3B Unlimited-OCR needs CUDA; this is the in-browser ≤2B path the mux 'vision' slot was always meant to
// bind: a transformers.js (ONNX) image-to-text pipeline, run on-device (WASM floor, WebGPU when present),
// no inference server, no pixels leave the machine. It implements the ONE engine contract the specialist
// needs — `read(imageBytes, prompt) → { markdown }` — so holo-q-vision seals its text into a κ exactly
// as it would for the native engine. Mirrors the voice ASR tiering (holo-voice-asr.mjs): vendored ORT
// wasm, lazy import (never blocks boot), graceful fallback (a load failure ⇒ null, never a faked read).

import { installEngine } from "./holo-q-vision.mjs";

const DEFAULTS = {
  // a small, real OCR model (TrOCR printed-text) — genuinely reads pixels, modest size. Swap via cfg.
  model: "Xenova/trocr-small-printed",
  task: "image-to-text",
  lib: "../voice/vendor/transformers/transformers.js",   // the vendored transformers.js (beside voice's ORT wasm)
  ortPath: "../voice/vendor/transformers/",              // onnxruntime-web wasm — NO CDN binary fetch
  preferWebGPU: false,                                    // WASM is the any-browser floor; WebGPU opt-in
  remote: true,                                           // allow the model weights to stream from the HF hub on first use
};

async function hasWebGPU() { try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { return false; } }

// createTransformersEngine(cfg) → { read, ready, info }. The pipeline is built LAZILY on the first read,
// so importing this module never blocks boot and never throws on a device that will only ever use the
// substrate floor. `read` returns { markdown } or null (honest — a failure is never a fabricated read).
export function createTransformersEngine(cfg = {}) {
  const c = { ...DEFAULTS, ...cfg };
  const base = (() => { try { return new URL("./", import.meta.url).href; } catch { return "./"; } })();
  let pipe = null, loading = null;
  const info = { ready: false, engine: "transformers.js", model: c.model, device: null, error: null };

  async function ensure() {
    if (pipe) return pipe;
    if (loading) return loading;
    loading = (async () => {
      const tf = await import(/* @vite-ignore */ new URL(c.lib, base).href);   // throws if not vendored → caught by read()
      const { pipeline, env } = tf;
      const webgpu = c.preferWebGPU && (await hasWebGPU());
      info.device = webgpu ? "webgpu" : "wasm";
      try {
        env.allowRemoteModels = !!c.remote;                                    // weights stream from HF on first use
        env.allowLocalModels = !c.remote;
        if (env.backends && env.backends.onnx && env.backends.onnx.wasm)
          env.backends.onnx.wasm.wasmPaths = new URL(c.ortPath, base).href;    // vendored ORT wasm, not a CDN
      } catch {}
      pipe = await pipeline(c.task, c.model, { device: info.device });
      info.ready = true;
      return pipe;
    })().catch((e) => { info.error = String((e && e.message) || e); loading = null; throw e; });
    return loading;
  }

  async function read(imageBytes /* , prompt */) {
    let url = null;
    try {
      const p = await ensure();
      const bytes = imageBytes instanceof Uint8Array ? imageBytes : new Uint8Array(imageBytes || []);
      url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      const out = await p(url);                                                // [{ generated_text }]
      const text = Array.isArray(out) ? (out[0] && (out[0].generated_text ?? out[0].text)) : (out && (out.generated_text ?? out.text));
      if (text == null) return null;                                           // honest empty
      return { markdown: String(text), blocks: [{ type: "text", text: String(text) }] };
    } catch (e) { info.error = String((e && e.message) || e); return null; }   // load/decode failure → null, never fake
    finally { if (url) try { URL.revokeObjectURL(url); } catch {} }
  }

  return { id: "trocr-small-printed", read, ready: () => info.ready, info: () => ({ ...info }) };
}

// browser binding: register a real engine and install it (builds the specialist, binds the mux slot).
// Lazy — no model is fetched until the first raster island is perceived. Override the model by setting
// window.HoloVisionEngineConfig before this loads.
if (typeof window !== "undefined") {
  try {
    if (!window.HoloVisionEngine) {
      const engine = createTransformersEngine(window.HoloVisionEngineConfig || {});
      window.HoloVisionEngine = engine;
      installEngine(engine);                                                   // → window.HoloVisionSpecialist + mux bind
    }
  } catch {}
}

export default { createTransformersEngine };
