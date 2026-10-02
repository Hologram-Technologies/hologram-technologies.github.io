// core/voice-out.js — THE canonical Q voice (shared by apps/q, the messenger, and any Q surface). Speaks Q's
// answers on-device with Kokoro-82M and drives the orb's speaking swell from Q's REAL amplitude.
//
// Enhanced over the original singleton: sentence-CHUNKED low-latency synthesis (Q starts talking after the FIRST
// sentence, pipelining synth with playback), an AnalyserNode that broadcasts `holo-q-state {mode:'speaking',
// level}` so ANY orb pulses to Q's voice, a speechSynthesis FLOOR (Q never goes mute), and DUAL loading so it
// works everywhere: fully-local vendored TTS (/usr/lib/holo/voice — no HF, no import map) with the original
// kokoro-js path (/_shared + HF weights) as a fallback. Kokoro loading is DYNAMIC so a missing import map can
// never break this module's load. Original preserved as voice-out.js.pre-converge.bak.
//
// Two APIs, one engine:
//   createVoice({onLevel}) → { speak, stop, warmHD, attachHD, hasHD, speaking }   — rich (messenger orb wiring)
//   ready() · loadVoice(onProgress) · speak(text[,voice]) · stop() · engine()      — backward-compat singleton
//                                                                                     (apps/q q-chat.html etc.)

// HQ-ONLY LAW (operator, 2026-07-13): Q speaks in its beautiful neural voice or it HOLDS — the robotic
// speechSynthesis floor is opt-in only (?osvoice=1, accessibility). A held utterance is parked (latest wins)
// and spoken the instant the HD voice warms, so the first thing you ever hear from Q is already gorgeous.
const _OS_FLOOR = (() => { try { return /[?&]osvoice=1/.test(location.search); } catch (e) { return false; } })();

// HOLO VOICE ATLAS: resolve Q's deterministic phrases to pre-baked premium κ-audio (instant, no model warm). Fail-soft:
// a missing module/manifest, a miss, a tampered body (L5 sha256 re-derive fails), or a decode error → null, and
// speak() falls through to the live HD path exactly as before. Assets live in the NON-evicted usr/lib/holo/voice.
let _atlas = null, _atlasLoad = null;
function _ensureAtlas() {
  if (_atlas) return Promise.resolve(_atlas);
  if (_atlasLoad) return _atlasLoad;
  const urls = ["/usr/lib/holo/voice/holo-voice-atlas.mjs"];
  try { urls.push(new URL("../../../usr/lib/holo/voice/holo-voice-atlas.mjs", import.meta.url).href); } catch (e) {}
  const bases = ["/usr/lib/holo/voice/"];
  try { bases.push(new URL("../../../usr/lib/holo/voice/", import.meta.url).href); } catch (e) {}
  _atlasLoad = (async () => {
    for (let i = 0; i < urls.length; i++) {
      try {
        const m = await import(/* @vite-ignore */ urls[i]);
        const mk = m && (m.makeAtlas || m.default);
        if (mk) { const a = mk({ base: bases[i] || bases[0], verify: true }); await a.ensure(); if (a.size && a.size() > 0) { _atlas = a; return a; } }
      } catch (e) {}
    }
    return null;
  })().then((a) => { if (!a) _atlasLoad = null; return a; }).catch(() => { _atlasLoad = null; return null; }); /* HOLO-ATLAS-RETRY */
  return _atlasLoad;
}
async function _atlasGet(text) { try { const a = await _ensureAtlas(); if (!a || !a.has(text)) return null; return await a.get(text); } catch (e) { return null; } }
try { _ensureAtlas(); } catch (e) {}

