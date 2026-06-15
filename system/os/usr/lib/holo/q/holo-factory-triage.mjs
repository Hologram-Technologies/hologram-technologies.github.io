// holo-factory-triage.mjs — SEMANTIC TRIAGE for Holo Factory (ADR-0097): the factory FINDS the target
// itself. A natural-language signal — "the add function is broken", "keep my notepad working" — is embedded
// and matched by MEANING against the live candidate surfaces, using the OS's verified embedder
// (EmbeddingGemma-300m via HoloVoice.embed), NOT keywords. So the user states intent and the factory locates
// what to fix or watch — closing the gap where the human had to name the target / pass prefix·suffix.
//
// Pure given the injected embed() (the holo-mind / holo-prov idiom — witnessable in Node with a stub
// embedder; live in the browser with EmbeddingGemma). The ranking is a deterministic function of the vectors
// (cosine, ties by id), so triage RE-DERIVES given the embedder. HONEST (Law L5): nothing above the
// threshold ⇒ NO target — the factory reports it can't locate, it does NOT guess (mirrors "never fakes green").

export function createTriage({ embed } = {}) {
  if (typeof embed !== "function") throw new Error("triage needs an embed(text|text[], {kind})→vector|vector[]");

  // rank — candidates by semantic similarity to the signal. candidate = { id, text?, read?, write?, lang?, verify? }.
  // text is what we embed (a name + description + maybe a content snippet); falls back to the id.
  async function rank(signal, candidates = []) {
    const list = (candidates || []).filter((c) => c && (c.text != null || c.id != null));
    if (!list.length) return [];
    const qv = await embed(String(signal), { kind: "query" });
    const raw = await embed(list.map((c) => String(c.text != null ? c.text : c.id)), { kind: "document" });
    const vecs = Array.isArray(raw) && Array.isArray(raw[0]) ? raw : list.map(() => raw);   // tolerate a single-vector return
    return list
      .map((c, i) => ({ candidate: c, score: cosine(qv, vecs[i]) }))
      .sort((a, b) => (b.score - a.score) || String(a.candidate.id).localeCompare(String(b.candidate.id)));
  }

  // locate — the single best target (k>1 → the top cohort), or NULL if nothing clears the threshold. Never
  // guesses: an empty result is an honest "couldn't locate", not a low-confidence pick masquerading as one.
  async function locate(signal, candidates = [], { threshold = 0.35, k = 1 } = {}) {
    const ranked = await rank(signal, candidates);
    const matches = ranked.filter((r) => r.score >= threshold).slice(0, Math.max(1, k));
    return {
      target: matches[0] ? matches[0].candidate : null,
      score: matches[0] ? matches[0].score : 0,
      matches, ranked,
      reason: matches.length ? null : "no candidate cleared the similarity threshold (won't guess a target — Law L5)",
    };
  }

  return { rank, locate };
}

// cosine — pure, NaN-safe; orthogonal/empty ⇒ 0 (so an unrelated candidate scores 0, not a false match).
function cosine(a, b) {
  if (!a || !b || !a.length || !b.length) return 0;
  const n = Math.min(a.length, b.length);
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const m = Math.sqrt(na) * Math.sqrt(nb);
  return m ? d / m : 0;
}

export default { createTriage };
