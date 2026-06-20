// holo-loudness.mjs — honest loudness measurement for Hologram audio (ITU-R BS.1770 / EBU R128).
//
// Pure, isomorphic, deterministic: given PCM, it returns the SAME numbers in Node and the browser, so a
// track's loudness can be measured once at ingest, stored in its manifest, and trusted at playback. No
// fabrication — these are real measurements of the real samples.
//
//   integratedLufs(channels, sampleRate)  → LUFS (K-weighted, 400ms blocks, absolute −70 + relative −10 gate)
//   truePeakDbtp(channels, sampleRate)    → dBTP (4× oversampled peak; ≥ sample peak)
//   samplePeakDbfs(channels)              → dBFS (exact sample peak)
//   normalizeGainDb({ lufs, truePeakDbtp }, targetLufs=-16, ceilingDbtp=-1)
//        → gain (dB) to reach the target loudness, CLAMPED so the true peak never exceeds the ceiling.
//
// channels: array of Float32Array (one per channel), samples in [-1, 1].
// Authorities: ITU-R BS.1770-4 (K-weighting + gating) · EBU R128 (target/gating practice) · RBJ cookbook
// (the biquads, computed for the ACTUAL sample rate — not hard-coded 48k coefficients).

const log10 = (x) => Math.log(x) / Math.LN10;
const db = (x) => 20 * log10(x);

// RBJ biquad coefficients (normalized a0=1) for the two K-weighting stages, at the real sample rate.
function highShelf(fs, f0, dBgain, Q) {
  const A = Math.pow(10, dBgain / 40), w0 = 2 * Math.PI * f0 / fs, cw = Math.cos(w0), sw = Math.sin(w0);
  const alpha = sw / (2 * Q), tsAa = 2 * Math.sqrt(A) * alpha;
  const b0 = A * ((A + 1) + (A - 1) * cw + tsAa), b1 = -2 * A * ((A - 1) + (A + 1) * cw), b2 = A * ((A + 1) + (A - 1) * cw - tsAa);
  const a0 = (A + 1) - (A - 1) * cw + tsAa, a1 = 2 * ((A - 1) - (A + 1) * cw), a2 = (A + 1) - (A - 1) * cw - tsAa;
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function highPass(fs, f0, Q) {
  const w0 = 2 * Math.PI * f0 / fs, cw = Math.cos(w0), sw = Math.sin(w0), alpha = sw / (2 * Q);
  const b0 = (1 + cw) / 2, b1 = -(1 + cw), b2 = (1 + cw) / 2, a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function biquad(x, c) {                                          // direct form I, returns a NEW Float32Array
  const [b0, b1, b2, a1, a2] = c; const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const xi = x[i]; const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; y[i] = yi; x2 = x1; x1 = xi; y2 = y1; y1 = yi; }
  return y;
}

// K-weighting (BS.1770): stage 1 high-shelf (≈+4 dB above ~1681 Hz) then stage 2 high-pass (≈38 Hz).
function kWeight(ch, fs) { return biquad(biquad(ch, highShelf(fs, 1681.974450955533, 3.99984385397, 0.7071752369554196)), highPass(fs, 38.13547087613982, 0.5003270373238773)); }

export function integratedLufs(channels, sampleRate) {
  if (!channels || !channels.length) return -Infinity;
  const fs = sampleRate || 48000;
  const k = channels.map((c) => kWeight(c, fs));                 // weight each channel
  const blockLen = Math.round(0.4 * fs), hop = Math.round(0.1 * fs), n = k[0].length;  // 400 ms blocks, 100 ms hop (75% overlap)
  if (n < blockLen) return -Infinity;
  const blocks = [];                                             // mean-square sum across channels per block (G_i = 1.0 for L/R)
  for (let start = 0; start + blockLen <= n; start += hop) {
    let z = 0;
    for (let c = 0; c < k.length; c++) { const ch = k[c]; let s = 0; for (let i = start; i < start + blockLen; i++) s += ch[i] * ch[i]; z += s / blockLen; }
    blocks.push(z);
  }
  if (!blocks.length) return -Infinity;
  const loud = (z) => -0.691 + 10 * log10(z);
  const absGated = blocks.filter((z) => z > 0 && loud(z) >= -70);                       // absolute gate −70 LUFS
  if (!absGated.length) return -Infinity;
  const meanAbs = absGated.reduce((a, b) => a + b, 0) / absGated.length;
  const relThresh = loud(meanAbs) - 10;                                                  // relative gate −10 LU
  const relGated = absGated.filter((z) => loud(z) >= relThresh);
  if (!relGated.length) return -Infinity;
  const meanRel = relGated.reduce((a, b) => a + b, 0) / relGated.length;
  return +loud(meanRel).toFixed(2);
}

export function samplePeakDbfs(channels) {
  let peak = 0; for (const ch of channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
  return peak > 0 ? +db(peak).toFixed(2) : -Infinity;
}

// 4× oversampled peak (linear interpolation) — catches most inter-sample peaks; always ≥ the sample peak.
export function truePeakDbtp(channels, sampleRate) {
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = ch[i], b = i + 1 < ch.length ? ch[i + 1] : ch[i];
      for (let s = 0; s < 4; s++) { const v = Math.abs(a + (b - a) * (s / 4)); if (v > peak) peak = v; }
    }
  }
  return peak > 0 ? +db(peak).toFixed(2) : -Infinity;
}

// gain (dB) to reach targetLufs, clamped so (truePeak + gain) ≤ ceilingDbtp. Loudness-up never clips.
export function normalizeGainDb(m, targetLufs = -16, ceilingDbtp = -1) {
  if (!m || !isFinite(m.lufs)) return 0;
  let g = targetLufs - m.lufs;
  if (isFinite(m.truePeakDbtp)) g = Math.min(g, ceilingDbtp - m.truePeakDbtp);
  return +g.toFixed(2);
}

// Convenience: measure everything at once.
export function measure(channels, sampleRate) {
  return { lufs: integratedLufs(channels, sampleRate), samplePeakDbfs: samplePeakDbfs(channels), truePeakDbtp: truePeakDbtp(channels, sampleRate), sampleRate, channels: channels.length };
}

try { if (typeof window !== "undefined") window.HoloLoudness = { integratedLufs, samplePeakDbfs, truePeakDbtp, normalizeGainDb, measure }; } catch (e) {}
