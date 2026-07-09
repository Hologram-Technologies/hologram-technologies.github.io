// holo-voice-respond-prewarm.mjs — C0: SPECULATIVE RESPONSE. Q starts generating its answer from a PARTIAL
// transcript, as soon as the partial reads COMPLETE, and commits it the instant the turn ends — so the lag
// between "you stop talking" and "Q starts answering" collapses to ~the endpoint wait. The brain-response twin
// of holo-voice-intent.mjs (I3, which pre-warms ACTIONS): same shape, same O(1) memo, same bounded-waste +
// side-effect-free guarantees. The ONLY side effect is at commit (finalize); pre-warm just generates-and-holds.
//
// O(1), FULL-STACK: every speculative generate goes through the L1/L2 content-addressed compute memo
// (holo-compute-memo.mjs), keyed by the normalized partial — so a stable thought across many partials (a held
// pause repeats the SAME text) is generated ONCE and replayed. Serverless, DOM-free, browser+mobile.
//
// GATING (inverse of I3's "questions never speculate"): here we speculate ONLY when the partial reads DONE
// (readsComplete) — never burn the brain on a dangling mid-thought, and never pre-commit a thought the user is
// still forming (the endpoint veto stays authoritative; this only PRE-warms, the endpoint still decides the turn).

import { defaultHeuristic } from "./holo-voice-endpoint.mjs";

const norm = (t) => String(t || "").trim().replace(/\s+/g, " ").toLowerCase();
// reads-complete: reuse the I2 endpoint heuristic (terminal punctuation / not a dangling connective) ≥ 0.7.
const defaultReadsComplete = (t) => defaultHeuristic(t) >= 0.7;

// makeSpeculativeRespond({ generate, memo, readsComplete, modelTag }) → controller.
//   generate(text)       : async → the brain's response (string / {text,…}) for `text`. SIDE-EFFECT-FREE here.
//   memo                 : makeComputeMemo({...}) — speculative-generate dedup is O(1) L1/L2.
//   readsComplete(text)  : → bool — only a complete-looking partial speculates (default: the I2 heuristic ≥ 0.7).
export function makeSpeculativeRespond({ generate, memo, readsComplete = defaultReadsComplete, modelTag = "respond-prewarm@v1" } = {}) {
  if (!generate || !memo) throw new Error("makeSpeculativeRespond needs { generate, memo }");
  let candidateText = null, candidateResp = null;

  // warm(text) — generate the response, memoized by normalized text (runs the brain ONCE per distinct thought).
  async function warm(text) {
    const res = await memo.compute(modelTag, norm(text), async () => {
      const r = await generate(text);
      return new TextEncoder().encode(JSON.stringify(r ?? null));
    });
    return { resp: JSON.parse(new TextDecoder().decode(res.bytes)), hit: res.hit, computed: res.computed };
  }

  // onPartial(text) — speculate from a live partial. Pre-generates IFF the partial reads complete. No commit.
  async function onPartial(text) {
    if (!readsComplete(text)) return { speculating: false, reason: "mid-thought" };
    const w = await warm(text);
    candidateText = norm(text); candidateResp = w.resp;
    return { speculating: true, hit: w.hit, computed: w.computed };
  }

  // finalize(finalText) — the turn ended (I2 endpoint). If the final == the pre-warmed candidate, the response is
  // already generated (prewarmed:true, ZERO extra brain calls). If it changed, REVISE: generate the new text
  // (cheap + memoized). The caller speaks the returned response. State resets for the next utterance.
  async function finalize(finalText) {
    const ft = norm(finalText);
    const prewarmed = candidateText !== null && ft === candidateText;
    let resp = candidateResp;
    if (!prewarmed) { const w = await warm(finalText); resp = w.resp; }
    const out = { response: resp, prewarmed, revised: !prewarmed };
    reset();
    return out;
  }

  function reset() { candidateText = null; candidateResp = null; }
  return { onPartial, finalize, reset, state: () => ({ candidateText }) };
}

export default { makeSpeculativeRespond };
