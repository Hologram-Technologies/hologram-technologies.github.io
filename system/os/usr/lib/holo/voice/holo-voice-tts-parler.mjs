// holo-voice-tts-parler.mjs — HD VOICE candidate: Parler-TTS Mini, on-device & serverless.
//
// Parler is PROMPTABLE: a DESCRIPTION shapes the persona ("a warm, close, studio-clear voice in a quiet
// room") — the most direct lever for "a real person speaking in the room with you". It runs in the browser
// via @huggingface/transformers, BUT the transformers.js bundled with Kokoro is tree-shaken and lacks the
// Parler class — so this uses an ISOLATED FULL transformers.js vendored under vendor/voice-hd/ by
// tools/vendor-voice-hd.mjs (same isolation pattern as the embedder's 3.8.1 build).
//
// Same seam as createTTS — {load, synth(text)->{audio,sampling_rate}, voices, info} — so it drops straight
// into the bake-off REGISTRY and into createTieredTTS as the `hd` engine. Until the weights + full
// transformers are vendored, load() rejects and the harness shows a "fail" row (honest, not silent).
//
// ⚠ FIRST-RUN VALIDATION: the generate() call below is written to the documented Parler API
// (description + prompt, dual text inputs). Confirm it against the EXACT vendored transformers version on
// first run and adjust the one marked line if its return shape differs — that's the only uncertain part.

const DEFAULTS = {
  tfLib: "vendor/voice-hd/transformers/transformers.js",   // isolated FULL build (has ParlerTTS); vendored by vendor-voice-hd.mjs
  ortPath: "vendor/voice-hd/transformers/",
  localPath: "vendor/models/",
  model: "onnx-community/parler-tts-mini-v1-ONNX",
  dtype: "q8",
  device: null,                                            // 'wasm' | 'webgpu' | null → auto (preferWebGPU)
  preferWebGPU: false,
  // The persona. This single sentence is Q's voice identity — tune it, don't fight the model.
  description: "A warm, natural voice speaking softly and clearly, very close to the microphone, intimate and present, recorded in a quiet room with almost no background noise.",
};

function moduleBase() { try { return new URL("./", import.meta.url).href; } catch (e) { return new URL("./", location.href).href; } }

export function createParlerTTS(opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  let model = null, tokenizer = null, loading = null, info = { ready: false, device: null };

  async function load(onProgress) {
    if (model) return info;
    if (loading) return loading;
    loading = (async () => {
      const base = moduleBase();
      const TF = await import(/* @vite-ignore */ new URL(cfg.tfLib, base).href);
      if (TF.env) {
        TF.env.allowRemoteModels = false; TF.env.allowLocalModels = true;
        TF.env.localModelPath = new URL(cfg.localPath, base).href;
        if (TF.env.backends && TF.env.backends.onnx && TF.env.backends.onnx.wasm) {
          TF.env.backends.onnx.wasm.wasmPaths = new URL(cfg.ortPath, base).href;
          TF.env.backends.onnx.wasm.proxy = true;
        }
      }
      const ParlerTTS = TF.ParlerTTSForConditionalGeneration;
      const AutoTokenizer = TF.AutoTokenizer;
      if (!ParlerTTS || !AutoTokenizer) throw new Error("vendored transformers lacks ParlerTTS — run tools/vendor-voice-hd.mjs (full build)");
      const device = cfg.device || ((cfg.preferWebGPU && navigator.gpu) ? "webgpu" : "wasm");
      tokenizer = await AutoTokenizer.from_pretrained(cfg.model, { progress_callback: onProgress });
      model = await ParlerTTS.from_pretrained(cfg.model, { dtype: cfg.dtype, device, progress_callback: onProgress });
      info = { ready: true, device, model: cfg.model, dtype: cfg.dtype, promptable: true };
      return info;
    })().catch((e) => { loading = null; throw e; });
    return loading;
  }

  // synth(text, {description}) → { audio: Float32Array, sampling_rate }. Parler conditions on TWO texts:
  // the DESCRIPTION (voice persona) and the PROMPT (the words to say).
  async function synth(text, o = {}) {
    if (!model) await load(o.onProgress);
    const desc = tokenizer(o.description || cfg.description);
    const prompt = tokenizer(String(text || "").trim());
    const out = await model.generate({ ...desc, prompt_input_ids: prompt.input_ids });
    // ⚠ ADJUST-ON-VALIDATION: normalize the model output to {audio, sampling_rate}. Parler/transformers.js
    // returns the waveform either directly or under .audio/.waveform depending on version.
    const raw = (out && out.audio) || (out && out.waveform && out.waveform.data) || (out && out.data) || out;
    const sr = (out && out.sampling_rate) || (model.config && (model.config.sampling_rate || model.config.audio_encoder && model.config.audio_encoder.sampling_rate)) || 44100;
    return { audio: raw instanceof Float32Array ? raw : Float32Array.from(raw), sampling_rate: sr };
  }
  function voices() { return ["parler:description"]; }   // Parler has no voice list — the description IS the voice
  return { id: "holo-voice-tts-parler", load, synth, voices, info: () => info, setDescription: (d) => { cfg.description = String(d || cfg.description); } };
}

export default createParlerTTS;
