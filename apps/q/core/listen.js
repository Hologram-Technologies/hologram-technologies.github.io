// core/listen.js — on-device speech-to-text (Q's ear). The microphone PCM is transcribed ENTIRELY in
// the browser by Whisper-tiny (transformers.js, ORT-WASM) — no audio EVER leaves the device, no server.
// Only the model WEIGHTS stream from HuggingFace on first use (content-addressed, then cached offline in
// the browser) — the same serverless ethos as Q's brain. The runtime (transformers.js + the ORT wasm) is
// vendored under ../vendor/transformers, so nothing but the model is fetched.
//
// API (deliberately tiny — abstract the complexity, expose two verbs):
//   const ear = createEar();
//   await ear.start();                 // opens the mic, begins capturing 16 kHz mono PCM
//   const text = await ear.stop();     // ends capture, transcribes on-device, returns the words
//   ear.cancel();                      // drop the mic, transcribe nothing
//   ear.available()                    // false where getUserMedia is missing → caller hides the affordance

import { pipeline, env } from "../../../_shared/voice/vendor/transformers/transformers.js";

const MODEL = "onnx-community/whisper-tiny";   // ~40 MB q8; streams from HF, runs on-device
let _pipe = null, _loading = null;

// Load the recognizer once. Runtime is vendored; only the model comes from HF (allowRemoteModels).
export async function loadEar(onProgress) {
  if (_pipe) return _pipe;
  if (_loading) return _loading;
  _loading = (async () => {
    env.allowRemoteModels = true;      // weights stream from HuggingFace…
    env.allowLocalModels = false;      // …not from disk
    try {
      const wasm = new URL("/_shared/voice/vendor/transformers/", import.meta.url).href;   // vendored ORT wasm — no CDN
      if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
        env.backends.onnx.wasm.wasmPaths = wasm;
        env.backends.onnx.wasm.proxy = true;   // run ORT in a worker so the UI never janks while it thinks
      }
    } catch {}
    _pipe = await pipeline("automatic-speech-recognition", MODEL, {
      device: "wasm", dtype: "q8",
      progress_callback: (p) => { try { onProgress && onProgress(p); } catch {} },
    });
    return _pipe;
  })().catch((e) => { _loading = null; throw e; });
  return _loading;
}

// Transcribe a Float32Array of mono PCM at 16 kHz → plain text.
export async function transcribe(pcm16k, onProgress) {
  const pipe = await loadEar(onProgress);
  const r = await pipe(pcm16k, { language: "en", task: "transcribe", chunk_length_s: 30 });
  return ((Array.isArray(r) ? r.map((x) => x.text).join(" ") : (r && r.text)) || "").trim();
}

