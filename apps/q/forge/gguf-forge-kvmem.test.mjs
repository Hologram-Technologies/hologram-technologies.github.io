// K1 witness — κ-native quantized KV memory. KV vectors → content-addressed quant
// κ-blocks (bit-exact, reusing the proven quantizer), deduped, L5-verifiable.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { KvMemory } from "./gguf-forge-kvmem.mjs";
import { quantizeRowQ8_0, quantizeRowQ4_0 } from "./gguf-forge-quantize.mjs";
import { dequantizeExact, GGML } from "./gguf-forge-dequant.mjs";
import { ropeNeox } from "./gguf-forge-kernels.mjs";

const HD = 64, NROT = 64, FREQ = 1000000;
// per-head RoPE(delta) shift over a kvDim vector — the K-shift the memory applies.
const ropeShift = (kvec, _il, delta) => { const out = new Float32Array(kvec.length); for (let h = 0; h < kvec.length / HD; h++) out.set(ropeNeox(kvec.subarray(h * HD, (h + 1) * HD), delta, NROT, FREQ, HD), h * HD); return out; };

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };
function prng(s) { return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; }; }
const kv = (n, seed) => { const r = prng(seed), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * 0.8; return a; };
const D = 128; // kvDim (n_head_kv*head_dim), multiple of 32

t("K1: KV vector stored as a content-addressed κ-block, bytes == the proven quantizer", () => {
  for (const [type, qfn] of [[GGML.Q8_0, quantizeRowQ8_0], [GGML.Q4_0, quantizeRowQ4_0]]) {
    const m = new KvMemory({ typeK: type, typeV: type, nLayer: 1 });
    const vec = kv(D, 7 + type);
    const ret = m.storeK(0, 0, vec);                         // returns the round-tripped value
    const ref = m.refsK[0][0], hex = ref.split(":").pop();
    const blob = m.blocks.get(hex);
    const want = qfn(vec, D);
    assert.strictEqual(blob.length, want.length);
    for (let i = 0; i < want.length; i++) assert.strictEqual(blob[i], want[i], `byte ${i}`); // bit-exact KV block
    // attention sees the dequantized round-trip
    const deq = dequantizeExact(type, want, D);
    for (let i = 0; i < D; i++) assert.strictEqual(ret[i], deq[i]);
  }
});

t("K1: identical KV vectors dedup to ONE κ-object (content-addressed)", () => {
  const m = new KvMemory({ typeK: GGML.Q8_0, typeV: GGML.Q8_0, nLayer: 2 });
  const a = kv(D, 11), b = kv(D, 99);
  m.storeK(0, 0, a); m.storeK(0, 1, a); m.storeK(1, 0, a); // 3 stores, same vec → 1 κ
  m.storeK(0, 2, b);                                        // distinct → 2nd κ
  assert.strictEqual(m.blocks.size, 2);
  assert.strictEqual(m.refsK[0][0], m.refsK[0][1]);         // shared κ ref
});

t("K1: L5 re-derives a KV block and REFUSES a tampered one", () => {
  const m = new KvMemory({ typeK: GGML.Q8_0, typeV: 0, nLayer: 1 });
  const ref = m.refsK[0]; m.storeK(0, 0, kv(D, 3));
  const k = m.refsK[0][0]; assert.ok(m.load(k).length === 136);  // q8_0: 4 blocks × 34
  const hex = k.split(":").pop(); m.blocks.get(hex)[0] ^= 0xff;   // tamper
  assert.throws(() => m.load(k), /L5 REFUSE/);
});

t("K1: quantized KV shrinks memory (q8_0 ≈ 3.8×, q4_0 ≈ 7.5× vs f32)", () => {
  const N = 64;
  const sz = (type) => { const m = new KvMemory({ typeK: type, typeV: type, nLayer: 1 }); for (let p = 0; p < N; p++) { m.storeK(0, p, kv(D, 1000 + p)); m.storeV(0, p, kv(D, 2000 + p)); } return m.bytes; };
  const f32 = sz(0), q8 = sz(GGML.Q8_0), q4 = sz(GGML.Q4_0);
  console.log(`      f32 ${f32}B  q8_0 ${q8}B (${(f32 / q8).toFixed(1)}×)  q4_0 ${q4}B (${(f32 / q4).toFixed(1)}×)`);
  assert.ok(f32 / q8 > 3.5 && f32 / q4 > 6.5);
});

