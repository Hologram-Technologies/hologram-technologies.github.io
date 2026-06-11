// _shared/holo-immune-adaptive.js — the ADAPTIVE immune classifier (ADR-033 §8.1): the detector that
// LEARNS FROM CONFIRMED ATTACKS, complementing the always-on innate scorer (holo-immune.js). The source
// stages this for "a later phase"; here it is realised natively — a DETERMINISTIC, dependency-free online
// classifier (a Naive-Bayes log-likelihood model) whose model is a PURE FUNCTION of a content-addressed,
// append-only corpus of confirmed examples. So the learned model is itself self-verifying: re-derive the
// corpus and you re-derive the model (Law L5) — no opaque weights, no training run to trust.
//
// Honest by construction (the constitution's own rule): an under-trained model does NOT fabricate
// confidence — below a minimum corpus, or for input whose tokens it has never seen, it returns a low
// confidence and contributes nothing. Learning is the feedback loop: `confirm` appends a labelled
// example, retraining deterministically, so a confirmed attack shape raises the score for similar input.
// OFF by default (a deliberate enable, like blocking). Pure + isomorphic (browser + Node).

import { scoreInnate, regulate } from "./holo-immune.js";

const MIN_TRAIN = 4;          // below this many examples the model abstains (cold-start honesty)
const MIN_CONF = 8;          // corpus size at which corpus-size confidence saturates
const SCALE = 2.5;           // logit → probability temperature

// tokenize(text): deterministic bag of lowercase alphanumeric tokens (length ≥ 3). Training-free.
export const tokenize = (text = "") => (String(text).toLowerCase().match(/[a-z0-9]{3,}/g) || []);

// trainAdaptive(corpus): a Naive-Bayes model — a PURE function of the corpus (sorted vocab, fixed
// Laplace smoothing), so the same corpus always yields the same model (and the same model κ).
export function trainAdaptive(corpus = []) {
  const cls = { attack: { tok: {}, total: 0, docs: 0 }, benign: { tok: {}, total: 0, docs: 0 } };
  const vocabSet = new Set();
  for (const ex of corpus) {
    const c = cls[ex.label]; if (!c) continue;
    c.docs++;
    for (const t of tokenize(ex.text)) { c.tok[t] = (c.tok[t] || 0) + 1; c.total++; vocabSet.add(t); }
  }
  // canonicalize token maps to sorted key order so the serialized model is byte-stable.
  const sortTok = (m) => Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]]));
  return { vocab: [...vocabSet].sort(), N: corpus.length,
    attack: { tok: sortTok(cls.attack.tok), total: cls.attack.total, docs: cls.attack.docs },
    benign: { tok: sortTok(cls.benign.tok), total: cls.benign.total, docs: cls.benign.docs } };
}

// scoreAdaptive(payload, model): a learned risk score in [0,1] + an HONEST confidence. Abstains (score
// 0, learned:false) until the model has both classes and ≥ MIN_TRAIN examples — it never fabricates.
export function scoreAdaptive(payload = "", model = null) {
  if (!model || model.N < MIN_TRAIN || !model.attack.docs || !model.benign.docs)
    return { score: 0, label: "unknown", confidence: 0, learned: false };
  const V = model.vocab.length || 1;
  const toks = tokenize(payload);
  let la = Math.log(model.attack.docs / model.N), lb = Math.log(model.benign.docs / model.N);
  for (const t of toks) {
    la += Math.log(((model.attack.tok[t] || 0) + 1) / (model.attack.total + V));
    lb += Math.log(((model.benign.tok[t] || 0) + 1) / (model.benign.total + V));
  }
  const llr = la - lb;
  const score = 1 / (1 + Math.exp(-llr / SCALE));
  const vocab = new Set(model.vocab);
  const coverage = toks.length ? toks.filter((t) => vocab.has(t)).length / toks.length : 0;
  const confidence = Math.max(0, Math.min(1, coverage * Math.min(1, model.N / MIN_CONF)));
  return { score, label: score >= 0.5 ? "attack" : "benign", confidence, learned: true };
}

// confirm(corpus, {text,label}): the learning step — append a CONFIRMED example (append-only, the way
// the amendment chain only grows). Returns the new corpus; retrain to get the updated model.
export function confirm(corpus = [], example) {
  if (!example || typeof example.text !== "string" || !["attack", "benign"].includes(example.label)) return corpus;
  return [...corpus, { text: example.text, label: example.label }];
}

// assessCombined(payload, opts): the perimeter verdict using BOTH detectors. The adaptive layer is
// OFF unless `enabled` + a `model` are given (so the default is exactly the innate assess — non-
// breaking). When on, the learned score is weighted by its own confidence (an unsure model can't push
// a block), and EITHER layer can raise suspicion (max). Same regulatory gate (observe-only default).
export function assessCombined(payload = "", { model = null, enabled = false, posture = "observe", blockAt = 0.6, reviewAt = 0.3 } = {}) {
  const innate = scoreInnate(payload);
  let adaptive = null, combined = innate.score;
  if (enabled && model) {
    adaptive = scoreAdaptive(payload, model);
    const contribution = adaptive.learned ? adaptive.score * adaptive.confidence : 0;
    combined = Math.max(innate.score, contribution);
  }
  const reg = regulate(combined, { posture, blockAt, reviewAt });
  return { decision: reg.decision, raw: reg.raw, score: combined, innate: innate.score, adaptive,
    hits: innate.hits, posture, observeOnly: reg.observeOnly, adaptiveEnabled: !!(enabled && model) };
}

if (typeof window !== "undefined") window.HoloImmuneAdaptive = { tokenize, trainAdaptive, scoreAdaptive, confirm, assessCombined };
