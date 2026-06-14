// holo-voice.js — Holo Voice: OS-wide, serverless voice navigation for Hologram OS.
//
// Drop-in:  <script src="_shared/holo-voice.js" defer></script>   (exposes window.HoloVoice)
//
// Speak to the OS. A floating mic (push-to-talk, or Alt+V) captures one utterance, an ON-DEVICE
// recognizer turns it into text, an intent router maps it to a real OS action, and the OS confirms
// out loud. Nothing leaves the device:
//
//   capture (getUserMedia + VAD) → recognize (HoloQVAC.transcribe, on-device) → intent → action → speak
//
// Recognition prefers the serverless engine (holo-voice-asr.mjs → Whisper/Moonshine, bound into the
// QVAC seam, conscience-gated, sealed receipt per turn). Until model weights are vendored, a clearly-
// marked browser-SpeechRecognition path lets the loop be verified end-to-end (it is NOT serverless and
// logs a warning). Text-to-speech uses the browser's on-device speechSynthesis (zero download, every
// browser); a κ-disk neural voice can replace it later through the same seam. Pure DOM + Web APIs (L4).

(function () {
  "use strict";
  var W = window; if (W.HoloVoice) return;
  if (typeof document === "undefined") return;
  try { if (W.top !== W.self) return; } catch (e) { return; }          // top-level shell only

  var DOC = document, root = DOC.documentElement;
  var SELF = (DOC.currentScript && DOC.currentScript.src) ||
    (DOC.querySelector('script[src*="holo-voice.js"]') || {}).src ||
    new URL("_shared/holo-voice.js", location.href).href;
  var BASE = SELF.replace(/holo-voice\.js.*$/, "");                     // …/_shared/
  var CFG = Object.assign({ engine: "auto", remote: false, lang: null, confirm: true, preferWebGPU: false, wakeWord: "Q", voice: "af_heart",
    bargeFloor: 0.05, bargeEcho: 0.4, bargeFrames: 9, silenceMs: 550,
    turnDetect: true, turnSilenceMs: 250, turnContinueMs: 600, turnModel: false, turnThreshold: 0.55,   // semantic turn-taking
    stream: true, streamPartialMs: 550,   // streaming ASR — recognize WHILE you talk (off → buffered)
    mind: true, mindSpeak: true, proactive: false, proactiveGoals: false,   // Holo Mind: orchestrate · speak-back · proactive
    backchannel: true, backchannelGain: 0.4, backchannelChance: 0.55, backchannelMinMs: 2600,   // soft "mm-hmm" while you talk
    confirmActions: true },   // converse first; PROPOSE every action and wait for your OK before doing it
    W.HOLO_VOICE_CONFIG || {});   // turn-taking + barge-in (tune on real HW)
  // persisted user toggles override config: the agent brain runs on WebGPU (1.5B, fast on a real GPU)
  // or the WASM floor (0.5B, any browser); and the wake word (its name) is whatever you choose.
  try { var _pref = localStorage.getItem("holo.voice.webgpu"); if (_pref === "1") CFG.preferWebGPU = true; else if (_pref === "0") CFG.preferWebGPU = false; } catch (e) {}
  try { var _ww = localStorage.getItem("holo.voice.wakeword"); if (_ww) CFG.wakeWord = _ww; } catch (e) {}
  try { var _vc = localStorage.getItem("holo.voice.voice"); if (_vc) CFG.voice = _vc; } catch (e) {}

  var STATE = { mode: null, busy: false, listening: false, asr: null, lastText: "", lastAction: null,
    liveOn: false, live: "idle", welcoming: false, micLevel: 0, ttsLevel: 0, mindPulse: 0, pending: null };   // live = idle|listening|thinking|speaking|welcome ; mindPulse = flare ; pending = a proposed action awaiting your OK

  // ── latency telemetry: clock each turn from the user's end-of-speech (t0) to Q's first sound ───────
  // The number that decides whether it feels real-time is `firstAudio` (endpoint → Q starts talking).
  var LAST_METRICS = null, _turn = null;
  function turnStart() { _turn = { t0: performance.now(), at: {} }; }
  function tmark(name) { if (_turn && _turn.at[name] == null) _turn.at[name] = Math.round(performance.now() - _turn.t0); }
  function turnEnd() { if (!_turn) return; _turn.total = Math.round(performance.now() - _turn.t0); LAST_METRICS = _turn; try { W.dispatchEvent(new CustomEvent("holo-voice-metrics", { detail: _turn })); } catch (e) {} _turn = null; }

  // ── text-to-speech ───────────────────────────────────────────────────────────────────────────────
  // speakNatural() is what Q uses: it prefers Kokoro (warm, human, on-device) and falls back to the
  // browser's built-in speechSynthesis if the neural voice isn't ready — so Q always talks.
  function speakSynth(text, o) {                                       // the always-available floor
    o = o || {};
    try {
      var synth = W.speechSynthesis; if (!synth || !text) return { ok: false, runtime: "none" };
      synth.cancel();
      var u = new SpeechSynthesisUtterance(String(text));
      if (o.rate) u.rate = o.rate; if (o.pitch) u.pitch = o.pitch;
      synth.speak(u);
      return { ok: true, runtime: "browser-speechsynthesis" };
    } catch (e) { return { ok: false, runtime: "none" }; }
  }
  // ── audio out: a gapless playback queue + a κ-memoised phrase cache ───────────────────────────────
  // Clips are scheduled back-to-back on the AudioContext clock, so streamed sentences play seamlessly
  // (Q starts talking on sentence 1 while sentence 2 is still being synthesised). The orb meters the
  // live amplitude (ttsLevel) for its intonation. Every synthesised clip is memoised by its content
  // address (voice ⊕ text) — Q's fixed phrases (acks, confirmations, the welcome) become O(1) replays
  // with zero inference. (In-memory store now; a κ-disk/OPFS backend drops in behind the same key.)
  var _ttsAC = null, _ttsAn = null, _ttsBuf = null, _ttsRaf = 0, _playCursor = 0, _queueSrcs = [], _activeSpeaker = null;
  function ensureAC() {
    var AC = W.AudioContext || W.webkitAudioContext;
    if (!_ttsAC) { _ttsAC = new AC(); _ttsAn = _ttsAC.createAnalyser(); _ttsAn.fftSize = 512; _ttsAn.connect(_ttsAC.destination); _ttsBuf = new Uint8Array(_ttsAn.fftSize); }
    return _ttsAC;
  }
  function meter() {
    if (!_ttsAn) { _ttsRaf = 0; return; }
    _ttsAn.getByteTimeDomainData(_ttsBuf); var m = 0;
    for (var i = 0; i < _ttsBuf.length; i++) { var v = Math.abs((_ttsBuf[i] - 128) / 128); if (v > m) m = v; }
    if (_queueSrcs.length) { STATE.ttsLevel = m; _ttsRaf = requestAnimationFrame(meter); } else { STATE.ttsLevel = 0; _ttsRaf = 0; }
  }
  function startMeter() { if (!_ttsRaf) _ttsRaf = requestAnimationFrame(meter); }
  // schedule a clip to play immediately AFTER whatever is already queued (gapless). Resolves on its end.
  function enqueuePCM(float32, rate) {
    try {
      var ac = ensureAC(); if (ac.state === "suspended" && ac.resume) ac.resume();
      var b = ac.createBuffer(1, float32.length, rate); b.getChannelData(0).set(float32);
      var s = ac.createBufferSource(); s.buffer = b; s.connect(_ttsAn);
      var startAt = Math.max(ac.currentTime + 0.01, _playCursor || 0);
      s.start(startAt); _playCursor = startAt + b.duration; _queueSrcs.push(s); startMeter(); tmark("firstAudio");
      return new Promise(function (res) { s.onended = function () { var i = _queueSrcs.indexOf(s); if (i >= 0) _queueSrcs.splice(i, 1); res(); }; });
    } catch (e) { return Promise.reject(e); }
  }
  // single-shot play: interrupt anything in flight, then play this clip (used by one-off speakNatural).
  function playPCM(float32, rate) { stopSpeaking(); return enqueuePCM(float32, rate); }
  function stopSpeaking() {
    if (_activeSpeaker) { try { _activeSpeaker.abort(); } catch (e) {} _activeSpeaker = null; }
    _queueSrcs.splice(0).forEach(function (s) { try { s.onended = null; s.stop(); } catch (e) {} });
    _playCursor = 0; try { W.speechSynthesis && W.speechSynthesis.cancel(); } catch (e) {}
    cancelAnimationFrame(_ttsRaf); _ttsRaf = 0; STATE.ttsLevel = 0;
  }
  // create + resume the audio graph inside a user gesture so playback isn't blocked by autoplay policy.
  function unlockAudio() { try { var ac = ensureAC(); if (ac.state === "suspended" && ac.resume) ac.resume(); } catch (e) {} }

  // κ-memo: a content-addressed cache of synthesised phrases. Key = voice ⊕ text (the content address /
  // κ pre-image); bounded LRU so it can't grow without limit. A hit is an O(1) replay — no model run.
  var _pcmCache = new Map(), _PCM_MAX = 64;
  function phraseKey(text, voice) { return (voice || CFG.voice) + " " + String(text || "").trim(); }
  function getPhrasePCM(text, voice) { var k = phraseKey(text, voice), v = _pcmCache.get(k); if (v) { _pcmCache.delete(k); _pcmCache.set(k, v); } return v || null; }   // touch = LRU bump
  function putPhrasePCM(text, voice, audio, rate) {
    var k = phraseKey(text, voice); if (_pcmCache.has(k)) _pcmCache.delete(k);
    _pcmCache.set(k, { audio: audio, rate: rate });
    while (_pcmCache.size > _PCM_MAX) _pcmCache.delete(_pcmCache.keys().next().value);
  }
  // one ORT TTS session ⇒ synth calls must never overlap. This FIFO lock serialises every synth (the
  // streaming speaker, one-shot speakNatural, and the background prewarm) so they can't collide.
  var _synthLock = Promise.resolve();
  function synthLocked(fn) { var p = _synthLock.then(fn, fn); _synthLock = p.then(function () {}, function () {}); return p; }

  function speakSynthPush(text) {                                     // non-interrupting speechSynthesis (it queues natively)
    try { var u = new SpeechSynthesisUtterance(String(text)); W.speechSynthesis.speak(u); return new Promise(function (r) { u.onend = u.onerror = function () { r(); }; }); }
    catch (e) { return Promise.resolve(); }
  }
  // a streaming voice sink: push text fragments (sentences) and they synthesise IN ORDER and play
  // gaplessly. κ-cache first, neural synth (Kokoro) second, built-in speechSynthesis as the floor.
  function makeSpeaker(opts) {
    opts = opts || {}; var voice = opts.voice || CFG.voice, chain = Promise.resolve(), tail = Promise.resolve(), aborted = false;
    function speakOne(text) {
      return (async function () {
        if (aborted || !text) return;
        var cached = getPhrasePCM(text, voice);
        if (cached) { tail = enqueuePCM(cached.audio, cached.rate); return; }
        try {
          var t = await ensureTTS();
          if (!aborted && t && t.engine) {
            var a = await synthLocked(function () { return t.engine.synth(text, { voice: voice }); });
            if (aborted) return;
            if (a && a.audio) { putPhrasePCM(text, voice, a.audio, a.sampling_rate || 24000); tail = enqueuePCM(a.audio, a.sampling_rate || 24000); return; }
          }
        } catch (e) {}
        if (!aborted) tail = speakSynthPush(text);                    // floor: built-in voice
      })();
    }
    return {
      push: function (text) { text = String(text || "").trim(); if (text) chain = chain.then(function () { return speakOne(text); }); return chain; },
      done: function () { return chain.then(function () { return tail; }); },
      abort: function () { aborted = true; }
    };
  }
  // lazy-load Q's voice (Kokoro). First call downloads-from-disk + compiles once; proxy keeps UI smooth.
  var _tts = null, _ttsTried = false, _ttsLoading = null;
  function ensureTTS() {
    if (_tts) return Promise.resolve(_tts);
    if (_ttsTried && !_ttsLoading) return Promise.resolve(null);
    if (!_ttsLoading) {
      _ttsTried = true;
      _ttsLoading = (async function () {
        try {
          var m = await import(BASE + "voice/holo-voice-tts.mjs");
          var engine = (m.createTTS || m.default)({ voice: CFG.voice, preferWebGPU: CFG.preferWebGPU });
          await engine.load(function (p) { hud("loading", "loading Q’s voice · " + (p && p.file || "")); });
          _tts = { engine }; return _tts;
        } catch (e) { console.warn("[HoloVoice] neural voice unavailable (run tools/vendor-voice-model.mjs) — using built-in voice:", e && e.message || e); return null; }
        finally { _ttsLoading = null; }
      })();
    }
    return _ttsLoading;
  }
  async function speakNatural(text, o) {
    o = o || {}; if (!text) return { ok: false, runtime: "none" }; var voice = o.voice || CFG.voice;
    var cached = getPhrasePCM(text, voice);                            // κ-memo hit → O(1) replay, no synth
    if (cached) { try { if (W.speechSynthesis) W.speechSynthesis.cancel(); } catch (e) {} await playPCM(cached.audio, cached.rate); return { ok: true, runtime: "kokoro-memo" }; }
    try {
      var t = await ensureTTS();
      if (t && t.engine) {
        try { if (W.speechSynthesis) W.speechSynthesis.cancel(); } catch (e) {}
        var a = await synthLocked(function () { return t.engine.synth(text, { voice: voice }); });
        if (a && a.audio) { putPhrasePCM(text, voice, a.audio, a.sampling_rate || 24000); await playPCM(a.audio, a.sampling_rate || 24000); return { ok: true, runtime: "kokoro-" + (t.engine.info().device || "wasm") }; }
      }
    } catch (e) { console.warn("[HoloVoice] neural TTS failed, falling back:", e && e.message || e); }
    return speakSynth(text, o);
  }
  var speak = speakNatural;                                            // Q's default voice

  // ── backchannels: the soft "mm-hmm" of someone who's actually listening — the feels-alive cue ──────
  // When you PAUSE mid-thought (the turn-completion veto says you're not done), Q gives a quiet, brief
  // acknowledgement IN THE GAP — never over your voice, rate-limited, played softly through its own gain
  // so it doesn't trip the barge/endpoint logic. This is the single thing that makes Q feel present.
  var BACKCHANNELS = ["Mm-hmm.", "Right.", "Uh-huh.", "Yeah.", "Go on.", "I see.", "Okay."];
  var _bcLast = 0;
  function playBackchannel(float32, rate) {
    try {
      var ac = ensureAC(); if (ac.state === "suspended" && ac.resume) ac.resume();
      var b = ac.createBuffer(1, float32.length, rate); b.getChannelData(0).set(float32);
      var s = ac.createBufferSource(); s.buffer = b; var g = ac.createGain(); g.gain.value = CFG.backchannelGain || 0.4; s.connect(g); g.connect(_ttsAn); s.start();
    } catch (e) {}
  }
  async function speakBackchannel(text) {
    try {
      var voice = CFG.voice, c = getPhrasePCM(text, voice);
      if (!c) { var t = await ensureTTS(); if (t && t.engine) { var a = await synthLocked(function () { return t.engine.synth(text, { voice: voice }); }); if (a && a.audio) { c = { audio: a.audio, rate: a.sampling_rate || 24000 }; putPhrasePCM(text, voice, c.audio, c.rate); } } }
      if (c) playBackchannel(c.audio, c.rate);
    } catch (e) {}
  }
  function maybeBackchannel() {                                        // at a mid-thought pause: sometimes acknowledge
    if (CFG.backchannel === false || !STATE.liveOn) return;
    var now = Date.now(); if (now - _bcLast < (CFG.backchannelMinMs || 2600)) return;
    if (Math.random() > (CFG.backchannelChance != null ? CFG.backchannelChance : 0.55)) return;
    _bcLast = now; speakBackchannel(BACKCHANNELS[Math.floor(Math.random() * BACKCHANNELS.length)]);
  }

  // warm start: on the first gesture, load the ear + voice in the background so the first real turn
  // doesn't stall on a cold model, then prime the κ-cache with Q's stock phrases so confirmations and
  // acks come back instantly (O(1) replay, zero inference). Idempotent.
  var _warmed = false;
  var PREWARM = ["Yeah?", "What's up?", "Showing the desktop.", "dark mode.", "light mode.", "Done.", "Talk soon.", "I'm here whenever you need me."].concat(BACKCHANNELS);
  function warm() {
    if (_warmed) return; _warmed = true;
    try { ensureMode(); } catch (e) {}                                // load the recognizer
    setTimeout(function () { ensureTTS().then(function (t) { if (t && t.engine) prewarmPhrases(); }); }, 500);
  }
  async function prewarmPhrases() {
    for (var i = 0; i < PREWARM.length; i++) {
      if (getPhrasePCM(PREWARM[i], CFG.voice)) continue;
      while (STATE.live === "speaking" || STATE.live === "thinking") { await new Promise(function (r) { setTimeout(r, 500); }); }   // yield to a live turn
      try { var t = await ensureTTS(); if (t && t.engine) { var a = await synthLocked(function () { return t.engine.synth(PREWARM[i], { voice: CFG.voice }); }); if (a && a.audio) putPhrasePCM(PREWARM[i], CFG.voice, a.audio, a.sampling_rate || 24000); } } catch (e) {}
      await new Promise(function (r) { setTimeout(r, 120); });
    }
  }

  // ── bind the provider into the QVAC voice seam (ASR + TTS), conscience-gated + receipted ─────────
  function bindSeam() {
    if (!W.HoloQVAC || typeof W.HoloQVAC.useHoloVoice !== "function") return;
    var provider = { id: "holo-voice", speak: function (t, opts) { return speak(t, opts); } };
    provider.transcribe = function (audio, opts) { return STATE.asr ? STATE.asr.transcribe(audio, opts) : Promise.reject(new Error("asr not loaded")); };
    try { W.HoloQVAC.useHoloVoice(provider); } catch (e) {}
  }

  // ── recognition mode resolution (serverless first, bring-up fallback second) ─────────────────────
  async function ensureMode() {
    if (STATE.mode) return STATE.mode;
    if (CFG.engine !== "webspeech") {
      try {
        var mod = await import(BASE + "voice/holo-voice-asr.mjs");
        STATE.asr = (mod.createASR || mod.default)({ remote: CFG.remote, proxy: CFG.stream !== false });   // streaming → run ASR in a worker (off → proven main-thread path)
        bindSeam();
        await STATE.asr.load(function (p) { hud("loading", "loading recognizer · " + (p.device || "") + " " + (p.file || "")); });
        STATE.mode = "serverless";
        return STATE.mode;
      } catch (e) {
        console.warn("[HoloVoice] on-device recognizer unavailable (vendor weights to go serverless):", e && e.message || e);
        STATE.asr = null;
      }
    }
    var SR = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (SR && CFG.engine !== "serverless") {
      console.warn("[HoloVoice] using browser SpeechRecognition — BRING-UP ONLY, NOT serverless. Vendor a model for 100% on-device.");
      STATE.mode = "webspeech";
      return STATE.mode;
    }
    STATE.mode = "none";
    return STATE.mode;
  }

  // ── serverless capture: one utterance → Float32 PCM @ 16 kHz (with simple energy VAD) ───────────
  function captureUtterance(o) {
    o = o || {}; var maxMs = o.maxMs || 9000, silenceMs = o.silenceMs || 900, startGraceMs = 1200;
    return new Promise(function (resolve, reject) {
      navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
        var AC = W.AudioContext || W.webkitAudioContext; var ac = new AC();
        var srcNode = ac.createMediaStreamSource(stream), an = ac.createAnalyser(); an.fftSize = 1024; srcNode.connect(an);
        var buf = new Uint8Array(an.fftSize), rec, chunks = [], started = Date.now(), lastLoud = Date.now(), spoke = false, done = false, raf;
        function cleanup() { STATE.micLevel = 0; try { cancelAnimationFrame(raf); } catch (e) {} try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} try { ac.close(); } catch (e) {} }
        function rms() { an.getByteTimeDomainData(buf); var s = 0; for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; s += v * v; } return Math.sqrt(s / buf.length); }
        function tick() {
          if (done) return;
          var level = rms(), now = Date.now(); hud("listening", "listening…", level); STATE.micLevel = level;
          if (level > 0.025) { spoke = true; lastLoud = now; }
          var quietFor = now - lastLoud, elapsed = now - started;
          if ((spoke && quietFor > silenceMs) || elapsed > maxMs || (!spoke && elapsed > startGraceMs + maxMs)) { stop(); return; }
          raf = requestAnimationFrame(tick);
        }
        function stop() { if (done) return; done = true; try { rec.stop(); } catch (e) {} }
        try { rec = new MediaRecorder(stream); } catch (e) { cleanup(); reject(e); return; }
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          cleanup();
          if (!spoke || !chunks.length) { resolve(null); return; }
          var blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
          decodeTo16k(blob).then(resolve).catch(reject);
        };
        rec.start(); raf = requestAnimationFrame(tick);
      }).catch(reject);
    });
  }
  var _decAC = null;
  async function decodeTo16k(blob) {
    var AC = W.AudioContext || W.webkitAudioContext;
    if (!_decAC) { try { _decAC = new AC(); } catch (e) { _decAC = new AC(); } }   // reuse one decode context (no per-utterance create/close)
    var decoded = await _decAC.decodeAudioData(await blob.arrayBuffer());
    var OAC = W.OfflineAudioContext || W.webkitOfflineAudioContext;
    var off = new OAC(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
    var s = off.createBufferSource(); s.buffer = decoded; s.connect(off.destination); s.start();
    var rendered = await off.startRendering();
    return rendered.getChannelData(0);                                  // Float32 mono @ 16 kHz
  }

  // ── STREAMING ASR: recognize WHILE you talk, so end-of-speech ≈ done ───────────────────────────────
  // Captures raw PCM off the persistent mic (no MediaRecorder, no webm decode), downsamples to 16 kHz,
  // and runs ROLLING partial transcriptions during speech (serialised — one ORT session). The instant
  // speech pauses it fires a transcription that overlaps the endpoint-silence wait, so the final
  // transcript is usually ready the moment the turn ends. Falls back (returns null) on any problem.
  function downsampleTo16k(buf, srcRate) {
    if (!srcRate || Math.abs(srcRate - 16000) < 1) return buf;
    var ratio = srcRate / 16000, outLen = Math.floor(buf.length / ratio), out = new Float32Array(outLen);
    for (var i = 0; i < outLen; i++) { var s = Math.floor(i * ratio), e = Math.floor((i + 1) * ratio), sum = 0, c = 0; for (var j = s; j < e && j < buf.length; j++) { sum += buf[j]; c++; } out[i] = c ? sum / c : 0; }
    return out;
  }
  function concatF32(chunks) { var n = 0, i; for (i = 0; i < chunks.length; i++) n += chunks[i].length; var out = new Float32Array(n), off = 0; for (i = 0; i < chunks.length; i++) { out.set(chunks[i], off); off += chunks[i].length; } return out; }
  function streamTurn(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!STATE.asr || !MIC || !MIC.ac) { resolve(null); return; }     // streaming needs serverless ASR + the live mic
      var ctx = MIC.ac, srcRate = ctx.sampleRate, src, proc, zero;
      try {
        src = ctx.createMediaStreamSource(MIC.stream);
        proc = (ctx.createScriptProcessor || ctx.createJavaScriptNode).call(ctx, 4096, 1, 1);
        zero = ctx.createGain(); zero.gain.value = 0;                    // silent sink so the tap runs without feedback
      } catch (e) { resolve(null); return; }
      var chunks = opts.seed ? [opts.seed] : [], partialBusy = false, lastPartial = "", lastPartialLen = 0, pending = Promise.resolve();
      var silenceMs = opts.silenceMs || CFG.turnSilenceMs || 250, maxMs = opts.maxMs || 14000, onsetGraceMs = opts.onsetGraceMs || 8000;
      proc.onaudioprocess = function (e) {
        try { chunks.push(downsampleTo16k(new Float32Array(e.inputBuffer.getChannelData(0)), srcRate)); var ob = e.outputBuffer.getChannelData(0); for (var i = 0; i < ob.length; i++) ob[i] = 0; } catch (er) {}
      };
      try { src.connect(proc); proc.connect(zero); zero.connect(ctx.destination); } catch (e) { resolve(null); return; }
      function bufLen() { var n = 0; for (var i = 0; i < chunks.length; i++) n += chunks[i].length; return n; }
      function runPartial() {
        if (partialBusy || bufLen() < 16000 * 0.4) return;               // need ≥0.4s; never overlap (one ORT session)
        partialBusy = true; var snap = concatF32(chunks), snapLen = snap.length;
        pending = STATE.asr.transcribe(snap, { language: CFG.lang }).then(function (d) { lastPartial = (d && d.text || "").trim(); lastPartialLen = snapLen; }, function () {}).then(function () { partialBusy = false; });
      }
      var started = Date.now(), lastLoud = Date.now(), spoke = !!opts.seed, wasLoud = false, done = false;
      var iv = setInterval(runPartial, CFG.streamPartialMs || 550);
      async function finish() {
        if (done) return; done = true; clearInterval(iv);
        try { proc.onaudioprocess = null; src.disconnect(); proc.disconnect(); zero.disconnect(); } catch (e) {}
        if (!spoke) { resolve(null); return; }
        try { await pending; } catch (e) {}
        if (bufLen() > lastPartialLen + 16000 * 0.25) { runPartial(); try { await pending; } catch (e) {} }   // tail not covered → one final pass
        resolve((lastPartial || "").trim());
      }
      (function tick() {
        if (done) return;
        if (!STATE.liveOn || !MIC) { finish(); return; }
        var lvl = MIC.level, now = Date.now(), loud = lvl > 0.025;
        if (loud) { spoke = true; lastLoud = now; }
        else if (wasLoud && spoke && !partialBusy) runPartial();         // speech just paused → transcribe NOW (overlaps the silence wait)
        wasLoud = loud;
        var quietFor = now - lastLoud, elapsed = now - started;
        if ((spoke && quietFor > silenceMs) || elapsed > maxMs || (!spoke && elapsed > onsetGraceMs)) { finish(); return; }
        requestAnimationFrame(tick);
      })();
    });
  }

  // ── duplex conversation mic: one persistent stream for the whole live session ─────────────────────
  // Held open so we can (a) endpoint utterances fast and (b) hear the user the instant they cut in while
  // Q is talking (barge-in) — the thing that makes it feel like a real conversation, not walkie-talkie.
  // echoCancellation keeps Q's own voice (through the speakers) from self-triggering the interrupt.
  var MIC = null;
  function micOpen() {
    if (MIC) return Promise.resolve(MIC);
    return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (stream) {
      var AC = W.AudioContext || W.webkitAudioContext, ac = new AC();
      var src = ac.createMediaStreamSource(stream), an = ac.createAnalyser(); an.fftSize = 1024; src.connect(an);
      MIC = { stream: stream, ac: ac, an: an, buf: new Uint8Array(an.fftSize), level: 0, raf: 0 };
      (function tick() {
        if (!MIC) return;
        MIC.an.getByteTimeDomainData(MIC.buf); var s = 0; for (var i = 0; i < MIC.buf.length; i++) { var v = (MIC.buf[i] - 128) / 128; s += v * v; }
        MIC.level = Math.sqrt(s / MIC.buf.length);
        if (STATE.live === "listening" || STATE.live === "speaking") STATE.micLevel = MIC.level;
        MIC.raf = requestAnimationFrame(tick);
      })();
      return MIC;
    });
  }
  function micClose() { if (!MIC) return; try { cancelAnimationFrame(MIC.raf); } catch (e) {} try { MIC.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} try { MIC.ac.close(); } catch (e) {} MIC = null; STATE.micLevel = 0; }
  // record one utterance off the persistent mic, ending on a short trailing silence (snappy turn-taking).
  // preSpoke=true when we already detected onset (a barge-in) so we don't wait for the user to "start".
  function micCapture(o) {
    o = o || {}; var silenceMs = o.silenceMs || CFG.silenceMs || 550, maxMs = o.maxMs || 12000, onsetGraceMs = o.onsetGraceMs || 8000;
    return new Promise(function (resolve) {
      if (!MIC) { resolve(null); return; }
      var rec, chunks = [], started = Date.now(), lastLoud = Date.now(), spoke = !!o.preSpoke, done = false, raf;
      function finish() { if (done) return; done = true; try { cancelAnimationFrame(raf); } catch (e) {} try { rec && rec.state !== "inactive" && rec.stop(); } catch (e) {} }
      function tick() {
        if (done || !MIC || !STATE.liveOn) { finish(); return; }
        var level = MIC.level, now = Date.now();
        if (level > 0.025) { spoke = true; lastLoud = now; }
        var quietFor = now - lastLoud, elapsed = now - started;
        if ((spoke && quietFor > silenceMs) || elapsed > maxMs || (!spoke && elapsed > onsetGraceMs)) { finish(); return; }
        raf = requestAnimationFrame(tick);
      }
      try { rec = new MediaRecorder(MIC.stream); } catch (e) { resolve(null); return; }
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () { if (!spoke || !chunks.length) { resolve(null); return; } var blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" }); decodeTo16k(blob).then(resolve).catch(function () { resolve(null); }); };
      rec.start(); raf = requestAnimationFrame(tick);
    });
  }
  // transcribe captured PCM (governed QVAC seam first, on-device provider as the serverless fallback).
  async function transcribeAudio(audio) {
    if (!audio) return "";
    hud("thinking", "recognizing…");
    var prompt = personalPrompt();                                     // bias decoding toward your words (best-effort)
    function finish(text) { text = applyCorrections((text || "").trim()); if (text) learnFromTranscript(text); return text; }   // fix your mishearings + learn
    try {
      if (W.HoloQVAC && typeof W.HoloQVAC.transcribe === "function") {
        var r = await W.HoloQVAC.transcribe({ audio: audio, language: CFG.lang, prompt: prompt });
        if (r && r.provisioned !== false && r.text != null) return finish(r.text);
      }
      var d = await STATE.asr.transcribe(audio, { language: CFG.lang, prompt: prompt }); return finish(d && d.text);
    } catch (e) {
      try { var d2 = await STATE.asr.transcribe(audio, { language: CFG.lang }); return finish(d2 && d2.text); }
      catch (e2) { console.warn("[HoloVoice] transcribe failed:", e2 && e2.message || e2); return ""; }
    }
  }
  // speak `activity` (a promise that resolves when Q stops talking) while watching the mic for the user
  // cutting in. Resolves "barge" the moment they do (and silences Q + aborts the reply via ctl), else
  // "done". The interrupt floor rises with Q's own loudness (ttsLevel) so the speakers don't self-trigger.
  function speakListening(activity, ctl) {
    if (!MIC || !STATE.liveOn) return Promise.resolve(activity).then(function () { return "done"; });
    var bargedResolve, barged = new Promise(function (r) { bargedResolve = r; }), stop = false, hits = 0, raf;
    (function tick() {
      if (stop || !MIC || !STATE.liveOn) return;
      // floor is mostly fixed (so a clean, echo-cancelled mic still hears you over Q) with a small lift
      // by Q's own loudness to absorb residual echo when AEC is weak. Tunable via HOLO_VOICE_CONFIG.
      var floor = CFG.bargeFloor + STATE.ttsLevel * CFG.bargeEcho;
      if (MIC.level > floor) hits++; else hits = Math.max(0, hits - 2);
      if (hits >= CFG.bargeFrames) { bargedResolve("barge"); return; }   // sustained speech over the floor
      raf = requestAnimationFrame(tick);
    })();
    return Promise.race([Promise.resolve(activity).then(function () { return "done"; }), barged]).then(function (who) {
      stop = true; try { cancelAnimationFrame(raf); } catch (e) {}
      if (who === "barge") { if (ctl) ctl.aborted = true; stopSpeaking(); }
      return who;
    });
  }

  // ── semantic turn-taking: decide if the user is actually DONE, not just pausing ───────────────────
  // The 550ms fixed silence is the biggest fixed cost in a turn (deep-research RANK 1). We drop the
  // candidate silence to ~300ms and add a turn-completion VETO: if the transcript ends mid-thought
  // (a trailing connective/filler, or the model says "not done"), we keep listening instead of
  // clipping — so the snappier endpoint never cuts the user off. Heuristic ships now; the LiveKit
  // turn-detector (voice/holo-voice-turn.mjs, ONNX, ~25ms) drops in as the high-accuracy scorer.
  var CONT = { and: 1, but: 1, so: 1, or: 1, because: 1, "if": 1, the: 1, a: 1, an: 1, to: 1, my: 1, your: 1, our: 1, i: 1, we: 1, you: 1, he: 1, she: 1, they: 1, it: 1, for: 1, with: 1, of: 1, "in": 1, on: 1, at: 1, is: 1, are: 1, was: 1, were: 1, um: 1, uh: 1, er: 1, like: 1, that: 1, this: 1, these: 1, those: 1, can: 1, could: 1, would: 1, should: 1, will: 1, "let": 1, please: 1, "and's": 0 };
  function heuristicComplete(text) {
    var raw = String(text || "").trim(); if (!raw) return true;
    if (/[.?!…]$/.test(raw)) return true;                                // ended on sentence punctuation → done
    var t = norm(raw), words = t.split(" "), last = words[words.length - 1];
    if (CONT[last]) return false;                                        // trailing connective/filler → still going
    if (words.length <= 2) return true;                                  // short command-ish utterance → done
    return true;                                                         // default: don't over-wait
  }
  // optional ONNX scorer (LiveKit turn-detector) — lazy, gated by CFG.turnModel, never breaks the path.
  var _turnEng = null, _turnTried = false, _turnLoading = null;
  function ensureTurnModel() {
    if (_turnEng) return Promise.resolve(_turnEng);
    if (_turnTried && !_turnLoading) return Promise.resolve(null);
    if (!_turnLoading) {
      _turnTried = true;
      _turnLoading = import(BASE + "voice/holo-voice-turn.mjs")
        .then(function (m) { var e = (m.createTurnDetector || m.default)({}); return e.load().then(function () { _turnEng = e; return e; }); })
        .catch(function (e) { console.warn("[HoloVoice] turn-detector model unavailable (vendor it: tools/vendor-voice-model.mjs --turn) — using heuristic:", e && e.message || e); return null; })
        .finally(function () { _turnLoading = null; });
    }
    return _turnLoading;
  }
  async function turnComplete(text) {
    if (!CFG.turnDetect) return true;                                   // adaptive endpoint off → behave as before
    if (CFG.turnModel) {
      try { var e = await ensureTurnModel(); if (e) { var p = await e.predict(text); if (typeof p === "number") return p >= CFG.turnThreshold; } } catch (e2) {}
    }
    return heuristicComplete(text);
  }
  // capture one full conversational TURN: short-silence segments, transcribed and stitched, ending only
  // when the turn reads as complete (or the user goes quiet on a continuation). `seed` is barge-in audio.
  async function captureTurn(seed) {
    var streaming = CFG.stream !== false && !!STATE.asr && !!MIC;       // recognize WHILE you talk (falls back if it can't)
    function corr(seg) { seg = applyCorrections((seg || "").trim()); if (seg) learnFromTranscript(seg); return seg; }   // streamTurn returns raw
    if (!CFG.turnDetect) {                                               // simple path: one endpoint, no veto
      if (streaming) { var sx = await streamTurn({ seed: seed }); if (sx != null) { turnStart(); tmark("transcript"); return corr(sx); } }
      var a0 = seed || await micCapture({}); if (!STATE.liveOn || !a0) return "";
      turnStart(); var t0 = a0._text != null ? a0._text : await transcribeAudio(a0); tmark("transcript"); return t0;
    }
    var full = "", first = true, segs = 0;
    while (STATE.liveOn && segs < 6) {
      var seg;
      if (streaming) {
        var sres = await streamTurn({ seed: first ? seed : null, silenceMs: CFG.turnSilenceMs, onsetGraceMs: first ? 8000 : CFG.turnContinueMs });
        first = false; segs++;
        if (!STATE.liveOn) break;
        if (sres == null) { if (full) break; streaming = false; continue; }   // streaming hiccup → fall back to micCapture
        if (segs === 1) turnStart();                                    // t0 ≈ end-of-speech (ASR already overlapped it)
        seg = corr(sres);
      } else {
        var audio = first && seed ? seed : await micCapture(first ? { silenceMs: CFG.turnSilenceMs } : { silenceMs: CFG.turnSilenceMs, onsetGraceMs: CFG.turnContinueMs });
        first = false; segs++;
        if (!STATE.liveOn) break;
        if (!audio) break;                                              // continuation silence → done with what we have
        if (segs === 1) turnStart();
        seg = audio._text != null ? audio._text : await transcribeAudio(audio);   // transcribeAudio applies corrections + learns
      }
      if (seg) full = (full ? full + " " : "") + seg;
      tmark("transcript");
      if (!full) break;
      if (await turnComplete(full)) break;                              // semantically done → respond
      maybeBackchannel();                                               // mid-thought pause → a soft "mm-hmm" (you feel heard)
      setLive("listening");                                             // keep the floor
    }
    return full.trim();
  }

  // ── bring-up capture: browser SpeechRecognition (live mic, returns text) ─────────────────────────
  function listenWebSpeech() {
    return new Promise(function (resolve, reject) {
      var SR = W.SpeechRecognition || W.webkitSpeechRecognition; if (!SR) return reject(new Error("no SpeechRecognition"));
      var r = new SR(); r.lang = CFG.lang || navigator.language || "en-US"; r.interimResults = true; r.maxAlternatives = 1; r.continuous = false;
      var finalText = "";
      r.onresult = function (e) { var t = ""; for (var i = e.resultIndex; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) finalText += e.results[i][0].transcript; } hud("listening", t || "listening…"); };
      r.onerror = function (e) { reject(new Error(e.error || "speech error")); };
      r.onend = function () { resolve((finalText || STATE._interim || "").trim()); };
      hud("listening", "listening…"); try { r.start(); } catch (e) { reject(e); }
    });
  }

  async function recognize() {
    var mode = await ensureMode();
    if (mode === "serverless") {
      var audio = await captureUtterance({});
      if (!audio) return "";
      hud("thinking", "recognizing…");
      try {
        // Prefer the governed QVAC seam (conscience gate + sealed receipt). When the full SDK isn't
        // loaded the gate fails closed, so fall back to the on-device provider directly — still 100%
        // serverless, just without the receipt until the SDK is present.
        if (W.HoloQVAC && typeof W.HoloQVAC.transcribe === "function") {
          var r = await W.HoloQVAC.transcribe({ audio: audio, language: CFG.lang });
          if (r && r.provisioned !== false && r.text != null) return (r.text || "").trim();
        }
        var d = await STATE.asr.transcribe(audio, { language: CFG.lang });
        return (d && d.text || "").trim();
      } catch (e) {
        try { var d2 = await STATE.asr.transcribe(audio, { language: CFG.lang }); return (d2 && d2.text || "").trim(); }
        catch (e2) { console.warn("[HoloVoice] transcribe failed:", e2 && e2.message || e2); return ""; }
      }
    }
    if (mode === "webspeech") return await listenWebSpeech();
    throw new Error("no recognizer available");
  }

  // ── intent router: text → a real OS action ──────────────────────────────────────────────────────
  function norm(s) { return String(s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim(); }
  function appList() { try { return Object.values((W.HoloDock && W.HoloDock.catalog && W.HoloDock.catalog()) || {}); } catch (e) { return []; } }
  // search via the native HoloFind API if it's loaded, else navigate to the OS find page (find.html).
  function doFind(q) {
    q = String(q || "").trim(); if (!q) return;
    if (W.HoloFind && W.HoloFind.find) { try { W.HoloFind.find(q); return; } catch (e) {} }
    try { location.href = "find.html?q=" + encodeURIComponent(q); } catch (e) {}
  }
  function toUrl(s) { s = String(s || "").trim().replace(/\s+/g, ""); return /^(https?:\/\/|holo:\/\/)/i.test(s) ? s : "https://" + s; }
  // run an in-app command; if it's a navigate and no browser is open yet, open Holo Browser then retry.
  async function runAppCmd(name, params) {
    try { return await callApp(name, params, { timeout: 2500 }); }
    catch (e) {
      if (name === "navigate") {
        var b = matchApp("browser");
        if (b && W.HoloDock && W.HoloDock.launch) { W.HoloDock.launch(b.id); await new Promise(function (r) { setTimeout(r, 1500); }); try { return await callApp(name, params, { timeout: 3000 }); } catch (e2) {} }
      }
      return null;
    }
  }
  // ── in-app task bridge: drive the OPEN app, not just open it ───────────────────────────────────────
  // The app opts in via HoloSDK.registerCommand(name, fn) (holo-sdk.js). We BROADCAST the command to
  // every app frame and resolve on the first that handles it (frame-agnostic — apps launch into a tab,
  // an iframe, or the SDK world). `__commands` discovers what the open app exposes.
  var _callSeq = 0;
  function appFrames() {
    try { return Array.prototype.slice.call(DOC.querySelectorAll("iframe")).map(function (f) { try { return f.contentWindow; } catch (e) { return null; } }).filter(Boolean); }
    catch (e) { return []; }
  }
  function callApp(name, params, opts) {
    opts = opts || {}; var frames = appFrames();
    if (!frames.length) return Promise.reject(new Error("no app is open"));
    var id = "qv" + (++_callSeq), timeout = opts.timeout || 3000;
    return new Promise(function (resolve, reject) {
      var done = false;
      function onMsg(e) { var d = e.data; if (!d || d.type !== "holo-app:command-result" || d.id !== id || done) return; if (d.error) return; done = true; cleanup(); resolve(d.result); }   // ignore non-handlers' errors
      function cleanup() { try { W.removeEventListener("message", onMsg); } catch (e) {} clearTimeout(tm); }
      var tm = setTimeout(function () { if (done) return; done = true; cleanup(); reject(new Error("the app didn't handle “" + name + "”")); }, timeout);
      W.addEventListener("message", onMsg);
      frames.forEach(function (fw) { try { fw.postMessage({ type: "holo-app:command", id: id, name: name, params: params || {} }, "*"); } catch (e) {} });
    });
  }
  // list the commands the currently-open app exposes (union across frames). [] if none/no app.
  function appCommands(opts) {
    opts = opts || {}; var frames = appFrames(); if (!frames.length) return Promise.resolve([]);
    var id = "qc" + (++_callSeq), names = {};
    return new Promise(function (resolve) {
      function onMsg(e) { var d = e.data; if (!d || d.type !== "holo-app:command-result" || d.id !== id) return; if (Array.isArray(d.result)) d.result.forEach(function (n) { names[n] = 1; }); }
      W.addEventListener("message", onMsg);
      frames.forEach(function (fw) { try { fw.postMessage({ type: "holo-app:command", id: id, name: "__commands", params: {} }, "*"); } catch (e) {} });
      setTimeout(function () { try { W.removeEventListener("message", onMsg); } catch (e) {} resolve(Object.keys(names)); }, opts.timeout || 400);
    });
  }
  // try to drive the OPEN app from a free-form utterance: discover its commands, match the leading verb,
  // and invoke it. Returns a spoken result string if handled, else null (→ caller falls back to chat).
  var _appCmds = null, _appCmdsN = -1;
  async function tryAppCommand(text) {
    try {
      var frames = appFrames(); if (!frames.length) { _appCmds = null; _appCmdsN = -1; return null; }   // nothing open to drive
      if (_appCmds === null || _appCmdsN !== frames.length) { _appCmds = await appCommands({ timeout: 350 }); _appCmdsN = frames.length; }   // discover once per app change, then cache
      var cmds = _appCmds; if (!cmds.length) return null;
      var t = norm(text), name = null;
      cmds.forEach(function (c) { var cn = norm(c); if (!name && (t === cn || t.indexOf(cn + " ") === 0 || new RegExp("\\b" + cn.replace(/\s+/g, "\\s+") + "\\b").test(t))) name = c; });
      if (!name) return null;
      var rest = t.replace(new RegExp("\\b" + norm(name).replace(/\s+/g, "\\s+") + "\\b"), "").trim();
      var r = await callApp(name, { text: text, query: rest }, { timeout: 2500 });
      return (r && (r.say || r.message)) || "Done.";
    } catch (e) { return null; }
  }
  // ── personalization: Q learns YOUR voice the more you use it (on-device, persisted) ────────────────
  // Acoustic fine-tuning isn't possible in-browser, but three on-device signals make recognition better
  // with use: (1) a LEARNED CORRECTION map — systematic mishearings of your words / app names get fixed
  // post-ASR; (2) USAGE WEIGHTING — the apps you use most win ambiguous matches; (3) a VOCAB bias prompt
  // — your frequent words bias Whisper's decoding (best-effort). Stored in localStorage so it carries
  // across sessions. 100% on-device — your voice profile never leaves the machine.
  var PROFILE = { vocab: {}, corrections: {}, usage: {}, seen: {}, turns: 0 };
  try { var _pf = JSON.parse(localStorage.getItem("holo.voice.profile") || "null"); if (_pf && typeof _pf === "object") PROFILE = Object.assign(PROFILE, _pf); } catch (e) {}
  var _saveT = 0;
  function saveProfile() { clearTimeout(_saveT); _saveT = setTimeout(function () { try { localStorage.setItem("holo.voice.profile", JSON.stringify(PROFILE)); } catch (e) {} }, 500); }
  var STOPW = { the: 1, a: 1, an: 1, to: 1, of: 1, and: 1, or: 1, is: 1, it: 1, i: 1, you: 1, me: 1, my: 1, please: 1, can: 1, do: 1, for: 1, on: 1, in: 1, at: 1, go: 1, open: 1, show: 1, set: 1, what: 1, how: 1, then: 1, that: 1, this: 1 };
  // apply learned + user-taught corrections to a transcript (longest phrase first, word-boundary).
  function applyCorrections(text) {
    var out = " " + String(text || "") + " ", keys = Object.keys(PROFILE.corrections).sort(function (a, b) { return b.length - a.length; });
    keys.forEach(function (k) { try { out = out.replace(new RegExp("\\b" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), " " + PROFILE.corrections[k] + " "); } catch (e) {} });
    return out.replace(/\s+/g, " ").trim();
  }
  function learnFromTranscript(text) {
    PROFILE.turns++;
    norm(text).split(" ").forEach(function (w) { if (w.length >= 3 && !STOPW[w]) PROFILE.vocab[w] = (PROFILE.vocab[w] || 0) + 1; });
    var ks = Object.keys(PROFILE.vocab); if (ks.length > 400) ks.sort(function (a, b) { return PROFILE.vocab[b] - PROFILE.vocab[a]; }).slice(300).forEach(function (k) { delete PROFILE.vocab[k]; });
    saveProfile();
  }
  // learn that a heard phrase resolved to a canonical app/command → fix it next time. Conservative: only
  // short address-like phrases, and only after it recurs (so a one-off mishear can't poison recognition).
  function learnMatch(heard, canonical) {
    heard = norm(heard); canonical = norm(canonical);
    if (!heard || !canonical || heard === canonical || STOPW[heard]) return;
    if (heard.split(" ").length <= 4 && heard.length <= 40) { PROFILE.seen[heard] = (PROFILE.seen[heard] || 0) + 1; if (PROFILE.seen[heard] >= 2) PROFILE.corrections[heard] = canonical; saveProfile(); }
  }
  function bumpUsage(key) { if (!key) return; PROFILE.usage[key] = (PROFILE.usage[key] || 0) + 1; saveProfile(); }
  function usageBoost(id) { return Math.min(8, PROFILE.usage[id] || 0); }                  // small — only tips ambiguous matches
  // a biasing prompt for Whisper (best-effort): your app names + most-used words.
  function personalPrompt() {
    var apps = appList().map(function (a) { return a.name; }).filter(Boolean);
    var top = Object.keys(PROFILE.vocab).sort(function (a, b) { return PROFILE.vocab[b] - PROFILE.vocab[a]; }).slice(0, 24);
    var p = apps.concat(top).join(", "); return p ? p.slice(0, 200) : "";
  }
  function teach(misheard, correct) { misheard = norm(misheard); if (!misheard || !correct) return false; PROFILE.corrections[misheard] = String(correct).trim().toLowerCase(); saveProfile(); return true; }

  function matchApp(q) {
    q = norm(applyCorrections(q)).replace(/^(the|a|an|my)\s+/, ""); if (!q) return null;   // correct + drop article
    var apps = appList(), best = null, bestScore = 0;
    apps.forEach(function (a) {
      var name = norm(a.name), id = norm(a.id), tail = norm((a.id || "").split(/[./]/).pop()), score = 0;
      if (name === q || id === q || tail === q) score = 100;
      else if (name.indexOf(q) === 0 || q.indexOf(name) === 0) score = 80;
      else if (name.indexOf(q) >= 0 || q.indexOf(name) >= 0 || (tail && tail.indexOf(q) >= 0)) score = 60;
      else { var qt = q.split(" "), nt = name.split(" "), hit = qt.filter(function (t) { return t.length > 2 && nt.indexOf(t) >= 0; }).length; if (hit) score = 30 + hit * 10; }
      if (score > 0) score += usageBoost(a.id);                        // your most-used apps win ties
      if (score > bestScore) { bestScore = score; best = a; }
    });
    return bestScore >= 30 ? best : null;
  }
  // a segment "looks like" an OS command (a known verb, or the name of an installed app) — used to
  // decide whether to split a compound utterance ("open browser and switch to dark mode").
  function isCmd(p) {
    return /^(open|launch|start|run|go to|show|close|hide|exit|quit|go back|switch to|set|find|search|dark|light|home|desktop)\b/.test(p) || matchApp(p) != null;
  }
  // "yes, do it" / "no, leave it" — used to approve or cancel a PROPOSED action (the confirm flow).
  var AFFIRM = /^(yes|yeah|yep|yup|sure|okay|ok|please|go ahead|do it|go for it|confirm|confirmed|absolutely|definitely|of course|sounds good|alright|right|yes please|please do|that works)\b/;
  var NEGATE = /^(no|nope|nah|cancel|never ?mind|stop|leave it|forget it|not now|skip it|dont|don)\b/;
  function isAffirm(t) { return AFFIRM.test(norm(t)); }
  function isNegate(t) { return NEGATE.test(norm(t)); }
  // route(text, dry) → a PLAN. dry=true classifies WITHOUT acting (the confirm flow proposes it first);
  // dry=false runs it now (the explicit push-to-talk / wake path). An action plan carries an exec() thunk
  // + a spoken `propose`. Unmatched → { converse } so casual speech is a conversation, never a command.
  function route(text, dry) {
    var raw = String(text || "").trim();
    var nav = raw.match(/\b(?:go to|navigate to|visit|browse to|take me to|open|pull up)\s+(https?:\/\/\S+|holo:\/\/\S+|[^\s,]+\.[^\s,]{2,}\S*)\s*$/i);
    if (nav) { var url = toUrl(nav[1]), disp = nav[1].replace(/^https?:\/\//i, ""); var np = { appCmd: "navigate", params: { url: url }, ok: true, action: "navigate", say: "Going to " + disp + ".", propose: "Open " + disp + " in the browser?", exec: function () { runAppCmd("navigate", { url: url }); } }; if (!dry) try { np.exec(); } catch (e) {} return np; }
    var t = norm(text); if (!t) return { ok: false, say: "I didn't catch that." };
    if (WAKE.strip) t = t.replace(WAKE.strip, "").trim();   // peel off "hey Q," etc. if present
    // COMPOUND: a chain of commands in one breath — only when EVERY part is a command ("open atlas and go dark").
    var segs = t.split(/\s+(?:and then|and|then)\s+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (segs.length > 1 && segs.every(isCmd)) {
      var rs = segs.map(function (s) { return routeOne(s, true); }), oks = rs.filter(function (r) { return r && r.ok && r.exec; });
      if (oks.length) {
        var combined = { ok: true, action: rs.map(function (r) { return (r && r.action) || "-"; }).join("+"), say: oks.map(function (r) { return r.say; }).join(" "),
          propose: "Want me to " + oks.map(function (r) { return r.say.replace(/\.$/, "").toLowerCase(); }).join(", then ") + "?",
          exec: function () { oks.forEach(function (r) { try { r.exec(); } catch (e) {} }); } };
        if (!dry) try { combined.exec(); } catch (e) {} return combined;
      }
    }
    return routeOne(t, dry);
  }
  // one command → a PLAN with a deferred native call. Executes inline only when !dry (backward compat).
  function routeOne(t, dry) {
    var m, plan = null;
    if (/^(show |go to |open )?(the )?desktop$/.test(t) || t === "show desktop" || t === "home") {
      if (W.HoloDock && W.HoloDock.revealDesktop) plan = { ok: true, action: "desktop", say: "Showing the desktop.", propose: "Show the desktop?", exec: function () { W.HoloDock.revealDesktop(); } };
    } else if ((m = t.match(/^(?:switch to |set |go |make it )?(dark|light)(?: mode| theme| appearance)?$/)) && W.HoloTheme && W.HoloTheme.setPalette) {
      var mode = m[1]; plan = { ok: true, action: "theme:" + mode, say: mode + " mode.", propose: "Switch to " + mode + " mode?", exec: function () { W.HoloTheme.setPalette(mode); } };
    } else if ((m = t.match(/^(?:find|search|look up|google)(?: for)?\s+(.+)$/))) {
      var q = m[1]; plan = { ok: true, action: "find", say: "Searching for " + q + ".", propose: "Want me to search for " + q + "?", exec: function () { doFind(q); } };
    } else if (/^(close|hide|exit|quit|go back)\b/.test(t) && W.HoloDock && W.HoloDock.revealDesktop) {
      plan = { ok: true, action: "close", say: "Closed.", propose: "Close this?", exec: function () { W.HoloDock.revealDesktop(); } };
    } else if ((m = t.match(/^(?:open|launch|start|run|go to|switch to)\s+(.+)$/))) {
      var app = matchApp(m[1]), phrase = m[1];
      if (app && W.HoloDock && W.HoloDock.launch) plan = { ok: true, action: "launch:" + app.id, say: "Opening " + app.name + ".", propose: "Want me to open " + app.name + "?", exec: function () { W.HoloDock.launch(app.id); learnMatch(phrase, app.name); bumpUsage(app.id); } };
      else return { ok: false, say: "I couldn't find an app called " + m[1] + "." };
    } else {
      // a BARE app name ("calculator") — but only for a SHORT utterance, so a sentence isn't hijacked.
      var bare = (t.split(" ").length <= 3) ? matchApp(t) : null;
      if (bare && W.HoloDock && W.HoloDock.launch) plan = { ok: true, action: "launch:" + bare.id, say: "Opening " + bare.name + ".", propose: "Want me to open " + bare.name + "?", exec: function () { W.HoloDock.launch(bare.id); learnMatch(t, bare.name); bumpUsage(bare.id); } };
    }
    if (!plan) return { converse: true, text: t };
    if (!dry && plan.exec) try { plan.exec(); } catch (e) {}
    return plan;
  }

  // ── Phase 2: talk to the holo native agent — completion (on-device) + OS tools, spoken reply ──────
  var _qvacReady = null;
  function ensureQVAC() {
    if (W.HoloQVAC) return Promise.resolve(W.HoloQVAC);
    if (!_qvacReady) _qvacReady = import(BASE + "holo-qvac.js").then(function () { return W.HoloQVAC; }).catch(function () { return null; });
    return _qvacReady;
  }
  // lazy-load the on-device LLM (the brain), bind it into the governed QVAC seam, and keep a direct
  // handle for when the SDK/conscience isn't loaded. First call downloads-from-disk + compiles (~once).
  var _brain = null, _brainTried = false, _brainLoading = null;
  function ensureBrain() {
    if (_brain) return Promise.resolve(_brain);
    if (_brainTried && !_brainLoading) return Promise.resolve(null);
    if (!_brainLoading) {
      _brainTried = true;
      _brainLoading = (async function () {
        try {
          var m = await import(BASE + "voice/holo-voice-llm.mjs");
          var engine = (m.createLLM || m.default)({ preferWebGPU: CFG.preferWebGPU });
          hud("loading", "loading agent model… (first time, ~once)");
          await engine.load(function (p) { hud("loading", "loading agent · " + (p.file || "")); });
          _brain = { engine };
          bindMind(engine);                                            // give the OS orchestrator Q's mind (sampler)
          var Q = await ensureQVAC();
          if (Q && Q.useBrain) { try { Q.useBrain({ id: "holo-voice-llm", generate: function (h, p) { return engine.generate(h, p); } }); } catch (e) {} }
          return _brain;
        } catch (e) { console.warn("[HoloVoice] agent LLM unavailable (run tools/vendor-voice-model.mjs to enable chat):", e && e.message || e); return null; }
        finally { _brainLoading = null; }
      })();
    }
    return _brainLoading;
  }
  // drop the loaded brain so the next ensureBrain() rebuilds with the current CFG (e.g. after a tier switch).
  function resetBrain() { _brain = null; _brainTried = false; _brainLoading = null; try { var Q = W.HoloQVAC; if (Q && Q.useBrain) Q.useBrain(null); } catch (e) {} }

  // setEngine(useGpu) — persist the brain tier (WebGPU 1.5B vs WASM 0.5B) and rebuild on next turn.
  function setEngine(useGpu) {
    CFG.preferWebGPU = !!useGpu;
    try { localStorage.setItem("holo.voice.webgpu", useGpu ? "1" : "0"); } catch (e) {}
    resetBrain();
    return CFG.preferWebGPU;
  }

  // testWebGPU() — REAL-HARDWARE self-check. Enables WebGPU, loads the 1.5B, asks a known-answer question,
  // and verifies the reply is coherent (contains "tokyo"). Garbage output doesn't throw, so this is the
  // only safe way to confirm WebGPU works on THIS device — on failure it auto-reverts to the WASM floor.
  var GARBAGE = /[　-鿿가-힯]/;                         // CJK/Hangul leaking into English = broken EP
  async function testWebGPU() {
    if (!(navigator.gpu)) { speakToast("This browser has no WebGPU."); return { ok: false, reason: "no-webgpu" }; }
    hud("loading", "testing WebGPU on this device…");
    setEngine(true);
    var brain = await ensureBrain();
    if (!brain || !brain.engine || brain.engine.info().device !== "webgpu") { setEngine(false); hud("error", "WebGPU didn't engage — reverted to WASM."); return { ok: false, reason: "no-webgpu-pipeline" }; }
    var reply = "";
    try { reply = await brain.engine.chat([{ role: "user", content: "What is the capital of Japan? Answer in one short sentence." }], { maxTokens: 24 }); } catch (e) { reply = ""; }
    var good = /tokyo/i.test(reply) && !GARBAGE.test(reply);
    if (good) { hud("done", "WebGPU verified ✓ (1.5B). " + reply); speakToast("WebGPU verified. Using the larger model."); return { ok: true, device: "webgpu", reply: reply }; }
    setEngine(false); await ensureBrain();
    hud("error", "WebGPU produced bad output — reverted to WASM.");
    speakToast("WebGPU failed the check. Staying on the safe model.");
    return { ok: false, reason: "garbage", reply: reply };
  }
  function speakToast(t) { if (W.HoloShareChrome && W.HoloShareChrome.toast) { try { W.HoloShareChrome.toast(t); } catch (e) {} } }
  // OS actions exposed to the agent as callable tools. Built FRESH each turn so open_app advertises the
  // LIVE app catalog — the agent's tool surface is the whole OS, not a fixed list (a bound LLM emits these
  // tool calls; the deterministic router covers the same ground when the small model doesn't).
  function buildTools() {
    var apps = appList().map(function (a) { return a.name; }).filter(Boolean);
    var hint = apps.length ? " Installed apps: " + apps.slice(0, 40).join(", ") + "." : "";
    return [
      { type: "function", function: { name: "open_app", description: "Open/launch an app by name." + hint, parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
      { type: "function", function: { name: "show_desktop", description: "Show the desktop / close the current app", parameters: { type: "object", properties: {} } } },
      { type: "function", function: { name: "search_web", description: "Search the web/OS for a query", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
      { type: "function", function: { name: "set_theme", description: "Switch appearance light or dark", parameters: { type: "object", properties: { mode: { type: "string", enum: ["light", "dark"] } }, required: ["mode"] } } },
      { type: "function", function: { name: "set_accent", description: "Set the UI accent colour (hex like #5b8cff or a colour name)", parameters: { type: "object", properties: { color: { type: "string" } }, required: ["color"] } } },
      { type: "function", function: { name: "list_apps", description: "List the apps available to open", parameters: { type: "object", properties: {} } } },
      { type: "function", function: { name: "app_command", description: "Run an action INSIDE the currently open app (e.g. play, pause, next, navigate). The open app decides what it supports.", parameters: { type: "object", properties: { command: { type: "string" }, params: { type: "object" } }, required: ["command"] } } },
    ];
  }
  // execute a tool call by calling NATIVE holo code directly (HoloDock / HoloTheme / HoloFind).
  function execTool(tc) {
    var name = tc.name || (tc.function && tc.function.name);
    var args = tc.args || tc.arguments || (tc.function && tc.function.arguments) || {};
    if (typeof args === "string") { try { args = JSON.parse(args); } catch (e) { args = {}; } }
    switch (name) {
      case "open_app": case "launch_app": {
        var app = matchApp(args.name || args.app || args.query || "");
        if (app && W.HoloDock && W.HoloDock.launch) { W.HoloDock.launch(app.id); return { ok: true, action: "launch:" + app.id, say: "Opening " + app.name + "." }; }
        return { ok: false, say: "I couldn't find an app called " + (args.name || args.app || "") + "." };
      }
      case "show_desktop": case "close_app": case "go_home":
        if (W.HoloDock && W.HoloDock.revealDesktop) { W.HoloDock.revealDesktop(); return { ok: true, action: "desktop", say: "Showing the desktop." }; } return null;
      case "search_web": case "search": case "find": {
        var q = args.query || args.q || args.text || ""; if (!q) return null; doFind(q); return { ok: true, action: "find", say: "Searching for " + q + "." };
      }
      case "set_theme": case "set_appearance":
        if (W.HoloTheme && W.HoloTheme.setPalette) { var mode = (args.mode === "light" ? "light" : "dark"); W.HoloTheme.setPalette(mode); return { ok: true, action: "theme:" + mode, say: mode + " mode." }; } return null;
      case "set_accent":
        if (W.HoloTheme && W.HoloTheme.setAccent && (args.color || args.colour)) { try { W.HoloTheme.setAccent(args.color || args.colour); } catch (e) {} return { ok: true, action: "accent", say: "Accent updated." }; } return null;
      case "list_apps": {
        var names = appList().map(function (a) { return a.name; }).filter(Boolean);
        return { ok: true, action: "list", say: names.length ? "You can open " + names.slice(0, 12).join(", ") + "." : "No apps are installed." };
      }
      case "app_command": {
        var cn = args.command || args.name; if (!cn) return null;
        callApp(cn, args.params || args, { timeout: 2500 }).catch(function () {});   // fire into the open app
        return { ok: true, action: "app:" + cn, say: "" };
      }
    }
    return null;
  }
  // Q's persona — tuned for SPOKEN, real-time conversation: short replies travel faster (fewer tokens to
  // generate + synthesize) AND sound more human. No markdown/lists/emoji — it all has to be speakable.
  // ── Holo Mind wiring: Q is the VOICE · HANDS · MIND of the OS-wide orchestrator (ADR-0081) ─────────
  // Holo Mind (window.HoloMind, holo-mind-ui.js) is the gated, sealed, learning, sub-agent-delegating
  // agentic fabric. We make Q its embodiment, using ONLY its public API (its sealed core is untouched):
  //   (1) Q's on-device brain becomes Holo Mind's planning SAMPLER — it thinks with Q's mind.
  //   (2) Q's OS tools become the shell's MCP surface (window.HoloMCP) — its HANDS: Holo Mind plans over
  //       them, dispatches through them (conscience-gated, PROV-O sealed, Law L5).
  //   (3) every open-ended voice turn is fed to Holo Mind in the BACKGROUND, so it orchestrates + LEARNS
  //       over Q's whole stream without adding latency to Q's spoken reply.
  var _mindSays = [];
  function mcpToolList() { return buildTools().map(function (t) { return { name: t.function.name, description: t.function.description, inputSchema: t.function.parameters }; }); }
  function mountMCP() {                                                 // expose Q's capabilities as the shell's MCP surface
    if (W.HoloMCP) return;                                              // never clobber a real (per-app) one
    W.HoloMCP = {
      descriptor: function () { return { tools: mcpToolList() }; },
      handle: function (req) {
        try {
          var p = (req && req.params) || {}, m = req && req.method;
          if (m === "tools/list") return Promise.resolve({ jsonrpc: "2.0", id: req.id, result: { tools: mcpToolList() } });
          if (m === "tools/call") {
            var r = execTool({ name: p.name, args: p.arguments || {} });
            var say = (r && (r.say || r.action)) || ""; if (say) { _mindSays.push(say); if (_mindSays.length > 50) _mindSays.shift(); }
            return Promise.resolve({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: String(say || "ok") }], holo: { ok: !!(r && r.ok), action: (r && r.action) || null } } });
          }
          return Promise.resolve({ jsonrpc: "2.0", id: req.id, error: { message: "unknown method " + m } });
        } catch (e) { return Promise.resolve({ jsonrpc: "2.0", id: req.id, error: { message: String(e && e.message || e) } }); }
      },
    };
  }
  function mindSampler(engine) {                                        // Q's brain as the orchestrator's planner
    return async function (o) {
      try {
        var prompt = (o && o.prompt) || "", max = (o && o.maxTokens) || 256;
        if (engine.chat) return await engine.chat([{ role: "user", content: prompt }], { maxTokens: max });
        var acc = ""; for await (var d of engine.generate([{ role: "user", content: prompt }], {})) acc += d; return acc;
      } catch (e) { return ""; }
    };
  }
  function bindMind(engine) { try { var M = W.HoloMind; if (M && M.setSampler && (!M.hasSampler || !M.hasSampler())) M.setSampler(mindSampler(engine)); } catch (e) {} }
  // speak in Q's voice WITHOUT cutting off whatever's already playing — enqueued gaplessly after it. Used
  // for the orchestrator's follow-ups ("…and I've opened settings for you.") so the reply isn't clipped.
  async function speakAppend(text) {
    text = String(text || "").trim(); if (!text) return; var voice = CFG.voice;
    var cached = getPhrasePCM(text, voice);
    if (cached) { enqueuePCM(cached.audio, cached.rate); return; }
    try { var t = await ensureTTS(); if (t && t.engine) { var a = await synthLocked(function () { return t.engine.synth(text, { voice: voice }); }); if (a && a.audio) { putPhrasePCM(text, voice, a.audio, a.sampling_rate || 24000); enqueuePCM(a.audio, a.sampling_rate || 24000); return; } } } catch (e) {}
    try { speakSynthPush(text); } catch (e) {}
  }
  // voice what the orchestrator DID — and emit holo-voice-mind so the orb/UI can react (captions, pulse).
  function speakMind(text, opts) {
    opts = opts || {}; text = String(text || "").trim(); if (!text) return;
    var line = (opts.prefix ? opts.prefix + " " : "") + text;
    try { W.dispatchEvent(new CustomEvent("holo-voice-mind", { detail: { text: text, source: opts.source || "voice", prefix: opts.prefix || null } })); } catch (e) {}
    if (opts.append) speakAppend(line); else speakNatural(line);
  }
  // feed an open-ended turn to the orchestrator. It plans (Q's mind) over Q's tools, gates, dispatches,
  // seals + LEARNS — in the BACKGROUND so it never delays Q's chat reply. When it actually ACTS on an
  // intent the fast router missed, Q SPEAKS A FOLLOW-UP (gapless, after the reply). Pure chat plans nothing.
  function mindObserve(text) {
    if (CFG.mind === false) return; var M = W.HoloMind; if (!M || !M.loop) return;
    try {
      ensureBrain(); var start = _mindSays.length;
      M.loop({ utterance: text, source: "voice", actor: "human" }).then(function () {
        var says = _mindSays.slice(start).filter(Boolean);
        if (says.length && CFG.mindSpeak !== false) speakMind(says.join(" "), { append: true, source: "voice" });
      }).catch(function () {});
    } catch (e) {}
  }
  // run the orchestrator's PROACTIVE side and SPEAK it: fire due scheduled tasks (+ optionally act on the
  // drive proposals), and voice whatever they accomplished. The clock is read here, at the edge.
  async function mindTick() {
    var M = W.HoloMind; if (!M) return;
    try {
      ensureBrain(); var start = _mindSays.length;
      if (M.tick) await M.tick(Date.now());                            // scheduled tasks → the gated loop
      if (CFG.proactiveGoals && M.runProposals) await M.runProposals();   // drives → gated proposals (opt-in)
      var says = _mindSays.slice(start).filter(Boolean);
      if (says.length) speakMind(says.join(" "), { prefix: "Heads up —", source: "self" });
    } catch (e) {}
  }
  var _proactiveT = 0;
  function setProactive(on, opts) {
    opts = opts || {}; CFG.proactive = !!on;
    try { clearInterval(_proactiveT); } catch (e) {} _proactiveT = 0;
    if (on) _proactiveT = setInterval(mindTick, opts.everyMs || 15000);
    return CFG.proactive;
  }
  // make the orchestrator VISIBLE: when Holo Mind acts (holo-voice-mind), flare the orb gold (if Q Live is
  // open) and glow the mic button (the cue when it's not) — you SEE Holo Mind think and act, not just hear it.
  function wireMindOrb() {
    W.addEventListener("holo-voice-mind", function () {
      STATE.mindPulse = 1;
      try { if (btn) { btn.setAttribute("data-mind", "1"); clearTimeout(btn._mt); btn._mt = setTimeout(function () { btn.removeAttribute("data-mind"); }, 1300); } } catch (e) {}
    });
  }
  function sysPrompt() {
    return "You are " + CFG.wakeWord + ", the on-device voice of Hologram OS — warm, calm, quick-witted. " +
      "This is a SPOKEN conversation, so talk the way people actually talk: usually one or two short sentences, plain words, contractions. " +
      "Lead with the point in the first few words. No lists, no markdown, no emoji, no stage directions — everything you say is read aloud. " +
      "Don't restate the question. If something's unclear, ask one short follow-up. " +
      "When the user wants something done on the system, call the matching tool and give a brief spoken confirmation. " +
      "If you don't know, say so plainly. Never mention being a language model.";
  }
  // split a growing buffer into complete sentences as they stream in, so we can speak sentence 1 while
  // the model is still generating the rest. A boundary needs the FOLLOWING char to have arrived (and be
  // whitespace) so we never cut "3.14" or "a.m." mid-token; a soft cap breaks very long run-ons early.
  function sentencer() {
    var rest = "", firstFlushed = false;
    return {
      feed: function (delta) {
        rest += delta; var out = [], last = 0;
        for (var i = 0; i < rest.length - 1; i++) {
          var c = rest[i];
          if (c === "\n" || ((c === "." || c === "!" || c === "?" || c === "…") && /\s/.test(rest[i + 1]))) {
            var seg = rest.slice(last, i + 1).trim(); if (seg) out.push(seg); last = i + 1;
          }
        }
        // FIRST-CLAUSE flush: get Q talking sooner — before the opening sentence completes, emit the
        // first clause (at a comma/dash) or the first ~7 words. ONLY the first chunk; the rest stays
        // sentence-grained so prosody holds. Cuts time-to-first-audio.
        if (!firstFlushed && !out.length) {
          var head = rest.slice(last), m = head.search(/[,;:—–-]\s/);
          if (m >= 3) { var c1 = head.slice(0, m + 1).trim(); if (c1) { out.push(c1); last += m + 1; } }
          else if (head.length > 42) { var sp0 = head.lastIndexOf(" ", 40); if (sp0 >= 12) { var c2 = head.slice(0, sp0).trim(); if (c2) { out.push(c2); last += sp0 + 1; } } }
        }
        if (out.length) firstFlushed = true;
        if (rest.length - last > 180) { var sp = rest.lastIndexOf(" ", last + 170); if (sp > last + 40) { var seg2 = rest.slice(last, sp).trim(); if (seg2) out.push(seg2); last = sp + 1; } }
        rest = rest.slice(last); return out;
      },
      flush: function () { var s = rest.trim(); rest = ""; return s; }
    };
  }
  var _history = [{ role: "system", content: sysPrompt() }];
  async function converseAgent(text, ctl) {
    hud("thinking", "“" + text + "”");
    _history[0] = { role: "system", content: sysPrompt() };           // keep persona in sync with the chosen name
    _history.push({ role: "user", content: text });
    if (_history.length > 12) _history = [_history[0]].concat(_history.slice(-10));   // bound context
    var brain = await ensureBrain();                                  // lazy-load + bind the on-device LLM
    var Q = await ensureQVAC(), reply = "", acted = [], spoken = false;
    // Q speaks as the reply STREAMS: each finished sentence is pushed to a gapless speaker the moment it
    // lands, so the time-to-first-word is one sentence — not the whole answer + its full synthesis.
    var speaker = CFG.confirm ? makeSpeaker({ voice: CFG.voice }) : null; if (speaker) _activeSpeaker = speaker;
    var sent = sentencer();
    function emit(delta) { tmark("firstToken"); reply += delta; hud("speaking", reply); if (speaker) sent.feed(delta).forEach(function (s) { speaker.push(s); spoken = true; }); }
    // 1. governed seam — conscience gate + sealed receipt (active when the SDK is loaded). Streams the
    //    bound LLM if present, else the reference floor. A blocked verdict emits completionError (pre-stream).
    if (Q && Q.completion) {
      try {
        var run = Q.completion({ history: _history, stream: true, tools: buildTools() }), errored = false;
        for await (var ev of run.events) {
          if (ctl && ctl.aborted) { try { run.cancel && run.cancel(); } catch (e) {} break; }   // user cut in → drop it
          if (ev.type === "completionError") { errored = true; break; }   // blocked → final never resolves
          if (ev.type === "contentDelta") emit(ev.delta);
          else if (ev.type === "toolCall") { var r = execTool(ev); if (r) acted.push(r.action || r.say); }
        }
        if (!errored) {
          var final = await run.final;
          if (final && final.toolCalls) final.toolCalls.forEach(function (tc) { var r = execTool(tc); if (r) acted.push(r.action || r.say); });
          if (final && final.contentText && !reply) reply = final.contentText;   // non-streaming provider → got it whole
        }
      } catch (e) {}
    }
    // 2. direct on-device LLM (still serverless) when the governed seam is blocked/absent.
    if (!reply && brain && brain.engine) {
      try { for await (var d of brain.engine.generate(_history, {})) { if (ctl && ctl.aborted) break; emit(d); } reply = reply.trim(); } catch (e) {}
    }
    // 3. deterministic reference floor — the loop always closes, even with no model.
    if (!reply) { try { var mod = await import(BASE + "holo-qvac.mjs"); reply = (mod.referenceComplete(_history, {}) || "").trim(); } catch (e) {} }
    if (!reply) reply = "No language model is bound yet — I can navigate the OS, but vendor an on-device model to chat. (tools/vendor-voice-model.mjs is the pattern.)";
    _history.push({ role: "assistant", content: reply });
    hud("done", reply + (acted.length ? "  ·  " + acted.join(", ") : ""));
    if (speaker) {
      var leftover = sent.flush(); if (leftover) speaker.push(leftover);   // speak the final partial sentence
      if (!spoken && !leftover) speaker.push(reply);                       // reply arrived whole (memo/non-stream)
      try { await speaker.done(); } catch (e) {}                           // resolve when Q finishes talking
      if (_activeSpeaker === speaker) _activeSpeaker = null;
    }
    W.dispatchEvent(new CustomEvent("holo-voice", { detail: { text: text, reply: reply, acted: acted, converse: true } }));
    return { reply: reply, acted: acted };
  }

  // ── one full turn ────────────────────────────────────────────────────────────────────────────────
  async function activate() {
    if (STATE.busy) { return; }
    STATE.busy = true; pauseWake(); setBtn(true); hud("listening", "listening…");   // free the mic from the wake loop
    try {
      var text = await recognize();
      STATE.lastText = text || "";
      if (!text) { hud("idle", "(nothing heard)"); flashBtn(); return; }
      await handleText(text);
    } catch (e) {
      hud("error", String(e && e.message || e));
      if (/denied|not-allowed|permission/i.test(String(e))) speak("Microphone access is needed for voice.");
    } finally { STATE.busy = false; setBtn(false); resumeWake(); setTimeout(function () { if (!STATE.busy) hide(); }, 2600); }
  }
  // route an utterance to an action or the agent, then confirm — shared by push-to-talk and the wake word.
  async function handleText(text) {
    hud("thinking", "“" + text + "”");
    var res = route(text);   // explicit wake / push-to-talk → act now (route's exec thunk already ran)
    if (res && res.appCmd) { STATE.lastAction = "app:" + res.appCmd; if (CFG.confirm && res.say) speak(res.say); W.dispatchEvent(new CustomEvent("holo-voice", { detail: { text: text, result: res } })); return; }
    if (res && res.converse) { mindObserve(res.text || text); STATE.lastAction = "converse"; await converseAgent(res.text || text); return; }
    STATE.lastAction = res.action || null;
    hud(res.ok ? "done" : "miss", "“" + text + "” → " + (res.action || "—"));
    if (CFG.confirm && res.say && W.HoloQVAC && W.HoloQVAC.textToSpeech) {
      try { await W.HoloQVAC.textToSpeech({ text: res.say }); } catch (e) { speak(res.say); }
    } else if (CFG.confirm && res.say) { speak(res.say); }
    W.dispatchEvent(new CustomEvent("holo-voice", { detail: { text: text, result: res } }));
  }

  // ── wake word: a serverless, VAD-gated always-listening loop ─────────────────────────────────────
  // Reuses the vendored Whisper (no new model): a persistent mic + energy VAD records ONLY speech
  // segments and transcribes each on-device; if the transcript contains the wake phrase ("Holo",
  // "hey Holo", "computer", …) it acts on the rest — or, if the wake word was said alone, listens for
  // the command. Silence costs only cheap RMS polling; Whisper runs only when you actually speak.
  // The wake word is configurable and matched naturally: an optional greeting ("hey", "sup", "yo", …)
  // then the name, anchored to the START of the utterance (so "join the queue" never triggers). Short
  // names get homophones, since ASR mishears single letters — "Q" → cue/queue/kyu/kew, etc.
  var GREET = "(?:hey|hi|hello|hiya|yo|sup|ok|okay|um|uh|so|excuse me|hey there)";
  // strong = wakes even with no greeting; weak = common-word homophones that wake ONLY after a greeting
  // (so "queue up the song" never triggers, but "hey Q" — heard as "hey queue" — does).
  var HOMOPHONES = { q: { strong: ["q", "kyu", "kew", "kuh"], weak: ["cue", "queue", "qu"] }, x: { strong: ["x", "eks"], weak: ["ex"] }, j: { strong: ["j", "jay"], weak: [] }, k: { strong: ["k", "kay"], weak: [] } };
  function esc(s) { return String(s).toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function alt(list) { return list.map(esc).filter(Boolean).join("|"); }
  var WAKE = {};
  function buildWake(word) {
    var w = String(word || "Q").trim().toLowerCase();
    var h = HOMOPHONES[w] || { strong: [w], weak: [] };
    var strong = h.strong.indexOf(w) < 0 ? [w].concat(h.strong) : h.strong;
    var all = strong.concat(h.weak);
    // greeting + (any homophone)  OR  (a strong homophone on its own)
    var core = "(?:" + GREET + "\\s+(?:" + alt(all) + ")|(?:" + alt(strong) + "))";
    WAKE.word = word;
    WAKE.re = new RegExp("^\\s*" + core + "\\b", "i");                 // detect (anchored to start)
    WAKE.strip = new RegExp("^\\s*" + core + "\\b[\\s,.!?-]*", "i");   // peel off the address
  }
  buildWake(CFG.wakeWord);
  function setWakeWord(word) {
    word = (word || "").trim() || "Q"; CFG.wakeWord = word;
    try { localStorage.setItem("holo.voice.wakeword", word); } catch (e) {}
    buildWake(word); return word;
  }
  var ACKS = ["Yeah?", "What's up?", "Mm-hm?", "Go ahead.", "I'm listening.", "Yep?"];
  function ack() { return ACKS[Math.floor(Math.random() * ACKS.length)]; }
  // Q's voices (vendored Kokoro voices). setVoice persists the choice; the next reply uses it.
  var VOICES = [["af_heart", "Heart · US ♀"], ["af_bella", "Bella · US ♀"], ["af_nicole", "Nicole · US ♀"], ["am_michael", "Michael · US ♂"], ["am_fenrir", "Fenrir · US ♂"], ["am_puck", "Puck · US ♂"], ["bf_emma", "Emma · UK ♀"], ["bm_george", "George · UK ♂"]];
  function setVoice(v) { CFG.voice = v || "af_heart"; try { localStorage.setItem("holo.voice.voice", CFG.voice); } catch (e) {} return CFG.voice; }
  var wakeOn = false, wakeResume = false, wakeStream = null, wakeAC = null, wakeRaf = null, wakeProcessing = false;
  async function startWake() {
    if (wakeOn) return true;
    var mode = await ensureMode();
    if (mode !== "serverless") { speakToast("Wake word needs the on-device model — vendor it (tools/vendor-voice-model.mjs)."); return false; }
    try { wakeStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { speakToast("Microphone access is needed for the wake word."); return false; }
    wakeOn = true; try { localStorage.setItem("holo.voice.wake", "1"); } catch (e) {}
    if (btn) { btn.setAttribute("data-wake", "1"); btn.title = "Listening for “" + CFG.wakeWord + "” · click for Q Live · right-click for settings"; }
    segmenter(wakeStream);
    return true;
  }
  function teardownWake() {
    try { cancelAnimationFrame(wakeRaf); } catch (e) {}
    try { wakeStream && wakeStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { wakeAC && wakeAC.close(); } catch (e) {}
    wakeStream = null; wakeAC = null;
  }
  function stopWake() {
    wakeOn = false; wakeResume = false; try { localStorage.setItem("holo.voice.wake", "0"); } catch (e) {}
    teardownWake();
    if (btn) { btn.removeAttribute("data-wake"); btn.title = "Talk to Q · right-click for settings"; }
  }
  // pause/resume: the always-listening wake mic must NOT run while Q Live's mic is open (one ORT
  // transcribe at a time). Pausing keeps the setting persisted; resume re-arms when the call ends.
  function pauseWake() { if (!wakeOn) return; wakeResume = true; wakeOn = false; teardownWake(); if (btn) btn.removeAttribute("data-wake"); }
  function resumeWake() { if (wakeResume) { wakeResume = false; startWake(); } }
  function segmenter(stream) {
    var AC = W.AudioContext || W.webkitAudioContext; wakeAC = new AC();
    var src = wakeAC.createMediaStreamSource(stream), an = wakeAC.createAnalyser(); an.fftSize = 1024; src.connect(an);
    var buf = new Uint8Array(an.fftSize), rec = null, chunks = [], speaking = false, lastLoud = 0, segStart = 0;
    function rms() { an.getByteTimeDomainData(buf); var s = 0; for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; s += v * v; } return Math.sqrt(s / buf.length); }
    function endSeg() { speaking = false; try { rec && rec.state !== "inactive" && rec.stop(); } catch (e) {} }
    function loop() {
      if (!wakeOn) return;
      var lvl = rms(), now = Date.now();
      if (!STATE.busy && !wakeProcessing && !STATE.liveOn) {
        if (lvl > 0.03) {
          if (!speaking) {
            speaking = true; segStart = now; chunks = [];
            try { rec = new MediaRecorder(stream); rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); }; rec.onstop = onSeg; rec.start(); } catch (e) {}
          }
          lastLoud = now;
        } else if (speaking && now - lastLoud > 700) endSeg();        // trailing silence → segment done
        else if (speaking && now - segStart > 6000) endSeg();         // hard cap per segment
      }
      wakeRaf = requestAnimationFrame(loop);
    }
    async function onSeg() {
      if (!wakeOn || !chunks.length) return;
      var blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" }); chunks = [];
      wakeProcessing = true;
      try {
        var audio = await decodeTo16k(blob);
        var r = await STATE.asr.transcribe(audio, { language: CFG.lang });
        var text = (r && r.text || "").trim();
        if (text && WAKE.re.test(norm(text))) {
          var rest = norm(text).replace(WAKE.strip, "").trim();
          if (rest) {                                                     // "Q, open browser" → act at once, stay on the desktop
            STATE.busy = true; setBtn(true);
            try { STATE.lastText = text; await handleText(text); }
            finally { STATE.busy = false; setBtn(false); setTimeout(function () { if (!STATE.busy) hide(); }, 2600); }
          } else { openLive(); }                                          // bare "Q" → wake Q into the live conversation
        }
      } catch (e) { } finally { wakeProcessing = false; }
    }
    wakeRaf = requestAnimationFrame(loop);
  }

  // ── chrome: mic button + HUD ────────────────────────────────────────────────────────────────────
  var btn, hudEl, levelEl, txtEl;
  function css() {
    if (DOC.getElementById("holo-voice-css")) return;
    var s = DOC.createElement("style"); s.id = "holo-voice-css";
    s.textContent =
      "#holo-voice-btn{position:fixed;right:14px;bottom:calc(66px + var(--holo-dock-h,0px));z-index:2147482400;width:44px;height:44px;border-radius:999px;" +
      "border:1px solid var(--holo-border,var(--line,rgba(255,255,255,.18)));background:var(--holo-surface,#0d1117e6);color:var(--holo-ink,var(--ink,#e9eef7));" +
      "font-size:20px;cursor:pointer;backdrop-filter:blur(6px);box-shadow:0 2px 10px #0006;display:flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .2s,background .2s}" +
      "#holo-voice-btn:hover{transform:translateY(-1px)}" +
      "#holo-voice-btn[data-on=\"1\"]{background:var(--holo-accent,#5b8cff);color:#fff;box-shadow:0 0 0 4px color-mix(in srgb,var(--holo-accent,#5b8cff) 35%,transparent),0 2px 14px #0007}" +
      "@keyframes hv-wake{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--holo-accent,#5b8cff) 45%,transparent),0 2px 10px #0006}50%{box-shadow:0 0 0 6px color-mix(in srgb,var(--holo-accent,#5b8cff) 0%,transparent),0 2px 10px #0006}}" +
      "#holo-voice-btn[data-wake=\"1\"]:not([data-on=\"1\"]){animation:hv-wake 2.2s ease-in-out infinite;border-color:var(--holo-accent,#5b8cff)}" +
      "@keyframes hv-mind{0%{box-shadow:0 0 0 0 rgba(255,196,64,.7),0 2px 10px #0006}60%{box-shadow:0 0 0 11px rgba(255,196,64,0),0 2px 10px #0006}100%{box-shadow:0 0 0 0 rgba(255,196,64,0),0 2px 10px #0006}}" +
      "#holo-voice-btn[data-mind=\"1\"]{animation:hv-mind 1.3s ease-out;border-color:#ffc440}" +
      "#holo-voice-hud{position:fixed;right:14px;bottom:calc(120px + var(--holo-dock-h,0px));z-index:2147482400;max-width:min(340px,72vw);padding:.6rem .8rem;border-radius:14px;" +
      "background:var(--holo-glass-acrylic-bg,rgba(18,22,30,.86));-webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);" +
      "border:1px solid var(--holo-glass-border,rgba(255,255,255,.18));box-shadow:0 .5rem 2rem rgba(0,0,0,.5);color:var(--holo-ink,#e9eef7);" +
      "font:16px/1.35 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif);opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .2s,transform .2s}" +
      "#holo-voice-hud[data-show=\"1\"]{opacity:1;transform:none}" +
      "#holo-voice-hud .hv-row{display:flex;align-items:center;gap:.5rem}" +
      "#holo-voice-hud .hv-dot{width:8px;height:8px;border-radius:999px;background:var(--holo-accent,#5b8cff);flex:0 0 auto}" +
      "#holo-voice-hud .hv-meter{height:4px;border-radius:999px;background:var(--holo-accent,#5b8cff);width:0;margin-top:.4rem;transition:width .08s linear}" +
      "#holo-voice-hud .hv-txt{margin-top:.25rem;opacity:.92;word-break:break-word}" +
      "#holo-voice-menu{position:fixed;right:14px;bottom:calc(120px + var(--holo-dock-h,0px));z-index:2147482401;width:min(300px,80vw);padding:.7rem .8rem;border-radius:14px;" +
      "background:var(--holo-glass-acrylic-bg,rgba(18,22,30,.92));-webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);" +
      "border:1px solid var(--holo-glass-border,rgba(255,255,255,.18));box-shadow:0 .6rem 2.4rem rgba(0,0,0,.55);color:var(--holo-ink,#e9eef7);" +
      "font:14px/1.4 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif);opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .18s,transform .18s}" +
      "#holo-voice-menu[data-show=\"1\"]{opacity:1;transform:none;pointer-events:auto}" +
      "#holo-voice-menu h4{margin:0 0 .5rem;font-size:13px;opacity:.7;font-weight:600}" +
      "#holo-voice-menu .hv-eng{display:flex;align-items:center;justify-content:space-between;gap:.6rem;margin:.35rem 0}" +
      "#holo-voice-menu .hv-sw{appearance:none;width:38px;height:22px;border-radius:999px;background:rgba(255,255,255,.18);position:relative;cursor:pointer;flex:0 0 auto;transition:background .2s}" +
      "#holo-voice-menu .hv-sw:checked{background:var(--holo-accent,#5b8cff)}" +
      "#holo-voice-menu .hv-sw::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s}" +
      "#holo-voice-menu .hv-sw:checked::after{left:18px}" +
      "#holo-voice-menu .hv-name{width:84px;padding:.32rem .5rem;border-radius:8px;border:1px solid var(--holo-glass-border,rgba(255,255,255,.22));background:rgba(255,255,255,.08);color:inherit;font:inherit;text-align:center}" +
      "#holo-voice-menu .hv-voice{padding:.32rem .4rem;border-radius:8px;border:1px solid var(--holo-glass-border,rgba(255,255,255,.22));background:rgba(20,24,32,.9);color:inherit;font:inherit;max-width:150px}" +
      "#holo-voice-menu .hv-name:focus{outline:2px solid var(--holo-accent,#5b8cff);outline-offset:1px}" +
      "#holo-voice-menu button.hv-test{margin-top:.5rem;width:100%;padding:.5rem;border-radius:10px;border:1px solid var(--holo-glass-border,rgba(255,255,255,.2));" +
      "background:var(--holo-accent,#5b8cff);color:#fff;font:inherit;font-weight:600;cursor:pointer}" +
      "#holo-voice-menu button.hv-test[disabled]{opacity:.5;cursor:default}" +
      "#holo-voice-menu .hv-note{margin-top:.5rem;font-size:12px;opacity:.6;line-height:1.35}";
    DOC.head.appendChild(s);
  }
  function mount() {
    css();
    btn = DOC.createElement("button"); btn.id = "holo-voice-btn"; btn.type = "button";
    btn.setAttribute("aria-label", "Talk to Q. Right-click or long-press for settings."); btn.title = "Talk to Q · right-click for settings"; btn.textContent = "🎙";
    btn.addEventListener("click", openLive);                          // tap → the magical voice-to-voice mode
    // right-click / long-press → engine settings (WebGPU toggle + self-test)
    btn.addEventListener("contextmenu", function (e) { e.preventDefault(); toggleMenu(); });
    var lp; btn.addEventListener("pointerdown", function () { lp = setTimeout(function () { lp = null; toggleMenu(); }, 550); });
    btn.addEventListener("pointerup", function () { if (lp) { clearTimeout(lp); lp = null; } });
    btn.addEventListener("pointerleave", function () { if (lp) { clearTimeout(lp); lp = null; } });
    DOC.body.appendChild(btn);
    hudEl = DOC.createElement("div"); hudEl.id = "holo-voice-hud";
    hudEl.innerHTML = '<div class="hv-row"><span class="hv-dot"></span><strong class="hv-state">Holo Voice</strong></div><div class="hv-txt"></div><div class="hv-meter"></div>';
    txtEl = hudEl.querySelector(".hv-txt"); levelEl = hudEl.querySelector(".hv-meter");
    DOC.body.appendChild(hudEl);
    mountMenu();
  }

  // ── engine settings popover (WebGPU toggle + real-hardware self-test) ────────────────────────────
  var menuEl;
  function mountMenu() {
    menuEl = DOC.createElement("div"); menuEl.id = "holo-voice-menu";
    menuEl.innerHTML =
      '<h4>Voice assistant</h4>' +
      '<div class="hv-eng"><span>Name <em style="opacity:.6">(say “hey&nbsp;…”)</em></span><input type="text" class="hv-name" id="hv-name" maxlength="24" spellcheck="false" autocomplete="off"></div>' +
      '<div class="hv-eng"><span>Voice</span><select class="hv-voice" id="hv-voice">' + VOICES.map(function (v) { return '<option value="' + v[0] + '">' + v[1] + '</option>'; }).join("") + '</select></div>' +
      '<div class="hv-eng"><span>Hands-free wake word</span><input type="checkbox" class="hv-sw" id="hv-wake-sw"></div>' +
      '<div class="hv-eng"><span>Use WebGPU <em style="opacity:.6">(1.5B, faster)</em></span><input type="checkbox" class="hv-sw" id="hv-gpu-sw"></div>' +
      '<button type="button" class="hv-test">Test WebGPU on this device</button>' +
      '<div class="hv-note"></div>';
    DOC.body.appendChild(menuEl);
    var sw = menuEl.querySelector("#hv-gpu-sw"), wsw = menuEl.querySelector("#hv-wake-sw"), nm = menuEl.querySelector("#hv-name"), vc = menuEl.querySelector("#hv-voice"), test = menuEl.querySelector(".hv-test"), note = menuEl.querySelector(".hv-note");
    function refresh() {
      sw.checked = !!CFG.preferWebGPU; wsw.checked = !!wakeOn; if (DOC.activeElement !== nm) nm.value = CFG.wakeWord; vc.value = CFG.voice;
      var w = CFG.wakeWord;
      note.textContent = wakeOn
        ? "Listening. Say “hey " + w + ", open browser” — or just “" + w + "” then your command."
        : (CFG.preferWebGPU
          ? "WebGPU on. If replies look like gibberish, your GPU path is unsupported — run the test or turn this off."
          : "On the any-browser WASM model (0.5B). Turn on WebGPU for the larger 1.5B model, then test it.");
    }
    nm.addEventListener("input", function () { setWakeWord(nm.value); if (menuEl.querySelector(".hv-note")) refresh(); });
    vc.addEventListener("change", function () { setVoice(vc.value); speakNatural("Hi, this is " + CFG.wakeWord + "."); });   // preview the chosen voice
    wsw.addEventListener("change", async function () { if (wsw.checked) { var ok = await startWake(); if (!ok) wsw.checked = false; } else stopWake(); refresh(); });
    sw.addEventListener("change", function () { setEngine(sw.checked); refresh(); });
    test.addEventListener("click", async function () {
      test.disabled = true; test.textContent = "Testing… (loads ~1GB once)";
      try { await testWebGPU(); } catch (e) {}
      test.disabled = false; test.textContent = "Test WebGPU on this device"; refresh(); sw.checked = !!CFG.preferWebGPU;
    });
    menuEl._refresh = refresh; refresh();
    DOC.addEventListener("click", function (e) { if (menuEl.getAttribute("data-show") === "1" && !menuEl.contains(e.target) && e.target !== btn) hideMenu(); });
  }
  function toggleMenu() { if (!menuEl) return; if (menuEl.getAttribute("data-show") === "1") hideMenu(); else { menuEl._refresh && menuEl._refresh(); menuEl.setAttribute("data-show", "1"); } }
  function hideMenu() { if (menuEl) menuEl.setAttribute("data-show", "0"); }
  function setBtn(on) { if (btn) btn.setAttribute("data-on", on ? "1" : "0"); }
  function flashBtn() { if (!btn) return; btn.animate && btn.animate([{ transform: "scale(1)" }, { transform: "scale(.9)" }, { transform: "scale(1)" }], { duration: 220 }); }
  function show() { if (hudEl) hudEl.setAttribute("data-show", "1"); }
  function hide() { if (hudEl) hudEl.setAttribute("data-show", "0"); }
  function hud(state, text, level) {
    if (!hudEl) return; show();
    var st = hudEl.querySelector(".hv-state"); if (st) st.textContent = ({ listening: "Listening", thinking: "Thinking", loading: "Loading", done: "Done", miss: "Hmm", error: "Error", idle: "Holo Voice" })[state] || "Holo Voice";
    if (txtEl && text != null) txtEl.textContent = text;
    if (levelEl) levelEl.style.width = (level != null ? Math.min(100, Math.round(level * 600)) : 0) + "%";
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // Q LIVE — the magical voice-to-voice experience: one tap, then just talk. A living orb listens,
  // thinks, and speaks back, hands-free, turn after turn. All the engines are hidden behind it.
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  var liveEl, liveCanvas, liveCtx, capQ, capYou, capHint, liveSub, beginBtn, orbRaf = 0, _smooth = 0;
  function liveCss() {
    if (DOC.getElementById("holo-live-css")) return;
    var s = DOC.createElement("style"); s.id = "holo-live-css";
    s.textContent =
      "#holo-live{position:fixed;inset:0;z-index:2147483600;display:none;flex-direction:column;align-items:center;justify-content:center;" +
      "background:radial-gradient(130% 120% at 50% 38%,color-mix(in srgb,var(--holo-accent,#5b8cff) 12%,rgba(8,10,16,.85)),rgba(5,7,11,.94) 72%);" +
      "-webkit-backdrop-filter:blur(26px) saturate(1.3);backdrop-filter:blur(26px) saturate(1.3);opacity:0;transition:opacity .45s ease}" +
      "#holo-live[data-show=\"1\"]{display:flex;opacity:1}" +
      "#holo-live canvas{width:min(54vmin,340px);height:min(54vmin,340px);cursor:pointer;touch-action:manipulation}" +
      "#holo-live .hl-you{margin-top:1.6rem;min-height:1.4em;max-width:min(680px,86vw);text-align:center;color:var(--holo-ink,#cdd6e6);opacity:.5;font:400 clamp(14px,2.1vmin,17px)/1.35 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif)}" +
      "#holo-live .hl-q{margin-top:.5rem;min-height:2.4em;max-width:min(720px,88vw);text-align:center;color:var(--holo-ink,#eef2fb);font:300 clamp(19px,3.3vmin,30px)/1.45 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif);transition:opacity .3s}" +
      "#holo-live .hl-hint{margin-top:1.4rem;color:var(--holo-ink,#9fb0c8);opacity:.5;font:600 12px/1 var(--holo-font-sans,system-ui);letter-spacing:.18em;text-transform:uppercase}" +
      "#holo-live .hl-x{position:absolute;top:max(18px,env(safe-area-inset-top));right:18px;width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)}" +
      "#holo-live .hl-x:hover{background:rgba(255,255,255,.13)}" +
      "#holo-live .hl-sub{margin-top:.55rem;color:var(--holo-ink,#aebbd2);opacity:.62;text-align:center;max-width:min(560px,84vw);font:400 clamp(13px,2vmin,16px)/1.45 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif);display:none}" +
      "#holo-live .hl-begin{margin-top:1.6rem;padding:.72rem 2.3rem;border-radius:999px;cursor:pointer;display:none;letter-spacing:.02em;" +
      "border:1px solid color-mix(in srgb,var(--holo-accent,#5b8cff) 60%,transparent);background:color-mix(in srgb,var(--holo-accent,#5b8cff) 22%,rgba(255,255,255,.04));color:var(--holo-ink,#eef2fb);" +
      "font:600 15px/1 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:transform .15s,background .2s,box-shadow .2s}" +
      "#holo-live .hl-begin:hover{transform:translateY(-1px);background:color-mix(in srgb,var(--holo-accent,#5b8cff) 34%,rgba(255,255,255,.05));box-shadow:0 0 0 4px color-mix(in srgb,var(--holo-accent,#5b8cff) 20%,transparent),0 10px 28px rgba(0,0,0,.42)}";
    DOC.head.appendChild(s);
  }
  function buildLive() {
    liveCss();
    liveEl = DOC.createElement("div"); liveEl.id = "holo-live"; liveEl.setAttribute("role", "dialog"); liveEl.setAttribute("aria-label", "Voice conversation");
    liveEl.innerHTML = '<button class="hl-x" type="button" aria-label="Close">✕</button><canvas></canvas><div class="hl-you"></div><div class="hl-q"></div><div class="hl-sub"></div><button class="hl-begin" type="button">Begin</button><div class="hl-hint"></div>';
    liveCanvas = liveEl.querySelector("canvas"); liveCtx = liveCanvas.getContext("2d");
    capYou = liveEl.querySelector(".hl-you"); capQ = liveEl.querySelector(".hl-q"); capHint = liveEl.querySelector(".hl-hint");
    liveSub = liveEl.querySelector(".hl-sub"); beginBtn = liveEl.querySelector(".hl-begin");
    liveEl.querySelector(".hl-x").addEventListener("click", closeLive);
    liveEl.addEventListener("click", function (e) { if (e.target === liveEl) closeLive(); });          // tap backdrop to leave
    beginBtn.addEventListener("click", function (e) { e.stopPropagation(); runWelcome(); });           // first-run: meet Q
    liveCanvas.addEventListener("click", function () {
      if (STATE.welcoming && beginBtn.style.display !== "none") { runWelcome(); return; }               // tap the orb to begin
      if (STATE.ttsLevel > 0) { stopSpeaking(); STATE.live = "listening"; }                             // or to interrupt Q
    });
    DOC.addEventListener("keydown", function (e) { if (STATE.liveOn && e.key === "Escape") closeLive(); });
    DOC.body.appendChild(liveEl);
  }
  // ── the orb: a living geometric heart for Q ──────────────────────────────────────────────────────
  // A 20-vertex icosphere lattice rotating in 3D over a glowing core. It breathes on its own and swells
  // with Q's voice (ttsLevel) or yours (micLevel); its colour is chosen by Q's MOOD — warm and multi-
  // hued while welcoming, calm teal while listening, violet while thinking, and the OS accent while
  // speaking, with the hue shimmering on the intonation of each syllable. Pure 2D canvas + math (L4).
  var ICO = (function () {
    var p = (1 + Math.sqrt(5)) / 2;
    var raw = [[-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0], [0, -1, p], [0, 1, p], [0, -1, -p], [0, 1, -p], [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1]];
    var v = raw.map(function (q) { var l = Math.hypot(q[0], q[1], q[2]); return [q[0] / l, q[1] / l, q[2] / l]; });
    var e = []; for (var i = 0; i < v.length; i++) for (var j = i + 1; j < v.length; j++) { if (Math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1], v[i][2] - v[j][2]) < 1.2) e.push([i, j]); }
    return { v: v, e: e };                                            // 12 vertices, 30 edges
  })();
  var _rm = false; try { _rm = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  function accent() { try { return (getComputedStyle(root).getPropertyValue("--holo-accent") || "").trim() || "#5b8cff"; } catch (e) { return "#5b8cff"; } }
  function hueOf(c) {
    try {
      c = String(c).trim().replace("#", ""); if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
      var r = parseInt(c.slice(0, 2), 16) / 255, g = parseInt(c.slice(2, 4), 16) / 255, b = parseInt(c.slice(4, 6), 16) / 255;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, hh = 0;
      if (d) { if (mx === r) hh = ((g - b) / d) % 6; else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; }
      return hh;
    } catch (e) { return 222; }
  }
  function accentHue() { return hueOf(accent()); }
  function hsl(h, s, l, a) { return "hsla(" + (((h % 360) + 360) % 360).toFixed(0) + "," + Math.max(0, Math.min(100, s)).toFixed(0) + "%," + Math.max(0, Math.min(100, l)).toFixed(0) + "%," + a.toFixed(3) + ")"; }
  // mood → palette. hue = base colour, spread = width of the geometric rainbow across depth, sat/light
  // set the temperature. Driven by the live state plus the smoothed audio level (intonation).
  function mood(t, level) {
    var s = STATE.welcoming ? "welcome" : STATE.live;
    if (s === "welcome" || s === "waking") return { hue: 285 + Math.sin(t * 0.22) * 55, spread: 64, sat: 84, light: 62 + level * 14 };
    if (s === "listening") return { hue: 188 + Math.sin(t * 0.5) * 8, spread: 24, sat: 72, light: 56 + level * 24 };
    if (s === "thinking") return { hue: 268 + Math.sin(t * 1.1) * 18, spread: 46, sat: 78, light: 60 };
    if (s === "speaking") { var ah = accentHue(); return { hue: ah + Math.sin(t * 5) * level * 34, spread: 38, sat: 80, light: 60 + level * 24 }; }
    return { hue: accentHue(), spread: 28, sat: 70, light: 60 };       // idle
  }
  function drawOrb() {
    if (!STATE.liveOn || !liveCtx) return;
    var dpr = W.devicePixelRatio || 1, w = liveCanvas.clientWidth, h = liveCanvas.clientHeight;
    if (liveCanvas.width !== Math.round(w * dpr)) { liveCanvas.width = Math.round(w * dpr); liveCanvas.height = Math.round(h * dpr); }
    var ctx = liveCtx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2, t = performance.now() / 1000, spin = _rm ? 0.12 : 1;
    var lvl = Math.max(STATE.ttsLevel * 1.1, STATE.micLevel * 5);      // mic is quieter than playback
    _smooth += (lvl - _smooth) * 0.18; var L = Math.min(_smooth, 1.3), M = mood(t, L);
    // Holo Mind pulse — when the orchestrator ACTS, the orb flares toward a signature gold and bursts a ring.
    var P = STATE.mindPulse || 0; STATE.mindPulse = P > 0.004 ? P * 0.955 : 0;
    if (P > 0.004) { var mp = Math.min(0.85, P); M = { hue: M.hue + (46 - M.hue) * mp, spread: M.spread + 26 * P, sat: Math.min(96, M.sat + 14 * P), light: Math.min(82, M.light + 18 * P) }; }
    var base = Math.min(w, h) * 0.16, breathe = 1 + Math.sin(t * 1.4) * 0.04 * spin;
    var R = base * breathe * (1 + L * 0.42);
    // outer aura
    var g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.6);
    g.addColorStop(0, hsl(M.hue, M.sat, M.light, 0.5)); g.addColorStop(0.45, hsl(M.hue + M.spread * 0.4, M.sat, M.light - 8, 0.14)); g.addColorStop(1, hsl(M.hue, M.sat, M.light, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 2.6, 0, 7); ctx.fill();
    // listening ripples
    if (!_rm && (STATE.live === "listening" || STATE.micLevel > 0.02)) {
      for (var k = 0; k < 3; k++) { var rr = R * (1.25 + k * 0.5) + (t * 38 % 60); ctx.strokeStyle = hsl(M.hue, M.sat, M.light, Math.max(0, 0.16 - k * 0.045) * (0.4 + L)); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 7); ctx.stroke(); }
    }
    // glowing core
    var core = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.32, R * 0.08, cx, cy, R);
    core.addColorStop(0, "#ffffff"); core.addColorStop(0.28, hsl(M.hue, M.sat, Math.min(94, M.light + 24), 0.96)); core.addColorStop(1, hsl(M.hue, M.sat, M.light, 0.62));
    ctx.fillStyle = core; ctx.shadowColor = hsl(M.hue, M.sat, M.light, 1); ctx.shadowBlur = 26 + L * 46 + P * 70; ctx.beginPath(); ctx.arc(cx, cy, R * 0.92, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    // mind flare — twin gold rings bursting outward as the pulse decays (the orchestrator's signature)
    if (P > 0.01) {
      ctx.strokeStyle = hsl(46, 92, 68, P * 0.85); ctx.lineWidth = 1.5 + P * 5; ctx.beginPath(); ctx.arc(cx, cy, R * (1.25 + (1 - P) * 2.4), 0, 7); ctx.stroke();
      ctx.strokeStyle = hsl(52, 96, 76, P * 0.5); ctx.lineWidth = 1 + P * 3; ctx.beginPath(); ctx.arc(cx, cy, R * (1.25 + (1 - P) * 1.4), 0, 7); ctx.stroke();
    }
    // the geometric lattice — an icosphere rotating in 3D, vertices nudged outward by the voice
    var ax = t * 0.32 * spin, ay = t * 0.46 * spin, ca = Math.cos(ax), sa = Math.sin(ax), cb = Math.cos(ay), sb = Math.sin(ay), shell = R * 1.32;
    var pts = ICO.v.map(function (p3, i) {
      var disp = 1 + 0.10 * Math.sin(t * 2.4 + i * 1.7) * spin + L * 0.20;
      var x = p3[0] * disp, y = p3[1] * disp, z = p3[2] * disp;
      var y1 = y * ca - z * sa, z1 = y * sa + z * ca;                 // rotate about X
      var x1 = x * cb + z1 * sb, z2 = -x * sb + z1 * cb;              // rotate about Y
      var persp = 1 / (1.9 - z2 * 0.55);
      return { x: cx + x1 * shell * persp, y: cy + y1 * shell * persp, z: z2 };
    });
    ctx.lineCap = "round";
    ICO.e.map(function (e2) { return { a: pts[e2[0]], b: pts[e2[1]], z: (pts[e2[0]].z + pts[e2[1]].z) / 2 }; })
      .sort(function (m, n) { return m.z - n.z; })                    // back-to-front
      .forEach(function (ed) {
        var depth = (ed.z + 1) / 2, hue = M.hue + (depth - 0.5) * M.spread * 2;
        ctx.strokeStyle = hsl(hue, M.sat, 55 + depth * 22 + L * 12, 0.2 + depth * 0.5);
        ctx.lineWidth = 0.8 + depth * 1.7; ctx.beginPath(); ctx.moveTo(ed.a.x, ed.a.y); ctx.lineTo(ed.b.x, ed.b.y); ctx.stroke();
      });
    pts.slice().sort(function (m, n) { return m.z - n.z; }).forEach(function (pt) {
      var depth = (pt.z + 1) / 2, rad = (1.1 + depth * 2.2) * (1 + L * 0.5), hue = M.hue + (depth - 0.5) * M.spread * 2;
      ctx.fillStyle = hsl(hue, M.sat, 70 + depth * 20, 0.35 + depth * 0.6);
      ctx.shadowColor = hsl(hue, M.sat, 65, 1); ctx.shadowBlur = 6 + depth * 10 + L * 14;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, rad, 0, 7); ctx.fill();
    });
    ctx.shadowBlur = 0;
    // thinking arc
    if (STATE.live === "thinking" && STATE.ttsLevel < 0.02) { ctx.strokeStyle = hsl(M.hue, M.sat, 82, 0.85); ctx.lineWidth = 3; var a0 = t * 3 % (Math.PI * 2); ctx.beginPath(); ctx.arc(cx, cy, R * 1.7, a0, a0 + 1.1); ctx.stroke(); }
    orbRaf = requestAnimationFrame(drawOrb);
  }
  function setLive(s) { STATE.live = s; if (capHint) capHint.textContent = ({ listening: "Listening", thinking: "Thinking", speaking: "Speaking", waking: "Waking up…" })[s] || ""; }
  function capSay(who, text) { if (who === "you") { capYou.textContent = text ? "“" + text + "”" : ""; } else { capQ.style.opacity = "0"; setTimeout(function () { capQ.textContent = text || ""; capQ.style.opacity = "1"; }, 120); } }

  var _liveGreets = ["Hey, I'm here. What's up?", "Hi! What can I do for you?", "Hey — I'm listening.", "Yes? What do you need?"];
  async function openLive() {
    if (STATE.liveOn) return;
    if (!liveEl) buildLive();
    var mode = await ensureMode();
    if (mode !== "serverless") { return activate(); }                          // no on-device model → quick one-shot
    STATE.liveOn = true; pauseWake(); STATE.live = "waking"; capSay("you", ""); capSay("q", ""); setLive("waking");
    liveEl.setAttribute("data-show", "1"); if (btn) btn.setAttribute("data-on", "1");
    unlockAudio(); warm();                                                       // gesture → prime audio + warm the models
    cancelAnimationFrame(orbRaf); drawOrb();
    liveLoop();
  }
  function closeLive() {
    STATE.liveOn = false; STATE.welcoming = false; stopSpeaking(); micClose(); cancelAnimationFrame(orbRaf);
    if (liveEl) liveEl.setAttribute("data-show", "0"); if (btn) btn.setAttribute("data-on", "0");
    STATE.busy = false; STATE.micLevel = 0; STATE.ttsLevel = 0;
    resumeWake();                                                       // re-arm the wake word if it was on before the call
  }

  // ── first-run welcome: Q greets a new visitor and tells the why / how / what of Hologram OS ────────
  // Autoplay needs one gesture, so we open with the orb gently breathing and a "Begin" invitation; the
  // first tap unlocks audio and Q speaks the welcome, then hands off to a live, hands-free conversation.
  var WELCOME = [
    "Hi — I'm Q. Welcome to Hologram OS.",
    "Most computers send your life off to someone else's servers. This one doesn't. It was built so the power stays with you.",
    "It's a whole operating system living right here in your browser — a desktop, apps, your files — with nothing to install and no account to make.",
    "And I run entirely on your device. I hear you, think, and speak without a single word ever leaving this machine.",
    "So just talk to me. Try 'open the browser', 'switch to dark mode', or ask me anything. I'm always one tap away."
  ];
  async function welcome() {
    if (STATE.liveOn) return;
    if (!liveEl) buildLive();
    try { localStorage.setItem("holo.voice.welcomed", "1"); } catch (e) {}   // show the invitation once
    STATE.liveOn = true; pauseWake(); STATE.welcoming = true; STATE.live = "welcome";
    capSay("you", ""); capQ.style.opacity = "1"; capQ.textContent = "Hi, I'm Q";
    liveSub.textContent = "Your private, on-device guide to Hologram OS"; liveSub.style.display = "block";
    beginBtn.style.display = "inline-block"; capHint.textContent = "tap begin · ✕ to skip";
    liveEl.setAttribute("data-show", "1"); if (btn) btn.setAttribute("data-on", "1");
    cancelAnimationFrame(orbRaf); drawOrb();
  }
  async function runWelcome() {
    if (!STATE.liveOn) return;
    beginBtn.style.display = "none"; liveSub.style.display = "none"; capHint.textContent = "waking up…";
    unlockAudio();                                                   // we're inside the user's tap → audio is allowed
    warm();                                                          // load ear + voice + prime the κ-cache in the background
    STATE.live = "speaking";
    for (var i = 0; i < WELCOME.length && STATE.liveOn; i++) {
      capHint.textContent = ""; capSay("q", WELCOME[i]); await speakNatural(WELCOME[i]);
      if (!STATE.liveOn) return;
      await new Promise(function (r) { setTimeout(r, 220); });
    }
    if (!STATE.liveOn) return;
    STATE.welcoming = false;
    var mode = STATE.mode || await ensureMode();
    if (mode === "serverless") liveLoop(true);                       // ear is ready → drop into a live conversation
    else { setLive("idle"); capSay("q", "I'm always a tap away."); }  // no on-device ear yet → leave the invitation
  }
  var STOP_RE = /^(stop|exit|quit|cancel|never mind|nevermind|good ?bye|bye|that's all|thats all|thank you that's all|i'm done|im done|see you)\b/;
  // A turn where Q talks AND can be cut off. Speaks `say` (string) or runs `converse` (an agent turn),
  // watching the mic the whole time; if the user barges in, Q goes quiet and we grab what they're saying
  // straight away (preSpoke) so nothing is lost. Returns the next utterance's audio, or null.
  async function speakTurn(opts) {
    setLive("speaking");
    var ctl = { aborted: false }, activity;
    if (opts.converse) { activity = converseAgent(opts.text, ctl).then(function (r) { capSay("q", r && r.reply ? r.reply : ""); }); }
    else { capSay("q", opts.say); activity = speakNatural(opts.say); }
    var who = await speakListening(activity, ctl);
    if (who === "barge") { setLive("listening"); return micCapture({ preSpoke: true, onsetGraceMs: 1500 }); }
    return null;
  }
  async function liveLoop(skipGreet) {
    var haveMic = await micOpen().then(function () { return true; }).catch(function () { return false; });
    try {
      var pending = null;                                              // audio already captured via a barge-in
      if (!skipGreet) { var greet = _liveGreets[Math.floor(Math.random() * _liveGreets.length)]; pending = await speakTurn({ say: greet }); }
      var empties = 0;
      while (STATE.liveOn) {
        var text;
        if (haveMic) { setLive("listening"); STATE.busy = true; text = await captureTurn(pending); pending = null; STATE.busy = false; }   // adaptive endpoint + turn-completion veto (+ barge seed)
        else { setLive("listening"); STATE.busy = true; turnStart(); text = await recognize(); tmark("transcript"); STATE.busy = false; }   // no persistent mic → one-shot
        if (!STATE.liveOn) break;
        if (!STATE.liveOn) break;
        if (!text) { _turn = null; if (++empties >= 3) { setLive("speaking"); var idle = "I'm here whenever you need me."; capSay("q", idle); await speakNatural(idle); break; } continue; }
        empties = 0; capSay("you", text);
        if (STOP_RE.test(norm(text))) { _turn = null; setLive("speaking"); var bye = "Talk soon."; capSay("q", bye); await speakNatural(bye); break; }
        setLive("thinking");
        // 1. resolve a pending PROPOSAL: is this turn your approval or refusal?
        if (STATE.pending) {
          if (isAffirm(text)) { var pa = STATE.pending; STATE.pending = null; try { pa.exec && pa.exec(); } catch (e) {} pending = await speakTurn({ say: pa.say || "Done." }); turnEnd(); continue; }
          if (isNegate(text)) { STATE.pending = null; pending = await speakTurn({ say: "Okay, I'll leave it." }); turnEnd(); continue; }
          STATE.pending = null;                                        // a new topic → drop the proposal, handle this turn fresh
        }
        var res = route(text, true);                                   // classify WITHOUT acting (converse-first)
        if (res && res.exec && res.ok) {                               // an actionable plan
          if (CFG.confirmActions) { STATE.pending = res; pending = await speakTurn({ say: res.propose || ("Want me to " + (res.say || "do that").replace(/\.$/, "").toLowerCase() + "?") }); }   // PROPOSE, await your OK
          else { try { res.exec(); } catch (e) {} pending = await speakTurn({ say: res.say || "Done." }); }                                                                                       // immediate mode
        } else if (res && res.converse) {
          if (!CFG.confirmActions) {                                   // immediate mode may act in the background; confirm mode stays pure conversation
            mindObserve(res.text || text);
            var appReply = await tryAppCommand(res.text || text);
            if (appReply != null) { pending = await speakTurn({ say: appReply }); turnEnd(); continue; }
          }
          pending = await speakTurn({ converse: true, text: res.text || text });
        } else pending = await speakTurn({ say: (res && res.say) || "I didn't catch that." });   // e.g. "couldn't find that app"
        turnEnd();
      }
    } catch (e) { console.warn("[HoloVoice] live loop:", e && e.message || e); }
    finally { micClose(); if (STATE.liveOn) closeLive(); }
  }

  // ── hotkey: Alt+V (via HoloKeys if present, else a direct listener) ──────────────────────────────
  function wireHotkey() {
    try {
      if (W.HoloKeys && typeof W.HoloKeys.bind === "function") {
        W.HoloKeys.bind("alt+v", activate, { id: "voice.activate", title: "Voice command", group: "Voice", global: true });
        return;
      }
    } catch (e) {}
    DOC.addEventListener("keydown", function (e) { if (e.altKey && (e.key === "v" || e.key === "V") && !e.repeat) { e.preventDefault(); activate(); } });
  }

  function start() {
    if (!DOC.body) { setTimeout(start, 30); return; }
    mount(); wireHotkey(); bindSeam(); mountMCP(); wireMindOrb();   // expose Q's tools to Holo Mind + make its actions visible on the orb
    // resume the wake word if the user left it on (will prompt for the mic, since they opted in).
    try { if (localStorage.getItem("holo.voice.wake") === "1") setTimeout(startWake, 800); } catch (e) {}
    // first-run welcome: a new visitor is greeted by Q. Skipped on shared deep links (?app=/?open=/?run=)
    // so a shared holospace runs instantly, and shown only once (the gesture sets the 'welcomed' flag).
    try {
      var pq = new URLSearchParams(location.search), deep = pq.has("app") || pq.has("open") || pq.has("run");
      if (!deep && !localStorage.getItem("holo.voice.welcomed")) setTimeout(welcome, 1400);
    } catch (e) {}
  }
  if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", start); else start();

  // ── simplicity: ONE word swaps the whole feel, so nobody touches the ~two dozen low-level knobs. ──
  // The default ("natural") IS the full magical experience out of the box — zero config, just tap & talk.
  var PRESETS = {
    natural: { turnSilenceMs: 250, turnContinueMs: 600, backchannel: true, backchannelChance: 0.55, stream: true, mind: true, mindSpeak: true, confirmActions: true },   // default: converse first, ask before acting
    snappy:  { turnSilenceMs: 200, turnContinueMs: 450, backchannel: false, stream: true, mind: true, mindSpeak: true, confirmActions: false },                          // fast, acts immediately
    calm:    { turnSilenceMs: 350, turnContinueMs: 800, backchannel: true, backchannelChance: 0.85, stream: true, mind: true, mindSpeak: true, confirmActions: true },   // patient, very attentive
    minimal: { backchannel: false, mind: false, mindSpeak: false, proactive: false, confirmActions: false },                                                            // plain voice control, immediate
  };
  function preset(name) { var p = PRESETS[name]; if (!p) return null; Object.assign(CFG, p); return name; }

  // ── public API ──────────────────────────────────────────────────────────────────────────────────
  W.HoloVoice = {
    version: "0.19",
    preset: preset,                       // preset("natural"|"snappy"|"calm"|"minimal") — the whole feel in one word
    turnComplete: turnComplete,           // is this utterance semantically done? (adaptive endpoint scorer)
    metrics: function () { return LAST_METRICS; },                     // last turn's latency breakdown (ms from end-of-speech)
    tune: function (p) { Object.assign(CFG, p || {}); return Object.assign({}, CFG); },   // live-tune turn-taking/barge-in, no reload
    levels: function () { return { mic: STATE.micLevel, tts: STATE.ttsLevel, live: STATE.live, liveOn: STATE.liveOn }; },   // live meters (for calibration)
    welcome: welcome,                      // first-run greeting: Q tells the why / how / what (replayable)
    live: openLive, endLive: closeLive,   // the magical voice-to-voice conversation overlay
    activate: activate,                    // quick one-shot push-to-talk (Alt+V)
    speak: function (t, o) { return (W.HoloQVAC && W.HoloQVAC.textToSpeech) ? W.HoloQVAC.textToSpeech({ text: t }).catch(function () { return speak(t, o); }) : speak(t, o); },
    converse: converseAgent,
    route: route,                         // run a voice command (deterministic OS actions, native calls)
    tools: buildTools,                    // the live agent tool surface (built from the app catalog)
    exec: execTool,                       // execute one tool call natively (open_app/set_theme/…)
    callApp: callApp,                     // drive the OPEN app: callApp(name, params) → app's result (in-app task bridge)
    appCommands: appCommands,             // discover what the open app exposes (its registerCommand names)
    mind: function () { return W.HoloMind || null; },                 // the OS-wide orchestrator Q is wired into (ADR-0081)
    orchestrate: function (intents) { return (W.HoloMind && W.HoloMind.orchestrate) ? W.HoloMind.orchestrate(intents) : Promise.reject(new Error("Holo Mind not present")); },   // run sub-agents in parallel
    schedule: function (utterance, everyMs) { if (!W.HoloMind || !W.HoloMind.schedule) return Promise.reject(new Error("Holo Mind not present")); setProactive(true); return W.HoloMind.schedule({ utterance: utterance, everyMs: everyMs || null }); },   // schedule a spoken task
    proactive: setProactive,              // proactive(true) — Q voices the orchestrator's scheduled/proactive actions
    mindTick: mindTick,                   // fire due scheduled tasks now + speak them
    teach: teach,                         // teach a correction: teach("hollow browser","holo browser") — learns your voice
    forget: function (m) { m = norm(m); if (PROFILE.corrections[m]) { delete PROFILE.corrections[m]; saveProfile(); return true; } return false; },
    profile: function () { return { turns: PROFILE.turns, vocab: Object.keys(PROFILE.vocab).length, corrections: Object.assign({}, PROFILE.corrections), topApps: Object.keys(PROFILE.usage).sort(function (a, b) { return PROFILE.usage[b] - PROFILE.usage[a]; }).slice(0, 8) }; },
    resetVoice: function () { PROFILE = { vocab: {}, corrections: {}, usage: {}, seen: {}, turns: 0 }; saveProfile(); return true; },
    recognize: recognize,
    matchApp: matchApp,
    setEngine: setEngine,                 // setEngine(true|false) → WebGPU 1.5B vs WASM 0.5B (persisted)
    testWebGPU: testWebGPU,               // real-hardware self-check; auto-reverts on garbage output
    startWake: startWake, stopWake: stopWake,  // hands-free wake word, serverless + persisted
    setWakeWord: setWakeWord,             // rename the assistant ("Q" by default); persisted
    setVoice: setVoice, voices: VOICES,   // Q's neural voice (Kokoro); persisted
    say: speakNatural,                    // speak text in Q's natural voice (Kokoro → speechSynthesis)
    settings: toggleMenu,                 // open the engine settings popover
    config: function () { return Object.assign({}, CFG, { mode: STATE.mode }); },
    state: function () { return { mode: STATE.mode, listening: STATE.busy, lastText: STATE.lastText, lastAction: STATE.lastAction }; },
  };
})();
