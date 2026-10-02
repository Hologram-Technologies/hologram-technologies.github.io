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
  // κ-served voice (opt-in): serve Kokoro's ONNX files from its .holo (HTTP-Range + per-block L5 + OPFS warm
  // cache + serverless multi-source) into the SAME kokoro-js/onnxruntime engine — content-addressed weight
  // delivery, no engine change. Set { module, holoUrl, modelId?, kappa, release } to enable; ANY failure
  // transparently restores fetch and falls back to the vendored ONNX files below. null = off (vendored path).
  knativeVoice: null,     // e.g. { module: "../../q/forge/gpu/holo-onnx-kserve.mjs", holoUrl: "…/kokoro-82m.holo" }
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
      // Q bundle: the usr-lib kokoro vendor is NOT shipped — the HD path is Plan B (/_shared vendor, voice-out.js).
      // Bail here WITHOUT a network probe; a fetch would 404 in every boot console before falling through.
      if (!cfg.vendorShipped) throw new Error("kokoro vendor not shipped under usr/lib — use the /_shared plan");
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
      // κ-served voice (opt-in): install the .holo fetch shim BEFORE kokoro loads, so its model files are
      // served by content address from the .holo. Transparently falls back to the vendored ONNX on any failure.
      let kserve = null;
      if (cfg.knativeVoice && cfg.knativeVoice.module && cfg.knativeVoice.holoUrl) {
        try {
          const km = await import(/* @vite-ignore */ new URL(cfg.knativeVoice.module, base).href);
          // serve Kokoro's files from the ONE q-models pack when opted in (fail-soft → holoUrl/release standalone)
          let openFiles = null;
          if (cfg.knativeVoice.pack) { try { const pp = await import(/* @vite-ignore */ new URL("../../../../apps/q/forge/gpu/holo-q-pack-provider.mjs", base).href); const fm = await import(/* @vite-ignore */ new URL("./holo-q-faculty-models.mjs", import.meta.url).href); openFiles = pp.makePackOpenFiles("kokoro-82m", { packSpec: fm.packSpec }); } catch (_) {} }
          kserve = await (km.serveModelFromHolo || km.default)({
            holoUrl: new URL(cfg.knativeVoice.holoUrl, base).href,
            modelId: cfg.knativeVoice.modelId || cfg.model,
            release: cfg.knativeVoice.release || "",
            openFiles,
          });
        } catch (e) { try { console.warn("[HoloVoice TTS] κ-served voice unavailable, using vendored ONNX:", e && e.message || e); } catch (_) {} kserve = null; }
      }
      const mod = await import(/* @vite-ignore */ new URL(cfg.kokoroLib, base).href);
      const KokoroTTS = mod.KokoroTTS || (mod.default && mod.default.KokoroTTS);
      // device: explicit cfg.device wins (the bake-off harness sets it); else preferWebGPU→webgpu when available, else wasm.
      const device = cfg.device || ((cfg.preferWebGPU && navigator.gpu) ? "webgpu" : "wasm");
      try {
        tts = await KokoroTTS.from_pretrained(cfg.model, { dtype: cfg.dtype, device, progress_callback: onProgress });
      } catch (e) { if (kserve) { try { kserve.restore(); } catch (_) {} } throw e; }   // κ-served load failed → un-shim so the caller's fallback fetches the vendored files
      info = { ready: true, device, model: cfg.model, dtype: cfg.dtype, engine: kserve ? "kokoro-κserved" : "kokoro-onnx", servedFromHolo: kserve ? kserve.served.length : 0 };
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
