// holo-parakeet-ear.mjs — production adapter exposing the κ-native Parakeet-TDT-0.6B streaming ASR to Q's voice
// stack, conforming EXACTLY to the holo-voice-asr.mjs knativeEar seam (so holo-voice-asr drives it unchanged):
//   createWhisperEar({ holoUrl, upgradeUrl, kappa, release, upgradeKappa, upgradeRelease, language, … })
//     → { load(progressCb), transcribe(pcm16k, opts) -> { text, … }, info() }
// Mirrors holo-moonshine-ear.mjs. The encoder weights stream from the encoder .holo BY κ (streamHolo: Range →
// release → κ-route → OPFS), the decoder (joint) streams from the joint .holo BY κ, decode is κ-native pure-JS.
// The mel front-end (nemo128) is the one external piece (onnxruntime-web) and is injected as `toFeatures`.
//
// EXTRA knativeEar fields this ear understands (passed through cfg.knativeEar in holo-voice.js):
//   jointUrl/jointKappa/jointRelease  — the joint .holo (defaults beside holoUrl)
//   rescaleUrl/rescaleBinUrl/vocabUrl — the small encoder rescale + SentencePiece vocab (default beside holoUrl)
//   toFeatures(pcm) -> { features, T } — mel+stem front-end; until wired, transcribe(audio) throws and
//                                        holo-voice-asr's own fallback path (Moonshine/Whisper) handles audio.
//
// `deps` (last arg) is injectable for headless witnessing: { openStream, fetchBytes, hasWebGPU }. Production
// defaults: openStream=streamHolo, fetchBytes=fetch→bytes, hasWebGPU=navigator.gpu probe.
import { streamHolo } from "./holo-whisper-stream.mjs";
import { createParakeetASR } from "./holo-parakeet-asr.mjs";
import { makeMelStemFrontend } from "./holo-parakeet-frontend.mjs";
import { createParakeetStream } from "./holo-parakeet-stream.mjs";
import { makeEndpoint } from "./holo-voice-endpoint.mjs";

// a trivial content-addressed memo for the default endpoint (identical partial text ⇒ no re-predict). Production
// can inject the real O(1) holo-compute-memo + turn-detector via cfg.endpoint instead.
const trivialMemo = () => ({ _c: new Map(), async compute(tag, key, fn) { const k = tag + "|" + key; if (this._c.has(k)) return { bytes: this._c.get(k), hit: true }; const b = await fn(); this._c.set(k, b); return { bytes: b, hit: false }; } });

const dirOf = (u) => { const i = String(u).lastIndexOf("/"); return i >= 0 ? String(u).slice(0, i + 1) : ""; };

async function defaultFetchBytes(url) { const r = await fetch(url); if (!r.ok) throw new Error("fetch " + url + " " + r.status); return new Uint8Array(await r.arrayBuffer()); }
async function defaultHasWebGPU() { try { return !!(globalThis.navigator?.gpu && (await navigator.gpu.requestAdapter())); } catch (e) { return false; } }