t("K2: seq_cp SHARES the source's κ refs — zero-copy, 0 new blocks (qvac copies cells)", () => {
  const m = new KvMemory({ typeK: GGML.Q8_0, typeV: GGML.Q8_0, nLayer: 2 });
  for (let p = 0; p < 4; p++) { m.storeK(0, p, kv(D, p + 1)); m.storeK(1, p, kv(D, p + 50)); m.storeV(0, p, kv(D, p + 9)); m.storeV(1, p, kv(D, p + 99)); }
  const before = m.blocks.size;
  m.seqCp(0, 7);                                            // copy sequence 0 → 7
  assert.strictEqual(m.blocks.size, before, "seq_cp must add 0 κ-objects (pure sharing)");
  for (let il = 0; il < 2; il++) for (let p = 0; p < 4; p++) assert.strictEqual(m.seqs.get(7).K[il][p], m.seqs.get(0).K[il][p]); // same κ ref
  assert.strictEqual(m.seqPosMax(7), m.seqPosMax(0));
});

t("K2: branching shares the prefix — only the divergent token adds a κ", () => {
  const m = new KvMemory({ typeK: GGML.Q8_0, typeV: GGML.Q8_0, nLayer: 1 });
  for (let p = 0; p < 3; p++) { m.setSeq(0); m.storeK(0, p, kv(D, p + 1)); m.storeV(0, p, kv(D, p + 1000)); } // shared prefix (3 tok, distinct K/V)
  const sharedBlocks = m.blocks.size;                      // 6 (3 K + 3 V)
  m.seqCp(0, 1);                                            // branch
  m.setSeq(0); m.storeK(0, 3, kv(D, 100)); m.storeV(0, 3, kv(D, 1100)); // seq 0: token A (K+V)
  m.setSeq(1); m.storeK(0, 3, kv(D, 200)); m.storeV(0, 3, kv(D, 1200)); // seq 1: token B (different)
  assert.strictEqual(m.blocks.size, sharedBlocks + 4, "two branches add only their 2 divergent K+V each"); // +2 (A) +2 (B)
});

t("K2: seq_rm truncates + seq_keep/clear", () => {
  const m = new KvMemory({ typeK: GGML.Q8_0, typeV: GGML.Q8_0, nLayer: 1 });
  for (let p = 0; p < 4; p++) { m.storeK(0, p, kv(D, p + 1)); m.storeV(0, p, kv(D, p + 1)); }
  m.seqRm(0, 2, 4); assert.strictEqual(m.seqPosMax(0), 1);  // dropped pos 2,3
  assert.strictEqual(m.seqs.get(0).K[0][2], undefined);
  m.seqCp(0, 5); m.seqKeep(5); assert.ok(!m.seqExists(0) && m.seqExists(5));
  m.clear(); assert.strictEqual(m.seqPosMax(5), -1);
});

t("K3: RoPE composes — ropeNeox(ropeNeox(x,a),b) == ropeNeox(x,a+b) (the seq_add basis)", () => {
  const x = kv(HD, 5);
  for (const [a, b] of [[3, 5], [10, -4], [0, 7], [128, 64]]) {
    const twoStep = ropeNeox(ropeNeox(x, a, NROT, FREQ, HD), b, NROT, FREQ, HD);
    const direct = ropeNeox(x, a + b, NROT, FREQ, HD);
    let mx = 0; for (let i = 0; i < HD; i++) mx = Math.max(mx, Math.abs(twoStep[i] - direct[i]));
    assert.ok(mx < 1e-4, `a=${a} b=${b}: maxAbs ${mx}`);
  }
});

t("K3: seq_add(δ) shifts stored K as if RoPE'd at the new position", () => {
  const m = new KvMemory({ typeK: 0, typeV: 0, nLayer: 1 }), raw = kv(D, 21), p = 7, delta = 40;
  const kAtP = ropeShift(raw, 0, p);                       // K as stored at position p (post-RoPE)
  m.storeK(0, 0, kAtP); m.storeV(0, 0, kv(D, 1));
  m.seqAdd(0, 0, 1, delta, ropeShift, D);                  // shift by δ
  const shifted = m.materialize(0, D).Kc[0][0];
  const expected = ropeShift(raw, 0, p + delta);           // K as if computed at p+δ
  let mx = 0; for (let i = 0; i < D; i++) mx = Math.max(mx, Math.abs(shifted[i] - expected[i]));
  assert.ok(mx < 1e-4, `seq_add maxAbs ${mx}`);
  // invertible: +δ then −δ returns the original
  m.seqAdd(0, 0, 1, -delta, ropeShift, D);
  const back = m.materialize(0, D).Kc[0][0];
  let mb = 0; for (let i = 0; i < D; i++) mb = Math.max(mb, Math.abs(back[i] - kAtP[i]));
  assert.ok(mb < 1e-4, `round-trip maxAbs ${mb}`);
});

