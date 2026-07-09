// gen-whisper-encoder-ref.mjs — W-1 GOLDEN generator for the GPU Whisper ear.
// Runs the Tier-A CPU oracle (byte-exact to whisper-cli) up to the encoder and exports the reference the
// WebGPU encoder harness (gpu/whisper-encoder.html) must match: the mel, the conv-stem output (= the GPU
// encoder's INPUT), and the encoder output (= the GPU encoder's expected OUTPUT). Float32 LE blobs + a JSON
// manifest with shapes + a sample + the model root κ. This is the W-1 witness data — the GPU result is
// scored cosine/maxAbs against gpu/whisper-enc-ref.enc.f32.
//
//   node gen-whisper-encoder-ref.mjs [model.bin] [audio.wav] [nLayers]
//
// nLayers caps the encoder depth for a fast first-parity (default = full); the kernels are identical per
// layer, so a 2-layer GPU match + the 12-layer CPU unit test (gguf-forge-whisper.test.mjs) = W-1 confidence.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { forgeWhisper, whisperMelFilters, logMelSpectrogram, whisperConvStem, whisperEncoder, readWavPCM16 } from "./gguf-forge-whisper.mjs";

const MODEL = process.argv[2] || "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/ggml-small.bin";
const WAV = process.argv[3] || "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/jo16.wav";
const nLayers = process.argv[4] ? +process.argv[4] : undefined;   // undefined = full encoder

const t0 = Date.now(); const sec = () => ((Date.now() - t0) / 1000).toFixed(0);
const forged = forgeWhisper(new Uint8Array(readFileSync(MODEL)));
const { plan, blocks } = forged, store = { get: (h) => blocks.get(h) };
const S = plan.hparams.n_audio_state;
console.log(`forged ${forged.tensors.length} tensors (${sec()}s); n_audio_state=${S} n_audio_layer=${plan.hparams.n_audio_layer} n_mels=${plan.hparams.n_mels}`);

const filters = whisperMelFilters(plan, store);
const { mel } = logMelSpectrogram(readWavPCM16(new Uint8Array(readFileSync(WAV))), filters, { nMel: plan.hparams.n_mels, nBins: plan.mel.n_fft });
console.log(`mel [${plan.hparams.n_mels},${mel.length / plan.hparams.n_mels}] (${sec()}s)`);

const stem = whisperConvStem(plan, store, mel);
console.log(`conv stem → x [${stem.n_ctx},${S}] (${sec()}s)`);

const enc = whisperEncoder(plan, store, stem.x, stem.n_ctx, nLayers != null ? { nLayers } : {});
console.log(`encoder (${nLayers ?? plan.hparams.n_audio_layer} layers) → [${stem.n_ctx},${S}] (${sec()}s)`);

mkdirSync("./gpu", { recursive: true });
const f32 = (a) => Buffer.from(Float32Array.from(a).buffer);
writeFileSync("./gpu/whisper-enc-ref.mel.f32", f32(mel));
writeFileSync("./gpu/whisper-enc-ref.stem.f32", f32(stem.x));
writeFileSync("./gpu/whisper-enc-ref.enc.f32", f32(enc));
const man = {
  model: MODEL.split(/[\\/]/).pop(), arch: "whisper", rootKappa: forged.rootKappa,
  n_audio_state: S, n_audio_layer: plan.hparams.n_audio_layer, n_audio_head: plan.hparams.n_audio_head,
  n_mels: plan.hparams.n_mels, encLayers: nLayers ?? plan.hparams.n_audio_layer,
  melShape: [plan.hparams.n_mels, mel.length / plan.hparams.n_mels],
  stemShape: [stem.n_ctx, S], encShape: [stem.n_ctx, S],
  encSample: [...enc.slice(0, 8)].map((v) => +v.toFixed(6)),
  encL2: Math.sqrt([...enc].reduce((a, v) => a + v * v, 0)),
  generatedSec: +sec(),
};
writeFileSync("./gpu/whisper-enc-ref.json", JSON.stringify(man, null, 2));
console.log("\nGOLDEN → gpu/whisper-enc-ref.{mel,stem,enc}.f32 + .json");
console.log(JSON.stringify(man, null, 1));
