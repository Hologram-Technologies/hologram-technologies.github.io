# Holo Voice — converging to a human-to-human realtime feel

Ranked engineering roadmap. Goal: push Q from a fast cascade assistant to the feel of a human
phone call — response onset median **<300 ms**, p90 **<500 ms** (human baseline ~200 ms; gaps
>500 ms feel awkward), fluid turn-taking, expressive prosody, graceful interruption. **Hard
invariant: 100% serverless, on-device, in-browser. Nothing leaves the machine.**

Sourced from a deep-research pass (22 sources, 103 claims, 25 adversarially verified — 23
confirmed, 2 killed). Verified findings are marked ✓; hypotheses (no external verification in
that pass) are marked ⚠ and should be proven empirically with QLab before trusting payoff.

## Current system

Cascade, all on-device (transformers.js / ONNX): mic energy-VAD → Whisper-base (WASM) ASR →
intent route / Qwen2.5-0.5B LLM → Kokoro-82M TTS. Done: sentence-streamed TTS + gapless queue,
κ-memo phrase cache, persistent-mic duplex loop with energy-VAD barge-in, 550 ms fixed-silence
endpoint, warm-start + prewarm, per-turn telemetry (QLab), spoken-style persona.

## The single biggest lever — semantic turn-detection (RANK 1)

Every turn pays a flat **550 ms of silence before ASR even starts**. Fixed-silence endpointing
"imposes a direct latency floor" (✓). A model that reads the **partial transcript** and predicts
turn-end fires the moment an utterance is semantically complete — often before the silence
elapses — and, crucially, *vetoes* premature endpoints when the user is mid-thought, so the
silence floor can be lowered safely.

- **Model:** LiveKit's open-weights turn-detector — a small fine-tuned LLM (a ~135M English
  model; a 0.5B multilingual Qwen2.5 variant), shipped as ONNX:
  [onnx-community/turn-detector-ONNX](https://huggingface.co/onnx-community/turn-detector-ONNX),
  [livekit/turn-detector](https://huggingface.co/livekit/turn-detector). **CPU-only via ONNX
  Runtime Web, ~25 ms inference, q4f16 ≈ 118 MB** (✓). v0.4.1 cut false-positives 39.23% (✓).
  It computes P(end-of-turn) from the partial transcript (✓).
- **Killed myth:** the "~50 ms" figure for this model was **refuted** (1-2 vote) — use ~25 ms.
- **Seam:** the endpoint logic in `micCapture` / a new `captureTurn` in
  `system/os/usr/lib/holo/holo-voice.js`, plus a new `voice/holo-voice-turn.mjs` engine.
- **Dependency:** full power needs streaming ASR (Rank 2) to feed partials. An interim that
  works *today* on the transcript we already produce: shorten the candidate silence to ~300 ms
  and use a turn-completion **veto** (heuristic now, ONNX model later) to resume listening on a
  mid-thought pause instead of clipping the user.
- **Success:** QLab `firstAudio` median <300 ms, p90 <500 ms, without raising the clip-rate.

## Ranked roadmap (impact ÷ effort)

1. **Semantic turn-detection** (above). Highest impact.
2. **Streaming ASR with partial hypotheses** — recognize *while* the user talks so ASR is not a
   serial post-endpoint cost, and to feed Rank 1.
   - Real in-browser: [Xenova/realtime-whisper-webgpu](https://huggingface.co/spaces/Xenova/realtime-whisper-webgpu)
     is a verified fully-in-browser streaming Whisper (✓); Whisper's encoder-decoder can be made
     causal/streaming ([CarelessWhisper, arXiv 2508.12301](https://arxiv.org/abs/2508.12301), ✓).
   - **Killed:** Moonshine is faster (~107 ms vs Whisper's 11,286 ms on their bench, ✓) **but has
     no in-browser / WASM / transformers.js path** (refuted 0-3) — do not plan on it for the
     browser invariant.
   - Seam: a rolling/chunked partial mode in `voice/holo-voice-asr.mjs`. Risk: WebGPU flaky;
     WASM streaming Whisper is heavier.
3. **Sub-sentence (first-chunk) TTS streaming** — we stream per sentence today; go to first
   clause. kokoro-js runs 100% locally in-browser **and supports streaming synthesis via a
   TextStreamer** (both ✓). Seam: `voice/holo-voice-tts.mjs` + the speaker chunker. Risk:
   chunks too small → choppy prosody; balance.

## The honest ceiling — not achievable in-browser today

**Full-duplex speech-to-speech (Moshi/Kyutai).** The architecture that truly matches a human
call (listen + think + speak in one stream; 160 ms theoretical latency, ✓). But Moshi's core is
a **7B Transformer needing ~24 GB GPU; there is no browser / WASM path** (✓). Do not pursue
on-device in a browser. Borrow its *predict-while-listening* idea via the cascade + turn-detector
+ speculation instead.

## Promising but unverified (⚠ — prove with QLab, don't assume payoff)

The research pass found no external verification for these; treat as hypotheses:

- **KV-cache / prompt-prefix reuse** so first-token skips re-encoding the fixed system prompt.
  Standard, low-risk; still worth doing.
- **Speculative response generation** from partial transcripts (revise if the user keeps
  talking). Medium-risk: wasted compute + revision logic.
- **Backchannels** ("mm-hm") while listening; **yield-and-resume** barge-in vs hard stop.
- **Measurement (axis F):** no verified external benchmark surfaced. Extend QLab to report the
  response-onset distribution, turn-gap, interrupt reaction time, and an A/B harness.

## Recommended order

Ship **Rank 1's interim** (adaptive endpoint + turn-completion veto, heuristic scorer) now — it
is fully testable on-device and already lowers the silence floor without clipping. Then vendor
the ONNX turn-detector as the high-accuracy scorer behind the same seam, then streaming ASR
(Rank 2) to unlock firing *before* silence, then sub-sentence TTS (Rank 3).
