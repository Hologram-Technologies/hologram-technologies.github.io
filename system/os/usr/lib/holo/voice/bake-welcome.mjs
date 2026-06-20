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

  const lines = [];
  for (const text of WELCOME) {
    process.stdout.write("  synth: " + JSON.stringify(text.slice(0, 48)) + "… ");
    const audio = await tts.generate(text, { voice: VOICE });
    const wav = encodeWav(audio.audio, audio.sampling_rate || 24000);
    lines.push({ text, wav: wav.toString("base64") });
    console.log((wav.length / 1024).toFixed(1) + "KB @ " + (audio.sampling_rate || 24000) + "Hz");
  }

  const payload = { voice: VOICE, lines };
  const mod = "// holo-voice welcome audio — the fixed first-run script PRE-RENDERED + content-addressed, so the\n" +
    "// welcome plays INSTANTLY for every new user (no model load). Re-bake: node voice/bake-welcome.mjs\n" +
    "export const WELCOME_AUDIO = " + JSON.stringify(payload) + ";\nexport default WELCOME_AUDIO;\n";
  await writeFile(OUT, mod);
  const kappa = createHash("sha256").update(mod).digest("hex");
  console.log("\nwrote", OUT, "(" + (mod.length / 1024).toFixed(0) + "KB, " + lines.length + " lines)");
  console.log("κ (sha256):", kappa);
}

main().catch((e) => { console.error("\nBAKE FAILED:", e && e.stack || e); process.exit(1); });
