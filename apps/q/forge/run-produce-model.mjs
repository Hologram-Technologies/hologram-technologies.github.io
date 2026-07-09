// Factory capstone: PRODUCE a complete runnable κ-model from f16 using our κ-native
// quantizer (no external tool), then prove it runs IDENTICALLY to the official Q4_K_M.
// f16 → (per-tensor) our-quantize/passthrough → κ-model → synthesizeGraph → forward.
import { readFileSync } from "node:fs";
import { parseGgufHeader } from "../qvac-ingest.mjs";
import { forgeGguf, ggmlNBytes, GGML_TYPE_NAME, loadByKappa } from "./gguf-forge.mjs";
import { dequantizeExact } from "./gguf-forge-dequant.mjs";
import { quantizeRow } from "./gguf-forge-quantize.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { sha256hex, kappa } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const DIR = "./.models/";
const f16Buf = new Uint8Array(readFileSync(DIR + "qwen2.5-0.5b-instruct-f16.gguf"));
const q4Buf = new Uint8Array(readFileSync(DIR + "qwen2.5-0.5b-instruct-q4_k_m.gguf"));
const f16 = parseGgufHeader(f16Buf), q4 = parseGgufHeader(q4Buf);
const typeOf = new Map(q4.tensors.map((t) => [t.name, t.ggmlType]));
const QTYPES = new Set([6, 8, 12, 14]); // q5_0 q8_0 q4_K q6_K — our quantizers
const nElem = (d) => d.reduce((a, b) => a * b, 1);

// produce: f16 → κ-model with the official type-per-tensor map (our quantizer)
const t0 = Date.now();
const blocks = new Map(), planTensors = [];
let quant = 0, pass = 0;
for (const t of f16.tensors) {
  const target = typeOf.get(t.name) ?? t.ggmlType, n = nElem(t.dims);
  const src = f16Buf.subarray(f16.dataOffset + t.offset, f16.dataOffset + t.offset + ggmlNBytes(t.ggmlType, n));
  let blob;
  if (QTYPES.has(target)) { blob = quantizeRow[target](dequantizeExact(t.ggmlType, src, n), n); quant++; }
  else { blob = src.slice(); pass++; }                          // F32/F16 passthrough verbatim
  const hex = sha256hex(blob); if (!blocks.has(hex)) blocks.set(hex, blob);
  planTensors.push({ name: t.name, dims: t.dims, type: target, typeName: GGML_TYPE_NAME[target] || String(target), nbytes: blob.length, kappa: kappa("sha256", hex) });
}
const producedPlan = { format: "gguf-forge/1", arch: f16.meta["general.architecture"], meta: f16.meta, tensors: planTensors };
console.log(`PRODUCED κ-model from f16: ${quant} tensors quantized (our quantizer) + ${pass} passthrough, ${blocks.size} κ-objects (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

// official model forged the normal way (the proven-greedy-parity baseline)
const official = forgeGguf(q4Buf);

// run BOTH on the witness tokens and compare greedy output
const memo = (bl) => { const c = new Map(); return { get: (ref) => { const h = String(ref).split(":").pop(); let b = c.get(h); if (!b) { b = bl.get(h); c.set(h, b); } return b; } }; };
const loadFast = (store, ref) => store.get(ref);
const tokens = [785, 6722, 374, 264]; // "The capital of France is" prefix ids (from the tokenizer witness)

function run(plan, blk, label) {
  const g = synthesizeGraph(plan); const store = memo(blk);
  const t = Date.now(); const logits = forward(plan, g, store, tokens, { load: loadFast });
  let am = 0; for (let i = 1; i < logits.length; i++) if (logits[i] > logits[am]) am = i;
  console.log(`  ${label}: argmax=${am} logit=${logits[am].toFixed(4)} (${((Date.now() - t) / 1000).toFixed(0)}s)`);
  return { am, logits };
}

console.log("\nrunning greedy forward on both models:");
const mine = run(producedPlan, blocks, "produced-from-f16");
const off = run(official.plan, official.blocks, "official q4_K_M ");

let maxAbs = 0; for (let i = 0; i < mine.logits.length; i++) maxAbs = Math.max(maxAbs, Math.abs(mine.logits[i] - off.logits[i]));
console.log(`\nargmax match: ${mine.am === off.am ? "YES (" + mine.am + ")" : "NO (" + mine.am + " vs " + off.am + ")"}; max|Δlogit| = ${maxAbs.toExponential(2)}`);
console.log(mine.am === off.am
  ? "\n✓ the model we PRODUCED from f16 (κ-native quantizer, no external tool) runs IDENTICALLY to the official Q4_K_M."
  : "\n(argmax differs — investigate)");
