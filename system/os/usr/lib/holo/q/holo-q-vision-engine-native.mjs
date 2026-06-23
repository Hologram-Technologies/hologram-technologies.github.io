// holo-q-vision-engine-native.mjs — THE 3B DOCUMENT ENGINE, κ-addressed. The browser ≤2B TrOCR
// (holo-q-vision-engine.mjs) reads single lines; the native Hologram host runs the real 3B Unlimited-OCR
// (document layout, tables, multi-page, GROUNDING coordinates) on its GPU. This module is the κ-native
// BRIDGE to it: the engine's weights are a content-addressed .holo selected BY ITS κ (ADR-0052 κ-disk),
// the host streams + L5-verifies those weights, and `read()` returns the same { markdown } contract the
// specialist seals into a κ — plus optional grounding `coords` the native model produces.
//
// The transport `invoke(verb, payload) → result` is injected (the native host sets window.HoloNative;
// the Node witness injects a fake). So the request-shaping + result-mapping are pure and provable
// offline, while the 3B itself only ever runs on the GPU host. No host ⇒ null (never fakes; the mux
// falls back to the browser engine, then to main). This is "auto = the best reader the device can run".

import { installEngine } from "./holo-q-vision.mjs";

const _bytesToB64 = (bytes) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (typeof btoa === "function") { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  return Buffer.from(u8).toString("base64");                          // Node (witness)
};

// the OS's pinned 3B document-OCR specialist (a content-addressed .holo). The κ IS the identity (Law L1):
// the host resolves κ → weights via the κ-route (IPFS heal) and verifies every block, so no host is trusted.
export const UNLIMITED_OCR = {
  id: "unlimited-ocr-3b",
  // NOTE: this κ is a placeholder until the .holo is forged + pinned (apps/q/forge/.models). The bridge
  // is correct regardless of the value; swap via createNativeEngine({ modelKappa }) or HoloVisionEngineConfig.
  kappa: "did:holo:sha256:0000000000000000000000000000000000000000000000000000000000000000",
  job: "document parsing (layout · tables · multi-page · grounding)",
  prompt: "document parsing.",
};

// createNativeEngine({ invoke, modelKappa, prompt }) → { id, read, info }. read(imageBytes, prompt) calls
// the host: invoke("vision.read", { kappa, image:<b64 png>, prompt }) → { markdown, blocks?, coords? }.
export function createNativeEngine({ invoke = null, modelKappa = UNLIMITED_OCR.kappa, prompt = UNLIMITED_OCR.prompt, id = UNLIMITED_OCR.id } = {}) {
  const info = { engine: "native-3b", model: id, kappa: modelKappa, ready: false, error: null };
  return {
    id, info: () => ({ ...info }),
    async read(imageBytes, p) {
      if (typeof invoke !== "function") return null;                 // no host ⇒ honest null (L5)
      try {
        const out = await invoke("vision.read", { kappa: modelKappa, image: _bytesToB64(imageBytes), prompt: p || prompt });
        if (!out || out.markdown == null) return null;
        info.ready = true;
        return { markdown: String(out.markdown), blocks: out.blocks || null, coords: out.coords || null };   // grounding passes through to the κ
      } catch (e) { info.error = String((e && e.message) || e); return null; }
    },
  };
}

// browser/native binding: when the native host exposes its bridge (window.HoloNative.invoke), install the
// 3B as the vision engine — it OUTRANKS the browser TrOCR (document-grade + grounding). Fail-soft: on a
// plain web browser there is no host, so the ≤2B browser engine remains bound and this stays dormant.
if (typeof window !== "undefined") {
  window.HoloVisionEngineNative = { createNativeEngine, UNLIMITED_OCR };
  try {
    const invoke = window.HoloNative && window.HoloNative.invoke;
    if (invoke) {
      const cfg = window.HoloVisionEngineConfig || {};
      const engine = createNativeEngine({ invoke, modelKappa: cfg.modelKappa || UNLIMITED_OCR.kappa });
      window.HoloVisionEngine = engine;                              // the 3B supersedes the browser engine
      installEngine(engine);                                         // → window.HoloVisionSpecialist + mux bind
    }
  } catch {}
}

export default { createNativeEngine, UNLIMITED_OCR };
