// Oracle for the FULL GPU attention pass with TBQ KV + QJL correction. Forge a tiny llama
// model, run the CPU executor with a TBQ4_0 K cache (QJL ON — the live loop), export weights
// + the raw TBQ K κ-blocks (with qjl/d_r) + f32 V + stage-1 rotation signs + QJL sketch signs
// + oracle logits. The GPU page decodes K, computes per-head projRq (forward-rotate then QJL-
// project), adds the QJL correction to each attention score, and must reproduce these logits.
import { writeFileSync } from "node:fs";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";
import { KvMemory } from "./gguf-forge-kvmem.mjs";
import { rotationSigns, qjlSketchSigns, TQ_TYPES } from "./gguf-forge-turboquant.mjs";

const D = 256, NH = 2, NHKV = 1, HD = 128, FF = 256, V = 16, NL = 1, EPS = 1e-5, FREQ = 10000;
const TYPE = 43, t = TQ_TYPES[TYPE], BD = t.d, BTOTAL = t.total;       // TBQ4_0 d=128, 84 B
const QD = NH * HD, KVDIM = NHKV * HD;
let s = 0x71c7 >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
const rf = (n, sc = 0.08) => Float32Array.from({ length: n }, () => r() * sc);
const nf = (n) => Float32Array.from({ length: n }, () => Math.abs(r()) + 0.5);

const wq = rf(QD * D); const wk = new Float32Array(KVDIM * D); for (let i = 0; i < KVDIM * D; i++) wk[i] = wq[i]; // Q–K correlated (QJL regime)
const W = {
  "token_embd.weight": rf(V * D, 0.3), "output_norm.weight": nf(D),
  "blk.0.attn_norm.weight": nf(D), "blk.0.ffn_norm.weight": nf(D),
  "blk.0.attn_q.weight": wq, "blk.0.attn_k.weight": wk, "blk.0.attn_v.weight": rf(KVDIM * D), "blk.0.attn_output.weight": rf(D * QD),
  "blk.0.ffn_gate.weight": rf(FF * D), "blk.0.ffn_up.weight": rf(FF * D), "blk.0.ffn_down.weight": rf(D * FF),
};
const dimsFor = (n) => n === "token_embd.weight" ? [D, V] : /attn_q\.weight$/.test(n) ? [D, QD] : /attn_(k|v)\.weight$/.test(n) ? [D, KVDIM] : /attn_output\.weight$/.test(n) ? [QD, D] : /ffn_(gate|up)\.weight$/.test(n) ? [D, FF] : /ffn_down\.weight$/.test(n) ? [FF, D] : [D];
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
const f = forgeGguf(buildGguf(meta, Object.entries(W).map(([name, arr]) => ({ name, type: GGML.F32, dims: dimsFor(name), bytes: f32b(arr) }))));
const graph = synthesizeGraph(f.plan);
const tokens = [3, 1, 4, 2, 0, 2], T = tokens.length;
const kv = new KvMemory({ typeK: TYPE, typeV: 0, nLayer: NL });        // TBQ K (QJL on by default), f32 V
const logits = forward(f.plan, graph, { get: (h) => f.blocks.get(h) }, tokens, { memory: kv });

const Kblocks = [], Vf32 = [];
for (let pos = 0; pos < T; pos++) {
  Kblocks.push(Array.from(kv.load(kv.refsK[0][pos])));                  // raw TBQ block (qs+d+qjl+d_r)
  Vf32.push(Array.from(new Float32Array(kv.load(kv.refsV[0][pos]).buffer.slice(0)))); // f32 V vector
}
const order = Object.keys(W); let total = 0; const layout = {};
for (const n of order) { layout[n] = { off: total, len: W[n].length }; total += W[n].length; }
const bin = new Float32Array(total); for (const n of order) bin.set(W[n], layout[n].off);
writeFileSync(new URL("./gpu/_turboattnqjl.bin", import.meta.url), Buffer.from(bin.buffer));
writeFileSync(new URL("./gpu/_turboattnqjl.json", import.meta.url), JSON.stringify({
  cfg: { D, NH, NHKV, HD, FF, V, QD, KVDIM, EPS, FREQ, BD, BTOTAL, idx: t.idx, qjlBytes: t.qjl, scale: 1 / Math.sqrt(HD), grp: NH / NHKV, T, qjlScale: Math.sqrt(1.5707963) / BD },
  tokens, layout, signs: Array.from(rotationSigns(BD)), qjlSigns: Array.from(qjlSketchSigns(BD)), Kblocks, Vf32, expected: Array.from(logits),
}));
console.log(`wrote gpu/_turboattnqjl.{bin,json}: TBQ4_0 K + QJL, ${T} pos, oracle argmax=${logits.indexOf(Math.max(...logits))}`);
