// Sparse expert streaming witness (S2 sparsity + S3 fidelity).
// Forge a runnable MoE, build the per-expert κ directory, then run a real forward
// twice: WHOLE-STACK load vs per-expert SPARSE load. Prove (S2) the sparse run fetches
// EXACTLY the router-selected experts' κ-blocks (never the whole stack, never an
// unrouted expert) and (S3) its logits are BIT-IDENTICAL to the whole-stack run —
// i.e. sparse fetch is pure data-plane memoization, not a behavior change.

import assert from "node:assert";
import { forgeGguf, mapStore, loadByKappa } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";
import { buildExpertDirectory, expertKappa } from "./gguf-forge-expert-dir.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

const D = 8, NH = 2, NHKV = 1, HD = 4, FF = 6, VOCAB = 5, E = 4, USED = 2, EPS = 1e-6, FREQ = 10000;
const QD = NH * HD, KV = NHKV * HD;
const hexOf = (k) => String(k).split(":").pop();
function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const randF = (r, n, scale = 0.3) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * scale; return a; };
const f32bytes = (arr) => new Uint8Array(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength));

function buildGguf(meta, tensors) {
  const ALIGN = 32; let off = 0;
  const infos = tensors.map((tn) => { const o = off; off = Math.ceil((o + tn.bytes.length) / ALIGN) * ALIGN; return { ...tn, offset: o }; });
  let parts = [], len = 0; const push = (b) => { parts.push(b); len += b.length; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); push(b); };
  const f32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); push(b); };
  const u64 = (v) => { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, v >>> 0, true); dv.setUint32(4, Math.floor(v / 4294967296), true); push(b); };
  const str = (s) => { const e = new TextEncoder().encode(s); u64(e.length); push(e); };
  push(new TextEncoder().encode("GGUF")); u32(3); u64(tensors.length); u64(Object.keys(meta).length);
  for (const [k, val] of Object.entries(meta)) { str(k); if (typeof val === "string") { u32(8); str(val); } else if (Number.isInteger(val) && val >= 0 && val < 4294967296) { u32(4); u32(val); } else { u32(6); f32(val); } }
  for (const ti of infos) { str(ti.name); u32(ti.dims.length); for (const d of ti.dims) u64(d); u32(ti.type); u64(ti.offset); }
  if (len % ALIGN) push(new Uint8Array(ALIGN - (len % ALIGN)));
  const dataStart = len;
  for (const ti of infos) { while (len < dataStart + ti.offset) push(new Uint8Array(1)); push(ti.bytes); }
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}

// Mixtral dialect: arch "llama" + experts, no shared expert, norm_w=true.
function forgeMoe() {
  const r = prng(7);
  const w = {
    tok_embd: randF(r, VOCAB * D), output_norm: randF(r, D).map((x) => Math.abs(x) + 0.5), output: randF(r, VOCAB * D),
    attn_norm: randF(r, D).map((x) => Math.abs(x) + 0.5), ffn_norm: randF(r, D).map((x) => Math.abs(x) + 0.5),
    wq: randF(r, QD * D), wk: randF(r, KV * D), wv: randF(r, KV * D), wo: randF(r, D * QD),
    gate_inp: randF(r, E * D), gate_exps: randF(r, E * FF * D), up_exps: randF(r, E * FF * D), down_exps: randF(r, E * D * FF),
  };
  const meta = {
    "general.architecture": "llama", "llama.block_count": 1, "llama.embedding_length": D,
    "llama.attention.head_count": NH, "llama.attention.head_count_kv": NHKV, "llama.attention.key_length": HD,
    "llama.feed_forward_length": FF, "llama.expert_count": E, "llama.expert_used_count": USED,
    "llama.expert_feed_forward_length": FF, "llama.rope.freq_base": FREQ, "llama.attention.layer_norm_rms_epsilon": EPS,
  };
  const T = [
    ["token_embd.weight", [D, VOCAB], w.tok_embd], ["output_norm.weight", [D], w.output_norm], ["output.weight", [D, VOCAB], w.output],
    ["blk.0.attn_norm.weight", [D], w.attn_norm], ["blk.0.attn_q.weight", [D, QD], w.wq], ["blk.0.attn_k.weight", [D, KV], w.wk],
    ["blk.0.attn_v.weight", [D, KV], w.wv], ["blk.0.attn_output.weight", [QD, D], w.wo], ["blk.0.ffn_norm.weight", [D], w.ffn_norm],
    ["blk.0.ffn_gate_inp.weight", [D, E], w.gate_inp],
    ["blk.0.ffn_gate_exps.weight", [D, FF, E], w.gate_exps], ["blk.0.ffn_up_exps.weight", [D, FF, E], w.up_exps], ["blk.0.ffn_down_exps.weight", [FF, D, E], w.down_exps],
  ];
  return forgeGguf(buildGguf(meta, T.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32bytes(arr) }))));
}

