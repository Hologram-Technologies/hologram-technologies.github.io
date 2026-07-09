// holo-lora-train-loop.mjs — the PER-USER fine-tune LOOP: the orchestrator that ties the proven LoRA training
// primitives (gguf-forge-lora-train: forward · backward · AdamW · LR sched · masked-CE · κ-checkpoint) into an
// actual SFT loop. THIS is "the model becomes yours": your interactions → an adapter trained ON-DEVICE,
// sealed as a content-addressed κ, loaded back via the inference path (holo-brain-engine cfg.adapter), never
// shipped anywhere. 100% private + serverless.
//
// SCOPE (honest): this loop drives ONE LoRA-adapted linear end-to-end (forward→loss→backward→step→κ) — the
// exact machinery the real run uses — and is fully Node-witnessable (it LEARNS: loss falls, the adapter makes
// the model predict targets W0 alone can't). The PRODUCTION per-user run wraps the SAME primitives around the
// WHOLE transformer (gguf-forge-lora-graph forwardCache/backwardCache) on the GPU with tokenized intent→reply
// pairs — that scale is GPU-bound (OUT-OF-BAND here). sftFromMemory() is the tokenizer seam for that.
import { loraForward, loraBackward, adamwStep, lrForStep, maskedCrossEntropy, saveTrainState, loadTrainState } from "./gguf-forge-lora-train.mjs";

const fr = Math.fround;
// seeded LCG (reproducible init; identical Node↔browser — same family as holo-lora.genTestAdapter)
const lcg = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296 - 0.5; }; };

// trainLoRA — train an adapter {A,B} on (x → targetToken) SFT samples over a FROZEN W0. LoRA convention:
// A small-random, B zero (so the delta starts at 0 and the run begins as the base model, then specialises).
// Returns { A, B, losses, checkpoint:{bytes,kappa}, dims, scale }.
export function trainLoRA({ W0, dims, samples, steps = 300, lr = 0.05, scale = 1.0, seed = 1, schedule = "cosine", warmupSteps = 0 } = {}) {
  const { inn, out, r } = dims;
  const rnd = lcg(seed);
  const A = new Float32Array(r * inn); for (let i = 0; i < A.length; i++) A[i] = fr(rnd() * 0.04);
  const B = new Float32Array(out * r);                                  // zeros → adapter delta = 0 at step 0
  const mA = new Float32Array(A.length), vA = new Float32Array(A.length);
  const mB = new Float32Array(B.length), vB = new Float32Array(B.length);
  const losses = [];
  const sch = { schedule, lrInit: lr, lrMin: fr(lr * 0.1), totalSteps: steps, warmupSteps };
  for (let step = 0; step < steps; step++) {
    const s = samples[step % samples.length];                          // cycle samples (toy; real = shuffled batches)
    const { y, h } = loraForward(W0, A, B, scale, s.x, dims);          // logits = y over `out` (one position, T=1)
    const { loss, dLogits } = maskedCrossEntropy(y, [s.target], [1], 1, out);
    const dy = dLogits.slice(0, out);                                  // dL/dlogits at this position
    const { dA, dB } = loraBackward(B, scale, s.x, h, dy, dims);
    const a = lrForStep(sch, step), t = step + 1;
    adamwStep(A, dA, mA, vA, t, a);                                    // only A,B train; W0 frozen
    adamwStep(B, dB, mB, vB, t, a);
    losses.push(loss);
  }
  const checkpoint = saveTrainState({ t: steps, A, B, mA, vA, mB, vB });   // κ-sealed, L5-verifiable on resume
  return { A, B, losses, checkpoint, dims, scale };
}

// predict — argmax of the (optionally adapted) forward. useAdapter=false → the frozen base model W0 alone.
export function predict(W0, A, B, scale, x, dims, useAdapter = true) {
  const zA = new Float32Array((dims.r * dims.inn)), zB = new Float32Array((dims.out * dims.r));
  const { y } = loraForward(W0, useAdapter ? A : zA, useAdapter ? B : zB, scale, x, dims);
  let mi = 0; for (let o = 1; o < dims.out; o++) if (y[o] > y[mi]) mi = o;
  return mi;
}

// resumeCheckpoint — load a κ-sealed training state (L5: refuses a tampered checkpoint). Resume = load-by-κ.
export function resumeCheckpoint(bytes, expectKappa) { return loadTrainState(bytes, expectKappa); }

// sftFromMemory(records, tokenize) — the SEAM that turns your memory (intents + the replies you up-voted)
// into SFT samples for the real per-user run. tokenize(text)→ids + the model's embedding produce (x,target)
// token pairs; here it is left injectable (the production path supplies the tokenizer + whole-transformer
// forward). Pure shape: each up-voted (intent, reply) → masked next-token targets over the reply.
export function sftFromMemory(records = [], tokenize = null, { eos = null } = {}) {
  if (typeof tokenize !== "function") return [];
  const samples = [];
  for (const r of records) {
    const vote = r["holmem:vote"] || r.vote;
    const prompt = String(r["holmem:text"] || r.text || "");
    const reply = String(((r["holmem:meta"] || r.meta || {}).reply) || "");
    if (vote !== "up" || !prompt) continue;                                 // train ONLY on what you up-voted
    let ids, replyStart;                                                    // SEQUENCE-level, assistant-masked SFT
    if (reply) { const p = tokenize(prompt) || [], c = tokenize(reply) || []; ids = p.concat(c); replyStart = p.length; }
    else { ids = tokenize(prompt) || []; replyStart = 0; }                  // no reply -> learn the user's own phrasing
    if (eos != null) ids = ids.concat([eos]);
    if (ids.length < 2) continue;
    const seq = ids.slice(0, ids.length - 1), targets = [], mask = [];
    for (let t = 0; t < ids.length - 1; t++) { targets.push(ids[t + 1]); mask.push((t + 1) >= replyStart ? 1 : 0); }   // train where target is in the reply
    samples.push({ ids: seq, targets, mask, source: reply ? "reply" : "style" });
  }
  return samples;
}

export default trainLoRA;
