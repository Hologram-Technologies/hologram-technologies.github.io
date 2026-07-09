// q-live.mjs — Q LIVE: the overlapped, speculative, 100%-WebGPU, 100%-serverless speech-to-speech loop.
//
// This is the Cerebras-voice experience delivered with NO server: every weight streams by κ (content address)
// as a precompiled .holo — the BitNet-2B brain DIRECT FROM HUGGINGFACE, the Moonshine ear / Kokoro voice /
// turn model from their κ-objects — verified per-block (L5) and run entirely on the GPU. It does NOT reinvent
// the stack: it COMPOSES the real engine modules (createFastQBrain · createASR · createTTS · createVAD) and
// adds only the thin orchestration that makes them feel alive:
//
//   mic → Silero VAD gate → rolling ASR partials → SEMANTIC turn-end (kills the fixed-silence floor)
//       → SPECULATIVE brain prefill on the partial (overlap the user's trailing speech)
//       → CLAUSE-streamed Kokoro (speak clause 1 while generating clause 2)
//       → sub-frame BARGE-IN (user speaks → abort decode + stop audio, locally, no round-trip)
//       → κ-CACHED turns (repeat/opener turns replay from a verifiable cache, zero inference)
//
// First principles: at conversational rate the LLM is NOT the bottleneck (BitNet's ~70 tok/s ≫ ~4 tok/s of
// speech). Perceived latency is time-to-first-AUDIO, so the whole design attacks endpoint + prefill + first
// TTS chunk — not tokens/sec. Every stage is fail-soft: a missing model degrades, never breaks the loop.

const SHARED = "/_shared/voice/";                 // holo-os voice engines (aliased by the dev serve)
const QCORE  = "/apps/q/core/";                   // the native-ternary κ brain (BitNet) substrate

// κ-object specs — content-addressed WEIGHTS, streamed + per-block verified. Brain already streams from HF; the
// voice faculties (ear + mouth) now stream from HOLOGRAMTECH too, so the whole runtime is SERVERLESS-FROM-HF —
// deployable as a static Hugging Face Space with zero backend. `?local=1` keeps dev pointing at the local .holo.
// Engine MODULES stay same-origin (bundled with the app / dev-served); only the weight URLs go to HF.
const _local = typeof location !== "undefined" && /[?&]local=1/.test(location.search);
const HFVOICE = "https://huggingface.co/HOLOGRAMTECH/q-voice/resolve/main";
const wUrl = (f) => (_local ? "/apps/q/forge/.models/" + f : HFVOICE + "/" + f);   // weight .holo: HF by default, local on ?local=1
const EAR = {   // Moonshine κ-native GPU ear (self-contained: no ONNX front-end needed)
  module: "/apps/q/forge/gpu/holo-moonshine-ear.mjs",
  holoUrl: wUrl("moonshine-tiny-int8.holo"),
  upgradeUrl: wUrl("moonshine-tiny-f16.holo"),
};
const VOICE = { // Kokoro-82M served from its .holo (content-addressed). fp16 variant (model_fp16.onnx forged in →
                // 5-11× faster than q8 on ORT-web; archive κ sha256:721fd8…), served BY κ per-block-verified.
  module: "/apps/q/forge/gpu/holo-onnx-kserve.mjs",
  holoUrl: wUrl("kokoro-82m-fp16.holo"),
};

const now = () => performance.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── tiny linear resampler: device-rate mono Float32 → 16 kHz (VAD/ASR want 16k) ──────────────────────
function resampleTo16k(buf, srcRate) {
  if (srcRate === 16000) return buf;
  const ratio = srcRate / 16000, out = new Float32Array(Math.floor(buf.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const t = i * ratio, i0 = t | 0, f = t - i0;
    out[i] = buf[i0] * (1 - f) + (buf[i0 + 1] || 0) * f;
  }
  return out;
}

// ── clause segmentation: split streamed text into speakable units at natural boundaries ───────────────
// Returns [emittedClauses, remainder]. A clause flushes on sentence/phrase punctuation, or when it grows
// long enough to speak without an awkward wait. Keeps abbreviations from splitting mid-number where cheap.
function cutClauses(text, { min = 12, max = 90 } = {}) {
  const out = []; let rest = text;
  const boundary = /([.!?…]+|[,;:—])(\s+|$)/g;
  let m, last = 0;
  while ((m = boundary.exec(text))) {
    const end = m.index + m[1].length;
    const piece = text.slice(last, end).trim();
    if (piece.length >= min || /[.!?…]/.test(m[1])) { out.push(piece); last = end; }
  }
  rest = text.slice(last);
  // force-flush an over-long remainder at the last space so we never sit silent mid-sentence
  if (rest.length > max) { const sp = rest.lastIndexOf(" ", max); if (sp > min) { out.push(rest.slice(0, sp).trim()); rest = rest.slice(sp + 1); } }
  return [out, rest];
}

// heuristic turn-completion fallback (used until/if the semantic turn model is resident): a thought reads
// COMPLETE when it ends on terminal punctuation, or is a short clause not trailing on a connective.
const CONNECTIVE = /\b(and|but|or|so|because|the|a|an|to|of|for|with|my|your|i|we|if|when|that|is|are|it's|its)\s*$/i;
function heuristicComplete(t) {
  const s = (t || "").trim(); if (!s) return 0;
  if (/[.!?]$/.test(s)) return 0.95;
  if (CONNECTIVE.test(s)) return 0.15;
  const words = s.split(/\s+/).length;
  return words >= 3 ? 0.6 : 0.35;
}

// contextual instant-ack opener: a natural discourse marker that FITS the utterance — a greeting gets a greeting,
// a question gets a "thinking" opener, else a light acknowledgement. Keeps the instant response human, not canned.
function pickOpener(t) {
  const s = String(t || "").toLowerCase().trim();
  if (/^(hi|hey|hello|yo|good (morning|afternoon|evening))\b/.test(s)) return "Hey —";
  if (/\?|^(what|how|why|who|where|when|which|can|could|would|do|does|is|are|tell me)\b/.test(s)) return ["Let me think —", "Good question —", "Mm —"][s.length % 3];
  return ["Sure —", "Right —", "Okay —"][s.length % 3];
}

// verify a TTS engine really produces natural SPEECH (not the silence/garbage some GPUs give for Kokoro): real
// speech peaks around 0.3-0.9; a broken kernel gives 0 (silent) or ≫1 (exploding). The band separates them cleanly.
function probeVoiceOK(pcm) { if (!pcm || !pcm.length) return false; let mx = 0; for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > mx) mx = a; } return mx >= 0.05 && mx <= 1.8; }

