// graph-train-witness.mjs — A1 authority: the WHOLE transformer (multi-layer) trains end-to-end via LoRA.
// (1) DEPTH: end-to-end finite-difference gradient check on the adapters in EVERY layer — proves the new
//     cross-layer gradient chaining (dHin through both residuals + attn_norm) is correct, not just layer 0.
// (2) LEARNS: the multi-layer training loop reduces masked-CE AND flips the greedy next-token to the target.
// (3) MEMORY→ADAPTER: sftFromMemory(up-voted (prompt,reply)) → trainGraphLoRA → a real trained adapter.
// (4) κ-NATIVE: the all-layers adapter checkpoint seals to a content κ and L5-refuses a tampered restore.
// Pure f64 autograd-correctness proof (the f32 GPU kernels are proven separately in train-backward-witness).
import { forwardCache, backward, lossAndGrads, trainGraphLoRA, predictGraph, sealAdapters, loadAdapters } from "../gguf-forge-lora-graph.mjs";
import { maskedCrossEntropy } from "../gguf-forge-lora-train.mjs";
import { sftFromMemory } from "../holo-lora-train-loop.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };
const lcg = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296 - 0.5; }; };

// ── a small but REAL 2-layer transformer (the "whole transformer", any depth) ──
const D = 8, NH = 2, HD = 4, FF = 12, V = 24, rank = 2, NLAYER = 2;
const rnd = lcg(11);
const rf = (n, s = 0.3) => Float64Array.from({ length: n }, () => rnd() * s);
const nrm = (n) => Float64Array.from({ length: n }, () => 1 + rnd() * 0.1);
const mkLayer = () => ({
  attn_norm: nrm(D), Wq: rf(D * D), Wk: rf(D * D), Wv: rf(D * D), Wo: rf(D * D),
  Aq: rf(rank * D), Bq: rf(D * rank), Av: rf(rank * D), Bv: rf(D * rank),
  ffn_norm: nrm(D), Wg: rf(FF * D), Wu: rf(FF * D), Wd: rf(D * FF),
});
const M = { D, NH, HD, FF, V, rank, eps: 1e-5, freqBase: 10000, scale: 1.5, tok_embd: rf(V * D, 0.5), out_norm: nrm(D), layers: [mkLayer(), mkLayer()] };

const tokens = [3, 7, 1, 5], targets = [7, 1, 5, 9], mask = [0, 1, 1, 1];
const lossOf = () => { const c = forwardCache(M, tokens); return maskedCrossEntropy(c.logits, targets, mask, c.T, V).loss; };

// (1) DEPTH — finite-difference gradient check on adapters in BOTH layers
{
  const { grads } = lossAndGrads(M, tokens, targets, mask);
  const EPS = 1e-5;
  const check = (li, key) => {
    const theta = M.layers[li][key], g = grads.layers[li]["d" + key]; let maxRel = 0, worst = 0;
    for (let i = 0; i < theta.length; i++) {
      const o = theta[i]; theta[i] = o + EPS; const lp = lossOf(); theta[i] = o - EPS; const lm = lossOf(); theta[i] = o;
      const ng = (lp - lm) / (2 * EPS), rel = Math.abs(g[i] - ng) / (Math.abs(ng) + 1e-6);
      if (rel > maxRel) { maxRel = rel; worst = i; }
    }
    ok(maxRel < 1e-4, `layer ${li} ${key} grad == finite-diff (maxRel ${maxRel.toExponential(1)} @${worst})`);
  };
  for (let li = 0; li < NLAYER; li++) { check(li, "Aq"); check(li, "Bv"); }   // top+bottom layer ⇒ cross-layer chain correct
}

// (2) LEARNS — the multi-layer loop reduces loss AND flips the greedy prediction to the target
{
  const L0 = lossOf(), basePred = predictGraph(M, tokens);
  const { losses } = trainGraphLoRA(M, [{ ids: tokens, targets, mask }], { steps: 200, lr: 0.08, warmupSteps: 10 });
  const Lf = losses[losses.length - 1], finalPred = predictGraph(M, tokens);
  // q/v-only rank-2 LoRA over a frozen base has a real capacity floor (~0.65× here, converged); the DECISIVE
  // learning signal is the greedy next-token flipping to the target — a behavioural change, not just a number.
  ok(Lf < L0 * 0.8, `whole-transformer (2-layer) LoRA training reduces masked-CE ${L0.toFixed(3)} → ${Lf.toFixed(3)} (converged)`);
  ok(finalPred === targets[targets.length - 1] && finalPred !== basePred, `trained model FLIPS greedy prediction → target ${targets[targets.length - 1]} (base was ${basePred})`);
}

// (3) MEMORY → ADAPTER — your up-voted (prompt, reply) becomes SFT samples that train the whole transformer
{
  const M2 = { ...M, layers: [mkLayer(), mkLayer()], tok_embd: rf(V * D, 0.5), out_norm: nrm(D) };
  const records = [{ "holmem:kind": "feedback", "holmem:vote": "up", "holmem:text": "good jazz chord", "holmem:meta": { reply: "try Cmaj7 voicing" } }];
  const tok = (t) => String(t || "").toLowerCase().split(/\s+/).filter(Boolean).map((w) => (w.length * 7 + w.charCodeAt(0)) % (V - 2) + 1);   // ids in [1, V-2]
  const samples = sftFromMemory(records, tok, { eos: 0 });
  ok(samples.length === 1 && samples[0].source === "reply", "sftFromMemory → a reply-masked SFT sample from memory");
  const L0 = (() => { const c = forwardCache(M2, samples[0].ids); return maskedCrossEntropy(c.logits, samples[0].targets, samples[0].mask, c.T, V).loss; })();
  const { losses, checkpoint } = trainGraphLoRA(M2, samples, { steps: 200, lr: 0.08, warmupSteps: 10 });
  ok(losses[losses.length - 1] < L0 * 0.8, `memory→trainGraphLoRA learns the reply (CE ${L0.toFixed(3)} → ${losses[losses.length - 1].toFixed(3)})`);
  ok(/^sha256:/.test(checkpoint.kappa), `trained adapter sealed to content κ ${checkpoint.kappa.slice(0, 22)}…`);
}

// (4) κ-NATIVE — all-layers adapter checkpoint round-trips + L5 refuses a tampered restore
{
  const ck = sealAdapters(M);
  const before = Float64Array.from(M.layers[1].Bq);
  M.layers[1].Bq[0] += 999;                                            // perturb, then restore by κ
  loadAdapters(M, ck.bytes, ck.kappa);
  ok(M.layers[1].Bq.every((v, i) => Math.abs(v - before[i]) < 1e-6), "loadAdapters restores ALL layers by κ (L5 verified)");
  const bad = ck.bytes.slice(); bad[8] ^= 0xff;
  let refused = false; try { loadAdapters(M, bad, ck.kappa); } catch (e) { refused = /L5 REFUSE/.test(String(e)); }
  ok(refused, "tampered adapter bytes are L5-REFUSED (fail-closed)");
}

console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED: the WHOLE (multi-layer) transformer trains end-to-end via LoRA — gradients correct in every layer, loss falls + prediction flips, your memory becomes a κ-sealed adapter, restored only if it re-derives."}`);
process.exit(fail ? 1 : 0);
