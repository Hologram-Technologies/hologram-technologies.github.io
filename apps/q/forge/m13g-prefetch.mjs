// m13g-prefetch.mjs — P2c groundwork: how PREDICTABLE is the next token's expert working set?
//
// Prefetch only helps if you can know which expert κ-slices the next token needs while the current token
// computes. Two regimes: (a) high temporal LOCALITY — consecutive tokens reuse experts → a cache/locality
// prefetch suffices; (b) low locality — each token routes to fresh experts → you must PREDICT the next
// token (the speculative drafter) to prefetch its experts. This measures which regime the real model is in,
// on the KV-cached incremental decode (so each token's forward = one position = that token's expert set).
import { openSync, readSync, closeSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { forgeGgufScan } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { makeTokenizer } from "./gguf-forge-tokenizer.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const MODEL = ".models/deepseek-v2-lite-q4_k_m.gguf";
const MiB = 1024 * 1024, GiB = 1024 * MiB, hexOf = (k) => String(k).split(":").pop();
const PROMPT = "The capital of France is", NGEN = 8, CAPTURE = 3 * GiB;

const fd = openSync(MODEL, "r");
const fileSize = statSync(MODEL).size;
const readRange = (off, len) => { const b = Buffer.allocUnsafe(len); let g = 0; while (g < len) { const n = readSync(fd, b, g, len - g, off + g); if (n <= 0) break; g += n; } return new Uint8Array(b.buffer, b.byteOffset, len); };
const headerBytes = readRange(0, Math.min(fileSize, 48 * MiB));
console.log(`range-forging ${MODEL} (${(fileSize / GiB).toFixed(2)} GiB)…`);
let t0 = performance.now();
const scan = await forgeGgufScan(readRange, { headerBytes });
const graph = synthesizeGraph(scan.plan);
const tok = makeTokenizer(headerBytes);
const expertHexes = new Set(Object.values(scan.expertDir.tensors).flatMap((td) => td.experts.map((e) => hexOf(e.kappa))));
const expertBytes = {}; for (const td of Object.values(scan.expertDir.tensors)) for (const e of td.experts) expertBytes[hexOf(e.kappa)] = td.stride;
console.log(`  scanned in ${((performance.now() - t0) / 1000).toFixed(0)}s · ${expertHexes.size} expert slices`);

// loader (roomy cache) that records expert-κ into the CURRENT token's set
let curExperts = new Set();
const lru = new Map(); let resident = 0;
const load = (_s, kappa) => { const hx = hexOf(kappa);
  if (expertHexes.has(hx)) curExperts.add(hx);
  if (lru.has(hx)) { const b = lru.get(hx); lru.delete(hx); lru.set(hx, b); return b; }
  const loc = scan.dir[hx]; const b = readRange(loc.fileOffset, loc.len);
  if (sha256hex(b) !== hx) throw new Error("L5 " + hx);
  lru.set(hx, b); resident += b.byteLength;
  while (resident > CAPTURE && lru.size > 1) { const [ek, ev] = lru.entries().next().value; lru.delete(ek); resident -= ev.byteLength; }
  return b;
};

const argmax = (a) => { let m = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[m]) m = i; return m; };
const prompt = tok.encode(PROMPT, { addSpecial: false, parseSpecial: false });
const perToken = [];   // expert set per generated token
const gen = []; const kv = {};
let logits = forward(scan.plan, graph, null, prompt, { expertDir: scan.expertDir, load, outKV: kv });   // prefill (not counted per-token)
gen.push(argmax(logits));
for (let i = 1; i < NGEN; i++) {
  curExperts = new Set();
  logits = forward(scan.plan, graph, null, prompt.concat(gen), { expertDir: scan.expertDir, load, inKV: kv, outKV: kv });
  perToken.push(curExperts);
  gen.push(argmax(logits));
}
closeSync(fd);
console.log(`  decoded "${(PROMPT + tok.decode(gen)).replace(/\n/g, "\\n")}"`);

// ── analysis ──
const sz = (set) => [...set].reduce((a, h) => a + (expertBytes[h] || 0), 0);
console.log(`\n  per-token expert working set (${perToken.length} decode steps):`);
let locSum = 0, locN = 0, newSum = 0, newBytes = 0;
const seen = new Set();
for (let t = 0; t < perToken.length; t++) {
  const E = perToken[t]; const prev = t > 0 ? perToken[t - 1] : new Set();
  let ov = 0; for (const h of E) if (prev.has(h)) ov++;
  const loc = E.size ? ov / E.size : 0; if (t > 0) { locSum += loc; locN++; }
  let fresh = 0; for (const h of E) if (!seen.has(h)) { fresh++; seen.add(h); }
  newSum += fresh; newBytes += fresh; // count only
  const freshB = [...E].filter(h => !prev.has(h)).reduce((a, h) => a + (expertBytes[h] || 0), 0);
  console.log(`    tok ${t + 1}: ${E.size} expert slices (${(sz(E) / MiB).toFixed(0)} MiB), locality vs prev ${(100 * loc).toFixed(0)}%, ${(freshB / MiB).toFixed(0)} MiB not in prev`);
}
console.log(`\n  mean temporal LOCALITY (experts shared with previous token): ${(100 * locSum / Math.max(1, locN)).toFixed(1)}%`);
console.log(`  cumulative unique experts over ${perToken.length} tokens: ${seen.size} / ${expertHexes.size} (${(100 * seen.size / expertHexes.size).toFixed(0)}%)`);
console.log(`\n  READ THE REGIME:`);
console.log(`   • high locality → a hot-expert cache/locality-prefetch hides most of the stream (no prediction needed).`);
console.log(`   • low locality  → each token routes to fresh experts → you MUST predict the next token (the drafter)`);
console.log(`     and prefetch ITS experts during current-token compute. That is the "context → wider jumps" mechanism.`);
