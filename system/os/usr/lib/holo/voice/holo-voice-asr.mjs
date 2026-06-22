// holo-voice-asr.mjs — the on-device speech-recognition engine for Holo Voice.
//
// It binds into the QVAC transcription seam (HoloQVAC.useHoloVoice). The recognizer runs ENTIRELY in
// the browser — no inference server, no audio leaves the device. Tiered, mirroring QVAC's own
// "WebGPU, deterministic fallback" pattern (holo-qvac.js):
//
//   • WebGPU present → Whisper-base (transformers.js, ONNX/WebGPU) — high accuracy
//   • WASM only      → Moonshine-tiny (transformers.js, ONNX/WASM)  — streaming, any browser
//
// Weights resolve by content address through the OS service worker (Law L5) and live offline in
// CacheStorage after first load — that is what makes recognition serverless. `localPath` points at the
// vendored κ-disk; set `remote:true` (dev only) to bootstrap from a module CDN before weights are
// vendored. The library is imported lazily, so loading this module never blocks and never throws on a
// device that will only use the bring-up fallback.

const DEFAULTS = {
  // All vendor paths are resolved RELATIVE TO THIS MODULE (vendor/ is a sibling dir created by
  // tools/vendor-voice-model.mjs), so they work under any mount (_shared, content-addressed, …).
  lib: "vendor/transformers/transformers.js",                          // transformers.js ESM entry
  libRemote: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2",
  ortPath: "vendor/transformers/",                                     // onnxruntime-web wasm lives beside it
  // Tiered for LATENCY: the WASM listen path defaults to Whisper-TINY (~3-5x faster than base — it's the
  // ASR wall-time that dominates response onset), falling back to base if tiny isn't vendored. WebGPU
  // (when it works) keeps base for accuracy. One vendored model per id under localPath.
  modelWebGPU: "onnx-community/whisper-base",                          // quality tier (WebGPU)
  modelWASM: "onnx-community/whisper-tiny",                            // fast listen tier (WASM)
  modelWASMFallback: "onnx-community/whisper-base",                    // used if whisper-tiny isn't vendored
  localPath: "vendor/models/",                                         // model id resolves under here
  remote: false,          // dev escape hatch: load lib + weights from the CDN above
  quantized: true,
  // WASM is the default: it's the any-browser floor (Firefox/Safari have no stable WebGPU) AND the
  // quantized Whisper decoder currently hits an ORT WebGPU kernel bug. Opt into WebGPU explicitly.
  preferWebGPU: false,
  // κ-native Holo GGUF ear (opt-in): when WebGPU is present, run Whisper 100% on the κ-substrate —
  // weights streamed by κ from the .holo (HTTP-Range + per-block L5 + OPFS), GPU encoder-decoder
  // forward, no transformers.js/ONNX. Set { module, holoUrl } (resolved relative to this module) to
  // enable; ANY failure transparently falls back to the transformers path below. null = off.
  knativeEar: null,       // e.g. { module: "../../q/forge/gpu/holo-whisper-ear.mjs", holoUrl: "…/whisper-base.holo" }
  // κ-served WASM fallback (opt-in): when the κ-native ear is off (no WebGPU) and the transformers/ONNX path
  // runs, serve Whisper's ONNX files from its .holo (HTTP-Range + per-block L5 + OPFS + serverless) into the
  // SAME engine — so the any-browser floor is ALSO content-addressed/warm/serverless, not a flat download.
  // ANY failure restores fetch + falls back to the vendored ONNX files. null = off. Same shim every faculty uses.
  knativeServe: {         // κ-served whisper-tiny — its ONNX files stream from the .holo (per-block L5 + OPFS warm) into the SAME transformers engine. ANY failure restores fetch → vendored ONNX. matches modelWASM.
    module: "/apps/q/forge/gpu/holo-onnx-kserve.mjs",
    holoUrl: "/.holo/sha256/361209ec2ff387beb9e763017cd50d18f9cc8b5276346d62420922ca9a5d9185",   // κ-pure source; the SW serves this directly once the κ-route heal-fallback lands (then `release` below can go)
    modelId: "onnx-community/whisper-tiny",
    // delivery TODAY: openHoloFiles (holo-files.mjs:18-21) range-fetches holoUrl; on miss it falls back to
    // `release` as a DIRECT URL — CORS + Range from the GitHub Release CDN, per-block re-derived (L5).
    release: "https://github.com/Hologram-Technologies/hologram-apps/releases/download/weights-v1/361209ec2ff387beb9e763017cd50d18f9cc8b5276346d62420922ca9a5d9185",
  },
  lang: "en",
};

function moduleBase() {
  try { return new URL("./", import.meta.url).href; }                  // …/_shared/voice/
  catch (e) { return new URL("./", location.href).href; }
}

async function hasWebGPU() {
  try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch (e) { return false; }
}

