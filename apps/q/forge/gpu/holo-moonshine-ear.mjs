// holo-moonshine-ear.mjs — production adapter exposing the κ-native Moonshine WebGPU ASR engine to Q's voice
// stack (holo-voice-asr.mjs interface): createWhisperEar({ holoUrl, upgradeUrl, kappa, language }) →
//   { load(progressCb), transcribe(pcm16k, opts) -> {text} }.
// FIRST-LOAD TIERING: load the small int8 .holo first (~¼ the bytes → talk in ~half the cold-start time),
// then silently stream the lossless f16 .holo in the background and hot-swap the engine. Same trick as Q's
// .holo brain (tiny-now → upgrade-silent). holo-voice-asr.mjs auto-falls back to ONNX if WebGPU/load fails.
import { createMoonshineASR } from "./holo-moonshine-asr.mjs";

export function createWhisperEar({ holoUrl, upgradeUrl, kappa, release, upgradeKappa, upgradeRelease, language } = {}, deps = {}) {
  const openStream = deps.openStream || null;   // unified-pack view (fail-soft → streamHolo inside createMoonshineASR)
  let asr = null, tier = "", upgrading = false;
  return {
    async load(progress) {
      asr = await createMoonshineASR(holoUrl, { onProgress: progress, kappa, release, openStream });   // fast tier (int8) — pack → path → Release → κ-route
      tier = upgradeUrl ? "int8" : "base";
      if (upgradeUrl) {   // silent background upgrade to the lossless tier; hot-swap when it lands
        upgrading = true;
        createMoonshineASR(upgradeUrl, { kappa: upgradeKappa, release: upgradeRelease, openStream }).then((hi) => { asr = hi; tier = "f16"; upgrading = false; }).catch(() => { upgrading = false; });
      }
      return true;
    },
    async transcribe(audio, opts = {}) {
      if (!asr) await this.load();
      const a = asr;   // pin the current tier for this call (background swap won't disturb an in-flight transcribe)
      const r = await a.transcribe(audio, opts);
      return { text: r.text, ids: r.ids, ms: r.ms, gpuMs: r.gpuMs, tier };   // {text,…} shape Holo Voice consumes
    },
    info: () => ({ engine: "moonshine-κ", holoUrl, upgradeUrl, kappa, tier, upgrading }),
  };
}
export default createWhisperEar;
