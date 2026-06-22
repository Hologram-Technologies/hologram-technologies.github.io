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
    turnDetect: true, turnSilenceMs: 250, turnSilenceDone: 130, turnContinueMs: 600, turnModel: false, turnThreshold: 0.55,   // adaptive turn-taking: snap at turnSilenceDone when the thought reads COMPLETE, hold to turnSilenceMs when mid-thought
    stream: true, streamPartialMs: 300,   // streaming ASR — recognize WHILE you talk (off → buffered). Tight cadence so words paint in near-real-time; the serialised partialBusy guard self-throttles when a transcribe is still in flight.
    vad: true, vadThreshold: 0.35,   // sovereign pure-ONNX stage-1 wake gate (Silero VAD on the bundled ORT). ON by default — seamless: it warms when hands-free wake starts, fails closed to energy-VAD if the model isn't vendored. Threshold biased LOW so a real "Q" is never gated out (a false-positive just costs one Whisper run that WAKE.re then rejects; a missed wake is far worse)
    mind: true, mindSpeak: true, proactive: false, proactiveGoals: false,   // Holo Mind: orchestrate · speak-back · proactive
    backchannel: true, backchannelGain: 0.4, backchannelChance: 0.55, backchannelMinMs: 2600,   // soft "mm-hmm" while you talk
    confirmActions: true,   // converse first; PROPOSE every action and wait for your OK before doing it
    karaoke: true, clauseCache: true,   // karaoke caption + clause-grained κ-cache (higher hit-rate)
    gpuBrain: false,   // OPT-IN: prefer the ternary qwen-coder-7b GPU brain (ADR-0096) when WebGPU works; WASM Coder-1.5B is the any-browser floor
    holoUpgrade: true,   // SILENT 0.5B→1.5B .holo upgrade: ON — the 1.5B is forged + κ-wired (ea732336…) + chunked-warm (body-async load, lm_head chunked); guarded WebGPU-only + non-metered + tier-2 background (0.5B stays bound until 1.5B is ready, never blocks a turn)
    // κ-native Holo GGUF "ear": when WebGPU works, run Moonshine 100% on the κ-substrate — weights κ-streamed
    // from the .holo (HTTP-Range + per-block L5 + OPFS), GPU encoder-decoder forward, no ONNX. Same cross-mount
    // pattern as Q's .holo brain (/apps/q/forge/*). Self-gates on WebGPU and transparently falls back to the
    // transformers/ONNX ear; set to null to force ONNX. κ = sha256 of the .holo (for the static/IPFS κ-route).
    knativeEar: { module: "/apps/q/forge/gpu/holo-moonshine-ear.mjs",
      holoUrl: "/apps/q/forge/.models/moonshine-tiny-int8.holo", kappa: "bbd89df22c86fc54455779be070395cc8dab0c3438cbe85974c9f02d2a291780", release: "https://github.com/Hologram-Technologies/hologram-apps/releases/download/models-v1/moonshine-tiny-int8.holo",
      upgradeUrl: "/apps/q/forge/.models/moonshine-tiny-f16.holo", upgradeKappa: "ff7e1c8b3c9e360ab062ce96a297e6f2467608c634f2e4b171078180056a72d8", upgradeRelease: "https://github.com/Hologram-Technologies/hologram-apps/releases/download/models-v1/moonshine-tiny-f16.holo" },   // resolve: path(dev) → Release asset(prod) → κ-route(IPFS), all per-block L5-verified
    // κ-served voice: serve Kokoro's ONNX files from kokoro-82m.holo (Range + per-block L5 + OPFS + serverless
    // multi-source) into the same engine — content-addressed delivery, no engine change. Transparently falls
    // back to the vendored ONNX on any failure; set to null to force the vendored path. Resolved via the one
    // mux/faculty bridge below (κ unchanged when unbound), exactly like the "listen" ear.
    knativeVoice: { module: "/apps/q/forge/gpu/holo-onnx-kserve.mjs",
      holoUrl: "/apps/q/forge/.models/kokoro-82m.holo", kappa: "a528332cbe262333c3eef76f581add5de8cd2d54b81c7685914353ad016ff1e5", release: "https://github.com/Hologram-Technologies/hologram-apps/releases/download/models-v1/kokoro-82m.holo" } },
    W.HOLO_VOICE_CONFIG || {});   // turn-taking + barge-in (tune on real HW)
  // persisted user toggles override config: the agent brain runs on WebGPU (1.5B, fast on a real GPU)
  // or the WASM floor (0.5B, any browser); and the wake word (its name) is whatever you choose.
  try { var _pref = localStorage.getItem("holo.voice.webgpu"); if (_pref === "1") CFG.preferWebGPU = true; else if (_pref === "0") CFG.preferWebGPU = false; } catch (e) {}
  try { var _ww = localStorage.getItem("holo.voice.wakeword"); if (_ww) CFG.wakeWord = _ww; } catch (e) {}
  try { var _gb = localStorage.getItem("holo.voice.gpubrain"); if (_gb === "1") CFG.gpuBrain = true; else if (_gb === "0") CFG.gpuBrain = false; } catch (e) {}
  try { var _vc = localStorage.getItem("holo.voice.voice"); if (_vc) CFG.voice = _vc; } catch (e) {}

  var STATE = { mode: null, busy: false, listening: false, asr: null, lastText: "", lastAction: null,
    liveOn: false, live: "idle", welcoming: false, micLevel: 0, ttsLevel: 0, mindPulse: 0, wakePulse: 0, pending: null };   // live = idle|listening|thinking|speaking|welcome ; mindPulse = Mind flare ; wakePulse = "I heard 'Q'" flare ; pending = a proposed action awaiting your OK

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
  var _ttsAC = null, _ttsAn = null, _ttsBuf = null, _ttsRaf = 0, _playCursor = 0, _queueSrcs = [], _activeSpeaker = null, _voiceFx = null, _voiceLibP = null;
  function ensureAC() {
    var AC = W.AudioContext || W.webkitAudioContext;
    if (!_ttsAC) {
      _ttsAC = new AC(); _ttsAn = _ttsAC.createAnalyser(); _ttsAn.fftSize = 512; _ttsBuf = new Uint8Array(_ttsAn.fftSize);
      // Route Q's voice through the Holo Audio engine so it sounds natural and PRESENT — as if a real
      // persona in the room. The analyser still feeds the orb; the engine sits between it and the speakers.
      _voiceFx = attachVoiceFx(_ttsAC, _ttsAn);
      if (!_voiceFx) { _ttsAn.connect(_ttsAC.destination); loadHoloAudioLib(); }   // fallback direct + warm the lib for next time
    }
    return _ttsAC;
  }
  // The engine lib is a tiny shared script (window.HoloAudio); pull it once so it's ready by first speech.
  function loadHoloAudioLib() {
    if (W.HoloAudio) return Promise.resolve(W.HoloAudio);
    if (_voiceLibP) return _voiceLibP;
    _voiceLibP = new Promise(function (resolve) {
      try { var s = DOC.createElement("script"); s.src = "/_shared/holo-audio.js"; s.defer = true; s.setAttribute("data-holo-ephemeral", "");
        s.onload = function () { resolve(W.HoloAudio || null); }; s.onerror = function () { resolve(null); }; (DOC.head || DOC.documentElement).appendChild(s); }
      catch (e) { resolve(null); }
    });
    return _voiceLibP;
  }
  // The "in the room" voice profile: natural presence EQ + gentle leveling (Voice preset) + a touch of room.
  // Centered (no HRTF panning — an assistant should speak to you, not from beside you). Honest: this shapes
  // the synthesized voice for presence; true human realism comes from the voice model itself.
  function attachVoiceFx(ac, an) {
    try {
      if (!W.HoloAudio || !W.HoloAudio.createForSource) return null;
      var fx = W.HoloAudio.createForSource(ac, an);            // an → engine → ac.destination
      if (!fx || !fx.ok) return null;
      try { fx.setPreset("Voice"); } catch (e) {}
      try { if (fx.setRoom) fx.setRoom(0.12); } catch (e) {}   // a touch of room — present, not reverby
      try { if (fx.canSpatial) fx.setSpatial(false); } catch (e) {}
      return fx;
    } catch (e) { return null; }
  }
  function meter() {
    if (!_ttsAn) { _ttsRaf = 0; return; }
    _ttsAn.getByteTimeDomainData(_ttsBuf); var m = 0;
    for (var i = 0; i < _ttsBuf.length; i++) { var v = Math.abs((_ttsBuf[i] - 128) / 128); if (v > m) m = v; }
    if (_queueSrcs.length) { STATE.ttsLevel = m; _ttsRaf = requestAnimationFrame(meter); } else { STATE.ttsLevel = 0; _ttsRaf = 0; }
  }
  function startMeter() { if (!_ttsRaf) _ttsRaf = requestAnimationFrame(meter); }
  // The READING form of a spoken line: clean typography for the caption (the spoken string is NEVER
  // touched — only what we show). A spaced dash is a pause, not a glyph to read, so it becomes a comma;
  // we never display a dash as a separator. Word-internal compounds (on-device) keep their hyphen.
  function captionText(s) {
    return String(s == null ? "" : s)
      .replace(/\s+[—–-]+\s+/g, ", ")   // " — " / " – " / " - " (dash used as a pause) → comma
      .replace(/\s*,(\s*,)+/g, ",")     // collapse accidental double commas
      .replace(/\s+,/g, ",")            // " ," → ","
      .replace(/\s{2,}/g, " ")          // collapse runs of spaces
      .trim();
  }
  // ── CAPTION: a single-row "karaoke ribbon" that the voice scrolls through ───────────────────────────
  // One line, no wrapping. The word being spoken is held at a FIXED point — the centre of the strip — and
  // the whole row glides left so each new word lands on that same playhead. Upcoming words wait to the right
  // and fade in through a soft edge-mask; spoken words drift left and fade out. Motion is driven by the
  // AudioContext clock (never ahead of the voice) and low-pass smoothed so it never snaps — calm, steady,
  // easy to follow. captionText() cleaning + syllable-weighted word times are unchanged.
  var _capReduce = !!(W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches);   // honor reduced-motion
  var _karaWords = [], _karaRaf = 0, _capMaxAt = 0;                    // the scheduled words {w, at, el, c=centre}, in audio order
  var _track = null, _capCur = null, _trackX = null;                 // the sliding row, the lit word, the current (smoothed) translateX in px
  var _capSpeaker = null, _userWords = [];                          // who owns the ribbon now ('q'|'user'|null) ; the user's live words {w, el}
  // CALM caption (welcome): when on, captions render ONE sentence at a time — centred, wrapped, still — with
  // no scroll and no upcoming text, instead of the streaming ribbon. Easy + unhurried for a first impression.
  var _calmCaption = false, _sentRaf = 0, _sentences = [], _sentIdx = -1, _sentEls = null, _sentClipEnd = 0;
  function karaSyll(w) {                                                 // rough syllable estimate: count vowel groups
    var m = String(w).toLowerCase().replace(/[^a-z]+/g, "").match(/[aeiouy]+/g);
    return Math.max(1, m ? m.length : 1);
  }
  function karaStop() { if (_karaRaf) { cancelAnimationFrame(_karaRaf); _karaRaf = 0; } }   // halt the scroll loop
  function ensureTrack() {
    if (!capQ) return null;
    if (_capReduce) capQ.classList.add("hl-reduce");                    // accessibility: no horizontal motion
    if (!_track) { _track = DOC.createElement("div"); _track.className = "hl-track"; capQ.appendChild(_track); }
    return _track;
  }
  // append one word to the row (calm + dim by default). No entrance animation — the mask + scroll reveal it.
  function capAddWord(text, at) {
    if (!ensureTrack()) return;
    var sp = DOC.createElement("span"); sp.className = "hl-w"; sp.textContent = text;
    _track.appendChild(sp); _karaWords.push({ w: text, at: at, el: sp, c: -1 }); if (at > _capMaxAt) _capMaxAt = at;
  }
  // light exactly the word under the playhead; everyone else stays calm and dim.
  function capHighlight(el) {
    if (el && el !== _capCur) { if (_capCur) _capCur.classList.remove("hl-cur"); el.classList.add("hl-cur"); _capCur = el; }
  }
  function karaReset() {                                                 // a new utterance → gently fade the old row out, reset the scroll
    karaStop(); clearSentences(); _karaWords = []; _userWords = []; _capCur = null; _capMaxAt = 0; _trackX = null; _capSpeaker = null;
    if (_track) { var old = _track; old.classList.add("hl-leave"); setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 360); }   // absolute + fade → it dissolves in place while the next row builds
    _track = null; if (capQ) capQ.style.opacity = "1";
  }
  function karaClear() { karaStop(); }   // stop the scroll, leave the row where it is
  // who owns the ribbon now — Q (warm) or the user (cool). A data-speaker attr restyles the row so it's
  // obvious at a glance who's talking; they never speak at once, so they share the one centre-parked strip.
  function capSpeakerAttr(who) { if (who !== _capSpeaker) { _capSpeaker = who; _userWords = []; if (capQ) capQ.setAttribute("data-speaker", who || ""); } }
  // measure each word's centre once (relative to the track), so the maths stays stable as more append right
  function karaMeasure(list) { for (var m = 0; m < list.length; m++) { var wd = list[m]; if (wd.c < 0 && wd.el.offsetParent !== null) wd.c = wd.el.offsetLeft + wd.el.offsetWidth / 2; } }
  // where the row WANTS to be centred + which word to light. Q follows the audio clock (interpolated between
  // the current word and the next for a continuous glide); the user's target is simply the newest heard word.
  function karaTarget() {
    if (_capSpeaker === "user") { if (!_userWords.length) return null; var u = _userWords[_userWords.length - 1]; return { c: u.c, el: u.el }; }
    if (!_karaWords.length || !_ttsAC) return null;
    var now = _ttsAC.currentTime, ai = 0, i;
    for (i = 0; i < _karaWords.length; i++) { if (_karaWords[i].at <= now) ai = i; else break; }   // active = last word the voice has reached
    var a = _karaWords[ai], b = _karaWords[ai + 1], tc = a.c;
    if (b && b.c >= 0 && a.c >= 0) { var sp = b.at - a.at, f = sp > 0 ? Math.max(0, Math.min(1, (now - a.at) / sp)) : 0; tc = a.c + (b.c - a.c) * f; }
    return { c: tc, el: a.el };
  }
  // THE SMOOTH RIDE: one continuous loop low-pass-smooths the row toward its target, so the live word GLIDES
  // to the centre playhead instead of snapping — no jerk. It never runs ahead of its source (audio for Q, the
  // recognised tail for the user); a late frame just catches up. Words fade in/out through the edge mask.
  function karaPump() {
    _karaRaf = 0; if (!capQ || !_track) return;
    karaMeasure(_capSpeaker === "user" ? _userWords : _karaWords);
    var t = karaTarget(); if (!t) return;
    capHighlight(t.el);
    var more = (_capSpeaker !== "user") && _ttsAC && _karaWords.length && (_ttsAC.currentTime < _capMaxAt + 0.05);   // Q keeps ticking while audio plays
    if (_capReduce || !(t.c >= 0)) { if (more || !(t.c >= 0)) _karaRaf = requestAnimationFrame(karaPump); return; }
    var target = capQ.clientWidth / 2 - t.c;
    _trackX = (_trackX == null) ? target : _trackX + (target - _trackX) * 0.38;   // one-pole smoother → glides in ~0.18s then rests: smooth, not laggy, not a snap
    _track.style.transform = "translate3d(" + _trackX.toFixed(2) + "px,0,0)";
    if (more || Math.abs(target - _trackX) > 0.4) _karaRaf = requestAnimationFrame(karaPump);   // settle, then rest
  }
  function capStart() { if (!_karaRaf) _karaRaf = requestAnimationFrame(karaPump); }
  // SCHEDULE a spoken clip's words: clean → syllable-weighted times → drop them on the row in audio order.
  function karaChunk(text, startAtSec, durSec) {
    if (CFG.karaoke === false || !capQ || !_ttsAC) return;
    var words = captionText(text).split(/\s+/).filter(Boolean); if (!words.length) return;   // the CLEAN reading form
    capSpeakerAttr("q");                                                 // Q taking the ribbon (warm)
    var dur = durSec > 0 ? durSec : words.length * 0.32;
    var weights = words.map(karaSyll), total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    if (!(total > 0)) { for (i = 0; i < weights.length; i++) weights[i] = 1; total = weights.length; }   // degenerate → uniform
    var acc = 0;
    for (i = 0; i < words.length; i++) { capAddWord(words[i], startAtSec + (acc / total) * dur); acc += weights[i]; }   // start of the word's slice → never ahead of the audio
    capStart();
  }
  // ── CALM sentence-at-a-time caption (welcome only) ──────────────────────────────────────────────────
  // Instead of the scrolling ribbon, show ONE sentence at a time: centred, wrapped, perfectly still, with the
  // word under the voice gently lit. On a sentence boundary the line dissolves and the next fades up — no
  // upcoming text, nothing streaming past. Same audio clock + syllable timing, just unhurried and delightful.
  function clearSentences() { if (_sentRaf) { cancelAnimationFrame(_sentRaf); _sentRaf = 0; } _sentences = []; _sentIdx = -1; _sentEls = null; }
  function splitSentences(text) {
    var parts = String(text == null ? "" : text).match(/[^.!?]+[.!?]*/g);   // keep each sentence WITH its ender
    return (parts || [String(text || "")]).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function karaSentences(text, startAtSec, durSec) {
    if (!capQ || !_ttsAC) return;
    capSpeakerAttr("q"); capQ.style.opacity = "1";
    var sents = splitSentences(captionText(text)); if (!sents.length) return;
    var syl = function (s) { return s.split(/\s+/).filter(Boolean).reduce(function (a, w) { return a + karaSyll(w); }, 0); };
    var sw = sents.map(syl), total = 0, i; for (i = 0; i < sw.length; i++) total += sw[i]; if (!(total > 0)) total = 1;
    var dur = durSec > 0 ? durSec : sents.join(" ").split(/\s+/).filter(Boolean).length * 0.32;
    _sentClipEnd = startAtSec + dur;
    var acc = 0, list = [];
    for (i = 0; i < sents.length; i++) {
      var st = startAtSec + (acc / total) * dur; acc += sw[i]; var en = startAtSec + (acc / total) * dur;   // this sentence's audio window
      var words = sents[i].split(/\s+/).filter(Boolean);
      var ws = words.map(karaSyll), wt = 0, j; for (j = 0; j < ws.length; j++) wt += ws[j]; if (!(wt > 0)) wt = 1;
      var wacc = 0, wtimes = []; for (j = 0; j < words.length; j++) { wtimes.push(st + (wacc / wt) * (en - st)); wacc += ws[j]; }   // per-word onset within the sentence
      list.push({ start: st, words: words, wtimes: wtimes });
    }
    _sentences = list; _sentIdx = -1; sentPump();
  }
  function mountSentence(idx) {                                         // dissolve the current sentence, build + fade in the next (centred, wrapped, still)
    if (_track) { var old = _track; old.style.animation = "none"; old.classList.add("hl-leave"); setTimeout(function () { if (old.parentNode) old.parentNode.removeChild(old); }, 360); }
    _capCur = null;
    var tr = DOC.createElement("div"); tr.className = "hl-track"; var words = _sentences[idx].words, els = [];
    for (var i = 0; i < words.length; i++) { var sp = DOC.createElement("span"); sp.className = "hl-w"; sp.textContent = words[i]; tr.appendChild(sp); els.push(sp); }
    capQ.appendChild(tr); _track = tr; _sentEls = els;
  }
  function sentPump() {
    _sentRaf = 0; if (!capQ || !_sentences.length || !_ttsAC) return;
    var now = _ttsAC.currentTime, idx = 0, i;
    for (i = 0; i < _sentences.length; i++) { if (_sentences[i].start <= now) idx = i; else break; }   // the sentence the voice is in
    if (idx !== _sentIdx) { mountSentence(idx); _sentIdx = idx; }
    var s = _sentences[idx], wi = 0; for (i = 0; i < s.wtimes.length; i++) { if (s.wtimes[i] <= now) wi = i; else break; }   // light the word under the playhead
    if (_sentEls && _sentEls[wi]) capHighlight(_sentEls[wi]);
    if (_ttsAC.currentTime < _sentClipEnd + 0.05) _sentRaf = requestAnimationFrame(sentPump);   // keep ticking while this clip still plays
  }
  // STATIC render (no audio clock): the speechSynth floor + one-off captions lay the cleaned line on the row,
  // centred as a whole, last word lit — same component, so every caption path looks identical.
  function captionShow(text) {
    if (!capQ) return; karaReset(); capSpeakerAttr("q"); capQ.style.opacity = "1";
    var words = String(text == null ? "" : text).split(/\s+/).filter(Boolean);
    for (var i = 0; i < words.length; i++) capAddWord(words[i], 0);
    if (!_karaWords.length) return;
    capHighlight(_karaWords[_karaWords.length - 1].el);
    if (_capReduce || !_track) return;
    requestAnimationFrame(function () {                                  // centre the whole line on the playhead once laid out (static, no clock)
      if (!_track || !capQ) return;
      _trackX = (capQ.clientWidth - _track.offsetWidth) / 2; _track.style.transform = "translate3d(" + _trackX.toFixed(2) + "px,0,0)";
    });
  }
  // USER live transcription → the SAME ribbon. Partials arrive a few times a second and get REFINED, so we
  // DIFF: keep the unchanged prefix, rewrite the diverged tail, append new words; the newest word parks on
  // the centre playhead (the same fixed highlight Q uses), earlier words stream left. No audio clock here —
  // the latest recognised word IS the "current" one. Crossing from Q wipes Q's row first.
  function capUserText(text) {
    if (!capQ) return;
    if (_capSpeaker !== "user") karaReset();                            // came from Q (or empty) → fade that out first
    capSpeakerAttr("user"); ensureTrack();
    var words = String(text == null ? "" : text).split(/\s+/).filter(Boolean);
    var i = 0; for (; i < _userWords.length && i < words.length; i++) { if (_userWords[i].w !== words[i]) break; }   // shared prefix
    for (var j = _userWords.length - 1; j >= i; j--) { var rm = _userWords.pop(); if (rm.el.parentNode) rm.el.parentNode.removeChild(rm.el); }   // drop the revised tail
    for (; i < words.length; i++) { var sp = DOC.createElement("span"); sp.className = "hl-w"; sp.textContent = words[i]; _track.appendChild(sp); _userWords.push({ w: words[i], el: sp, c: -1 }); }
    if (!_userWords.length) return;
    capHighlight(_userWords[_userWords.length - 1].el);   // light the live edge; the loop glides it to centre
    capStart();
  }
  function capClear() { karaReset(); }   // empty the ribbon — the listening state (the orb, not text, says "I'm listening")
  // BARGE-IN: Q yields. Its words shrink + fade deferentially; the orb's flip to the listening palette does the rest.
  function capBargeAck() { if (_track) _track.classList.add("hl-yield"); }
  // schedule a clip to play immediately AFTER whatever is already queued (gapless). Resolves on its end.
  // `text` (optional) is revealed in capQ in sync with THIS clip's playback (karaoke).
  function enqueuePCM(float32, rate, text) {
    try {
      var ac = ensureAC(); if (ac.state === "suspended" && ac.resume) ac.resume();
      var b = ac.createBuffer(1, float32.length, rate); b.getChannelData(0).set(float32);
      var s = ac.createBufferSource(); s.buffer = b; s.connect(_ttsAn);
      var startAt = Math.max(ac.currentTime + 0.01, _playCursor || 0);
      s.start(startAt); _playCursor = startAt + b.duration; _queueSrcs.push(s); startMeter(); tmark("firstAudio");
      if (text) { if (_calmCaption) karaSentences(text, startAt, b.duration); else karaChunk(text, startAt, b.duration); }   // caption follows the audio, never races ahead (calm = one sentence at a time)
      return new Promise(function (res) { s.onended = function () { var i = _queueSrcs.indexOf(s); if (i >= 0) _queueSrcs.splice(i, 1); res(); }; });
    } catch (e) { return Promise.reject(e); }
  }
  // single-shot play: interrupt anything in flight, then play this clip (used by one-off speakNatural).
  function playPCM(float32, rate, text) { stopSpeaking(); return enqueuePCM(float32, rate, text); }
  function stopSpeaking() {
    if (_activeSpeaker) { try { _activeSpeaker.abort(); } catch (e) {} _activeSpeaker = null; }
    _queueSrcs.splice(0).forEach(function (s) { try { s.onended = null; s.stop(); } catch (e) {} });
    _playCursor = 0; karaClear(); if (_sentRaf) { cancelAnimationFrame(_sentRaf); _sentRaf = 0; } try { W.speechSynthesis && W.speechSynthesis.cancel(); } catch (e) {}
    cancelAnimationFrame(_ttsRaf); _ttsRaf = 0; STATE.ttsLevel = 0;
  }
  // create + resume the audio graph inside a user gesture so playback isn't blocked by autoplay policy.
  function unlockAudio() { try { var ac = ensureAC(); if (ac.state === "suspended" && ac.resume) ac.resume(); } catch (e) {} }

  // κ-memo: a content-addressed cache of synthesised phrases. Key = voice ⊕ text (the content address /
  // κ pre-image); bounded LRU so it can't grow without limit. A hit is an O(1) replay — no model run.
  var _pcmCache = new Map(), _PCM_MAX = 160;   // holds the prewarmed openers/acks + a window of recent clauses
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
        if (cached) { tail = enqueuePCM(cached.audio, cached.rate, text); return; }
        try {
          var t = await ensureTTS();
          if (!aborted && t && t.engine) {
            var a = await synthLocked(function () { return t.engine.synth(text, { voice: voice }); });
            if (aborted) return;
            if (a && a.audio) { putPhrasePCM(text, voice, a.audio, a.sampling_rate || 24000); tail = enqueuePCM(a.audio, a.sampling_rate || 24000, text); return; }
          }
        } catch (e) {}
        if (!aborted && CFG.karaoke !== false && capQ) captionShow(captionText(text));   // speechSynth floor → no audio clock, show the cleaned line through the same component
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
          // CANONICAL WIRING (ADR-0084): let the one settings picker route the "speak" faculty. Resolve the
          // active model via the holo-q-mux bridge — honor a pinned/override choice, fail SAFE to the hardcoded
          // knativeVoice default (κ unchanged when unbound). Lazy + off the boot path (runs on first speak).
          var kv = CFG.knativeVoice;
          try {
            var fmv = await import(BASE + "voice/holo-q-faculty-models.mjs");
            var rfv = fmv.resolveFacultyModel && fmv.resolveFacultyModel("speak");
            if (rfv && rfv.instant && kv) kv = Object.assign({}, kv, { holoUrl: rfv.instant.url, kappa: rfv.instant.kappa, release: rfv.instant.release });
          } catch (e) {}
          var m = await import(BASE + "voice/holo-voice-tts.mjs");
          var engine = (m.createTTS || m.default)({ voice: CFG.voice, preferWebGPU: CFG.preferWebGPU, knativeVoice: kv });   // κ-served Kokoro from the .holo (falls back to vendored ONNX on any failure)
          await engine.load(function () {});   // load SILENTLY — the baked welcome covers first run + the built-in voice covers any gap, so the model warms invisibly (the orb is the only cue; never a "loading" label)
          _tts = { engine }; return _tts;
        } catch (e) { console.warn("[HoloVoice] neural voice unavailable (run tools/vendor-voice-model.mjs) — using built-in voice:", e && e.message || e); return null; }
        finally { _ttsLoading = null; }
      })();
    }
    return _ttsLoading;
  }
  async function speakNatural(text, o) {
    o = o || {}; if (!text) return { ok: false, runtime: "none" }; var voice = o.voice || CFG.voice;
    var kara = o.kara !== false; if (kara) karaReset();                 // a new spoken line → fresh karaoke caption
    var cached = getPhrasePCM(text, voice);                            // κ-memo hit → O(1) replay, no synth
    if (cached) { try { if (W.speechSynthesis) W.speechSynthesis.cancel(); } catch (e) {} await playPCM(cached.audio, cached.rate, kara ? text : null); return { ok: true, runtime: "kokoro-memo" }; }
    try {
      var t = await ensureTTS();
      if (t && t.engine) {
        try { if (W.speechSynthesis) W.speechSynthesis.cancel(); } catch (e) {}
        var a = await synthLocked(function () { return t.engine.synth(text, { voice: voice }); });
        if (a && a.audio) { putPhrasePCM(text, voice, a.audio, a.sampling_rate || 24000); await playPCM(a.audio, a.sampling_rate || 24000, kara ? text : null); return { ok: true, runtime: "kokoro-" + (t.engine.info().device || "wasm") }; }
      }
    } catch (e) { console.warn("[HoloVoice] neural TTS failed, falling back:", e && e.message || e); }
    if (kara && CFG.karaoke !== false && capQ) captionShow(captionText(text));   // speechSynth floor → no audio clock, show the cleaned line through the same component
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
  // speculative openers (deep-research RANK 4): the clause most replies START with. Pre-synthesised into
  // the κ-cache at warm() so — once clause-grained splitting (CFG.clauseCache) makes the opener its own
  // unit — the FIRST clause of a reply is usually an O(1) cache HIT → first-audio is instant while the
  // novel rest synthesises behind it. Bounded, fixed set; free on a miss (the clip just goes unused).
  var OPENERS = ["Sure,", "Sure.", "Okay,", "Okay.", "Alright,", "Got it.", "Of course.", "Absolutely.",
    "No problem.", "Let me see.", "Let me check.", "Let me look.", "One moment.", "Here you go.",
    "Good question.", "Well,", "Hmm,", "Right,", "Right.", "Yes,", "Yeah,", "Sorry,", "Actually,",
    "On it.", "I think", "Let me think.", "Of course,", "Sure thing."];
  var PREWARM = ["Yeah?", "What's up?", "Showing the desktop.", "dark mode.", "light mode.", "Done.", "Talk soon.", "I'm here whenever you need me."].concat(BACKCHANNELS).concat(OPENERS);
  // Prefetch the brain .holo into the OPFS κ-cache the moment we warm — overlaps boot/first-touch latency so
  // by the time you open Q (or ask anything novel past the L0 seed answers) the 0.5B is already warm/warming,
  // not starting cold at Q-open. Guarded: WebGPU + non-metered + once; deferred so it never competes with the
  // ear/voice warm or boot paint; fire-and-forget (no GPU build — just streams bytes → OPFS, L5 on real load).
  var _brainPrefetched = false;
  function prefetchBrain() {
    if (_brainPrefetched || metered() || CFG.holoBrain === false) return; _brainPrefetched = true;
    hasWebGPUSafe().then(function (gpu) {
      if (!gpu) return;
      setTimeout(function () {
        import(BASE + "voice/holo-voice-holo-brain.mjs").then(function (m) {
          // if a model was opened BY LINK (#model=κ), prefetch THAT κ's bytes — not the default — so the linked
          // model is the one that's warm by first-touch (else we'd waste bandwidth warming a 0.5B we won't use).
          if (CFG.holoModelKappa && m.loadHoloBytes) m.loadHoloBytes("/.holo/sha256/" + CFG.holoModelKappa, CFG.holoModelKappa).catch(function () {});
          else if (m.prefetchHoloBrain) m.prefetchHoloBrain(CFG.holoModel || "qwen2.5-0.5b").catch(function () {});
        }).catch(function () {});
      }, 1500);                                                       // after the ear (≈0ms) + voice (500ms) warm kick off
    });
  }
  function warm() {
    if (_warmed) return; _warmed = true;
    try { ensureMode(true); } catch (e) {}                            // load the recognizer QUIETLY — warm() is a background pre-load, it must never surface a "loading" toast
    setTimeout(function () { ensureTTS().then(function (t) { if (t && t.engine) prewarmPhrases(); }); }, 500);
    try { prefetchBrain(); } catch (e) {}                             // start the brain .holo → OPFS warm in the background
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
  // Resolve the recognizer once. `quiet` suppresses the loading bubble (background warm). Concurrent callers
  // JOIN the single in-flight load via STATE._loading, so arming the wake word + speaking can both await the
  // same warm without starting two.
  async function ensureMode(quiet) {
    if (STATE.mode) return STATE.mode;
    if (STATE._loading) return STATE._loading;
    STATE._loading = (async function () {
      if (CFG.engine !== "webspeech") {
        try {
          // CANONICAL WIRING (ADR-0084): let the one settings picker route the "listen" faculty. Resolve the
          // active model via the holo-q-mux bridge — honor a pinned/override choice, fail SAFE to the hardcoded
          // knativeEar default (κ unchanged when unbound). Lazy + off the boot path (runs on first listen).
          var ear = CFG.knativeEar;
          try {
            var fm = await import(BASE + "voice/holo-q-faculty-models.mjs");
            var rf = fm.resolveFacultyModel && fm.resolveFacultyModel("listen");
            if (rf && rf.instant && ear) {   // pinned default OR a user/steer override that resolves to OS-pinned bytes
              ear = Object.assign({}, ear, { holoUrl: rf.instant.url, kappa: rf.instant.kappa, release: rf.instant.release });
              if (rf.upgrade) { ear.upgradeUrl = rf.upgrade.url; ear.upgradeKappa = rf.upgrade.kappa; ear.upgradeRelease = rf.upgrade.release; }
            }
          } catch (e) {}
          var mod = await import(BASE + "voice/holo-voice-asr.mjs");
          // κ-served WASM fallback: when there's no WebGPU (κ-native ear off), serve Whisper's ONNX from its
          // .holo so the any-browser floor is ALSO content-addressed/warm/serverless (falls back to vendored ONNX).
          var serve = { module: "/apps/q/forge/gpu/holo-onnx-kserve.mjs", holoUrl: "/apps/q/forge/.models/whisper-tiny-onnx.holo",
            modelId: "onnx-community/whisper-tiny", kappa: "bed091f088f786ca772a0f00b89a3a20ac0a0f95f8aba10801b1302c994432e7",
            release: "https://github.com/Hologram-Technologies/hologram-apps/releases/download/models-v1/whisper-tiny-onnx.holo" };
          STATE.asr = (mod.createASR || mod.default)({ remote: CFG.remote, proxy: CFG.stream !== false, knativeEar: ear, knativeServe: serve, lang: CFG.lang || "en" });   // κ-native ear when WebGPU; κ-served Whisper on the WASM floor; both fall back to vendored ONNX; streaming → worker
          bindSeam();
          await STATE.asr.load(function () { if (!quiet) hud("loading", "Getting ready to listen…"); });
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
    })();
    try { return await STATE._loading; } finally { STATE._loading = null; }
  }

  // A DEDICATED wake recognizer on Whisper-BASE. The fast tiny tier (STATE.asr) drives Q Live's low-latency
  // streaming, but on a short single-letter "Q" clip tiny HALLUCINATES ("Thank you.", "(upbeat music)") —
  // base is markedly steadier, so the wake word gets a recognizer that won't invent filler. It's a separate
  // instance (so Q Live stays fast) but the two NEVER run at once (the wake loop pauses during a live call),
  // so there's no ORT session clash. Loaded only when always-listening is on; cached offline after first use.
  async function ensureWakeAsr() {
    if (STATE.wakeAsr) return STATE.wakeAsr;
    if (STATE._wakeAsrLoading) return STATE._wakeAsrLoading;
    STATE._wakeAsrLoading = (async function () {
      try {
        var mod = await import(BASE + "voice/holo-voice-asr.mjs");
        var asr = (mod.createASR || mod.default)({ remote: CFG.remote, proxy: true, modelWASM: "onnx-community/whisper-base", modelWASMFallback: "onnx-community/whisper-tiny" });
        await asr.load();
        STATE.wakeAsr = asr;
        return asr;
      } catch (e) { console.warn("[HoloVoice] wake recognizer (base) unavailable — using the shared tiny tier:", e && e.message || e); return null; }
    })();
    try { return await STATE._wakeAsrLoading; } finally { STATE._wakeAsrLoading = null; }
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
          var level = rms(), now = Date.now(); hud("listening", "Listening…", level); STATE.micLevel = level;
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
      var doneMs = opts.doneMs || CFG.turnSilenceDone || 130;            // snap THIS fast once the thought reads complete
      proc.onaudioprocess = function (e) {
        try { chunks.push(downsampleTo16k(new Float32Array(e.inputBuffer.getChannelData(0)), srcRate)); var ob = e.outputBuffer.getChannelData(0); for (var i = 0; i < ob.length; i++) ob[i] = 0; } catch (er) {}
      };
      try { src.connect(proc); proc.connect(zero); zero.connect(ctx.destination); } catch (e) { resolve(null); return; }
      function bufLen() { var n = 0; for (var i = 0; i < chunks.length; i++) n += chunks[i].length; return n; }
      function runPartial() {
        if (partialBusy || bufLen() < 16000 * 0.25) return;             // need ≥0.25s so the first word(s) surface fast; never overlap (one ORT session)
        partialBusy = true; var snap = concatF32(chunks), snapLen = snap.length;
        pending = STATE.asr.transcribe(snap, { language: CFG.lang }).then(function (d) {
          lastPartial = (d && d.text || "").trim(); lastPartialLen = snapLen;
          if (lastPartial && STATE.liveOn && STATE.live === "listening") capUserText(lastPartial);   // LIVE transcription streams into the ribbon (user voice) as you speak
        }, function () {}).then(function () { partialBusy = false; });
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
        // ADAPTIVE ENDPOINT — the "respond the instant you finish" lever. The rolling partial (already
        // computed) tells us if the thought reads COMPLETE: if so, endpoint at doneMs (~130ms) so Q replies
        // almost immediately; if it ends mid-thought (a trailing connective), hold to the fuller silenceMs so
        // we never clip. Sync + serverless (heuristicComplete); the ONNX scorer refines the veto upstream.
        var thresh = (CFG.turnDetect !== false && spoke && lastPartial && heuristicComplete(lastPartial)) ? doneMs : silenceMs;
        if ((spoke && quietFor > thresh) || elapsed > maxMs || (!spoke && elapsed > onsetGraceMs)) { finish(); return; }
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
    hud("thinking", "Thinking it through…");
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
      if (who === "barge") { if (ctl) ctl.aborted = true; stopSpeaking(); capBargeAck(); STATE.live = "listening"; }   // Q yields: words recede + the orb flips to the listening palette
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
      r.onresult = function (e) { var t = ""; for (var i = e.resultIndex; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) finalText += e.results[i][0].transcript; } hud("listening", t || "Listening…"); };
      r.onerror = function (e) { reject(new Error(e.error || "speech error")); };
      r.onend = function () { resolve((finalText || STATE._interim || "").trim()); };
      hud("listening", "Listening…"); try { r.start(); } catch (e) { reject(e); }
    });
  }

  async function recognize() {
    var mode = await ensureMode();
    if (mode === "serverless") {
      var audio = await captureUtterance({});
      if (!audio) return "";
      hud("thinking", "Thinking it through…");
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
  // ── OS-state READ: what Q can SEE, so it acts in context instead of blind ─────────────────────────
  // A fast, SYNCHRONOUS snapshot of the live κ-OS (each source optional/guarded → never throws, never
  // blocks the turn). Injected into Q's context every converse turn so Q knows the focused app, what's
  // open, what it can open, the desktop objects, and the theme. 100% on-device — nothing leaves.
  function osSnapshot() {
    var s = {};
    try { s.focused = (W.HoloDock && W.HoloDock.isFramed && W.HoloDock.isFramed()) ? ((W.HoloDock.currentAppId && W.HoloDock.currentAppId()) || "an app") : "desktop"; } catch (e) {}
    try { var nav = W.__holoNav; if (Array.isArray(nav)) s.open = nav.map(function (n) { return n && n.name; }).filter(Boolean); } catch (e) {}
    try { s.apps = appList().map(function (a) { return a && a.name; }).filter(Boolean); } catch (e) {}
    try { if (W.HoloWidgets && W.HoloWidgets.list) s.widgets = W.HoloWidgets.list().map(function (w) { return w && w.type; }).filter(Boolean); } catch (e) {}
    try { s.board = (W.HoloWidgets && W.HoloWidgets.kappa && W.HoloWidgets.kappa()) || null; } catch (e) {}
    try { var cs = W.getComputedStyle(DOC.documentElement); s.theme = DOC.documentElement.getAttribute("data-theme") || ""; s.accent = (cs.getPropertyValue("--holo-accent") || "").trim(); } catch (e) {}
    return s;
  }
  // render the snapshot as compact context, scoped by qScope ("os" = whole OS · "tab" = this holospace).
  function qContext(scope) {
    var s = osSnapshot(), L = ["Live OS state — you can act on this directly:"];
    L.push("• Focused: " + (s.focused || "desktop"));
    if (s.widgets && s.widgets.length) L.push("• Desktop objects here: " + s.widgets.join(", "));
    if (scope !== "tab") {
      if (s.open && s.open.length) L.push("• Open holospaces: " + s.open.join(", "));
      if (s.apps && s.apps.length) L.push("• Apps you can open: " + s.apps.slice(0, 40).join(", "));
    }
    if (s.theme || s.accent) L.push("• Theme: " + (s.theme || "default") + (s.accent ? " · accent " + s.accent : ""));
    L.push(scope === "tab"
      ? "Scope: THIS holospace only — act within the focused space; don't open or change other apps unless asked."
      : "Scope: the WHOLE OS — open/close apps, switch holospaces, and change settings as the request needs.");
    return L.join("\n");
  }
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
    } else if (/\b(my (?:story|journey)|story so far)\b/.test(t) || /\bwhat (?:have|did) i (?:done|do|built|build|made|make|accomplish(?:ed)?)\b/.test(t)) {
      // "what have I done here?" → Q reflects the journey κ back as a short story (the payoff that ties the
      // arc together). Pure, on-device, no model: HoloJourney narrates the milestones it witnessed.
      var story = (W.HoloJourney && W.HoloJourney.story) ? W.HoloJourney.story() : "Your story's just beginning. Make the first thing that's yours.";
      plan = { ok: true, say: story, propose: story, exec: function () {} };
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
  function ensureBrain(quiet) {   // quiet = a silent background load (the tier-2 upgrade) → no foreground HUD
    if (_brain) return Promise.resolve(_brain);
    if (_brainTried && !_brainLoading) return Promise.resolve(null);
    if (!_brainLoading) {
      _brainTried = true;
      _brainLoading = (async function () {
        // OPT-IN GPU CODING BRAIN (ternary qwen-coder-7b via the custom WebGPU engine, ADR-0096) — prefer it
        // when CFG.gpuBrain is on AND WebGPU exists; on ANY failure fall through to the WASM Coder-1.5B floor.
        if (CFG.gpuBrain && (typeof navigator !== "undefined" && navigator.gpu)) {
          try {
            var gm = await import(BASE + "voice/holo-voice-gpu-brain.mjs");
            var gpuEng = (gm.createGpuBrain || gm.default)({});
            if (!quiet) hud("loading", "Getting ready…");
            await gpuEng.load(function () { if (!quiet) hud("loading", "Getting ready…"); });
            _brain = { engine: gpuEng, gpu: true };
            bindMind(gpuEng);
            bindSeamBrain(2, gpuEng);                                  // full brain → the QVAC completion seam (tier 2)
            return _brain;
          } catch (e) { console.warn("[HoloVoice] GPU coder brain unavailable — using the WASM floor:", e && e.message || e); }
        }
        try {
          var m = await import(BASE + "voice/holo-voice-llm.mjs");
          var engine = (m.createLLM || m.default)({ preferWebGPU: CFG.preferWebGPU });
          if (!quiet) hud("loading", "Getting ready…");
          await engine.load(function () { if (!quiet) hud("loading", "Getting ready…"); });
          _brain = { engine };
          bindMind(engine);                                            // give the OS orchestrator Q's mind (sampler)
          bindSeamBrain(2, engine);                                    // full brain → the QVAC completion seam (tier 2)
          return _brain;
        } catch (e) { console.warn("[HoloVoice] agent LLM unavailable (run tools/vendor-voice-model.mjs to enable chat):", e && e.message || e); return null; }
        finally { _brainLoading = null; }
      })();
    }
    return _brainLoading;
  }
  // drop the loaded brain so the next ensureBrain() rebuilds with the current CFG (e.g. after a tier switch).
  function resetBrain() { _brain = null; _brainTried = false; _brainLoading = null; _boundTier = 0; try { var Q = W.HoloQVAC; if (Q && Q.useBrain) Q.useBrain(null); } catch (e) {} }

  // ── Q's DEFAULT WebGPU brain: a PRECOMPILED .holo model run on the QVAC forge runtime (κ-loaded, per-block
  //    WebCrypto L5, 100% serverless). engine.generate = a text-delta async-iterator → a drop-in for the QVAC
  //    completion seam, bound exactly like the WASM/gpu brains. Loaded QUIETLY (like the starter), so warming
  //    it at the welcome overlaps the spoken greeting and the first turn lands hot. ANY failure → null, and the
  //    caller falls back to the ONNX SmolLM2-360M floor. Gated by CFG.holoBrain (default on) + WebGPU. ──
  var _holoBrain = null, _holoBrainTried = false, _holoBrainLoading = null;
  function ensureHoloBrain() {
    if (_holoBrain) return Promise.resolve(_holoBrain);
    if (_holoBrainTried && !_holoBrainLoading) return Promise.resolve(null);
    if (!_holoBrainLoading) {
      _holoBrainTried = true;
      _holoBrainLoading = (async function () {
        try {
          var m = await import(BASE + "voice/holo-voice-holo-brain.mjs");
          // a model opened BY LINK (openModelLink → CFG.holoModelKappa) loads that κ as Q's brain via the SW
          // κ-route (/.holo/sha256/<κ> → IPFS heal); else the "respond" faculty model RESOLVED VIA THE MUX
          // (ADR-0084) — exactly as speak/listen do (resolveFacultyModel) — so the one settings picker actually
          // steers the main chat brain. Honor a pinned/override choice; fail SAFE to the pinned default. An
          // adapter κ (#adapter=) rides along — the engine applies its witnessed attn_q delta over whichever base.
          var adapterK = CFG.holoAdapterKappa || null;
          // YOUR private per-user adapter (trained on your own usage, encrypted at rest via holo-user-adapter):
          // load + decrypt LOCALLY and bind it into the brain so Q runs as YOU — "the model becomes you". Never
          // fetched/egressed; falls through to the link-adapter / none if absent or locked.
          var adapterBytes = null; try { var _ua = (typeof window !== "undefined" && window.HoloUserAdapter) ? await window.HoloUserAdapter.load() : null; if (_ua && _ua.bytes) adapterBytes = _ua.bytes; } catch (e) {}
          var respondKey = (m.modelKeyForFaculty && m.modelKeyForFaculty("respond")) || CFG.holoModel || "qwen2.5-0.5b";
          var engine = CFG.holoModelKappa
            ? (m.createHoloModelBrain || m.default)({ model: "/.holo/sha256/" + CFG.holoModelKappa, kappa: CFG.holoModelKappa, adapter: adapterK, adapterBytes: adapterBytes })
            : (m.createHoloModelBrain || m.default)({ model: respondKey, adapter: adapterK, adapterBytes: adapterBytes });
          await engine.load();                                     // quiet (no HUD) — overlaps the welcome
          _holoBrain = { engine };
          return _holoBrain;
        } catch (e) { console.warn("[HoloVoice] .holo WebGPU brain unavailable — using the ONNX floor:", e && e.message || e); return null; }
        finally { _holoBrainLoading = null; }
      })();
    }
    return _holoBrainLoading;
  }
  // the SILENT 1.5B upgrade: the SAME .holo runtime, the bigger model, bound as tier-2 in the background.
  // Gated by CFG.holoUpgrade (OFF until the 1.5B .holo is forged + pinned AND its GPU upload is chunked so it
  // doesn't jank the tab — warming the heavy model un-chunked froze the renderer). Quiet; any failure leaves
  // the 0.5B brain in place. Flip CFG.holoUpgrade=true once the artifact + non-janky warm land.
  var _holoUp = null, _holoUpTried = false, _holoUpLoading = null;
  function ensureHoloUpgrade() {
    if (_holoUp) return Promise.resolve(_holoUp);
    if (_holoUpTried && !_holoUpLoading) return Promise.resolve(null);
    if (!_holoUpLoading) {
      _holoUpTried = true;
      _holoUpLoading = (async function () {
        try {
          // DEVICE-TIER GATE: the 1.5B (~1.1GB) auto-loads only on a HIGH-tier GPU (large per-binding ceiling).
          // The 0.5B engine already reported the device tier at load; on a phone/integrated GPU we stay on it —
          // silently OOM-ing a mobile tab is the opposite of magical. Unknown tier → proceed (no regression).
          var baseInfo = _holoBrain && _holoBrain.engine && _holoBrain.engine.info && _holoBrain.engine.info();
          var tier = baseInfo && baseInfo.gpu && baseInfo.gpu.tier;
          if (tier && tier !== "high") { console.info("[HoloVoice] device tier '" + tier + "' — staying on the 0.5B brain (1.5B upgrade skipped)"); return null; }
          var m = await import(BASE + "voice/holo-voice-holo-brain.mjs");
          var engine = (m.createHoloModelBrain || m.default)({ model: CFG.holoUpgradeModel || "qwen2.5-1.5b" });
          await engine.load();
          _holoUp = { engine }; return _holoUp;
        } catch (e) { console.warn("[HoloVoice] .holo 1.5B upgrade unavailable:", e && e.message || e); return null; }
        finally { _holoUpLoading = null; }
      })();
    }
    return _holoUpLoading;
  }

  // ── PROGRESSIVE BRAIN (cold-start) — Q must feel alive the instant the desktop paints, not after a 1.7GB
  //    download. Conversation is served in TIERS: the lightweight STARTER (SmolLM2-360M, already vendored) is
  //    warmed the moment you OPEN Q (openQPanel/resolveBrain) — NOT at boot, so this shell (which hosts every
  //    app) stays lean — and is bound to the QVAC completion seam so the FIRST turn lands in ~1s; the FULL brain
  //    (1.5B Coder) upgrades SILENTLY in the background and rebinds when ready. DO (the command router) needs
  //    no model and works at t=0. Honest: until a real model is bound Q says it's waking — never word-salad.
  //    Respectful: the heavy tier auto-upgrades only on capable (WebGPU), non-metered devices — so a WASM-only
  //    machine stays on the safe starter (which never freezes the tab) instead of compiling 1.7GB in the heap. ──
  var _boundTier = 0;                                    // 0 none · 1 starter (360M) · 2 full brain (1.5B)
  function bindSeamBrain(tier, engine) {                 // bind the best-available engine to HoloQVAC.completion
    if (!engine || tier < _boundTier) return;
    _boundTier = tier;
    ensureQVAC().then(function (Q) { if (Q && Q.useBrain) { try { Q.useBrain({ id: "holo-brain-t" + tier, generate: function (h, p) { return engine.generate(h, p); } }); } catch (e) {} } });
  }
  function metered() {                                   // honor data-saver / 2g — don't burn mobile data on first touch
    try { var c = navigator.connection; return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ""))); } catch (e) { return false; }
  }
  function hasWebGPUSafe() {
    try { return (navigator.gpu && navigator.gpu.requestAdapter) ? navigator.gpu.requestAdapter().then(function (a) { return !!a; }).catch(function () { return false; }) : Promise.resolve(false); }
    catch (e) { return Promise.resolve(false); }
  }
  // warm the conversational brain (tier 1) and bind it. On WebGPU, Q's DEFAULT brain is the precompiled
  // .holo model (κ-loaded, serverless); the ONNX SmolLM2-360M is the non-WebGPU floor AND the .holo fallback.
  function warmStarter() {
    return hasWebGPUSafe().then(function (gpu) {
      if (gpu && CFG.holoBrain !== false) {
        return ensureHoloBrain().then(function (b) {
          if (b && b.engine) { bindSeamBrain(1, b.engine); return b; }
          return ensureQuick().then(function (q) { if (q && q.engine) bindSeamBrain(1, q.engine); return q || null; });   // .holo failed → ONNX floor
        });
      }
      return ensureQuick().then(function (q) { if (q && q.engine) bindSeamBrain(1, q.engine); return q || null; });        // no WebGPU → ONNX floor
    });
  }
  // upgrade to the FULL brain (tier 2) in the background, then rebind — only when the device can take it.
  var _upgrading = false;
  function upgradeBrain() {
    if (_upgrading || _brain || metered()) return;
    _upgrading = true;
    hasWebGPUSafe().then(function (gpu) {
      if (gpu && CFG.holoBrain !== false) {              // .holo WebGPU brain active → its upgrade is the .holo 1.5B
        if (!CFG.holoUpgrade) { _upgrading = false; return; }   // OFF until the 1.5B .holo is forged + pinned (Stage 4); the 0.5B stays the brain
        ensureHoloUpgrade().then(function (b) { if (b && b.engine) bindSeamBrain(2, b.engine); }).catch(function () {}).finally(function () { _upgrading = false; });
        return;
      }
      if (!gpu) { _upgrading = false; return; }          // WASM-only device → stay on the starter (safe + plenty for chat)
      CFG.preferWebGPU = true;                            // legacy path (holoBrain off): run the ONNX/ternary 1.5B on GPU
      ensureBrain(true).then(function (b) { if (b && b.engine) bindSeamBrain(2, b.engine); }).catch(function () {}).finally(function () { _upgrading = false; });   // quiet: a silent upgrade never shows the "waking up" bubble
    });
  }
  // the conversational brain resolver — NON-BLOCKING on the heavy tier: serve with whatever's warm now (full
  // brain if present, else the starter) and kick the silent upgrade. converseAgent awaits THIS, not ensureBrain.
  function resolveBrain() {
    if (_brain) return Promise.resolve(_brain);
    upgradeBrain();                                       // silent, guarded tier-2 — does not block this turn
    return warmStarter();                                 // tier-1 now → the first turn lands fast
  }
  function brainTier() { return _boundTier; }

  // ── L0 SEED κ-MEMO (cold-start) — a tiny, SHIPPED table of pre-sealed canonical answers for the handful of
  //    things a brand-new user predictably asks first (hello · who are you · what can you do · is this private
  //    · what is this). Checked BEFORE any model, so the very first turn returns in O(1) with ZERO model and
  //    ZERO network — Q feels alive the instant you ask, while the brain is still warming. These are Q's REAL
  //    canonical answers (Law L5: pre-sealed content, not fabrication), each carrying a content κ for
  //    provenance. Novel phrasings simply miss and fall through to the live model — honest by design. ──
  var SEED_ENTRIES = [
    { keys: ["hi","hello","hey","yo","hiya","hey q","hi q","hello q","good morning","good afternoon","good evening","sup"],
      a: "Hello. I'm Q. I'm yours, and I learn as you do. Ask me anything, or tell me what to do." },
    { keys: ["who are you","what are you","what is q","who is q","whats q","tell me about yourself","what r u"],
      a: "I'm Q, the mind of this OS, running entirely on your device. Nothing you say to me leaves it unless you ask. I can answer you, and I can act across the whole OS." },
    { keys: ["what can you do","what can you help with","what do you do","help","capabilities","what can i ask you","what can i ask","how can you help","what are you capable of"],
      a: "Two things: I answer you, and I act for you. Try “open files”, “change the theme”, or “take me to settings”, or just ask a question. I can see and act across your whole OS." },
    { keys: ["is this private","is it private","are you private","is my data safe","does anything leave my device","do you send my data","where does my data go","is my data private","do you store my data","do you collect my data"],
      a: "Private by default. I run on your device. Your words, files, and actions stay here. Nothing leaves unless you explicitly choose to send it." },
    { keys: ["what is hologram","what is hologram os","what is this","what is this os","whats this","what is holo","what is this place"],
      a: "This is Hologram, a sovereign OS that runs entirely on your device. Everything here is yours: your files, apps, and data, addressed by content and verifiable. I'm Q, your guide through it." },
    { keys: ["how do i start","getting started","what should i do","where do i begin","how do i get started","what now","where do i start","how does this work"],
      a: "Start anywhere. Open Files to see what's yours, or just tell me what you want to make and I'll build it with you. Nothing here is permanent until you say so." },
    { keys: ["thanks","thank you","thx","ty","cheers","thank you q","much appreciated"],
      a: "Anytime." },
  ];
  var _seedMap = null;
  function seedMap() { if (!_seedMap) { _seedMap = new Map(); SEED_ENTRIES.forEach(function (e) { e.keys.forEach(function (k) { _seedMap.set(k, e.a); }); }); } return _seedMap; }
  function seedNorm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(); }
  var SEED_FILLER = /^((?:hey|hi|hello|ok|okay|yo|please|q|so|um|uh)\s+)+/;
  // content κ for a sealed answer (FNV-1a) — provenance marker that this is a fixed, addressable answer.
  function seedKappa(s) { var h = 2166136261 >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return "seed:" + ("0000000" + h.toString(16)).slice(-8); }
  // O(1) lookup: exact normalized match, then with leading filler/greeting and a trailing "q" address stripped.
  function seedLookup(text) {
    var m = seedMap(), n = seedNorm(text);
    if (!n) return null;
    if (m.has(n)) return m.get(n);
    var stripped = n.replace(SEED_FILLER, "").replace(/\s+q$/, "").trim();
    if (stripped && stripped !== n && m.has(stripped)) return m.get(stripped);
    return null;
  }

  // ── the FAST BASE model (SmolLM2-360M q8, ADR-0096) — Q's cheap-task helper for routing · titling ·
  // compression · approval · curation, so those don't wake the 1.8GB coder brain. A separate, lazy ~376MB
  // instance on the same transformers.js (Llama-arch → runs on the proven 3.0.2); WASM any-browser + WebGPU.
  var _quick = null, _quickTried = false, _quickLoading = null;
  function ensureQuick() {
    if (_quick) return Promise.resolve(_quick);
    if (_quickTried && !_quickLoading) return Promise.resolve(null);
    if (!_quickLoading) {
      _quickTried = true;
      _quickLoading = (async function () {
        try {
          var m = await import(BASE + "voice/holo-voice-llm.mjs");
          var engine = (m.createLLM || m.default)({ preferWebGPU: CFG.preferWebGPU,
            wasm: { model: "HuggingFaceTB/SmolLM2-360M-Instruct", dtype: "q8" },
            webgpu: { model: "HuggingFaceTB/SmolLM2-360M-Instruct", dtype: "q8" },
            wasmFallback: null, maxTokens: 192 });
          await engine.load();
          _quick = { engine };
          return _quick;
        } catch (e) { console.warn("[HoloVoice] fast base model unavailable (vendor SmolLM2-360M via tools/vendor-voice-model.mjs):", e && e.message || e); return null; }
        finally { _quickLoading = null; }
      })();
    }
    return _quickLoading;
  }
  // quick(prompt | history, opts) → a fast, concise completion from the 360M base (NOT the big brain). Use
  // for cheap text: titles, summaries, compaction, yes/no judgments. Falls back to the brain if 360M is
  // absent. A string prompt is wrapped with a terse system line; pass a history array for full control.
  async function quickText(prompt, o) {
    o = o || {};
    var q = await ensureQuick();
    var eng = (q && q.engine) || ((await ensureBrain()) || {}).engine;   // graceful fallback to the brain
    if (!eng) return null;
    var history = Array.isArray(prompt) ? prompt
      : [{ role: "system", content: o.system || "You are a fast, precise helper. Answer concisely, with no preamble." }, { role: "user", content: String(prompt == null ? "" : prompt) }];
    return eng.chat(history, { maxTokens: o.maxTokens || 192, temperature: o.temperature || 0 });
  }

  // ── semantic embeddings (EmbeddingGemma, ADR-0096) — Q's semantic memory. Lazy-loaded on first use and
  // bound into the QVAC embed seam so HoloQVAC.embed() returns REAL vectors (not the FNV-1a floor). The
  // dedicated embedder is separate from the brain; ~309MB q8, WASM (any browser) + WebGPU. Fails closed.
  var _embed = null, _embedTried = false, _embedLoading = null;
  function ensureEmbed() {
    if (_embed) return Promise.resolve(_embed);
    if (_embedTried && !_embedLoading) return Promise.resolve(null);
    if (!_embedLoading) {
      _embedTried = true;
      _embedLoading = (async function () {
        try {
          var m = await import(BASE + "voice/holo-voice-embed.mjs");
          // κ-served embedder: serve EmbeddingGemma's ONNX files from embeddinggemma-300m.holo (Range + per-block
          // L5 + OPFS + serverless multi-source) into the same engine. Falls back to vendored ONNX on any failure
          // (so this is safe before the .holo is published to the Release / pinned — out-of-band step).
          var engine = (m.createEmbed || m.default)({ knative: { module: "/apps/q/forge/gpu/holo-onnx-kserve.mjs",
            holoUrl: "/apps/q/forge/.models/embeddinggemma-300m.holo", kappa: "53e9ff521f4b75157a9e86298d4392c3e3846f6560bc5a450feab55e200af0f8",
            release: "https://github.com/Hologram-Technologies/hologram-apps/releases/download/models-v1/embeddinggemma-300m.holo" } });
          await engine.load();
          _embed = engine;
          var Q = await ensureQVAC();
          if (Q && Q.useEmbed) { try { Q.useEmbed({ id: "holo-voice-embed", embed: function (t, o) { return engine.embed(t, o); } }); } catch (e) {} }
          return _embed;
        } catch (e) { console.warn("[HoloVoice] embeddings unavailable (vendor EmbeddingGemma via tools/vendor-voice-model.mjs):", e && e.message || e); return null; }
        finally { _embedLoading = null; }
      })();
    }
    return _embedLoading;
  }
  // embed(text|texts, {kind:"query"|"document"}) → semantic vector(s), cosine-ready. Loads EmbeddingGemma on first call.
  async function embedText(input, o) { var e = await ensureEmbed(); if (!e) return null; return e.embed(input, o || {}); }

  // ── SIGHT: SmolVLM-256M vision (lazy, isolated 3.8.1) → Q can describe / answer about an image ──────
  var _vision = null, _visionTried = false, _visionLoading = null;
  function ensureVision() {
    if (_vision) return Promise.resolve(_vision);
    if (_visionTried && !_visionLoading) return Promise.resolve(null);
    if (!_visionLoading) {
      _visionTried = true;
      _visionLoading = (async function () {
        try {
          var m = await import(BASE + "voice/holo-voice-vision.mjs");
          // κ-served sight: serve SmolVLM's ONNX files from smolvlm-256m.holo (Range + per-block L5 + OPFS +
          // serverless multi-source). Falls back to vendored ONNX on any failure (safe before the .holo is
          // published to the Release / pinned — out-of-band step).
          var engine = (m.createVision || m.default)({ knative: { module: "/apps/q/forge/gpu/holo-onnx-kserve.mjs",
            holoUrl: "/apps/q/forge/.models/smolvlm-256m.holo", kappa: "eeeeabd3c4171cae4d2e1e165f1ada1a1a29a1782a5e910708e75cf944263779",
            release: "https://github.com/Hologram-Technologies/hologram-apps/releases/download/models-v1/smolvlm-256m.holo" } });
          await engine.load();
          _vision = engine;
          return _vision;
        } catch (e) { console.warn("[HoloVoice] vision unavailable (vendor SmolVLM via tools/vendor-voice-model.mjs):", e && e.message || e); return null; }
        finally { _visionLoading = null; }
      })();
    }
    return _visionLoading;
  }
  // see(image, prompt) → a description/answer about an image (URL · data-URL · Blob · canvas · <img>). Loads SmolVLM on first call.
  async function seeImage(image, prompt, o) { var v = await ensureVision(); if (!v) return null; return v.see(image, prompt, o || {}); }

  // setEngine(useGpu) — persist the brain tier (WebGPU 1.5B vs WASM 0.5B) and rebuild on next turn.
  function setEngine(useGpu) {
    CFG.preferWebGPU = !!useGpu;
    try { localStorage.setItem("holo.voice.webgpu", useGpu ? "1" : "0"); } catch (e) {}
    resetBrain();
    return CFG.preferWebGPU;
  }
  // setGpuBrain(on) — opt into the ternary qwen-coder-7b GPU coder (ADR-0096); persists + rebuilds the brain
  // on the next turn. WASM Coder-1.5B stays the automatic fallback if WebGPU/the engine can't load.
  function setGpuBrain(on) {
    CFG.gpuBrain = !!on;
    try { localStorage.setItem("holo.voice.gpubrain", on ? "1" : "0"); } catch (e) {}
    resetBrain();
    return CFG.gpuBrain;
  }

  // testWebGPU() — REAL-HARDWARE self-check. Enables WebGPU, loads the 1.5B, asks a known-answer question,
  // and verifies the reply is coherent (contains "tokyo"). Garbage output doesn't throw, so this is the
  // only safe way to confirm WebGPU works on THIS device — on failure it auto-reverts to the WASM floor.
  var GARBAGE = /[　-鿿가-힯]/;                         // CJK/Hangul leaking into English = broken EP
  async function testWebGPU() {
    if (!(navigator.gpu)) { speakToast("This browser has no WebGPU."); return { ok: false, reason: "no-webgpu" }; }
    hud("loading", "Checking your graphics…");
    setEngine(true);
    var t0 = performance.now();
    var brain = await ensureBrain();
    var loadMs = Math.round(performance.now() - t0);                    // first-load time on WebGPU (the 1.16GB 1.5B)
    if (!brain || !brain.engine || brain.engine.info().device !== "webgpu") { setEngine(false); hud("error", "Couldn’t use your graphics. Staying on the reliable setup."); return { ok: false, reason: "no-webgpu-pipeline", loadMs: loadMs }; }
    var reply = "", genMs = 0;
    try { var g0 = performance.now(); reply = await brain.engine.chat([{ role: "user", content: "What is the capital of Japan? Answer in one short sentence." }], { maxTokens: 24 }); genMs = performance.now() - g0; } catch (e) { reply = ""; }
    // rough decode rate — answers the OTHER half of the ceiling question (coherent AND fast?). WASM 0.5B ≈ 7-8 tok/s.
    var toks = reply.trim().split(/\s+/).filter(Boolean).length * 1.3, tps = genMs > 0 ? Math.round(toks / (genMs / 1000)) : 0;
    var good = /tokyo/i.test(reply) && !GARBAGE.test(reply);
    if (good) { hud("done", "Graphics boost on. Q’s sharper now (~" + tps + " tok/s)."); speakToast("Graphics boost on. ~" + tps + " tok/s, loaded in " + (loadMs / 1000).toFixed(1) + "s."); return { ok: true, device: "webgpu", model: brain.engine.info().model, reply: reply, loadMs: loadMs, tokensPerSec: tps }; }
    setEngine(false); await ensureBrain();
    hud("error", "That boost wasn’t stable. Back to the reliable setup.");
    speakToast("Staying on the reliable setup.");
    return { ok: false, reason: reply ? "garbage" : "no-output", reply: reply, loadMs: loadMs, tokensPerSec: tps };
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
    if (cached) { enqueuePCM(cached.audio, cached.rate, text); return; }   // karaoke-append the follow-up in sync
    try { var t = await ensureTTS(); if (t && t.engine) { var a = await synthLocked(function () { return t.engine.synth(text, { voice: voice }); }); if (a && a.audio) { putPhrasePCM(text, voice, a.audio, a.sampling_rate || 24000); enqueuePCM(a.audio, a.sampling_rate || 24000, text); return; } } } catch (e) {}
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
      if (says.length) speakMind(says.join(" "), { prefix: "Heads up:", source: "self" });
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
  // split a streamed reply into CLAUSES (deep-research RANK 2): breaking at commas/semicolons/dashes —
  // not just sentence ends — makes each fragment a smaller, RE-USABLE κ-cache unit (clauses recur far more
  // than whole sentences → higher hit-rate → more O(1) replays). Clause = up to and INCLUDING its
  // punctuation, so a join falls on a natural prosodic break (where Kokoro pauses anyway). A whitespace-
  // after guard + a 3-char minimum keep "3.14" / "1,000" / tiny bits whole. CFG.clauseCache → off = sentences.
  function sentencer() {
    var rest = "";
    return {
      feed: function (delta) {
        rest += delta; var out = [], last = 0, clause = CFG.clauseCache !== false;
        for (var i = 0; i < rest.length - 1; i++) {
          var c = rest[i],
            sentEnd = (c === "." || c === "!" || c === "?" || c === "…"),
            clauseEnd = clause && (c === "," || c === ";" || c === ":" || c === "—" || c === "–");
          if (c === "\n" || ((sentEnd || clauseEnd) && /\s/.test(rest[i + 1]) && (i + 1 - last) >= 3)) {
            var seg = rest.slice(last, i + 1).trim(); if (seg) out.push(seg); last = i + 1;
          }
        }
        // soft cap: a long run-on with no boundary yet → break at a space so Q starts sooner
        if (rest.length - last > 160) { var sp = rest.lastIndexOf(" ", last + 150); if (sp > last + 40) { var s2 = rest.slice(last, sp).trim(); if (s2) out.push(s2); last = sp + 1; } }
        rest = rest.slice(last); return out;
      },
      flush: function () { var s = rest.trim(); rest = ""; return s; }
    };
  }
  var _history = [{ role: "system", content: sysPrompt() }];
  async function converseAgent(text, ctl) {
    hud("thinking", "“" + text + "”");
    _history[0] = { role: "system", content: sysPrompt() + "\n\n" + qContext(qScope) };   // persona + a fresh read of the live κ-OS (focused app · open spaces · what's openable · theme), scoped by qScope
    _history.push({ role: "user", content: text });
    _convoSink.user(text); _convoSink.qStart();                       // render in the Q panel transcript (no-op when closed)
    // L0 SEED κ-MEMO — predictable first prompts answered in O(1): ZERO model, ZERO network. The very first
    // turn lands instantly while the brain is still warming; a miss falls through to the live model below.
    var seeded = seedLookup(text);
    if (seeded) {
      _convoSink.qDelta(seeded); _convoSink.qDone(seeded, []);
      _history.push({ role: "assistant", content: seeded });
      hud("done", seeded);
      if (CFG.confirm && !_silentTurn) { try { speakNatural(seeded, { voice: CFG.voice }); } catch (e) {} }
      try { W.dispatchEvent(new CustomEvent("holo-voice", { detail: { text: text, reply: seeded, acted: [], converse: true, seed: true, kappa: seedKappa(seeded) } })); } catch (e) {}
      return { reply: seeded, acted: [], seed: true };
    }
    if (_history.length > 12) _history = [_history[0]].concat(_history.slice(-10));   // bound context
    var brain = await resolveBrain();                                 // tiered: serve with the warm starter NOW, upgrade the full brain in the background
    var Q = await ensureQVAC(), reply = "", acted = [], spoken = false;
    // Q speaks as the reply STREAMS: each finished sentence is pushed to a gapless speaker the moment it
    // lands, so the time-to-first-word is one sentence — not the whole answer + its full synthesis. A TYPED
    // panel turn stays silent (_silentTurn) — text in, text out; the panel mic / voice loop is what speaks.
    var speaker = (CFG.confirm && !_silentTurn) ? makeSpeaker({ voice: CFG.voice }) : null; if (speaker) { _activeSpeaker = speaker; karaReset(); }   // fresh karaoke caption for this reply
    var sent = sentencer();
    function emit(delta) { tmark("firstToken"); reply += delta; hud("speaking", reply); _convoSink.qDelta(delta); if (speaker) sent.feed(delta).forEach(function (s) { speaker.push(s); spoken = true; }); }
    // 1. governed seam — conscience gate + sealed receipt (active when the SDK is loaded). Streams the
    //    bound LLM if present, else the reference floor. A blocked verdict emits completionError (pre-stream).
    if (Q && Q.completion && _boundTier > 0) {                        // only stream the seam once a REAL model is bound — never the gibberish reference floor
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
    // 3. no model is warm yet (the starter is still waking, or this device can't run one) — be HONEST, never
    //    word-salad. DO still works (commands route without a model); only free-form chat waits for the brain.
    if (!reply) {
      reply = _boundTier === 0
        ? "One moment — I’m almost ready. You can already tell me what to do: “open files”, “change the theme”."
        : "I couldn’t form an answer just now. Try once more?";
    }
    _history.push({ role: "assistant", content: reply });
    _convoSink.qDone(reply, acted);                                   // finalize the Q bubble + action trail in the panel
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
    STATE.busy = true; pauseWake(); setBtn(true); hud("listening", "Listening…");   // free the mic from the wake loop
    try {
      var text = await recognize();
      STATE.lastText = text || "";
      if (!text) { hud("miss", "Didn’t catch that. Try again?"); flashBtn(); return; }
      await handleText(text);
    } catch (e) {
      var denied = /denied|not-allowed|permission/i.test(String(e));
      hud("error", denied ? "I need your microphone to hear you." : "Something slipped. Give it another go?");
      if (denied) speak("Microphone access is needed for voice.");
    } finally { STATE.busy = false; setBtn(false); resumeWake(); setTimeout(function () { if (!STATE.busy) hide(); }, 2600); }
  }
  // route an utterance to an action or the agent, then confirm — shared by push-to-talk and the wake word.
  async function handleText(text) {
    hud("thinking", "“" + text + "”");
    // L0 SEED κ-MEMO first — a predictable cold-start prompt ("hello", "what can you do", "is this private")
    // is answered in O(1) by converseAgent's seed before the router can divert it (e.g. into search).
    if (seedLookup(text)) { STATE.lastAction = "converse"; await converseAgent(text); return; }
    var res = route(text);   // explicit wake / push-to-talk → act now (route's exec thunk already ran)
    if (res && res.appCmd) { STATE.lastAction = "app:" + res.appCmd; _convoSink.user(text); _convoSink.qSay(res.say || "On it."); if (CFG.confirm && res.say && !_silentTurn) speak(res.say); W.dispatchEvent(new CustomEvent("holo-voice", { detail: { text: text, result: res } })); return; }
    if (res && res.converse) {
      // ONE FRONT DOOR (Fork 1): a CLEAR navigation / open / close intent that voice's own router missed routes
      // through the canonical resolver, so a spoken command converges with the typed one. Genuine conversation
      // stays a conversation (Q's brain) — voice is converse-first, so the default "build" never hijacks chat.
      try {
        var _hr = W.HoloResolve;
        if (_hr && typeof _hr.decide === "function") {
          var _d = _hr.decide(res.text || text);
          if (_d && (_d.lane === "nav" || _d.kind === "open" || _d.kind === "close")) { _hr.resolve(res.text || text, { source: "voice" }); STATE.lastAction = "resolve:" + _d.kind; return; }
        }
      } catch (e) {}
      mindObserve(res.text || text); STATE.lastAction = "converse"; await converseAgent(res.text || text); return;   // converseAgent renders the user line itself
    }
    STATE.lastAction = res.action || null;
    _convoSink.user(text); _convoSink.qSay(res.ok ? (res.say || "Done.") : ("“" + text + "”. I’m not sure what to do with that.")); if (res.ok && res.action) _convoSink.act(res.action);
    hud(res.ok ? "done" : "miss", res.ok ? (res.say || "Done.") : ("“" + text + "”. I’m not sure what to do with that."));
    if (!_silentTurn && CFG.confirm && res.say && W.HoloQVAC && W.HoloQVAC.textToSpeech) {
      try { await W.HoloQVAC.textToSpeech({ text: res.say }); } catch (e) { speak(res.say); }
    } else if (!_silentTurn && CFG.confirm && res.say) { speak(res.say); }
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
  function esc(s) { return String(s).toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function alt(list) { return list.map(esc).filter(Boolean).join("|"); }
  // the greeting carriers Q answers to — "hey Q", "yo Q", "morning Q", "good morning Q", … ONE list drives
  // both the wake regex AND the receipt's carrier field, so they can't drift. Longest-first so multi-word
  // greetings ("good morning") match before their prefixes.
  // ADDRESS = greetings that clearly address Q on purpose ("hey Q", "yo Q", "morning Q"). FILLER = soft
  // openers ("ok", "so", "um"). The distinction matters for common-word homophones: "hey you" ≈ "hey Q"
  // should wake, but "so you know" / "ok you got it" must NOT — so "you" pairs with ADDRESS only.
  var ADDRESS_LIST = ["good morning", "good evening", "good afternoon", "hey there",
    "morning", "evening", "afternoon", "greetings", "hello", "hiya", "hey", "hi", "yo", "sup"];
  var FILLER_LIST = ["okay", "ok", "um", "uh", "so", "excuse me"];
  var ADDRESS = "(?:" + alt(ADDRESS_LIST) + ")";
  var GREET = "(?:" + alt(ADDRESS_LIST.concat(FILLER_LIST)) + ")";
  // strong = wakes even with no greeting; weak = common-word homophones that wake ONLY after a greeting
  // (so "queue up the song" never triggers, but "hey Q" — heard as "hey queue" — does).
  // strong = wakes anywhere at the START. weak = wakes WITH a greeting ("hey cue") or said utterly ALONE.
  // strong = wakes anywhere at the START ("q"). weak = wakes with ANY greeting ("hey cue") or said utterly
  // ALONE ("cue"). common = a common word Whisper writes for the lone letter ("you" for "Q") — wakes ONLY
  // after an ADDRESS greeting ("hey you" ≈ "hey Q"), never bare, so "thank you"/"so you know"/a hallucinated
  // lone "you" can't fire. This is how a single-letter wake word stays reliable on a hallucination-prone tiny ASR.
  var HOMOPHONES = { q: { strong: ["q", "kyu", "kew", "kuh", "kyoo"], weak: ["cue", "queue", "qu", "que", "coo", "cu"], common: ["you"] }, x: { strong: ["x", "eks"], weak: ["ex"], common: [] }, j: { strong: ["j", "jay"], weak: [], common: [] }, k: { strong: ["k", "kay"], weak: [], common: [] } };
  var WAKE = {};
  function buildWake(word) {
    var w = String(word || "Q").trim().toLowerCase();
    var h = HOMOPHONES[w] || { strong: [w], weak: [], common: [] };
    var strong = h.strong.indexOf(w) < 0 ? [w].concat(h.strong) : h.strong;
    var weak = h.weak || [], common = h.common || [];
    var greetable = strong.concat(weak);                              // ANY greeting may precede these
    // ANY greeting + (strong|weak)  ·  an ADDRESS greeting + a common word ("hey you")  ·  a bare strong.
    var core = "(?:" + GREET + "\\s+(?:" + alt(greetable) + ")"
      + (common.length ? "|" + ADDRESS + "\\s+(?:" + alt(common) + ")" : "")
      + "|(?:" + alt(strong) + "))";
    WAKE.word = word;
    WAKE.re = new RegExp("^\\s*" + core + "\\b", "i");                 // detect (anchored to start)
    WAKE.strip = new RegExp("^\\s*" + core + "\\b[\\s,.!?-]*", "i");   // peel off the address
    // a LONE homophone that IS the whole utterance ≈ the wake word said alone (bare "Q" → "cue"/"queue").
    // strong+weak ONLY — never `common`, so a bare hallucinated "you" stays inert.
    WAKE.loneRe = new RegExp("^\\s*(?:" + alt(greetable) + ")\\s*$", "i");
  }
  // matched if it's a start-anchored wake (greeting+homophone / strong) OR a lone homophone said by itself.
  function wakeMatches(n) { return !!n && (WAKE.re.test(n) || WAKE.loneRe.test(n)); }
  buildWake(CFG.wakeWord);
  // The ADVERTISED wake is the 2-syllable phrase "Hey Q". A single letter is the worst case for any
  // recognizer — Whisper mangles a lone "Q" ("you"/"Hugh"/"(music)") — whereas "Hey Q" transcribes
  // reliably and the matcher already accepts it (greeting + word, incl. "hey you" ≈ "hey Q"). Bare "Q"
  // still works as a bonus shortcut; it's just not what we prompt for. (Durable fix = a dedicated KWS.)
  function wakePhrase() { return "Hey " + CFG.wakeWord; }
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
  // ── κ wake-receipt: every accepted wake is a content-addressed holo:WakeEvent ──────────────────────
  // Engine-independent — whichever stage gated it (Silero VAD or energy-VAD), an accepted wake is sealed as
  // a canonical, content-addressed object in the SAME did:holo:sha256 space as scenes/desktops/the orb
  // (canon = RFC 8785 JCS subset — byte-identical to holo-scene.mjs / holo-voice-orb.mjs). The κ is
  // deterministic over the event's IDENTITY fields only (word/heard/carrier/command/stage/asr/confidence/
  // duration) — the wall clock lives OUTSIDE the canon, so the same wake re-derives the same address (the
  // Law-L5 seal IS the content hash). It streams as a `holo-voice-wake` event for the orb / apps / Holo
  // Mind to react; a conscience verdict layers on later when the governed SDK is loaded.
  function wkCanon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(wkCanon).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + wkCanon(v[k]); }).join(",") + "}";
  }
  async function wkKappa(obj) {
    var str = wkCanon(obj);
    var c = (W.crypto && W.crypto.subtle) || null;
    if (c) { var h = await c.digest("SHA-256", new TextEncoder().encode(str)); return "did:holo:sha256:" + [].map.call(new Uint8Array(h), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
    var x = 0x811c9dc5; for (var i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }   // FNV-1a floor when subtle-crypto is absent
    return "did:holo:sha256:" + ("00000000" + (x >>> 0).toString(16)).slice(-8);
  }
  // pull the greeting carrier ("hey"/"yo"/"morning"/…) out of a matched utterance so the receipt records
  // it — built from the SAME greeting lists as the wake regex (longest-first → "good morning" beats "morning").
  var CARRIER_RE = new RegExp("^\\s*(" + alt(ADDRESS_LIST.concat(FILLER_LIST)) + ")\\b", "i");
  function wakeCarrier(t) { var m = CARRIER_RE.exec(norm(t || "")); return m ? m[1].toLowerCase() : ""; }
  async function mintWakeReceipt(d) {
    d = d || {};
    var event = {                                                        // IDENTITY fields → the content address
      "@type": "holo:WakeEvent",
      word: CFG.wakeWord,
      heard: d.heard || "",                                              // what ASR actually heard ("hey queue")
      carrier: d.carrier || "",                                          // greeting peeled off ("hey"/"yo"/""=bare)
      command: d.command || "",                                          // the rest after the address ("open browser"), ""=bare wake
      stage: d.stage || "vad-energy",                                    // which gate confirmed speech: "vad-silero" | "vad-energy"
      asr: d.asr || "whisper-tiny",
      confidence: typeof d.confidence === "number" ? Math.round(d.confidence * 1000) / 1000 : null,
      durationMs: d.durationMs != null ? Math.round(d.durationMs) : null,
    };
    var kappa = await wkKappa(event);
    var receipt = { kappa: kappa, at: Date.now() };                      // `at` = wall clock, deliberately OUTSIDE the canon
    for (var k in event) receipt[k] = event[k];
    WAKE.last = receipt;
    try { W.dispatchEvent(new CustomEvent("holo-voice-wake", { detail: receipt })); } catch (e) {}   // stream it (orb/apps/Mind react)
    return receipt;
  }

  // ── stage-1 VAD gate (sovereign, pure-ONNX, opt-in): Silero VAD on the bundled onnxruntime-web ────────
  // When CFG.vad is on AND the vendored model loads, each recorded segment is first checked for real SPEECH
  // (Silero VAD) BEFORE spending Whisper — so a slammed door / music / TV non-speech never wakes the heavy
  // recognizer. The cheap gate proposes ("this is speech"), Whisper-tiny disposes ("Q" + carrier). Any
  // failure → null, and segmenter() stays on its proven energy-VAD path (fail closed, no regression).
  var VAD = { engine: null, loading: null };
  async function ensureVAD() {
    if (!CFG.vad) return null;
    if (VAD.engine) return VAD.engine;
    if (VAD.loading) return VAD.loading;
    VAD.loading = (async function () {
      try {
        var mod = await import(BASE + "voice/holo-voice-vad.mjs");
        VAD.engine = await mod.createVAD({ threshold: CFG.vadThreshold });
        return VAD.engine;
      } catch (e) { VAD.engine = null; return null; }                    // fail closed → energy-VAD
      finally { VAD.loading = null; }
    })();
    return VAD.loading;
  }

  var wakeOn = false, wakeResume = false, wakeStream = null, wakeAC = null, wakeRaf = null, wakeProcessing = false;
  async function startWake() {
    if (wakeOn) return true;
    // Mic FIRST — an instant permission prompt, never gated behind a one-time model download. Then arm the
    // ear (segmenter + the tiny VAD gate) IMMEDIATELY and warm the heavy transcriber QUIETLY in the
    // background, so "always listening" turns on at once instead of freezing on "Getting ready…". If you
    // say "Q" before Whisper finishes its first load, onSeg simply awaits that same warm (a one-time wait).
    try { wakeStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { speakToast("Microphone access is needed for the wake word."); return false; }
    wakeOn = true; try { localStorage.setItem("holo.voice.wake", "1"); } catch (e) {}
    if (btn) { btn.setAttribute("data-wake", "1"); btn.title = "Listening for “" + wakePhrase() + "” · click for Q Live · right-click for settings"; }
    segmenter(wakeStream);                                               // mic + VAD armed now — no waiting
    ensureVAD();                                                         // warm the sovereign stage-1 gate (tiny; no-op when CFG.vad is off)
    ensureWakeAsr().then(function (asr) {                                // warm the dedicated BASE wake recognizer in the background, no frozen bubble
      if (wakeOn && !asr && !STATE.asr) { stopWake(); speakToast("Wake word isn’t available on this device yet."); }
    });
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
  // ONE-TAP always-listening: flip the wake word on/off with immediate, legible feedback. Turning it on
  // gives a teal orb flare ("I'm awake") + an inviting toast; the orb then wears a gentle breathing teal
  // aura the whole time it's listening (orbColor), so the state is always visible — no buried setting.
  async function toggleWake() {
    if (wakeOn) { stopWake(); hud("idle", "Stopped listening."); setTimeout(function () { if (!STATE.busy && !STATE.liveOn) hide(); }, 2000); return false; }
    var ok = await startWake();
    if (ok) { flareWake(); hud("listening", "Listening. Just say “" + wakePhrase() + "”."); setTimeout(function () { if (!STATE.busy && !STATE.liveOn) hide(); }, 3000); }
    return ok;
  }
  function segmenter(stream) {
    var AC = W.AudioContext || W.webkitAudioContext; wakeAC = new AC();
    var src = wakeAC.createMediaStreamSource(stream), an = wakeAC.createAnalyser(); an.fftSize = 1024; src.connect(an);
    var buf = new Uint8Array(an.fftSize), rec = null, chunks = [], speaking = false, lastLoud = 0, segStart = 0;
    function rms() { an.getByteTimeDomainData(buf); var s = 0; for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; s += v * v; } return Math.sqrt(s / buf.length); }
    function endSeg() { speaking = false; try { rec && rec.state !== "inactive" && rec.stop(); } catch (e) {} }
    if (CFG.vad) ensureVAD();                                            // warm the sovereign stage-1 gate (Silero VAD) for the segment check in onSeg
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
        var durMs = audio && audio.length ? (audio.length / 16000) * 1000 : null;
        // STAGE 1 (sovereign gate, opt-in) — only gates once the model is LOADED (during the load window
        // Whisper handles wake, no regression). Silero VAD checks the segment is real SPEECH before spending
        // Whisper; a slammed door / music / TV non-speech is dropped here. Fails open within the gate (a VAD
        // error → vad=null → we don't block).
        var vadProb = null;
        if (CFG.vad && VAD.engine) {
          try { var v = await VAD.engine.segmentHasSpeech(audio, CFG.vadThreshold); vadProb = v.maxProb;
            if (!v.speech) { try { (W.__wakeLog || (W.__wakeLog = [])).push({ blocked: "vad", vad: vadProb != null ? +vadProb.toFixed(2) : null, ms: durMs ? Math.round(durMs) : null }); } catch (e) {} if (WAKE.debug) console.log("[wake] VAD blocked · prob " + (vadProb != null ? vadProb.toFixed(2) : "—") + " < " + CFG.vadThreshold + " · " + (durMs != null ? Math.round(durMs) : "—") + "ms (not heard as speech)"); return; } }
          catch (e) {}                                                    // VAD glitch → fall through to Whisper (fail open)
        }
        // STAGE 2: the DEDICATED base recognizer confirms the wake (steadier than tiny on a lone "Q"); falls
        // back to the shared tier if base isn't warm yet. First wake during the one-time load joins it.
        var asr = STATE.wakeAsr || (await ensureWakeAsr());
        if (!asr) { if (!STATE.asr) await ensureMode(true); asr = STATE.asr; }
        if (!asr) return;
        var r = await asr.transcribe(audio, { language: CFG.lang });
        var text = (r && r.text || "").trim();
        var n = norm(text), lone = !!n && !WAKE.re.test(n) && WAKE.loneRe.test(n), matched = wakeMatches(n);
        // ALWAYS record what the wake recognizer heard into a ring buffer — read it with `__wakeLog` in the
        // console (no filtering needed past the heal noise). The single source of truth for "why didn't it wake".
        try { (W.__wakeLog || (W.__wakeLog = [])).push({ heard: text, norm: n, matched: matched, lone: lone, vad: vadProb != null ? +vadProb.toFixed(2) : null, ms: durMs ? Math.round(durMs) : null }); while (W.__wakeLog.length > 25) W.__wakeLog.shift(); } catch (e) {}
        if (WAKE.debug) { var mdl = (asr.info && asr.info().model || "?").split("/").pop(); console.log("[wake] heard " + JSON.stringify(text) + " → norm " + JSON.stringify(n) + " · " + mdl + " · vad " + (vadProb != null ? vadProb.toFixed(2) : "—") + " · " + (durMs != null ? Math.round(durMs) : "—") + "ms · " + (matched ? "✓ WAKE" + (lone ? " (lone)" : "") : "✗ no match")); }
        if (matched) {
          var rest = lone ? "" : n.replace(WAKE.strip, "").trim();
          // seal the wake as a content-addressed holo:WakeEvent + stream it (orb/apps/Mind react), and flare
          // the orb the moment the wake is CONFIRMED (the teal "I heard you" cue).
          await mintWakeReceipt({ heard: n, carrier: wakeCarrier(text), command: rest, stage: vadProb != null ? "vad-silero" : "vad-energy", confidence: vadProb, durationMs: durMs });
          flareWake({ stage: vadProb != null ? "vad-silero" : "vad-energy", confidence: vadProb });
          if (rest) {                                                     // "Q, open browser" → act at once, stay on the desktop
            STATE.busy = true; setBtn(true);
            try { STATE.lastText = text; await handleText(text); }
            finally { STATE.busy = false; setBtn(false); setTimeout(function () { if (!STATE.busy) hide(); }, 2600); }
          } else { openQPanel(); qPanelMic(); }                           // bare "Q" → open the panel and listen for the command
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
      "@keyframes hv-wakespot{0%{box-shadow:0 0 0 0 rgba(43,212,255,.8),0 2px 10px #0006}55%{box-shadow:0 0 0 9px rgba(43,212,255,0),0 2px 10px #0006}100%{box-shadow:0 0 0 0 rgba(43,212,255,0),0 2px 10px #0006}}" +
      "#holo-voice-btn[data-wake-spot=\"1\"]{animation:hv-wakespot .9s ease-out;border-color:#2bd4ff}" +   /* the moment a wake is confirmed — the teal "I heard you" cue when the orb is closed */
      "#holo-voice-btn .hv-btn-orb{position:absolute;inset:0;width:100%;height:100%;border-radius:inherit;pointer-events:none}" +
      // resting form = the animated spectrum DISC (the orb's no-WebGL fallback) — Q is NEVER shown as a 🎙 mic glyph
      "#holo-voice-btn .hv-btn-disc{position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:conic-gradient(from 0deg,var(--holo-spectrum,#5b8cff,#7c5cff,#b14eff,#ff4ed0,#ff6b6b,#ffc440,#2bd4ff,#5b8cff));-webkit-mask:radial-gradient(circle,transparent 30%,#000 33%,#000 62%,transparent 66%);mask:radial-gradient(circle,transparent 30%,#000 33%,#000 62%,transparent 66%);animation:hv-spin 7s linear infinite;transition:opacity .3s}" +
      "@keyframes hv-spin{to{transform:rotate(360deg)}}" +
      "@media (prefers-reduced-motion:reduce){#holo-voice-btn .hv-btn-disc{animation:none}}" +
      "#holo-voice-btn[data-orb=\"1\"] .hv-btn-disc{opacity:0}" +   /* the 3D orb mounted → fade the disc out beneath it */
      ".hw-q .hw-frame{display:none!important}" +                                   /* Q is frameless — just the orb, no card */
      ".hw-q .hw-tools .edit{display:none}" +                                       /* nothing to edit on the orb */
      ".hw-q .hw-body,.hw-q canvas{cursor:pointer}" +
      ".hw-q canvas{display:block;width:100%;aspect-ratio:1}" +
      // Q's status caption — a single, state-tinted glass line that rises near the orb (placed in JS so it
      // never overlaps Q). The dot's colour IS the state (listening·thinking·speaking·…); the line is the
      // human message. A soft tinted glow + a gentle rise make it feel like a thought surfacing from Q.
      "#holo-voice-hud{position:fixed;z-index:2147482400;max-width:min(330px,76vw);padding:.5rem .9rem;border-radius:999px;" +
      "background:color-mix(in srgb,var(--holo-surface,#12161f) 50%,transparent);-webkit-backdrop-filter:blur(26px) saturate(1.8);backdrop-filter:blur(26px) saturate(1.8);" +
      "border:1px solid color-mix(in srgb,var(--hv-tint,#5b8cff) 24%,rgba(255,255,255,.2));color:var(--holo-ink,#eef2f8);" +
      "box-shadow:0 10px 30px -12px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.14),0 0 22px -12px var(--hv-tint,#5b8cff);" +   // light glass: soft drop + inner sheen + faint tint glow
      "font:500 var(--holo-text-sm, 0.906rem)/1.35 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif);letter-spacing:.005em;" +
      "opacity:0;transform:translateY(8px) scale(.96);transform-origin:bottom center;pointer-events:none;" +
      "transition:opacity .3s cubic-bezier(.2,.8,.2,1),transform .34s cubic-bezier(.2,.85,.25,1)}" +
      "#holo-voice-hud[data-show=\"1\"]{opacity:1;transform:none}" +
      "#holo-voice-hud .hv-row{display:flex;align-items:center;gap:.5rem}" +
      "#holo-voice-hud .hv-dot{width:8px;height:8px;border-radius:999px;background:var(--hv-tint,#5b8cff);flex:0 0 auto;box-shadow:0 0 8px var(--hv-tint,#5b8cff)}" +
      "#holo-voice-hud[data-live=\"1\"] .hv-dot{animation:hv-hud-pulse 1.6s ease-in-out infinite}" +
      "@keyframes hv-hud-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.6)}}" +
      "#holo-voice-hud .hv-meter{height:3px;border-radius:999px;background:linear-gradient(90deg,var(--hv-tint,#5b8cff),color-mix(in srgb,var(--hv-tint,#5b8cff) 35%,transparent));width:0;margin-top:.4rem;transition:width .1s linear}" +
      "#holo-voice-hud .hv-txt{opacity:.95;word-break:break-word;font-weight:500}" +
      "#holo-voice-menu{position:fixed;right:14px;bottom:calc(120px + var(--holo-dock-h,0px));z-index:2147482401;width:min(300px,80vw);padding:.7rem .8rem;border-radius:14px;" +
      "background:var(--holo-glass-acrylic-bg,rgba(18,22,30,.92));-webkit-backdrop-filter:blur(18px) saturate(1.6);backdrop-filter:blur(18px) saturate(1.6);" +
      "border:1px solid var(--holo-glass-border,rgba(255,255,255,.18));box-shadow:0 .6rem 2.4rem rgba(0,0,0,.55);color:var(--holo-ink,#e9eef7);" +
      "font:var(--holo-text-sm, 0.875rem)/1.4 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif);opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .18s,transform .18s}" +
      "#holo-voice-menu[data-show=\"1\"]{opacity:1;transform:none;pointer-events:auto}" +
      "#holo-voice-menu h4{margin:0 0 .5rem;font-size: var(--holo-text-sm, 0.813rem);opacity:.7;font-weight:600}" +
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
      "#holo-voice-menu .hv-note{margin-top:.5rem;font-size: var(--holo-text-sm, 0.75rem);opacity:.6;line-height:1.35}" +
      // ── Q PANEL: a right-docked, non-modal carriage (reuses --holo-aside-w → the holospace glides left,
      // exactly like Wallet) so you SEE the OS and converse with Q at once. The Claude-extension layout. ──
      "#q-panel{position:fixed;top:0;right:0;bottom:0;width:var(--ha-gw,min(420px,92vw));z-index:9000;display:flex;flex-direction:column;" +
      "background:var(--holo-glass-acrylic-bg,rgba(15,19,27,.94));-webkit-backdrop-filter:blur(28px) saturate(1.6);backdrop-filter:blur(28px) saturate(1.6);" +
      "border-left:1px solid var(--holo-glass-border,rgba(255,255,255,.14));box-shadow:-14px 0 44px rgba(0,0,0,.46);color:var(--holo-ink,#e9eef7);" +
      "font:var(--holo-text-sm, 0.906rem)/1.5 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif);transform:translateX(100%);opacity:0;pointer-events:none;" +
      "transition:transform .34s cubic-bezier(.2,.8,.2,1),opacity .3s}" +
      "#q-panel[data-show=\"1\"]{transform:none;opacity:1;pointer-events:auto}" +
      "#q-panel .qp-head{display:flex;align-items:center;gap:.6rem;padding:.7rem .55rem .7rem .8rem;border-bottom:1px solid var(--holo-glass-border,rgba(255,255,255,.1));flex:0 0 auto}" +
      "#q-panel .qp-orb{width:34px;height:34px;flex:0 0 auto;border-radius:50%}" +
      "#q-panel .qp-id{min-width:0}" +
      "#q-panel .qp-title{font-weight:600;font-size: var(--holo-text-sm, 0.938rem);letter-spacing:.01em}" +
      "#q-panel .qp-sub{font-size: var(--holo-text-sm, 0.688rem);opacity:.5;margin-top:1px}" +
      "#q-panel .qp-scope{margin-left:auto;font-size: var(--holo-text-sm, 0.719rem);opacity:.85;cursor:pointer;padding:.28rem .55rem;border-radius:999px;border:1px solid var(--holo-glass-border,rgba(255,255,255,.16));background:rgba(255,255,255,.05);white-space:nowrap}" +
      "#q-panel .qp-scope:hover{background:rgba(255,255,255,.1)}" +
      "#q-panel .qp-icon{width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:9px;cursor:pointer;opacity:.65;font-size: var(--holo-text-sm, 0.875rem)}" +
      "#q-panel .qp-icon:hover{opacity:1;background:rgba(255,255,255,.08)}" +
      "#q-panel .qp-close{font-size:18px;line-height:1;transition:transform .12s,opacity .12s,background .12s}" +
      "#q-panel .qp-close:hover{transform:translateX(2px)}" +
      "#q-panel .qp-thread{flex:1 1 auto;overflow-y:auto;padding:1rem .85rem;display:flex;flex-direction:column;gap:.65rem}" +
      "#q-panel .qp-msg{max-width:90%;padding:.55rem .78rem;border-radius:15px;white-space:pre-wrap;word-break:break-word;animation:qp-rise .26s cubic-bezier(.2,.8,.2,1)}" +
      "@keyframes qp-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}" +
      "#q-panel .qp-msg.you{align-self:flex-end;background:var(--holo-accent,#5b8cff);color:#fff;border-bottom-right-radius:5px}" +
      "#q-panel .qp-msg.q{align-self:flex-start;background:rgba(255,255,255,.07);border:1px solid var(--holo-glass-border,rgba(255,255,255,.1));border-bottom-left-radius:5px}" +
      "#q-panel .qp-act{align-self:flex-start;font-size: var(--holo-text-sm, 0.75rem);opacity:.72;display:flex;align-items:center;gap:.45rem;padding:0 .2rem}" +
      "#q-panel .qp-act::before{content:\"\";width:6px;height:6px;border-radius:50%;background:#46e08a;box-shadow:0 0 8px #46e08a;flex:0 0 auto}" +
      "#q-panel .qp-empty{margin:auto;text-align:center;opacity:.5;font-size: var(--holo-text-sm, 0.813rem);line-height:1.7;max-width:250px}" +
      "#q-panel .qp-compose{flex:0 0 auto;padding:.6rem .7rem;border-top:1px solid var(--holo-glass-border,rgba(255,255,255,.1));display:flex;align-items:flex-end;gap:.5rem}" +
      "#q-panel .qp-in{flex:1 1 auto;resize:none;max-height:120px;height:40px;padding:.6rem .7rem;border-radius:13px;border:1px solid var(--holo-glass-border,rgba(255,255,255,.18));background:rgba(255,255,255,.06);color:inherit;font:inherit;outline:none}" +
      "#q-panel .qp-in:focus{border-color:var(--holo-accent,#5b8cff)}" +
      "#q-panel .qp-mic,#q-panel .qp-send{flex:0 0 auto;width:38px;height:38px;border-radius:50%;border:1px solid var(--holo-glass-border,rgba(255,255,255,.18));background:rgba(255,255,255,.06);color:inherit;cursor:pointer;font-size: var(--holo-text-sm, 0.938rem);display:flex;align-items:center;justify-content:center}" +
      "#q-panel .qp-send{background:var(--holo-accent,#5b8cff);color:#fff;border-color:transparent;font-size:17px}" +
      "#q-panel .qp-mic:hover,#q-panel .qp-send:hover{filter:brightness(1.12)}" +
      "#q-panel .qp-mic[data-on=\"1\"]{background:#2bd4ff;color:#06121a;border-color:transparent;animation:hv-hud-pulse 1.4s ease-in-out infinite}";
    DOC.head.appendChild(s);
  }
  function mount() {
    css();
    btn = DOC.createElement("button"); btn.id = "holo-voice-btn"; btn.type = "button";
    btn.setAttribute("aria-label", "Talk to Q. Right-click or long-press for settings."); btn.title = "Talk to Q · right-click for settings";
    btn.innerHTML = '<span class="hv-btn-disc" aria-hidden="true"></span>'; btn.style.display = "none";   // resting form = the animated orb-disc, NEVER a 🎙 mic; stays hidden until withHW decides the surface
    btn.addEventListener("click", openQPanel);                        // tap → the docked Q panel (see the OS + converse together)
    // right-click / long-press → engine settings (WebGPU toggle + self-test)
    btn.addEventListener("contextmenu", function (e) { e.preventDefault(); toggleMenu(); });
    var lp; btn.addEventListener("pointerdown", function () { lp = setTimeout(function () { lp = null; toggleMenu(); }, 550); });
    btn.addEventListener("pointerup", function () { if (lp) { clearTimeout(lp); lp = null; } });
    btn.addEventListener("pointerleave", function () { if (lp) { clearTimeout(lp); lp = null; } });
    DOC.body.appendChild(btn);
    // Q is a holospace object: where the Widgets runtime exists, Q becomes a frameless, movable,
    // resizable, κ-addressed desktop orb (the fixed button hides); elsewhere the orb-button is the fallback.
    withHW(function (hasWidgets) {
      if (hasWidgets) { btn.style.display = "none"; registerQWidget(); ensureQWidget(); }   // Q is the desktop widget orb → the floating button stays hidden (no mic, no flash)
      else { mountBtnOrb(); btn.style.display = ""; }                                        // no widget host → the button IS the orb (WebGL orb, else the animated disc)
    });
    hudEl = DOC.createElement("div"); hudEl.id = "holo-voice-hud";
    hudEl.innerHTML = '<div class="hv-row"><span class="hv-dot"></span><span class="hv-txt"></span></div><div class="hv-meter"></div>';
    txtEl = hudEl.querySelector(".hv-txt"); levelEl = hudEl.querySelector(".hv-meter");
    DOC.body.appendChild(hudEl);
    W.addEventListener("resize", function () { if (hudEl && hudEl.getAttribute("data-show") === "1") placeHud(); });
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
      '<div class="hv-eng"><span>Smarter replies <em style="opacity:.6">(uses more power)</em></span><input type="checkbox" class="hv-sw" id="hv-gpu-sw"></div>' +
      '<button type="button" class="hv-test">Check this device</button>' +
      '<div class="hv-note"></div>';
    DOC.body.appendChild(menuEl);
    var sw = menuEl.querySelector("#hv-gpu-sw"), wsw = menuEl.querySelector("#hv-wake-sw"), nm = menuEl.querySelector("#hv-name"), vc = menuEl.querySelector("#hv-voice"), test = menuEl.querySelector(".hv-test"), note = menuEl.querySelector(".hv-note");
    function refresh() {
      sw.checked = !!CFG.preferWebGPU; wsw.checked = !!wakeOn; if (DOC.activeElement !== nm) nm.value = CFG.wakeWord; vc.value = CFG.voice;
      var w = CFG.wakeWord;
      note.textContent = wakeOn
        ? "Listening. Just say “Hey " + w + "”, e.g. “Hey " + w + ", open the browser.”"
        : (CFG.preferWebGPU
          ? "Smarter replies are on. If answers look garbled, this device can’t run them — tap Check, or turn this off."
          : "Using the fast, lightweight assistant. Turn on smarter replies for higher-quality answers, then Check this device.");
    }
    nm.addEventListener("input", function () { setWakeWord(nm.value); if (menuEl.querySelector(".hv-note")) refresh(); });
    vc.addEventListener("change", function () { setVoice(vc.value); speakNatural("Hi, this is " + CFG.wakeWord + "."); });   // preview the chosen voice
    wsw.addEventListener("change", async function () { if (wsw.checked) { var ok = await startWake(); if (!ok) wsw.checked = false; } else stopWake(); refresh(); });
    sw.addEventListener("change", function () { setEngine(sw.checked); refresh(); });
    test.addEventListener("click", async function () {
      test.disabled = true; test.textContent = "Checking… (one-time setup)";
      try { await testWebGPU(); } catch (e) {}
      test.disabled = false; test.textContent = "Check this device"; refresh(); sw.checked = !!CFG.preferWebGPU;
    });
    menuEl._refresh = refresh; refresh();
    DOC.addEventListener("click", function (e) { if (menuEl.getAttribute("data-show") === "1" && !menuEl.contains(e.target) && e.target !== btn) hideMenu(); });
  }
  function toggleMenu() { if (!menuEl) return; if (menuEl.getAttribute("data-show") === "1") hideMenu(); else { menuEl._refresh && menuEl._refresh(); menuEl.setAttribute("data-show", "1"); } }
  function hideMenu() { if (menuEl) menuEl.setAttribute("data-show", "0"); }
  function setBtn(on) { if (btn) btn.setAttribute("data-on", on ? "1" : "0"); }
  function flashBtn() { if (!btn) return; btn.animate && btn.animate([{ transform: "scale(1)" }, { transform: "scale(.9)" }, { transform: "scale(1)" }], { duration: 220 }); }
  function show() { if (hudEl) { hudEl.setAttribute("data-show", "1"); placeHud(); } }
  function hide() { if (hudEl) hudEl.setAttribute("data-show", "0"); }
  // the dot's COLOUR is the state; the active states gently pulse it. No words wasted on a label.
  var HUD_TINT = { listening: "#2bd4ff", thinking: "#c77bff", speaking: "var(--holo-accent,#5b8cff)", loading: "#ffc861", done: "#46e08a", miss: "#ff9e2c", error: "#ff6b8a", idle: "var(--holo-accent,#5b8cff)" };
  var HUD_LIVE = { listening: 1, thinking: 1, speaking: 1, loading: 1 };
  function hud(state, text, level) {
    if (!hudEl) return;
    hudEl.style.setProperty("--hv-tint", HUD_TINT[state] || "var(--holo-accent,#5b8cff)");
    hudEl.setAttribute("data-live", HUD_LIVE[state] ? "1" : "0");
    if (txtEl && text != null) txtEl.textContent = text;
    if (levelEl) levelEl.style.width = (state === "listening" && level != null ? Math.min(100, Math.round(level * 600)) : 0) + "%";
    show();                                                             // sets data-show + places it near the orb
  }
  // place the caption just above the Q orb (centred, clamped to the viewport; flips below if it'd clip the
  // top), so it reads as Q's own thought and NEVER overlaps the orb. Falls back to a safe right-side spot.
  function placeHud() {
    if (!hudEl) return;
    var pad = 16, gap = 20, bw = hudEl.offsetWidth || 300, bh = hudEl.offsetHeight || 52;
    // anchor to the orb's ACTUAL box — or, before it can be measured (e.g. during the very first wake), to
    // its intended resting spot — so the status ALWAYS floats clear ABOVE Q and never covers the orb.
    var orb = DOC.querySelector(".hw-q") || btn, box = null;
    if (orb && orb.offsetParent !== null) { var r = orb.getBoundingClientRect(); box = { x: r.left, y: r.top, w: r.width, h: r.height }; }
    else { try { var p = savedQPos() || orbHome(); if (p) box = { x: p.x, y: p.y, w: p.w || 120, h: p.w || 120 }; } catch (e) {} }
    if (box) {
      var left = Math.max(pad, Math.min(box.x + box.w / 2 - bw / 2, W.innerWidth - bw - pad));
      var top = box.y - gap - bh; if (top < pad) top = box.y + box.h + gap;   // float above; only drop below if there's truly no room
      top = Math.max(pad, Math.min(top, W.innerHeight - bh - pad));
      hudEl.style.left = left + "px"; hudEl.style.top = top + "px"; hudEl.style.right = "auto"; hudEl.style.bottom = "auto";
    } else {
      hudEl.style.left = "auto"; hudEl.style.top = "auto"; hudEl.style.right = pad + "px"; hudEl.style.bottom = "calc(190px + var(--holo-dock-h,0px))";   // clear of the bottom-right orb
    }
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // Q LIVE — the magical voice-to-voice experience: one tap, then just talk. A living orb listens,
  // thinks, and speaks back, hands-free, turn after turn. All the engines are hidden behind it.
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  var liveEl, liveCanvas, liveCtx, capQ, capYou, capHint, liveSub, beginBtn, orbRaf = 0, _smooth = 0;
  // Q's 3D orb (the VapiBlocks port in voice/holo-voice-orb.mjs) — WebGL when supported; the 2D drawOrb
  // below is the reduced-motion / no-WebGL fallback. liveOrb = the overlay heart, btnOrb = the floating button.
  var liveOrb = null, btnOrb = null, _orbMod = null, _orbModTried = false, orbMode = null, _orbSmooth = 0, _mpT = 0;
  // WebGPU raymarched orb (Tier 3) — the hero rendering for the live overlay, on its own canvas; gated, with
  // the WebGL orb (then the 2D orb) as the floor. Lives only while Q Live is open (one on-demand context).
  var liveGpuOrb = null, liveGpuCanvas = null, _gpuMod = null, _gpuModTried = false, _gpuOk = null;
  function liveCss() {
    if (DOC.getElementById("holo-live-css")) return;
    var s = DOC.createElement("style"); s.id = "holo-live-css";
    s.textContent =
      "#holo-live{position:fixed;inset:0;z-index:2147483600;display:none;flex-direction:column;align-items:center;justify-content:center;" +
      "background:radial-gradient(118% 118% at 50% 38.2%,color-mix(in srgb,var(--holo-accent,#5b8cff) 13%,rgba(8,10,16,.86)),rgba(5,7,11,.95) 72%);" +   /* glow centred on the golden line (38.2% = 100·(1−1/φ)) */
      "-webkit-backdrop-filter:blur(28px) saturate(1.32);backdrop-filter:blur(28px) saturate(1.32);opacity:0;transition:opacity .5s ease}" +
      "#holo-live[data-show=\"1\"]{display:flex;opacity:1}" +
      // welcome → desktop reveal: when Q finishes the greeting the whole glass blooms outward and clears,
      // the blur melts to nothing and the desktop fades up underneath. One delightful, automatic farewell.
      "#holo-live[data-show=\"1\"].hl-reveal{pointer-events:none;animation:hlReveal .82s cubic-bezier(.22,.61,.36,1) forwards}" +
      "@keyframes hlReveal{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.06);-webkit-backdrop-filter:blur(0) saturate(1);backdrop-filter:blur(0) saturate(1)}}" +
      "@media (prefers-reduced-motion: reduce){#holo-live[data-show=\"1\"].hl-reveal{animation-duration:.34s;transform:none}}" +
      "#holo-live canvas{width:min(61.8vmin,460px);height:min(61.8vmin,460px);cursor:pointer;touch-action:manipulation}" +   /* golden-ratio framing (61.8 = 100/φ) */
      "#holo-live .hl-you{margin-top:1.6rem;min-height:1.4em;max-width:min(680px,86vw);text-align:center;color:var(--holo-ink,#cdd6e6);opacity:.5;font:400 clamp(var(--holo-text-sm, 0.875rem),2.1vmin,17px)/1.35 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif)}" +
      // the ribbon viewport: one row, clipped, with both edges masked so words fade in (right) + out (left)
      "#holo-live .hl-q{position:absolute;left:50%;bottom:9vh;transform:translateX(-50%);margin:0;height:2.1em;width:min(840px,92vw);display:flex;align-items:center;overflow:hidden;white-space:nowrap;color:var(--holo-ink,#eef2fb);font:300 clamp(19px,3.2vmin,29px)/1.4 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif);transition:opacity .45s ease;-webkit-mask-image:linear-gradient(to right,transparent 0,#000 26%,#000 74%,transparent 100%);mask-image:linear-gradient(to right,transparent 0,#000 26%,#000 74%,transparent 100%)}" +
      // the sliding row of words — translated each frame so the spoken word sits on the fixed centre playhead
      "#holo-live .hl-track{position:relative;flex:0 0 auto;white-space:nowrap;will-change:transform}" +
      // a word: calm + dim by default, gently brightened (subtle scale, no blur) only when the voice is on it
      "#holo-live .hl-w{display:inline-block;padding:0 .24em;opacity:.34;transform:scale(.97);transform-origin:center;will-change:opacity,transform;transition:opacity .42s ease,transform .42s ease,text-shadow .42s ease}" +
      "#holo-live .hl-w.hl-cur{opacity:1;transform:scale(1);text-shadow:0 0 12px color-mix(in srgb,var(--holo-accent,#5b8cff) 30%,transparent)}" +
      // the outgoing row dissolves in place (absolute → out of flow) while the next voice builds
      "#holo-live .hl-track.hl-leave{position:absolute;opacity:0;transition:opacity .34s ease;pointer-events:none}" +
      // barge-in: Q's words shrink + fade deferentially as it yields the floor
      "#holo-live .hl-track.hl-yield .hl-w{opacity:0;transform:scale(.94);transition:opacity .26s ease,transform .26s ease}" +
      // the USER voice on the shared ribbon — a cooler, calmer palette so it's never mistaken for Q
      "#holo-live .hl-q[data-speaker=\"user\"] .hl-w{color:#a9c2e6}" +
      "#holo-live .hl-q[data-speaker=\"user\"] .hl-w.hl-cur{opacity:1;color:#eaf3ff;text-shadow:0 0 12px rgba(150,190,255,.4)}" +
      // reduced-motion: no horizontal scroll — wrap, centre, and let the highlight move by opacity alone
      "#holo-live .hl-q.hl-reduce{height:auto;min-height:3em;display:block;overflow:visible;white-space:normal;text-align:center;-webkit-mask:none;mask:none}" +
      "#holo-live .hl-q.hl-reduce .hl-track{position:static;display:inline;white-space:normal;transform:none!important}" +
      "@media (prefers-reduced-motion: reduce){#holo-live .hl-w{transform:none!important;transition:opacity .28s ease,text-shadow .28s ease}}" +
      "#holo-live .hl-hint{margin-top:1.4rem;color:var(--holo-ink,#9fb0c8);opacity:.5;font:600 var(--holo-text-sm, 0.75rem)/1 var(--holo-font-sans,system-ui);letter-spacing:.18em;text-transform:uppercase}" +
      // the single skip affordance — top-right, the ✕ button paired with its keyboard twin (Esc). No second hint anywhere.
      "#holo-live .hl-close{position:absolute;top:max(21px,env(safe-area-inset-top));right:21px;display:flex;align-items:center;gap:.7rem;z-index:3}" +   /* 21px ≈ φ rhythm */
      "#holo-live .hl-skip{color:var(--holo-ink,#9fb0c8);opacity:.55;font:600 var(--holo-text-sm, 0.72rem)/1 var(--holo-font-sans,system-ui);letter-spacing:.16em;text-transform:uppercase;transition:opacity .3s ease}" +
      "#holo-live .hl-close:hover .hl-skip{opacity:.8}" +
      "#holo-live .hl-x{width:42px;height:42px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:background .2s ease,transform .15s ease}" +
      "#holo-live .hl-x:hover{background:rgba(255,255,255,.13);transform:scale(1.06)}" +
      "#holo-live .hl-sub{margin-top:1rem;color:var(--holo-ink,#aebbd2);opacity:.6;text-align:center;max-width:min(560px,84vw);font:400 clamp(var(--holo-text-sm, 0.813rem),2vmin,16px)/1.45 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif);display:none}" +   /* greeting:tagline gap = 1.618rem : 1rem = φ */
      // welcome invitation: the ribbon becomes a calm, centred greeting under the orb (golden spacing), then
      // returns to its lower-third karaoke role the instant Q starts speaking (data-mode is cleared in runWelcome).
      "#holo-live[data-mode=\"welcome\"] .hl-q{position:static;left:auto;bottom:auto;transform:none;margin:1.618rem 0 0;height:auto;min-height:1.2em;width:auto;max-width:min(720px,86vw);display:block;overflow:visible;white-space:normal;text-align:center;font-size:clamp(26px,4.2vmin,40px);-webkit-mask:none;mask:none}" +
      "#holo-live[data-mode=\"welcome\"] .hl-track{position:static;display:inline;white-space:normal;transform:none!important}" +
      // CALM caption (welcome speech): ONE sentence at a time — centred, wrapped, still; no scroll, no mask,
      // no upcoming text. Each sentence fades up; the previous dissolves (hl-leave). Unhurried + delightful.
      "#holo-live .hl-q.hl-calm{position:absolute;left:50%;bottom:12vh;transform:translateX(-50%);height:auto;min-height:2.4em;width:min(760px,86vw);display:block;overflow:visible;white-space:normal;text-align:center;font-weight:300;font-size:clamp(21px,3.4vmin,31px);line-height:1.5;-webkit-mask:none;mask:none}" +
      "#holo-live .hl-q.hl-calm .hl-track{position:relative;display:block;white-space:normal;animation:hlSentIn .55s cubic-bezier(.22,.61,.36,1) both}" +
      "#holo-live .hl-q.hl-calm .hl-track.hl-leave{position:absolute;left:0;right:0}" +
      "@keyframes hlSentIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}" +
      "@media (prefers-reduced-motion: reduce){#holo-live .hl-q.hl-calm .hl-track{animation-duration:.001s}}" +
      "#holo-live .hl-begin{margin-top:1.6rem;padding:.72rem 2.3rem;border-radius:999px;cursor:pointer;display:none;letter-spacing:.02em;" +
      "border:1px solid color-mix(in srgb,var(--holo-accent,#5b8cff) 60%,transparent);background:color-mix(in srgb,var(--holo-accent,#5b8cff) 22%,rgba(255,255,255,.04));color:var(--holo-ink,#eef2fb);" +
      "font:600 var(--holo-text-sm, 0.938rem)/1 var(--holo-font-sans,system-ui,-apple-system,'Segoe UI',sans-serif);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:transform .15s,background .2s,box-shadow .2s}" +
      "#holo-live .hl-begin:hover{transform:translateY(-1px);background:color-mix(in srgb,var(--holo-accent,#5b8cff) 34%,rgba(255,255,255,.05));box-shadow:0 0 0 4px color-mix(in srgb,var(--holo-accent,#5b8cff) 20%,transparent),0 10px 28px rgba(0,0,0,.42)}";
    DOC.head.appendChild(s);
  }
  function buildLive() {
    liveCss();
    liveEl = DOC.createElement("div"); liveEl.id = "holo-live"; liveEl.setAttribute("role", "dialog"); liveEl.setAttribute("aria-label", "Voice conversation");
    liveEl.innerHTML = '<div class="hl-close"><span class="hl-skip">Esc to skip</span><button class="hl-x" type="button" aria-label="Close">✕</button></div><canvas></canvas><div class="hl-q"></div><div class="hl-sub"></div><div class="hl-hint"></div>';
    liveCanvas = liveEl.querySelector("canvas");   // 2D context is acquired lazily in drawOrb (a canvas can't be both 2D and WebGL)
    capYou = null; capQ = liveEl.querySelector(".hl-q"); capHint = liveEl.querySelector(".hl-hint");   // one ribbon for both voices — no separate .hl-you line
    liveSub = liveEl.querySelector(".hl-sub"); beginBtn = null;   // no "begin" button — the welcome speaks automatically (autoBegin)
    liveEl.querySelector(".hl-x").addEventListener("click", closeLive);
    liveEl.addEventListener("click", function (e) { if (e.target === liveEl && !STATE.welcoming) closeLive(); });   // tap backdrop to leave — NOT during the welcome ("tap anywhere" is the begin gesture, never a close)
    liveCanvas.addEventListener("click", function () {
      if (STATE.ttsLevel > 0) { stopSpeaking(); capBargeAck(); STATE.live = "listening"; }               // tap the orb to interrupt Q (Q yields visibly)
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
  // three.min.js (UMD global THREE) is loaded ON DEMAND — the first time an orb actually mounts — rather than
  // eagerly at parse via a <script defer>. The orb still renders in WebGL exactly as before; this just moves
  // the 616KB off the boot critical path of a shell that hosts every app, and a session that never shows an
  // orb (reduced-motion, no-WebGL, orb never summoned) never fetches it. async=false preserves the original
  // "three executes before the orb module" ordering the VapiBlocks port relies on (global THREE).
  var _threeP = null;
  function loadThree() {
    if (W.THREE) return Promise.resolve(W.THREE);
    if (_threeP) return _threeP;
    _threeP = new Promise(function (resolve, reject) {
      var s = DOC.createElement("script");
      s.src = BASE + "voice/lib/three.min.js"; s.async = false; s.setAttribute("data-holo-shared", "three.min.js");
      s.onload = function () { resolve(W.THREE); };
      s.onerror = function () { reject(new Error("three.min.js failed to load")); };
      DOC.head.appendChild(s);
    });
    return _threeP;
  }
  // ── the 3D orb bridge: load three + the VapiBlocks port lazily, feed it Q's live voice level + mood palette ──
  function ensureOrbMod() {
    if (_orbMod) return Promise.resolve(_orbMod);
    if (_orbModTried) return Promise.resolve(null);
    _orbModTried = true;
    return loadThree().then(function () { return import(BASE + "voice/holo-voice-orb.mjs"); }).then(function (m) { _orbMod = m; return m; },
      function (e) { console.warn("[HoloVoice] 3D orb module unavailable — using the 2D orb:", e && e.message || e); return null; });
  }
  // lazy-load the WebGPU raymarched orb module (Tier 3). Null on failure → caller uses the WebGL orb.
  function ensureGpuMod() {
    if (_gpuMod) return Promise.resolve(_gpuMod);
    if (_gpuModTried) return Promise.resolve(null);
    _gpuModTried = true;
    return import(BASE + "voice/holo-voice-orb-gpu.mjs").then(function (m) { _gpuMod = m; return m; },
      function (e) { console.warn("[HoloVoice] WebGPU orb module unavailable:", e && e.message || e); return null; });
  }
  // the mind pulse decays in REAL time (not per-frame), so it's identical whether one orb or two are drawing.
  function mindPulseNow() {
    var now = performance.now();
    if (_mpT) { STATE.mindPulse = (STATE.mindPulse || 0) * Math.pow(0.955, (now - _mpT) / 16.67); if (STATE.mindPulse < 0.004) STATE.mindPulse = 0; }
    _mpT = now; return STATE.mindPulse || 0;
  }
  // the WAKE flare — the "I heard 'Q'" acknowledgement. The moment a wake is CONFIRMED (Whisper matched the
  // word + carrier) the orb swells + washes a listening-teal so you FEEL heard; decays in real time. (The
  // stage-1 Silero VAD only knows "speech", not "Q", so the flare fires on confirm — not before.) Like
  // mindPulseNow, decay is real-time (frame-rate independent) so it's identical whether one orb draws or two.
  var _wpT = 0;
  function wakePulseNow() {
    var now = performance.now();
    if (_wpT) { STATE.wakePulse = (STATE.wakePulse || 0) * Math.pow(0.94, (now - _wpT) / 16.67); if (STATE.wakePulse < 0.004) STATE.wakePulse = 0; }   // a touch faster than the mind flare — a quick blip
    _wpT = now; return STATE.wakePulse || 0;
  }
  // fire the flare NOW (synchronous → felt immediately): light the orb + flash the mic button (the cue when
  // the orb is closed) + stream a `holo-voice-wake-spot` event (apps can react). Carries the optional score.
  function flareWake(detail) {
    STATE.wakePulse = 1;
    try { if (btn) { btn.setAttribute("data-wake-spot", "1"); clearTimeout(btn._wst); btn._wst = setTimeout(function () { btn.removeAttribute("data-wake-spot"); }, 900); } } catch (e) {}
    try { W.dispatchEvent(new CustomEvent("holo-voice-wake-spot", { detail: detail || {} })); } catch (e) {}
  }
  // ── frequency-domain expression: split the LIVE audio into bands so the orb reads SPEECH, not just
  // loudness. Reads the active AnalyserNode (Q's TTS while speaking, your mic while listening) — both
  // already exist; getByteFrequencyData is zero-download + on-device. Bands MODULATE the orb (bass→pump,
  // mid→texture, treble→shimmer/spin, onset→flare, brightness→warmth); the base `level` still drives the
  // morph amplitude, so the tuned look is preserved. Everything eases to calm when nothing's playing.
  var _freqBuf = null, _bands = { level: 0, bass: 0, mid: 0, treble: 0, bright: 0 }, _onsetEnv = 0;
  function activeAnalyser() {
    if (STATE.ttsLevel > 0.01 && _ttsAn) return _ttsAn;                 // Q speaking → meter its voice
    if (MIC && MIC.an && (STATE.live === "listening" || STATE.micLevel > 0.01)) return MIC.an;   // you speaking
    return null;
  }
  function orbBands() {
    var an = activeAnalyser(), sm = function (a, b, k) { return b + (a - b) * k; };
    function out() { return { bass: _bands.bass, mid: _bands.mid, treble: _bands.treble, bright: _bands.bright, onset: Math.min(1, _onsetEnv) }; }
    if (!an) { _bands = { level: _bands.level * 0.9, bass: _bands.bass * 0.9, mid: _bands.mid * 0.9, treble: _bands.treble * 0.9, bright: _bands.bright * 0.92 }; _onsetEnv *= 0.85; return out(); }
    var n = an.frequencyBinCount; if (!_freqBuf || _freqBuf.length !== n) _freqBuf = new Uint8Array(n);
    an.getByteFrequencyData(_freqBuf);
    var bEnd = Math.max(1, (n * 0.08) | 0), mEnd = (n * 0.45) | 0, bass = 0, mid = 0, treble = 0, csum = 0, wsum = 0, i;
    for (i = 0; i < n; i++) { var v = _freqBuf[i] / 255; if (i < bEnd) bass += v; else if (i < mEnd) mid += v; else treble += v; csum += v * i; wsum += v; }
    bass /= bEnd; mid /= Math.max(1, mEnd - bEnd); treble /= Math.max(1, n - mEnd);
    var lvl = wsum / n, bright = wsum > 0 ? (csum / wsum) / n : 0, prev = _bands.level;
    _bands = { level: sm(lvl, _bands.level, 0.35), bass: sm(bass, _bands.bass, 0.4), mid: sm(mid, _bands.mid, 0.4), treble: sm(treble, _bands.treble, 0.5), bright: sm(bright, _bands.bright, 0.25) };
    _onsetEnv = Math.max(_onsetEnv * 0.8, Math.max(0, _bands.level - prev) * 7);   // transient envelope — fires on consonants/beats
    return out();
  }
  // the orb's drive signal: the base `level` (Q's voice / yours, smoothed, + idle breath + mind swell) PLUS
  // frequency bands + the conversational state, so the orb reads speech and has per-mode body language.
  function orbLevel() {
    var raw = Math.max(STATE.ttsLevel * 1.1, STATE.micLevel * 5);
    var idle = (STATE.welcoming || STATE.live === "waking" || STATE.live === "idle" || !STATE.liveOn)
      ? 0.06 * (0.6 + 0.4 * Math.sin(performance.now() / 700)) : 0;
    _orbSmooth += (Math.max(raw, idle) - _orbSmooth) * 0.18;
    var b = orbBands();
    return { level: Math.min(1.5, _orbSmooth + mindPulseNow() * 0.5 + wakePulseNow() * 0.6), bass: b.bass, mid: b.mid, treble: b.treble, bright: b.bright, onset: b.onset, state: STATE.welcoming ? "welcome" : STATE.live, energy: presence() };
  }
  // ── PRESENCE: lively when you're here, serene when idle (never off — calm, not dead) ───────────────
  var _lastActive = (function () { try { return Date.now(); } catch (e) { return 0; } })();
  function markActive() { try { _lastActive = Date.now(); } catch (e) {} }
  function presence() {
    if (STATE.liveOn || STATE.ttsLevel > 0.02 || STATE.micLevel > 0.02) return 1;   // in conversation → fully present
    var idle; try { idle = Date.now() - _lastActive; } catch (e) { return 1; }
    if (idle < 12000) return 1;
    if (idle > 45000) return 0.32;
    return 1 - (idle - 12000) / 33000 * 0.68;                            // ramp 1 → 0.32 over ~33s
  }
  // ── CIRCADIAN: warmer + dimmer at night, cool + bright by day (subtle, calm-by-default) ────────────
  function circadian() {
    var hr; try { var d = new Date(); hr = d.getHours() + d.getMinutes() / 60; } catch (e) { return { warm: 0, dim: 0 }; }
    var night = (1 + Math.cos((hr / 24) * 2 * Math.PI)) / 2;             // 1 at midnight, 0 at noon, smooth across dawn/dusk
    return { warm: night * 0.8, dim: night * 0.45 };
  }
  // ── TIER 2: wallpaper-palette adaptation — the orb adopts your desktop's colours so it BELONGS there ──
  // Sample the wallpaper image (same-origin → no canvas taint), pull its vibrant hues, build spectrum
  // stops; fall back to the OS accent arc, then to the brand spectrum (null). On-device, no CDN; recomputed
  // only when the wallpaper or accent actually changes. Fed to every orb instance via orbColor().stops.
  var _orbStops = null, _orbStopsSig = "";
  function rgbToHsl(r, g, b) { r /= 255; g /= 255; b /= 255; var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0, l = (mx + mn) / 2, s = 0; if (d) { s = d / (1 - Math.abs(2 * l - 1)); if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; } return { h: h, s: s, l: l }; }
  function hslToHex(h, s, l) { h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l)); var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r = 0, g = 0, b = 0; if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; } var to = function (v) { return ("0" + Math.round((v + m) * 255).toString(16)).slice(-2); }; return "#" + to(r) + to(g) + to(b); }
  function loopStops(a) { return a && a.length ? a.concat([a[0]]) : a; }   // seamless wrap (first == last)
  function wallpaperSrc() {
    var els = [DOC.getElementById("world"), DOC.getElementById("holo-desk"), DOC.body];
    for (var i = 0; i < els.length; i++) { if (!els[i]) continue; var bg = ""; try { bg = getComputedStyle(els[i]).backgroundImage || ""; } catch (e) {} var m = bg.match(/url\(["']?([^"')]+)["']?\)/); if (m) return m[1]; }
    return null;
  }
  function accentPalette() { var a = accent(); if (!a) return null; var h = hueOf(a), out = []; for (var k = -2; k <= 3; k++) out.push(hslToHex(h + k * 30, 0.72, 0.58)); return loopStops(out); }   // a vivid arc around your accent
  function samplePalette(img) {
    var S = 28, cv = DOC.createElement("canvas"); cv.width = S; cv.height = S;
    var cx = cv.getContext("2d"); if (!cx) return null;
    cx.drawImage(img, 0, 0, S, S);
    var data; try { data = cx.getImageData(0, 0, S, S).data; } catch (e) { return null; }   // tainted (cross-origin, no CORS) → bail to accent
    var B = 12, acc = []; for (var i = 0; i < B; i++) acc.push({ w: 0, h: 0, s: 0, l: 0 });
    for (var p = 0; p < data.length; p += 4) {
      var c = rgbToHsl(data[p], data[p + 1], data[p + 2]);
      if (c.s < 0.18 || c.l < 0.12 || c.l > 0.92) continue;                 // skip greys / near-black / blown-out
      var bi = Math.min(B - 1, (c.h / 360 * B) | 0), wt = c.s * (1 - Math.abs(c.l - 0.55)), a = acc[bi];
      a.w += wt; a.h += c.h * wt; a.s += c.s * wt; a.l += c.l * wt;
    }
    var got = acc.filter(function (a) { return a.w > 0; }).map(function (a) { return { h: a.h / a.w, s: a.s / a.w, l: a.l / a.w, w: a.w }; });
    if (!got.length) return null;
    got.sort(function (m, n) { return n.w - m.w; });
    var top = got.slice(0, 6).sort(function (m, n) { return m.h - n.h; });   // most prominent hues, ordered round the wheel
    var stops = top.map(function (c) { return hslToHex(c.h, Math.max(0.55, Math.min(0.9, c.s)), Math.max(0.46, Math.min(0.64, c.l))); });
    while (stops.length < 5) stops.push(hslToHex(top[0].h + stops.length * 26, 0.7, 0.56));   // pad muted/monochrome walls into a small arc
    return loopStops(stops);
  }
  function refreshPalette() {
    var url = wallpaperSrc(), sig = (url || "") + "|" + accent();
    if (sig === _orbStopsSig) return; _orbStopsSig = sig;
    function set(s) { if (s && s.length >= 3) _orbStops = s; }
    if (!url) { set(accentPalette()); return; }                            // living/blank wallpaper → accent arc
    var img = new Image();
    try { var u = new URL(url, location.href); if (u.origin !== location.origin && !/^blob:|^data:/.test(url)) img.crossOrigin = "anonymous"; } catch (e) {}
    img.onload = function () { var s = null; try { s = samplePalette(img); } catch (e) {} set(s || accentPalette()); };
    img.onerror = function () { set(accentPalette()); };
    img.src = url;
  }
  // the 3D orb owns its SPECTRUM; holo-voice signals the gold mind-flare (Holo Mind acting) AND, when
  // available, the adaptive wallpaper/accent stops so the orb belongs to your desktop. mindPulse decays in orbLevel().
  function orbColor() {
    var c = circadian();
    // while always-listening is armed (and not already in a live call), the orb wears a gentle breathing
    // teal aura — a calm, ever-present "I'm listening" cue. A real KWS spot (wakePulseNow) flares brighter.
    var listen = (wakeOn && !STATE.liveOn) ? (0.09 + 0.05 * Math.sin(performance.now() / 900)) : 0;
    return { gold: Math.min(1, (STATE.mindPulse || 0) * 1.1), wake: Math.max(Math.min(1, wakePulseNow()), listen), stops: _orbStops, warm: c.warm, dim: c.dim };
  }
  // start/stop the LIVE overlay orb — WebGL when we can, the 2D drawOrb otherwise.
  function orbTap() {   // tap the orb → interrupt Q (the welcome starts automatically; shared by the WebGL + WebGPU canvases)
    if (STATE.ttsLevel > 0) { stopSpeaking(); capBargeAck(); STATE.live = "listening"; }
  }
  // orb-ready signal: the welcome holds its first word until the orb has actually PAINTED at least one
  // frame, so Q never speaks to a blank stage. armOrbReady() opens a fresh wait; orbPainted() releases it
  // on the first frame after the orb starts; orbReadyOr(ms) awaits it but never dead-ends on a slow orb.
  var _orbReadyP = null, _orbReadyRes = null;
  function armOrbReady() { _orbReadyP = new Promise(function (r) { _orbReadyRes = r; }); }
  function markOrbReady() { if (_orbReadyRes) { var r = _orbReadyRes; _orbReadyRes = null; try { r(); } catch (e) {} } }
  function orbPainted() { var raf = W.requestAnimationFrame || function (f) { return setTimeout(f, 16); }; try { raf(markOrbReady); } catch (e) { markOrbReady(); } }
  function orbReadyOr(ms) {
    var p = _orbReadyP; if (!p) return Promise.resolve();
    return new Promise(function (res) { var done = false; function fin() { if (!done) { done = true; res(); } } p.then(fin, fin); setTimeout(fin, ms); });
  }
  function startOrb() {
    cancelAnimationFrame(orbRaf);
    armOrbReady();                                                      // each open waits for THIS orb to paint
    try { refreshPalette(); } catch (e) {}                             // adopt the desktop's palette when the orb opens
    if (_rm) { orbMode = "2d"; if (liveGpuCanvas) liveGpuCanvas.style.display = "none"; if (liveCanvas) liveCanvas.style.display = ""; drawOrb(); orbPainted(); return; }   // reduced motion → the calm 2D orb
    // 1) WebGPU raymarched orb (the hero) on a DEDICATED canvas — gated, with the WebGL/2D orb as the floor.
    if (W.navigator && navigator.gpu && _gpuOk !== false) {
      ensureGpuMod().then(function (gm) {
        if (!STATE.liveOn) return;
        if (!(gm && gm.gpuSupported && gm.gpuSupported())) { startWebglOrb(); return; }
        if (!liveGpuCanvas) {
          liveGpuCanvas = DOC.createElement("canvas"); liveGpuCanvas.className = "hl-gpu";
          liveGpuCanvas.addEventListener("click", orbTap);
          if (liveEl) liveEl.insertBefore(liveGpuCanvas, liveCanvas);
        }
        if (liveGpuOrb) { liveGpuCanvas.style.display = ""; liveCanvas.style.display = "none"; orbMode = "webgpu"; try { liveGpuOrb.resize(); liveGpuOrb.start(); } catch (e) {} orbPainted(); return; }
        gm.createGpuOrb(liveGpuCanvas, { descriptor: gm.ORB_GPU_DESCRIPTOR || null, level: orbLevel, color: orbColor }).then(function (g) {
          if (!STATE.liveOn) { try { g.dispose(); } catch (e) {} return; }
          liveGpuOrb = g; _gpuOk = true; liveGpuCanvas.style.display = ""; liveCanvas.style.display = "none"; orbMode = "webgpu"; g.resize(); g.start(); orbPainted();
        }, function (e) {
          _gpuOk = false; console.warn("[HoloVoice] WebGPU orb unavailable — using the WebGL orb:", e && e.message || e);
          if (liveGpuCanvas) liveGpuCanvas.style.display = "none"; startWebglOrb();
        });
      }, function () { startWebglOrb(); });
      return;
    }
    startWebglOrb();
  }
  function startWebglOrb() {
    if (liveGpuCanvas) liveGpuCanvas.style.display = "none";
    if (liveCanvas) liveCanvas.style.display = "";
    ensureOrbMod().then(function (m) {
      if (!STATE.liveOn) return;
      if (m && m.orbSupported && m.orbSupported()) {
        try {
          if (!liveOrb) liveOrb = m.createOrb(liveCanvas, { detail: 8, level: orbLevel, color: orbColor });
          orbMode = "webgl"; liveOrb.resize(); liveOrb.start(); orbPainted(); return;
        } catch (e) { console.warn("[HoloVoice] 3D orb init failed — using the 2D orb:", e && e.message || e); liveOrb = null; }
      }
      orbMode = "2d"; drawOrb(); orbPainted();
    }, function () { orbMode = "2d"; drawOrb(); orbPainted(); });
  }
  function stopOrb() { if (liveGpuOrb) { try { liveGpuOrb.stop(); } catch (e) {} } if (liveOrb) { try { liveOrb.stop(); } catch (e) {} } cancelAnimationFrame(orbRaf); }
  // the floating button becomes a tiny living orb too (its own WebGL instance; the 🎙 glyph is the fallback).
  function mountBtnOrb() {
    if (_rm || !btn) return;
    ensureOrbMod().then(function (m) {
      if (!btn || !m || !(m.orbSupported && m.orbSupported())) return;
      try {
        var c = DOC.createElement("canvas"); c.className = "hv-btn-orb"; c.setAttribute("aria-hidden", "true");
        btn.insertBefore(c, btn.firstChild);
        btnOrb = m.createOrb(c, { detail: 4, spin: 0.8, level: orbLevel, color: orbColor });
        btn.setAttribute("data-orb", "1"); btnOrb.start();
      } catch (e) { btnOrb = null; }
    });
  }
  // ── Q as a holospace object — a frameless, movable, resizable, κ-addressed desktop orb ─────────────
  // Registered as a Holo Widget TYPE: the host gives it drag · resize · persistence · a κ address, like
  // every other holospace object; Q owns only the orb body (no card frame). Tap → talk; it stays alive
  // (idle breath + your voice + the gold mind-flare). Registered at eval so a saved orb restores on boot.
  function registerQWidget() {
    if (!W.HoloWidgets || registerQWidget._done) return; registerQWidget._done = true;
    W.HoloWidgets.define("q", {
      name: "Q", icon: "sparkles", blurb: "Mine, on this device. Tap to talk.",
      sticky: true,                                              // a SYSTEM affordance — survives desktop-mode switches, never folded into a mode's board
      defaultW: 120, minW: 64, maxW: 440,
      render: function (h) {
        var canvas = DOC.createElement("canvas"); h.body.appendChild(canvas);
        var inst = null, gone = false;
        ensureOrbMod().then(function (m) {
          if (gone) return;
          if (m && m.orbSupported && m.orbSupported()) {
            try { inst = m.createOrb(canvas, { detail: 5, level: orbLevel, color: orbColor }); inst.start(); return; } catch (e) {}
          }
          canvas.style.display = "none";                                  // no WebGL → the animated spectrum DISC (the orb's fallback form), NEVER a 🎙 mic glyph
          var g = DOC.createElement("div"); g.setAttribute("aria-hidden", "true");
          g.style.cssText = "position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,var(--holo-spectrum,#5b8cff,#7c5cff,#b14eff,#ff4ed0,#ff6b6b,#ffc440,#2bd4ff,#5b8cff));-webkit-mask:radial-gradient(circle,transparent 30%,#000 33%,#000 62%,transparent 66%);mask:radial-gradient(circle,transparent 30%,#000 33%,#000 62%,transparent 66%);animation:hv-spin 7s linear infinite";
          h.body.appendChild(g);
        });
        h.cleanup(function () { gone = true; if (inst) { try { inst.dispose(); } catch (e) {} inst = null; } });
      },
      onTap: function () { openQPanel(); },                              // tap the orb → open the docked Q panel
      onDouble: function () { openLive(); },                             // double-tap → full-screen immersive voice
      menuItems: function () { return [
        { label: "💬  Open Q", fn: function () { openQPanel(); } },
        { label: "🎙  Immersive voice", fn: function () { openLive(); } },
        { label: wakeOn ? "👂  Always listening · on" : ("👂  Always listen for “" + wakePhrase() + "”"), fn: function () { toggleWake(); } },
        { label: "⚙  Settings…", fn: function () { try { toggleMenu(); } catch (e) {} } },
      ]; },
    });
  }
  // ENSURE exactly one Q orb is on the desktop, at the user's last position. The shell drives per-holospace
  // boards (its own restore can replace the runtime's), so rather than depend on board persistence we keep
  // the orb's position in our OWN key and re-place the orb if it's missing after the shell settles. Moving
  // or resizing it is captured via onChange → survives reload. Self-contained + idempotent (never >1 live).
  var QPOS_LS = "holo.voice.orb.pos.v2";   // v2: re-anchors a stale mid-screen orb to the bottom-right home
  function savedQPos() { try { var v = JSON.parse(localStorage.getItem(QPOS_LS) || "null"); if (v && typeof v.x === "number") return v; } catch (e) {} return null; }
  // the orb's canonical resting place: bottom-right, one margin in, clearing the dock rail + the credit gutter.
  function orbHome() {
    var gs = getComputedStyle(DOC.documentElement);
    var dH = parseFloat(gs.getPropertyValue("--holo-dock-h")) || 0;     // a bottom dock, if any
    var gb = parseFloat(gs.getPropertyValue("--gap-b")) || 34;          // the "Powered by HOLOGRAM" gutter
    var w = 120, m = 28;
    return { x: Math.round((W.innerWidth || 1280) - m - w), y: Math.round((W.innerHeight || 800) - dH - gb - m - w), w: w };
  }
  function ensureQWidget() {
    if (!W.HoloWidgets) return;
    if (!ensureQWidget._wired && W.HoloWidgets.onChange) {        // remember where you put it (move/resize persist)
      ensureQWidget._wired = true;
      W.HoloWidgets.onChange(function (board) {
        try { var q = (board || []).filter(function (w) { return w.type === "q" && !w.hidden; })[0];
          if (q) localStorage.setItem(QPOS_LS, JSON.stringify({ x: q.x, y: q.y, w: q.w, moved: !!q.moved })); } catch (e) {}
      });
    }
    var tries = 0;
    (function attempt() {
      if (++tries > 30 || !W.HoloWidgets) return;
      var liveQ = false; try { liveQ = W.HoloWidgets.list().some(function (w) { return w.type === "q"; }); } catch (e) {}
      if (liveQ) { firstMeeting(); return; }                     // already present (restored or added) — done
      if (tries < 8) { setTimeout(attempt, 200); return; }       // let the shell restore its board first (~1.6s)
      var p = savedQPos() || orbHome();
      try { var qw = W.HoloWidgets.add("q", null, { x: p.x, y: p.y, w: p.w || 120 }); if (qw && p && p.moved) qw._userMoved = true; } catch (e) {}   // restore the "user placed it" opt-out so it isn't yanked back to the corner
      firstMeeting();
    })();
  }
  // ── Q whisper — the ambient companion's voice: a soft bubble by the orb, one at a time, auto-dismissing.
  //    The shared primitive behind the first meeting AND the per-stage invitations (Q Companion journey,
  //    q-companion-journey.md). Visual by default — calm, never forced audio; tap runs opts.onTap. ──
  function injectWhisperCSS() {
    if (DOC.getElementById("hv-whisper-css")) return;
    var s = DOC.createElement("style"); s.id = "hv-whisper-css";
    s.textContent = ".hv-whisper{position:fixed;z-index:2147483600;max-width:264px;padding:11px 15px;border-radius:15px;"
      + "font:600 var(--holo-text-sm, 0.938rem)/1.42 var(--holo-font,system-ui,sans-serif);color:var(--holo-ink,#e8eef5);"
      + "background:color-mix(in srgb,var(--holo-bg,#0b0d12) 84%,transparent);"
      + "border:1px solid color-mix(in srgb,var(--holo-accent,#7b5cff) 42%,transparent);"
      + "box-shadow:0 12px 44px rgba(0,0,0,.5);backdrop-filter:blur(15px) saturate(1.3);-webkit-backdrop-filter:blur(15px) saturate(1.3);"
      + "opacity:0;transform:translateY(calc(-100% + 7px));transition:opacity .38s ease,transform .42s cubic-bezier(.2,.85,.25,1);cursor:pointer;}"
      + ".hv-whisper.on{opacity:1;transform:translateY(-100%);}"
      + ".hv-whisper::after{content:'';position:absolute;left:22px;bottom:-6px;width:13px;height:13px;background:inherit;"
      + "border-right:1px solid color-mix(in srgb,var(--holo-accent,#7b5cff) 42%,transparent);"
      + "border-bottom:1px solid color-mix(in srgb,var(--holo-accent,#7b5cff) 42%,transparent);transform:rotate(45deg);}";
    (DOC.head || DOC.documentElement).appendChild(s);
  }
  function qWhisper(text, opts) {
    opts = opts || {};
    if (STATE.liveOn) return { dismiss: function () {} };   // the live overlay already greets/converses — never double up with a bubble
    try {
      injectWhisperCSS();
      var prev = DOC.getElementById("hv-whisper"); if (prev) prev.remove();
      var p = savedQPos() || orbHome(); var orbW = p.w || 120, vw = W.innerWidth || 1280;
      var b = DOC.createElement("div"); b.id = "hv-whisper"; b.className = "hv-whisper"; b.setAttribute("role", "status"); b.textContent = text;
      b.style.left = Math.max(12, Math.min(vw - 288, (p.x + orbW / 2) - 132)) + "px";
      b.style.top = Math.max(20, p.y - 14) + "px";
      DOC.body.appendChild(b);
      requestAnimationFrame(function () { b.classList.add("on"); });
      var killed = false;
      function dismiss() { if (killed) return; killed = true; b.classList.remove("on"); setTimeout(function () { try { b.remove(); } catch (e) {} }, 450); }
      b.addEventListener("click", function () { try { if (opts.onTap) opts.onTap(); } catch (e) {} dismiss(); });
      if (opts.ms !== 0) setTimeout(dismiss, opts.ms || 8000);
      return { dismiss: dismiss };
    } catch (e) { return { dismiss: function () {} }; }
  }
  // ── the first meeting — Q introduces itself ONCE, ever (HoloJourney.met). Ambient + visual (autoplay is
  //    blocked at first paint anyway); a tap opens Q. Calm, then it recedes. ──
  function firstMeeting() {
    if (firstMeeting._scheduled) return;
    try { var J = W.HoloJourney; if (!J || (J.met && J.met())) return; } catch (e) { return; }
    firstMeeting._scheduled = true;
    setTimeout(function () {
      try {
        var J = W.HoloJourney; if (!J || (J.met && J.met())) return;     // raced elsewhere
        if (J.markMet) J.markMet(); if (J.mark) J.mark("signed-in");
        // the magical beat: Q "comes alive" the instant its starter brain is warm — the orb blooms with the
        // greeting, so the hello coincides with Q actually being able to think. Capped so it always lands,
        // even if the model is slow to warm or this device can't run one.
        var greeted = false;
        var greet = function () {
          if (greeted) return; greeted = true;
          try { flareWake(); } catch (e) {}                             // the orb's "I'm awake" bloom
          qWhisper("Hello. I'm Q. I'm yours, and I learn as you do. Ask me anything, anytime.",
            { ms: 10000, onTap: function () { try { openQPanel(); } catch (e) {} } });
        };
        // Say hello promptly — do NOT warm the ~348MB starter just to TIME the greeting. That put the model
        // on the first-meeting boot of a shell that hosts every app, for a hello that never needed it. Q still
        // warms its brain the moment you OPEN it (this whisper's onTap → openQPanel → resolveBrain), so nothing
        // is lost; the hello simply no longer waits on a model download.
        setTimeout(greet, 1200);
      } catch (e) {}
    }, 1600);
  }
  // ── the per-stage invitations — Q's ONE calm, dismissible move per stage of the journey
  //    (q-companion-journey.md). All of Q's voice lives HERE; surfaces only mark milestones / cues on the
  //    sovereign journey κ (HoloJourney). Each invitation fires ONCE, ever, and points to the next horizon;
  //    a tap follows the thread (opens verify, import, …) through the shell — Q invites, never does it for you.
  function journeyOffer(key, text, go) {
    try {
      var J = W.HoloJourney; if (!J || !J.invited || !J.met || !J.met()) return;   // never before the first meeting
      if (J.invited(key)) return; J.markInvited(key);                              // once, ever — recorded in the κ
      qWhisper(text, { ms: 9000, onTap: function () {
        if (go) { try { W.dispatchEvent(new CustomEvent("holo-journey-go", { detail: { go: go } })); } catch (e) {} }
        else { try { openQPanel(); } catch (e) {} }
      } });
    } catch (e) {}
  }
  // the journey crossed a moment → offer the next horizon, once. Milestones come from HoloJourney.mark()
  // anywhere in this window; "cue" moments (e.g. Create opening, which isn't a milestone) the surface
  // dispatches directly. Paced by the user's own actions, so the invitations never stack.
  function onJourney(d) {
    d = d || {};
    if (d.kind === "milestone") {
      if (d.milestone === "first-space") journeyOffer("read", "Everything here is yours. Nothing leaves unless you say so.");
      else if (d.milestone === "first-creation") journeyOffer("own", "Don't take my word for it. Check me yourself.", "verify");
      else if (d.milestone === "first-verify") journeyOffer("explore", "Want to bring something in from the web? I'll make it yours.", "import");
    } else if (d.kind === "cue" && d.cue === "create-open") {
      journeyOffer("write", "Describe what you want. I'll build it with you.");
    }
  }
  try { W.addEventListener("holo-journey", function (e) { onJourney(e && e.detail); }); } catch (e) {}

  function withHW(fn) { var n = 0; (function p() { if (W.HoloWidgets) return fn(true); if (++n > 16) return fn(false); setTimeout(p, 120); })(); }

  function drawOrb() {
    if (!STATE.liveOn) return;
    var ctx = liveCtx || (liveCtx = (liveCanvas && liveCanvas.getContext) ? liveCanvas.getContext("2d") : null);
    if (!ctx) return;
    var dpr = W.devicePixelRatio || 1, w = liveCanvas.clientWidth, h = liveCanvas.clientHeight;
    if (liveCanvas.width !== Math.round(w * dpr)) { liveCanvas.width = Math.round(w * dpr); liveCanvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    var cx = w / 2, cy = h / 2, t = performance.now() / 1000, spin = _rm ? 0.12 : 1;
    var lvl = Math.max(STATE.ttsLevel * 1.1, STATE.micLevel * 5);      // mic is quieter than playback
    _smooth += (lvl - _smooth) * 0.18; var L = Math.min(_smooth, 1.3), M = mood(t, L);
    // Holo Mind pulse — when the orchestrator ACTS, the orb flares toward a signature gold and bursts a ring.
    var P = mindPulseNow();
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
  function setLive(s) { STATE.live = s; if (s === "listening") capClear(); }   // state is shown by the ORB, not a label; entering listening empties the ribbon (immersive, not frozen text)
  function capSay(who, text) { if (who === "you") { if (text) capUserText(text); else capClear(); } else { captionShow(captionText(text || "")); } }

  var _liveGreets = ["I'm here.", "Go ahead.", "I'm listening.", "Where do we start?"];
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  // Q PANEL — the unified, NON-MODAL assistant. A right-docked carriage that reuses --holo-aside-w (the
  // whole holospace glides left, exactly like Wallet) so you SEE the OS and converse with Q at once — the
  // in-browser-assistant experience. Voice is ONE input; the transcript is the spine; the full-screen
  // voice overlay (openLive) becomes an optional "immersive" toggle. Q reads + acts across the whole
  // κ-OS through the SAME router + tools the voice loop uses. Tapping the orb opens this.
  // ════════════════════════════════════════════════════════════════════════════════════════════════
  var qPanel = null, qThread = null, qInput = null, qMicBtn = null, qScopeBtn = null;
  var qPanelOpen = false, qScope = (function () { try { return W.localStorage.getItem("holo.voice.scope") || "os"; } catch (e) { return "os"; } })(), _qStreamEl = null, _silentTurn = false;
  var qScopeLabel = function () { return qScope === "os" ? "🌐 Whole OS" : "▢ This space"; };
  function qBubble(cls, text) {
    if (!qThread) return null;
    var empty = qThread.querySelector(".qp-empty"); if (empty) empty.remove();
    var el = DOC.createElement("div"); el.className = "qp-msg " + cls; el.textContent = text || "";
    qThread.appendChild(el); qThread.scrollTop = qThread.scrollHeight; return el;
  }
  function qActLine(text) { if (!qThread || !text) return; var el = DOC.createElement("div"); el.className = "qp-act"; el.textContent = text; qThread.appendChild(el); qThread.scrollTop = qThread.scrollHeight; }
  // the conversation sink — when the panel is open, EVERY turn (typed OR spoken) renders into the one
  // transcript. No-ops when closed, so it's free for the voice loop. converseAgent + handleText feed it.
  var _convoSink = {
    user: function (t) { if (qPanelOpen) qBubble("you", t); },
    qStart: function () { if (qPanelOpen) _qStreamEl = qBubble("q", ""); },
    qDelta: function (d) { if (_qStreamEl) { _qStreamEl.textContent += d; if (qThread) qThread.scrollTop = qThread.scrollHeight; } },
    qDone: function (reply, acted) { if (_qStreamEl) { if (reply && !_qStreamEl.textContent) _qStreamEl.textContent = reply; _qStreamEl = null; } if (acted && acted.length) qActLine("✓ " + acted.join(" · ")); },
    qSay: function (t) { if (qPanelOpen) qBubble("q", t); },
    act: function (s) { if (qPanelOpen && s) qActLine("✓ " + s); }
  };
  function buildQPanel() {
    if (qPanel) return qPanel;
    css();
    qPanel = DOC.createElement("aside"); qPanel.id = "q-panel"; qPanel.setAttribute("aria-label", "Q — your on-device assistant");
    qPanel.innerHTML =
      '<div class="qp-head"><canvas class="qp-orb"></canvas>' +
        '<div class="qp-id"><div class="qp-title">' + (CFG.wakeWord || "Q") + '</div><div class="qp-sub">on-device · private</div></div>' +
        '<button class="qp-scope" title="What Q can see and act on">🌐 Whole OS</button>' +
        '<div class="qp-icon qp-share" title="Share this chat as a link">↗</div>' +
        '<div class="qp-icon qp-immersive" title="Immersive voice mode">🎙</div>' +
        '<div class="qp-icon qp-close" title="Collapse (Esc)" aria-label="Collapse panel">»</div></div>' +
      '<div class="qp-thread"><div class="qp-empty">Ask me anything, or tell me what to do.<br><br>I can see and act across your whole OS — open apps, change settings, drive what’s on screen.</div></div>' +
      '<div class="qp-compose"><textarea class="qp-in" rows="1" placeholder="Ask ' + (CFG.wakeWord || "Q") + '…"></textarea>' +
        '<button class="qp-mic" title="Talk to Q">🎙</button><button class="qp-send" title="Send">↑</button></div>';
    DOC.body.appendChild(qPanel);
    qThread = qPanel.querySelector(".qp-thread"); qInput = qPanel.querySelector(".qp-in"); qMicBtn = qPanel.querySelector(".qp-mic"); qScopeBtn = qPanel.querySelector(".qp-scope");
    // the living orb in the header (the SAME spectral orb, small)
    ensureOrbMod().then(function (m) { try { if (m && m.orbSupported && m.orbSupported()) { var o = m.createOrb(qPanel.querySelector(".qp-orb"), { detail: 4, level: orbLevel, color: orbColor }); o.start(); qPanel._orb = o; } } catch (e) {} });
    var send = function () { var t = qInput.value.trim(); if (!t) return; qInput.value = ""; qInput.style.height = "40px"; qAsk(t); };
    qPanel.querySelector(".qp-send").addEventListener("click", send);
    qInput.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } else if (e.key === "Escape") closeQPanel(); });
    qInput.addEventListener("input", function () { qInput.style.height = "40px"; qInput.style.height = Math.min(120, qInput.scrollHeight) + "px"; });
    qMicBtn.addEventListener("click", qPanelMic);
    qScopeBtn.textContent = qScopeLabel();                              // reflect the persisted scope on open
    qScopeBtn.addEventListener("click", function () { qScope = qScope === "os" ? "tab" : "os"; qScopeBtn.textContent = qScopeLabel(); try { W.localStorage.setItem("holo.voice.scope", qScope); } catch (e) {} speakToast(qScope === "os" ? "Q can act across the whole OS." : "Q is focused on this space."); });
    qPanel.querySelector(".qp-immersive").addEventListener("click", function () { openLive(); });
    var shareEl = qPanel.querySelector(".qp-share"); if (shareEl) shareEl.addEventListener("click", function () { shareChat(); });
    qPanel.querySelector(".qp-close").addEventListener("click", closeQPanel);
    // golden scale is ratio-locked (no drag-resize) — just keep the holospace inset in sync as the
    // responsive width tracks the viewport, exactly like every other right carriage.
    W.addEventListener("resize", function () { if (qPanelOpen) try { DOC.documentElement.style.setProperty("--holo-aside-w", qPanel.offsetWidth + "px"); } catch (e) {} });
    return qPanel;
  }
  function openQPanel() {
    buildQPanel();
    if (qPanelOpen) { qInput && qInput.focus(); return; }
    try { W.HoloAside && W.HoloAside.closeAll && W.HoloAside.closeAll(); } catch (e) {}   // one carriage at a time — Q closes Play · Share · Notify · Create · Wallet
    qPanelOpen = true; qPanel.setAttribute("data-show", "1");
    try { DOC.documentElement.style.setProperty("--holo-aside-w", (qPanel.offsetWidth || 420) + "px"); DOC.documentElement.classList.add("q-panel-open"); } catch (e) {}
    if (btn) btn.setAttribute("data-on", "1");
    flareWake();                                                       // a teal "I'm here" beat as it slides in
    ensureMode(true); try { resolveBrain(); } catch (e) {}             // warm recognizer + tiered brain (starter now, full brain upgrades silently)
    setTimeout(function () { qInput && qInput.focus(); }, 140);
  }
  function closeQPanel() {
    if (!qPanelOpen) return; qPanelOpen = false;
    if (qPanel) qPanel.setAttribute("data-show", "0");
    try { DOC.documentElement.style.removeProperty("--holo-aside-w"); DOC.documentElement.classList.remove("q-panel-open"); } catch (e) {}
    if (btn) btn.removeAttribute("data-on");
    if (qMicBtn) qMicBtn.removeAttribute("data-on");
  }
  function toggleQPanel() { qPanelOpen ? closeQPanel() : openQPanel(); }
  // a typed turn: route deterministically (reliable commands), else converse — the proven handleText path,
  // rendered into the transcript and SILENT (text in → text out; the mic turn is what speaks).
  async function qAsk(text) {
    if (!text) return; openQPanel();
    _silentTurn = true;
    try { await handleText(text); }
    catch (e) { _convoSink.qSay("Sorry, that didn’t go through."); }
    finally { _silentTurn = false; }
  }
  // the panel mic: reuse the one-shot voice turn (it speaks, like a voice reply) and render it in the thread.
  function qPanelMic() {
    if (STATE.busy) { stopSpeaking(); return; }
    if (qMicBtn) qMicBtn.setAttribute("data-on", "1");
    Promise.resolve(activate()).finally(function () { if (qMicBtn) qMicBtn.removeAttribute("data-on"); });
  }

  async function openLive() {
    if (STATE.liveOn) return;
    if (!liveEl) buildLive();
    // SUPER-LOW-LATENCY OPEN: the orb shows + Q SPEAKS a pre-baked opener IMMEDIATELY (zero model wait),
    // while the ear (ASR) and voice (Kokoro) warm in the BACKGROUND. Nothing on the speak path blocks on a
    // cold model — the old `await ensureMode()` (loading Whisper before a single word) was the massive lag.
    STATE.liveOn = true; pauseWake(); STATE.live = "speaking"; capSay("you", ""); capSay("q", "");
    liveEl.setAttribute("data-show", "1"); if (btn) btn.setAttribute("data-on", "1");
    unlockAudio(); startOrb(); warm();                                           // gesture → prime audio + warm ear/voice (does NOT block)
    var greet = _liveGreets[Math.floor(Math.random() * _liveGreets.length)];
    var greeted = speakBaked(greet);                                            // instant baked clip → first word in ~tens of ms
    ensureMode().then(async function (mode) {                                    // resolve the recognizer in the BACKGROUND
      try { await greeted; } catch (e) {}                                        // let the opener finish before we start listening
      if (!STATE.liveOn) return;
      if (mode === "serverless") liveLoop(true);                                 // ear ready → live conversation (skipGreet: opener already spoken)
      else { setLive("idle"); capSay("q", "I'm always a tap away."); }           // no on-device ear → leave the orb inviting
    });
  }
  function closeLive() {
    STATE.liveOn = false; STATE.welcoming = false; stopSpeaking(); micClose(); stopOrb();
    _calmCaption = false; clearSentences(); if (capQ) capQ.classList.remove("hl-calm");   // back to the streaming ribbon for any later live conversation
    if (liveEl) { liveEl.setAttribute("data-show", "0"); liveEl.removeAttribute("data-mode"); } if (btn) btn.setAttribute("data-on", "0");
    STATE.busy = false; STATE.micLevel = 0; STATE.ttsLevel = 0;
    // leave Q LISTENING: after any conversation, (re)arm the wake word so "…Q" always wakes it again — the
    // mic permission is already granted from the call just ended, so this never prompts. Off only if the
    // user explicitly disabled it (holo.voice.wake === "0").
    try { if (localStorage.getItem("holo.voice.wake") !== "0") startWake(); else resumeWake(); } catch (e) { resumeWake(); }
  }

  // ── first-run welcome: Q greets a new visitor and tells the why / how / what of Hologram OS ────────
  // Autoplay needs one gesture, so we open with the orb gently breathing and a "Begin" invitation; the
  // first tap unlocks audio and Q speaks the welcome, then hands off to a live, hands-free conversation.
  var WELCOME = [
    "Hi, I'm Q, and welcome to Hologram. Most computers send your life off to someone else's servers. This one doesn't. It was built so the power stays with you. It's a whole operating system living right here in your browser, a desktop, apps, your files, with nothing to install and no account to make.",
    "And I run entirely on your device. I hear you, think, and speak without a single word ever leaving this machine.",
    "So just talk to me. Try 'open the browser', 'switch to dark mode', or ask me anything. I'm always one tap away. And from here, we learn, grow, and evolve together."
  ];
  async function welcome() {
    if (STATE.liveOn) return;
    if (!liveEl) buildLive();
    markWelcomed();   // mark this OPERATOR welcomed (per-κ) so the invitation shows once per signed-in identity
    STATE.liveOn = true; pauseWake(); STATE.welcoming = true; STATE.live = "welcome";
    liveEl.setAttribute("data-mode", "welcome");                    // calm greeting layout (orb → name → tagline); skip lives top-right
    capSay("you", ""); captionShow(captionText("Hi, I'm Q"));
    liveSub.textContent = "Your private, on-device guide to Hologram OS"; liveSub.style.display = "block";
    capHint.textContent = "";                                       // the only skip affordance is the top-right ✕ / Esc — no duplicate hint
    liveEl.setAttribute("data-show", "1"); if (btn) btn.setAttribute("data-on", "1");
    // Q READY AT LOGIN: warm ONLY the light 360M starter the instant the desktop greets a new user, so it
    // loads DURING the ~20s welcome (and the time the orb sits inviting a tap) — the first real question then
    // lands on a hot model with no "waking up" wait. The starter runs in the ORT worker (never freezes the
    // tab). The heavy 1.5B is deliberately NOT pre-warmed here: it would compile on the main thread and jank
    // the welcome's orb + speech ([[shell-perf]] "the 1.7GB froze the tab"). It upgrades SILENTLY on the first
    // real turn instead (resolveBrain), once the welcome's done. Fetch+compile need no gesture → honest pre-tap.
    try { warmStarter(); } catch (e) {}
    // WARM THE EAR TOO: load the streaming recognizer QUIETLY during the welcome, so the FIRST thing you say
    // streams into the ribbon word-by-word with no cold-start gap. ensureMode(true) joins the single in-flight
    // load (no double-warm), suppresses any "loading" toast, and — unlike the 1.5B brain — the tiny streaming
    // ear runs in the ORT worker, so it never janks the welcome's orb/speech ([[shell-perf]]).
    try { ensureMode(true); } catch (e) {}
    try { loadWelcomeBaked(); } catch (e) {}                          // LOW LATENCY: prefetch the pre-rendered welcome audio DURING the invite/orb phase so the first word is instant on begin
    startOrb();
    autoBegin();                                                      // speak automatically (autoplay) or on the first interaction — no button
  }
  // ── autoBegin: the welcome SPEAKS ITSELF. Browsers gate audio on a user gesture, so: if the AudioContext
  //    can already play (a gesture carried from the boot/login flow, or a permissive autoplay policy), Q
  //    speaks NOW; otherwise it speaks the instant the user first interacts (tap/key/touch) — armed once,
  //    self-disarming. No "begin" button, and never a silent dead end. ──
  function autoBegin() {
    var ac = null; try { ac = ensureAC(); } catch (e) {}
    var started = false;
    var gestEvents = ["pointerdown", "keydown", "touchstart", "touchend", "click"];   // user-activation events (NOT move/wheel)
    function offGest() { gestEvents.forEach(function (ev) { DOC.removeEventListener(ev, onGest, true); }); }
    function begin() { if (started) return; started = true; offGest(); if (STATE.welcoming) runWelcome(); }
    function onGest() { try { if (ac && ac.state === "suspended" && ac.resume) ac.resume(); } catch (e) {} begin(); }
    gestEvents.forEach(function (ev) { DOC.addEventListener(ev, onGest, true); });     // first real interaction → speak
    if (ac && ac.resume) { ac.resume().then(function () { if (ac.state === "running") begin(); }).catch(function () {}); }   // autoplay path (succeeds when a gesture already carried)
  }
  // ── INSTANT WELCOME for every new user (the fixed welcome script, PRE-RENDERED to content-addressed
  // audio and vendored). A brand-new user on a fresh device can't get instant neural speech while the
  // ~115MB voice model downloads+compiles — so we don't make them wait: a one-time bake renders the fixed
  // WELCOME lines to audio (voice/welcome.mjs), and the welcome plays it INSTANTLY (a tiny static asset,
  // no model), while Kokoro loads in the BACKGROUND for the conversation that follows. Magical + alive +
  // real-time for everyone; falls back to live synth (still works) if the audio isn't baked yet.
  var _welcomeBaked, _welcomeBakedP;   // undefined=untried · null=absent · object=present; _welcomeBakedP dedupes the in-flight import (prefetch ⊕ runWelcome share one fetch)
  function loadWelcomeBaked() {
    if (_welcomeBaked !== undefined) return Promise.resolve(_welcomeBaked);
    if (_welcomeBakedP) return _welcomeBakedP;
    _welcomeBakedP = import(BASE + "voice/welcome.mjs").then(function (m) { _welcomeBaked = (m && (m.WELCOME_AUDIO || m.default)) || null; return _welcomeBaked; }, function () { _welcomeBaked = null; return null; });
    return _welcomeBakedP;
  }
  // immersive-voice openers/closers, PRE-RENDERED (live-greets.mjs) → spoken INSTANTLY, zero model wait.
  var _liveBaked;
  function loadLiveBaked() {
    if (_liveBaked !== undefined) return Promise.resolve(_liveBaked);
    return import(BASE + "voice/live-greets.mjs").then(function (m) { _liveBaked = (m && (m.LIVE_GREETS || m.default)) || null; return _liveBaked; }, function () { _liveBaked = null; return null; });
  }
  // speak a FIXED line from its pre-baked clip (O(1), no model); fall back to live synth on a miss.
  async function speakBaked(text) {
    try {
      var baked = await loadLiveBaked();
      if (baked && baked.lines) {
        var ln = null; for (var i = 0; i < baked.lines.length; i++) if (baked.lines[i].text === text) { ln = baked.lines[i]; break; }
        if (ln) { try { if (W.speechSynthesis) W.speechSynthesis.cancel(); } catch (e) {} var dec = await decodeWavB64(ln.wav); karaReset(); await playPCM(dec.pcm, dec.rate, text); return { ok: true, runtime: "baked" }; }
      }
    } catch (e) {}
    return speakNatural(text);
  }
  function b64ToBuf(b64) { var bin = atob(b64), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return bytes.buffer; }
  function bufToB64(buf) { var bytes = new Uint8Array(buf), bin = ""; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin); }
  async function decodeWavB64(b64) { var ac = ensureAC(); var ab = await ac.decodeAudioData(b64ToBuf(b64)); return { pcm: ab.getChannelData(0).slice(), rate: ab.sampleRate }; }
  function encodeWav(float32, rate) {            // Float32 → 16-bit PCM WAV (for the bake)
    var n = float32.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
    function wstr(o, s) { for (var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); }
    wstr(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); wstr(8, "WAVE"); wstr(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); wstr(36, "data"); dv.setUint32(40, n * 2, true);
    var o = 44; for (var i = 0; i < n; i++) { var s = Math.max(-1, Math.min(1, float32[i])); dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2; }
    return buf;
  }
  // bakeWelcome() — render the fixed WELCOME lines to audio ONCE (needs Kokoro loaded; open Q first), and
  // download voice/welcome.mjs. Commit it → every new user's welcome is then INSTANT. ~600KB, one file.
  async function bakeWelcome(opts) {
    opts = opts || {}; var voice = opts.voice || CFG.voice;
    var t = await ensureTTS(); if (!t || !t.engine) throw new Error("Kokoro isn't loaded — talk to Q once, then bake");
    var lines = [];
    for (var i = 0; i < WELCOME.length; i++) {
      var line = WELCOME[i], a = await synthLocked(function () { return t.engine.synth(line, { voice: voice }); });
      if (a && a.audio) lines.push({ text: line, wav: bufToB64(encodeWav(a.audio, a.sampling_rate || 24000)) });
    }
    var mod = "// holo-voice welcome audio — the fixed first-run script PRE-RENDERED + content-addressed, so the\n" +
      "// welcome plays INSTANTLY for every new user (no model load). Re-bake any time: HoloVoice.bakeWelcome().\n" +
      "export const WELCOME_AUDIO = " + JSON.stringify({ voice: voice, lines: lines }) + ";\nexport default WELCOME_AUDIO;\n";
    try { var url = URL.createObjectURL(new Blob([mod], { type: "text/javascript" })); var el = DOC.createElement("a"); el.href = url; el.download = "welcome.mjs"; DOC.body.appendChild(el); el.click(); el.remove(); URL.revokeObjectURL(url); } catch (e) {}
    return { lines: lines.length, kb: Math.round(mod.length / 1024) };   // save the download to system/os/usr/lib/holo/voice/welcome.mjs
  }

  async function runWelcome() {
    if (!STATE.liveOn) return;
    capHint.textContent = "one moment…";
    unlockAudio();                                                   // autoBegin guarantees a gesture (or autoplay) → audio is allowed
    STATE.live = "speaking";
    var baked = await loadWelcomeBaked();                            // pre-rendered welcome audio → INSTANT (prefetched during the invite)
    warm();                                                          // load ear + voice in the BACKGROUND for the conversation
    // Q speaks ONLY once the orb has painted — never to a blank stage. Hold the centered greeting (orb ·
    // name · tagline) until then; capped so a slow/failed orb can't dead-end the welcome.
    await orbReadyOr(4000);
    if (!STATE.liveOn) return;
    liveEl.removeAttribute("data-mode");                            // greeting → conversation: ribbon drops to the lower third
    liveSub.style.display = "none";
    capHint.textContent = "";
    _calmCaption = true; if (capQ) capQ.classList.add("hl-calm");    // the welcome reads ONE calm sentence at a time (no streaming ribbon)
    if (baked && baked.lines && baked.lines.length) {
      for (var i = 0; i < baked.lines.length && STATE.liveOn; i++) {
        var ln = baked.lines[i];
        try { var dec = await decodeWavB64(ln.wav); karaReset(); await enqueuePCM(dec.pcm, dec.rate, ln.text); }   // play instantly + karaoke caption
        catch (e) { await speakNatural(ln.text); }
        if (!STATE.liveOn) return;
        await new Promise(function (r) { setTimeout(r, 220); });
      }
    } else {                                                          // not baked yet → live synth (still works; first line waits on the model)
      for (var j = 0; j < WELCOME.length && STATE.liveOn; j++) { await speakNatural(WELCOME[j]); if (!STATE.liveOn) return; await new Promise(function (r) { setTimeout(r, 220); }); }
    }
    if (!STATE.liveOn) return;
    STATE.welcoming = false;
    // Q has said its piece → the welcome bows out on its own. No live-conversation loop, no orb left
    // hanging: the glass blooms open and the desktop is revealed underneath. Q stays one word away —
    // revealDesktop()'s closeLive re-arms the wake word, so "…Q" summons it again any time.
    await revealDesktop();
  }
  // ── revealDesktop: the welcome's automatic, magical exit. Let the last word settle, then dissolve the
  //    overlay (the hl-reveal bloom) to uncover the desktop, and tear down (closeLive re-arms the wake word).
  async function revealDesktop() {
    capHint.textContent = "";
    await new Promise(function (r) { setTimeout(r, 640); });          // a warm beat so the final line lands before the screen clears
    if (!STATE.liveOn) return;                                        // the user already skipped (Esc / ✕) → nothing to dissolve
    if (liveEl && !_capReduce) {
      liveEl.classList.add("hl-reveal");                              // bloom + clear → the desktop fades up beneath
      await new Promise(function (r) { setTimeout(r, 820); });        // matches the hlReveal animation
    }
    closeLive();                                                      // stop the orb, arm the wake word — Q listens on, invisibly
    if (liveEl) liveEl.classList.remove("hl-reveal");                 // reset so a replay opens clean
  }
  var STOP_RE = /^(stop|exit|quit|cancel|never mind|nevermind|good ?bye|bye|that's all|thats all|thank you that's all|i'm done|im done|see you)\b/;
  // A turn where Q talks AND can be cut off. Speaks `say` (string) or runs `converse` (an agent turn),
  // watching the mic the whole time; if the user barges in, Q goes quiet and we grab what they're saying
  // straight away (preSpoke) so nothing is lost. Returns the next utterance's audio, or null.
  async function speakTurn(opts) {
    setLive("speaking");
    var ctl = { aborted: false }, activity;
    // the caption is built by KARAOKE during playback (capQ follows the audio). capSay here is only a
    // FALLBACK — set the full text only if karaoke didn't fill it (e.g. the speechSynth floor).
    if (opts.converse) { activity = converseAgent(opts.text, ctl).then(function (r) { if (capQ && !capQ.textContent && r && r.reply) capSay("q", r.reply); }); }
    else { activity = speakNatural(opts.say); }
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
        if (!text) { _turn = null; if (++empties >= 3) { setLive("speaking"); var idle = "I'm here whenever you need me."; capSay("q", idle); await speakBaked(idle); break; } continue; }
        empties = 0; capSay("you", text);
        if (STOP_RE.test(norm(text))) { _turn = null; setLive("speaking"); var bye = "Talk soon."; capSay("q", bye); await speakBaked(bye); break; }
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

  // First-run is PER-OPERATOR: the welcome is shown once per signed-in identity (keyed by the operator κ),
  // never for a guest. A no-identity context (non-shell top-level) falls back to the legacy global flag.
  function _welKey(op) { return "holo.voice.welcomed" + (op ? "." + op : ""); }
  function hasWelcomed(op) {
    try { return op ? localStorage.getItem(_welKey(op)) === "1" : localStorage.getItem("holo.voice.welcomed") === "1"; }
    catch (e) { return false; }
  }
  function markWelcomed() {
    try {
      localStorage.setItem("holo.voice.welcomed", "1");                     // legacy/global flag (back-compat)
      var id = W.HoloIdentity; if (id && !id.guest && id.operator) localStorage.setItem(_welKey(id.operator), "1");
    } catch (e) {}
  }
  function start() {
    if (!DOC.body) { setTimeout(start, 30); return; }
    mount(); wireHotkey(); bindSeam(); mountMCP(); wireMindOrb();   // expose Q's tools to Holo Mind + make its actions visible on the orb
    // Wake-word arming + first-run welcome are decided TOGETHER, once the signed-in identity resolves (see
    // the identity-gated block at the end of start()): a guest never gets the welcome; a returning operator
    // arms the wake word immediately; a brand-new operator gets the wake word armed at the END of the welcome.
    // presence: any interaction keeps Q lively; it settles into a serene calm after a while idle.
    try { ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"].forEach(function (ev) { DOC.addEventListener(ev, markActive, { passive: true }); }); } catch (e) {}
    // pause the always-on orbs while the tab is hidden (no wasted GPU); resume on return.
    DOC.addEventListener("visibilitychange", function () {
      var hidden = DOC.hidden;
      if (btnOrb) { try { hidden ? btnOrb.stop() : btnOrb.start(); } catch (e) {} }
      if (liveOrb && STATE.liveOn && orbMode === "webgl") { try { hidden ? liveOrb.stop() : liveOrb.start(); } catch (e) {} }
      if (liveGpuOrb && STATE.liveOn && orbMode === "webgpu") { try { hidden ? liveGpuOrb.stop() : liveGpuOrb.start(); } catch (e) {} }
      if (!hidden) try { refreshPalette(); } catch (e) {}                 // re-adapt to the wallpaper/accent on return
    });
    try { setTimeout(refreshPalette, 2200); } catch (e) {}                // adapt the orb to your desktop once it has settled
    // FIRST-RUN Q WELCOME — keyed to the SIGNED-IN identity, deterministically (we wait for HoloIdentity, the
    // shell's verified operator), and NEVER for a guest. A returning operator arms the wake word instead.
    // Skipped on shared deep links (?app=/?open=/?run=) so a shared holospace runs instantly. The welcomed
    // flag is PER-OPERATOR (operator κ), so someone who first browsed as a guest still gets the welcome on
    // their first real sign-in. (Cold-start stays lazy: Q warms its brain when opened; the L0 seed κ-memo
    // answers common first questions with zero model. Pre-warm a kiosk with HoloVoice.warmStarter().)
    try {
      var _pq = new URLSearchParams(location.search), _deep = _pq.has("app") || _pq.has("open") || _pq.has("run");
      var _wokeOrWelcomed = false;
      function _armWake() { if (_wokeOrWelcomed) return; _wokeOrWelcomed = true; if (localStorage.getItem("holo.voice.wake") !== "0") setTimeout(function () { try { startWake(); } catch (e) {} }, 800); }
      // Decide ONLY from a RESOLVED identity. Welcome fires for a non-guest OPERATOR on their first run — never
      // for a guest, never for a null/unresolved identity (so a slow shell boot can't accidentally greet anyone).
      function onIdentity(id) {
        if (_wokeOrWelcomed) return;
        var op = (id && !id.guest && id.operator) ? id.operator : null;   // a guest / unresolved id → op is null → no welcome
        if (!_deep && op && !hasWelcomed(op)) {   // a NEW signed-in operator → greet them
          _wokeOrWelcomed = true;
          // PREWARM the moment we KNOW we'll welcome (not waiting for the overlay): the ear (ensureMode,
          // quiet) + the starter brain (warmStarter) load in their background workers through the SAME
          // loaders the turn uses — so by the time the welcome finishes speaking the first reply is hot.
          // Fires ONLY for the authenticated first-timer (never a guest), so the shell-perf budget is safe.
          try { warmStarter(); } catch (e) {}
          try { ensureMode(true); } catch (e) {}
          setTimeout(function () { try { welcome(); } catch (e) {} }, 350);   // welcome arms the wake word at its end
        }
        else _armWake();                                                  // guest / returning / no-op → arm the wake word now
      }
      if (W.HoloIdentity) onIdentity(W.HoloIdentity);                     // identity already resolved
      else {
        W.addEventListener("holo-identity", function (e) { onIdentity((e && e.detail) || W.HoloIdentity || null); });   // stays armed for a SLOW identity (operator resolving late still gets welcomed)
        setTimeout(function () { if (!W.HoloIdentity) _armWake(); }, 4000);   // safety: identity never came (non-shell) → arm wake, but NEVER welcome
      }
    } catch (e) {}
  }
  try { registerQWidget(); } catch (e) {}   // register the "q" widget TYPE at eval — before the board restores, so a saved Q remounts (shell loads widgets first)
  if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", start); else start();

  // ── simplicity: ONE word swaps the whole feel, so nobody touches the ~two dozen low-level knobs. ──
  // The default ("natural") IS the full magical experience out of the box — zero config, just tap & talk.
  var PRESETS = {
    natural: { turnSilenceMs: 250, turnSilenceDone: 130, turnContinueMs: 600, backchannel: true, backchannelChance: 0.55, stream: true, mind: true, mindSpeak: true, confirmActions: true },   // default: converse first, ask before acting
    snappy:  { turnSilenceMs: 200, turnSilenceDone: 90, turnContinueMs: 450, backchannel: false, stream: true, mind: true, mindSpeak: true, confirmActions: false },                          // fast, acts immediately
    calm:    { turnSilenceMs: 350, turnSilenceDone: 200, turnContinueMs: 800, backchannel: true, backchannelChance: 0.85, stream: true, mind: true, mindSpeak: true, confirmActions: true },   // patient, very attentive
    minimal: { backchannel: false, mind: false, mindSpeak: false, proactive: false, confirmActions: false },                                                            // plain voice control, immediate
  };
  function preset(name) { var p = PRESETS[name]; if (!p) return null; Object.assign(CFG, p); return name; }

  // ── SHARE A CHAT: a conversation is content you can hand someone as a link. shareChat() packs Q's live
  //    _history into a URL #fragment (serverless — never hits a server); opening a #chat= link restores it
  //    into Q and the brain re-prefills the FULL history → continues from the exact point. Token-exact
  //    resume witnessed in the forge harness; Q's chat is the same createHoloBrain. ──────────────────────
  function shareChat() {
    var msgs = _history.slice(1).filter(function (m) { return m && (m.role === "user" || m.role === "assistant") && m.content; });
    if (!msgs.length) { speakToast("Nothing to share yet — ask me something first."); return null; }
    var link = null;
    try { var b64 = btoa(unescape(encodeURIComponent(JSON.stringify({ v: 1, model: "Q", system: sysPrompt(), messages: msgs })))); link = location.origin + location.pathname + "#chat=" + encodeURIComponent(b64); } catch (e) { return null; }
    try { navigator.clipboard && navigator.clipboard.writeText(link); } catch (e) {}
    speakToast("Chat link copied — whoever opens it lands exactly here.");
    try { W.dispatchEvent(new CustomEvent("holo-chat-shared", { detail: { link: link, turns: msgs.length } })); } catch (e) {}
    return link;
  }
  function restoreChat(src) {
    var h = src || location.hash || ""; var m = h.match(/chat=([^&]+)/); if (!m) return false;
    var p; try { p = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1]))))); } catch (e) { return false; }
    if (!p || !p.messages || !p.messages.length) return false;
    _history = [{ role: "system", content: sysPrompt() }].concat(p.messages);   // converseAgent refreshes [0] with the live OS context on the next turn
    openQPanel(); if (qThread) qThread.innerHTML = "";
    p.messages.forEach(function (msg) { qBubble(msg.role === "user" ? "you" : "q", msg.content); });
    speakToast("Restored a shared chat — pick up right where it left off.");
    try { W.history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    try { W.dispatchEvent(new CustomEvent("holo-chat-restored", { detail: { turns: p.messages.length } })); } catch (e) {}
    return true;
  }
  // CARRIAGE (ADR-0105): the cross-device / IPFS form of a shared chat. shareChatCarriage() seals the
  // conversation into an IPFS κ-DAG and emits a #wks= link (self-contained CAR, never hits a server; pinnable
  // to #car= via Pinata). restoreChatCarriage() decodes + re-derives every block (L5) → the conversation,
  // and hands it to Q. The simple #chat= fragment (shareChat) stays the instant offline form. The seal/restore
  // primitives (sealWorkspace/encodeResumeLink/decodeResumeLink/restoreWorkspace) are witnessed (5/5 round-trip).
  var _wsMod = null;
  function carriageMod() { if (!_wsMod) _wsMod = import("/sbin/holo-workspace-sync.mjs").catch(function () { return null; }); return _wsMod; }
  function chatMessages() { return _history.slice(1).filter(function (m) { return m && (m.role === "user" || m.role === "assistant") && m.content; }); }
  async function shareChatCarriage() {
    var msgs = chatMessages(); if (!msgs.length) { speakToast("Nothing to share yet — ask me something first."); return null; }
    var ws = await carriageMod();
    if (!ws || !ws.sealWorkspace) return shareChat();      // carriage absent (off-shell) → self-contained #chat=
    var manifest = { "@type": ["holo:SessionManifest"], "holo:kind": "holo:ChatShare", "holo:conversation": { model: "Q", system: sysPrompt(), messages: msgs } };
    var sealed = await ws.sealWorkspace({ manifest: manifest, transport: "link" });
    var url = location.origin + location.pathname + "#wks=" + ws.encodeResumeLink(sealed.rootCid, sealed.blocks);
    try { navigator.clipboard && navigator.clipboard.writeText(url); } catch (e) {}
    speakToast("Chat link copied — opens anywhere, verified block-by-block.");
    window.__shareWks = url;
    try { W.dispatchEvent(new CustomEvent("holo-chat-shared", { detail: { link: url, transport: "wks", rootCid: sealed.rootCid, turns: msgs.length } })); } catch (e) {}
    return url;
  }
  async function restoreChatCarriage(h) {
    var ws = await carriageMod(); if (!ws || !ws.decodeResumeLink) return false;
    var got = ws.decodeResumeLink(h || location.hash || ""); if (!got || !got.roots || !got.roots[0]) return false;
    var r = await ws.restoreWorkspace(got.roots[0], ws.verifiedBlockSource(got.blocks));   // L5: every block re-derived before use
    var conv = r && r.manifest && r.manifest["holo:kind"] === "holo:ChatShare" && r.manifest["holo:conversation"];
    if (!conv) return false;                                // not a chat → leave the #wks= for the holospace boot-resume
    _history = [{ role: "system", content: sysPrompt() }].concat(conv.messages || []);
    openQPanel(); if (qThread) qThread.innerHTML = "";
    (conv.messages || []).forEach(function (msg) { qBubble(msg.role === "user" ? "you" : "q", msg.content); });
    speakToast("Restored a shared chat (verified) — pick up where it left off.");
    try { W.history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    try { W.dispatchEvent(new CustomEvent("holo-chat-restored", { detail: { turns: (conv.messages || []).length, transport: "wks" } })); } catch (e) {}
    return true;
  }
  // OPEN-BY-LINK: #model=<κ> loads that model as Q's brain via the SW κ-route (/.holo/sha256/<κ> → IPFS, L5);
  // #adapter=<κ> carries a fine-tune to apply on top (the brain-forward application is the adapter-in-Q track).
  // The link is a content hash — the bytes arrive verified, nothing of the user's is sent.
  function openModelLink(modelKappa, adapterKappa) {
    var mk = /^[0-9a-f]{64}$/i.test(modelKappa || "") ? modelKappa.toLowerCase() : "";
    var ak = /^[0-9a-f]{64}$/i.test(adapterKappa || "") ? adapterKappa.toLowerCase() : "";
    if (!mk && !ak) return false;
    CFG.holoAdapterKappa = ak;
    if (mk) { CFG.holoBrain = true; CFG.holoModelKappa = mk; }   // a linked model κ becomes Q's brain (else keep the default base, with the adapter on top)
    // a linked model OR adapter changes what the brain IS — drop the current engine so the next warm rebuilds it
    // fresh (the adapter is bound at engine-BUILD time; without this reset an already-loaded brain would silently
    // ignore an adapter-only link). This is what makes #adapter= seamless: open the link, no settings, it applies.
    try { resetBrain(); } catch (e) {} _holoBrain = null; _holoBrainTried = false; _holoBrainLoading = null;
    openQPanel();
    speakToast(ak ? (mk ? "Opening a shared model + adapter by link…" : "Applying a shared adapter…") : "Opening a shared model by link…");
    try { warmStarter(); } catch (e) {}   // EAGER warm: stream the linked κ (model and/or adapter) NOW so the first turn lands ready (κ-route → IPFS heal, per-block L5)
    try { W.dispatchEvent(new CustomEvent("holo-model-opened", { detail: { model: mk, adapter: ak } })); } catch (e) {}
    try { W.history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    return true;
  }
  // boot link router: a shared CHAT, MODEL, or ADAPTER link opened as a URL → the right surface (chat → restore;
  // model/adapter → load as Q's brain). Holospace/workspace links (#wks=/#car=) are handled by resolveBootResume.
  function maybeRestoreShared() {
    var h = location.hash || "";
    if (/[#&]chat=/.test(h)) { try { restoreChat(); } catch (e) {} return; }
    var mm = h.match(/[#&]model=([0-9a-fA-F]{64})/), am = h.match(/[#&]adapter=([0-9a-fA-F]{64})/);
    if (mm || am) { try { openModelLink(mm && mm[1], am && am[1]); } catch (e) {} return; }
    if (/[#&]wks=/.test(h)) { restoreChatCarriage(h).catch(function () {}); }   // a CARRIAGE chat link → Q (non-chat #wks= returns false, left for the shell's holospace boot-resume)
  }
  if (DOC.readyState === "loading") DOC.addEventListener("DOMContentLoaded", function () { setTimeout(maybeRestoreShared, 60); }); else setTimeout(maybeRestoreShared, 60);

  // ── public API ──────────────────────────────────────────────────────────────────────────────────
  W.HoloVoice = {
    version: "0.47",
    preset: preset,
    orb: function () { var k = (liveGpuOrb && liveGpuOrb.getKappa && liveGpuOrb.getKappa()) || (liveOrb && liveOrb.getKappa && liveOrb.getKappa()) || (btnOrb && btnOrb.getKappa && btnOrb.getKappa()) || null; return { live: !!liveOrb, gpu: !!liveGpuOrb, button: !!btnOrb, mode: orbMode, three: !!(W.THREE), webgpu: !!(W.navigator && navigator.gpu), supported: !!(_orbMod && _orbMod.orbSupported && _orbMod.orbSupported()), kappa: k }; },   // orb status (κ-addressed; WebGPU hero + WebGL floor)
    orbKappa: function () { return (liveOrb && liveOrb.getKappa && liveOrb.getKappa()) || (btnOrb && btnOrb.getKappa && btnOrb.getKappa()) || null; },   // the orb's did:holo:sha256 (its form as a content address)
    orbDescriptor: function () { return _orbMod && _orbMod.ORB_DESCRIPTOR ? JSON.parse(JSON.stringify(_orbMod.ORB_DESCRIPTOR)) : null; },                  // the κ-object: geometry + golden framing + transform stack
    adaptOrb: function () { try { _orbStopsSig = ""; refreshPalette(); } catch (e) {} return _orbStops; },   // re-derive the orb palette from the wallpaper/accent
    orbPalette: function () { return _orbStops; },                                                          // the current adaptive spectrum stops (null = brand)
    bakeWelcome: bakeWelcome,             // render the welcome script to vendored audio → instant for every new user                       // preset("natural"|"snappy"|"calm"|"minimal") — the whole feel in one word
    turnComplete: turnComplete,           // is this utterance semantically done? (adaptive endpoint scorer)
    metrics: function () { return LAST_METRICS; },                     // last turn's latency breakdown (ms from end-of-speech)
    tune: function (p) { Object.assign(CFG, p || {}); return Object.assign({}, CFG); },   // live-tune turn-taking/barge-in, no reload
    levels: function () { return { mic: STATE.micLevel, tts: STATE.ttsLevel, live: STATE.live, liveOn: STATE.liveOn }; },   // live meters (for calibration)
    welcome: welcome,                      // first-run greeting: Q tells the why / how / what (replayable)
    live: openLive, endLive: closeLive,   // the magical voice-to-voice conversation overlay
    // DEV: exercise the conversation VISUALS without a microphone (some sandboxes block getUserMedia).
    // caption.* drives the ribbon primitives directly; demoUser streams a line in as the USER (growing
    // partials, like live transcription), then optionally hands the floor to Q so you can see the crossover.
    caption: { user: capUserText, q: function (t) { captionShow(captionText(t)); }, clear: capClear, barge: capBargeAck, speaker: function () { return _capSpeaker; } },
    demoUser: function (text, opts) {
      opts = opts || {}; if (!liveEl) buildLive();
      if (!STATE.liveOn) { STATE.liveOn = true; liveEl.setAttribute("data-show", "1"); if (btn) btn.setAttribute("data-on", "1"); try { startOrb(); } catch (e) {} }
      STATE.live = "listening"; capClear();
      var words = String(text || "").split(/\s+/).filter(Boolean), acc = [], i = 0;
      return new Promise(function (res) {
        (function step() {
          if (!STATE.liveOn || i >= words.length) { res(acc.join(" ")); return; }
          acc.push(words[i++]); capUserText(acc.join(" ")); setTimeout(step, opts.wordMs || 200);
        })();
      });
    },
    activate: activate,                    // quick one-shot push-to-talk (Alt+V)
    // dictate() — capture one utterance and RETURN the on-device transcript (no action routing). The
    // one-shot ear, exposed for surfaces that want raw text (e.g. Play's "ask" filter via q.dictate).
    dictate: async function () {
      if (STATE.busy) return "";
      STATE.busy = true;
      try { pauseWake(); } catch (e) {}
      try { setBtn(true); } catch (e) {}
      try { hud("listening", "Listening…"); } catch (e) {}
      try { var t = await recognize(); STATE.lastText = t || ""; if (!t) { try { hud("miss", "Didn’t catch that."); } catch (e) {} } return t || ""; }
      catch (e) { var denied = /denied|not-allowed|permission/i.test(String(e)); try { hud("error", denied ? "I need your microphone to hear you." : "Something slipped."); } catch (_) {} return ""; }
      finally { STATE.busy = false; try { setBtn(false); } catch (e) {} try { resumeWake(); } catch (e) {} setTimeout(function () { try { if (!STATE.busy) hide(); } catch (e) {} }, 1800); }
    },
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
    setGpuBrain: setGpuBrain,             // setGpuBrain(true|false) → opt into the ternary qwen-coder-7b GPU coder (ADR-0096); WASM Coder-1.5B floor on fallback (persisted)
    testWebGPU: testWebGPU,               // real-hardware self-check; auto-reverts on garbage output
    startWake: startWake, stopWake: stopWake, toggleWake: toggleWake,  // hands-free wake word, serverless + persisted; toggleWake = one-tap on/off w/ feedback
    wakeDebug: function (on) { WAKE.debug = on !== false; if (WAKE.debug) speakToast("Wake debug on — open the console and say “" + wakePhrase() + "”."); return WAKE.debug; },   // log every segment: what Whisper heard + VAD + match
    openPanel: openQPanel, closePanel: closeQPanel, togglePanel: toggleQPanel, ask: qAsk,   // the docked Q panel — see the OS + converse/act together; ask(text) drives a turn
    shareChat: shareChat, restoreChat: restoreChat,   // a conversation is a content link: shareChat()→#chat= URL fragment (serverless); restoreChat() rehydrates Q + the brain re-prefills (exact resume)
    shareChatCarriage: shareChatCarriage, restoreChatCarriage: restoreChatCarriage,   // the IPFS/cross-device form: seal→#wks= CAR (pinnable→#car=), restore re-derives every block (L5)
    openModelLink: openModelLink,   // open a model/adapter BY κ-link: loads it as Q's brain via the SW κ-route (/.holo/sha256/<κ> → IPFS, L5)
    context: function () { return qContext(qScope); }, osState: osSnapshot, scope: function (s) { if (s === "os" || s === "tab") { qScope = s; try { W.localStorage.setItem("holo.voice.scope", s); } catch (e) {} if (qScopeBtn) qScopeBtn.textContent = qScopeLabel(); } return qScope; },   // what Q can SEE of the κ-OS + its read/act scope
    embed: embedText, warmEmbed: ensureEmbed,   // semantic embeddings (EmbeddingGemma) → Q's semantic memory; lazy-loads + binds the QVAC embed seam
    see: seeImage, warmVision: ensureVision,     // sight (SmolVLM-256M) → describe/answer about an image; lazy-loads on first call
    quick: quickText, warmQuick: ensureQuick,    // fast 360M base for cheap text (titles·compaction·judgments) — keeps the 1.8GB brain free
    warmStarter: warmStarter, upgradeBrain: upgradeBrain, brainTier: brainTier,   // progressive cold-start: warm the starter (tier 1), trigger the silent full-brain upgrade (tier 2), read the bound tier (0/1/2)
    seed: seedLookup, seedKappa: seedKappa,   // L0 seed κ-memo: O(1) pre-sealed answer for a predictable first prompt (null = miss → live model), + its content κ
    wakeMatch: function (s) { var n = norm(s); return { norm: n, match: wakeMatches(n), lone: !WAKE.re.test(n) && WAKE.loneRe.test(n) }; },   // test the matcher against any text
    lastWake: function () { return WAKE.last || null; },                  // the last accepted wake as a κ-addressed holo:WakeEvent receipt
    wakeReceipt: mintWakeReceipt,         // mint a wake-receipt by hand (testing / replay): → { kappa, ... }
    wakeFlare: function (d) { flareWake(d || {}); return STATE.wakePulse; },   // fire the "I heard 'Q'" orb flare (what a confirmed wake triggers)
    wakePulse: function () { return wakePulseNow(); },                    // current flare intensity (0..1, real-time decay)
    vad: function () { return { on: !!CFG.vad, ready: !!VAD.engine, threshold: CFG.vadThreshold, backend: VAD.engine ? VAD.engine.backend : null }; },   // sovereign pure-ONNX stage-1 gate status
    setVAD: function (on) { CFG.vad = !!on; if (on) return ensureVAD().then(function (e) { return !!e; }); return Promise.resolve(false); },   // toggle the Silero VAD gate (model vendored by tools/vendor-voice-model.mjs)
    setWakeWord: setWakeWord,             // rename the assistant ("Q" by default); persisted
    setVoice: setVoice, voices: VOICES,   // Q's neural voice (Kokoro); persisted
    say: speakNatural,                    // speak text in Q's natural voice (Kokoro → speechSynthesis)
    settings: toggleMenu,                 // open the engine settings popover
    config: function () { return Object.assign({}, CFG, { mode: STATE.mode }); },
    state: function () { return { mode: STATE.mode, listening: STATE.busy, lastText: STATE.lastText, lastAction: STATE.lastAction }; },
  };
})();
