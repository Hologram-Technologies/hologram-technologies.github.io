// Forge tests: build a synthetic but spec-valid GGUF in memory, forge it to
// κ-objects, and prove the laws:
//   L1  identity = content       (rootKappa deterministic across runs)
//   L2  one object per content    (identical tensors dedup to one block)
//   L5  verify by re-derivation   (tamper one byte -> refuse)
//   fidelity: reloaded κ-bytes are byte-identical to the original tensor span,
//             and dequantize identically through the Tier-A oracle.

import assert from "node:assert";
import { forgeGguf, loadByKappa, verifyPlan, mapStore, ggmlNBytes, GGML_TYPE_NAME } from "./gguf-forge.mjs";
import { dequantizeExact, GGML } from "./gguf-forge-dequant.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

// ── minimal GGUF v3 writer (tensor_count before kv_count, this fork's order) ──
function w() {
  let parts = [], len = 0;
  const push = (u8) => { parts.push(u8); len += u8.length; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); push(b); };
  const u64 = (v) => { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, v >>> 0, true); dv.setUint32(4, Math.floor(v / 4294967296), true); push(b); };
  const str = (s) => { const e = new TextEncoder().encode(s); u64(e.length); push(e); };
  const raw = (b) => push(b);
  const pad = (align) => { const m = len % align; if (m) push(new Uint8Array(align - m)); };
  return { u32, u64, str, raw, pad, get len() { return len; }, build() { const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; } };
}

function prng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0); }
function randTensor(type, dims, seed) {
  const n = dims.reduce((a, b) => a * b, 1);
  const nbytes = ggmlNBytes(type, n);
  const r = prng(seed), b = new Uint8Array(nbytes);
  for (let i = 0; i < nbytes; i++) b[i] = r() & 0xff;
  return b;
}

// Assemble a GGUF: header(KV) + tensor-info table + padded tensor data.
function buildGguf(meta, tensors) {
  const ALIGN = 32;
  // assign data offsets (relative to dataOffset), 32-padded between tensors
  let off = 0;
  const infos = tensors.map((t) => { const o = off; off = Math.ceil((o + t.bytes.length) / ALIGN) * ALIGN; return { ...t, offset: o }; });

  const h = w();
  h.raw(new TextEncoder().encode("GGUF"));   // magic
  h.u32(3);                                  // version
  h.u64(tensors.length);                     // tensor_count  (this fork: before kv)
  h.u64(Object.keys(meta).length);           // kv_count
  for (const [k, val] of Object.entries(meta)) {
    h.str(k);
    if (typeof val === "string") { h.u32(8); h.str(val); }
    else { h.u32(4); h.u32(val); }           // treat numbers as u32
  }
  for (const ti of infos) {
    h.str(ti.name);
    h.u32(ti.dims.length);
    for (const d of ti.dims) h.u64(d);
    h.u32(ti.type);
    h.u64(ti.offset);
  }
  h.pad(ALIGN);                              // header padded -> dataOffset
  const dataStart = h.len;
  for (const ti of infos) {
    // pad to this tensor's absolute offset
    while (h.len < dataStart + ti.offset) h.raw(new Uint8Array(1));
    h.raw(ti.bytes);
  }
  return { bytes: h.build(), dataStart };
}

const META = {
  "general.architecture": "llama",
  "llama.embedding_length": 256,
  "llama.block_count": 1,
  "llama.attention.head_count": 4,
  "llama.attention.head_count_kv": 2,
  "llama.feed_forward_length": 512,
};
// note: two identical tensors (same type+seed) to exercise L2 dedup
const TENSORS = [
  { name: "token_embd.weight", type: GGML.Q4_K, dims: [256, 8], bytes: randTensor(GGML.Q4_K, [256, 8], 11) },
  { name: "output_norm.weight", type: GGML.F32, dims: [256], bytes: randTensor(GGML.F32, [256], 22) },
  { name: "blk.0.attn_q.weight", type: GGML.Q6_K, dims: [256, 4], bytes: randTensor(GGML.Q6_K, [256, 4], 33) },
  { name: "blk.0.ffn_down.weight", type: GGML.Q8_0, dims: [256, 2], bytes: randTensor(GGML.Q8_0, [256, 2], 44) },
  { name: "blk.0.dup.weight", type: GGML.Q6_K, dims: [256, 4], bytes: randTensor(GGML.Q6_K, [256, 4], 33) }, // identical to attn_q
];

const { bytes: gguf } = buildGguf(META, TENSORS);

t("forge parses all tensors with correct nbytes", () => {
  const f = forgeGguf(gguf);
  assert.strictEqual(f.tensors.length, TENSORS.length);
  for (let i = 0; i < TENSORS.length; i++) {
    assert.strictEqual(f.tensors[i].name, TENSORS[i].name);
    assert.strictEqual(f.tensors[i].nbytes, TENSORS[i].bytes.length, TENSORS[i].name);
  }
  assert.strictEqual(f.arch, "llama");
});

t("L2: identical tensors dedup to one κ-block", () => {
  const f = forgeGguf(gguf);
  // 5 tensors but two are byte-identical -> 4 unique blocks
  assert.strictEqual(f.blocks.size, 4, `blocks=${f.blocks.size}`);
  const q = f.tensors.find((x) => x.name === "blk.0.attn_q.weight");
  const dup = f.tensors.find((x) => x.name === "blk.0.dup.weight");
  assert.strictEqual(q.kappa, dup.kappa, "identical content -> identical κ");
});

t("fidelity: reloaded κ-bytes are byte-identical to original tensor span", () => {
  const f = forgeGguf(gguf);
  const store = mapStore(f.blocks);
  for (let i = 0; i < TENSORS.length; i++) {
    const got = loadByKappa(store, f.tensors[i].kappa);
    assert.deepStrictEqual([...got], [...TENSORS[i].bytes], TENSORS[i].name);
  }
});

t("fidelity: reloaded Q4_K/Q6_K dequant == oracle on original bytes", () => {
  const f = forgeGguf(gguf);
  const store = mapStore(f.blocks);
  for (const name of ["token_embd.weight", "blk.0.attn_q.weight"]) {
    const tdesc = f.tensors.find((x) => x.name === name);
    const elems = tdesc.dims.reduce((a, b) => a * b, 1);
    const reloaded = loadByKappa(store, tdesc.kappa);
    const orig = TENSORS.find((x) => x.name === name).bytes;
    const a = dequantizeExact(tdesc.type, reloaded, elems);
    const b = dequantizeExact(tdesc.type, orig, elems);
    assert.deepStrictEqual([...a], [...b], name);
  }
});

t("L1: rootKappa is deterministic across runs", () => {
  const a = forgeGguf(gguf).rootKappa;
  const b = forgeGguf(gguf.slice()).rootKappa; // fresh buffer, same content
  assert.strictEqual(a, b);
  assert.match(a, /^did:holo:sha256:[0-9a-f]{64}$/);
});

t("L5: tamper one byte in a stored block -> refuse", () => {
  const f = forgeGguf(gguf);
  const store = mapStore(f.blocks);
  const victim = f.tensors[0];
  const hex = victim.kappa.split(":").pop();
  const block = f.blocks.get(hex);
  block[0] ^= 0xff;                       // flip a byte in place
  assert.throws(() => loadByKappa(store, victim.kappa), /L5 REFUSE/);
});

t("verifyPlan recomputes rootKappa on a clean store", () => {
  const f = forgeGguf(gguf);
  const store = mapStore(f.blocks);
  assert.strictEqual(verifyPlan(store, f.plan), f.rootKappa);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
