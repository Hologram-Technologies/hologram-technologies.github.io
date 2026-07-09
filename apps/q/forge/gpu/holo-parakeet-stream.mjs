// holo-parakeet-stream.mjs — streaming layer over the κ-native Parakeet ear: live mic → growing partials →
// one final fired on MEANING. Reuses the warm GPU ear (transcribe injected), the I2 semantic endpoint
// (holo-voice-endpoint.mjs — fires ~120ms after the utterance reads done, vetoes mid-thought so it never
// clips), and the monotonic stable/tentative shape of the I1 runner.
//
// PRECISION: partials are EXACT — each is a full-attention transcribe of the audio SO FAR (no chunked-attention
// approximation). Because the resident GPU encoder is fast (≤~0.8s at full length, ~0.1s for a command), the
// perceived latency after speech ends = endpoint(~120ms) + one final encode → sub-1s and exact. (Constant-work
// cache-aware chunked streaming — for minute-long dictation — is the further optimization; this is precise-first.)
//
//   createParakeetStream({ transcribe, endpoint, onPartial, onFinal, cadenceMs }) →
//     { feed(pcmChunk, atMs), poll(atMs), end(atMs), reset(), bufferedSec() }
//   transcribe(pcm) -> Promise<{text}>   the warm ear (e.g. (pcm)=>asr.transcribeAudio(pcm))
//   endpoint                              makeEndpoint(...) from holo-voice-endpoint.mjs (optional; null = no auto-end)

const wordPrefix = (a, b) => { const aw = a.split(" "), bw = b.split(" "); let i = 0; while (i < aw.length && i < bw.length && aw[i] === bw[i]) i++; return bw.slice(0, i).join(" "); };

export function createParakeetStream({ transcribe, endpoint = null, onPartial = () => {}, onFinal = () => {}, cadenceMs = 400 } = {}) {
  if (!transcribe) throw new Error("createParakeetStream needs transcribe(pcm)->{text}");
  let buf = [], total = 0, prevText = "", finalFired = false, lastEmitMs = -1e9, inflight = false, partials = 0, encodes = 0, emittedTotal = -1;

  const concat = () => { const a = new Float32Array(total); let o = 0; for (const c of buf) { a.set(c, o); o += c.length; } return a; };

  async function emitPartial(atMs) {
    if (inflight) return null; inflight = true;   // skip overlap: one transcribe in flight at a time
    try {
      const snap = total; const r = await transcribe(concat()); encodes++; emittedTotal = snap;
      const text = (r.text || "").trim();
      const stable = wordPrefix(prevText, text), tentative = text.slice(stable.length).trim();
      prevText = text; partials++;
      const p = { type: "partial", text, stable, tentative, atMs };
      onPartial(p);
      if (endpoint) await endpoint.observe(text, atMs);   // semantic turn-detector reads each partial (memoized, O(1))
      return p;
    } finally { inflight = false; }
  }

  // feed(pcmChunk, atMs) — push one audio window; emits a partial on a cadence (bounded re-transcribe rate).
  async function feed(pcm, atMs) {
    if (finalFired) reset();
    buf.push(pcm); total += pcm.length;
    if (atMs - lastEmitMs >= cadenceMs) { lastEmitMs = atMs; return emitPartial(atMs); }
    return null;
  }

  // poll(atMs) — call on a timer; when the endpoint says fire (semantic-complete early, or silence floor), end.
  async function poll(atMs) {
    if (finalFired || !endpoint) return null;
    const d = endpoint.decide(atMs);
    if (d.fire) return end(atMs, d.reason);
    return d;
  }

  // end(atMs, reason) — settle the final. KEY: the endpoint fires on SILENCE, so the last partial already covers
  // all the audio — reuse it (no re-encode → near-instant perceived latency). Only re-transcribe if audio arrived
  // after the last partial (dirty). This is what moves the heavy work into the during-speech partials.
  async function end(atMs, reason = "explicit") {
    if (finalFired) return null; finalFired = true;
    let text = prevText;
    if (total !== emittedTotal) { const r = await transcribe(concat()); encodes++; text = (r.text || "").trim(); }   // dirty: audio after last partial
    const final = { type: "final", text, reason, atMs, partials, encodes, reused: total === emittedTotal };
    onFinal(final);
    return final;
  }

  function reset() { buf = []; total = 0; prevText = ""; finalFired = false; lastEmitMs = -1e9; partials = 0; encodes = 0; emittedTotal = -1; if (endpoint) endpoint.reset(); }

  return { feed, poll, end, reset, bufferedSec: () => total / 16000, stats: () => ({ partials, encodes }) };
}
export default createParakeetStream;
