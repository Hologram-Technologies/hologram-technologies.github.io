// holo-q-vision.mjs — THE RASTER EDGE: the one place pixels become κ. Q already sees every
// κ-addressable object losslessly (holo-q-perception.js, ADR-0081) — the substrate never lost their
// structure, so OCR-ing a native holospace would be a lossy re-derivation (a regression). This module
// is the SYMMETRIC OTHER HALF: the non-κ pixels — a cross-origin page, a <canvas>/WebGL surface, a
// video frame, a scanned PDF, an opaque image — where structure never existed in the graph and a
// vision model is the only way in. It binds the mux 'vision' specialist (ADR-0084), seals its output
// back as a κ-object, and joins it to the perception scene as a VISUAL face. After that, the foreign
// thing is JUST A κ — pluckable, searchable, shareable, time-traveled — by every existing seam.
//
// PRECEDENCE IS THE SIMPLICITY GUARANTEE: perceive() reads the κ-graph (free, O(1), no model) for any
// κ target and only falls to OCR for raster. OCR is the fallback, never the default. NEVER FAKES
// (Law L5): no bound engine ⇒ an honest null, never a fabricated read.
//
// Dependency-light: it reuses the canonical UOR envelope (holo-object.mjs seal/verify/address) so a
// perceived κ is a first-class, self-verifying object — same κ-space as pluck. Node-witnessable.

import { seal, verify, address } from "../holo-object.mjs";

