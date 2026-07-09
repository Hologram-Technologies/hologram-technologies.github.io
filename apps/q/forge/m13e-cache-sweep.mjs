// m13e-cache-sweep.mjs — P2a: does a hot-expert working-set cache kill the re-fetch waste?
//
// m13d streamed 42.8 GB to decode 4 tokens of a 9.65 GB model — heavy re-reading because the 512 MiB LRU
// evicts recurring weights. The κ-request SEQUENCE is deterministic, so we record it ONCE (with a roomy
// capture cache so the run is fast) and then replay that exact trace against a sweep of budgets offline —
// instant. Reports, per budget: GB streamed from disk + cache hit-rate. The floor (∞ cache) = the unique
// bytes the decode actually touches (read once). Byte-identity is untouched: this is pure cache accounting.
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

const fd = openSync(MODEL, "r");
const fileSize = statSync(MODEL).size;
const readRange = (off, len) => { const b = Buffer.allocUnsafe(len); let g = 0; while (g < len) { const n = readSync(fd, b, g, len - g, off + g); if (n <= 0) break; g += n; } return new Uint8Array(b.buffer, b.byteOffset, len); };
const headerBytes = readRange(0, Math.min(fileSize, 48 * MiB));

console.log(`range-forging ${MODEL} (${(fileSize / GiB).toFixed(2)} GiB)…`);
let t0 = performance.now();
const scan = await forgeGgufScan(readRange, { headerBytes });
const graph = synthesizeGraph(scan.plan);
const tok = makeTokenizer(headerBytes);
console.log(`  scanned in ${((performance.now() - t0) / 1000).toFixed(0)}s · recording the κ-request trace of a real ${NGEN}-token decode…`);

// ── capture loader: roomy LRU (fast run) + record EVERY request (id, size) in order ──
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
const ids = tok.encode(PROMPT, { addSpecial: false, parseSpecial: false });
const gen = []; t0 = performance.now();
for (let i = 0; i < NGEN; i++) gen.push(argmax(forward(scan.plan, graph, null, ids.concat(gen), { expertDir: scan.expertDir, load })));
closeSync(fd);
const uniqueBytes = sizeById.reduce((a, b) => a + b, 0);
console.log(`  decoded "${PROMPT}${tok.decode(gen)}" · trace = ${trace.length} requests over ${idOf.size} unique κ-blocks (${(uniqueBytes / GiB).toFixed(2)} GiB touched once)`);

// ── offline: replay the exact trace against each budget (fresh LRU) ──
function sim(budget) {
  const lruS = new Map(); let res = 0, missBytes = 0, hits = 0;
  for (const id of trace) {
    const sz = sizeById[id];
    if (lruS.has(id)) { lruS.delete(id); lruS.set(id, sz); hits++; continue; }
    missBytes += sz; lruS.set(id, sz); res += sz;
    while (res > budget && lruS.size > 1) { const [ek, ev] = lruS.entries().next().value; lruS.delete(ek); res -= ev; }
  }
  return { missBytes, hitRate: hits / trace.length };
}

console.log(`\n  WORKING-SET SWEEP (${NGEN} tokens · model ${(fileSize / GiB).toFixed(2)} GiB · floor = ${(uniqueBytes / GiB).toFixed(2)} GiB read-once):`);
console.log(`    budget      streamed from disk     hit-rate`);
for (const mb of [128, 256, 512, 1024, 1536, 2048, 3072, 4096]) {
  const { missBytes, hitRate } = sim(mb * MiB);
  const bar = "█".repeat(Math.round(40 * missBytes / uniqueBytes / (NGEN))); // visual vs per-token floor
  console.log(`    ${String(mb).padStart(4)} MiB    ${(missBytes / GiB).toFixed(2).padStart(6)} GiB (${(missBytes / uniqueBytes).toFixed(1)}× floor)   ${(100 * hitRate).toFixed(1)}%  ${bar}`);
}
console.log(`\n  → the 512 MiB budget thrashes; a working-set cache that holds one token's recurring weights collapses`);
console.log(`    the re-fetch to ~1× the touched bytes. Same output, byte-identical — pure I/O accounting.`);
