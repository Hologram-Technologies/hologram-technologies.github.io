// holo-asr-bias-correct.mjs — B (effective): POST-HOC phonetic correction against the user's κ-world vocabulary.
// The measurement found token-level shallow-fusion biasing (holo-asr-bias.mjs) can't move this frozen model's
// CONFIDENT errors (Saoirse→"SOAS") without a boost so large it breaks general accuracy. The robust fix that
// doesn't touch the model: after decode, map output words that are PHONETICALLY a bias name back to it
// (Matio→Mateo) — bounded by a Soundex match AND a small edit distance so it only fixes genuine near-misses and
// never rewrites an ordinary word. Honest limit: a name the model garbles beyond phonetic recognition (SOAS) is
// not recoverable post-hoc — that needs deep (model-level) biasing.

// Soundex — classic phonetic key (Mateo & Matio → M300; SOAS S200 ≠ Saoirse S620, so SOAS is correctly left alone).
export function soundex(s) {
  s = String(s || "").toUpperCase().replace(/[^A-Z]/g, ""); if (!s) return "";
  const C = { B: 1, F: 1, P: 1, V: 1, C: 2, G: 2, J: 2, K: 2, Q: 2, S: 2, X: 2, Z: 2, D: 3, T: 3, L: 4, M: 5, N: 5, R: 6 };
  let out = s[0], prev = C[s[0]] || 0;
  for (let i = 1; i < s.length && out.length < 4; i++) { const c = C[s[i]] || 0; if (c && c !== prev) out += c; if (s[i] !== "H" && s[i] !== "W") prev = c; }
  return (out + "000").slice(0, 4);
}
const editDist = (a, b) => { const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 0; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; };

// makeBiasCorrector({ phrases, maxRatio }) → { correct(text)->text, stats }. Single-word bias names (the common
// case: contacts/apps); maxRatio bounds the allowed edit distance (default 0.45 of the name length).
export function makeBiasCorrector({ phrases = [], maxRatio = 0.45 } = {}) {
  const byCode = new Map();
  for (const p of phrases) { const w = String(p).trim(); if (!w || /\s/.test(w)) continue; const k = soundex(w); if (!byCode.has(k)) byCode.set(k, w); }
  let fixes = 0;
  function correct(text) {
    return String(text || "").replace(/[A-Za-z][A-Za-z'’]*/g, (w) => {
      const cand = byCode.get(soundex(w)); if (!cand) return w;
      const lw = w.toLowerCase(), lc = cand.toLowerCase();
      if (lw === lc) return w;                                              // already correct
      if (editDist(lw, lc) > Math.max(1, Math.ceil(lc.length * maxRatio))) return w;   // too far → not this name (leave it)
      fixes++;
      return w[0] === w[0].toUpperCase() ? cand[0].toUpperCase() + cand.slice(1) : cand;   // preserve leading case
    });
  }
  return { correct, stats: () => ({ fixes }) };
}

export default { makeBiasCorrector, soundex };