// ── the engine ──────────────────────────────────────────────────────────────────────────────────
export function createASR(opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  let pipe = null, knative = null, info = { ready: false, engine: null, model: null, device: null };
  let loading = null;

  async function load(onProgress) {
    if (pipe || knative) return info;
    if (loading) return loading;
    loading = (async () => {
      const base = moduleBase();
      // κ-native Holo GGUF ear (opt-in, WebGPU only). Transparently falls back on any failure.
      if (cfg.knativeEar && cfg.knativeEar.module && (await hasWebGPU())) {
        try {
          const mod = await import(/* @vite-ignore */ new URL(cfg.knativeEar.module, base).href);
          const ear = (mod.createWhisperEar || mod.default)({ holoUrl: new URL(cfg.knativeEar.holoUrl, base).href, upgradeUrl: cfg.knativeEar.upgradeUrl ? new URL(cfg.knativeEar.upgradeUrl, base).href : null, kappa: cfg.knativeEar.kappa, release: cfg.knativeEar.release || "", upgradeKappa: cfg.knativeEar.upgradeKappa || "", upgradeRelease: cfg.knativeEar.upgradeRelease || "", language: cfg.lang });
          await ear.load(onProgress);
          knative = ear; info = Object.assign({ ready: true, engine: "holo-gguf-κnative" }, ear.info());
          return info;
        } catch (e) { try { console.warn("[HoloVoice ASR] κ-native ear unavailable, using transformers:", e && e.message || e); } catch (_) {} }
      }
      const libUrl = cfg.remote ? cfg.libRemote : new URL(cfg.lib, base).href;
      const tf = await import(/* @vite-ignore */ libUrl);              // throws here if not vendored → caller falls back
      const { pipeline, env } = tf;
      const webgpu = cfg.preferWebGPU && (await hasWebGPU());
      const device = webgpu ? "webgpu" : "wasm";
      const model = webgpu ? cfg.modelWebGPU : cfg.modelWASM;
      if (env) {
        env.allowRemoteModels = !!cfg.remote;                          // serverless: weights come from the κ-disk only
        env.allowLocalModels = !cfg.remote;
        if (!cfg.remote) {
          env.localModelPath = new URL(cfg.localPath, base).href;
          // point onnxruntime-web at the vendored wasm so NO binary is fetched from a CDN.
          const wasmPaths = new URL(cfg.ortPath, base).href;
          if (env.backends && env.backends.onnx && env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = wasmPaths;
        }
        // run ORT in a Web Worker (WASM only) so streaming partial transcriptions don't block the main
        // thread / the VAD loop — the UI stays responsive while recognition runs as you speak.
        try { if (!webgpu && cfg.proxy !== false && env.backends && env.backends.onnx && env.backends.onnx.wasm) env.backends.onnx.wasm.proxy = true; } catch (e) {}
      }
      const prog = (p) => { try { onProgress && onProgress({ phase: p.status || "load", file: p.file, loaded: p.loaded, total: p.total, device, model }); } catch (e) {} };
      // κ-served WASM fallback: install the .holo fetch shim BEFORE the pipeline loads, so Whisper's ONNX files
      // are served by content address. Transparently falls back to vendored ONNX on any failure.
      let kserve = null;
      if (cfg.knativeServe && cfg.knativeServe.module && cfg.knativeServe.holoUrl) {
        try {
          const km = await import(/* @vite-ignore */ new URL(cfg.knativeServe.module, base).href);
          kserve = await (km.serveModelFromHolo || km.default)({ holoUrl: new URL(cfg.knativeServe.holoUrl, base).href, modelId: cfg.knativeServe.modelId || model, release: cfg.knativeServe.release || "" });
        } catch (e) { try { console.warn("[HoloVoice ASR] κ-served fallback unavailable, using vendored ONNX:", e && e.message || e); } catch (_) {} kserve = null; }
      }
      const dtype = cfg.quantized ? "q8" : "fp32";
      const build = (m) => pipeline("automatic-speech-recognition", m, { device, dtype, progress_callback: prog });
      let used = model;
      try { pipe = await build(model); }
      catch (e) {                                                        // tiny not vendored (or load failed) → fall back to base
        if (kserve) { try { kserve.restore(); } catch (_) {} kserve = null; }   // the κ-served tiny failed → un-shim so base loads vendored
        if (!webgpu && cfg.modelWASMFallback && cfg.modelWASMFallback !== model) { used = cfg.modelWASMFallback; pipe = await build(used); }
        else throw e;
      }
      info = { ready: true, engine: kserve ? "transformers-κserved" : "transformers", model: used, device, servedFromHolo: kserve ? kserve.served.length : 0 };
      return info;
    })().catch((e) => { loading = null; throw e; });
    return loading;
  }

  // transcribe(audio, opts) — audio is a Float32Array of mono PCM at 16 kHz (Holo Voice resamples).
  async function transcribe(audio, o = {}) {
    if (!pipe && !knative) await load(o.onProgress);
    if (knative) return knative.transcribe(audio, o);                  // κ-native ear (same {text,…} shape)
    const args = { language: o.language || null, task: "transcribe", chunk_length_s: 30, stride_length_s: 5 };
    if (o.prompt) args.prompt = o.prompt;                              // best-effort decoding bias (ignored where unsupported)
    const r = await pipe(audio, args);
    const text = (r && (Array.isArray(r) ? r.map((x) => x.text).join(" ") : r.text) || "").trim();
    return { text, language: o.language || null, runtime: info.device === "webgpu" ? "browser-webgpu" : "browser-wasm" };
  }

  return { id: "holo-voice-asr", load, transcribe, info: () => info, sampleRate: 16000 };
}

export default createASR;
