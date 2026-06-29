// holo-voice-seed-handoff.mjs — SPEAK-WHILE-STREAMING. A cold user can't wait for the 485 MB brain (see
// hologram-q-pack-DELIVERY-FINDINGS.md). So answer from a tiny ~5 MB SEED brain the instant it loads, speak it
// immediately, and hand off to the FULL brain mid-utterance via SPECULATIVE verification — the full model (drafter =
// seed) accepts the longest correct prefix of the seed's draft and continues, so quality converges within the sentence
// with NO restart and NO audible gap. First-audio ≈ seed-load time; final answer = full quality.
//
//   makeSeedHandoff({ seed, full, speak, onEvent }) → { turn(history) → spokenText }
//     seed.respond(history)            → async-iterable token strings (fast, weaker)
//     full.ready()                     → Promise (resolves when the full brain's weights are streamed in)
//     full.verify(history, draft)      → async-iterable VERIFIED tokens (re-emits the accepted prefix, then continues)
//     speak(token)                     → enqueue a token to clause-streaming TTS (downstream batches to audio)
//
// Honest limits: tokens the seed ALREADY spoke are committed (you can't un-say audio) — the full model corrects only
// from the first DIVERGENCE forward. A good seed + short opener keeps divergence late, so the correction is seamless.

export function makeSeedHandoff({ seed, full, speak, onEvent = () => {} }) {
  const evt = (e, d) => { try { onEvent(e, d); } catch {} };

  async function turn(history) {
    const spoken = [];                 // tokens already sent to TTS (committed audio)
    let full_ready = false;
    full.ready().then(() => { full_ready = true; evt("full-ready", { atToken: spoken.length }); });

    // 1) speak from the SEED immediately, token by token, until the full brain is ready
    for await (const tok of seed.respond(history)) {
      if (full_ready) break;
      spoken.push(tok); speak(tok); evt("seed-token", { tok, i: spoken.length });
    }
    evt("handoff", { spokenPrefix: spoken.length });

    // 2) HAND OFF: the full brain verifies the seed's draft (speculative) and continues. It re-emits its view of the
    //    sequence; we skip whatever matches what we already spoke (the accepted prefix) and speak only the new tail —
    //    from the first divergence (the correction) onward. No restart, no repeat.
    let i = 0;
    for await (const tok of full.verify(history, spoken.slice())) {
      if (i < spoken.length && tok === spoken[i]) { i++; continue; }      // accepted prefix — already spoken
      if (i < spoken.length && tok !== spoken[i]) { evt("diverge", { at: i, was: spoken[i], now: tok }); i = spoken.length; }
      spoken.push(tok); speak(tok); evt("full-token", { tok, i: spoken.length });
    }
    return spoken.join(" ");
  }

  return { turn };
}

export default makeSeedHandoff;
