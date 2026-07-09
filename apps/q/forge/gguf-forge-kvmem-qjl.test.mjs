// S3 integration witness: QJL wired into the LIVE attention loop. Run a real forward with a
// TBQ3_0 K cache, with the QJL score-correction ON vs OFF, and vs the full-precision (f32)
// KV reference. QJL is an unbiased estimator of the stage-1-dropped <q,k> — so the corrected
// logits must be CLOSER to the f32 reference than the uncorrected (decode-only) logits. V is
// f32 here to isolate the K-score correction. wk is correlated with wq (real attention has
// Q–K correlation — the regime where QJL matters; with independent Q⊥K there is no bias).
import assert from "node:assert";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";
import { KvMemory } from "./gguf-forge-kvmem.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
const L2 = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); };

const D = 256, NH = 2, NHKV = 1, HD = 128, FF = 256, V = 16, NL = 1, EPS = 1e-5, FREQ = 10000;
const QD = NH * HD, KVDIM = NHKV * HD;
let s = 0x4242 >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
const rf = (n, sc = 0.08) => Float32Array.from({ length: n }, () => r() * sc);
const nf = (n) => Float32Array.from({ length: n }, () => Math.abs(r()) + 0.5);

const wq = rf(QD * D);
const wk = new Float32Array(KVDIM * D); for (let i = 0; i < KVDIM * D; i++) wk[i] = wq[i]; // wk = wq's first KVDIM rows → K correlates with Q
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
const store = { get: (h) => f.blocks.get(h) };
const tokens = [3, 1, 4, 2, 0, 2];

const refLogits = Array.from(forward(f.plan, graph, store, tokens));                 // f32 KV (no memory)
const kvOff = new KvMemory({ typeK: 42, typeV: 0, nLayer: NL }); kvOff.qjl = false;   // TBQ K, correction OFF
const offLogits = Array.from(forward(f.plan, graph, store, tokens, { memory: kvOff }));
const kvOn = new KvMemory({ typeK: 42, typeV: 0, nLayer: NL });                        // TBQ K, correction ON (default)
const onLogits = Array.from(forward(f.plan, graph, store, tokens, { memory: kvOn }));

ok(kvOn.qjlActive() && !kvOff.qjlActive(), `qjlActive() gates on TBQ + this.qjl flag`);
ok(L2(onLogits, offLogits) > 1e-6, `QJL correction changes the forward (on ≠ off)`);
const dOff = L2(offLogits, refLogits), dOn = L2(onLogits, refLogits);
ok(dOn < dOff, `QJL-corrected logits closer to f32-KV reference: ‖off−ref‖=${dOff.toFixed(4)} → ‖on−ref‖=${dOn.toFixed(4)} (${(dOff / dOn).toFixed(2)}×)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
