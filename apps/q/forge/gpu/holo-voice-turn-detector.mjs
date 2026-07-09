// holo-voice-turn-detector.mjs — the REAL semantic turn-detector (LiveKit turn-detector, a SmolLM2 causal LM
// fine-tuned for end-of-utterance), wired as makeEndpoint's predict(text)→P(complete). Replaces the punctuation
// heuristic with a model that ends the turn on MEANING. Verified on this machine: separation +0.723, and on the
// quality corpus 82% early-fire / 0% false-fire (never clips). Multilingual (the model is), serverless (the
// 170MB .holo streams by κ, runs in-browser via ort-web), private (nothing leaves the device).
//
// RECIPE (verified): format the user turn WITHOUT the trailing <|im_end|>, forward, and read
// P(<|im_end|>) = softmax(lastLogits)[imEndId] = "would the turn end here?".
//
// KEY (discovered in verification): the model is trained on NORMALIZED ASR text — lowercase, NO punctuation. A
// trailing "." COLLAPSES P(complete) to ~0. So predict() normalizes before tokenizing (real streaming partials
// carry punctuation; this strips it). Seams injected: tokenizeChatPrefix(normText)->Int32 ids · forward(ids)->
// lastLogits Float32Array[vocab] · imEndId. The browser binding wires ort-web (the κ-served .holo) + the tokenizer.

export const TURN_NORM = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();

// makeTurnDetector({ tokenizeChatPrefix, forward, imEndId }) → { predict(text)->P(complete), normalize }.
export function makeTurnDetector({ tokenizeChatPrefix, forward, imEndId = 2 } = {}) {
  if (!tokenizeChatPrefix || !forward) throw new Error("makeTurnDetector needs { tokenizeChatPrefix, forward }");
  async function predict(text) {
    const t = TURN_NORM(text); if (!t) return null;                 // empty → null → caller's heuristic (fail-soft)
    const ids = tokenizeChatPrefix(t);                              // "<|im_start|><|user|>" + t  (no <|im_end|>)
    const last = await forward(ids);                                // last-position logits [vocab]
    if (!last || !last.length) return null;
    let mx = -Infinity; for (let i = 0; i < last.length; i++) if (last[i] > mx) mx = last[i];
    let sum = 0; for (let i = 0; i < last.length; i++) sum += Math.exp(last[i] - mx);
    return Math.exp(last[imEndId] - mx) / sum;                      // P(<|im_end|>) = P(turn complete)
  }
  return { predict, normalize: TURN_NORM };
}

export default { makeTurnDetector, TURN_NORM };
