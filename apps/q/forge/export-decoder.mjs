// export-decoder.mjs — pack the Whisper decoder weights (dequant f32) for the GPU decoder witness.
// One blob (decoder-weights.f32) + manifest. Includes token_embedding (tied lm_head) + positional.
//   node export-decoder.mjs [model.bin]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { forgeWhisper } from "./gguf-forge-whisper.mjs";
import { loadByKappa } from "./gguf-forge.mjs";
import { dequantizeExact } from "./gguf-forge-dequant.mjs";

const MODEL = process.argv[2] || "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/ggml-base.bin";
const forged = forgeWhisper(new Uint8Array(readFileSync(MODEL)));
const { plan, blocks } = forged, store = { get: (h) => blocks.get(h) };
const tF32 = (name) => { const t = plan.tensors.find((x) => x.name === name); if (!t) throw new Error("no " + name); return dequantizeExact(t.type, loadByKappa(store, t.kappa), t.dims.reduce((a, b) => a * b, 1)); };
const NL = plan.hparams.n_text_layer;

const PER = ["attn_ln.weight", "attn_ln.bias", "attn.query.weight", "attn.query.bias", "attn.key.weight",
  "attn.value.weight", "attn.value.bias", "attn.out.weight", "attn.out.bias",
  "cross_attn_ln.weight", "cross_attn_ln.bias", "cross_attn.query.weight", "cross_attn.query.bias", "cross_attn.key.weight",
  "cross_attn.value.weight", "cross_attn.value.bias", "cross_attn.out.weight", "cross_attn.out.bias",
  "mlp_ln.weight", "mlp_ln.bias", "mlp.0.weight", "mlp.0.bias", "mlp.2.weight", "mlp.2.bias"];
const names = [];
for (let il = 0; il < NL; il++) for (const n of PER) names.push(`decoder.blocks.${il}.${n}`);
names.push("decoder.ln.weight", "decoder.ln.bias", "decoder.token_embedding.weight", "decoder.positional_embedding");

const man = { S: plan.hparams.n_text_state, H: plan.hparams.n_text_head, NL, n_vocab: plan.hparams.n_vocab, eps: 1e-5, tensors: {} };
let total = 0; const arrs = [];
for (const name of names) { const v = tF32(name); man.tensors[name] = { off: total, len: v.length }; total += v.length; arrs.push(v); }
const packed = new Float32Array(total); let o = 0; for (const a of arrs) { packed.set(a, o); o += a.length; }

mkdirSync("./gpu", { recursive: true });
writeFileSync("./gpu/decoder-weights.f32", Buffer.from(packed.buffer));
writeFileSync("./gpu/decoder-weights.json", JSON.stringify(man));
console.log(`packed ${names.length} tensors, ${total} f32 (${(total * 4 / 1e6).toFixed(0)}MB), ${NL} layers, S=${man.S} H=${man.H} vocab=${man.n_vocab}`);
