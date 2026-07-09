// Per-expert κ directory witness (S1 of sparse expert streaming).
// Forge a tiny MoE (stacked F32 expert tensors), build the per-expert directory, and
// prove: (L5) every expert κ re-derives to its EXACT stacked-slice bytes and a tamper
// is refused; (L2) byte-identical experts dedup to one κ; (L1) the directory seals to
// a stable κ bound to the model root; and that the whole-tensor κ is left untouched.

import assert from "node:assert";
import { forgeGguf, mapStore, GGML_TYPE_NAME, ggmlNBytes, loadByKappa } from "./gguf-forge.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";
import { buildExpertDirectory, expertKappa, loadExpertSlice, isExpertTensor } from "./gguf-forge-expert-dir.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

// ── minimal GGUF writer (F32 + int/float meta) ──
function buildGguf(meta, tensors) {
  const ALIGN = 32; let off = 0;
  const infos = tensors.map((tn) => { const o = off; off = Math.ceil((o + tn.bytes.length) / ALIGN) * ALIGN; return { ...tn, offset: o }; });
  let parts = [], len = 0; const push = (b) => { parts.push(b); len += b.length; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); push(b); };
  const u64 = (v) => { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, v >>> 0, true); dv.setUint32(4, Math.floor(v / 4294967296), true); push(b); };
  const str = (s) => { const e = new TextEncoder().encode(s); u64(e.length); push(e); };
  push(new TextEncoder().encode("GGUF")); u32(3); u64(tensors.length); u64(Object.keys(meta).length);
  for (const [k, val] of Object.entries(meta)) { str(k); if (typeof val === "string") { u32(8); str(val); } else { u32(4); u32(val); } }
  for (const ti of infos) { str(ti.name); u32(ti.dims.length); for (const d of ti.dims) u64(d); u32(ti.type); u64(ti.offset); }
  if (len % ALIGN) push(new Uint8Array(ALIGN - (len % ALIGN)));
  const dataStart = len;
  for (const ti of infos) { while (len < dataStart + ti.offset) push(new Uint8Array(1)); push(ti.bytes); }
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
const f32bytes = (arr) => new Uint8Array(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength));

// Build E stacked experts of K*N floats each. expert e filled with value (e+1)*0.5,
// EXCEPT expert 2 is made byte-identical to expert 0 (to exercise L2 dedup).
const K = 4, N = 6, E = 4, KN = K * N;
function stacked() {
  const a = new Float32Array(KN * E);
  for (let e = 0; e < E; e++) {
    const v = e === 2 ? 0.5 : (e + 1) * 0.5;                  // e2 == e0
    for (let i = 0; i < KN; i++) a[e * KN + i] = v + i * 0.001 * (e === 2 ? 1 : (e === 0 ? 1 : (e + 1)));
  }
  // force e2 to be an exact copy of e0
  a.copyWithin(2 * KN, 0, KN);
  return a;
}
function forgeMoe() {
  const meta = { "general.architecture": "olmoe", "olmoe.block_count": 1, "olmoe.expert_count": E, "olmoe.expert_used_count": 2 };
  const g = stacked(), u = stacked(), d = stacked();
  const T = [
    ["token_embd.weight", [K, N], f32bytes(g)],
    ["blk.0.ffn_gate_exps.weight", [K, N, E], f32bytes(g)],
    ["blk.0.ffn_up_exps.weight", [K, N, E], f32bytes(u)],
    ["blk.0.ffn_down_exps.weight", [N, K, E], f32bytes(d)],
  ];
  return forgeGguf(buildGguf(meta, T.map(([name, dims, bytes]) => ({ name, type: GGML.F32, dims, bytes }))));
}

t("only the stacked ffn_*_exps tensors are treated as experts", () => {
  assert.ok(isExpertTensor("blk.7.ffn_gate_exps.weight"));
  assert.ok(isExpertTensor("blk.0.ffn_down_exps.weight"));
  assert.ok(!isExpertTensor("blk.0.ffn_gate.weight"));        // dense ffn
  assert.ok(!isExpertTensor("blk.0.ffn_gate_inp.weight"));    // router
  assert.ok(!isExpertTensor("token_embd.weight"));
});

t("every expert κ re-derives to its EXACT stacked slice (L5)", () => {
  const forge = forgeMoe();
  const { dir, expertBlocks } = buildExpertDirectory(forge);
  const store = mapStore(expertBlocks);
  for (const tn of Object.keys(dir.tensors)) {
    const td = dir.tensors[tn];
    const wholeHex = String(forge.tensors.find((x) => x.name === tn).kappa).split(":").pop();
    const whole = forge.blocks.get(wholeHex);
    assert.strictEqual(td.nExpert, E);
    assert.strictEqual(td.stride, ggmlNBytes(td.type, K * N));
    for (let e = 0; e < E; e++) {
      const got = loadExpertSlice(store, dir, tn, e);          // L5 verified load
      const want = whole.subarray(e * td.stride, (e + 1) * td.stride);
      assert.deepStrictEqual([...got], [...want], `${tn} expert ${e} bytes`);
    }
  }
});

t("byte-identical experts dedup to one κ (L2)", () => {
  const forge = forgeMoe();
  const { dir, expertBlocks } = buildExpertDirectory(forge);
  // expert 2 == expert 0 in all three stacks → same κ
  for (const tn of Object.keys(dir.tensors)) {
    assert.strictEqual(expertKappa(dir, tn, 0), expertKappa(dir, tn, 2), `${tn} e0==e2 share κ`);
  }
  // 3 tensors × 4 experts = 12 entries, but e0==e2 within each identical stack, and
  // the three stacks are identical here → far fewer unique κ than 12.
  assert.ok(expertBlocks.size < 12, `dedup: ${expertBlocks.size} unique blocks < 12 entries`);
});

t("tampering one expert's bytes is refused; others unaffected (L5)", () => {
  const forge = forgeMoe();
  const { dir, expertBlocks } = buildExpertDirectory(forge);
  const store = mapStore(expertBlocks);
  const tn = "blk.0.ffn_gate_exps.weight";
  const victimHex = String(expertKappa(dir, tn, 1)).split(":").pop();
  expertBlocks.get(victimHex)[0] ^= 0xff;                      // flip a byte under that κ
  assert.throws(() => loadExpertSlice(store, dir, tn, 1), /L5 REFUSE/, "tampered expert refuses");
  // a different expert (distinct κ) still loads fine
  assert.doesNotThrow(() => loadExpertSlice(store, dir, tn, 3));
});

t("directory seals to a stable κ bound to the model root (L1)", () => {
  const forge = forgeMoe();
  const a = buildExpertDirectory(forge), b = buildExpertDirectory(forgeMoe());
  assert.strictEqual(a.dirKappa, b.dirKappa, "deterministic dirKappa");
  assert.strictEqual(a.dir.model, forge.rootKappa, "bound to model rootKappa");
  assert.match(a.dirKappa, /^did:holo:sha256:/, "dirKappa is a did:holo");
});

t("whole-tensor κ is untouched and still loads (additive)", () => {
  const forge = forgeMoe();
  buildExpertDirectory(forge);                                 // build dir
  const store = mapStore(forge.blocks);                        // original whole-tensor store
  for (const x of forge.tensors) assert.doesNotThrow(() => loadByKappa(store, x.kappa), `whole ${x.name}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
