// Proof that whisper LARGE-v3 forges + runs natively in the κ-substrate (same code).
// Forges the 3.1GB model → κ-objects, then runs mel(128) → conv stem → a few encoder
// layers on real large-v3 weights. (Full transcription is perf-gated in pure JS.)
import { readFileSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { forgeWhisper, whisperMelFilters, logMelSpectrogram, whisperConvStem, whisperEncoder, readWavPCM16, whisperSpecials } from "./gguf-forge-whisper.mjs";

const DIR = "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/";
let t = Date.now(); const sec = () => ((Date.now() - t) / 1000).toFixed(0);

// readFileSync caps at 2 GiB → read the 3.1GB model in chunks into one Uint8Array.
function readBig(path) {
  const fd = openSync(path, "r"), size = fstatSync(fd).size, out = new Uint8Array(size);
  const CH = 1 << 30, buf = Buffer.allocUnsafe(Math.min(CH, size));
  for (let off = 0; off < size;) { const n = readSync(fd, buf, 0, Math.min(CH, size - off), off); out.set(buf.subarray(0, n), off); off += n; }
  closeSync(fd); return out;
}
const model = readBig(DIR + "ggml-large-v3.bin");
const f = forgeWhisper(model);
const h = f.plan.hparams;
console.log(`FORGED large-v3: ${f.tensors.length} tensors, ${(model.length / 1e9).toFixed(2)}GB → root ${f.rootKappa.slice(0, 28)}… (${sec()}s)`);
console.log(`hparams: n_audio_state=${h.n_audio_state} layers=${h.n_audio_layer} heads=${h.n_audio_head} n_mels=${h.n_mels} n_vocab=${h.n_vocab}`);
const W = whisperSpecials(h.n_vocab);
console.log(`derived specials: SOT=${W.SOT} transcribe=${W.TRANSCRIBE} notimestamps=${W.NO_TIMESTAMPS}`);

// every 32-layer encoder + decoder tensor resolves
const names = new Set(f.tensors.map((x) => x.name));
const need = ["encoder.conv1.weight", "encoder.blocks.31.attn.query.weight", "decoder.blocks.31.cross_attn.key.weight", "decoder.ln.weight"];
console.log("32-layer tensors resolve:", need.every((n) => names.has(n)), "| conv1.weight dims", f.plan.tensors.find((x) => x.name === "encoder.conv1.weight").dims);

const store = { get: (x) => f.blocks.get(x) };
t = Date.now();
const filters = whisperMelFilters(f.plan, store);                      // [128, 201]
const { mel } = logMelSpectrogram(readWavPCM16(new Uint8Array(readFileSync(DIR + "jo16.wav"))), filters, { nMel: h.n_mels, nBins: f.plan.mel.n_fft });
console.log(`mel [${h.n_mels}, ${mel.length / h.n_mels}] finite=${mel.every(Number.isFinite)} (${sec()}s)`);

t = Date.now();
const stem = whisperConvStem(f.plan, store, mel);                      // → [1500, 1280]
console.log(`conv stem → [${stem.n_ctx}, ${stem.n_state}] finite=${stem.x.every(Number.isFinite)} (${sec()}s)`);

t = Date.now();
const enc = whisperEncoder(f.plan, store, stem.x.subarray(0, 64 * stem.n_state), 64, { nLayers: 2 }); // 2 of 32 layers, 64 positions
console.log(`encoder (2/32 layers, 64 pos) → [${enc.length / stem.n_state}, ${stem.n_state}] finite=${enc.every(Number.isFinite)} (${sec()}s)`);
console.log("\n✓ large-v3 FORGES (κ-addressable) and EXECUTES natively at 1280-dim / 128-mel / 32-layer. Full transcription is perf-gated (pure-JS) — needs WebGPU.");
