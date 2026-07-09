// export-encoder.mjs — pack the Whisper encoder-block weights (dequant f32) for the GPU encoder witness.
// One blob (encoder-weights.f32) + manifest (name→{off,len}) for the first `NL` blocks + ln_post.
//   node export-encoder.mjs [model.bin] [NL]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { forgeWhisper } from "./gguf-forge-whisper.mjs";
import { loadByKappa } from "./gguf-forge.mjs";
import { dequantizeExact } from "./gguf-forge-dequant.mjs";

const MODEL = process.argv[2] || "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/ggml-base.bin";
const NL = process.argv[3] ? +process.argv[3] : 2;
const forged = forgeWhisper(new Uint8Array(readFileSync(MODEL)));
const { plan, blocks } = forged, store = { get: (h) => blocks.get(h) };
const tF32 = (name) => { const t = plan.tensors.find((x) => x.name === name); if (!t) throw new Error("no " + name); return dequantizeExact(t.type, loadByKappa(store, t.kappa), t.dims.reduce((a, b) => a * b, 1)); };

const PER = ["attn_ln.weight", "attn_ln.bias", "attn.query.weight", "attn.query.bias", "attn.key.weight",
  "attn.value.weight", "attn.value.bias", "attn.out.weight", "attn.out.bias",
  "mlp_ln.weight", "mlp_ln.bias", "mlp.0.weight", "mlp.0.bias", "mlp.2.weight", "mlp.2.bias"];
const names = [];
for (let il = 0; il < NL; il++) for (const n of PER) names.push(`encoder.blocks.${il}.${n}`);
names.push("encoder.ln_post.weight", "encoder.ln_post.bias");

const man = { S: plan.hparams.n_audio_state, H: plan.hparams.n_audio_head, NL, eps: 1e-5, tensors: {} };
let total = 0; const arrs = [];
for (const name of names) { const v = tF32(name); man.tensors[name] = { off: total, len: v.length }; total += v.length; arrs.push(v); }
const packed = new Float32Array(total); let o = 0; for (const a of arrs) { packed.set(a, o); o += a.length; }

mkdirSync("./gpu", { recursive: true });
writeFileSync("./gpu/encoder-weights.f32", Buffer.from(packed.buffer));
writeFileSync("./gpu/encoder-weights.json", JSON.stringify(man));
console.log(`packed ${names.length} tensors, ${total} f32 (${(total * 4 / 1e6).toFixed(1)}MB), ${NL} layers, S=${man.S} H=${man.H} hd=${man.S / man.H}`);
