// Oracle exporter for the BitNet GPU forward witness. Builds a tiny BitNet model (F32
// weights, the same arch gguf-forge-graph/exec run), forges → synthesizes → runs the CPU
// executor (the witnessed Tier-A oracle), and exports weights (flat bin + layout) + the
// last-position logits. The GPU page must reproduce those logits. F32 weights isolate the
// ARCH orchestration (2 sub-norms); the TQ2_0 GEMV is witnessed separately (bitnet-gemv).
import { writeFileSync } from "node:fs";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";

const D = 8, NH = 2, NHKV = 2, HD = 4, FF = 16, V = 6, NL = 1, EPS = 1e-5, FREQ = 10000;
const QD = NH * HD, KV = NHKV * HD;
let s = 20260620 >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
const rf = (n, sc = 0.3) => Float32Array.from({ length: n }, () => r() * sc);
const nf = (n) => Float32Array.from({ length: n }, () => Math.abs(r()) + 0.5);

const W = {
  "token_embd.weight": rf(V * D, 0.5), "output_norm.weight": nf(D),
};
for (let il = 0; il < NL; il++) { const p = `blk.${il}.`; Object.assign(W, {
  [p + "attn_norm.weight"]: nf(D), [p + "attn_sub_norm.weight"]: nf(D),
  [p + "attn_q.weight"]: rf(QD * D), [p + "attn_k.weight"]: rf(KV * D), [p + "attn_v.weight"]: rf(KV * D), [p + "attn_output.weight"]: rf(D * QD),
  [p + "ffn_norm.weight"]: nf(D), [p + "ffn_sub_norm.weight"]: nf(FF),
  [p + "ffn_gate.weight"]: rf(FF * D), [p + "ffn_up.weight"]: rf(FF * D), [p + "ffn_down.weight"]: rf(D * FF),
}); }

// build a GGUF, forge, synthesize, run CPU oracle
function buildGguf(meta, tensors) {
  const ALIGN = 32; let off = 0;
  const infos = tensors.map((t) => { const o = off; off = Math.ceil((o + t.bytes.length) / ALIGN) * ALIGN; return { ...t, offset: o }; });
  let parts = [], len = 0; const push = (b) => { parts.push(b); len += b.length; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); push(b); };
  const f32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); push(b); };
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
// explicit [in, out] dims per tensor (by-length collides: ffn_gate [D,FF] vs ffn_down [FF,D])
const dimsFor = (name) => {
  if (name === "token_embd.weight") return [D, V];
  if (/attn_q\.weight$/.test(name)) return [D, QD];
  if (/attn_(k|v)\.weight$/.test(name)) return [D, KV];
  if (/attn_output\.weight$/.test(name)) return [QD, D];
  if (/ffn_gate\.weight$|ffn_up\.weight$/.test(name)) return [D, FF];
  if (/ffn_down\.weight$/.test(name)) return [FF, D];
  if (/ffn_sub_norm\.weight$/.test(name)) return [FF];
  return [D]; // attn_norm, attn_sub_norm, ffn_norm, output_norm
};
const meta = { "general.architecture": "bitnet", "bitnet.block_count": NL, "bitnet.embedding_length": D, "bitnet.attention.head_count": NH, "bitnet.attention.head_count_kv": NHKV, "bitnet.feed_forward_length": FF, "bitnet.rope.dimension_count": HD, "bitnet.rope.freq_base": FREQ, "bitnet.attention.layer_norm_rms_epsilon": EPS };
const tensors = Object.entries(W).map(([name, arr]) => ({ name, type: GGML.F32, dims: dimsFor(name), bytes: f32b(arr) }));
const f = forgeGguf(buildGguf(meta, tensors));
const graph = synthesizeGraph(f.plan);
if (graph.family !== "dense" || !graph.stats.bitnet) throw new Error("not a bitnet graph: " + graph.reason);
const tokens = [3, 1, 4, 2];
const logits = forward(f.plan, graph, { get: (h) => f.blocks.get(h) }, tokens);

// export flat weight bin + layout
const order = Object.keys(W); let total = 0; const layout = {};
for (const n of order) { layout[n] = { off: total, len: W[n].length }; total += W[n].length; }
const bin = new Float32Array(total); for (const n of order) bin.set(W[n], layout[n].off);
writeFileSync(new URL("./gpu/_bitfwd.bin", import.meta.url), Buffer.from(bin.buffer));
writeFileSync(new URL("./gpu/_bitfwd.json", import.meta.url), JSON.stringify({
  cfg: { D, NH, NHKV, HD, FF, V, NL, QD, KV, EPS, FREQ, scale: 1 / Math.sqrt(HD), grp: NH / NHKV }, tokens, layout, expected: Array.from(logits),
}));
console.log(`wrote gpu/_bitfwd.{bin,json}: bitnet ${NL}L D${D} → ${V} logits, oracle argmax=${logits.indexOf(Math.max(...logits))}`);
