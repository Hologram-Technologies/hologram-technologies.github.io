// holo-pull-consume.mjs — the consumer that DRIVES the playhead. It walks an ordered list of κ-blocks,
// front-runs the next `lookahead` by deadline, pulls each through holo-pull (warm cache when prefetch
// wins the race), and hands the VERIFIED bytes to a sink the instant they land. TTFF — not completion —
// is the bar. The SAME loop powers two surfaces; only the sink differs, and the sink is the ONLY thing
// that touches a GPU, so this module stays pure + Node-witnessable:
//   • video  — sink = WebCodecs decode → WebGPU draw; `fps` set ⇒ the playhead is wall-clock paced, and
//               that pacing IS the flow control (a slow display naturally throttles fetch — no unbounded buffer).
//   • κ-inference — sink = run the layer; `fps` omitted ⇒ as-fast-as-verified, and the forward pass is
//               the playhead (set a deadline on the next layer's shards; the layer runs as they arrive).
// The sink reuses what already exists (apps/player + apps/stream for video; holo-archive/openHoloStream +
// holo-q-corebrains + the holo-sd-native kernels for inference). This file adds only the driving loop.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// consume(pull, { order, onFrame, fps?, lookahead?, slackMs?, now?, signal? }) → Promise<stats>
//   order    : cids in consumption order (the manifest, or first-use / layer order)
//   onFrame  : (i, cid, bytes) → void|Promise — the render/compute sink (verified bytes only)
//   fps      : if >0, pace the playhead to this frame rate (video); omit for as-fast-as-verified (inference)
//   lookahead: how many upcoming frames to deadline-prefetch ahead of the playhead (default 8)
//   signal   : optional { aborted } to stop early
export async function consume(pull, { order = [], onFrame = () => {}, fps = 0, lookahead = 8, slackMs = 4, now = () => Date.now() } = {}, signal = null) {
  pull.start();                                  // the consume layer owns start() (Phase-A contract)
  const frameMs = fps > 0 ? 1000 / fps : 0;
  const t0 = now();
  let frames = 0, ttffMs = -1, stalls = 0, lateMs = 0;

  for (let i = 0; i < order.length; i++) {
    if (signal && signal.aborted) break;
    pull.setPlayhead(i);
    for (let k = 0; k < lookahead && i + k < order.length; k++) pull.setDeadline(order[i + k], i + k);  // sooner index ⇒ sooner deadline

    const g0 = now();
    const bytes = await pull.getBlock(order[i]); // resolves the instant the block verifies (≈0 if prefetched)
    const wait = now() - g0;                     // how long the display had to WAIT ON THE NETWORK for this frame
    if (ttffMs < 0) ttffMs = now() - t0;         // frame 0's wait IS the time-to-first-frame, not a stall
    if (fps > 0 && i > 0 && wait > slackMs) { stalls++; lateMs += wait; }   // a stall = a REBUFFER after playback started

    await onFrame(i, order[i], bytes);
    frames++;

    if (fps > 0) { const s = (i + 1) * frameMs - (now() - t0); if (s > 0) await sleep(s); }   // hold to cadence
  }
  return { frames, ttffMs, stalls, lateMs, ms: now() - t0, done: frames === order.length };
}

export default { consume };