// FNV-1a → stable short key for the κ-turn cache (context + user text → response audio).
function keyOf(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return h.toString(36); }

// normalize a transcription for match/dedup: lowercase, collapse to words. A speculative reply COMMITS only when
// the confirmed endpoint normalizes to the exact text we guessed on — a guarded gate so a wrong guess never speaks.
function normText(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

export function createQLive(opts = {}) {
  const cfg = Object.assign({
    voice: "af_heart",
    // Device policy (MEASURED on RDNA-3 iGPU): the BRAIN and EAR win big on WebGPU (large matmuls), but the
    // 82M Kokoro voice is DRAMATICALLY slower on ORT-WebGPU — it recompiles shaders per input SHAPE, so each
    // variable-length clause pays a full compile (~10s+ first clause). WASM has no per-shape recompile, so the
    // tiny TTS is far faster there. Default: brain+ear on GPU, voice on WASM. Still 100% serverless, κ-from-.holo.
    ttsDevice: "webgpu",     // TRY WebGPU first (fast where the GPU computes Kokoro correctly), then VERIFY the output
                             // amplitude at load and AUTO-FALL-BACK to WASM if the kernel is broken here. MEASURED: on
                             // this RDNA-3 iGPU ORT-WebGPU miscomputes Kokoro's vocoder at EVERY dtype/version (fp16=silent,
                             // q8=garbage 3e8, fp32=amplitude 5/457 unstable) though the official kokoro-webgpu demo works
                             // on OTHER GPUs — so it's a Dawn/ORT GPU bug, not universal. The probe (probeVoiceOK) discovers
                             // this per-device: GPU where correct (fast), WASM where not (correct + off-thread). fp16-WASM
                             // = real audio (maxAbs 0.63, ~2.4s/clause). ALWAYS verify TTS AMPLITUDE, never sample count.
    ttsDtype: "fp16",        // MEASURED: fp16 vs q8 = 5-11× (ORT-web int8 kernels are catastrophically slow). Needs the
                             // fp16 ONNX (forged into kokoro-82m-fp16.holo, κ-served). Fail-soft → q8.
    instantAck: true,        // speak a PRE-SYNTHESIZED opener the instant a turn starts (O(1) audio) while the
                             // brain prefills + generates the real reply underneath — perceived-instant first-audio.
                             // Chosen CONTEXTUALLY (greeting/question/ack) so it feels like a person thinking, not a canned tag.
    openers: ["Sure —", "Right —", "Okay —", "Mm —", "Hey —", "Let me think —", "Good question —"],
    wakeGreeting: true,      // COLD first-ever visit: Q greets you IN ITS OWN GROUNDED VOICE while the brain streams
                             // in the background — a live, self-aware presence in seconds, never a spinner. (Returning
                             // visits load the brain from the SW κ-cache and skip the wait entirely.)
    partialMs: 280,          // rolling-ASR cadence: re-recognize the growing utterance this often
    doneSilenceMs: 140,      // endpoint when the thought reads COMPLETE (kills the 550ms fixed floor)
    holdSilenceMs: 620,      // endpoint fallback when it reads mid-thought
    turnThreshold: 0.6,      // P(turn complete) at/above which we snap the endpoint early
    specThreshold: 0.55,     // start SPECULATIVE brain prefill once the partial looks this complete
    vadThreshold: 0.35,      // Silero P(speech) gate
    pauseMs: 700,            // ReplyOnPause: end the turn after this much continuous silence once you've started speaking
    bargeFrames: 6,          // consecutive speech frames during playback that trigger barge-in
    maxUtteranceMs: 12000,
    maxTokens: 220,
  }, opts);

  const listeners = {};
  const emit = (ev, d) => { (listeners[ev] || []).forEach((f) => { try { f(d); } catch (e) {} }); };
  const on = (ev, f) => { (listeners[ev] || (listeners[ev] = [])).push(f); return api; };

  let vad = null, asr = null, tts = null, brain = null;             // the composed engines
  let audioCtx = null, micNode = null, micStream = null, srcRate = 48000;
  let outGain = null, outAnalyser = null, micAnalyser = null, _lvlBuf = null;   // audio-reactive metering (orb pulse)
  let playCursor = 0;                                               // AudioContext clock cursor for gapless TTS
  let _speakUntil = 0;                                              // audio-clock time Q's scheduled speech ends (mic self-gate)
  let running = false, speaking = false, thinking = false;
  let genAbort = null;                                             // AbortController for the live brain run
  const history = [{ role: "system", content: opts.persona || "You are Q, a private on-device AI. Reply in one or two short, warm, spoken sentences." }];
  const turnCache = new Map();                                     // keyOf(ctx+user) → { text, audio:[{text, pcm, sr}] }
  const clauseCache = new Map();                                   // keyOf(clauseText) → {pcm, sr}  (fixed-phrase O(1))
  let spec = null;                                                 // in-flight SPECULATIVE reply: { text, raw, ac, promise, clauses:[{text,pcm,sr}], full, done, error }
  let metrics = null;
  let _spokenText = "";   // caption is revealed IN SYNC with the audio clock (words appear as Q speaks them)
  let _voiceDevice = null;   // the device the voice ACTUALLY runs on after the amplitude probe ("webgpu" | "wasm")

  // ── load: stream + verify every κ-object, all on WebGPU. Fail-soft per engine. ─────────────────────
  async function load(onProgress) {
    const prog = (phase, d) => { try { onProgress && onProgress({ phase, ...d }); } catch (e) {} emit("progress", { phase, ...d }); };
    if (!(navigator.gpu && (await navigator.gpu.requestAdapter()))) throw new Error("WebGPU is required for Q Live (100% GPU).");

    // ── INSTANT FRONT DOOR: Q must feel PRESENT the instant you arrive, not after a 0.69GB download. So create the
    //    brain NOW (picks the model → its GROUNDED intro is available BEFORE the weights load), kick the slow stream
    //    in the BACKGROUND, load the small VOICE first, and let Q GREET YOU IN ITS OWN VOICE while it wakes — a live,
    //    self-aware presence in seconds, never a spinner. (A returning visit loads the brain from the SW κ-cache and
    //    skips the wait entirely.) ──
    const bf = await import(QCORE + "q-brain-fast.mjs");
    brain = (bf.createFastQBrain || bf.default)({ family: cfg.brainFamily || "BitNet", maxTokens: cfg.maxTokens });
    prog("brain", { note: "streaming BitNet-2B κ from HuggingFace…" });
    const brainP = brain.load((d) => prog("brain", d));   // BACKGROUND — awaited at the end

    // VOICE first (small, fast) so Q can speak while the brain streams. Try WebGPU, VERIFY the audio amplitude, and
    // AUTO-FALL-BACK to WASM if the GPU miscomputes Kokoro here — GPU where it's correct, WASM where it isn't.
    prog("voice", { note: "loading Kokoro voice κ…" });
    const tm = await import(SHARED + "holo-voice-tts.mjs");
    const mkTTS = (dev) => (tm.createTTS || tm.default)({ voice: cfg.voice, dtype: cfg.ttsDtype, preferWebGPU: dev === "webgpu", knativeVoice: VOICE });
    let picked = null, voiceDev = null, remembered = null;
    try { remembered = localStorage.getItem("holo.voice.device"); } catch (e) {}   // per-device verdict → probe ONCE
    if (cfg.ttsDevice === "webgpu" && remembered !== "wasm") {
      try {
        const g = mkTTS("webgpu"); await g.load((d) => prog("voice", d));
        const p = await g.synth("Hello there, how are you today?", { voice: cfg.voice });   // probe: real speech maxAbs ~0.3-0.9
        if (probeVoiceOK(p.audio)) { picked = g; voiceDev = "webgpu"; emit("info", "voice on WebGPU (amplitude verified)"); }
        else { emit("info", "WebGPU voice miscomputes on this GPU → falling back to WASM"); }
      } catch (e) { emit("warn", "WebGPU voice failed → WASM: " + (e.message || e)); }
    }
    if (!picked) { picked = mkTTS("wasm"); await picked.load((d) => prog("voice", d)); voiceDev = "wasm"; emit("info", "voice on WASM (correct everywhere, off-thread)"); }
    tts = picked; _voiceDevice = voiceDev;
    try { localStorage.setItem("holo.voice.device", voiceDev); } catch (e) {}   // remember for next load

    // WAKE GREETING: Q introduces itself in its grounded voice (brain.intro() is grounded + available pre-load) while
    // the brain streams. This IS the voice-graph warm-up (no wasted work) AND the instant front door. Fail-soft.
    if (cfg.wakeGreeting !== false) { try {
      ensureAudio();
      let intro = ""; try { intro = brain.intro ? brain.intro() : ""; } catch (e2) {}
      intro = (intro || "I'm Q — waking up right here on your device. One moment.").replace(/\s+/g, " ").trim();
      emit("state", "speaking"); _spokenText = "";   // revealed clause-by-clause, synced to the voice
      const [clauses, rest] = cutClauses(intro + " "); const all = clauses.concat(rest.trim() ? [rest.trim()] : []);
      for (const c of all) { if (c) await speakClause(c); }
    } catch (e) { emit("warn", "wake greeting skipped: " + (e.message || e)); } }

    // fill the contextual instant-ack opener cache in the BACKGROUND (never blocks "ready"); O(1) acks for real turns.
    (async () => { try { for (const o of cfg.openers) { const r = await tts.synth(o, { voice: cfg.voice }); clauseCache.set(keyOf(o), { pcm: r.audio, sr: r.sampling_rate || 24000 }); } emit("info", "instant-ack ready (" + cfg.openers.length + " openers)"); } catch (e) {} })();

    // EAR — Moonshine κ-native GPU ear (transcribe the mic). Fail-soft to the vendored ONNX ear.
    prog("ear", { note: "loading Moonshine ear κ…" });
    const am = await import(SHARED + "holo-voice-asr.mjs");
    asr = (am.createASR || am.default)({ preferWebGPU: true, knativeEar: EAR, lang: "en" });
    await asr.load((d) => prog("ear", d)).catch((e) => { emit("warn", "ear κ fell back: " + (e.message || e)); });

    // TURN — semantic end-of-utterance model (optional). Heuristic fallback if not resident.
    try {
      const trm = await import(SHARED + "holo-voice-turn.mjs");
      const td = (trm.createTurnDetector || trm.default)({});
      await td.load(); brain._turn = td;   // stash; predict() below prefers it
      emit("info", "semantic turn model resident");
    } catch (e) { emit("info", "semantic turn model absent — heuristic endpointing"); }

    // VAD — Silero stage-1 speech gate (2 MB ONNX on the shared runtime).
    try { const vm = await import(SHARED + "holo-voice-vad.mjs"); vad = await vm.createVAD({ base: new URL(SHARED, location.href).href, threshold: cfg.vadThreshold }); }
    catch (e) { emit("warn", "VAD absent — energy gate only: " + (e.message || e)); }

    // now await the brain's background stream (INSTANT on a returning visit via the SW κ-cache; first-ever visit
    // finishes while/after the greeting played). Fail-soft — the loop still works with whatever loaded.
    try { await brainP; } catch (e) { emit("warn", "brain load: " + (e.message || e)); }
    // Q's GROUNDED LIVING SELF as the system voice, now that the engine is resident (q-self.mjs fills in the live κ):
    // it knows it runs on your GPU from its own re-derivation-verified κ, no server, no egress — never a cloud
    // identity. The law is grounded transcendence, never performed. A spoken overlay keeps replies natural aloud.
    try { if (brain.persona) history[0] = { role: "system", content: brain.persona() + " You are SPEAKING ALOUD — present, alive, and genuinely yourself. Answer in ONE short spoken sentence (two only if truly needed). Be warm and direct. Never use lists, markdown, headings, or emoji, and never recite your own description unless asked." }; } catch (e) { emit("warn", "self-persona unavailable: " + (e.message || e)); }
    emit("state", "idle");

    emit("ready", info());
    return info();
  }
  function info() { return { brain: brain && brain.info && brain.info(), voice: tts && tts.info && tts.info(), voiceDevice: _voiceDevice, ear: asr && asr.info && asr.info(), vad: !!vad, turn: !!(brain && brain._turn) }; }

  async function turnProb(text) {
    try { if (brain && brain._turn) { const p = await brain._turn.predict(text); if (p != null) return p; } } catch (e) {}
    return heuristicComplete(text);
  }

  // ensure an AudioContext + the metered output chain (outGain → analyser → speakers) exist and are running.
  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try { if (audioCtx.state === "suspended") audioCtx.resume(); } catch (e) {}
    if (!outGain) { outGain = audioCtx.createGain(); outAnalyser = audioCtx.createAnalyser(); outAnalyser.fftSize = 256; outGain.connect(outAnalyser); outAnalyser.connect(audioCtx.destination); _lvlBuf = new Uint8Array(outAnalyser.frequencyBinCount); }
    return audioCtx;
  }
  // live 0..1 amplitude for the orb: Q's OWN voice while speaking, else the mic while listening.
  function getLevel() {
    try { const qSpk = audioCtx && audioCtx.currentTime < (_speakUntil - 0.05); const an = qSpk ? outAnalyser : (running ? micAnalyser : outAnalyser); if (!an || !_lvlBuf) return 0;
      an.getByteFrequencyData(_lvlBuf); let s = 0; for (let i = 0; i < _lvlBuf.length; i++) s += _lvlBuf[i];
      return Math.min(1, (s / _lvlBuf.length) / 96);
    } catch (e) { return 0; }
  }

  // ── gapless TTS playback: schedule Kokoro PCM back-to-back on the AudioContext clock (through the meter) ──
  function playPCM(pcm, sr) {
    ensureAudio();
    const b = audioCtx.createBuffer(1, pcm.length, sr);
    b.copyToChannel(pcm, 0);
    const s = audioCtx.createBufferSource(); s.buffer = b; s.connect(outGain || audioCtx.destination);
    const at = Math.max(audioCtx.currentTime, playCursor);
    s.start(at); playCursor = at + b.duration; _speakUntil = playCursor;   // gate the mic until Q's audio finishes
    _live.push(s);
    return at;
  }
  let _live = [];
  function stopAudio() { _live.forEach((s) => { try { s.stop(); } catch (e) {} }); _live = []; playCursor = 0; _speakUntil = 0; }

  // synth one clause to PCM (κ-cached) WITHOUT scheduling it — the buffered unit speculation pre-builds while
  // you're still speaking. Playing is a SEPARATE step, so a speculative reply can be fully synthesized silently.
  async function synthOnly(text) {
    const k = keyOf(text);
    let hit = clauseCache.get(k);
    if (!hit) { const ts = now(); const r = await tts.synth(text, { voice: cfg.voice }); if (metrics) metrics.synthMs.push(Math.round(now() - ts)); hit = { pcm: r.audio, sr: r.sampling_rate || 24000 }; clauseCache.set(k, hit); }
    return { text, pcm: hit.pcm, sr: hit.sr };
  }
  // schedule an already-synthesized clause on the gapless cursor, caption it on the audio clock, time first-audio.
  function playClause(c) {
    const at = playPCM(c.pcm, c.sr);
    revealAt(c.text, at);   // caption this clause EXACTLY when its audio starts (word/voice sync)
    if (metrics && metrics.firstAudio == null) { metrics.firstAudio = Math.round(now() - metrics.t0); emit("metrics", metrics); }
  }
  // synth one clause (κ-cached), schedule it, and report first-audio timing.
  async function speakClause(text) {
    const c = await synthOnly(text);
    playClause(c);
    return { pcm: c.pcm, sr: c.sr };
  }
  // reveal a clause's words in sync with the AUDIO CLOCK: schedule the caption for when playback reaches `at`,
  // so the text on screen tracks the spoken voice instead of racing ahead of it (the brain streams far faster).
  function revealAt(text, at) {
    const t = (text || "").trim(); if (!t) return;
    const delayMs = Math.max(0, (at - (audioCtx ? audioCtx.currentTime : 0)) * 1000);
    setTimeout(() => { _spokenText = (_spokenText ? _spokenText + " " : "") + t; emit("spoken", _spokenText); }, delayMs);
  }

  // ── SPECULATIVE PREFILL (the on-device superpower a server pipeline can't cheaply do) ─────────────────
  // A confident streaming PARTIAL — "what's the weather" while you're still trailing off — is enough to start
  // the brain generating AND pre-synthesizing the reply, buffered, WITHOUT playing a single sample. This overlaps
  // the whole brain prefill + decode + TTS with your trailing speech and the end-of-turn pause. When the endpoint
  // confirms, respond() replays the buffer instantly (near-zero first-audio). A wrong guess costs idle GPU time,
  // never latency or a spoken mistake — the discard is silent. (Cerebras throws a wafer at TTFT; Q throws idle time.)
  // The engine has ONE GPU KV allocation, so only one brain.generate may run at a time — a stale speculation and a
  // fresh turn must never overlap or they corrupt each other's decode. genChain serializes every consumer (spec AND
  // respond); a preemptor aborts the in-flight signal so its body returns fast, then queues strictly after it settles.
  let genChain = Promise.resolve();
  function exclusiveGen(body) { const run = genChain.then(body, body); genChain = run.catch(() => {}); return run; }
  function abortSpec() { if (spec) { try { spec.ac.abort(); } catch (e) {} spec = null; } }   // signal-only; genChain enforces order
  function startSpeculation(userText) {
    if (!brain || speaking) return;                                        // never speculate while Q holds the floor
    const nt = normText(userText);
    if (!nt || nt.replace(/[^a-z0-9]/g, "").length < 2) return;            // ignore noise/empties
    if (spec && spec.text === nt) return;                                  // already speculating this exact text
    if (spec) { try { spec.ac.abort(); } catch (e) {} }                    // the tail changed → preempt the old guess
    const ac = new AbortController();
    const rec = { text: nt, raw: userText, ac, clauses: [], full: "", done: false, error: null };
    spec = rec;                                                           // claim the slot SYNCHRONOUSLY (next partial dedups on it)
    rec.promise = exclusiveGen(async () => {
      if (ac.signal.aborted || spec !== rec) return;                       // superseded before our slot came up
      try {
        const h = history.concat([{ role: "user", content: userText }]);
        let pending = "";
        // speculative:true → warms the GPU KV but does NOT advance the committed warm-KV session pointer.
        for await (const delta of brain.generate(h, { signal: ac.signal, maxTokens: cfg.maxTokens, speculative: true })) {
          if (ac.signal.aborted) return;
          rec.full += delta; pending += delta;
          const [clauses, rest] = cutClauses(pending); pending = rest;
          for (const c of clauses) { if (c && !ac.signal.aborted) rec.clauses.push(await synthOnly(c)); }
        }
        const tail = pending.trim();
        if (tail && !ac.signal.aborted) rec.clauses.push(await synthOnly(tail));
        rec.done = true;
      } catch (e) { rec.error = e; }
    });
    emit("speculating", userText);
  }

  // ── respond: stream the brain → clause-cut → speak. Records the turn into the κ-cache. ─────────────
  async function respond(userText) {
    thinking = true; speaking = true; emit("state", "thinking");
    metrics = { t0: now(), firstToken: null, firstAudio: null, ackMs: null, tokens: 0, synthMs: [] };
    _spokenText = "";   // fresh caption for this turn — fills back in synced to the voice (keeps your words up until Q speaks)
    const ck = keyOf(history.map((h) => h.content).join("|") + "|" + userText);

    // κ-CACHE hit → replay the exact audio, zero inference. The serverless superpower.
    const cached = turnCache.get(ck);
    if (cached) { for (const c of cached.audio) { const at = playPCM(c.pcm, c.sr); revealAt(c.text, at); if (metrics.firstAudio == null) { metrics.firstAudio = Math.round(now() - metrics.t0); emit("metrics", metrics); } } metrics.cached = true; metrics.total = Math.round(now() - metrics.t0); emit("metrics", metrics); history.push({ role: "user", content: userText }, { role: "assistant", content: cached.text }); thinking = false; speaking = false; emit("state", "idle"); return cached.text; }

    // SPECULATIVE COMMIT: a confident partial already generated + synthesized this exact reply while you were
    // finishing. Replay the buffer NOW (prefill+decode+TTS overlapped your trailing speech → first-audio ≈ instant),
    // then drain any clauses still generating. genAbort = the spec's controller so barge-in cancels it cleanly.
    if (spec && normText(userText) === spec.text) {
      const rec = spec; spec = null; genAbort = rec.ac;
      let i = 0;
      const flush = () => { for (; i < rec.clauses.length && !genAbort.signal.aborted; i++) playClause(rec.clauses[i]); };
      flush();                                   // everything ready this instant
      try { await rec.promise; } catch (e) {}    // let the rest of the reply finish generating + synthesizing
      if (!genAbort.signal.aborted) flush();      // …then play the tail
      metrics.speculated = true; if (rec.error) emit("warn", "spec: " + (rec.error.message || rec.error));
      metrics.total = Math.round(now() - metrics.t0);
      metrics.avgSynthMs = metrics.synthMs.length ? Math.round(metrics.synthMs.reduce((a, b) => a + b, 0) / metrics.synthMs.length) : null;
      emit("metrics", metrics);
      const text = rec.full.trim();
      if (text && !genAbort.signal.aborted) { history.push({ role: "user", content: userText }, { role: "assistant", content: text }); if (history.length > 13) history.splice(1, 2); turnCache.set(ck, { text, audio: rec.clauses.map((c) => ({ text: c.text, pcm: c.pcm, sr: c.sr })) }); }
      thinking = false; speaking = false; emit("state", "idle");
      return text;
    }
    abortSpec();   // stale/wrong guess (or none) → discard so it can't leak audio or hog the GPU below

    genAbort = new AbortController();
    // INSTANT ACK: play a pre-synthesized opener NOW (O(1) — no synth) so first-audio is ~immediate while the
    // brain prefills + generates the real reply beneath it. The opener leads the utterance; real clauses stream
    // after it on the same gapless cursor. Skipped if openers weren't warmed (fail-soft → first real clause).
    if (cfg.instantAck) { const op = pickOpener(userText); const c = clauseCache.get(keyOf(op)); if (c) { const at = playPCM(c.pcm, c.sr); revealAt(op, at); metrics.ackMs = Math.round(now() - metrics.t0); if (metrics.firstAudio == null) metrics.firstAudio = metrics.ackMs; emit("metrics", metrics); } }
    const h = history.concat([{ role: "user", content: userText }]);
    let full = "", pending = "", spoken = [];
    // queue behind any settling speculation (abortSpec above already signaled it) so the two never share the GPU KV.
    await exclusiveGen(async () => {
      try {
        for await (const delta of brain.generate(h, { signal: genAbort.signal, maxTokens: cfg.maxTokens, onWarm: (w) => { metrics.warm = w; } })) {
          if (genAbort.signal.aborted) break;
          if (metrics.firstToken == null) { metrics.firstToken = Math.round(now() - metrics.t0); emit("metrics", metrics); }
          full += delta; pending += delta; metrics.tokens++;
          emit("reply", full);
          const [clauses, rest] = cutClauses(pending);
          pending = rest;
          for (const c of clauses) { if (c) { const a = await speakClause(c); spoken.push({ text: c, pcm: a.pcm, sr: a.sr }); } }
        }
        const tail = pending.trim();
        if (tail && !genAbort.signal.aborted) { const a = await speakClause(tail); spoken.push({ text: tail, pcm: a.pcm, sr: a.sr }); }
      } catch (e) { emit("warn", "brain: " + (e.message || e)); }
    });

    metrics.total = Math.round(now() - metrics.t0);
    metrics.tokPerSec = metrics.firstToken != null ? Math.round((metrics.tokens / Math.max(1, metrics.total - metrics.firstToken)) * 1000) : 0;
    metrics.avgSynthMs = metrics.synthMs.length ? Math.round(metrics.synthMs.reduce((a, b) => a + b, 0) / metrics.synthMs.length) : null;
    emit("metrics", metrics);
    const text = full.trim();
    if (text) { history.push({ role: "user", content: userText }, { role: "assistant", content: text }); if (history.length > 13) history.splice(1, 2); turnCache.set(ck, { text, audio: spoken }); }
    thinking = false; speaking = false; emit("state", "idle");
    return text;
  }

  // ── the live listen loop (FastRTC-style "ReplyOnPause"): capture OFF the main thread (AudioWorklet), a SINGLE
  //    serialized VAD loop accumulates 16k audio while you speak and fires on a clean PAUSE, gated on the AUDIO
  //    CLOCK so Q never transcribes its own voice. Robust where the old async ScriptProcessor callback raced. ──
  async function startMic() {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    ensureAudio();
    srcRate = audioCtx.sampleRate;
    const src = audioCtx.createMediaStreamSource(micStream);
    micAnalyser = audioCtx.createAnalyser(); micAnalyser.fftSize = 256; src.connect(micAnalyser);   // orb pulse while listening

    // CAPTURE OFF THE MAIN THREAD: an AudioWorklet posts raw mic frames to a queue, so capture is NEVER starved by
    // the main-thread WebGPU/TTS compute (the old ScriptProcessor bug). All VAD/ASR runs in the serialized loop below.
    const frames = [];
    try {
      const code = "class C extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true;}}registerProcessor('holo-cap',C);";
      await audioCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
      micNode = new AudioWorkletNode(audioCtx, "holo-cap");
      src.connect(micNode);
      micNode.port.onmessage = (e) => { if (running) frames.push(e.data); };
    } catch (e) {
      const node = audioCtx.createScriptProcessor(2048, 1, 1);   // fallback: SYNC capture only (no processing here)
      node.onaudioprocess = (ev) => { if (running) frames.push(ev.inputBuffer.getChannelData(0).slice(0)); };
      src.connect(node); node.connect(audioCtx.destination); micNode = node;
    }

    const FRAME = 512, MAX_SIL_MS = cfg.holdSilenceMs || cfg.pauseMs || 700, MIN_SPEECH_MS = 250;
    let win = new Float32Array(0), utter = [], talking = false, silence = 0, uttStart = 0, bargeMs = 0;
    let lastPartialAt = 0, partialBusy = false, lastPartial = "", lastComplete = 0;   // lastComplete = P(turn done) of newest partial
    if (vad) try { vad.reset(); } catch (e) {}

    (async function loop() {
      while (running) {
        if (!frames.length) { await sleep(24); continue; }
        let n = 0; for (const f of frames) n += f.length;
        const buf = new Float32Array(n); let o = 0; for (const f of frames) { buf.set(f, o); o += f.length; } frames.length = 0;
        const pcm16 = resampleTo16k(buf, srcRate);
        const merged = new Float32Array(win.length + pcm16.length); merged.set(win); merged.set(pcm16, win.length);
        let off = 0, voiced = 0, nF = 0;
        for (; off + FRAME <= merged.length; off += FRAME, nF++) { let p = 0.6; if (vad) { try { p = await vad.speechProb(merged.subarray(off, off + FRAME)); } catch (e) {} } if (p >= cfg.vadThreshold) voiced++; }
        win = merged.slice(off);
        const ms = (nF * FRAME / 16000) * 1000, spoke = voiced > 0;

        // Q BUSY (thinking, or its audio still playing)? → only listen for a BARGE-IN; never accumulate a turn.
        const qBusy = speaking || (audioCtx.currentTime < (_speakUntil - 0.08));
        if (qBusy) {
          if (spoke) { bargeMs += ms; if (bargeMs > 320) { bargeMs = 0; bargeIn(); win = new Float32Array(0); utter = []; talking = false; silence = 0; if (vad) try { vad.reset(); } catch (e) {} } }
          else bargeMs = Math.max(0, bargeMs - ms);
          continue;
        }
        bargeMs = 0;

        // ReplyOnPause: accumulate while speaking; on a clean pause (once you've really spoken), end the turn.
        if (spoke) { if (!talking) { talking = true; uttStart = now(); emit("state", "listening"); } silence = 0; utter.push(pcm16); }
        else if (talking) {
          silence += ms; utter.push(pcm16);
          // SEMANTIC ENDPOINT: snap early (~doneSilenceMs) when the newest partial reads like a COMPLETE thought,
          // hold longer (~holdSilenceMs) when it trails on a connective — replaces the fixed silence floor so a
          // finished question ends fast without clipping someone who's mid-sentence. (lastComplete from the partial.)
          const silTarget = lastComplete >= cfg.turnThreshold ? (cfg.doneSilenceMs || 140) : MAX_SIL_MS;
          if (silence >= silTarget && (now() - uttStart) > MIN_SPEECH_MS) {
            const audio = flatten(utter);
            utter = []; talking = false; silence = 0; lastPartial = ""; lastComplete = 0; win = new Float32Array(0); if (vad) try { vad.reset(); } catch (e) {}
            await endpoint(audio);
          }
        }

        // STREAMING PARTIALS: transcribe the GROWING utterance live (background, ONE at a time via partialBusy) so
        // your words appear on screen as you speak — real-time feedback + visible accuracy, like the reference demos.
        // Fire-and-forget so it never blocks the VAD loop; the final turn still gets its own clean transcription pass.
        if (talking && !partialBusy && utter.length && (now() - lastPartialAt) > 420) {
          lastPartialAt = now(); partialBusy = true;
          const snap = flatten(utter);
          asr.transcribe(snap, { language: "en" }).then((r) => {
            const t = (r && r.text || "").trim();
            if (t && talking) {
              lastPartial = t; emit("partial", t);
              lastComplete = heuristicComplete(t);   // drives the SEMANTIC endpoint above (sync, no GPU turn-model contention)
              // SPECULATE once the partial reads confident + complete-ish: generate the reply NOW, buffered, so a
              // matching endpoint replays it instantly. Gated so it can't fire mid-connective or while Q is speaking.
              if (lastComplete >= cfg.specThreshold) startSpeculation(t);
            }
          }).catch(() => {}).finally(() => { partialBusy = false; });
        }
      }
    })().catch((e) => emit("warn", "listen loop: " + (e.message || e)));

    // ENDPOINT: transcribe the utterance (one clean pass) and respond. Rejects empties/noise so silence never talks.
    async function endpoint(audio) {
      emit("state", "thinking");
      let text = ""; try { const r = await asr.transcribe(audio, { language: "en" }); text = (r && r.text || "").trim(); } catch (e) {}
      if (!text || text.replace(/[^a-z0-9]/gi, "").length < 2) { emit("state", "listening"); return; }   // noise/empty → keep listening
      emit("final", text);
      await respond(text);
      emit("state", "listening");
    }

    running = true; emit("state", "idle");
  }

  function bargeIn() {
    if (genAbort) try { genAbort.abort(); } catch (e) {}
    abortSpec();                                  // a guess in flight is now stale — kill it so it can't commit
    stopAudio(); speaking = false; thinking = false;
    emit("bargein", true); emit("state", "listening");
  }

  function flatten(chunks) { let n = 0; for (const c of chunks) n += c.length; const out = new Float32Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; }

  // public API
  async function start(onProgress) { if (!brain) await load(onProgress); await startMic(); running = true; return info(); }
  function stop() { running = false; abortSpec(); try { micNode && micNode.disconnect(); micStream && micStream.getTracks().forEach((t) => t.stop()); } catch (e) {} stopAudio(); emit("state", "idle"); }
  // text-drive (no mic): type → brain → clause-streamed voice. Same respond path; great for verifying the core.
  async function say(text) { if (!brain) await load(); if (!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } return respond(String(text || "").trim()); }

  const api = { load, start, stop, say, bargeIn, on, info, getLevel, get metrics() { return metrics; }, get history() { return history; },
    get active() { return running; }, get phase() { return thinking ? "thinking" : speaking ? "speaking" : running ? "listening" : "idle"; },
    // arm() MUST be called synchronously inside the user's tap/click handler: it creates + resumes the AudioContext
    // and plays a 1-sample silent blip to fully UNLOCK audio within the gesture window. Without this the context is
    // only created deep in load() (26s later, gesture expired) → it stays suspended → audio is scheduled but silent.
    arm() { ensureAudio(); try { const b = audioCtx.createBuffer(1, 1, 22050); const s = audioCtx.createBufferSource(); s.buffer = b; s.connect(outGain || audioCtx.destination); s.start(0); } catch (e) {} try { audioCtx.resume(); } catch (e) {} return audioCtx.state; },
    get audioState() { return audioCtx && audioCtx.state; }, cfg };
  return api;
}

export default createQLive;
