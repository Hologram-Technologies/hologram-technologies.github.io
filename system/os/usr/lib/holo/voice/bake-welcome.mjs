// bake-welcome.mjs — render the fixed first-run WELCOME script to content-addressed audio, so a brand-new
// user hears Q's greeting INSTANTLY (no 92MB model download/compile on the critical path). Produces
// voice/welcome.mjs in the SAME shape HoloVoice.bakeWelcome() emits in-browser, so the runtime
// (loadWelcomeBaked → decodeWavB64 → enqueuePCM) plays it with zero changes. Kokoro af_heart, q8, on-device.
//
// This is the Node-side baker (no browser needed). It loads the SAME vendored Kokoro weights the browser
// uses (voice/vendor/models/), so the rendered bytes are byte-for-byte the in-product voice. Run once after
// editing WELCOME; commit the resulting welcome.mjs. kokoro-js must be available (npm i kokoro-js@1.2.1).
//
//   node bake-welcome.mjs            # uses local vendored weights, writes ./welcome.mjs
//   KOKORO_JS=/path/to/kokoro-js node bake-welcome.mjs   # point at an external kokoro-js install
//
// Per-word timestamps: after rendering each line it runs Whisper word-level forced alignment over the audio
// (via the same @huggingface/transformers kokoro-js uses) and stores `wtimes` so the caption is frame-exact.
// The Whisper model is fetched from HuggingFace on first run (needs network once). Tune or disable:
//   WHISPER_MODEL=Xenova/whisper-tiny.en node bake-welcome.mjs   # smaller/faster aligner
//   WHISPER_MODEL=none node bake-welcome.mjs                      # skip alignment (audio only; runtime estimates)
//
// Keep WELCOME identical to the array in holo-voice.js (the runtime falls back to live-synthing these exact
// lines if welcome.mjs is ever absent, so they must not drift).

import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VOICE = "af_heart";
const OUT = path.join(HERE, "welcome.mjs");
const LOCAL_MODELS = path.join(HERE, "vendor", "models"); // localModelPath → <repo>/voice/vendor/models/<repo-id>/…

// MUST match WELCOME in holo-voice.js.
const WELCOME = [
  "Hi, I'm Q, and welcome to Hologram. Most computers send your life off to someone else's servers. This one doesn't. It was built so the power stays with you. It's a whole operating system living right here in your browser, a desktop, apps, your files, with nothing to install and no account to make.",
  "And I run entirely on your device. I hear you, think, and speak without a single word ever leaving this machine.",
  "So just talk to me. Try 'open the browser', 'switch to dark mode', or ask me anything. I'm always one tap away. And from here, we learn, grow, and evolve together."
];

// The caption's READING form — MUST match captionText() in holo-voice.js, so the per-word timestamps we
// emit line up 1:1 with the words the caption actually tokenises (split on whitespace) and renders.
function captionText(s) {
  return String(s == null ? "" : s)
    .replace(/\s+[—–-]+\s+/g, ", ")
    .replace(/\s*,(\s*,)+/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}
function normWord(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

// Linear resample to 16 kHz — what the Whisper ASR pipeline expects (Kokoro renders at 24 kHz).
function resampleTo16k(float32, srcRate) {
  if (srcRate === 16000) return float32;
  const ratio = srcRate / 16000, n = Math.floor(float32.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio, i0 = Math.floor(x), i1 = Math.min(i0 + 1, float32.length - 1), f = x - i0;
    out[i] = float32[i0] * (1 - f) + float32[i1] * f;
  }
  return out;
}

// FORCED ALIGNMENT: align Whisper's word-timestamp chunks to the caption tokens, in order. Whisper may split a
// word across chunks (we concatenate until the normalised forms match) and reports each chunk's start time. We
// take the first chunk's start as the word's onset. Returns one onset (seconds, clip-relative) per caption token,
// or null if anything fails to line up — the runtime then falls back to its speech-shaped estimate for that line.
function alignWords(capToks, chunks) {
  const wn = chunks
    .map((c) => ({ n: normWord(c.text), t: Array.isArray(c.timestamp) ? c.timestamp[0] : c.timestamp }))
    .filter((x) => x.n && typeof x.t === "number");
  const times = new Array(capToks.length); let wi = 0;
  for (let ci = 0; ci < capToks.length; ci++) {
    const target = normWord(capToks[ci]);
    if (!target) { times[ci] = wi < wn.length ? wn[wi].t : 0; continue; }
    if (wi >= wn.length) return null;
    const startT = wn[wi].t; let acc = "";
    while (wi < wn.length && acc.length < target.length) { acc += wn[wi].n; wi++; }
    if (acc !== target) return null;                                  // misalignment → give up on this line (safe: runtime estimates)
    times[ci] = startT;
  }
  return times;
}

// Load a Whisper ASR pipeline for word timestamps (downloaded from HuggingFace once; override with WHISPER_MODEL).
async function loadAligner(tf) {
  const spec = process.env.KOKORO_JS ? path.join(process.env.KOKORO_JS, "../@huggingface/transformers") : "@huggingface/transformers";
  const { pipeline } = await import(spec);
  if (tf && tf.env) { tf.env.allowRemoteModels = true; tf.env.allowLocalModels = true; }   // Whisper isn't vendored → allow the one-time fetch
  const model = process.env.WHISPER_MODEL || "Xenova/whisper-base.en";
  console.log("loading aligner (Whisper word timestamps):", model, "…");
  return pipeline("automatic-speech-recognition", model);
}

// Float32 → 16-bit PCM WAV (mono) — byte-identical to encodeWav() in holo-voice.js.
function encodeWav(float32, rate) {
  const n = float32.length, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0, "ascii"); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii"); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii"); buf.writeUInt32LE(n * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) { let s = Math.max(-1, Math.min(1, float32[i])); buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, o); o += 2; }
  return buf;
}

