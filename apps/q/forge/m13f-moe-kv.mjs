// m13f-moe-kv.mjs — P2a': KV-cache the demand-paged decode so each token reads its weights ONCE
// (for the one new position), not once per position of the whole growing sequence.
//
// m13e showed the streamed path re-fetches ~12 GiB/token because forward() reprocesses the entire
// sequence every token (O(n²) weight reads). The exec already supports incremental decode: opts.outKV
// exports the KV cache, opts.inKV seeds it and skips the covered prefix (startPos). We prefill the prompt
// once, then decode each token processing only the NEW position. Output must be BYTE-IDENTICAL to the
// full-sequence run (KV is deterministic in the tokens). Then measure the streamed-bytes collapse.
import { openSync, readSync, closeSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { forgeGgufScan } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { makeTokenizer } from "./gguf-forge-tokenizer.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const MODEL = ".models/deepseek-v2-lite-q4_k_m.gguf";
const MiB = 1024 * 1024, GiB = 1024 * MiB, hexOf = (k) => String(k).split(":").pop();
const PROMPT = "The capital of France is", NGEN = 6, CAPTURE = 3 * GiB;
const EXPECT = "The capital of France is Paris.\nThe currency of";   // m13e full-sequence output (greedy, deterministic)

const fd = openSync(MODEL, "r");
const fileSize = statSync(MODEL).size;
const readRange = (off, len) => { const b = Buffer.allocUnsafe(len); let g = 0; while (g < len) { const n = readSync(fd, b, g, len - g, off + g); if (n <= 0) break; g += n; } return new Uint8Array(b.buffer, b.byteOffset, len); };
const headerBytes = readRange(0, Math.min(fileSize, 48 * MiB));

console.log(`range-forging ${MODEL} (${(fileSize / GiB).toFixed(2)} GiB)…`);
let t0 = performance.now();
const scan = await forgeGgufScan(readRange, { headerBytes });
const graph = synthesizeGraph(scan.plan);
const tok = makeTokenizer(headerBytes);
console.log(`  scanned in ${((performance.now() - t0) / 1000).toFixed(0)}s`);

// trace-recording loader (roomy capture cache; logs every request id+size in order)
const trace = [], sizeById = []; const idOf = new Map();
const lru = new Map(); let resident = 0;
const load = (_s, kappa) => {
  const hx = hexOf(kappa);
  let id = idOf.get(hx); if (id === undefined) { id = sizeById.length; idOf.set(hx, id); sizeById.push(0); }
  if (lru.has(hx)) { const b = lru.get(hx); lru.delete(hx); lru.set(hx, b); trace.push(id); return b; }
  const loc = scan.dir[hx]; const b = readRange(loc.fileOffset, loc.len);
  if (sha256hex(b) !== hx) throw new Error("L5 " + hx);
  sizeById[id] = b.byteLength; trace.push(id);
  lru.set(hx, b); resident += b.byteLength;
  while (resident > CAPTURE && lru.size > 1) { const [ek, ev] = lru.entries().next().value; lru.delete(ek); resident -= ev.byteLength; }
  return b;
};

const argmax = (a) => { let m = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[m]) m = i; return m; };
const prompt = tok.encode(PROMPT, { addSpecial: false, parseSpecial: false });

// ── INCREMENTAL decode: prefill once, then one new position per token via inKV/outKV ──
console.log(`  incremental (KV-cached) decode of ${NGEN} tokens — each token processes ONE new position…`);
const gen = []; t0 = performance.now();
const kv = {};
let logits = forward(scan.plan, graph, null, prompt, { expertDir: scan.expertDir, load, outKV: kv });
gen.push(argmax(logits));
for (let i = 1; i < NGEN; i++) {
  logits = forward(scan.plan, graph, null, prompt.concat(gen), { expertDir: scan.expertDir, load, inKV: kv, outKV: kv });
  gen.push(argmax(logits));
}
const decMs = performance.now() - t0;
closeSync(fd);
const decoded = PROMPT + tok.decode(gen);
const uniqueBytes = sizeById.reduce((a, b) => a + b, 0);
const identical = decoded === EXPECT;
console.log(`  decoded "${decoded.replace(/\n/g, "\\n")}"  in ${(decMs / 1000).toFixed(0)}s`);
console.log(`  vs full-sequence output: ${identical ? "BYTE-IDENTICAL ✓ (KV-cache is lossless)" : "MISMATCH ✗ — inKV path may not cover this arch"}`);
console.log(`  trace = ${trace.length} requests over ${idOf.size} unique blocks (${(uniqueBytes / GiB).toFixed(2)} GiB touched once)`);

// offline sweep vs the incremental trace
function sim(budget) {
  const s = new Map(); let res = 0, miss = 0, hits = 0;
  for (const id of trace) { const sz = sizeById[id];
    if (s.has(id)) { s.delete(id); s.set(id, sz); hits++; continue; }
    miss += sz; s.set(id, sz); res += sz;
    while (res > budget && s.size > 1) { const [ek, ev] = s.entries().next().value; s.delete(ek); res -= ev; }
  }
  return { miss, hitRate: hits / trace.length };
}
console.log(`\n  STREAMED vs budget (INCREMENTAL — compare to full-sequence's 72.35 GiB at every budget):`);
console.log(`    budget      streamed        hit-rate`);
for (const mb of [128, 256, 512, 1024, 2048, 4096]) { const { miss, hitRate } = sim(mb * MiB); console.log(`    ${String(mb).padStart(4)} MiB    ${(miss / GiB).toFixed(2).padStart(6)} GiB (${(miss / uniqueBytes).toFixed(1)}× floor)   ${(100 * hitRate).toFixed(1)}%`); }
console.log(`\n  → KV-cache turns O(n²) weight reads into O(n): each token reads its weights once, not once per position.`);