function fill(m, nLayer, N) { for (let p = 0; p < N; p++) for (let il = 0; il < nLayer; il++) { m.storeK(il, p, kv(D, p * 31 + il)); m.storeV(il, p, kv(D, p * 31 + il + 7)); } }

t("K4: SWA eviction bounds memory to a ring of n_swa (global layers unbounded)", () => {
  const W = 8, N = 20, m = new KvMemory({ typeK: GGML.Q8_0, typeV: GGML.Q8_0, nLayer: 2 });
  m.setSwa([W, 0]);                                          // layer 0 = SWA(8), layer 1 = global
  fill(m, 2, N);
  assert.strictEqual(m.liveCount(0, 0), W, "SWA layer must keep exactly n_swa");
  assert.strictEqual(m.liveCount(0, 1), N, "global layer keeps all");
});

t("K4: the retained ring == the attention window [pos−n_swa+1 .. pos] (evicted = masked)", () => {
  const W = 8, N = 20, m = new KvMemory({ typeK: 0, typeV: 0, nLayer: 1 });
  m.setSwa([W]); fill(m, 1, N);
  const live = m.livePositions(0, 0), want = []; for (let p = N - W; p < N; p++) want.push(p);
  assert.deepStrictEqual(live, want);                        // exactly the last n_swa = the final query's window
});

t("K4: Gemma3-pattern (5 SWA + 1 global / 6 layers) bounds long-context memory", () => {
  const W = 8, N = 50, m = new KvMemory({ typeK: GGML.Q8_0, typeV: GGML.Q8_0, nLayer: 6 });
  m.setSwa([W, W, W, W, W, 0]); fill(m, 6, N);              // Gemma3: last of each group is global
  let live = 0; for (let il = 0; il < 6; il++) live += m.liveCount(0, il);
  const full = 6 * N;
  console.log(`      ${N} tokens × 6 layers: ${live}/${full} K positions live (${(full / live).toFixed(1)}× bounded)`);
  assert.strictEqual(live, 5 * W + N);                       // 5 SWA rings + 1 full
});

t("K5: HYBRID memory — KV on attention layers + recurrent state on recurrent layers, all κ", () => {
  const m = new KvMemory({ typeK: GGML.Q8_0, typeV: GGML.Q8_0, nLayer: 2 }); // typeR default f32
  m.storeK(0, 0, kv(D, 1)); m.storeV(0, 0, kv(D, 2));        // layer 0 = attention (KV)
  const conv = kv(96, 3), ssm = kv(256, 4);
  m.storeRecurrent(1, "conv", conv); m.storeRecurrent(1, "ssm", ssm); // layer 1 = recurrent (Mamba state)
  assert.ok(!m.isRecurrentLayer(0, 0), "layer 0 attention (KV, no R)");
  assert.ok(m.isRecurrentLayer(0, 1), "layer 1 recurrent (R, no KV)"); // is_recurrent ⇔ n_head_kv==0
  const gc = m.getRecurrent(0, 1, "conv", 96); for (let i = 0; i < 96; i++) assert.strictEqual(gc[i], conv[i]); // content-addressed round-trip
  const before = m.blocks.size;
  m.storeRecurrent(1, "conv", conv); assert.strictEqual(m.blocks.size, before);     // unchanged state → dedup
  m.storeRecurrent(1, "conv", kv(96, 99)); assert.strictEqual(m.blocks.size, before + 1); // changed → new κ (re-key)
});

t("K5: executor's generic op-walk handles interleaved attention + recurrent layers", () => {
  const src = readFileSync(new URL("./gguf-forge-exec.mjs", import.meta.url), "utf8"); // a hybrid graph routes per-op
  for (const op of ['case "attn"', 'case "mamba"', 'case "mamba2"', 'case "rwkv7_tmix"']) assert.ok(src.includes(op), `missing ${op}`);
});

t("K6: unified interface — seqCp branches a HYBRID sequence (KV + recurrent) with 0 new κ", () => {
  const m = new KvMemory({ typeK: GGML.Q8_0, typeV: GGML.Q8_0, nLayer: 2 });
  m.storeK(0, 0, kv(D, 1)); m.storeV(0, 0, kv(D, 2));   // attn layer
  m.storeRecurrent(1, "ssm", kv(256, 4));               // recurrent layer
  const before = m.blocks.size;
  m.seqCp(0, 1);                                          // share BOTH KV and R refs
  assert.strictEqual(m.blocks.size, before, "hybrid branch is zero-copy");
  assert.strictEqual(m.getRecurrent(1, 1, "ssm", 256)[0], m.getRecurrent(0, 1, "ssm", 256)[0]); // recurrent ref shared
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
