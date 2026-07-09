// holo-parakeet-asr.mjs — the κ-native Parakeet-TDT-0.6B ASR engine: acoustic features → text, with EVERY
// weight content-addressed. Assembles the proven pieces:
//   features [T,1024] → holo-parakeet-encoder (24-layer FastConformer, weights from the encoder .holo by κ)
//                     → tdtDecode (holo-asr-decode) driven by the κ-native joint (holo-asr-joint, joint .holo by κ)
//                     → detokenize (SentencePiece) → text
// ZERO external runtime in this path (no onnxruntime / ort-web): encoder + decoder are pure-JS/WGSL on the
// κ-substrate. The ONLY external piece in a full audio→text run is the mel front-end (nemo128) — injected as a
// `toFeatures` seam so this engine stays pure and node-witnessable; the ear provides it.
//
//   createParakeetASR({ encoderStream, jointStream, rescale, rescaleBin, vocab, toFeatures?, backend? }) →
//     { transcribe(features, T) -> { text, ids, ms },          // the witnessed κ-native core
//       transcribeAudio(pcm16k, opts) -> { text, ids, ms },    // needs toFeatures (mel+stem); throws if absent
//       info() }
//
// `encoderStream` / `jointStream` are opened openHoloStream results (have .getBody / .order) — production opens
// them from a URL via streamHolo (Range → release → κ-route → OPFS); the node witness opens local files. So the
// fetch/fs lives in the caller (the ear), and this engine is pure + testable.

import { createParakeetEncoder } from "./holo-parakeet-encoder.mjs";
import { tdtDecode, detokenize } from "./holo-asr-decode.mjs";
import { loadJointFromHolo } from "./holo-asr-joint.mjs";

export async function createParakeetASR({ encoderStream, jointStream, rescale, rescaleBin, vocab, toFeatures = null, backend = "cpu", bias = null } = {}) {
  if (!encoderStream || !jointStream) throw new Error("createParakeetASR needs opened encoderStream + jointStream");
  if (!rescale || !rescaleBin) throw new Error("createParakeetASR needs rescale + rescaleBin");
  if (!vocab || !vocab.length) throw new Error("createParakeetASR needs the vocab array");

  const getWeight = (kappa) => encoderStream.getBody(kappa);           // L5-verified int8 body, by content address
  const encoder = createParakeetEncoder({ getWeight, rescale, rescaleBin, backend });
  const joint = await loadJointFromHolo(jointStream, { H: 640, encDim: 1024 });   // κ-native joint, from the joint .holo
  let info = { ready: true, engine: "parakeet-κ", backend, layers: (rescale.config && rescale.config.layers) || 24, decoder: "tdt-κnative" };

  // transcribe(features[T*1024], T, opts) — the κ-native core. encoder → TDT decode → detokenize. opts.bias (a
  // makeBiasContext, or the engine-level `bias`) boosts the user's κ-world vocabulary at decode (contextual biasing).
  async function transcribe(features, T, opts = {}) {
    const t0 = (globalThis.performance ? performance.now() : Date.now());
    const enc = await encoder.encode(features, T);                     // [T,1024]
    const frame = (t) => enc.subarray(t * 1024, t * 1024 + 1024);
    const b = opts.bias !== undefined ? opts.bias : bias; if (b) b.reset();   // bias matches are per-utterance
    const dec = { T, frame, joint, bias: b || null }; if (opts.biasGateDelta !== undefined) dec.biasGateDelta = opts.biasGateDelta;
    const { tokens, steps } = await tdtDecode(dec);
    const text = detokenize(tokens, vocab);
    const ms = (globalThis.performance ? performance.now() : Date.now()) - t0;
    return { text, ids: tokens, steps, ms };
  }

  // transcribeAudio(pcm, opts) — full path; needs the mel+stem front-end. opts.bias threads to the decode.
  async function transcribeAudio(pcm, opts = {}) {
    if (!toFeatures) throw new Error("parakeet front-end (mel+stem) not wired — pass toFeatures");
    const { features, T } = await toFeatures(pcm, opts);
    return transcribe(features, T, opts);
  }

  return { transcribe, transcribeAudio, info: () => info, sampleRate: 16000 };
}

export default createParakeetASR;
