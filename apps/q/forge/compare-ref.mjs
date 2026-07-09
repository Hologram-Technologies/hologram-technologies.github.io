// Bit-fidelity witness: compare the Tier-A executor's logits to upstream
// qvac-fabric-llm.cpp (forge-ref.exe, CPU/generic) on identical token ids.
// Contractual bar (per the plan): greedy-token parity exact; logits within tolerance.
// ref-logits.bin produced by: forge-ref.exe <model> ref-logits.bin <tokens...>

import { readFileSync } from "node:fs";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const M = ".models";
const tokens = [785, 6722, 374, 264];
const ref = new Float32Array(readFileSync(`${M}/ref-logits.bin`).buffer);

const buf = new Uint8Array(readFileSync(`${M}/qwen2.5-0.5b-instruct-q4_k_m.gguf`));
const f = forgeGguf(buf);
const graph = synthesizeGraph(f.plan);
const store = { get: (h) => f.blocks.get(h) };
const verified = new Set();
const load = (st, k) => { const h = String(k).split(":").pop(); const b = st.get(h); if (!verified.has(h)) { if (sha256hex(b) !== h) throw new Error("L5 " + k); verified.add(h); } return b; };

const got = forward(f.plan, graph, store, tokens, { load });
if (got.length !== ref.length) { console.error(`length mismatch ${got.length} vs ${ref.length}`); process.exit(1); }

const argmax = (a) => { let m = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[m]) m = i; return m; };
const topk = (a, k) => Array.from(a.keys()).sort((x, y) => a[y] - a[x]).slice(0, k);

let maxAbs = 0, sumAbs = 0, dot = 0, na = 0, nb = 0;
for (let i = 0; i < ref.length; i++) {
  const d = Math.abs(got[i] - ref[i]); if (d > maxAbs) maxAbs = d; sumAbs += d;
  dot += got[i] * ref[i]; na += got[i] * got[i]; nb += ref[i] * ref[i];
}
const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
const amG = argmax(got), amR = argmax(ref);
const t5G = topk(got, 5), t5R = topk(ref, 5);
const overlap = t5G.filter((x) => t5R.includes(x)).length;

console.log(`tokens: [${tokens.join(", ")}]  n_vocab=${ref.length}`);
console.log(`ref   argmax=${amR} top5=${t5R.join(",")}`);
console.log(`forge argmax=${amG} top5=${t5G.join(",")}`);
console.log(`logit agreement: cosine=${cos.toFixed(6)}  maxAbs=${maxAbs.toFixed(4)}  meanAbs=${(sumAbs / ref.length).toFixed(5)}`);
console.log(`greedy-token parity: ${amG === amR ? "MATCH" : "MISMATCH"}   top-5 overlap: ${overlap}/5`);

const pass = amG === amR && cos > 0.999 && overlap >= 4;
console.log(`\n${pass ? "PASS" : "FAIL"} — Tier-A executor vs upstream llama.cpp (greedy-parity + logit tolerance)`);
process.exit(pass ? 0 : 1);
