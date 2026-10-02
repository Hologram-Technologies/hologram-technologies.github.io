// holo-intent-classify.mjs — the intent classifier for the ONE command bar (github.io/Q, Ctrl+K).
//
// A single query → one of a few LANES, decided synchronously and allocation-cheap on the keystroke path:
//   command  — a `>` prefix                                   → run a keymap command
//   ask      — a `q ` prefix, or a multi-word question (…?)   → ask Q
//   resolve  — the input is ADDRESSABLE (κ / did / CID / SRI / ENS / a URL / …) → the κ-resolver, verified
//   term     — plain text                                     → search chats · apps · commands, web fallthrough
//   empty    — nothing typed                                  → recents
//
// The addressable detection is NOT reimplemented here: it delegates to holo-names' `classify` (the one
// naming-universe classifier the /apps/resolve surface already uses). To stay pure + node-testable, the
// classifier is INJECTED (the browser passes holo-names' classify; the witness passes the same via a
// relative import). No DOM, no imports — the host surface joins the pieces.

// A URL / bare domain that holo-names' classify leaves as `null` ("the open web"): still addressable by the
// resolver (which handles open-web + search). Whitespace ⇒ not a URL (it's a phrase).
export function looksLikeUrl(s) {
  if (/\s/.test(s)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return true;                       // has a scheme
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(s) && /\.[a-z]{2,}$/i.test(s.split(/[/?#]/)[0]);
}

// classifyIntent(raw, classifyName) → { lane, q, name? }
//   classifyName : holo-names' classify(s) → { kind, … } | null   (injected; optional)
export function classifyIntent(raw, classifyName) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return { lane: "empty", q: "" };
  if (s[0] === ">") return { lane: "command", q: s.slice(1).trim() };
  if (/^q\s+\S/i.test(s)) return { lane: "ask", q: s.replace(/^q\s+/i, "") };

  let n = null;
  if (typeof classifyName === "function") { try { n = classifyName(s); } catch { n = null; } }
  // holo-names recognized it as SOME addressable thing (κ / did / CID / SRI / ENS / nostr / payment / …)
  if (n && n.kind && n.kind !== "empty") return { lane: "resolve", q: s, name: n };
  // classify said "open web" (null) but it looks like a URL/domain → still the resolver's job
  if (looksLikeUrl(s)) return { lane: "resolve", q: s, name: { kind: "web", target: s } };
  // a natural-language question (must be multi-word so a lone "who?" chat name isn't hijacked)
  if (/\?\s*$/.test(s) && /\s/.test(s)) return { lane: "ask", q: s };
  return { lane: "term", q: s };
}

// fuzzyScore(query, text) → 0 (no match) … 1 (best). Subsequence match with bonuses for a prefix hit, a
// word-boundary start, and contiguous runs — small, dependency-free, good enough to rank a short list.
export function fuzzyScore(query, text) {
  const q = String(query || "").toLowerCase().trim();
  const t = String(text || "").toLowerCase();
  if (!q) return 1;
  if (!t) return 0;
  if (t === q) return 1;
  if (t.startsWith(q)) return 0.95;
  let ti = 0, run = 0, hits = 0, score = 0, prevHit = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    let found = -1;
    for (let k = ti; k < t.length; k++) { if (t[k] === c) { found = k; break; } }
    if (found < 0) return 0;                                                 // not a subsequence → no match
    hits++;
    run = found === prevHit + 1 ? run + 1 : 0;
    let s = 1 + run * 0.6;                                                   // contiguity bonus
    if (found === 0 || /[\s._\-/]/.test(t[found - 1] || "")) s += 1.2;       // word-boundary bonus
    score += s;
    prevHit = found; ti = found + 1;
  }
  const density = hits / t.length;                                          // shorter, denser matches rank higher
  return Math.min(0.9, (score / (q.length * 2.8)) * 0.75 + density * 0.25);
}

export default { classifyIntent, fuzzyScore, looksLikeUrl };
