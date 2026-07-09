// gen-whisper-decoder-ref.mjs — W-2 golden: run the CPU-oracle decoder (whisper-cli-exact) over the
// standard prompt against the golden encoder output, export last-position logits + the argmax. The GPU
// decoder must match argmax (the decoded token) + logit cosine.
//   node gen-whisper-decoder-ref.mjs [model.bin]
import { readFileSync, writeFileSync } from "node:fs";
import { forgeWhisper, whisperDecoder, whisperSpecials } from "./gguf-forge-whisper.mjs";

const MODEL = process.argv[2] || "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/ggml-base.bin";
const forged = forgeWhisper(new Uint8Array(readFileSync(MODEL)));
const { plan, blocks } = forged, store = { get: (h) => blocks.get(h) };
const S = plan.hparams.n_text_state, NV = plan.hparams.n_vocab;

const eb = readFileSync("./gpu/whisper-enc-ref.enc.f32");
const enc = new Float32Array(eb.buffer, eb.byteOffset, eb.byteLength / 4);   // [n_enc, S]
const n_enc = enc.length / S;

const W = whisperSpecials(NV);
const prompt = [W.SOT, W.LANG_EN, W.TRANSCRIBE, W.NO_TIMESTAMPS];
const t0 = Date.now();
const logits = whisperDecoder(plan, store, prompt, enc, n_enc);
let best = -1, bv = -Infinity;
for (let tk = 0; tk < NV; tk++) { if (tk > 50256 && tk !== W.EOT) continue; if (logits[tk] > bv) { bv = logits[tk]; best = tk; } }   // text tokens + EOT only

writeFileSync("./gpu/whisper-dec-ref.logits.f32", Buffer.from(Float32Array.from(logits).buffer));
const man = { model: MODEL.split(/[\\/]/).pop(), prompt, argmax: best, argval: +bv.toFixed(4), n_vocab: NV, n_enc,
  n_text_state: S, n_text_head: plan.hparams.n_text_head, n_text_layer: plan.hparams.n_text_layer, n_text_ctx: plan.hparams.n_text_ctx,
  EOT: W.EOT, logitsSample: [...logits.slice(0, 4)].map((v) => +v.toFixed(4)), sec: +((Date.now() - t0) / 1000).toFixed(0) };
writeFileSync("./gpu/whisper-dec-ref.json", JSON.stringify(man, null, 2));
console.log(`prompt ${JSON.stringify(prompt)} (n_enc=${n_enc}, ${plan.hparams.n_text_layer} dec layers)`);
console.log(`→ argmax ${best} (val ${bv.toFixed(3)}), ${man.sec}s  ·  golden → gpu/whisper-dec-ref.*`);
