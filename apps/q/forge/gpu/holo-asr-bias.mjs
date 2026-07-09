// holo-asr-bias.mjs — B0/B1: CONTEXTUAL BIASING for the TDT decode. Q hears the names that matter to YOU —
// your contacts, app/catalog names, places, jargon — by boosting them at decode (shallow fusion). The bias
// vocabulary is the user's own κ-world (holo-open catalog + omni-index + their strand), so it's personal AND
// serverless. The boost is BOUNDED and additive: it nudges the decoder toward a bias phrase once the acoustics
// start matching, but never forces a word the model didn't hear (the false-insertion risk — see lambda + B4).
//
// A bias phrase is matched as the SPM TOKEN-ID sequence the model actually emits (greedy longest-match over the
// vocab pieces, ▁ = leading space) — biasing in subword space, not characters. makeBiasContext keeps a trie over
// those id sequences and, per decode step, returns the token boosts for any token that EXTENDS an active match.

// makeSpmTokenizer(vocab) → tokenize(text) → [tokenId]. Greedy longest-match over the SentencePiece pieces (the
// same vocab.txt the decoder detokenizes with). Approximates SPM unigram closely enough for biasing.
export function makeSpmTokenizer(vocab) {
  const p2id = new Map(); vocab.forEach((p, i) => { if (p) p2id.set(p, i); });
  const unk = p2id.has("<unk>") ? p2id.get("<unk>") : 0;
  function word(w) {                                  // w already has a leading ▁
    const ids = []; let s = w;
    while (s.length) {
      let hit = null;
      for (let len = s.length; len > 0; len--) { const sub = s.slice(0, len); if (p2id.has(sub)) { hit = sub; break; } }
      if (!hit) { ids.push(unk); s = s.slice(1); } else { ids.push(p2id.get(hit)); s = s.slice(hit.length); }
    }
    return ids;
  }
  return (text) => { const out = []; for (const w of String(text || "").trim().split(/\s+/).filter(Boolean)) out.push(...word("▁" + w.toLowerCase())); return out; };
}

// makeBiasContext({ phrases, tokenize, lambda }) → { boosts(), advance(tokenId), reset(), size }.
//   phrases   : string[]  — the bias vocabulary (names/apps/places); deduped, bounded by the caller.
//   tokenize  : (text)→[id]  — SPM tokenizer (makeSpmTokenizer or injected).
//   lambda    : the (bounded) logit boost added to a token that continues an active bias match (default 3.0).
export function makeBiasContext({ phrases = [], tokenize, lambda = 3.0 } = {}) {
  if (!tokenize) throw new Error("makeBiasContext needs tokenize(text)->[id]");
  const root = { ch: new Map(), term: false };
  let n = 0;
  for (const ph of phrases) {
    const ids = tokenize(ph); if (!ids.length) continue;
    let node = root;
    for (const id of ids) { if (!node.ch.has(id)) node.ch.set(id, { ch: new Map(), term: false }); node = node.ch.get(id); }
    node.term = true; n++;
  }
  let active = [root];   // trie nodes with a match in progress; root is always active (a phrase can start anytime)

  return {
    size: n,
    // boosts() → Map<tokenId, boost>: every token that extends an active match (max boost if reachable >1 way).
    boosts() { const m = new Map(); for (const node of active) for (const [id] of node.ch) { const b = m.get(id) || 0; if (lambda > b) m.set(id, lambda); } return m; },
    // advance(tokenId) — after a real token is emitted, carry forward the matches it continues (+ root, so a new
    // phrase can begin on the next token).
    advance(tokenId) { const next = [root]; for (const node of active) { const c = node.ch.get(tokenId); if (c) next.push(c); } active = next; },
    reset() { active = [root]; },
  };
}

export default { makeSpmTokenizer, makeBiasContext };
