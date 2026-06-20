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
      // device: explicit cfg.device wins (the bake-off harness sets it); else preferWebGPU→webgpu when available, else wasm.
      const device = cfg.device || ((cfg.preferWebGPU && navigator.gpu) ? "webgpu" : "wasm");
      tts = await KokoroTTS.from_pretrained(cfg.model, { dtype: cfg.dtype, device, progress_callback: onProgress });
      info = { ready: true, device, model: cfg.model, dtype: cfg.dtype };
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

// createTieredTTS — the "instant + HD" voice composition, behind the SAME seam ({load, synth, voices, info}).
// Q speaks immediately on the `primary` engine (e.g. Kokoro); a heavier, more natural `hd` engine loads in
// the BACKGROUND and, once ready, transparently takes over future utterances — never blocking the first
// word, never a gap. If HD fails to load (or errors mid-use), it silently stays on / falls back to primary,
// so the voice is always available. This is the production scaffolding any HD model (Parler · StyleTTS2 ·
// a κ-sealed clone) plugs into — pass it as `hd` and nothing else changes. `hd` omitted ⇒ pure primary.
export function createTieredTTS(opts = {}) {
  const primary = opts.primary, hd = opts.hd || null;
  if (!primary) throw new Error("createTieredTTS: a primary engine is required");
  let tier = "primary", hdReady = false, hdFailed = false;
  async function load(onProgress) {
    const pinfo = await primary.load(onProgress);                 // the instant tier is ready first — first word never waits
    if (hd) {
      Promise.resolve().then(() => hd.load())                     // promote in the background; never blocks playback
        .then(() => { hdReady = true; tier = "hd"; try { opts.onUpgrade && opts.onUpgrade(hd.info ? hd.info() : null); } catch (e) {} })
        .catch(() => { hdFailed = true; });
    }
    return info();
  }
  async function synth(text, o = {}) {
    if (hdReady && hd) { try { return await hd.synth(text, o); } catch (e) { hdReady = false; tier = "primary"; } }  // HD error → fall back, keep talking
    return primary.synth(text, o);
  }
  function voices() { try { const s = new Set([].concat(primary.voices ? primary.voices() : [], hd && hd.voices ? hd.voices() : [])); return Array.from(s); } catch (e) { return []; } }
  function info() { return { ready: !!(primary.info && primary.info().ready), tier, hdReady, hdFailed, primary: primary.info && primary.info(), hd: hd && hd.info ? hd.info() : null }; }
  return { id: "holo-voice-tier", load, synth, voices, info, get tier() { return tier; } };
}

export default createTTS;
