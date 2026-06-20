// holo-q-mobile.mjs — Q's on-device voice loop for the mobile hero (the L1 voice facade).
//
// One continuous, serverless conversation: mic → silero VAD endpoint → Whisper ASR → your intent → the
// brain → Kokoro TTS, spoken back, then it listens again. Every engine is the vendored κ-disk seam
// (createASR / createTTS / createVAD); nothing leaves the device. This is the "talk to the computer"
// half of the Star-Trek-ship's-computer experience.
//
// FAIL-CLOSED BY DESIGN: createQVoice() rejects if the mic, the audio graph, or the ear model is
// unavailable — the caller (the hero) then keeps the browser SpeechRecognition/speechSynthesis floor, so
// Q always works and boot is never at risk. The voice model (Kokoro) loads lazily on the first reply, so
// listening never waits on it.
//
//   const q = await createQVoice({ onState, onText, onIntent, lang, signalSink });
//   q.start();            // begin listening
//   q.toggle();           // tap-to-talk: stop/await ⇄ listen
//   q.speak(text);        // say something (with barge-in)
//   q.stop(); q.dispose();
//
//   onState(s)  : "listening" | "thinking" | "speaking" | "idle"
//   onText(t)   : the text to surface (live transcript while listening; the reply while speaking)
//   onIntent(t) : (final transcript) → Promise<replyText>     // the hero passes Q's brain bridge
//   signalSink  : an object updated each frame with { level, bass, mid, treble, onset } for the orb

import { createASR } from "./holo-voice-asr.mjs";
import { createTTS } from "./holo-voice-tts.mjs";
import { createVAD } from "./holo-voice-vad.mjs";

const SR = 16000, FRAME = 512;     // silero v5 wants 512-sample frames at 16 kHz
const HANG_MS = 700;               // trailing silence that ends an utterance
const PREROLL_MS = 240;            // audio kept just before speech onset (so the first phoneme isn't clipped)
const MIN_UTTER_MS = 280;          // ignore sub-word blips (a cough, a tap)

