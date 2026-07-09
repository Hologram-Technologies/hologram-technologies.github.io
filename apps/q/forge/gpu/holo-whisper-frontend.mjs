// holo-whisper-frontend.mjs — browser-local Whisper front-end (mel + specials + detok).
// Verbatim copies of the pure functions from ../gguf-forge-whisper.mjs (the CPU oracle that is
// byte-exact to whisper-cli). Duplicated ONLY because the oracle module transitively imports
// holo-uor.mjs, which lives outside the forge static-server root. These three functions use NO
// external deps, so the copies are exact — keep them in lockstep with the oracle if it changes.

// log-mel spectrogram: n_fft=400, hop=160; |DFT|² over 201 bins; mel filterbank; log10 + the
// whisper normalize (max−8 floor, +4 /4). Returns { mel:[nMel*nFrames], nFrames, nMel }.
export function logMelSpectrogram(samples, filters, { nMel = 80, nFft = 400, hop = 160, nBins = 201, nSamples = 480000 } = {}) {
  const x = new Float32Array(nSamples + nFft); x.set(samples.subarray(0, Math.min(samples.length, nSamples)));
  const nFrames = (nSamples / hop) | 0;
  const hann = new Float32Array(nFft); for (let i = 0; i < nFft; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nFft);
  const cosT = new Float32Array(nBins * nFft), sinT = new Float32Array(nBins * nFft);
  for (let b = 0; b < nBins; b++) for (let n = 0; n < nFft; n++) { const a = (-2 * Math.PI * b * n) / nFft; cosT[b * nFft + n] = Math.cos(a); sinT[b * nFft + n] = Math.sin(a); }
  const mel = new Float32Array(nMel * nFrames), win = new Float32Array(nFft), pw = new Float64Array(nBins);
  let mmax = -Infinity;
  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    for (let n = 0; n < nFft; n++) win[n] = hann[n] * x[off + n];
    // power spectrum |DFT|² computed ONCE per frame (was recomputed inside the per-mel loop —
    // an 80× redundancy). Same arithmetic + accumulation order ⇒ bit-identical mel, ~80× faster.
    for (let b = 0; b < nBins; b++) { let re = 0.0, im = 0.0; const tb = b * nFft; for (let n = 0; n < nFft; n++) { re += win[n] * cosT[tb + n]; im += win[n] * sinT[tb + n]; } pw[b] = re * re + im * im; }
    for (let k = 0; k < nMel; k++) {
      let s = 0.0; const fb = k * nBins;
      for (let b = 0; b < nBins; b++) s += filters[fb + b] * pw[b];
      let lv = Math.log10(Math.max(s, 1e-10));
      mel[k * nFrames + f] = lv; if (lv > mmax) mmax = lv;
    }
  }
  const floor = mmax - 8.0;
  for (let i = 0; i < mel.length; i++) mel[i] = (Math.max(mel[i], floor) + 4.0) / 4.0;
  return { mel, nFrames, nMel };
}

// Whisper special tokens — derived from n_vocab so the same code serves tiny…large-v3.
export function whisperSpecials(nVocab) {
  const TS_BEGIN = nVocab - 1501;
  return { EOT: 50257, SOT: 50258, LANG_EN: 50259, TRANSLATE: TS_BEGIN - 6, TRANSCRIBE: TS_BEGIN - 5, NO_TIMESTAMPS: TS_BEGIN - 1, TS_BEGIN };
}

const WHISPER_MAGIC = 0x67676d6c, N_HPARAM = 11;
// parse just the vocab from the legacy-ggml header (magic + 11 hparams + mel filterbank + vocab).
function parseVocab(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let o = 0;
  const i32 = () => { const v = dv.getInt32(o, true); o += 4; return v; };
  if (dv.getUint32(o, true) !== WHISPER_MAGIC) throw new Error("whisper: bad magic"); o += 4;
  for (let i = 0; i < N_HPARAM; i++) i32();
  const n_mel = i32(), n_fft = i32(); o += n_mel * n_fft * 4;   // skip mel filterbank
  const nVocab = i32(), tokens = [];
  for (let i = 0; i < nVocab; i++) { const len = i32(); tokens.push(bytes.subarray(o, o + len)); o += len; }
  return tokens;
}

// whisper.cpp stores tokens as RAW UTF-8 text (literal spaces) — no GPT-2 byte decoder.
export function whisperDetok(headerBytes, ids) {
  const tokens = parseVocab(headerBytes);
  let total = 0; for (const id of ids) if (id < tokens.length) total += tokens[id].length;
  const out = new Uint8Array(total); let p = 0;
  for (const id of ids) if (id < tokens.length) { out.set(tokens[id], p); p += tokens[id].length; }
  return new TextDecoder().decode(out);
}
