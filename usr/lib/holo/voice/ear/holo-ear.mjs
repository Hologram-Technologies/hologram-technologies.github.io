// holo-ear.mjs — Q's UPGRADED ear: Moonshine (Useful Sensors) on-device speech-to-text. Same API surface
// as apps/q/core/listen.js and a drop-in for it, but the ASR is moonshine-base q8 (moonshine-tiny on
// phones): variable-length input means compute scales with the utterance, so a 2-5s conversational turn
// transcribes in ~100-500ms on plain wasm — 3-5× faster than whisper-tiny's pad-to-30s, at BETTER accuracy
// (tiny ≈ whisper-base, base ≈ whisper-small on English benchmarks). 0-egress: audio never leaves the
// device; only weights stream (then persist in the browser cache).
//
// FAIL-SOFT LADDER (never a dead ear): moonshine (own pinned runtime) → listen.js whisper (vendored
// runtime) → "" (mic affordance hides). Failures are never memoized — a later call retries.
//
// Runtime note: moonshine needs transformers.js ≥3.1; the OS's vendored runtime is 3.0.2 and is shared by
// other voices, so THIS module carries its own PINNED 3.8.1 (blob-imported through the Cache API with a
// stall watchdog — cached users touch zero network, one flaky CDN response fails fast into the ladder).
// Silero VAD is REUSED from listen.js (proven, vendored) — one VAD, two possible mouths-of-text.

const TF_PIN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
const CACHE_NAME = "holo-ear-v1";
const STALL_MS = 25000;

const MODEL_BASE = "onnx-community/moonshine-base-ONNX";
const MODEL_TINY = "onnx-community/moonshine-tiny-ONNX";
function pickModel() {
  try { if (navigator.userAgentData && navigator.userAgentData.mobile) return MODEL_TINY; } catch (e) {}
  try { if ((navigator.deviceMemory || 8) < 4) return MODEL_TINY; } catch (e) {}
  return MODEL_BASE;
}

