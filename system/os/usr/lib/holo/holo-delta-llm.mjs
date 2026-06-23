// holo-delta-llm.mjs — DELTA LLM STREAMING: the same delta principle as the render loop, applied to
// autoregressive decoding. A token's KV (its causal key/value projection) is addressed by κ and run
// through the compute-memo, so:
//   • the KV-CACHE IS THE DELTA — generating token t computes ONE new KV and attends over the cached prior
//     K/V (reads, not recompute), so N tokens cost O(N) computes, not the O(N²) of cacheless re-attention;
//   • the PROMPT PREFIX is computed once and REUSED across every generation that shares it (the prompt /
//     persona cache — the LLM form of "only you travels": a shared system prompt or base context is a hit);
//   • the KV window is BOUNDED — resident memory is the window, not the whole history;
//   • every produced token re-derives to its κ (Law L5), and tokens stream through the κ-stream spine.
//
// Pure + injectable — `produce` (the real KV/logits kernel: (opκ,inκ)→bytes, e.g. fabric/WebGPU) is handed
// in — so the decode accounting is witnessed in Node and the SAME decoder drives a real model in the
// browser. node-, SW- and DOM-safe; no imports (the memo + meter are injected).
//
//   makeDeltaDecoder({ memo, meter?, window? })
//     .step(opκ, inκ, produce, { dtMs? }) → { kappa, bytes, computed, kvReuses, kvSize }
//        opκ : the layer/weights identity   ·   inκ : the causal-context identity of this position
//     .stats() → { computes, hits, kvReuses, tokens, kvSize }   ·   .reset()

export function makeDeltaDecoder({ memo, meter = null, window = Infinity } = {}) {
  if (!memo) throw new Error("holo-delta-llm: needs { memo }");
  let kv = [];                                          // cached K/V κ per position — bounded by `window`
  const stats = { computes: 0, hits: 0, kvReuses: 0, tokens: 0 };

  async function step(opKappa, inKappa, produce, { dtMs = null } = {}) {
    const kvReuses = kv.length;                         // this token attends over every cached prior K/V (reads)
    const res = await memo.compute(opKappa, inKappa, produce);   // ONE new KV — a hit if this causal context was seen
    if (res.computed) stats.computes++; else stats.hits++;
    stats.kvReuses += kvReuses; stats.tokens++;
    kv.push(res.kappa); if (kv.length > window) kv.shift();      // bounded resident KV (low memory)
    if (meter) meter.tokens(1, dtMs == null ? 0 : dtMs);
    return { kappa: res.kappa, bytes: res.bytes, computed: res.computed, kvReuses, kvSize: kv.length };
  }

  return { step, stats: () => ({ ...stats, kvSize: kv.length }), reset: () => { kv = []; } };
}

export default { makeDeltaDecoder };
