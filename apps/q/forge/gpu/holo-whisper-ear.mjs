// holo-whisper-ear.mjs — Q's κ-native ASR ear (W-6). Matches the holo-voice-asr.mjs provider
// contract: { id, load(onProgress), transcribe(float32@16k) → { text }, info(), sampleRate }.
//
// WebGPU present → 100% κ-native Whisper: weights STREAMED by κ from the .holo (HTTP-Range +
// per-block L5 + OPFS), mel front-end in JS (filterbank κ from the .holo), the witnessed
// resident GPU encoder-decoder forward (holo-whisper-gpu.mjs), detok from the .holo's vocab
// header. No cloud, no flat blob — identity is the hash end to end.
// No WebGPU → delegate to the existing ONNX/transformers.js ear (the any-browser floor).
//
// The GPU path is the same engine the W-4 witness proved EXACT (53/53) on the jo16 golden.
import { streamHolo } from "./holo-whisper-stream.mjs";
import { runWhisperGPU } from "./holo-whisper-gpu.mjs";
import { logMelSpectrogram, whisperDetok, whisperSpecials } from "./holo-whisper-frontend.mjs";

const LANG_OFFSET = { en: 0, zh: 1, de: 2, es: 3, ru: 4, ko: 5, fr: 6, ja: 7 }; // index after LANG_EN

const N30 = 480000; // 30 s @ 16 kHz — Whisper's fixed analysis window

async function hasWebGPU() { try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { return false; } }

// pad/trim mono PCM to exactly 30 s so the mel is [n_mel, 3000]
function fit30s(audio) { if (audio.length === N30) return audio; const a = new Float32Array(N30); a.set(audio.subarray(0, N30)); return a; }

export function createWhisperEar(opts = {}) {
  const holoUrl = opts.holoUrl || "/.models/whisper-base.holo";
  const holoKappa = opts.kappa || "";   // sha256 of the .holo → /.holo/sha256/<κ> heal on static/IPFS deploys
  // language/task → Whisper prompt: <|sot|> <|lang|> <|transcribe|> <|notimestamps|>
  const lang = opts.language || "en";
  let H = null, dev = null, hp = null, W = null, filters = null, header = null, info = { device: null, model: holoUrl };
  let loading = null, fallback = null;

  async function load(onProgress) {
    if (loading) return loading;
    loading = (async () => {
      if (!(await hasWebGPU())) {
        // floor: the ONNX/transformers.js ear, unchanged
        const { createASR } = await import("../../../../holo-os/system/os/usr/lib/holo/voice/holo-voice-asr.mjs");
        fallback = createASR(opts); await fallback.load(onProgress); info = { ...fallback.info(), device: fallback.info().device + " (fallback)" };
        return;
      }
      onProgress && onProgress({ stage: "streaming", url: holoUrl });
      H = await streamHolo(holoUrl, { kappa: holoKappa });
      hp = H.meta.hparams;
      W = new Map(); await Promise.all(H.meta.order.map(async (o) => W.set(o.name, await H.getF32(o.name))));
      filters = await H.getMelFilters();
      header = H.headerBytes; if (!header) throw new Error("no vocab header in .holo (cannot detok)");
      dev = await (await navigator.gpu.requestAdapter()).requestDevice();
      info = { device: "browser-webgpu-κnative", model: holoUrl, tensors: W.size, l5verifies: H.stats.verifies, range206: H.stats.support206 };
      onProgress && onProgress({ stage: "ready", ...info });
    })();
    return loading;
  }

  // audio: Float32Array mono PCM @ 16 kHz (Holo Voice resamples upstream)
  async function transcribe(audio, o = {}) {
    await load();
    if (fallback) return fallback.transcribe(audio, o);
    const { mel } = logMelSpectrogram(fit30s(audio), filters, { nMel: hp.n_mels, nBins: H.meta.mel.n_fft, nSamples: N30 });
    const sp = whisperSpecials(hp.n_vocab), L = o.language || lang;
    const prompt = [sp.SOT, sp.LANG_EN + (LANG_OFFSET[L] ?? 0), sp.TRANSCRIBE, sp.NO_TIMESTAMPS];
    const { ids } = await runWhisperGPU(dev, W, hp, mel, { prompt, eot: sp.EOT });
    const text = whisperDetok(header, ids);
    return { text: text.trim(), language: o.language || lang, runtime: "browser-webgpu-κnative" };
  }

  return { id: "holo-whisper-ear", load, transcribe, info: () => info, sampleRate: 16000 };
}

export default createWhisperEar;
