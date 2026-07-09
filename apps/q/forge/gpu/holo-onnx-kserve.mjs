// holo-onnx-kserve.mjs — serve an ONNX faculty model's files from its κ-addressable .holo INTO the
// unchanged transformers.js / onnxruntime-web runtime. ONE shim for every ONNX faculty (TTS · embed ·
// vision): no engine port — only weight DELIVERY becomes content-addressed (HTTP-Range + per-block L5 +
// OPFS warm cache + serverless multi-source), exactly like the κ-native brain/ASR, but the forward stays on
// the proven engine. Generalises the proof in kokoro-holo-test.html into a reusable, fail-safe module.
//
//   serveModelFromHolo({ holoUrl, modelId, release }) → { stats, served, missed, restore, modelKey }   (browser)
//
// Install BEFORE the engine loads; the engine then fetches its model files normally and the shim answers any
// request whose URL contains "<last-segment-of-modelId>/" from the .holo. Everything else passes through
// untouched (cheap substring test). Keep it installed for the engine's lifetime (lazy per-file fetches —
// e.g. a TTS voice — still route through it); call restore() to uninstall. ANY failure ⇒ the caller restores
// and falls back to the vendored ONNX path, so a faculty is never bricked by the κ path.

// the URL key a transformers model id resolves to: "onnx-community/Kokoro-82M-v1.0-ONNX" → "Kokoro-82M-v1.0-ONNX/"
export function modelKeyFor(modelId) { return String(modelId || "").split("/").pop() + "/"; }

// PURE, INJECTABLE routing core (Node-witnessable). Wraps target.fetch so any request whose URL contains
// `key` is answered from `hf.getFile(name)`; non-matching (and not-in-holo) requests fall through to the
// original transport. Returns the running served/missed lists and a restore() that reinstalls the original.
export function installModelFetchShim({ hf, key, target }) {
  const orig = target.fetch;                       // the RAW original — restore() reinstalls this exact reference
  const callOrig = orig.bind(target);              // bound copy for safe invocation (window.fetch needs its this)
  const served = [], missed = [];
  const ResponseCtor = target.Response || (typeof Response !== "undefined" ? Response : null);
  target.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const i = url.indexOf(key);
    if (i >= 0) {
      const name = decodeURIComponent(url.slice(i + key.length).split("?")[0]);
      try {
        const b = await hf.getFile(name);
        served.push(name);
        return new ResponseCtor(b, { status: 200, headers: { "Content-Type": "application/octet-stream", "Content-Length": String((b && (b.length || b.byteLength)) || 0) } });
      } catch (e) { missed.push(name); }   // not in the .holo → fall through to the original transport
    }
    return callOrig(input, init);
  };
  return { served, missed, restore() { target.fetch = orig; } };
}

// browser entry: open the file-bundle .holo (range + L5 + OPFS, release fallback) and install the shim on
// `target` (window by default). `openFiles` is injectable for tests; in the browser it lazy-imports holo-files.
export async function serveModelFromHolo({ holoUrl, modelId, release = "", target, openFiles } = {}) {
  const t = target || (typeof window !== "undefined" ? window : globalThis);
  const open = openFiles || (async (u, o) => (await import("./holo-files.mjs")).openHoloFiles(u, o));
  const hf = await open(holoUrl, { release });
  const key = modelKeyFor(modelId);
  const shim = installModelFetchShim({ hf, key, target: t });
  return { stats: hf.stats, served: shim.served, missed: shim.missed, restore: shim.restore, modelKey: key, files: hf.files };
}

export default serveModelFromHolo;
