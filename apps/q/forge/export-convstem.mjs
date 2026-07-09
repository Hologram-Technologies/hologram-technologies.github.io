// export-convstem.mjs — dump the Whisper conv-stem weights (dequantized f32) for the GPU witness.
// Pairs with gpu/whisper-enc-ref.{mel,stem}.f32 (gen-whisper-encoder-ref.mjs): the harness feeds the mel,
// runs conv1d×2 + bias + GELU + transpose + pos-add on GPU, and scores vs the golden stem.
//   node export-convstem.mjs [model.bin]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { forgeWhisper } from "./gguf-forge-whisper.mjs";
import { loadByKappa } from "./gguf-forge.mjs";
import { dequantizeExact } from "./gguf-forge-dequant.mjs";

const MODEL = process.argv[2] || "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/ggml-base.bin";
const forged = forgeWhisper(new Uint8Array(readFileSync(MODEL)));
const { plan, blocks } = forged, store = { get: (h) => blocks.get(h) };
const tF32 = (name) => { const t = plan.tensors.find((x) => x.name === name); if (!t) throw new Error("no " + name); return { v: dequantizeExact(t.type, loadByKappa(store, t.kappa), t.dims.reduce((a, b) => a * b, 1)), dims: t.dims }; };

mkdirSync("./gpu", { recursive: true });
const f32 = (a) => Buffer.from(Float32Array.from(a).buffer);
const out = { S: plan.hparams.n_audio_state, n_mels: plan.hparams.n_mels, dims: {} };
const map = { conv1_w: "encoder.conv1.weight", conv1_b: "encoder.conv1.bias", conv2_w: "encoder.conv2.weight", conv2_b: "encoder.conv2.bias", pos: "encoder.positional_embedding" };
for (const [key, name] of Object.entries(map)) {
  const { v, dims } = tF32(name);
  writeFileSync(`./gpu/wstem.${key}.f32`, f32(v));
  out.dims[key] = dims;
  console.log(`${key.padEnd(8)} ${name}  ne=${JSON.stringify(dims)}  ${v.length} f32`);
}
writeFileSync("./gpu/wstem.json", JSON.stringify(out, null, 1));
console.log("→ gpu/wstem.*.f32 + wstem.json");
