// serverless-bundle stub — HD TTS vendor (kokoro, 71MB) is not shipped; Q speaks via the speechSynthesis floor.
// createTTS exists (same API) but load() rejects immediately with NO network fetch, so warmHD falls to the floor.
export function createTTS() { return { load: async () => { throw new Error("HD TTS streams by κ (follow-up); using floor voice"); }, synth: async () => { throw new Error("no HD in serverless bundle"); } }; }
export default { createTTS };
