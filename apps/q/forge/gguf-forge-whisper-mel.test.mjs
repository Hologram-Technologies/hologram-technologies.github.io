// Holo Whisper S1 mel witness (fast, no model). Validates the STFT framing against
// physics: a pure tone lands in the DFT bin nearest its frequency, the log-mel is
// finite/normalized, and the WAV reader round-trips PCM16. (Exact whisper.cpp-framing
// parity is validated end-to-end by the real-audio transcription harness.)

import assert from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { logMelSpectrogram, readWavPCM16, whisperDetok } from "./gguf-forge-whisper.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

const SR = 16000, NFFT = 400, NBINS = 201;
const tone = (hz, sec = 1) => { const x = new Float32Array(SR * sec); for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * hz * i / SR); return x; };
// identity filterbank: mel bin k == DFT power bin k (k < nBins)
const identity = () => { const f = new Float32Array(80 * NBINS); for (let k = 0; k < 80; k++) f[k * NBINS + k] = 1; return f; };

t("pure tone peaks in the DFT bin nearest its frequency", () => {
  for (const hz of [1000, 2000, 3000]) {
    const expBin = Math.round(hz * NFFT / SR);                 // f·nFft/sr
    const { mel, nFrames } = logMelSpectrogram(tone(hz, 30), identity()); // 30 s = fills all frames
    const f = (nFrames / 2) | 0;
    let best = 0; for (let k = 1; k < 80; k++) if (mel[k * nFrames + f] > mel[best * nFrames + f]) best = k;
    assert.strictEqual(best, expBin, `${hz}Hz → bin ${best}, expected ${expBin}`);
  }
});

t("log-mel is finite, shape [80,3000], clamp span = 2.0 (whisper normalization)", () => {
  const { mel, nMel, nFrames } = logMelSpectrogram(tone(440, 30), identity());
  assert.strictEqual(nMel, 80); assert.strictEqual(nFrames, 3000);
  assert.strictEqual(mel.length, 80 * 3000);
  assert.ok(mel.every(Number.isFinite), "NaN/Inf in mel");
  let mn = Infinity, mx = -Infinity; for (const v of mel) { if (v < mn) mn = v; if (v > mx) mx = v; }
  // log_spec = (max(lv, mmax−8) + 4)/4 → exact span (mmax − (mmax−8))/4 = 2.0
  assert.ok(Math.abs((mx - mn) - 2.0) < 1e-5, `clamp span ${mx - mn} ≠ 2.0`);
});

t("mel is deterministic", () => {
  const x = tone(880), f = identity();
  const a = logMelSpectrogram(x, f).mel, b = logMelSpectrogram(x, f).mel;
  for (let i = 0; i < a.length; i += 997) assert.strictEqual(a[i], b[i]);
});

t("WAV PCM16 reader round-trips a known buffer", () => {
  // build a tiny WAV: 4 samples [0, 16384, -16384, 32767]
  const samples = [0, 16384, -16384, 32767], n = samples.length;
  const buf = new Uint8Array(44 + n * 2), dv = new DataView(buf.buffer);
  buf.set(new TextEncoder().encode("RIFF"), 0); dv.setUint32(4, 36 + n * 2, true); buf.set(new TextEncoder().encode("WAVEfmt "), 8);
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, SR, true); dv.setUint16(34, 16, true);
  buf.set(new TextEncoder().encode("data"), 36); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, samples[i], true);
  const got = readWavPCM16(buf);
  assert.strictEqual(got.length, n);
  assert.ok(Math.abs(got[1] - 16384 / 32768) < 1e-6 && Math.abs(got[3] - 32767 / 32768) < 1e-6);
});

t("S5 detok: raw-UTF-8 vocab tokens concatenate to text WITH spaces", () => {
  const MODEL = "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/ggml-small.bin";
  if (!existsSync(MODEL)) { console.log("      (skipped — model not present)"); return; }
  const b = new Uint8Array(readFileSync(MODEL));
  // 40="I", 1062=" might", 314=" T" (verified token ids) → spaces preserved (whisper stores raw text)
  assert.strictEqual(whisperDetok(b, [40, 1062, 314]), "I might T");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