// A press-to-talk capture session: opens the mic at 16 kHz mono (no resample needed → Whisper's rate),
// buffers the samples, and on stop() transcribes them on-device.
export function createEar() {
  let ctx = null, stream = null, node = null, src = null, chunks = [], recording = false;

  const available = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  async function start() {
    if (recording) return;
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    // A 16 kHz context means the captured Float32 is already at Whisper's sample rate — no resampling.
    ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    src = ctx.createMediaStreamSource(stream);
    node = ctx.createScriptProcessor(4096, 1, 1);
    chunks = []; recording = true;
    node.onaudioprocess = (e) => { if (recording) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    src.connect(node); node.connect(ctx.destination);
  }

  function _teardown() {
    recording = false;
    try { node && node.disconnect(); } catch {}
    try { src && src.disconnect(); } catch {}
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { ctx && ctx.close(); } catch {}
    node = src = stream = ctx = null;
  }

  function _flatten() {
    let n = 0; for (const c of chunks) n += c.length;
    const out = new Float32Array(n); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    chunks = []; return out;
  }

  async function stop(onProgress) {
    if (!recording) return "";
    const pcm = _flatten(); _teardown();
    if (pcm.length < 1600) return "";   // < ~0.1 s → nothing said
    return transcribe(pcm, onProgress);
  }

  function cancel() { chunks = []; _teardown(); }

  return { start, stop, cancel, available, get recording() { return recording; } };
}

// ── HANDS-FREE listening ────────────────────────────────────────────────────────────────────────────
// Silero VAD (MIT, 2 MB) is the cheap stage-1 gate: it tells speech from noise so Whisper only ever runs
// on real utterances. Shares the SAME vendored transformers instance as the ASR (ES-module cache → one ORT,
// one serverless config). The model streams from HF on first use, then caches offline.
let _vad = null, _vadLoading = null;
export async function loadVAD(onProgress) {
  if (_vad) return _vad;
  if (_vadLoading) return _vadLoading;
  _vadLoading = (async () => {
    const tf = await import("../../../_shared/voice/vendor/transformers/transformers.js");
    const { AutoModel, Tensor, env } = tf;
    env.allowRemoteModels = true; env.allowLocalModels = false;
    try { const w = new URL("/_shared/voice/vendor/transformers/", import.meta.url).href; if (env.backends && env.backends.onnx && env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = w; } catch {}
    const net = await AutoModel.from_pretrained("onnx-community/silero-vad", { config: { model_type: "custom" }, dtype: "fp32", progress_callback: onProgress });
    const sr = new Tensor("int64", [16000n], []);
    let state = new Tensor("float32", new Float32Array(256), [2, 1, 128]);
    _vad = {
      reset() { state = new Tensor("float32", new Float32Array(256), [2, 1, 128]); },
      async prob(frame512) {
        const input = new Tensor("float32", frame512, [1, 512]);
        const out = await net({ input, sr, state });
        if (out.stateN) state = out.stateN;
        const o = out.output && out.output.data; return o && o.length ? o[0] : 0;
      },
    };
    return _vad;
  })().catch((e) => { _vadLoading = null; throw e; });
  return _vadLoading;
}

function _flat(frames) { let n = 0; for (const f of frames) n += f.length; const o = new Float32Array(n); let k = 0; for (const f of frames) { o.set(f, k); k += f.length; } return o; }

// createHandsFree({ onState, onFinal, onProgress }) — tap once to open; it listens continuously, and every
// time you finish a sentence it transcribes on-device and hands you the text via onFinal(text). onState fires
// "loading" | "listening" | "speech" | "thinking" | "idle" so the UI can breathe with the conversation.
export function createHandsFree(opts = {}) {
  const onState = opts.onState || (() => {}), onFinal = opts.onFinal || (() => {}), onProgress = opts.onProgress;
  const onLevel = opts.onLevel || (() => {});   // per-buffer mic RMS (0..1) → the orb's live listening swell
  const FRAME = 512, frameMs = 32;
  const threshold = opts.threshold != null ? opts.threshold : 0.5;
  const silenceFrames = Math.round((opts.silenceMs || 700) / frameMs);
  const minSpeechFrames = Math.round((opts.minSpeechMs || 200) / frameMs);
  const prerollMax = opts.prerollFrames || 8;
  let ctx = null, stream = null, node = null, src = null, running = false;
  let queue = [], pumping = false, pending = new Float32Array(0);
  let speaking = false, speechCount = 0, silenceCount = 0, speechBuf = [], preroll = [];

  const available = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  async function pump() {
    if (pumping) return; pumping = true;
    while (running && queue.length) {
      const fr = queue.shift(); let p = 0; try { p = await _vad.prob(fr); } catch { p = 0; }
      const isSpeech = p >= threshold;
      if (!speaking) {
        preroll.push(fr); if (preroll.length > prerollMax) preroll.shift();
        if (isSpeech) { speechCount++; if (speechCount >= 2) { speaking = true; speechBuf = preroll.slice(); preroll = []; silenceCount = 0; onState("speech"); } }
        else speechCount = 0;
      } else {
        speechBuf.push(fr);
        if (isSpeech) silenceCount = 0;
        else if (++silenceCount >= silenceFrames) {
          const spoken = speechBuf.length; speaking = false; silenceCount = 0; speechCount = 0;
          const seg = _flat(speechBuf); speechBuf = [];
          if (spoken >= minSpeechFrames) { onState("thinking"); try { const text = await transcribe(seg); if (running && text) onFinal(text); } catch {} }
          onState(running ? "listening" : "idle");
        }
      }
    }
    pumping = false;
  }

  async function start() {
    if (running) return;
    onState("loading");
    await loadVAD(onProgress); _vad.reset();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    src = ctx.createMediaStreamSource(stream); node = ctx.createScriptProcessor(4096, 1, 1);
    running = true; speaking = false; speechCount = 0; silenceCount = 0; speechBuf = []; preroll = []; pending = new Float32Array(0); queue = [];
    node.onaudioprocess = (e) => {
      if (!running) return;
      // GATE: while Q is thinking or speaking, ignore the mic entirely — so Q never hears its own voice
      // (or a half-spoken turn) and interrupts itself. Drop buffered audio and reset any partial utterance.
      if (opts.gate && !opts.gate()) { pending = new Float32Array(0); queue = []; speaking = false; speechBuf = []; preroll = []; speechCount = 0; silenceCount = 0; return; }
      const d = e.inputBuffer.getChannelData(0);
      { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; try { onLevel(Math.min(1, Math.sqrt(s / d.length) * 3.2)); } catch (err) {} }   // live mic level → orb listening swell
      const merged = new Float32Array(pending.length + d.length); merged.set(pending); merged.set(d, pending.length);
      let off = 0; while (merged.length - off >= FRAME) { queue.push(merged.slice(off, off + FRAME)); off += FRAME; }
      pending = merged.slice(off); pump();
    };
    src.connect(node); node.connect(ctx.destination);
    onState("listening");
  }

  function stop() {
    running = false; queue = []; speaking = false; speechBuf = []; preroll = [];
    try { node && node.disconnect(); } catch {} try { src && src.disconnect(); } catch {}
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch {} try { ctx && ctx.close(); } catch {}
    node = src = stream = ctx = null; onState("idle");
  }

  return { start, stop, available, get running() { return running; } };
}
