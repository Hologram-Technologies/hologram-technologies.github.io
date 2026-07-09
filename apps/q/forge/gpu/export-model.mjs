// Export the full Qwen2.5-0.5B as a GPU-ready weight pack for the in-browser runtime.
// Weights are unpacked from the forge κ-blocks: Q5_0/Q8_0/Q4_0 -> compact {f32 scale
// per-32, int8 quant} (the proven GEMV rep); Q6_K/Q4_K/F32 -> f32. Also exports the
// prompt token embeddings, hparams, the forge rootKappa, and the CPU-oracle argmax —
// so the browser run can be witnessed against upstream (llama.cpp says " Paris").

import { writeFileSync, readFileSync } from "node:fs";
import { forgeGguf, ggmlNBytes } from "../gguf-forge.mjs";
import { dequantizeExact, GGML } from "../gguf-forge-dequant.mjs";
import { f16ToF32 } from "../../qvac-ingest.mjs";
import { synthesizeGraph } from "../gguf-forge-graph.mjs";
import { forward } from "../gguf-forge-exec.mjs";
import { makeTokenizer } from "../gguf-forge-tokenizer.mjs";

const MODEL = "../.models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
const buf = new Uint8Array(readFileSync(new URL(MODEL, import.meta.url)));
const f = forgeGguf(buf);
const graph = synthesizeGraph(f.plan);
const S = graph.stats;
const tdir = {}; for (const t of f.tensors) tdir[t.name] = t;

const PROMPT = "The capital of France is";
const tok = makeTokenizer(buf);
const tokens = tok.encode(PROMPT, { addSpecial: false });

// CPU oracle argmax (the witness target)
const store = { get: (h) => f.blocks.get(h) };
const logits = forward(f.plan, graph, store, tokens);
let oracleArgmax = 0; for (let i = 1; i < logits.length; i++) if (logits[i] > logits[oracleArgmax]) oracleArgmax = i;

// ── per-tensor raw bytes from the forge κ-block ──
const rawOf = (name) => { const t = tdir[name]; return store.get(t.kappa.split(":").pop()); };
const Q_TYPES = new Set([GGML.Q5_0, GGML.Q8_0, GGML.Q4_0]);

// unpack a per-32 {scale,int8} weight (Q5_0/Q8_0/Q4_0)
function unpackQ(raw, type, N, K) {
  const nb = K / 32, scales = new Float32Array(N * nb), quants = new Int8Array(N * K);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const bsz = type === GGML.Q5_0 ? 22 : type === GGML.Q8_0 ? 34 : 18;
  for (let row = 0; row < N; row++) for (let b = 0; b < nb; b++) {
    const bp = (row * nb + b) * bsz, so = row * nb + b, qo = row * K + b * 32;
    scales[so] = f16ToF32(dv.getUint16(bp, true));
    if (type === GGML.Q8_0) { for (let j = 0; j < 32; j++) quants[qo + j] = (raw[bp + 2 + j] << 24) >> 24; }
    else if (type === GGML.Q4_0) { const q = bp + 2; for (let j = 0; j < 16; j++) { quants[qo + j] = (raw[q + j] & 0xf) - 8; quants[qo + 16 + j] = (raw[q + j] >> 4) - 8; } }
    else { const q = bp + 6, qh = dv.getUint32(bp + 2, true); for (let j = 0; j < 16; j++) { const xh0 = ((qh & (1 << j)) >>> j) << 4, xh1 = (qh & (1 << (j + 16))) >>> (j + 12); quants[qo + j] = ((raw[q + j] & 0xf) | xh0) - 16; quants[qo + 16 + j] = ((raw[q + j] >> 4) | xh1) - 16; } }
  }
  return { scales, quants };
}

const f32parts = [], i8parts = [];
let f32off = 0, i8off = 0;
const meta = { rootKappa: f.rootKappa, oracleArgmax, prompt: PROMPT, tokens, ...S, tensors: {} };
function addWeight(key, name) {
  const t = tdir[name], N = t.dims.length > 1 ? t.dims[1] : 1, K = t.dims[0];
  const raw = rawOf(name);
  if (Q_TYPES.has(t.type)) {
    const { scales, quants } = unpackQ(raw, t.type, N, K);
    meta.tensors[key] = { kind: "q", N, K, sOff: f32off, sLen: scales.length, qOff: i8off, qLen: quants.length };
    f32parts.push(scales); f32off += scales.length; i8parts.push(quants); i8off += quants.length;
  } else { // Q6_K / Q4_K / F32 -> f32
    const d = dequantizeExact(t.type, raw, N * K);
    meta.tensors[key] = { kind: "f32", N, K, fOff: f32off, fLen: d.length };
    f32parts.push(Float32Array.from(d)); f32off += d.length;
  }
}

for (let i = 0; i < S.n_layer; i++) {
  const p = `blk.${i}.`;
  addWeight(`l${i}.attn_norm`, p + "attn_norm.weight");
  addWeight(`l${i}.wq`, p + "attn_q.weight"); addWeight(`l${i}.bq`, p + "attn_q.bias");
  addWeight(`l${i}.wk`, p + "attn_k.weight"); addWeight(`l${i}.bk`, p + "attn_k.bias");
  addWeight(`l${i}.wv`, p + "attn_v.weight"); addWeight(`l${i}.bv`, p + "attn_v.bias");
  addWeight(`l${i}.wo`, p + "attn_output.weight");
  addWeight(`l${i}.ffn_norm`, p + "ffn_norm.weight");
  addWeight(`l${i}.gate`, p + "ffn_gate.weight"); addWeight(`l${i}.up`, p + "ffn_up.weight"); addWeight(`l${i}.down`, p + "ffn_down.weight");
}
addWeight("final_norm", "output_norm.weight");
addWeight("lm_head", tdir["output.weight"] ? "output.weight" : "token_embd.weight");

// prompt embeddings (dequant token_embd rows on CPU)
const te = tdir["token_embd.weight"], teRaw = rawOf("token_embd.weight"), D = S.n_embd;
const teAll = dequantizeExact(te.type, teRaw, te.dims[0] * te.dims[1]);
meta.embeds = [];
for (const t of tokens) { const row = teAll.subarray(t * D, t * D + D); meta.embeds.push({ off: f32off, len: D }); f32parts.push(Float32Array.from(row)); f32off += D; }

const f32flat = new Float32Array(f32off); { let o = 0; for (const p of f32parts) { f32flat.set(p, o); o += p.length; } }
const i8flat = new Int8Array(i8off); { let o = 0; for (const p of i8parts) { i8flat.set(p, o); o += p.length; } }
writeFileSync(new URL("./model-f32.bin", import.meta.url), Buffer.from(f32flat.buffer));
writeFileSync(new URL("./model-i8.bin", import.meta.url), Buffer.from(i8flat.buffer));
writeFileSync(new URL("./model-pack.json", import.meta.url), JSON.stringify(meta));
console.log(`pack: f32 ${(f32flat.byteLength / 1e6).toFixed(0)}MB + i8 ${(i8flat.byteLength / 1e6).toFixed(0)}MB`);
console.log(`tokens [${tokens}] = ${JSON.stringify(tokens.map((t) => tok.tokens[t]).join("|"))}`);
console.log(`oracle argmax = ${oracleArgmax} ${JSON.stringify(tok.decode([oracleArgmax]))}, rootKappa ${f.rootKappa.slice(0, 40)}…`);
