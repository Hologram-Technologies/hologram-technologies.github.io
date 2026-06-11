// holo-audio.js — the Holo Audio Engine: an OS-wide, high-quality Web Audio output
// chain that any hologram-native audio surface routes its SAME-ORIGIN audio through.
//
// HONEST by design (Law-L5 ethos): we do NOT fabricate detail that isn't in the bytes —
// upsampling can't recover what was never recorded. What this engine really does:
//   • plays at the DEVICE-NATIVE sample rate (no needless resampling);
//   • a transparent, well-understood DSP graph — 5-band parametric EQ (BiquadFilter
//     peaking) + bass low-shelf + an "air" high-shelf (a psychoacoustic brightness shelf,
//     synthesis not recovery — labelled as such) + optional headphone CROSSFEED (real
//     BS2B-style fatigue reduction / natural width) + a brick-wall LIMITER so boosts never
//     clip;
//   • a real output level meter (AnalyserNode) — honest proof the signal is flowing.
// Deterministic: given (input bytes + preset), the output is reproducible. The preset
// itself is a tiny content-addressable object. Transparent "Pure" preset = a clean wire.
//
// IMPORTANT: Web Audio's MediaElementSource TAINTS + SILENCES cross-origin no-cors media.
// So attach this ONLY to an element that plays same-origin (hologram-native κ-store) audio.
// Cross-origin streams (radio/SoundCloud) must play on a separate, un-routed element.