const EXPS = ["blk.0.ffn_gate_exps.weight", "blk.0.ffn_up_exps.weight", "blk.0.ffn_down_exps.weight"];

// Run the model twice over `tokens`: whole-stack vs sparse. Returns the two logits,
// the set of κ hexes the sparse run fetched, and the union of router selections (a
// prefill routes EACH position independently, so the working set is the union).
function runBoth(tokens) {
  const forge = forgeMoe();
  const graph = synthesizeGraph(forge.plan);
  assert.strictEqual(graph.family, "moe", `got ${graph.family}`);
  const { dir, expertBlocks } = buildExpertDirectory(forge);
  const store = mapStore(new Map([...forge.blocks, ...expertBlocks]));   // whole-stack + additive per-expert
  const dense = forward(forge.plan, graph, store, tokens);
  const fetched = new Set(); const selUnion = new Set();
  const recLoad = (st, k) => { fetched.add(hexOf(k)); return loadByKappa(st, k); };
  const sparse = forward(forge.plan, graph, store, tokens, {
    expertDir: dir, load: recLoad, onExpertSelect: (_key, sel) => sel.forEach((e) => selUnion.add(e)),
  });
  const allExpertHex = new Set(); for (const tn of EXPS) for (let e = 0; e < E; e++) allExpertHex.add(hexOf(expertKappa(dir, tn, e)));
  const wholeStackHex = new Set(EXPS.map((tn) => hexOf(forge.tensors.find((x) => x.name === tn).kappa)));
  return { dir, dense, sparse, fetched, selUnion, allExpertHex, wholeStackHex };
}
const expectedFor = (dir, experts) => { const s = new Set(); for (const tn of EXPS) for (const e of experts) s.add(hexOf(expertKappa(dir, tn, e))); return s; };
const fidelity = (dense, sparse) => { assert.strictEqual(sparse.length, dense.length); for (let i = 0; i < dense.length; i++) assert.strictEqual(sparse[i], dense[i], `logit ${i}`); };

t("single token: sparse fetches only the n_expert_used routed experts (not all E)", () => {
  const { dir, dense, sparse, fetched, selUnion, allExpertHex, wholeStackHex } = runBoth([1]);
  fidelity(dense, sparse);                                                  // S3: bit-identical
  assert.strictEqual(selUnion.size, USED, "one position routes exactly n_expert_used");
  const fetchedExpertHex = [...fetched].filter((h) => allExpertHex.has(h));
  assert.deepStrictEqual(new Set(fetchedExpertHex), expectedFor(dir, [...selUnion]), "fetched == routed");
  assert.strictEqual(fetchedExpertHex.length, EXPS.length * USED);         // 2 of 4 experts × 3 tensors = 6
  assert.ok(fetchedExpertHex.length < EXPS.length * E, "strictly fewer than the full stack (no over-fetch)");
  for (const h of wholeStackHex) assert.ok(!fetched.has(h), "whole expert stack never fetched");
});

t("prefill (multi-token): sparse fetches exactly the UNION of per-position selections", () => {
  const { dir, dense, sparse, fetched, selUnion, allExpertHex, wholeStackHex } = runBoth([1, 3, 2]);
  fidelity(dense, sparse);                                                  // S3: bit-identical
  const fetchedExpertHex = [...fetched].filter((h) => allExpertHex.has(h));
  assert.deepStrictEqual(new Set(fetchedExpertHex), expectedFor(dir, [...selUnion]), "fetched == ∪ router selections");
  assert.ok(selUnion.size <= E, "union bounded by expert count");
  for (const h of wholeStackHex) assert.ok(!fetched.has(h), "whole expert stack never fetched");
});

t("whole-stack path still works when no directory is supplied (fallback)", () => {
  const forge = forgeMoe();
  const graph = synthesizeGraph(forge.plan);
  const store = mapStore(forge.blocks);                        // ONLY whole-stack blocks present
  assert.doesNotThrow(() => forward(forge.plan, graph, store, [1, 3, 2]), "runs with whole-stack fallback");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
