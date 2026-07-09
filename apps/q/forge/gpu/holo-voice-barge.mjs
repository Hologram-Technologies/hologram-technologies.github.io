// holo-voice-barge.mjs — C2: BARGE-IN THAT UNDERSTANDS. While Q is speaking, the duplex mic stays open; when the
// user starts talking OVER Q, we STOP Q's speech, ABORT the in-flight response generation, and START a fresh
// streaming turn for the new utterance — so the interruption is understood, not just a stop. The thing that makes
// it feel like a real conversation, not walkie-talkie.
//
// ECHO-SAFE: Q's own voice through the speakers leaks into the mic (echo). echoCancellation knocks most of it
// down, but the barge gate adds a second guard: genuine user speech must EXCEED both an absolute floor and an
// echo-relative threshold (bargeEcho × Q's current output level), SUSTAINED for bargeFrames consecutive frames —
// so Q never interrupts itself, and a single blip doesn't false-trigger.
//
// Pure state machine, DOM-free; stopSpeaking/abortGenerate/startTurn injected (production: voice.js TTS stop +
// the C0 generate abort + streamTurn). onFrame is called per mic-level tick.

// makeBargeController({ stopSpeaking, abortGenerate, startTurn, bargeFloor, bargeEcho, bargeFrames, echoGuard })
//   onFrame(userLevel, ctx) → { state, barged }   ctx = { qSpeaking:bool, qOutputLevel:number }
export function makeBargeController({ stopSpeaking = () => {}, abortGenerate = () => {}, startTurn = () => {}, bargeFloor = 0.05, bargeEcho = 0.4, bargeFrames = 9, echoGuard = null } = {}) {
  let loud = 0, state = "idle";

  // is this mic energy plausibly just Q's echo (not the user)? default: below the floor, or below the
  // echo-relative threshold tied to Q's current output level.
  const isEcho = echoGuard || ((userLevel, ctx) => userLevel < Math.max(bargeFloor, (ctx.qOutputLevel || 0) * bargeEcho));

  function onFrame(userLevel, ctx = {}) {
    if (!ctx.qSpeaking) { loud = 0; state = "idle"; return { state, barged: false }; }   // not speaking → no barge logic
    state = state === "listening" ? "listening" : "speaking";
    if (userLevel > bargeFloor && !isEcho(userLevel, ctx)) loud++; else loud = 0;          // sustained genuine speech
    if (loud >= bargeFrames) {
      loud = 0; state = "barging";
      try { stopSpeaking(); } catch (e) {}                                                 // 1) cut Q's audio NOW
      try { abortGenerate(); } catch (e) {}                                                // 2) abort the in-flight response
      try { startTurn(); } catch (e) {}                                                    // 3) understand the interruption
      state = "listening";
      return { state, barged: true };
    }
    return { state, barged: false };
  }

  function reset() { loud = 0; state = "idle"; }
  return { onFrame, reset, state: () => state };
}

export default { makeBargeController };
