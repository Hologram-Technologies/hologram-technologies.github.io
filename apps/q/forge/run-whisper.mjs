// Holo Whisper end-to-end harness: forge ggml-small.bin → transcribe jo16.wav →
// compare to the whisper-cli oracle. Heavy pure-JS (full 1500-pos encoder + decode).
import { readFileSync } from "node:fs";
import { forgeWhisper, whisperTranscribe } from "./gguf-forge-whisper.mjs";

const MODEL = "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/ggml-small.bin";
const WAV = "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/jo16.wav";

const t0 = Date.now();
const modelBytes = new Uint8Array(readFileSync(MODEL));
const forged = forgeWhisper(modelBytes);
console.log(`forged ${forged.tensors.length} tensors, root ${forged.rootKappa.slice(0, 28)}… (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

const wav = new Uint8Array(readFileSync(WAV));
const t1 = Date.now();
const { text, ids } = whisperTranscribe(forged, modelBytes, wav, { maxNew: 80 });
console.log(`\nTRANSCRIPTION (${ids.length} tokens, ${((Date.now() - t1) / 1000).toFixed(0)}s):`);
console.log(text);
console.log(`\nORACLE (whisper-cli): "So I just tried Nophonic and I'm genuinely impressed. It's super responsive..."`);
