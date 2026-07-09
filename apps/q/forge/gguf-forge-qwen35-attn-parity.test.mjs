#!/usr/bin/env node
// gguf-forge-qwen35-attn-parity.test.mjs — NUMERICAL parity of the qwen35 FULL-attention layer
// (gguf-forge-qwen35-attn.mjs) vs HF Qwen3NextAttention (gated GQA + per-head QK-norm + partial NEOX RoPE +
// sigmoid output gate), on identical weights + input + cos/sin. Fixture: gguf-forge-qwen35-attn-parity.gen.py.
// Pass: every token cosine > 0.9999 AND max relative-L2 < 1e-3.
//
// Usage: node holo-apps/apps/q/forge/gguf-forge-qwen35-attn-parity.test.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { qwen35Attention } from "./gguf-forge-qwen35-attn.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(join(here, "gguf-forge-qwen35-attn-parity.fixture.json"), "utf8"));
const F = (a) => Float32Array.from(a);
const D = ref.dims, W = Object.fromEntries(Object.entries(ref.W).map(([k, v]) => [k, F(v)]));
const xSeq = ref.x.map(F), yRef = ref.y.map(F), cosSeq = ref.cos.map(F), sinSeq = ref.sin.map(F);

const r = qwen35Attention(W, D, xSeq, cosSeq, sinSeq, { inputNormed: true });

const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / (Math.sqrt(na) * Math.sqrt(nb) + 1e-30); };
const relL2 = (a, b) => { let e = 0, n = 0; for (let i = 0; i < a.length; i++) { e += (a[i] - b[i]) ** 2; n += b[i] * b[i]; } return Math.sqrt(e / (n + 1e-30)); };

let minCos = 1, maxRel = 0; const per = [];
for (let t = 0; t < yRef.length; t++) { const c = cos(r.ySeq[t], yRef[t]), e = relL2(r.ySeq[t], yRef[t]); minCos = Math.min(minCos, c); maxRel = Math.max(maxRel, e); per.push({ t, cos: +c.toFixed(6), relL2: e }); }

const witnessed = minCos > 0.9999 && maxRel < 1e-3;
writeFileSync(join(here, "gguf-forge-qwen35-attn-parity.test.result.json"), JSON.stringify({
  spec: "qwen35 full-attention layer numerically exact vs HF Qwen3NextAttention: q_proj packs q|gate per head, per-head QK-RMSNorm, partial NEOX RoPE (rotate_half over rope_dim, pass-through rest), GQA causal softmax (scale 1/√head_dim), attn_out·sigmoid(gate), o_proj.",
  authority: "HF transformers modeling_qwen3_next (Qwen3NextAttention, eager path) · fixture via gguf-forge-qwen35-attn-parity.gen.py",
  minCosine: minCos, maxRelL2: maxRel, perToken: per, witnessed,
}, null, 2) + "\n");

for (const p of per) console.log(`  t=${p.t}  cos=${p.cos.toFixed(6)}  relL2=${p.relL2.toExponential(2)}`);
console.log(`min cosine=${minCos.toFixed(6)}  max relL2=${maxRel.toExponential(2)}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ qwen35 attention layer is numerically exact to HF" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