export function createWhisperEar(cfg = {}, deps = {}) {
  const openStream = deps.openStream || ((url, o) => streamHolo(url, o));
  const fetchBytes = deps.fetchBytes || defaultFetchBytes;
  const hasWebGPU = deps.hasWebGPU || defaultHasWebGPU;
  const base = dirOf(cfg.holoUrl || "");
  const jointUrl = cfg.jointUrl || (base + "parakeet-tdt-0.6b-v2-joint.holo");
  const rescaleUrl = cfg.rescaleUrl || (base + "parakeet-encoder-rescale.json");
  const rescaleBinUrl = cfg.rescaleBinUrl || (base + "parakeet-encoder-rescale.bin");
  const vocabUrl = cfg.vocabUrl || (base + "parakeet-vocab.txt");
  const nemoUrl = ("nemoUrl" in cfg) ? cfg.nemoUrl : (base + "parakeet-nemo128.onnx");   // null disables the mel+stem front-end
  let asr = null, tier = "0.6b", backend = "cpu", ready = false;

  return {
    async load(progress) {
      const webgpu = await hasWebGPU();
      backend = webgpu ? "gpu" : "cpu";                                 // GPU path = the proven WGSL encoder; CPU = headless/fallback
      const encoderStream = await openStream(cfg.holoUrl, { kappa: cfg.kappa, release: cfg.release || "" });
      const jointStream = await openStream(jointUrl, { kappa: cfg.jointKappa, release: cfg.jointRelease || "" });
      const rescale = JSON.parse(new TextDecoder().decode(await fetchBytes(rescaleUrl)));
      const rescaleBin = await fetchBytes(rescaleBinUrl);
      const vocab = new TextDecoder().decode(await fetchBytes(vocabUrl)).split("\n").map((l) => l.replace(/\s+\d+$/, ""));
      // audio front-end (mel+stem). Injected toFeatures wins; else build mel(nemo128, ort-web) → κ-native stem
      // (the stem κs live in the encoder .holo, so reuse encoderStream.getBody). The stem is validated to the
      // real pre_encode output (cosine 0.9987). ort-web is the one external runtime; mel is the labeled piece.
      let toFeatures = cfg.toFeatures || deps.toFeatures || null;
      if (!toFeatures && nemoUrl) {
        try { toFeatures = makeMelStemFrontend({ getWeight: (k) => encoderStream.getBody(k), rescale, rescaleBin, nemoUrl, ort: deps.ort || null, backend }); }
        catch (e) { try { console.warn("[parakeet ear] mel+stem front-end unavailable:", e && e.message || e); } catch (_) {} }
      }
      asr = await createParakeetASR({ encoderStream, jointStream, rescale, rescaleBin, vocab, toFeatures, backend });
      ready = true;
      try { progress && progress({ phase: "ready", engine: "parakeet-κ", backend, tier }); } catch (e) {}
      return true;
    },
    // knativeEar contract: transcribe(pcm) → { text, … }. Full audio path needs the mel+stem front-end.
    async transcribe(audio, opts = {}) {
      if (!asr) await this.load();
      const r = await asr.transcribeAudio(audio, opts);                 // throws if toFeatures (mel+stem) not wired
      return { text: r.text, ids: r.ids, ms: r.ms, tier, backend };
    },
    // direct features path (the κ-native core, no mel front-end) — used by witnesses + callers that already have
    // acoustic features. transcribe(features[T*1024], T) → { text, … }.
    async transcribeFeatures(features, T) { if (!asr) await this.load(); const r = await asr.transcribe(features, T); return { text: r.text, ids: r.ids, ms: r.ms, tier, backend }; },

    // STREAMING surface (Arc B): live mic → growing EXACT partials → instant final on MEANING. feed(pcm,atMs) as
    // audio arrives, poll(atMs) on a timer, end() at the VAD/turn boundary. The semantic endpoint (injected
    // cfg.endpoint, or a default heuristic one) fires ~120ms after the utterance reads done and vetoes mid-thought.
    // The heavy work happens DURING speech; the final reuses the last partial ⇒ ~0ms perceived after you stop.
    stream({ onPartial = () => {}, onFinal = () => {}, endpoint = null, cadenceMs = 500 } = {}) {
      const ep = endpoint || cfg.endpoint || makeEndpoint({ predict: async () => null, memo: trivialMemo(), earlyMs: 120, floorMs: 550 });
      return createParakeetStream({ transcribe: async (pcm) => { if (!asr) await this.load(); return asr.transcribeAudio(pcm); }, endpoint: ep, onPartial, onFinal, cadenceMs });
    },
    info: () => ({ engine: "parakeet-κ", ready, backend, tier, holoUrl: cfg.holoUrl, jointUrl, kappa: cfg.kappa }),
  };
}
export default createWhisperEar;
