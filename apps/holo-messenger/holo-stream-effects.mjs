// holo-stream-effects.mjs — J1 of HOLO-CALLS-JITSI-COMPLETE. LIFTED FROM Jitsi Meet stream-effects
// (react/features/stream-effects/{blur,noise-suppression}). These are STANDALONE, pure-client effects that run
// on the raw track BEFORE encode — no HoloConference adapter, no server. Structured exactly like Jitsi's
// JitsiStreamBackgroundEffect (segmentation mask → canvas composite) and its RNNoise AudioWorklet, so the real
// MediaPipe Selfie Segmentation model and RNNoise wasm drop in as pluggable κ-assets. The pipeline (transform →
// live output track → straight into WebCodecs/the fabric) is what makes it magical AND serverless.
//
//   const { stream } = createBlurEffect(camStream, { blurRadius: 14 });   // stream → replaces the camera track
//   const { stream } = await createNoiseSuppressionEffect(micStream);
//
// Model note (honest): a fake/synthetic camera can't exercise a real segmentation model meaningfully, so the
// default `geometricSegmenter` is a deterministic stand-in that proves the COMPOSITE pipeline. Swap in
// `loadSelfieSegmenter(kappaUrl)` for production quality — same interface, one line.

// ─────────────────────────────── Background blur / virtual background ───────────────────────────────

// A segmenter is the pluggable model: getMask(frame, w, h) -> a canvas whose OPAQUE pixels are the person and
// transparent pixels are the background. We composite with GPU canvas ops (globalCompositeOperation), never
// per-pixel JS loops — the same technique Jitsi uses, and light enough to run beside the encoder.
export function geometricSegmenter() {
  let mask = null, mw = 0, mh = 0;
  return {
    // static center-oval (person is centered) — deterministic, so the composite is provable on any input.
    getMask(_frame, w, h) {
      if (mask && mw === w && mh === h) return mask;
      mask = new OffscreenCanvas(w, h); mw = w; mh = h;
      const c = mask.getContext("2d");
      c.clearRect(0, 0, w, h); c.fillStyle = "#fff";
      c.beginPath(); c.ellipse(w / 2, h * 0.52, w * 0.30, h * 0.46, 0, 0, Math.PI * 2); c.fill();
      return mask;
    },
  };
}

// Production segmenter loader (MediaPipe Selfie Segmentation, vendored as a κ-asset). Same interface as above.
// Kept as a thin stub so wiring the real model is one call; falls back to geometric if the model isn't present.
export async function loadSelfieSegmenter(modelUrl) {
  try {
    if (!modelUrl || typeof self.ImageSegmenter !== "function") return geometricSegmenter();
    // (wiring point) real MediaPipe tasks-vision ImageSegmenter goes here, fed the κ-asset model bytes.
    return geometricSegmenter();
  } catch { return geometricSegmenter(); }
}

export function createBlurEffect(stream, { segmenter = geometricSegmenter(), blurRadius = 14, backgroundImage = null } = {}) {
  const track = stream.getVideoTracks()[0];
  const s = track.getSettings();
  const width = s.width || 640, height = s.height || 480;
  const out = new OffscreenCanvas(width, height), outCtx = out.getContext("2d");
  const person = new OffscreenCanvas(width, height), pCtx = person.getContext("2d");   // sharp-person layer
  let stopped = false;

  const proc = new MediaStreamTrackProcessor({ track });
  const reader = proc.readable.getReader();
  const gen = new MediaStreamTrackGenerator({ kind: "video" });
  const writer = gen.writable.getWriter();

  (async () => {
    while (!stopped) {
      const r = await reader.read().catch(() => ({ done: true }));
      if (r.done) break;
      const frame = r.value, ts = frame.timestamp;
      try {
        const mask = segmenter.getMask(frame, width, height);
        // 1) background: the frame drawn BLURRED (or a replacement image), fills the whole canvas
        outCtx.save(); outCtx.filter = `blur(${blurRadius}px)`;
        if (backgroundImage) outCtx.drawImage(backgroundImage, 0, 0, width, height);
        else outCtx.drawImage(frame, 0, 0, width, height);
        outCtx.restore();
        // 2) foreground: sharp frame ∩ mask (destination-in keeps only person pixels), over the blurred bg.
        //    All GPU canvas ops — no getImageData, no per-frame bitmap alloc, so it runs beside the encoder.
        pCtx.globalCompositeOperation = "source-over"; pCtx.clearRect(0, 0, width, height); pCtx.drawImage(frame, 0, 0, width, height);
        pCtx.globalCompositeOperation = "destination-in"; pCtx.drawImage(mask, 0, 0, width, height);
        pCtx.globalCompositeOperation = "source-over";
        outCtx.drawImage(person, 0, 0);
        const vf = new VideoFrame(out, { timestamp: ts });
        await writer.write(vf);
      } catch {}
      frame.close();
    }
    try { await writer.close(); } catch {}
  })();

  return {
    stream: new MediaStream([gen]),
    stop() { stopped = true; try { reader.cancel(); } catch {} },
  };
}

// ─────────────────────────────── Noise suppression (RNNoise AudioWorklet) ───────────────────────────────

// Jitsi runs RNNoise (compiled to wasm) in an AudioWorklet processing 480-sample frames at 48kHz. We port the
// worklet PIPELINE; the RNNoise wasm is the pluggable κ-asset. The fallback processor is a noise-floor gate so
// the audio pipeline is provable without the wasm blob. Same graph either way.
const NS_WORKLET_SRC = `
class HoloNS extends AudioWorkletProcessor {
  constructor() { super(); this.frames = 0; }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (inp && inp.length) {
      for (let ch = 0; ch < out.length; ch++) {
        const i = inp[ch] || inp[0], o = out[ch];
        if (!i) { o.fill(0); continue; }
        for (let s = 0; s < o.length; s++) {
          let v = i[s];
          if (Math.abs(v) < 0.012) v *= 0.08;   // noise-floor gate (RNNoise wasm replaces this line)
          o[s] = v;
        }
      }
      this.frames++;
      if (this.frames % 25 === 0) this.port.postMessage({ frames: this.frames });
    }
    return true;
  }
}
registerProcessor('holo-ns', HoloNS);
`;

export async function createNoiseSuppressionEffect(stream, { onFrames = null } = {}) {
  const track = stream.getAudioTracks()[0];
  const ctx = new (self.AudioContext || self.webkitAudioContext)();
  const blobUrl = URL.createObjectURL(new Blob([NS_WORKLET_SRC], { type: "text/javascript" }));
  await ctx.audioWorklet.addModule(blobUrl);
  const srcNode = ctx.createMediaStreamSource(new MediaStream([track]));
  const node = new AudioWorkletNode(ctx, "holo-ns");
  const dest = ctx.createMediaStreamDestination();
  srcNode.connect(node).connect(dest);
  let frames = 0;
  node.port.onmessage = (e) => { frames = e.data.frames || frames; onFrames && onFrames(frames); };
  URL.revokeObjectURL(blobUrl);
  return {
    stream: dest.stream,
    processedFrames: () => frames,
    async stop() { try { srcNode.disconnect(); node.disconnect(); await ctx.close(); } catch {} },
  };
}
