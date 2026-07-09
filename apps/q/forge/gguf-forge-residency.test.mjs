// Warm residency + multi-source witness (S4 of sparse expert streaming).
// Using the per-expert κ directory + a resident multi-source store, prove the three
// honest regimes: COLD (first forward fetches routed experts from a source, verified),
// WARM (a second forward of the same prompt fetches ZERO blocks — served from L3
// residency), and HOT-SET (an overlapping prompt fetches ONLY the newly-routed experts,
// strictly fewer than a cold load). Plus multi-source: a corrupt source is refused by
// re-derivation and the next source serves the block; if every source is corrupt the
// load fails closed. Logits are identical across every regime (residency is memoization).

import assert from "node:assert";
import { forgeGguf, mapStore, loadByKappa } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";
import { buildExpertDirectory, expertKappa } from "./gguf-forge-expert-dir.mjs";
import { makeResidentStore, asSource } from "./gguf-forge-kstore.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

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

// shared fixture: forge + graph + dir + a "peer" source holding every block.
function fixture() {
  const forge = forgeMoe();
  const graph = synthesizeGraph(forge.plan);
  const { dir, expertBlocks } = buildExpertDirectory(forge);
  const peer = new Map([...forge.blocks, ...expertBlocks]);     // a remote source with all blocks
  const ref = forward(forge.plan, graph, mapStore(peer), [1]);  // whole-stack reference logits for [1]
  return { forge, graph, dir, peer, ref };
}
const run = (f, store, tokens) => forward(f.forge.plan, f.graph, store, tokens, { expertDir: f.dir });
const sameLogits = (a, b) => { assert.strictEqual(a.length, b.length); for (let i = 0; i < a.length; i++) assert.strictEqual(a[i], b[i], `logit ${i}`); };

t("COLD then WARM: a second forward of the same prompt fetches ZERO blocks (L3)", () => {
  const f = fixture();
  const resident = new Map();
  const cold = makeResidentStore({ sources: [asSource(f.peer)], resident });
  const lc = run(f, cold, [1]);
  assert.ok(cold.stats.fetched > 0 && cold.stats.refused === 0, "cold fetched + verified from peer");
  assert.strictEqual(cold.stats.verified, cold.stats.fetched, "every fetched block re-derived");

  const warm = makeResidentStore({ sources: [asSource(f.peer)], resident });  // SAME resident Map
  const lw = run(f, warm, [1]);
  assert.strictEqual(warm.stats.fetched, 0, "warm: zero source fetches");
  assert.ok(warm.stats.hits > 0, "served entirely from residency");
  sameLogits(lc, lw); sameLogits(lc, f.ref);
  console.log(`      regimes: cold fetched ${cold.stats.fetched} blocks · warm fetched 0`);
});

t("HOT-SET: an overlapping prompt fetches ONLY the newly-routed experts (< cold)", () => {
  const f = fixture();
  // cold load of prompt [2] from scratch — the baseline to beat
  const coldP2 = makeResidentStore({ sources: [asSource(f.peer)], resident: new Map() });
  run(f, coldP2, [2]);

  // warm on [1], then run overlapping [2] against the warmed residency
  const resident = new Map();
  run(f, makeResidentStore({ sources: [asSource(f.peer)], resident }), [1]);
  const before = resident.size;
  const hot = makeResidentStore({ sources: [asSource(f.peer)], resident });
  run(f, hot, [2]);
  const growth = resident.size - before;
  assert.strictEqual(hot.stats.fetched, growth, "fetched exactly the blocks newly added to residency");
  assert.ok(hot.stats.fetched < coldP2.stats.fetched, `hot ${hot.stats.fetched} < cold ${coldP2.stats.fetched} (shared trunk + experts)`);
  console.log(`      regimes: cold[2] ${coldP2.stats.fetched} · hot[2 after 1] ${hot.stats.fetched}`);
});

t("MULTI-SOURCE: a corrupt source is refused by re-derivation; the next source serves it", () => {
  const f = fixture();
  // learn which expert [1] routes, then corrupt that expert's gate slice on source 0
  let sel = null;
  forward(f.forge.plan, f.graph, mapStore(f.peer), [1], { expertDir: f.dir, onExpertSelect: (_k, s) => { sel = s.slice(); } });
  const targetHex = hexOf(expertKappa(f.dir, "blk.0.ffn_gate_exps.weight", sel[0]));
  const corrupt = (src, hex) => { const m = new Map(src); const bad = m.get(hex).slice(); bad[0] ^= 0xff; m.set(hex, bad); return m; };

  const src0 = corrupt(f.peer, targetHex);                        // everything right except the target block
  const src1 = f.peer;                                            // correct fallback
  const store = makeResidentStore({ sources: [asSource(src0), asSource(src1)], resident: new Map() });
  const l = run(f, store, [1]);
  sameLogits(l, f.ref);                                           // correct result despite a bad source
  assert.ok(store.stats.refused >= 1, "the corrupt block was refused");
  assert.ok(store.stats.perSource[1] >= 1, "the target was served from the fallback source");

  // if EVERY source is corrupt for a needed block, the load fails closed
  const allBad0 = corrupt(f.peer, targetHex), allBad1 = corrupt(f.peer, targetHex);
  const store2 = makeResidentStore({ sources: [asSource(allBad0), asSource(allBad1)], resident: new Map() });
  assert.throws(() => run(f, store2, [1]), /not found/, "no good source → fail closed");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
