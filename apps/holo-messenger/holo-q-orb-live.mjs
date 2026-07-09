// holo-q-orb-live.mjs — CONVERGED. The messenger's Q orb is now the ONE canonical orb
// (apps/q/core/holo-orb.js), so the messenger and the standalone Q share a single implementation:
// a native-WebGPU raymarched volume on a Web Worker (voice-reactive, glow-clean), with the WebGL2
// wireframe as fallback. This file is a thin re-export — the private messenger copy is retired.
export { mountOrb, default } from "../q/core/holo-orb.js";
