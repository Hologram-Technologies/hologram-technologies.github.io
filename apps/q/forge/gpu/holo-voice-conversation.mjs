// holo-voice-conversation.mjs — C3: the conversation ORCHESTRATOR. Ties the listen stream (partials), the
// speculative response pre-warm (C0), the streaming clause-speak (C1), and barge-in (C2) into one loop so the
// full turn — you stop talking → Q is speaking — collapses to ~the endpoint wait. The streaming ear feeds
// partials; a complete-looking partial pre-generates the answer; at the endpoint the answer is already there and
// the first clause plays immediately; if you cut in, Q stops and the interruption becomes the next turn.
//
// All faculties injected (brain `generate`, `speak`, `memo`) so the loop is testable headless; the browser
// binding wires the real holo-voice-holo-brain + holo-voice-tts (kokoro) + holo-compute-memo + voice.js streamTurn.
import { makeSpeculativeRespond } from "./holo-voice-respond-prewarm.mjs";
import { makeClauseSpeaker } from "./holo-voice-clause-speak.mjs";
import { makeBargeController } from "./holo-voice-barge.mjs";

const now = () => (globalThis.performance ? performance.now() : Date.now());

// makeConversation({ generate, speak, memo, readsComplete, onClause, onFirstAudio, barge }) → controller.
//   generate(text) -> {text}|string   the brain (response for a transcript)
//   speak(clause)  -> Promise          kokoro TTS for one clause
//   memo                                holo-compute-memo (pre-warm + clause dedup)
export function makeConversation({ generate, speak, memo, readsComplete, onClause = () => {}, onFirstAudio = () => {}, onTurn = () => {}, barge = {} } = {}) {
  if (!generate || !speak || !memo) throw new Error("makeConversation needs { generate, speak, memo }");
  const spec = makeSpeculativeRespond({ generate, memo, readsComplete });
  let speaking = false, aborted = false, cs = null, turnStartMs = 0, firstAudioMs = -1;

  // feedPartial(text) — from the listen stream (each rolling partial). Pre-warms the response speculatively.
  async function feedPartial(text) { return spec.onPartial(text); }

  // endTurn(finalText) — the I2 endpoint fired. Commit the (pre-warmed) response and speak it clause-by-clause.
  // Returns { response, prewarmed, firstAudioMs, doneMs }. firstAudioMs = stop→first audio (the latency that matters).
  async function endTurn(finalText) {
    turnStartMs = now(); firstAudioMs = -1; aborted = false; speaking = true;
    const { response, prewarmed } = await spec.finalize(finalText);   // INSTANT when pre-warmed (memo hit)
    const text = (response && response.text) || String(response || "");
    cs = makeClauseSpeaker({ speak, memo, onClause: (e) => { if (firstAudioMs < 0) { firstAudioMs = now() - turnStartMs; onFirstAudio(firstAudioMs); } onClause(e); } });
    if (!aborted) { cs.feed(text); await cs.flush(); }
    speaking = false;
    // C4 provenance seam: seal the turn (utterance + response) — production binds holo-voice-provenance
    // makeUtteranceLog (I4: verifiable holo-strand append + omni-index recall). No-op + injected for testing.
    if (!aborted) { try { await onTurn({ utterance: finalText, response: text, prewarmed }); } catch (e) {} }
    return { response, prewarmed, firstAudioMs, doneMs: now() - turnStartMs };
  }

  // C2 barge: wire the mic tick here while Q is speaking. On barge → stop TTS + abort + (caller starts a turn).
  const barger = makeBargeController(Object.assign({
    stopSpeaking: () => { aborted = true; if (cs) cs.reset(); speaking = false; },
    abortGenerate: () => { aborted = true; },
    startTurn: () => {},
  }, barge));
  function onMicFrame(userLevel, ctx) { return barger.onFrame(userLevel, Object.assign({ qSpeaking: speaking }, ctx)); }

  function reset() { spec.reset(); barger.reset(); if (cs) cs.reset(); speaking = false; aborted = false; }
  return { feedPartial, endTurn, onMicFrame, reset, isSpeaking: () => speaking };
}

export default { makeConversation };
