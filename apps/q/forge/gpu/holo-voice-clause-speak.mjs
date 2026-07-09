// holo-voice-clause-speak.mjs — C1: STREAMING SPEAK. Speak Q's answer CLAUSE-BY-CLAUSE as the brain generates it,
// instead of waiting for the whole paragraph — so the first audio lands in ~one clause, not one response. The
// brain streams tokens → this segments them into clauses at punctuation and pushes each to the TTS queue the
// moment it completes. Clauses go through the clause-grained κ-cache (CFG.clauseCache / the compute memo), so a
// repeated clause replays instantly and the karaoke ribbon syncs to what's actually spoken.
//
// DOM-free, dependency-free; speak + memo injected (production: holo-voice-tts kokoro + holo-compute-memo).
// TTS is SERIALISED (one clause plays at a time, in order) so audio never overlaps — the queue drains in order.

const norm = (t) => String(t || "").trim().replace(/\s+/g, " ").toLowerCase();
// first complete clause at the front of the buffer (ends at sentence/clause punctuation, keeps it). `s` flag so .
// matches newlines from a token stream.
const CLAUSE = /^([^]*?[.!?,;:]['")\]]?)(\s+|$)/;

// makeClauseSpeaker({ speak, memo, onClause, minChars }) → { feed(textChunk), flush(), reset(), spokenClauses() }
//   speak(clause) : async — render + play ONE clause (kokoro). Serialised by the internal queue.
//   memo          : makeComputeMemo (optional) — clause-grained dedup; a repeated clause replays (hit).
//   onClause(ev)  : { clause, hit, i } — the karaoke binding (paint the clause as it's spoken).
//   minChars      : don't split a clause shorter than this on a COMMA (keep tiny fragments together); sentence
//                   punctuation (. ! ?) always splits. Default 12.
export function makeClauseSpeaker({ speak, memo = null, onClause = () => {}, minChars = 12 } = {}) {
  if (!speak) throw new Error("makeClauseSpeaker needs speak(clause)");
  let buf = "", spoken = [], i = 0;
  let chain = Promise.resolve();   // serialise TTS — clauses play in order, never overlapping

  function enqueue(clause) {
    const c = clause.trim(); if (!c) return;
    const idx = i++;
    chain = chain.then(async () => {
      let hit = false;
      if (memo) { const r = await memo.compute("clause-tts@v1", norm(c), async () => { await speak(c); return new Uint8Array([1]); }); hit = r.hit; }
      else { await speak(c); }
      spoken.push(c); onClause({ clause: c, hit, i: idx });
    });
    return chain;
  }

  // feed(textChunk) — push brain output (a token, a few tokens, whatever). Emits every COMPLETE clause now.
  function feed(text) {
    buf += String(text || "");
    let m;
    while ((m = buf.match(CLAUSE))) {
      const clause = m[1], isSentence = /[.!?]/.test(clause.slice(-2));
      if (!isSentence && clause.trim().length < minChars) break;   // tiny comma-fragment → wait for more
      enqueue(clause);
      buf = buf.slice(m[0].length);
    }
  }

  // flush() — end of response: speak the trailing partial clause (if any) and await the queue draining.
  async function flush() { if (buf.trim()) { enqueue(buf); buf = ""; } await chain; }

  function reset() { buf = ""; spoken = []; i = 0; chain = Promise.resolve(); }
  return { feed, flush, reset, spokenClauses: () => spoken.slice(), pending: () => chain };
}

export default { makeClauseSpeaker };