/* HOLO-POCKET-VOICE */
// kyutai pocket-tts 100M — Q's DEFAULT live voice: streams on-device in real time (first audio
// ~240-900ms warm, no COI needed; webgpu when present, wasm else). Weights stream once from the
// HOLOGRAMTECH HF mirror and persist in the Cache API. Fail-soft: any failure → the pre-pocket ladder.
let _pocket = null, _pocketLoad = null; /* HOLO-POCKET-V2 */
function _ensurePocket() {
  if (_pocket) return Promise.resolve(_pocket);
  if (_pocketLoad) return _pocketLoad;
  const urls = [];
  try { urls.push(new URL("../../../usr/lib/holo/voice/pocket/holo-pocket-voice.mjs", import.meta.url).href); } catch (e) {}
  urls.push("/usr/lib/holo/voice/pocket/holo-pocket-voice.mjs");
  _pocketLoad = (async () => {
    for (const u of urls) {
      try { const m = await import(/* @vite-ignore */ u); const mk = m && (m.createPocketVoice || m.default); if (mk) { _pocket = mk({}); return _pocket; } } catch (e) {}
    }
    return null;
  })().then((p) => { if (!p) _pocketLoad = null; return p; }).catch(() => { _pocketLoad = null; return null; });
  return _pocketLoad;
}
function _pocketReady() { try { return !!(_pocket && _pocket.isReady()); } catch (e) { return false; } }

/* HOLO-VOICE-MUTE: Q's voice is ON by default — this is the one user switch that silences it, everywhere. */
const _MUTE_KEY = "holo-voice-mute";
function _voiceMuted() { try { return localStorage.getItem(_MUTE_KEY) === "1"; } catch (e) { return false; } }
export function muted() { return _voiceMuted(); }
export function setMuted(m) {
  try { localStorage.setItem(_MUTE_KEY, m ? "1" : "0"); } catch (e) {}
  if (m) { try { stop(); } catch (e) {} try { if (_pocket && _pocket.stop) _pocket.stop(); } catch (e) {} }
  try { (typeof window !== "undefined" ? window : self).dispatchEvent(new CustomEvent("holo-voice-mute", { detail: { muted: !!m } })); } catch (e) {}
}

/* HOLO-POCKET-AUTOWARM: voice ready before the first reply — warm at idle (download needs no gesture).
   Respects the user: skipped when muted, on data-saver, or on 2g. Fail-soft and once per page. */
try {
  const _autoWarm = () => {
    try {
      if (_voiceMuted()) return;
      const c = typeof navigator !== "undefined" && navigator.connection;
      if (c && (c.saveData || /(^|-)2g$/.test(String(c.effectiveType || "")))) return;
      _ensurePocket().then((pv) => { if (pv) pv.warm(); });
    } catch (e) {}
  };
  if (typeof window !== "undefined") {
    if ("requestIdleCallback" in window) setTimeout(() => requestIdleCallback(_autoWarm, { timeout: 8000 }), 3500);
    else setTimeout(_autoWarm, 5000);
  }
} catch (e) {}


