// holo-retro-audio.js — the ONE new seam: a lock-free SPSC float32 audio ring.
//
// QEMU/Alpine never needed tight audio; a game console does — it is the difference
// between "feels like the hardware" and "feels like an emulator." This is the audio
// twin of holo-input-ring.js: a single-producer / single-consumer ring over
// SharedArrayBuffer + Atomics, so the emulation worker (producer) hands the core's
// `audio_sample_batch` samples to the AudioWorklet (consumer) WITHOUT either thread
// ever locking or blocking.
//   • producer = emulation worker: pushes interleaved stereo float32 from retro_run.
//   • consumer = AudioWorklet render thread: pops exactly the frames it needs each
//                128-sample quantum.
//   • bounded   → tight A/V sync; a full ring drops (never stalls the core), an empty
//                ring underruns (counted, outputs silence) — both observable, never a
//                glitch that wedges emulation.
//
// Layout over one SAB: i32[0]=readIdx, i32[1]=writeIdx (monotonic FRAME indices, where
// one "frame" = one stereo sample pair). The sample payload is a Float32Array view that
// starts after the 2-int header (8 bytes, 4-aligned → valid for Float32).

const HEADER_I32 = 2;          // i32[0]=read, i32[1]=write (in stereo frames)
const CH = 2;                  // interleaved stereo

export class AudioRing {
  constructor(sab) {
    this.i32 = new Int32Array(sab, 0, HEADER_I32);
    this.f32 = new Float32Array(sab, HEADER_I32 * 4);     // payload after the header
    this.capFrames = (this.f32.length / CH) | 0;          // ring capacity in stereo frames
    this.stats = { pushed: 0, dropped: 0, popped: 0, underruns: 0 };
  }
  // capacityFrames ≈ how many stereo sample-pairs the ring holds (latency budget).
  static create(capacityFrames = 8192) {
    return new SharedArrayBuffer(HEADER_I32 * 4 + capacityFrames * CH * 4);
  }

  // producer (emulation worker): push `frames` interleaved-stereo float32 samples.
  // Drops the whole batch if it won't fit (back-pressure) rather than stall the core.
  push(interleaved) {
    const frames = (interleaved.length / CH) | 0;
    const w = Atomics.load(this.i32, 1), r = Atomics.load(this.i32, 0);
    if (w - r + frames > this.capFrames) { this.stats.dropped += frames; return false; }
    for (let i = 0; i < frames; i++) {
      const slot = ((w + i) % this.capFrames) * CH;
      this.f32[slot] = interleaved[i * CH];
      this.f32[slot + 1] = interleaved[i * CH + 1];
    }
    Atomics.store(this.i32, 1, w + frames);               // publish (release)
    this.stats.pushed += frames;
    return true;
  }

  // consumer (AudioWorklet): pop up to `frames` into outL/outR (planar). Returns the
  // number of frames actually delivered; the rest is silence (an underrun, counted).
  pop(outL, outR, frames) {
    const r = Atomics.load(this.i32, 0), w = Atomics.load(this.i32, 1);
    const have = Math.min(frames, w - r);
    for (let i = 0; i < have; i++) {
      const slot = ((r + i) % this.capFrames) * CH;
      outL[i] = this.f32[slot]; outR[i] = this.f32[slot + 1];
    }
    for (let i = have; i < frames; i++) { outL[i] = 0; outR[i] = 0; }
    if (have < frames) this.stats.underruns += (frames - have);
    Atomics.store(this.i32, 0, r + have);                 // free the consumed frames
    this.stats.popped += have;
    return have;
  }

  get pending() { return Atomics.load(this.i32, 1) - Atomics.load(this.i32, 0); }   // frames buffered
}

// Linear resampler: the core runs at its native rate (e.g. 32000/44100 Hz); the device
// AudioContext is typically 48000. Resample interleaved-stereo float32 src→dst rate.
// Linear is the floor (cheap, no ringing); a windowed-sinc / hologram-backend kernel is
// the analytic upgrade slot, exactly as the video path has Catmull-Rom→learned.
export function resampleLinear(interleaved, srcRate, dstRate, channels = CH) {
  if (srcRate === dstRate) return interleaved.slice();
  const inFrames = (interleaved.length / channels) | 0;
  const outFrames = Math.max(1, Math.round(inFrames * dstRate / srcRate));
  const out = new Float32Array(outFrames * channels);
  const ratio = (inFrames - 1) / Math.max(1, outFrames - 1);
  for (let o = 0; o < outFrames; o++) {
    const pos = o * ratio;
    const i0 = Math.floor(pos), i1 = Math.min(inFrames - 1, i0 + 1);
    const t = pos - i0;
    for (let c = 0; c < channels; c++) {
      const a = interleaved[i0 * channels + c], b = interleaved[i1 * channels + c];
      out[o * channels + c] = a + (b - a) * t;
    }
  }
  return out;
}
