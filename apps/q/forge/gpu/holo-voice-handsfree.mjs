// holo-voice-handsfree.mjs — W3: the top-level hands-free loop. Ties the ambient gate (W1, run the ear only on
// speech energy), the echo-safe wake detector (W0/W2, fire on "Hey Q" but never self-wake), and the conversation
// (C0–C4, speculative answer + clause speak + provenance) into one controller. Idle → "Hey Q, <command>" in one
// breath → Q listens to the trailing command, ends the turn on meaning, and answers — no click, hands-free.
//
// Faculties injected. The browser binding feeds it the mic energy + the streaming ear's partials; here it's
// driven frame-by-frame so the whole loop is testable headless.
import { makeAmbientGate } from "./holo-voice-ambient.mjs";

// makeHandsFree({ gate, wake, conversation, endpoint, qOutputLevel, onState }) → { onFrame(ev), tick(atMs), reset() }
//   gate         : makeAmbientGate (or built from `energyFloor`)
//   wake         : makeEchoSafeWake (echo-safe wake detector)
//   conversation : makeConversation (feedPartial / endTurn / isSpeaking)
//   endpoint     : makeEndpoint (semantic turn end on the command)
//   onFrame(ev)  : ev = { level, partial, atMs } — `partial` is the ear's current text (null while the gate is idle)
export function makeHandsFree({ gate, energyFloor = 0.02, wake, conversation, endpoint, qOutputLevel = () => 0, onState = () => {} } = {}) {
  if (!wake || !conversation || !endpoint) throw new Error("makeHandsFree needs { wake, conversation, endpoint }");
  const g = gate || makeAmbientGate({ energyFloor });
  let armed = false, lastTail = "", lastPartialAt = 0;

  async function onFrame({ level = 0, partial = null, atMs = 0 } = {}) {
    const gs = g.onFrame(level, atMs);                     // ambient: should the ear run this frame?
    if (!gs.run) { onState({ state: "idle", armed }); return { state: "idle", armed }; }
    if (partial == null) return { state: gs.state, armed };
    const w = wake.observe(partial, { qSpeaking: conversation.isSpeaking(), micLevel: level, qOutputLevel: qOutputLevel(), atMs });
    if (w.suppressed) return { state: gs.state, armed, suppressed: true };
    if (w.woke) { armed = true; onState({ state: "armed", armed }); }
    if (armed && w.tail) {                                 // stream the command into the conversation
      lastTail = w.tail; lastPartialAt = atMs;
      await conversation.feedPartial(lastTail);            // speculative pre-warm of the answer
      await endpoint.observe(lastTail, atMs);              // semantic turn detector reads it
    }
    return { state: gs.state, armed, tail: lastTail };
  }

  // tick(atMs) — on a timer: when the endpoint says the command is complete, answer + disarm for the next "Hey Q".
  async function tick(atMs) {
    if (!armed) return null;
    const d = endpoint.decide(atMs);
    if (!d.fire) return { fire: false };
    const r = await conversation.endTurn(lastTail);        // commit (pre-warmed) answer + speak
    armed = false; wake.reset(); endpoint.reset(); lastTail = "";
    onState({ state: "idle", armed: false });
    return { fire: true, ...r };
  }

  function reset() { g.reset(); wake.reset(); endpoint.reset(); conversation.reset(); armed = false; lastTail = ""; }
  return { onFrame, tick, reset, isArmed: () => armed };
}

export default { makeHandsFree };
