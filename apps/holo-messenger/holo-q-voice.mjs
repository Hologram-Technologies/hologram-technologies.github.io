// holo-q-voice.mjs — CONVERGED. The messenger's Q voice is now THE canonical voice (apps/q/core/voice-out.js),
// so the messenger and the standalone Q share one implementation: on-device Kokoro, sentence-chunked low latency,
// real-amplitude orb swell, speechSynthesis floor, fully-local loading. Thin re-export — the private copy is retired.
export { createVoice, default } from "../q/core/voice-out.js";