async function main() {
  const kkSpec = process.env.KOKORO_JS || "kokoro-js";
  const { KokoroTTS } = await import(kkSpec);
  // Same transformers singleton kokoro-js uses → point it at the vendored, on-disk weights (no network).
  const tf = await import(process.env.KOKORO_JS ? path.join(process.env.KOKORO_JS, "../@huggingface/transformers") : "@huggingface/transformers").catch(() => null);
  if (tf && tf.env) {
    if (existsSync(LOCAL_MODELS)) {
      tf.env.allowRemoteModels = false; tf.env.allowLocalModels = true; tf.env.localModelPath = LOCAL_MODELS;
      console.log("using local vendored weights:", LOCAL_MODELS);
    } else {
      console.log("vendored weights not found at", LOCAL_MODELS, "— downloading from HuggingFace");
    }
  }
  console.log("loading Kokoro-82M (q8)…");
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });

  // Forced-alignment is best-effort: if Whisper can't load (offline, etc.) we still emit the audio and the
  // runtime falls back to its speech-shaped estimate. Skip entirely with WHISPER_MODEL=none.
  let aligner = null;
  if (process.env.WHISPER_MODEL !== "none") {
    try { aligner = await loadAligner(tf); }
    catch (e) { console.log("  (aligner unavailable — emitting audio without per-word timestamps:", (e && e.message) || e, ")"); }
  }

  const lines = [];
  for (const text of WELCOME) {
    process.stdout.write("  synth: " + JSON.stringify(text.slice(0, 48)) + "… ");
    const audio = await tts.generate(text, { voice: VOICE });
    const rate = audio.sampling_rate || 24000;
    const wav = encodeWav(audio.audio, rate);
    const line = { text, wav: wav.toString("base64") };

    if (aligner) {
      try {
        const wav16 = resampleTo16k(audio.audio, rate);
        const asr = await aligner(wav16, { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5 });
        const capToks = captionText(text).split(/\s+/).filter(Boolean);
        const times = asr && asr.chunks ? alignWords(capToks, asr.chunks) : null;
        if (times) { line.wtimes = times.map((t) => Math.round(t * 1000) / 1000); }   // ms precision is plenty
        process.stdout.write(times ? "[aligned " + times.length + " words] " : "[align miss → estimate] ");
      } catch (e) { process.stdout.write("[align error → estimate] "); }
    }

    lines.push(line);
    console.log((wav.length / 1024).toFixed(1) + "KB @ " + rate + "Hz");
  }

  const payload = { voice: VOICE, lines };
  const aligned = lines.filter((l) => l.wtimes).length;
  const mod = "// holo-voice welcome audio — the fixed first-run script PRE-RENDERED + content-addressed, so the\n" +
    "// welcome plays INSTANTLY for every new user (no model load). Each line MAY carry `wtimes`: per-word\n" +
    "// onset seconds (clip-relative, one per captionText().split(/\\s+/) token) from Whisper forced alignment,\n" +
    "// so the calm caption rides the REAL word onsets — frame-exact. Re-bake: node voice/bake-welcome.mjs\n" +
    "export const WELCOME_AUDIO = " + JSON.stringify(payload) + ";\nexport default WELCOME_AUDIO;\n";
  await writeFile(OUT, mod);
  const kappa = createHash("sha256").update(mod).digest("hex");
  console.log("\nwrote", OUT, "(" + (mod.length / 1024).toFixed(0) + "KB, " + lines.length + " lines, " + aligned + " with per-word timestamps)");
  console.log("κ (sha256):", kappa);
}

main().catch((e) => { console.error("\nBAKE FAILED:", e && e.stack || e); process.exit(1); });
