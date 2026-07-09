// holo-streaming-core.mjs — TRUE cache-aware streaming core for a STREAMING-TRAINED FastConformer (the kind
// NeMo exports with cache_support=True: the encoder takes cache_last_channel/cache_last_time and returns the
// next caches, so each chunk is CONSTANT WORK with bounded left-context — unlike windowing the offline model,
// which we MEASURED to be both imprecise and slower, s3/parakeet-cacheaware.html). This plugs straight into the
// I1 runner (voice-stream-runner.mjs) `core` seam, so makeStreamRunner drives it unchanged → { partial }/{ final }.
//
// The model is INJECTED so the harness is testable now (mock) and the real cache-aware encoder + κ-native joint
// drop in when the streaming .holo is forged (see forge-streaming-ear.mjs + the handoff doc):
//   feature(pcmChunk)                 → feats              // log-mel for THIS chunk (nemo128 / model preproc)
//   encodeChunk(feats, caches)        → { encoded:Float32Array[Tc*D], Tc, caches }   // CACHE-AWARE: feeds caches back
//   makeDecoder()                     → joint(encFrame, last, predState) → { out, state }   // κ-native RNNT/TDT joint
//   detokenize(ids)                   → string
//   initCaches()                      → the zero cache tensors for a fresh utterance (model-shaped)
//
// RNNT and TDT are both handled: the decode reads durations only if the joint emits them (out.length > vocabSize);
// a plain RNNT joint (out.length === vocabSize) decodes with dur=0 (advance on blank) — same loop.

export function makeStreamingCore({ feature, encodeChunk, makeDecoder, detokenize, initCaches, blankId = 1024, vocabSize = 1025, maxPerFrame = 10, tentativeTail = 3 } = {}) {
  if (!feature || !encodeChunk || !makeDecoder || !detokenize) throw new Error("makeStreamingCore needs feature, encodeChunk, makeDecoder, detokenize");
  const init = initCaches || (() => null);

  return {
    reset() { return { joint: makeDecoder(), predState: null, last: blankId, tokens: [], stableLen: 0 }; },
    feature(pcmChunk) { return feature(pcmChunk); },

    // CACHE-AWARE encode: constant work per chunk — bounded context carried in `caches`, not re-encoded.
    async encode(feats, encCache) {
      const caches = encCache || init();
      const r = await encodeChunk(feats, caches);
      return { enc: { encoded: r.encoded, Tc: r.Tc }, encCache: r.caches };
    },

    // incremental RNNT/TDT decode over THIS chunk's frames, carrying predictor state. Returns NEWLY-stable tokens
    // (delta — the runner concatenates them) + the revisable tentative tail.
    async decodeStep(enc, decState) {
      const { encoded, Tc } = enc, D = encoded.length / Tc;
      let { joint, predState, last } = decState, t = 0, emitted = 0;
      while (t < Tc) {
        const frame = encoded.subarray(t * D, t * D + D);
        const r = await joint(frame, last, predState);
        const o = r.out;
        let tok = 0, tm = -Infinity; for (let i = 0; i < vocabSize; i++) if (o[i] > tm) { tm = o[i]; tok = i; }
        let dur = 0, dm = -Infinity; for (let i = vocabSize; i < o.length; i++) if (o[i] > dm) { dm = o[i]; dur = i - vocabSize; }
        if (tok !== blankId) { predState = r.state; decState.tokens.push(tok); last = tok; emitted++; }
        if (dur > 0) { t += dur; emitted = 0; }
        else if (tok === blankId || emitted === maxPerFrame) { t += 1; emitted = 0; }
      }
      decState.predState = predState; decState.last = last;
      const tok = decState.tokens, newStable = Math.max(decState.stableLen, tok.length - tentativeTail);
      const stable = tok.slice(decState.stableLen, newStable); decState.stableLen = newStable;
      const tentative = tok.slice(newStable);
      return { stable, tentative, decState };
    },

    detokenize(ids) { return detokenize(ids); },
  };
}
export default makeStreamingCore;
