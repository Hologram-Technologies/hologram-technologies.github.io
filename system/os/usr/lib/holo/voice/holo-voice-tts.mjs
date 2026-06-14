// holo-voice-tts.mjs — Q's natural voice: Kokoro-82M text-to-speech, on-device and serverless.
//
// Kokoro is the best small open TTS; kokoro-js drives it. It imports "@huggingface/transformers" and
// "phonemizer" as bare specifiers — the frames map those (import map) to the vendored copies under
// vendor/kokoro/, so this runs entirely in the browser with no CDN and no server. We import the SAME
// transformers module first and point its ONNX env at the vendored wasm + model, so kokoro inherits a
// fully local, serverless config. WASM by default (any browser); WebGPU opt-in. If anything here fails,
// holo-voice.js falls back to the browser's built-in speechSynthesis — so Q always talks.

const DEFAULTS = {
  tfLib: "vendor/kokoro/transformers/transformers.js",   // kokoro's transformers (3.5.1), import-mapped
  ortPath: "vendor/kokoro/transformers/",                // its bundled onnxruntime-web wasm
  kokoroLib: "vendor/kokoro/kokoro.js",
  localPath: "vendor/models/",
  model: "onnx-community/Kokoro-82M-v1.0-ONNX",
  dtype: "q8",            // → onnx/model_quantized.onnx
  voice: "af_heart",      // warm, natural default
  preferWebGPU: false,
};

function moduleBase() { try { return new URL("./", import.meta.url).href; } catch (e) { return new URL("./", location.href).href; } }

export function createTTS(opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  let tts = null, loading = null, info = { ready: false, device: null };

  async function load(onProgress) {
    if (tts) return info;
    if (loading) return loading;
    loading = (async () => {
      const base = moduleBase();
      // configure the shared transformers env BEFORE kokoro imports it (same module URL = same instance).
      const TF = await import(/* @vite-ignore */ new URL(cfg.tfLib, base).href);
      if (TF.env) {
        TF.env.allowRemoteModels = false; TF.env.allowLocalModels = true;
        TF.env.localModelPath = new URL(cfg.localPath, base).href;
        if (TF.env.backends && TF.env.backends.onnx && TF.env.backends.onnx.wasm) {
          TF.env.backends.onnx.wasm.wasmPaths = new URL(cfg.ortPath, base).href;
          TF.env.backends.onnx.wasm.proxy = true;                      // worker → no UI freeze while synthesizing
        }
      }
      const mod = await import(/* @vite-ignore */ new URL(cfg.kokoroLib, base).href);
      const KokoroTTS = mod.KokoroTTS || (mod.default && mod.default.KokoroTTS);
      const device = (cfg.preferWebGPU && navigator.gpu) ? "webgpu" : "wasm";
      tts = await KokoroTTS.from_pretrained(cfg.model, { dtype: cfg.dtype, device, progress_callback: onProgress });
      info = { ready: true, device, model: cfg.model };
      return info;
    })().catch((e) => { loading = null; throw e; });
    return loading;
  }

  // synth(text, {voice}) → { audio: Float32Array, sampling_rate } (a kokoro-js RawAudio).
  async function synth(text, o = {}) {
    if (!tts) await load(o.onProgress);
    return tts.generate(String(text || "").trim(), { voice: o.voice || cfg.voice });
  }
  function listVoices() { try { return tts && tts.voices ? Object.keys(tts.voices) : []; } catch (e) { return []; } }

  return { id: "holo-voice-tts", load, synth, voices: listVoices, info: () => info };
}

export default createTTS;
