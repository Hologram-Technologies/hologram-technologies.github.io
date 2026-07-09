// holo-voice-turn-detector-web.mjs — the PRODUCTION binding for the real turn-detector: loads the κ-served model
// (ort-web over turn-detector.holo) + the tokenizer (transformers.js) and returns makeTurnDetector's { predict }
// for makeEndpoint. This is exactly the binding proven live in quality/turn-detector-live.html (7/7 == python,
// punctuation-safe, endpoint fires/vetoes). Serverless: the 170MB .holo streams by κ (per-block L5 + OPFS warm);
// nothing leaves the device. Lazy + fail-soft — ANY load failure returns null so the caller keeps its heuristic.
import { makeTurnDetector } from "./holo-voice-turn-detector.mjs";

const ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.webgpu.bundle.min.mjs";
const TF_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";

// createTurnDetectorWeb({ holoUrl, onnxUrl, modelsBase, modelId, release, ort, tf, ortUrl, tfUrl }) →
//   { predict(text)->P(complete)|null, info } | null on failure.
// Delivery: pass `holoUrl` to κ-serve the bundle (model + tokenizer) by content address (the SW/holo-onnx-kserve
// fetch shim), OR `onnxUrl` + `modelsBase` to load the files directly (dev). modelId defaults "turn-detector".
export async function createTurnDetectorWeb({ holoUrl = "", onnxUrl = "", modelsBase = "/apps/q/forge/.models/", modelId = "turn-detector", release = "", ort = null, tf = null, ortUrl = ORT_CDN, tfUrl = TF_CDN, openFiles = null } = {}) {
  try {
    const O = ort || await import(/* @vite-ignore */ ortUrl);
    try { O.env.wasm.proxy = false; O.env.wasm.numThreads = 1; } catch (e) {}
    const T = tf || await import(/* @vite-ignore */ tfUrl);
    T.env.allowRemoteModels = false; T.env.allowLocalModels = true;

    // κ-serve the bundle (model + tokenizer files) by content address; else load from modelsBase.
    let served = null, onnx = onnxUrl || (modelsBase + modelId + "/model_quantized.onnx");
    if (holoUrl) {
      try { const km = await import(/* @vite-ignore */ "./holo-onnx-kserve.mjs"); served = await (km.serveModelFromHolo || km.default)({ holoUrl, modelId, release, openFiles }); } catch (e) { try { console.warn("[turn-detector] κ-serve unavailable, direct:", e && e.message || e); } catch (_) {} }
    }
    if (!onnxUrl) T.env.localModelPath = new URL(modelsBase, (typeof location !== "undefined" ? location.href : "http://localhost/")).href;

    const tok = await T.AutoTokenizer.from_pretrained(modelId);
    const imEndId = (tok.model && tok.model.tokens_to_ids && tok.model.tokens_to_ids.get("<|im_end|>")) ?? 2;
    const sess = await O.InferenceSession.create(onnx, { executionProviders: ["wasm"] });

    const tokenizeChatPrefix = (normText) => {
      const formatted = tok.apply_chat_template([{ role: "user", content: normText }], { tokenize: false });
      const prefix = formatted.split("<|im_end|>")[0];                          // ask: would <|im_end|> come next?
      const enc = tok(prefix, { add_special_tokens: false });
      return Array.from(enc.input_ids.data, (x) => Number(x));
    };
    const forward = async (ids) => {
      const input = new O.Tensor("int64", BigInt64Array.from(ids.map((x) => BigInt(x))), [1, ids.length]);
      const out = await sess.run({ input_ids: input });
      const t = out.logits, seq = t.dims[1], vocab = t.dims[2];
      return t.data.subarray((seq - 1) * vocab, seq * vocab);                   // last-position logits
    };

    const td = makeTurnDetector({ tokenizeChatPrefix, forward, imEndId });
    return { predict: td.predict, info: () => ({ engine: "turn-detector-κ", modelId, served: served ? served.served.length : 0, imEndId }) };
  } catch (e) { try { console.warn("[turn-detector] unavailable, using heuristic:", e && e.message || e); } catch (_) {} return null; }
}

export default createTurnDetectorWeb;
