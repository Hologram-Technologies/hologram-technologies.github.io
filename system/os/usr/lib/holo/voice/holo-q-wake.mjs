// holo-q-wake.mjs — hands-free wake word for the Hologram home.
//
// A low-duty always-listening gate: mic → silero VAD proposes "this is speech" → whisper-tiny disposes
// (transcribes the short burst) → if it begins with the wake phrase ("Q", or "Computer"), fire onWake with
// anything said AFTER it, so "Q, open notes" both wakes Q AND carries the first intent. Pure-ONNX, fully
// on-device (the same vendored κ-disk seams as the hero's loop) — no audio leaves the phone.
//
// OPT-IN + FAIL-CLOSED: createWakeWord() rejects if the mic or the ear model is unavailable; the home then
// simply never arms. stop() releases the mic entirely (indicator off) so the hero can take it on open.
//
// "Q" is acoustically ambiguous for open-vocab ASR (queue / cue / kew …), so we match its common homophones
// and also accept the unambiguous "Computer". A dedicated KWS model would tighten this later; this is the
// honest pure-ONNX floor (VAD proposes, tiny-Whisper disposes) and needs real-mic threshold tuning.
//
//   const w = await createWakeWord({ onWake(command){…}, lang });
//   w.start();  w.stop();  w.dispose();  w.active

import { createASR } from "./holo-voice-asr.mjs";
import { createVAD } from "./holo-voice-vad.mjs";

const SR = 16000, FRAME = 512, HANG_MS = 550, MAX_MS = 2600, MIN_MS = 180;
const LEAD = ["hey", "ok", "okay", "hi", "hello", "yo", "hay"];           // optional carriers before the wake word
const QHOMO = ["q", "queue", "cue", "kew", "cu", "qs", "quee", "kyu", "kews", "ques"];   // whisper-tiny spellings of "Q"

function normalize(s) { return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }
export function matchWake(text) {
  const t = normalize(text); if (!t) return null;
  const toks = t.split(" "); let i = 0;
  if (LEAD.indexOf(toks[0]) >= 0) i = 1;                                  // skip a leading "hey"/"ok"/…
  const first = toks[i] || "";
  if (first === "computer" || QHOMO.indexOf(first) >= 0) return { command: toks.slice(i + 1).join(" ").trim() };
  return null;
}

export async function createWakeWord(opts = {}) {
  const onWake = typeof opts.onWake === "function" ? opts.onWake : function () {};
  const lang = (opts.lang || "en").slice(0, 2);
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) throw new Error("no mic");
  const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) throw new Error("no AudioContext");

  const asr = createASR({ lang });
  await asr.load();                                                       // whisper-tiny; throws if not vendored → caller never arms
  let vad = null; try { vad = await createVAD({ threshold: 0.6 }); } catch (e) { vad = null; }   // optional → energy fallback

  let ctx = null, stream = null, src = null, proc = null, mute = null, ratio = 1;
  let running = false, disposed = false, inSpeech = false, silenceMs = 0, busy = false;
  let acc = new Float32Array(0), utter = [];

  const rmsOf = (f) => { let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i]; return Math.sqrt(s / f.length); };
  function ingest(input) {
    let f16;
    if (Math.abs(ratio - 1) < 1e-3) f16 = input.slice ? input.slice(0) : new Float32Array(input);
    else { const o = new Float32Array(Math.floor(input.length / ratio)); for (let i = 0; i < o.length; i++) o[i] = input[Math.floor(i * ratio)] || 0; f16 = o; }
    const m = new Float32Array(acc.length + f16.length); m.set(acc); m.set(f16, acc.length); acc = m;
  }
  function concat(frames) { let n = 0; for (const f of frames) n += f.length; const out = new Float32Array(n); let o = 0; for (const f of frames) { out.set(f, o); o += f.length; } return out; }

  let pumping = false;
  async function pump() {
    if (pumping) return; pumping = true;
    try {
      while (acc.length >= FRAME && !disposed && running) {
        const frame = acc.subarray(0, FRAME); acc = acc.slice(FRAME);
        if (busy) continue;
        const rms = rmsOf(frame);
        let speech;
        if (vad) { try { speech = (await vad.speechProb(frame)) > vad.threshold; } catch (e) { speech = rms > 0.02; } }
        else speech = rms > 0.02;
        if (speech) {
          if (!inSpeech) { inSpeech = true; utter = []; }
          utter.push(frame.slice(0)); silenceMs = 0;
          if (utter.length * FRAME / SR * 1000 > MAX_MS) await decide();   // a wake phrase is short → cap the burst
        } else if (inSpeech) {
          utter.push(frame.slice(0)); silenceMs += FRAME / SR * 1000;
          if (silenceMs >= HANG_MS) await decide();
        }
      }
    } finally { pumping = false; }
  }
  async function decide() {
    inSpeech = false; silenceMs = 0;
    const frames = utter; utter = [];
    if (frames.length * FRAME / SR * 1000 < MIN_MS) return;               // too short to be the wake word
    busy = true;
    let text = "";
    try { const r = await asr.transcribe(concat(frames), { language: lang }); text = (r && r.text || "").trim(); } catch (e) {}
    busy = false;
    const hit = matchWake(text);
    if (hit) { try { onWake(hit.command || ""); } catch (e) {} }
  }

  async function acquire() {
    if (ctx) { try { if (ctx.state === "suspended") await ctx.resume(); } catch (e) {} return; }
    ctx = new Ctx({ sampleRate: SR });
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    src = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(2048, 1, 1);
    mute = ctx.createGain(); mute.gain.value = 0;
    src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
    ratio = ctx.sampleRate / SR;
    proc.onaudioprocess = (e) => { if (disposed || !running) return; ingest(e.inputBuffer.getChannelData(0)); pump(); };
  }
  function release() {
    try { if (proc) { proc.onaudioprocess = null; proc.disconnect(); } if (src) src.disconnect(); if (mute) mute.disconnect(); } catch (e) {}
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    try { if (ctx) ctx.close(); } catch (e) {}
    ctx = stream = src = proc = mute = null; acc = new Float32Array(0); inSpeech = false; utter = []; busy = false;
  }

  async function start() { if (running) return; running = true; try { await acquire(); if (vad) try { vad.reset(); } catch (e) {} } catch (e) { running = false; } }
  function stop() { running = false; release(); }
  function dispose() { disposed = true; running = false; release(); }

  return { kind: "holo-wake", start, stop, dispose, get active() { return running; } };
}

export default createWakeWord;
