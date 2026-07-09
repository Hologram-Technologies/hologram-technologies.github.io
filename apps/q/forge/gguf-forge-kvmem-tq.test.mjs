// κ-native TurboQuant/PolarQuant KV plane: KvMemory storing K/V through the rotation-
// aware TQ codec. Proves the substrate properties — content-addressed (L2 dedup),
// L5-verifiable (tamper refused), low-bpw — and that the rotate→quant→dequant→inverse
// round-trip preserves the vector (orthogonal rotation, Lloyd-Max codebook). The
// per-block quant bytes are already BIT-EXACT vs ggml (gguf-forge-turboquant.test.mjs);
// here we exercise the memory plane on top of them.
import assert from "node:assert";
import { KvMemory } from "./gguf-forge-kvmem.mjs";
import { tqEncodeKV, tqDecodeKV, TQ_TYPES } from "./gguf-forge-turboquant.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
const cosine = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / (Math.sqrt(na) * Math.sqrt(nb)); };
function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }

const KVDIM = 128; // n_head_kv·head_dim — e.g. Qwen2.5-0.5B (2 kv heads × 64)

// PQ4_0 (d=128, 1 block) and PQ4_0_64 (d=64, 2 blocks) — exercise both block tilings.
for (const [id, t] of [["48", TQ_TYPES[48]], ["49", TQ_TYPES[49]]]) {
  const typeId = Number(id);
  const mem = new KvMemory({ typeK: typeId, typeV: typeId, nLayer: 1 });
  const r = rnd(0x9e + typeId);
  const k0 = Float32Array.from({ length: KVDIM }, () => r() * 1.5);
  const v0 = Float32Array.from({ length: KVDIM }, () => r() * 1.5);

  const kVal = mem.storeK(0, 0, k0);          // returns the lossy round-trip value
  mem.storeV(0, 0, v0);
  // round-trip quality: rotation is an exact inverse, only the codebook quant is lossy
  ok(cosine(k0, kVal) > 0.95, `${t.name.padEnd(9)} KV round-trip cosine ${cosine(k0, kVal).toFixed(4)} > 0.95`);

  // stored bytes == the witnessed kernel codec (rotate + tqQuant)
  const ref = tqEncodeKV(typeId, k0);
  const hex = String(mem.refsK[0][0]).split(":").pop();
  const stored = mem.blocks.get(hex);
  ok(stored.length === ref.length && stored.every((b, i) => b === ref[i]), `${t.name.padEnd(9)} stored κ-block == tqEncodeKV (rotate+quant)`);

  // materialize matches the store-time value (deterministic decode)
  const mat = mem.materialize(0, KVDIM);
  ok(mat.Kc[0][0].every((x, i) => x === kVal[i]), `${t.name.padEnd(9)} materialize == store-time decode`);

  // L2 dedup: storing the same K vector at another position → 0 new blocks
  const before = mem.blocks.size;
  mem.storeK(0, 1, k0.slice());
  ok(mem.blocks.size === before, `${t.name.padEnd(9)} identical KV dedups to one κ-block`);

  // low-bpw: block bytes vs F32
  const ratio = (KVDIM * 4) / t.total;
  ok(t.total < KVDIM * 4, `${t.name.padEnd(9)} ${t.total} B/block vs ${KVDIM * 4} F32 (${ratio.toFixed(1)}× smaller)`);

  // L5: flip one stored byte → load refuses
  stored[0] ^= 0xff;
  let refused = false; try { mem.load(mem.refsK[0][0]); } catch { refused = true; }
  ok(refused, `${t.name.padEnd(9)} L5 tamper refused`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