export function createVoice(opts = {}) {
  const onLevel = typeof opts.onLevel === "function" ? opts.onLevel : function () {};
  let raf = 0, lvl = 0, tgt = 0, active = false, cur = null, hd = null, ac = null, node = null, curSrc = null, parked = null;

  function pump() {
    if (!active) return;
    lvl += (tgt - lvl) * 0.28; tgt *= 0.90;                 // attack fast, decay smooth → a living pulse
    try { onLevel(Math.max(0, Math.min(1, lvl))); } catch (e) {}
    raf = requestAnimationFrame(pump);
  }
  function begin() { if (active) return; active = true; lvl = 0; tgt = 0; raf = requestAnimationFrame(pump); }
  function finish() { active = false; if (raf) cancelAnimationFrame(raf); raf = 0; try { onLevel(0); } catch (e) {} }

  // play ONE synthesized chunk through Web Audio; an AnalyserNode drives the orb with Q's real amplitude.
  function playBuffer(out) {
    return new Promise((res) => {
      if (!out || !out.audio || !active) { res(false); return; }
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const start = () => {
        const buf = ac.createBuffer(1, out.audio.length, out.sampling_rate || 24000);
        buf.getChannelData(0).set(out.audio);
        const srcN = ac.createBufferSource(); srcN.buffer = buf; curSrc = srcN;
        node = ac.createAnalyser(); node.fftSize = 512; node.smoothingTimeConstant = 0.6;
        const bins = new Uint8Array(node.frequencyBinCount);
        srcN.connect(node); node.connect(ac.destination);
        const meter = () => { if (!active) return; node.getByteFrequencyData(bins); let s = 0; for (let i = 0; i < bins.length; i++) s += bins[i]; tgt = Math.min(1, (s / bins.length) / 90 * 1.6); requestAnimationFrame(meter); };
        requestAnimationFrame(meter);
        let done = false; const finishOne = () => { if (done) return; done = true; if (curSrc === srcN) curSrc = null; res(true); };
        srcN.onended = finishOne;
        const durMs = (out.audio.length / (out.sampling_rate || 24000)) * 1000;
        setTimeout(finishOne, durMs + 500);                 // safety: resolve even if onended never fires → can't hang
        try { srcN.start(); } catch (e) { finishOne(); }
      };
      if (ac.state === "suspended") ac.resume().then(start, start); else start();
    });
  }
  // HD path — LOW LATENCY: split into sentences and PIPELINE synth with playback (synth i+1 while i plays).
  function sentences(text) { return (String(text).match(/[^.!?…]+[.!?…]+(?:["')\]]+)?|[^.!?…]+$/g) || [text]).map((s) => s.trim()).filter(Boolean); }
  async function speakHD(text) {
    const parts = sentences(text); if (!parts.length) return false;
    begin();
    let next = hd.synth(parts[0]);
    let spokeAny = false;
    for (let i = 0; i < parts.length && active; i++) {
      let out; try { out = await next; } catch (e) { if (i === 0 && !spokeAny) { finish(); throw e; } break; }
      next = (i + 1 < parts.length) ? Promise.resolve(hd.synth(parts[i + 1])).catch(() => null) : null;
      if (out && out.audio) { await playBuffer(out); spokeAny = true; }
    }
    finish();
    return spokeAny;
  }

  // Floor: speechSynthesis. The orb pulses on each word boundary → tracks Q's real cadence (never a sine).
  function speakSpeech(text) {
    return new Promise((res) => {
      const synth = typeof window !== "undefined" && window.speechSynthesis;
      if (!synth) { res(false); return; }
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0; u.pitch = 1.02;
      u.onstart = () => { begin(); tgt = 0.55; };
      u.onboundary = () => { tgt = Math.min(1, tgt + 0.5); };
      u.onend = () => { finish(); cur = null; res(true); };
      u.onerror = () => { finish(); cur = null; res(false); };
      cur = u;
      try { synth.cancel(); synth.speak(u); } catch (e) { finish(); res(false); }
    });
  }

  function stop() {
    active = false;
    try { if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    try { if (_pocket && _pocket.stop) _pocket.stop(); } catch (e) {} /* HOLO-POCKET-STOP */
    qsess = null; /* HOLO-POCKET-QUEUE-STOP: _pocket.stop() above killed the live queue session */
    try { if (curSrc) curSrc.stop(); } catch (e) {} curSrc = null;
    try { if (node) node.disconnect(); } catch (e) {}
    finish(); cur = null;
  }

  async function speak(text) {
    text = String(text || "").trim(); if (!text) return false;
    if (_voiceMuted()) return false;   /* HOLO-VOICE-MUTE-GATE: silent while muted — nothing parked */
    stop();
    /* HOLO VOICE ATLAS rung: pre-baked premium audio → instant, even before HD warms (else Q holds silent). */
    try { const _bk = await _atlasGet(text); if (_bk && _bk.audio && _bk.audio.length) { begin(); await playBuffer({ audio: _bk.audio, sampling_rate: _bk.rate }); finish(); return true; } } catch (e) {}
    /* HOLO-POCKET-RUNG: the default live voice — stream pocket-tts when warm (real-time, on-device). */
    if (_pocketReady()) { try { begin(); ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const _ok = await _pocket.speak(text, { ctx: ac, onLevel: (v) => { tgt = v; } }); finish(); if (_ok) return true; } catch (e) { finish(); } }
    if (hd) { try { return await speakHD(text); } catch (e) { /* HD errored mid-utterance → floor only if opted in */ } }
    if (_OS_FLOOR) return speakSpeech(text);   // accessibility floor, explicit opt-in only
    parked = text; return false;               // HQ-or-hold: spoken beautifully the moment HD warms (latest wins)
  }

  // warm the ON-DEVICE HD voice. Plan A = fully-local vendored createTTS (messenger/OS: no HF, no import map);
  // Plan B = the original kokoro-js path (apps/q: /_shared + HF weights, needs the page import map). DYNAMIC
  // imports throughout so a missing import map never breaks module load. Guarded → any failure leaves the floor.
  let warming = null;
  function warmHD(o) {
    o = o || {};
    if (hd) return Promise.resolve(true);
    if (warming) return warming;
    warming = (async () => {
      const gpu = typeof navigator !== "undefined" && !!navigator.gpu;
      /* HOLO-POCKET-WARM: the ONE engine. Success = HQ voice armed (no fallback engines — canon). */
      try { const _pv = await _ensurePocket(); if (_pv) { const _ok = await _pv.warm(o.onProgress); if (_ok) return true; } } catch (e) {}
      /* HOLO-VOICE-CANON (operator 2026-07-16): kokoro Plans A/B removed — pocket-tts IS the voice.
         Failure mode is HOLD (atlas still speaks fixed phrases; parked text speaks when pocket warms
         on a later retry). ?osvoice=1 accessibility floor unchanged. */
      return false;
    })().catch(() => false)
      .then((ok) => { if (ok && parked) { const t = parked; parked = null; speak(t); } return ok; });   // HD just warmed → speak the held utterance
    return warming;
  }

  /* HOLO-POCKET-QUEUE: streamed-reply voice — enqueue clauses as they complete; gapless. */
  let qsess = null;
  async function speakQ(text) {
    text = String(text || "").trim(); if (!text) return false;
    if (_voiceMuted()) return false;
    if (!_pocketReady() || !_pocket.openQueue) return speak(text);   // not warm → classic ladder (atlas/park)
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (!qsess || qsess.closed) { qsess = _pocket.openQueue({ ctx: ac, onLevel: (v) => { tgt = v; }, onDrain: () => { finish(); } }); }
      begin();
      return await qsess.enqueue(text);
    } catch (e) { try { finish(); } catch (e2) {} return false; }
  }
  return { speak, speakQ, stop, warmHD, attachHD(engine) { hd = engine || null; }, hasHD() { return !!hd || _pocketReady(); }, get speaking() { return active; } };
}

// ── backward-compatible SINGLETON API (apps/q q-chat.html, make-chat-space.mjs). Progressive enhancement: warms
// Kokoro in the background, floors on speechSynthesis, and broadcasts `holo-q-state` so the orb pulses to Q. ──
let _singleton = null;
function _s() {
  if (_singleton) return _singleton;
  _singleton = createVoice({ onLevel: (level) => { try { (typeof window !== "undefined" ? window : self).dispatchEvent(new CustomEvent("holo-q-state", { detail: { mode: "speaking", level } })); } catch (e) {} } });
  try { _singleton.warmHD(); } catch (e) {}
  return _singleton;
}
export function ready() { return _s().hasHD(); }
export async function loadVoice(onProgress) { return _s().warmHD({ onProgress }); }
export function speak(text, voice) { return _s().speak(text); }   // voice arg accepted for compat (default af_heart)
export function speakQueued(text) { return _s().speakQ(text); }   /* HOLO-POCKET-QUEUE: clause-streamed speech */
export function stop() { try { if (_singleton) _singleton.stop(); } catch (e) {} }
export function engine() { return _pocketReady() ? "pocket-tts" : _s().hasHD() ? "kokoro" : "speechSynthesis"; }

export default createVoice;
