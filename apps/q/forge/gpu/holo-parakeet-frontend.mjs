// holo-parakeet-frontend.mjs — the audio front-end (PCM → acoustic features) for the Parakeet ear:
//   mel (nemo128 log-mel, onnxruntime-web — the ONE external runtime) → conv-subsampling STEM (κ-native, real
//   int8 weights from the encoder .holo) → features [T,1024]. This is the `toFeatures` seam createParakeetASR
//   takes. mel is labeled as the lone external piece; everything downstream is on the κ-substrate.
//
//   makeMelStemFrontend({ getWeight, rescale, rescaleBin, nemoUrl, ort?, ortUrl? }) → async toFeatures(pcm16k)
//     → { features: Float32Array[T*1024], T }
//
// `ort` may be injected (a loaded onnxruntime-web module); else it's imported from `ortUrl` (CDN default) with
// the proxy worker disabled (so it loads cross-origin). `getWeight(kappa)` is the encoder .holo body fetcher —
// the 6 pre_encode/stem κs live in the full encoder .holo, so the ear reuses its encoderStream.getBody.
import { createParakeetStem } from "./holo-parakeet-stem.mjs";

const ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.webgpu.bundle.min.mjs";

// backend "gpu" runs the stem on WebGPU (conv-subsampling.wgsl, ~0.65s vs ~28s CPU); "cpu" is the headless
// oracle. `device` may be shared with the encoder so both reuse one resident GPU context.
export function makeMelStemFrontend({ getWeight, rescale, rescaleBin, nemoUrl, ort = null, ortUrl = ORT_CDN, backend = "cpu", device = null } = {}) {
  if (!nemoUrl) throw new Error("makeMelStemFrontend needs nemoUrl (the nemo128 mel preprocessor)");
  let stem = null;
  async function buildStem() {
    if (stem) return stem;
    if (backend === "gpu" && (globalThis.navigator?.gpu)) {
      try { const { createParakeetStemGPU } = await import("./holo-parakeet-stem-gpu.mjs"); stem = createParakeetStemGPU({ device, getWeight, rescale, rescaleBin }); return stem; }
      catch (e) { try { console.warn("[parakeet stem] GPU unavailable, CPU:", e && e.message || e); } catch (_) {} }
    }
    stem = createParakeetStem({ getWeight, rescale, rescaleBin });
    return stem;
  }
  let ortMod = ort, pre = null, Tns = null;

  async function ensure() {
    if (!ortMod) ortMod = await import(/* @vite-ignore */ ortUrl);
    try { ortMod.env.wasm.proxy = false; ortMod.env.wasm.numThreads = 1; } catch (e) {}
    if (!pre) { pre = await ortMod.InferenceSession.create(nemoUrl, { executionProviders: ["wasm"] }); Tns = ortMod.Tensor; }
  }

  // toFeatures(pcm) — pcm is a Float32Array of mono 16 kHz samples.
  return async function toFeatures(pcm) {
    await ensure();
    const s = await buildStem();
    const out = await pre.run({ waveforms: new Tns("float32", pcm, [1, pcm.length]), waveforms_lens: new Tns("int64", BigInt64Array.from([BigInt(pcm.length)]), [1]) });
    const mel = out.features.data, F = out.features.dims[1], Tmel = out.features.dims[2];   // [1,128,Tmel] freq-major
    return s.stem(mel, F, Tmel);                                                            // → { features, T }
  };
}
export default makeMelStemFrontend;