// ── cached fetch + blob import (same contract as the pocket voice engine) ──
async function fetchCached(url) {
  let cache = null;
  try { cache = await caches.open(CACHE_NAME); } catch (e) {}
  if (cache) { try { const hit = await cache.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch (e) {} }
  const ab = new AbortController();
  let dog = setTimeout(() => ab.abort(), STALL_MS);
  try {
    const res = await fetch(url, { credentials: "omit", signal: ab.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const reader = res.body && res.body.getReader();
    let buf;
    if (reader) {
      const parts = []; let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(dog); dog = setTimeout(() => ab.abort(), STALL_MS);
        parts.push(value); got += value.length;
      }
      buf = new Uint8Array(got); let o = 0;
      for (const p of parts) { buf.set(p, o); o += p.length; }
    } else buf = new Uint8Array(await res.arrayBuffer());
    if (cache) { try { await cache.put(url, new Response(buf.slice(), { headers: { "content-type": "application/octet-stream" } })); } catch (e) {} }
    return buf;
  } finally { clearTimeout(dog); }
}
async function importBlob(url) {
  const bytes = await fetchCached(url);
  const b = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
  try { return await import(/* @vite-ignore */ b); } finally { URL.revokeObjectURL(b); }
}

// ── ONE RUNTIME (canonical, operator 2026-07-16): the pinned 3.8.1 carries BOTH the moonshine ASR and
// the Silero VAD — no legacy listen.js import, no second ORT wasm in memory, no whisper fallback.
// Failure mode is silence + retry-on-next-use (never memoized), matching the voice's HQ-or-hold law. ──
let _tfP = null;
function runtime() { return _tfP || (_tfP = importBlob(TF_PIN).catch((e) => { _tfP = null; throw e; })); }

let _ms = null, _msLoading = null;
export async function loadEar(onProgress) {
  if (_ms) return _ms;
  if (_msLoading) return _msLoading;
  _msLoading = (async () => {
    const tf = await runtime();
    const { pipeline, env } = tf;
    env.allowRemoteModels = true; env.allowLocalModels = false;
    // model files fetch via transformers' own browser cache (default on) — cached users are 0-network
    _ms = await pipeline("automatic-speech-recognition", pickModel(), {
      device: "wasm", dtype: "q8",
      progress_callback: (p) => { try { onProgress && onProgress(p); } catch (e) {} },
    });
    return _ms;
  })().catch((e) => { _msLoading = null; throw e; });   // no memoized absence
  return _msLoading;
}

// Transcribe Float32 mono PCM @16kHz → text. Moonshine is THE ear; failure returns "" (caller retries).
export async function transcribe(pcm16k, onProgress) {
  try {
    const pipe = await loadEar(onProgress);
    const r = await pipe(pcm16k);
    return ((Array.isArray(r) ? r.map((x) => x.text).join(" ") : (r && r.text)) || "").trim();
  } catch (e) {}
  return "";
}

// Silero VAD on the SAME runtime (ported from listen.js loadVAD — one ORT for the whole ear).
let _vad = null, _vadLoading = null;
export async function loadVAD(onProgress) {
  if (_vad) return _vad;
  if (_vadLoading) return _vadLoading;
  _vadLoading = (async () => {
    const tf = await runtime();
    const { AutoModel, Tensor, env } = tf;
    env.allowRemoteModels = true; env.allowLocalModels = false;
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
  })().catch((e) => { _vadLoading = null; throw e; });   // no memoized absence
  return _vadLoading;
}

// ── press-to-talk (same shape as listen.js createEar, transcribe upgraded) ──
export function createEar() {
  let ctx = null, stream = null, node = null, src = null, chunks = [], recording = false;
  const available = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  async function start() {
    if (recording) return;
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    src = ctx.createMediaStreamSource(stream);
    node = ctx.createScriptProcessor(4096, 1, 1);
    chunks = []; recording = true;
    node.onaudioprocess = (e) => { if (recording) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    src.connect(node); node.connect(ctx.destination);
  }
  function _teardown() {
    recording = false;
    try { node && node.disconnect(); } catch (e) {}
    try { src && src.disconnect(); } catch (e) {}
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { ctx && ctx.close(); } catch (e) {}
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
    if (pcm.length < 1600) return "";
    return transcribe(pcm, onProgress);
  }
  function cancel() { chunks = []; _teardown(); }
  return { start, stop, cancel, available, get recording() { return recording; } };
}

function _flat(frames) { let n = 0; for (const f of frames) n += f.length; const o = new Float32Array(n); let k = 0; for (const f of frames) { o.set(f, k); k += f.length; } return o; }

// ── hands-free listening (same contract as listen.js createHandsFree, incl. opts.gate for the duplex
// call surface) — VAD segments speech; each finished sentence transcribes via the moonshine ladder. ──
export function createHandsFree(opts = {}) {
  const onState = opts.onState || (() => {}), onFinal = opts.onFinal || (() => {}), onProgress = opts.onProgress;
  const onLevel = opts.onLevel || (() => {});
  const FRAME = 512, frameMs = 32;
  const threshold = opts.threshold != null ? opts.threshold : 0.5;
  const silenceFrames = Math.round((opts.silenceMs || 700) / frameMs);
  const minSpeechFrames = Math.round((opts.minSpeechMs || 200) / frameMs);
  const prerollMax = opts.prerollFrames || 8;
  let ctx = null, stream = null, node = null, src = null, running = false;
  let queue = [], pumping = false, pending = new Float32Array(0);
  let speaking = false, speechCount = 0, silenceCount = 0, speechBuf = [], preroll = [];
  let vad = null;

  const available = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  async function pump() {
    if (pumping) return; pumping = true;
    while (running && queue.length) {
      const fr = queue.shift(); let p = 0; try { p = await vad.prob(fr); } catch (e) { p = 0; }
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
          if (spoken >= minSpeechFrames) { onState("thinking"); try { const text = await transcribe(seg); if (running && text) onFinal(text); } catch (e) {} }
          onState(running ? "listening" : "idle");
        }
      }
    }
    pumping = false;
  }

  async function start() {
    if (running) return;
    onState("loading");
    vad = await loadVAD(onProgress); vad.reset();
    try { loadEar(onProgress); } catch (e) {}   // warm moonshine in parallel with the first utterance
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    src = ctx.createMediaStreamSource(stream); node = ctx.createScriptProcessor(4096, 1, 1);
    running = true; speaking = false; speechCount = 0; silenceCount = 0; speechBuf = []; preroll = []; pending = new Float32Array(0); queue = [];
    node.onaudioprocess = (e) => {
      if (!running) return;
      if (opts.gate && !opts.gate()) { pending = new Float32Array(0); queue = []; speaking = false; speechBuf = []; preroll = []; speechCount = 0; silenceCount = 0; return; }
      const d = e.inputBuffer.getChannelData(0);
      { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; try { onLevel(Math.min(1, Math.sqrt(s / d.length) * 3.2)); } catch (err) {} }
      const merged = new Float32Array(pending.length + d.length); merged.set(pending); merged.set(d, pending.length);
      let off = 0; while (merged.length - off >= FRAME) { queue.push(merged.slice(off, off + FRAME)); off += FRAME; }
      pending = merged.slice(off); pump();
    };
    src.connect(node); node.connect(ctx.destination);
    onState("listening");
  }

  function stop() {
    running = false; queue = []; speaking = false; speechBuf = []; preroll = [];
    try { node && node.disconnect(); } catch (e) {} try { src && src.disconnect(); } catch (e) {}
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch (e) {} try { ctx && ctx.close(); } catch (e) {}
    node = src = stream = ctx = null; onState("idle");
  }

  return { start, stop, available, get running() { return running; } };
}

export function engine() { return _ms ? "moonshine" : "warming"; }
