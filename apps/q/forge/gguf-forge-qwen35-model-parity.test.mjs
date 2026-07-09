#!/usr/bin/env node
// gguf-forge-qwen35-model-parity.test.mjs — WHOLE-MODEL numerical parity: qwen35Forward (gguf-forge-qwen35-model.mjs)
// vs HF Qwen3NextForCausalLM on a tiny 4-layer model (3 linear + 1 attention, dense SwiGLU MLP, embed + final
// norm + lm_head). Proves the end-to-end WIRING — layer stacking, residual structure, the schedule, MLP, embed,
// the (1+weight) norms, and lm_head — is correct, and that argmax matches HF's predicted token at every position.
// Fixture: gguf-forge-qwen35-model-parity.gen.py. Pass: per-token logits cosine > 0.9999, relL2 < 1e-3, argmax ==.
//
// Usage: node holo-apps/apps/q/forge/gguf-forge-qwen35-model-parity.test.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { qwen35Forward, argmax } from "./gguf-forge-qwen35-model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(join(here, "gguf-forge-qwen35-model-parity.fixture.json"), "utf8"));
const F = (a) => Float32Array.from(a);
const model = {
  D: ref.D,
  token_embd: F(ref.token_embd), output_norm: F(ref.output_norm), lm_head: F(ref.lm_head),
  cos: ref.cos.map(F), sin: ref.sin.map(F),
  layers: ref.layers.map((l) => ({ type: l.type, W: Object.fromEntries(Object.entries(l.W).map(([k, v]) => [k, F(v)])) })),
};
const logits = qwen35Forward(model, ref.ids);
const yRef = ref.logits.map(F);

const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / (Math.sqrt(na) * Math.sqrt(nb) + 1e-30); };
const relL2 = (a, b) => { let e = 0, n = 0; for (let i = 0; i < a.length; i++) { e += (a[i] - b[i]) ** 2; n += b[i] * b[i]; } return Math.sqrt(e / (n + 1e-30)); };

let minCos = 1, maxRel = 0, argOk = true; const per = [];
for (let t = 0; t < yRef.length; t++) {
  const c = cos(logits[t], yRef[t]), e = relL2(logits[t], yRef[t]), am = argmax(logits[t]) === argmax(yRef[t]);
  minCos = Math.min(minCos, c); maxRel = Math.max(maxRel, e); argOk = argOk && am;
  per.push({ t, cos: +c.toFixed(6), relL2: e, tok: argmax(logits[t]), refTok: argmax(yRef[t]) });
}
const witnessed = minCos > 0.9999 && maxRel < 1e-3 && argOk;
writeFileSync(join(here, "gguf-forge-qwen35-model-parity.test.result.json"), JSON.stringify({
  spec: "Whole qwen35 model forward numerically exact vs HF Qwen3NextForCausalLM (tiny 4-layer: 3 gated-DeltaNet linear + 1 gated attention, dense SwiGLU MLP, embed + final RMSNorm + lm_head). Validates end-to-end wiring: per-layer residual structure, the linear/attention schedule, MLP, embedding lookup, (1+weight) norms, lm_head, and that the predicted argmax token matches HF at every position.",
  authority: "HF transformers Qwen3NextForCausalLM (torch reference) · fixture via gguf-forge-qwen35-model-parity.gen.py",
  minCosine: minCos, maxRelL2: maxRel, argmaxMatches: argOk, perToken: per, witnessed,
}, null, 2) + "\n");

for (const p of per) console.log(`  t=${p.t}  cos=${p.cos.toFixed(6)}  relL2=${p.relL2.toExponential(2)}  tok=${p.tok}${p.tok === p.refTok ? "==" : "!="}${p.refTok}`);
console.log(`min cosine=${minCos.toFixed(6)}  max relL2=${maxRel.toExponential(2)}  argmax all match: ${argOk}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ whole qwen35 model is numerically exact to HF + token-for-token" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
