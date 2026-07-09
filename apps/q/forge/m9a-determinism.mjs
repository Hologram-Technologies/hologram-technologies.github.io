// m9a-determinism.mjs — MEASURE the determinism boundary on the REAL Q model (Qwen2.5-0.5B, CPU Tier-A
// oracle = bit-exact vs ggml). For {logits, prefill-KV, greedy-token}: is it bit-exact / κ-equal across
// same-process and fresh-process? This GATES what compute may be content-addressed and at what scope.
// (Cross-backend CPU↔GPU is NOT measured here — the repo's own WITNESS.md already shows GEMV max abs err
//  4.8e-7, i.e. κ DIVERGES across backends; cross-device GPU diverges for the same float-order reason.)
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const sha = (u8) => crypto.createHash("sha256").update(u8).digest("hex");
const bytesOf = (f32) => new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);

const buf = new Uint8Array(readFileSync(".models/qwen2.5-0.5b-instruct-q4_k_m.gguf"));
const f = forgeGguf(buf);
const graph = synthesizeGraph(f.plan);
const store = { get: (hex) => f.blocks.get(hex) };
const verified = new Set();
const load = (st, kappa) => { const hex = String(kappa).split(":").pop(); const b = st.get(hex); if (!b) throw new Error("κ?"); if (!verified.has(hex)) { if (sha256hex(b) !== hex) throw new Error("L5"); verified.add(hex); } return b; };

// a fixed "system-prompt-like" prefix (16 real token ids < vocab) — the thing we'd prefill once and reuse
const PREFIX = [785, 6722, 374, 264, 1234, 99, 11, 8991, 42, 17, 5000, 321, 88, 1001, 2, 9];

function runOnce() {
  const kv = {};
  const logits = forward(f.plan, graph, store, PREFIX, { load, outKV: kv });
  let am = 0; for (let i = 1; i < logits.length; i++) if (logits[i] > logits[am]) am = i;
  // hash the full prefill KV (all layers × all positions, K then V) — the artifact we'd content-address
  const h = crypto.createHash("sha256");
  for (let L = 0; L < kv.nLayer; L++) for (let pos = 0; pos < kv.nPos; pos++) { h.update(bytesOf(kv.Kc[L][pos])); h.update(bytesOf(kv.Vc[L][pos])); }
  const kvBytes = kv.nLayer * kv.nPos * kv.kvDim * 4 * 2;
  return { logitsK: sha(bytesOf(logits)), kvK: h.digest("hex"), argmax: am, kvBytes, nLayer: kv.nLayer, nPos: kv.nPos, kvDim: kv.kvDim };
}

const a = runOnce();        // same-process run 1
const b = runOnce();        // same-process run 2
console.log(`MODEL Qwen2.5-0.5B (q4_k_m) · prefix ${PREFIX.length} tok · ${a.nLayer} layers · KV ${(a.kvBytes / 1024).toFixed(0)} KiB (nPos=${a.nPos}, kvDim=${a.kvDim})`);
console.log(`  logitsκ = ${a.logitsK.slice(0, 24)}…`);
console.log(`  prefill-KVκ = ${a.kvK.slice(0, 24)}…`);
console.log(`  greedy argmax = ${a.argmax}`);
console.log(`  [same-process] logits κ-equal=${a.logitsK === b.logitsK}  KV κ-equal=${a.kvK === b.kvK}  argmax-equal=${a.argmax === b.argmax}`);
console.log(`KAPPAS ${a.logitsK} ${a.kvK} ${a.argmax}`);   // for cross-PROCESS diff (run this script twice, compare this line)