export async function createQVoice(opts = {}) {
  const onState = opts.onState || (() => {});
  const onText = opts.onText || (() => {});
  const onIntent = opts.onIntent || (() => Promise.resolve(""));
  const sink = opts.signalSink || {};
  const lang = (opts.lang || "en").slice(0, 2);

  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) throw new Error("no mic");
  const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) throw new Error("no AudioContext");

  // ── engines (serverless, vendored). The ear must load — its failure is the fail-closed signal. ──────
  const asr = createASR({ lang });
  await asr.load();                                   // throws if Whisper isn't vendored → caller falls back
  const tts = createTTS({});                          // lazy: loads on the first reply, not on listen
  let vad = null; try { vad = await createVAD({ threshold: 0.5 }); } catch (e) { vad = null; }   // optional → energy fallback

  // ── audio graph (built lazily on start, released on stop — the mic is hot ONLY while Q is listening) ─
  let ctx = null, stream = null, micSrc = null, proc = null, mute = null, ratio = 1;
  async function acquire() {
    if (ctx) { try { if (ctx.state === "suspended") await ctx.resume(); } catch (e) {} return; }
    ctx = new Ctx({ sampleRate: SR });
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    micSrc = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(2048, 1, 1);
    mute = ctx.createGain(); mute.gain.value = 0;                     // silent pump so onaudioprocess keeps firing
    micSrc.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
    ratio = ctx.sampleRate / SR;                                     // Safari may ignore the requested rate → resample
    proc.onaudioprocess = (e) => { if (disposed) return; ingest(e.inputBuffer.getChannelData(0)); pump(); };
  }
  function release() {
    stopSpeak();
    try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); } if (micSrc) micSrc.disconnect(); if (mute) mute.disconnect(); } catch (e) {}
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { if (ctx) ctx.close(); } catch (e) {}
    ctx = stream = micSrc = proc = mute = null; acc = new Float32Array(0); inSpeech = false; utter = []; sink.level = 0;
  }

  // ── state ──────────────────────────────────────────────────────────────────────────────────────────
  let listening = false, disposed = false, busy = false;             // busy = thinking/speaking (don't capture intent)
  let inSpeech = false, silenceMs = 0, prevE = 0;
  let acc = new Float32Array(0);                                     // 16 kHz sample accumulator → 512 frames
  let utter = [];                                                    // buffered utterance frames
  const preroll = []; const PREROLL_FR = Math.max(1, Math.round((PREROLL_MS / 1000) * SR / FRAME));
  let player = null;                                                 // the current TTS source (for barge-in)

  function setSig(rms, bands) {
    sink.level = Math.min(1.4, rms * 6);
    if (bands) { sink.bass = bands.b; sink.mid = bands.m; sink.treble = bands.t; }
    const onset = Math.max(0, rms - prevE) * 8; prevE = rms; sink.onset = Math.min(1, onset);
  }
  function bandsOf(frame) {                                          // crude 3-band from a time-domain frame
    let b = 0, m = 0, t = 0; const n = frame.length, a = n / 3 | 0;
    for (let i = 0; i < n; i++) { const v = Math.abs(frame[i]); if (i < a) b += v; else if (i < 2 * a) m += v; else t += v; }
    return { b: Math.min(1, b / a * 3), m: Math.min(1, m / a * 3), t: Math.min(1, t / Math.max(1, n - 2 * a) * 3) };
  }
  const rmsOf = (f) => { let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i]; return Math.sqrt(s / f.length); };

  // resample an incoming buffer (ctx rate) → 16 kHz, append to the accumulator
  function ingest(input) {
    let f16;
    if (Math.abs(ratio - 1) < 1e-3) { f16 = input.slice ? input.slice(0) : new Float32Array(input); }
    else { const out = new Float32Array(Math.floor(input.length / ratio)); for (let i = 0; i < out.length; i++) out[i] = input[Math.floor(i * ratio)] || 0; f16 = out; }
    const merged = new Float32Array(acc.length + f16.length); merged.set(acc); merged.set(f16, acc.length); acc = merged;
  }

  // the async pump: drain the accumulator one 512-frame at a time (VAD is async)
  let pumping = false;
  async function pump() {
    if (pumping) return; pumping = true;
    try {
      while (acc.length >= FRAME && !disposed) {
        const frame = acc.subarray(0, FRAME); acc = acc.slice(FRAME);
        const rms = rmsOf(frame);
        setSig(rms, bandsOf(frame));
        if (!listening) continue;
        let speech;
        if (vad) { try { speech = (await vad.speechProb(frame)) > vad.threshold; } catch (e) { speech = rms > 0.02; } }
        else speech = rms > 0.02;
        // barge-in: the user speaks while Q is talking → stop Q, start capturing
        if (busy && speech && player) { stopSpeak(); busy = false; onState("listening"); }
        if (busy) continue;
        if (speech) {
          if (!inSpeech) { inSpeech = true; utter = preroll.slice(); onState("listening"); }
          utter.push(frame.slice(0)); silenceMs = 0;
        } else if (inSpeech) {
          utter.push(frame.slice(0)); silenceMs += FRAME / SR * 1000;
          if (silenceMs >= HANG_MS) await endpoint();
        } else {
          preroll.push(frame.slice(0)); if (preroll.length > PREROLL_FR) preroll.shift();
        }
      }
    } finally { pumping = false; }
  }

  async function endpoint() {
    inSpeech = false; silenceMs = 0;
    const frames = utter; utter = [];
    const ms = frames.length * FRAME / SR * 1000;
    if (ms < MIN_UTTER_MS) return;                                   // too short → not an utterance
    const audio = concat(frames);
    busy = true; onState("thinking"); onText("");
    let text = "";
    try { const r = await asr.transcribe(audio, { language: lang }); text = (r && r.text || "").trim(); } catch (e) {}
    if (!text) { busy = false; if (listening) onState("listening"); return; }
    onText(text);
    let reply = "";
    try { reply = await onIntent(text); } catch (e) { reply = ""; }
    if (disposed) return;
    if (reply) { onState("speaking"); onText(reply); await speak(reply); }
    busy = false; if (listening) onState("listening");
  }

  function concat(frames) { let n = 0; for (const f of frames) n += f.length; const out = new Float32Array(n); let o = 0; for (const f of frames) { out.set(f, o); o += f.length; } return out; }

  // ── speak: Kokoro synth → play on the same context, with an analyser so the orb reacts to Q's voice ──
  async function speak(text) {
    if (!text || !ctx) return;
    let raw; try { raw = await tts.synth(text, {}); } catch (e) { return browserSpeak(text); }
    if (!raw || !raw.audio || !ctx) return browserSpeak(text);
    try { if (ctx.state === "suspended") await ctx.resume(); } catch (e) {}
    const rate = raw.sampling_rate || 24000;
    const ab = ctx.createBuffer(1, raw.audio.length, rate); ab.copyToChannel(raw.audio, 0);
    const src = ctx.createBufferSource(); src.buffer = ab;
    const an = ctx.createAnalyser(); an.fftSize = 256; const fr = new Uint8Array(an.frequencyBinCount);
    src.connect(an); an.connect(ctx.destination);
    player = src;
    let rafId = 0;
    (function meter() { if (!player) return; an.getByteFrequencyData(fr); let s = 0; for (let i = 0; i < fr.length; i++) s += fr[i] / 255; setSig(Math.min(1.4, s / fr.length * 2.4)); rafId = requestAnimationFrame(meter); })();
    await new Promise((res) => { src.onended = res; try { src.start(); } catch (e) { res(); } });
    if (rafId) cancelAnimationFrame(rafId);
    player = null; sink.level = 0;
  }
  function stopSpeak() { if (player) { try { player.onended = null; player.stop(); } catch (e) {} player = null; sink.level = 0; } try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) {} }
  function browserSpeak(text) {                                      // last-ditch voice if Kokoro can't synth
    return new Promise((res) => { try { if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return res(); const u = new SpeechSynthesisUtterance(text); u.onend = u.onerror = () => res(); speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { res(); } });
  }

  // start = acquire the mic + listen; pause = stop capturing but stay in Q (tap-to-talk); stop = full
  // release (leaving Q, mic indicator off). Models stay loaded across pause/resume — only the mic cycles.
  async function start() { try { await acquire(); } catch (e) { return; } listening = true; busy = false; inSpeech = false; if (vad) try { vad.reset(); } catch (e) {} onState("listening"); }
  function pauseListen() { listening = false; stopSpeak(); busy = false; inSpeech = false; utter = []; sink.level = 0; onState("idle"); }
  function toggle() { if (listening && !busy) pauseListen(); else start(); }
  function stop() { listening = false; release(); busy = false; onState("idle"); }
  function dispose() { disposed = true; listening = false; release(); }

  return { kind: "holo", ready: true, start, stop, toggle, speak, dispose,
    info: () => ({ asr: asr.info && asr.info(), vad: !!vad, tts: tts.info && tts.info() }) };
}

export default createQVoice;