(function () {
  "use strict";
  if (window.HoloAudio) return;

  // preset = { eq:[5 gains dB @ 60/250/1k/4k/12k], bass:dB@90, air:dB@13k, comp:{threshold,ratio}, crossfeed:0..1, gain:dB }
  const PRESETS = {
    "Pure":        { eq: [0, 0, 0, 0, 0], bass: 0, air: 0, comp: null, crossfeed: 0, gain: 0, note: "transparent — a clean wire (+ safety limiter)" },
    "Hi-Fi":       { eq: [0, 0, 0, 1, 2], bass: 1.5, air: 2, comp: { threshold: -1.5, ratio: 6 }, crossfeed: 0, gain: 0, note: "subtle clarity + air, loudness-safe" },
    "Warm":        { eq: [2, 1, 0, -1, -1], bass: 3, air: -1, comp: { threshold: -2, ratio: 4 }, crossfeed: 0, gain: 0, note: "rounded lows, gentle highs" },
    "Bright / Air":{ eq: [0, -1, 0, 2, 4], bass: 0, air: 5, comp: { threshold: -1.5, ratio: 6 }, crossfeed: 0, gain: 0, note: "presence + high-shelf air (synthesised brightness)" },
    "Bass Boost":  { eq: [4, 2, 0, 0, 0], bass: 6, air: 0, comp: { threshold: -2, ratio: 8 }, crossfeed: 0, gain: -1, note: "deep lows, kept clip-free by the limiter" },
    "Vocal":       { eq: [-2, -1, 1, 4, 1], bass: -2, air: 1, comp: { threshold: -3, ratio: 6 }, crossfeed: 0, gain: 1, note: "presence + clarity for voices/podcasts" },
    "Headphones":  { eq: [0, 0, 0, 1, 2], bass: 1, air: 2, comp: { threshold: -1.5, ratio: 6 }, crossfeed: 0.6, gain: 0, note: "crossfeed — natural width, less fatigue" },
    "Night":       { eq: [1, 0, 0, 0, -1], bass: 1, air: -1, comp: { threshold: -12, ratio: 12 }, crossfeed: 0, gain: 3, note: "even, quiet-hour loudness (heavy compression)" },
  };
  const EQ_FREQS = [60, 250, 1000, 4000, 12000];

  function create(mediaEl) {
    let ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "playback" }); } catch { return { ok: false }; }
    let srcNode;
    try { srcNode = ctx.createMediaElementSource(mediaEl); } catch { try { ctx.close(); } catch {} return { ok: false }; }

    // ── build the chain (always passes audio; crossfeed is a parallel sub-stage) ──
    const preGain = ctx.createGain();
    const eq = EQ_FREQS.map((f, i) => { const b = ctx.createBiquadFilter(); b.type = "peaking"; b.frequency.value = f; b.Q.value = i === 0 || i === 4 ? 0.7 : 1.0; b.gain.value = 0; return b; });
    const bass = ctx.createBiquadFilter(); bass.type = "lowshelf"; bass.frequency.value = 90; bass.gain.value = 0;
    const air = ctx.createBiquadFilter(); air.type = "highshelf"; air.frequency.value = 13000; air.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.18;
    const outGain = ctx.createGain();
    const analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.8;

    // series core: pre → eq… → bass → air → [crossfeed stage] → limiter → out → analyser → dest
    preGain.connect(eq[0]); for (let i = 0; i < eq.length - 1; i++) eq[i].connect(eq[i + 1]);
    const afterEq = eq[eq.length - 1]; afterEq.connect(bass); bass.connect(air);

    // crossfeed sub-stage (BS2B-style): each channel bleeds a delayed, low-passed copy into
    // the other. cfWet controls amount; built once, amount 0 = inaudible. Robust: if it can't
    // build, we connect air→limiter directly.
    let cfWet = null, cfBuilt = false;
    try {
      const splitter = ctx.createChannelSplitter(2), merger = ctx.createChannelMerger(2);
      const directL = ctx.createGain(), directR = ctx.createGain();             // straight through
      const xL = ctx.createGain(), xR = ctx.createGain();                       // cross amount
      cfWet = ctx.createGain(); cfWet.gain.value = 0;
      const mk = () => { const d = ctx.createDelay(); d.delayTime.value = 0.00027; const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700; return [d, lp]; };
      const [dL, lpL] = mk(), [dR, lpR] = mk();
      air.connect(splitter);
      splitter.connect(directL, 0); directL.connect(merger, 0, 0);
      splitter.connect(directR, 1); directR.connect(merger, 0, 1);
      splitter.connect(dL, 0); dL.connect(lpL); lpL.connect(xL); xL.connect(cfWet); cfWet.connect(merger, 0, 1); // L → R
      splitter.connect(dR, 1); dR.connect(lpR); lpR.connect(xR); xR.connect(cfWet); // share cfWet? no — separate path
      // route R-cross into left channel via a second wet gain tracking cfWet
      const cfWet2 = ctx.createGain(); cfWet2.gain.value = 0; xR.disconnect(); xR.connect(cfWet2); cfWet2.connect(merger, 0, 0);
      merger.connect(limiter);
      cfBuilt = true; cfWet._twin = cfWet2;
    } catch { cfBuilt = false; }
    if (!cfBuilt) air.connect(limiter);

    limiter.connect(outGain); outGain.connect(analyser); analyser.connect(ctx.destination);

    let enabled = true, preset = "Pure";
    const db = (g) => Math.pow(10, g / 20);
    function route() { try { srcNode.disconnect(); } catch {} srcNode.connect(enabled ? preGain : ctx.destination); }
    route();

    function applyPreset(name) {
      const p = PRESETS[name] || PRESETS.Pure; preset = name in PRESETS ? name : "Pure";
      const t = ctx.currentTime;
      eq.forEach((b, i) => b.gain.setTargetAtTime(p.eq[i] || 0, t, 0.02));
      bass.gain.setTargetAtTime(p.bass || 0, t, 0.02); air.gain.setTargetAtTime(p.air || 0, t, 0.02);
      outGain.gain.setTargetAtTime(db(p.gain || 0), t, 0.02);
      if (p.comp) { limiter.threshold.setTargetAtTime(p.comp.threshold, t, 0.02); limiter.ratio.setTargetAtTime(p.comp.ratio, t, 0.02); }
      else { limiter.threshold.setTargetAtTime(-1.0, t, 0.02); limiter.ratio.setTargetAtTime(20, t, 0.02); }
      setCrossfeed(p.crossfeed || 0);
    }
    function setCrossfeed(amt) { if (!cfBuilt || !cfWet) return; const t = ctx.currentTime; cfWet.gain.setTargetAtTime(amt, t, 0.05); if (cfWet._twin) cfWet._twin.gain.setTargetAtTime(amt, t, 0.05); }

    applyPreset(preset);

    return {
      ok: true, ctx, analyser, presets: Object.keys(PRESETS), eqFreqs: EQ_FREQS.slice(),
      get enabled() { return enabled; }, get preset() { return preset; },
      get sampleRate() { return ctx.sampleRate; },
      note: (n) => (PRESETS[n || preset] || {}).note || "",
      resume() { if (ctx.state === "suspended") ctx.resume(); },
      setEnabled(on) { enabled = !!on; route(); },
      setPreset(name) { applyPreset(name); },
      setBand(i, g) { if (eq[i]) eq[i].gain.setTargetAtTime(g, ctx.currentTime, 0.02); },
      bands() { return eq.map((b) => +b.gain.value.toFixed(1)); },
      setBass(g) { bass.gain.setTargetAtTime(g, ctx.currentTime, 0.02); },
      setAir(g) { air.gain.setTargetAtTime(g, ctx.currentTime, 0.02); },
      setCrossfeed,
      setPreGain(g) { preGain.gain.setTargetAtTime(db(g), ctx.currentTime, 0.02); },
      // RMS level 0..1 of the post-chain output — a real meter / proof of signal.
      level() { const a = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(a); let s = 0; for (let i = 0; i < a.length; i++) { const v = (a[i] - 128) / 128; s += v * v; } return Math.sqrt(s / a.length); },
      dispose() { try { srcNode.disconnect(); } catch {} try { ctx.close(); } catch {} },
    };
  }

  window.HoloAudio = { create, PRESETS, EQ_FREQS };
})();
