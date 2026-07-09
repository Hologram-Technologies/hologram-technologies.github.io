// holo-voice-conversation-wire.mjs — S1: the PRODUCTION wiring that binds the REAL Q faculties into the
// conversation loop (holo-voice-conversation.mjs). This is the glue S2 drops into voice.js — kept here so it
// seals with the loop and is verified against the real faculty INTERFACES (the heavy models themselves run on
// the Range-serving native host; this module is the seam, not the model).
//
//   real brain  (voice/holo-voice-holo-brain.mjs createHoloModelBrain) → { load, generate(history)→Δ-stream, chat(history)→text }
//   real TTS    (voice/holo-voice-tts.mjs createTTS / createTieredTTS)  → { load, synth(text)→{audio:Float32Array, sampling_rate} }
//   memo        (holo-compute-memo.mjs)                                 → the O(1) pre-warm + clause cache
//
// brainGenerate adapts chat(history)→text to the loop's generate(text)→{text}; ttsSpeak adapts synth(text)→audio
// to speak(clause)→Promise (plays + resolves when the clause finishes); wireConversation assembles makeConversation.

import { makeConversation } from "./holo-voice-conversation.mjs";

// generate(text) → { text } via the brain's chat(history). `history()` injects prior turns (Q's memory) so the
// answer is contextual; the speculative pre-warm keys the memo by the partial text (a stable thought = 1 call).
export function brainGenerate(brain, { system = null, history = () => [] } = {}) {
  if (!brain || !brain.chat) throw new Error("brainGenerate needs a brain with chat(history)");
  return async (text) => {
    const msgs = [];
    if (system) msgs.push({ role: "system", content: system });
    for (const m of history()) msgs.push(m);
    msgs.push({ role: "user", content: String(text || "") });
    const r = await brain.chat(msgs);
    return { text: typeof r === "string" ? r : (r && (r.text || r.content)) || "" };
  };
}

// speak(clause) → Promise that PLAYS the clause and resolves when it finishes (serialised by the clause speaker).
// `audioCtx` plays the kokoro RawAudio; with no ctx (headless) it just resolves after synth (latency still real).
export function ttsSpeak(tts, { audioCtx = null, voice } = {}) {
  if (!tts || !tts.synth) throw new Error("ttsSpeak needs a tts with synth(text)");
  return async (clause) => {
    const r = await tts.synth(clause, voice ? { voice } : {});
    const audio = (r && (r.audio || r.samples || r)) || new Float32Array(0);
    const sr = (r && r.sampling_rate) || 24000;
    if (audioCtx && audio.length) {
      const buf = audioCtx.createBuffer(1, audio.length, sr); buf.getChannelData(0).set(audio);
      const src = audioCtx.createBufferSource(); src.buffer = buf; src.connect(audioCtx.destination); src.start();
      await new Promise((res) => { src.onended = res; });
    }
    return { samples: audio.length, sr };
  };
}

// wireConversation({ brain, tts, memo, audioCtx, voice, system, history, onClause, onFirstAudio, onTurn, barge })
// → the live conversation controller (makeConversation) bound to the REAL faculties. Drop into voice.js streamTurn:
//   feedPartial(eachRollingPartial) · endTurn(finalTranscript at the endpoint) · onMicFrame(level) for barge.
export function wireConversation({ brain, tts, memo, audioCtx = null, voice, system, history, onClause, onFirstAudio, onTurn, barge, readsComplete } = {}) {
  if (!brain || !tts || !memo) throw new Error("wireConversation needs { brain, tts, memo }");
  return makeConversation({
    generate: brainGenerate(brain, { system, history }),
    speak: ttsSpeak(tts, { audioCtx, voice }),
    memo, onClause, onFirstAudio, onTurn, barge, readsComplete,
  });
}

export default { brainGenerate, ttsSpeak, wireConversation };
