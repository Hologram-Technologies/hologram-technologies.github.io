// gen-whisper-transcribe-ref.mjs — W-3 golden: the CPU-oracle FULL transcription (whisper-cli-exact) of
// jo16.wav with base → token ids + text. The GPU transcription (full encoder + decoder greedy loop) must
// reproduce these ids. Records the CPU wall time (for RTF context).
//   node gen-whisper-transcribe-ref.mjs [model.bin] [audio.wav] [maxNew]
import { readFileSync, writeFileSync } from "node:fs";
import { forgeWhisper, whisperTranscribe } from "./gguf-forge-whisper.mjs";

const MODEL = process.argv[2] || "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/ggml-base.bin";
const WAV = process.argv[3] || "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/jo16.wav";
const maxNew = process.argv[4] ? +process.argv[4] : 80;
const OUT = process.argv[5] || "./gpu/whisper-tx-ref.json";

const modelBytes = new Uint8Array(readFileSync(MODEL));
const wav = new Uint8Array(readFileSync(WAV));
const forged = forgeWhisper(modelBytes);
const t0 = Date.now();
const { ids, text } = whisperTranscribe(forged, modelBytes, wav, { maxNew });
const ms = Date.now() - t0;
writeFileSync(OUT, JSON.stringify({ model: MODEL.split(/[\\/]/).pop(), wav: WAV.split(/[\\/]/).pop(), ids, text, cpuMs: ms }, null, 1));
console.log(`CPU oracle transcribe: ${ids.length} tokens in ${(ms / 1000).toFixed(0)}s`);
console.log("ids:", JSON.stringify(ids));
console.log("text:", text);
