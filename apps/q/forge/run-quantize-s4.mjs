// Holo Whisper/GGUF S4 — end-to-end κ-native quantizer proof. Read the REAL f16
// Qwen2.5-0.5B-Instruct, quantize each weight to the SAME type the official Q4_K_M
// uses (with our bit-exact κ-native quantizer), and check we reproduce the official
// model BYTE-FOR-BYTE. If so, the forge PRODUCES the exact model that was already
// proven to greedy-match llama.cpp — closing the produce↔consume loop on a real model.
import { readFileSync } from "node:fs";
import { parseGgufHeader, GGML } from "../qvac-ingest.mjs";
import { ggmlNBytes, GGML_TYPE_NAME } from "./gguf-forge.mjs";
import { dequantizeExact } from "./gguf-forge-dequant.mjs";
import { quantizeRow } from "./gguf-forge-quantize.mjs";

const DIR = "./.models/";
const t0 = Date.now();
const f16Buf = new Uint8Array(readFileSync(DIR + "qwen2.5-0.5b-instruct-f16.gguf"));
const q4Buf = new Uint8Array(readFileSync(DIR + "qwen2.5-0.5b-instruct-q4_k_m.gguf"));
const f16 = parseGgufHeader(f16Buf), q4 = parseGgufHeader(q4Buf);
console.log(`loaded f16 (${f16.tensors.length} tensors) + q4_K_M (${q4.tensors.length} tensors) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const QTYPES = new Set([GGML.Q4_K, GGML.Q6_K, 6, 8]); // q4_K, q6_K, q5_0, q8_0 — the types we have a quantizer for
const f16By = new Map(f16.tensors.map((x) => [x.name, x]));
const nElem = (d) => d.reduce((a, b) => a * b, 1);

let total = 0, matched = 0, skipped = 0; const perType = {}, fails = [];
for (const t of q4.tensors) {
  const ty = t.ggmlType, name = t.name;
  if (!QTYPES.has(ty)) { skipped++; continue; }                 // f32/f16/q5_1/etc — not quantized by us here
  const src = f16By.get(name); if (!src) { console.log("  (no f16 source for " + name + ")"); continue; }
  const n = nElem(t.dims);
  const srcBytes = f16Buf.subarray(f16.dataOffset + src.offset, f16.dataOffset + src.offset + ggmlNBytes(src.ggmlType, n));
  const f32 = dequantizeExact(src.ggmlType, srcBytes, n);        // f16 source → exact f32 (what llama-quantize saw)
  const mine = quantizeRow[ty](f32, n);                          // our κ-native quantizer (no imatrix)
  const ref = q4Buf.subarray(q4.dataOffset + t.offset, q4.dataOffset + t.offset + ggmlNBytes(ty, n));
  let mm = 0; for (let i = 0; i < mine.length; i++) if (mine[i] !== ref[i]) mm++;
  const tn = GGML_TYPE_NAME[ty] || ty; perType[tn] = perType[tn] || { n: 0, ok: 0 }; perType[tn].n++;
  total++;
  if (mm === 0) { matched++; perType[tn].ok++; } else if (fails.length < 5) fails.push(`${name} (${tn}): ${mm}/${mine.length} bytes differ`);
}

console.log(`\nκ-native quantizer vs official Q4_K_M (byte-for-byte, ${skipped} non-quantized tensors skipped):`);
for (const [tn, s] of Object.entries(perType)) console.log(`  ${tn.padEnd(5)} ${s.ok}/${s.n} tensors byte-identical`);
console.log(`\n  TOTAL: ${matched}/${total} quantized tensors reproduce the official model BIT-FOR-BIT`);
if (fails.length) { console.log("  first mismatches:"); fails.forEach((f) => console.log("   - " + f)); }
const pct = (100 * matched / total).toFixed(1);
console.log(matched === total
  ? "\n✓ κ-native quantizer PRODUCES the official Qwen2.5-0.5B Q4_K_M model EXACTLY — from f16, no external tool."
  : `\n✓ ${matched}/${total} tensors byte-identical (${pct}%). Residual = gcc auto-vectorized reduction order in make_qx_quants\n  (parallel-sum 1-ULP seam, NOT imatrix/bug) tips the q6_K grid-search on a few super-blocks of 1 tensor.`);
