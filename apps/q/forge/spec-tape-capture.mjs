#!/usr/bin/env node
// spec-tape-capture.mjs — capture greedy token "tapes" from a REAL model for spec-p0-eval.mjs.
//
// A tape = { prompt: [ids], greedy: [ids] } where greedy is the model's greedy (argmax) continuation.
// These are the verification ground truth for the offline speculative-decode evaluator: committed
// tokens ARE the greedy tape, so any drafter can be scored against them with no model in the loop.
//
// Model-agnostic (same forge path as m13-generate.mjs). Defaults to qwen2.5-0.5b for a fast, real
// baseline that validates the whole pipeline; point --model at qwen3.5-9b-thinking .gguf for the true
// target (CPU forward is I/O-bound-slow on 9B — use few/short prompts, or capture on GPU later).
//
// USAGE:
//   node spec-tape-capture.mjs                         # 0.5b, default prompts, 48 tokens each
//   node spec-tape-capture.mjs --new 64 --out tapes.json
//   node spec-tape-capture.mjs --model .models/Qwen3.5-9B-...Q4_K_M.gguf --new 24

import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { makeTokenizer } from "./gguf-forge-tokenizer.mjs";

const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const MODEL = val("--model", ".models/qwen2.5-0.5b-instruct-q4_k_m.gguf");
const NEW = parseInt(val("--new", "48"), 10);
const OUT = val("--out", "spec-tapes.json");

const PROMPTS = [
  "The capital of France is",
  "def fibonacci(n):\n    if n < 2:\n        return n\n    return ",
  "Q: What is 17 times 23?\nA: Let me work through this step by step. ",
  "Once upon a time, in a small village nestled between two mountains, ",
  "import numpy as np\ndef normalize(x):\n    ",
  "The three laws of thermodynamics state that ",
];

console.log(`loading ${MODEL} …`);
const buf = new Uint8Array(readFileSync(MODEL));
const f = forgeGguf(buf); const graph = synthesizeGraph(f.plan);
const tok = makeTokenizer(buf);
const load = (st, k) => f.blocks.get(String(k).split(":").pop());
const argmax = (l) => { let a = 0; for (let i = 1; i < l.length; i++) if (l[i] > l[a]) a = i; return a; };

const tapes = [];
let totalTok = 0; const t0 = performance.now();
for (const text of PROMPTS) {
  const prompt = tok.encode(text, { addSpecial: false, parseSpecial: false });
  const toks = prompt.slice(); const greedy = [];
  const ts = performance.now();
  process.stdout.write(`  "${text.slice(0, 32).replace(/\n/g, "⏎")}…" `);
  for (let i = 0; i < NEW; i++) { const lg = forward(f.plan, graph, {}, toks, { load }); const nx = argmax(lg); toks.push(nx); greedy.push(nx); process.stdout.write("."); }
  totalTok += NEW;
  const ms = performance.now() - ts;
  process.stdout.write(` ${(NEW / (ms / 1000)).toFixed(2)} tok/s\n`);
  tapes.push({ prompt, greedy, text });
  writeFileSync(OUT, JSON.stringify({ model: MODEL, new: NEW, tapes }, null, 0));   // incremental: partial work survives an early stop
}
const secs = (performance.now() - t0) / 1000;

writeFileSync(OUT, JSON.stringify({ model: MODEL, new: NEW, tapes }, null, 0));
console.log(`\nwrote ${tapes.length} tapes (${totalTok} greedy tokens, ${secs.toFixed(1)}s) → ${OUT}`);
console.log(`next: node spec-p0-eval.mjs --tapes ${OUT}`);
