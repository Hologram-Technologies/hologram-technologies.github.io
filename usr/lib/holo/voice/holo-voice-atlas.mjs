// holo-voice-atlas.mjs — the Q VOICE ATLAS runtime rung. Q's deterministic spoken surface (backchannels,
// openers, chips, refusals, reply frames) is PRE-BAKED offline with premium Kokoro and content-addressed as
// κ-objects (see voice/bake-atlas.mjs). This rung resolves a phrase → its pre-baked premium audio, streamed
// like Netflix: the tiny text→κ manifest ships in-tree; the audio bodies stream on demand and are re-derived
// (Law L5) before decode. A hit is instant premium speech with ZERO model load — for every visitor, new or
// returning. It feeds the SAME κ-memo seam holo-voice.js already has (putPhrasePCM), so the speak ladder needs
// no core change: one resolve rung before live synth. Fail-soft by construction: any miss/tamper/decode error
// returns null and the caller falls through to live Kokoro synth (then the seed floor) — NEVER the robotic
// speechSynthesis floor. 100% serverless, same-origin, mobile + desktop (decodeAudioData + fetch only; no GPU).

export function makeAtlas(opts) {
  opts = opts || {};
  var base = opts.base || "";                        // …/voice/  → atlas.json + atlas/<κ> live under here
  var getAC = opts.audioContext;                     // () => shared AudioContext (decode reuses the voice graph's AC)
  var verify = opts.verify !== false;                // L5: re-derive sha256(bytes) === κ before decode (default on)
  var index = null, manifest = null, loading = null, _ac = null;

  function norm(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function key(s) { return norm(s).toLowerCase(); }

  async function ensure() {
    if (index) return index;
    if (loading) return loading;
    loading = (async function () {
      try {
        var r = await fetch(base + "atlas.json", { cache: "force-cache" });
        if (!r.ok) return (index = new Map());
        manifest = await r.json();
        var m = new Map(), clips = (manifest && manifest.clips) || [];
        for (var i = 0; i < clips.length; i++) if (clips[i] && clips[i].text && clips[i].kappa) m.set(key(clips[i].text), clips[i]);
        return (index = m);
      } catch (e) { return (index = new Map()); }
      finally { loading = null; }
    })();
    return loading;
  }

  function has(text) { return !!(index && index.get(key(text))); }   // sync probe (call after ensure())

  async function sha256hex(buf) {
    var d = await crypto.subtle.digest("SHA-256", buf);
    var a = new Uint8Array(d), s = ""; for (var i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, "0"); return s;
  }
  function ac() { if (getAC) { try { var x = getAC(); if (x) return x; } catch (e) {} } return (_ac = _ac || new (self.AudioContext || self.webkitAudioContext)()); }

  // resolve a phrase → { audio: Float32Array, rate, secs } from the pre-baked κ-object, or null (miss/error).
  // NEVER throws — a null lets the caller fall through to live synth. Content-addressed body is L5-verified.
  async function get(text) {
    try {
      await ensure();
      var c = index.get(key(text)); if (!c) return null;
      var r = await fetch(base + "atlas/" + c.kappa, { cache: "force-cache" });
      if (!r.ok) return null;
      var buf = await r.arrayBuffer();
      if (verify) { var h = await sha256hex(buf); if (h !== c.kappa) return null; }   // refuse a tampered body
      var ab = await ac().decodeAudioData(buf.slice(0));
      return { audio: ab.getChannelData(0).slice(), rate: ab.sampleRate, secs: ab.duration, kappa: c.kappa };
    } catch (e) { return null; }
  }

  return {
    ensure: ensure, has: has, get: get,
    clips: function () { return (manifest && manifest.clips) || []; },
    size: function () { return index ? index.size : 0; },
    info: function () { return manifest ? { count: manifest.count, dtype: manifest.dtype, voice: manifest.voice, totalBytes: manifest.totalBytes } : null; },
  };
}
export default makeAtlas;