// hashBytes(bytes) — the content address of a raw pixel buffer (the memo / capture key). Same pixels →
// same hash → the ambient layer skips re-OCR for free. Accepts a Uint8Array, ArrayBuffer, or string.
export async function hashBytes(bytes) {
  let u8;
  if (bytes instanceof Uint8Array) u8 = bytes;
  else if (bytes instanceof ArrayBuffer) u8 = new Uint8Array(bytes);
  else u8 = new TextEncoder().encode(typeof bytes === "string" ? bytes : JSON.stringify(bytes));
  const c = (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) || null;
  if (c) { const h = await c.digest("SHA-256", u8); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
  const { createHash } = await import("node:crypto");                       // Node fallback (witness)
  return createHash("sha256").update(Buffer.from(u8)).digest("hex");
}

const _bytesToText = (b) =>
  typeof b === "string" ? b
  : new TextDecoder().decode(b instanceof Uint8Array ? b : new Uint8Array(b || []));

// ── the specialist: bind the OCR engine to the mux 'vision' slot ─────────────────────────────────────
// createVisionSpecialist({ engine }) → a provider compatible with bindSpecialist("vision", provider).
// `engine.read(imageBytes, prompt) → { markdown, blocks?, coords? }` is the ONLY model contact; it is
// injected (the native 3B Unlimited-OCR host, or a browser ≤2B VLM, or — for the witness — a stub).
// infer() seals the engine's structured text into a verifying κ-object and returns it. No engine, or
// an engine that returns nothing ⇒ null (honest; the mux then falls back to main — never blocks/fakes).
export function createVisionSpecialist({ engine = null, id = "unlimited-ocr" } = {}) {
  return {
    id, vlm: true, pipeline: "image-to-text",
    async infer({ imageBytes, prompt = "document parsing.", meta = {} } = {}) {
      if (!engine || typeof engine.read !== "function") return null;        // L5: never fake a read
      const out = await engine.read(imageBytes, prompt);
      if (!out || out.markdown == null) return null;                        // honest empty
      const capture = await hashBytes(imageBytes);
      const object = seal({
        "@context": "https://uor.foundation/holo",
        "@type": "holo:Perception",
        "holo:source": "raster-ocr",
        "holo:engine": id,
        "holo:capture": capture,                                           // ties the κ to the exact pixels
        "schema:text": out.markdown,                                       // the grounded, citable content
        "holo:blocks": out.blocks || null,                                 // layout blocks (when the engine gives them)
        "holo:coords": out.coords || null,                                 // grounding bboxes (grounding-capable engines only)
        ...(meta.hint ? { "schema:about": meta.hint } : {}),
      });
      return { kappa: object.id, object, markdown: out.markdown, blocks: out.blocks || null, coords: out.coords || null, capture };
    },
  };
}

// helpers for the precedence check — does the scene already hold this id as a real κ (a code face)?
function sceneCode(scene, id) {
  if (!scene || typeof scene.snapshot !== "function") return null;
  const e = scene.snapshot().find((x) => x.id === id);
  return e && e.code ? e.code : null;
}

// ── perceive(target) — THE ONE VERB (and the ambient layer's deletes even this from the user's world).
// target: { id, kappa?, pixels?, capture?, hint?, prompt?, kind? }
//   • κ target (kappa given, or the scene already holds a code-κ for this id) → GRAPH READ. No engine,
//     no pixels. This is the fast lane the user's actions ride. (Precedence — the regression guard.)
//   • raster target (pixels) → OCR via the bound specialist → seal κ → join the scene as a VISUAL face.
// Returns { source: "graph" | "ocr" | "none", kappa, object?, markdown?, engineCalled }.
export async function perceive(target = {}, { scene = null, specialist = null, capture = null } = {}) {
  const graphKappa = target.kappa || sceneCode(scene, target.id);
  if (graphKappa) return { source: "graph", kappa: graphKappa, fromGraph: true, engineCalled: false };  // ← κ-perception first

  if (!specialist || typeof specialist.infer !== "function")
    return { source: "none", kappa: null, fallback: "main", engineCalled: false, why: "no vision specialist bound" };

  const pixels = target.pixels != null ? target.pixels : (capture ? await capture(target) : null);
  if (pixels == null) return { source: "none", kappa: null, engineCalled: false, why: "no pixels at the raster edge" };

  const res = await specialist.infer({ imageBytes: pixels, prompt: target.prompt, meta: { hint: target.hint, rect: target.rect } });
  if (!res || !res.kappa) return { source: "none", kappa: null, engineCalled: true, why: "engine returned nothing" };

  if (scene && typeof scene.observeVisual === "function")
    scene.observeVisual(target.id, res.kappa, { source: "raster-ocr", kind: target.kind || "raster" });   // promote into the graph
  return { source: "ocr", kappa: res.kappa, object: res.object, markdown: res.markdown, blocks: res.blocks, coords: res.coords, capture: res.capture, engineCalled: true };
}

// ── a deterministic stub engine — for the witness AND as the honest "no real model yet" placeholder.
// It does NOT pretend to read pixels; it echoes a caller-provided map (or the decoded bytes), so the
// whole loop is provable in pure Node without the 3B CUDA host. Real binding swaps this for the native
// engine (see hologram-q-native-vision-IMPLEMENTATION-prompt.md, Phase 2).
export function makeStubEngine(map = {}) {
  let calls = 0;
  return {
    calls: () => calls,
    async read(bytes /* , prompt */) {
      calls++;
      const key = _bytesToText(bytes);
      const md = map[key] != null ? map[key] : `# raster\n${key}`;
      return { markdown: md, blocks: [{ type: "text", text: md }] };
    },
  };
}

export function describeVision() {
  return {
    role: "the raster edge — the ONLY place pixels become κ; everything κ-native is already seen losslessly by holo-q-perception",
    precedence: "perceive() reads the κ-graph (O(1), no model) for κ targets; OCR fires only for non-κ raster — fallback, never default",
    seal: "engine output is sealed to a self-verifying UOR κ-object (holo-object) and joined to the scene as a VISUAL face — then it is just a κ",
    honesty: "no bound engine ⇒ null; the mux falls back to main; never blocks, never fakes (Law L5)",
    engine: "injected: native 3B Unlimited-OCR host, a browser ≤2B VLM, or makeStubEngine (witness/placeholder)",
  };
}

// installEngine(engine) — the single seam an engine provider calls to go live: build the specialist,
// expose it (window.HoloVisionSpecialist, read by the boot wiring), and bind it to the mux 'vision' slot.
// Idempotent + fail-soft. Returns the specialist (or null with no engine / no window).
export function installEngine(engine) {
  if (typeof window === "undefined" || !engine) return null;
  const specialist = createVisionSpecialist({ engine });
  window.HoloVisionSpecialist = specialist;
  try { import("./holo-q-mux.js").then((mux) => mux.bindSpecialist("vision", specialist)).catch(() => {}); } catch {}
  return specialist;
}

// browser binding: expose the verb; auto-install an engine the host already set. Fail-soft — no engine
// means the slot stays unbound and routeTask('vision') falls back to main (never blocks, never fakes).
if (typeof window !== "undefined") {
  window.HoloVision = { perceive, createVisionSpecialist, hashBytes, describeVision, installEngine };
  if (window.HoloVisionEngine) installEngine(window.HoloVisionEngine);
}

export default { perceive, createVisionSpecialist, makeStubEngine, hashBytes, describeVision };
