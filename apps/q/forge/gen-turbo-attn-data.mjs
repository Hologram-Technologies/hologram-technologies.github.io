// S1 oracle for the TurboQuant-cached attention witness. Forge a tiny llama-shaped dense
// model, run the CPU executor with a PQ4_0 KV cache (KvMemory), and export: f32 weights
// (flat bin + per-NAME layout), the stored TurboQuant K/V κ-blocks per (layer,pos), the
// rotation signs, tokens, cfg, and the oracle last-position logits. The GPU page decodes
// the κ-blocks (turbo-kv kernel) into a resident f32 KV cache and runs attention → must
// reproduce these logits (Tier-B: cosine + argmax). HD=128 → PQ4_0 (d=128), 1 block/vec.
import { writeFileSync } from "node:fs";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";
import { KvMemory } from "./gguf-forge-kvmem.mjs";
import { rotationSigns, TQ_TYPES } from "./gguf-forge-turboquant.mjs";

const D = 256, NH = 2, NHKV = 1, HD = 128, FF = 512, V = 16, NL = 1, EPS = 1e-5, FREQ = 10000;
const TYPE = 48, BD = TQ_TYPES[TYPE].d, BTOTAL = TQ_TYPES[TYPE].total;   // PQ4_0 d=128, 66 B
const QD = NH * HD, KVDIM = NHKV * HD;                                   // 256, 128
let s = 31337 >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
const rf = (n, sc = 0.08) => Float32Array.from({ length: n }, () => r() * sc);
const nf = (n) => Float32Array.from({ length: n }, () => Math.abs(r()) + 0.5);

const W = { "token_embd.weight": rf(V * D, 0.3), "output_norm.weight": nf(D) };
for (let il = 0; il < NL; il++) { const p = `blk.${il}.`; Object.assign(W, {
  [p + "attn_norm.weight"]: nf(D), [p + "ffn_norm.weight"]: nf(D),
  [p + "attn_q.weight"]: rf(QD * D), [p + "attn_k.weight"]: rf(KVDIM * D), [p + "attn_v.weight"]: rf(KVDIM * D), [p + "attn_output.weight"]: rf(D * QD),
  [p + "ffn_gate.weight"]: rf(FF * D), [p + "ffn_up.weight"]: rf(FF * D), [p + "ffn_down.weight"]: rf(D * FF),
}); }
const dimsFor = (name) => {            // [in, out]; assign by NAME (by-length collides)
  if (name === "token_embd.weight") return [D, V];
  if (/attn_q\.weight$/.test(name)) return [D, QD];
  if (/attn_(k|v)\.weight$/.test(name)) return [D, KVDIM];
  if (/attn_output\.weight$/.test(name)) return [QD, D];
  if (/ffn_(gate|up)\.weight$/.test(name)) return [D, FF];
  if (/ffn_down\.weight$/.test(name)) return [FF, D];
  return [D];
};

function buildGguf(meta, tensors) {
  const ALIGN = 32; let off = 0;
  const infos = tensors.map((t) => { const o = off; off = Math.ceil((o + t.bytes.length) / ALIGN) * ALIGN; return { ...t, offset: o }; });
  let parts = [], len = 0; const push = (b) => { parts.push(b); len += b.length; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); push(b); };
  const u64 = (v) => { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, v >>> 0, true); dv.setUint32(4, Math.floor(v / 4294967296), true); push(b); };
  const str = (x) => { const e = new TextEncoder().encode(x); u64(e.length); push(e); };
  push(new TextEncoder().encode("GGUF")); u32(3); u64(tensors.length); u64(Object.keys(meta).length);
  for (const [k, val] of Object.entries(meta)) { str(k); if (typeof val === "string") { u32(8); str(val); } else { u32(4); u32(val); } }
  for (const ti of infos) { str(ti.name); u32(ti.dims.length); for (const d of ti.dims) u64(d); u32(ti.type); u64(ti.offset); }
  if (len % ALIGN) push(new Uint8Array(ALIGN - (len % ALIGN)));
  const dataStart = len; for (const ti of infos) { while (len < dataStart + ti.offset) push(new Uint8Array(1)); push(ti.bytes); }
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
const f32b = (a) => new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
const meta = { "general.architecture": "llama", "llama.block_count": NL, "llama.embedding_length": D, "llama.attention.head_count": NH, "llama.attention.head_count_kv": NHKV, "llama.feed_forward_length": FF, "llama.rope.dimension_count": HD, "llama.rope.freq_base": FREQ, "llama.attention.layer_norm_rms_epsilon": EPS };
const tensors = Object.entries(W).map(([name, arr]) => ({ name, type: GGML.F32, dims: dimsFor(name), bytes: f32b(arr) }));
const f = forgeGguf(buildGguf(meta, tensors));
const graph = synthesizeGraph(f.plan);
if (graph.family !== "dense") throw new Error("not dense: " + graph.reason);

const tokens = [3, 1, 4, 2], T = tokens.length;
const kv = new KvMemory({ typeK: TYPE, typeV: TYPE, nLayer: NL });
const logits = forward(f.plan, graph, { get: (h) => f.blocks.get(h) }, tokens, { memory: kv });

// extract the stored K/V κ-blocks per (layer,pos) — the EXACT bytes KvMemory cached
const Kblocks = [], Vblocks = [];
for (let il = 0; il < NL; il++) for (let pos = 0; pos < T; pos++) {
  Kblocks.push(Array.from(kv.load(kv.refsK[il][pos])));
  Vblocks.push(Array.from(kv.load(kv.refsV[il][pos])));
}
// flat weight bin + layout
const order = Object.keys(W); let total = 0; const layout = {};
for (const n of order) { layout[n] = { off: total, len: W[n].length }; total += W[n].length; }
const bin = new Float32Array(total); for (const n of order) bin.set(W[n], layout[n].off);
writeFileSync(new URL("./gpu/_turboattn.bin", import.meta.url), Buffer.from(bin.buffer));
writeFileSync(new URL("./gpu/_turboattn.json", import.meta.url), JSON.stringify({
  cfg: { D, NH, NHKV, HD, FF, V, NL, QD, KVDIM, EPS, FREQ, TYPE, BD, BTOTAL, blocksPerVec: KVDIM / BD, scale: 1 / Math.sqrt(HD), grp: NH / NHKV, T },
  tokens, layout, signs: Array.from(rotationSigns(BD)), Kblocks, Vblocks, expected: Array.from(logits),
}));
console.log(`wrote gpu/_turboattn.{bin,json}: llama D${D} NH${NH}/${NHKV} HD${HD}, PQ4_0 KV, ${T} pos, oracle argmax=${logits.indexOf(Math.max(...logits))}`);
