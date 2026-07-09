// holo-voice-vad.mjs — the SOVEREIGN, pure-ONNX stage-1 wake gate: Silero VAD (MIT) running on the
// onnxruntime-web that transformers.js ALREADY bundles. No emscripten build, no account key, no new
// runtime — just a 2 MB ONNX model loaded through the SAME vendored transformers instance as the ASR, so
// it inherits the serverless config (local weights, vendored wasm, no CDN) and shares the loaded ORT.
//
// WHY (first principles): the always-on wake loop should spend Whisper ONLY on real speech. Energy-RMS
// can't tell speech from a slammed door, music, or a TV; Silero VAD can. So it's the cheap stage-1 gate —
// it proposes ("this segment is speech"), Whisper-tiny disposes (confirms "Q" + the carrier). This is the
// pure-ONNX replacement for the sherpa-onnx KWS path (which needed an emscripten wasm runtime we can't
// vendor in-browser). Sovereign AND web-native: it runs on the runtime we already ship.
//
//   const vad = await createVAD({ base, threshold });   // loads onnx-community/silero-vad via AutoModel
//   const p = await vad.speechProb(frame512_16k);        // streaming: one 512-sample frame → P(speech)
//   const has = await vad.segmentHasSpeech(float32_16k); // one-shot: scan a whole segment → bool
//   vad.reset();
//
// HONESTY: Silero VAD-on-transformers.js is the documented pattern (the transformers.js realtime-whisper
// demo loads onnx-community/silero-vad with `config:{model_type:'custom'}` — there's no config.json in the
// repo). The model is v5 (I/O: input·sr·state → output·stateN; state [2,1,128]). The exact call is verified
// to LOAD + RUN in-browser here; gating accuracy/threshold needs real-mic tuning. Fails closed: any error
// → the caller keeps its energy-VAD path (no regression).

const SAMPLE_RATE = 16000;
const FRAME = 512;                       // Silero v5 expects 512 samples per step at 16 kHz
const STATE_DIMS = [2, 1, 128];          // v5 unified LSTM state
const STATE_LEN = 2 * 1 * 128;

// Resolve relative to THIS module's URL — same discipline as holo-voice-asr.mjs (vendor/ is a sibling).
function moduleBase() {
  try { return new URL("./", import.meta.url).href; }
  catch (e) { return new URL("./", (typeof location !== "undefined" ? location.href : "")).href; }
}

export async function createVAD(opts) {
  opts = opts || {};
  const base = opts.base || moduleBase();
  const lib = opts.lib || "vendor/transformers/transformers.js";
  const localPath = opts.localPath || "vendor/models/";
  const ortPath = opts.ortPath || "vendor/transformers/";
  const model = opts.model || "onnx-community/silero-vad";
  const dtype = opts.dtype || "fp32";    // model.onnx (2 MB). 'q8' → model_quantized.onnx (639 KB) if vendored.
  const threshold = opts.threshold != null ? opts.threshold : 0.5;

  // Import the SAME vendored transformers module instance the ASR uses (ES-module cache → shared env + ORT).
  const tf = await import(/* @vite-ignore */ new URL(lib, base).href);
  const { AutoModel, Tensor, env } = tf;
  if (!AutoModel || !Tensor) throw new Error("transformers.js missing AutoModel/Tensor");
  if (env) {                                                             // idempotent: serverless, weights + wasm are vendored
    env.allowRemoteModels = false; env.allowLocalModels = true;
    env.localModelPath = new URL(localPath, base).href;
    try { const wp = new URL(ortPath, base).href; if (env.backends && env.backends.onnx && env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = wp; } catch (e) {}
  }

  // No config.json in the repo → pass a custom config inline (the documented Silero-on-transformers.js trick).
  const net = await AutoModel.from_pretrained(model, { config: { model_type: "custom" }, dtype: dtype });

  const sr = new Tensor("int64", [BigInt(SAMPLE_RATE)], []);
  let state = new Tensor("float32", new Float32Array(STATE_LEN), STATE_DIMS);
  function reset() { state = new Tensor("float32", new Float32Array(STATE_LEN), STATE_DIMS); }

  // run ONE 512-sample frame → P(speech). Carries the recurrent state forward.
  async function speechProb(frame) {
    let x = frame;
    if (x.length !== FRAME) { const f = new Float32Array(FRAME); f.set(x.subarray ? x.subarray(0, FRAME) : x.slice(0, FRAME)); x = f; }   // pad/trim to 512
    const input = new Tensor("float32", x, [1, FRAME]);
    const out = await net({ input: input, sr: sr, state: state });
    if (out.stateN) state = out.stateN;
    const o = out.output && out.output.data;
    return o && o.length ? o[0] : 0;
  }

  // one-shot: scan a whole 16 kHz segment in 512-sample frames → did ANY frame exceed the speech threshold?
  // Returns { speech, maxProb }. Resets state first so each segment is judged independently.
  async function segmentHasSpeech(audio, thr) {
    reset();
    const t = thr != null ? thr : threshold;
    let max = 0;
    for (let i = 0; i + 1 <= audio.length; i += FRAME) {
      const end = Math.min(i + FRAME, audio.length);
      const p = await speechProb(audio.subarray ? audio.subarray(i, end) : audio.slice(i, end));
      if (p > max) max = p;
      if (max >= t) { /* keep scanning a touch could refine, but early-out is enough for a gate */ break; }
    }
    return { speech: max >= t, maxProb: max };
  }

  return { backend: "silero-vad-onnx", threshold: threshold, model: model, speechProb: speechProb, segmentHasSpeech: segmentHasSpeech, reset: reset };
}

export default { createVAD };
