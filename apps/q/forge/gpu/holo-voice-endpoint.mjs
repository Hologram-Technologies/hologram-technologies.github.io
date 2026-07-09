// holo-voice-endpoint.mjs — I2: turn the I1 partial stream into an ENDPOINT decision that fires on MEANING.
//
// The 550ms fixed-silence floor is the single largest fixed cost in a turn. This controller reads each
// streaming partial through the semantic turn-detector (voice/holo-voice-turn.mjs predict() → P(complete)),
// and lowers the silence floor when the utterance is semantically DONE — firing the endpoint in ~earlyMs
// instead of ~floorMs — while VETOING a premature endpoint when the user only paused mid-thought (P low),
// so we never clip. This is the move that buys the sub-300ms human-call feel.
//
// FULL-STACK, O(1): every predict() goes through the L1/L2 content-addressed compute memo
// (holo-compute-memo.mjs). Streaming partials are monotonic prefixes and a held pause repeats the SAME
// partial text — so the turn-detector forward pass is computed ONCE per distinct transcript and REPLAYED
// from L1 (resident) / L2 (OPFS κ-store) with no model dispatch. The detector weights themselves are a κ
// faculty in the Voice pack (I0, the "turn" entry), streamed from the encoder-first .holo. Serverless,
// on-device, browser+mobile: predict + memo are CPU/WASM and DOM-free; nothing leaves the machine.
//
// predict + memo are INJECTED (pure, testable). The browser binding wires the real createTurnDetector() and
// makeComputeMemo({ l2: the OPFS κ-store }). predict() returning null (model not ready / mismatch) degrades
// to a heuristic so the controller NEVER blocks the working path (the seam's fail-soft contract).

const f64ToBytes = (x) => new Uint8Array(new Float64Array([x]).buffer);
const bytesToF64 = (b) => new Float64Array(b.buffer, b.byteOffset, 1)[0];
const norm = (t) => String(t || "").trim().replace(/\s+/g, " ").toLowerCase();

// makeEndpoint({ predict, memo, modelTag, completeThreshold, earlyMs, floorMs, heuristic }) → controller.
//   predict(text)        : async → P(turn complete) ∈ [0,1] | null   (the real turn-detector, injected)
//   memo                 : makeComputeMemo({...}) — the O(1) L1/L2 compute memo (injected)
//   modelTag             : the op identity for the memo key (bump when the detector κ changes)
//   completeThreshold    : P ≥ this ⇒ the utterance reads as DONE (default 0.7)
//   earlyMs / floorMs    : the silence wait when DONE vs when not (default 120 / 550)
//   heuristic(text)      : fallback scorer when predict() returns null (terminal punctuation / wh-question)
export function makeEndpoint({ predict, memo, modelTag = "turn-detector@v1", completeThreshold = 0.7, earlyMs = 120, floorMs = 550, heuristic = defaultHeuristic } = {}) {
  if (!predict || !memo) throw new Error("makeEndpoint needs { predict, memo }");
  let lastProb = 0, lastPartialAtMs = 0, fired = false, lastText = "";

  // observe(text, atMs) — call on each I1 partial. Memoized predict; identical text ⇒ L1/L2 hit, no dispatch.
  async function observe(text, atMs) {
    const t = norm(text);
    lastText = t; lastPartialAtMs = atMs; fired = false;
    const res = await memo.compute(modelTag, t, async () => {
      let p = await predict(t);
      if (p == null) p = heuristic(t);                 // fail-soft (the seam never blocks)
      return f64ToBytes(Math.max(0, Math.min(1, p)));
    });
    lastProb = bytesToF64(res.bytes);
    return { prob: lastProb, hit: res.hit, computed: res.computed, done: lastProb >= completeThreshold };
  }

  // decide(atMs) — given the current time, has the endpoint condition been met? The silence wait is SHORT
  // when the utterance reads done (earlyMs) and FULL otherwise (floorMs = the veto that prevents clipping).
  function decide(atMs) {
    const silenceMs = atMs - lastPartialAtMs;
    const wait = lastProb >= completeThreshold ? earlyMs : floorMs;
    const fire = !fired && silenceMs >= wait;
    if (fire) fired = true;
    return { fire, onsetMs: wait, silenceMs, prob: lastProb, done: lastProb >= completeThreshold,
      reason: fire ? (wait === earlyMs ? "semantic-complete (early fire)" : "silence-floor (veto held to floor)") : (lastProb >= completeThreshold ? "armed, awaiting earlyMs" : "veto: mid-thought, holding to floor") };
  }

  // the baseline this beats: a fixed silence floor with NO turn model (every turn pays floorMs).
  const baselineOnsetMs = () => floorMs;
  function reset() { lastProb = 0; lastPartialAtMs = 0; fired = false; lastText = ""; }

  return { observe, decide, reset, baselineOnsetMs, state: () => ({ lastProb, lastText, fired }) };
}

// defaultHeuristic — the today-path scorer when the ONNX turn model isn't loaded: terminal punctuation or a
// short trailing function word ⇒ likely incomplete. Crude but never blocks; the model supersedes it.
export function defaultHeuristic(text) {
  const t = norm(text);
  if (!t) return 0;
  if (/[.!?]$/.test(t)) return 0.9;
  if (/\b(the|a|an|to|and|or|but|of|for|in|on|with|my|your|is|are|i|we)$/.test(t)) return 0.15;  // dangling → mid-thought
  return 0.6;
}

export default { makeEndpoint, defaultHeuristic };
