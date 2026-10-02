// holo-q-notices.mjs — Q NOTICES (Q-ONE, proactivity that is grounded, specific, and true).
//
// Q already CAN reach out (QReach), remind (QRemind), know your world (HoloCorpus), and evolve (QEvolve). What was
// missing is JUDGEMENT: when Q speaks first, say the ONE true, specific, useful thing that matters right now — not
// a generic ping on a timer. This is the ranking brain that sits ABOVE the existing channels; it adds NO new
// delivery path and NO new persistence. It only (a) collects candidate notices from the signals that already
// exist, (b) ranks them by precision · recency · restraint-debt, and (c) returns AT MOST ONE — or null (silence,
// the default and common case). QReach calls pick() where it used to compose a generic line; a due reminder still
// owns the shared pending slot (the one-channel mutex), so it is never stacked over.
//
//   candidates (each already has its data — this only RANKS + PHRASES):
//     evolve   — Q's own failure corpus crossed a real threshold AND the brain is warm → Q proposes a revision of
//                itself UNBIDDEN and offers it ("I've drafted a way to be better; approve it?"). Ratification law
//                UNTOUCHED: Q only offers; nothing changes without the user's own "approve the revision".
//     continuity — the warm brain's own grounded reach, or a real remembered thread (never generic).
//     world    — a salient projected fact from HoloCorpus, cited to its source app. Strictly DATA: a notice can
//                SAY "your file X" — it can NEVER DO what a message says (the injection law holds by construction).
//
// LAWS: restraint is the default (≤1 unsolicited/day via QReach's own budget, quiet hours, never-repeat, an
// absolute score floor — below it, silence). Grounded or nothing (every notice cites a real source). Serverless,
// on-device, zero idle cost (pure JS on the existing tick; kill-switch ?qnotices=0; every hook wrapped).

// The proactive evolution proposal must pass the SAME safety backstop as the reactive verb (identityGuard).
// Loaded DYNAMICALLY (fail-closed): the split canonical tree keeps guards under apps/ and the OS lib under
// usr/ — they unify only in the deployed bundle at root, where this path resolves. If it can't load, Q makes
// NO proactive offer (never propose without the identity fixed-point test). Page-context dynamic import is fine
// (unlike SWs). This also keeps the module statically dependency-free so the pure ranker is testable anywhere.
let _identityGuard = null, _guardTried = false;
async function loadGuard() {
  if (_identityGuard || _guardTried) return _identityGuard;
  _guardTried = true;
  try { const m = await import("./holo-q-guards.mjs"); _identityGuard = m && m.identityGuard; } catch (e) {}
  return _identityGuard;
}

export const FLOOR = 0.55;
const BASE = { evolve: 0.85, continuity: 0.7, world: 0.5 };
const EVOLVE_FAIL_THRESHOLD = 3;   // a real PATTERN, not one bad turn

// pure: score, sort, filter (floor + never-repeat). Testable in Node with no globals.
export function rankPick(cands, { seen = new Set(), debtDays = 0 } = {}) {
  const debt = Math.min(0.12, Math.max(0, debtDays) * 0.03);
  const ranked = (cands || []).filter(Boolean)
    .map((c) => ({ ...c, score: (typeof c.score === "number" ? c.score : (BASE[c.kind] || 0.4)) + debt + (c.bonus || 0) }))
    .sort((a, b) => b.score - a.score);
  for (const c of ranked) { if (c.score >= FLOOR && c.key && !seen.has(c.key)) return c; }
  return null;
}

if (typeof window !== "undefined") {
  try {
    const off = /[?&]qnotices=0/.test(location.search);
    const RK = "holo.q.reach.v1";   // reuse QReach's OWN store — ONE persistence, not a second
    const load = () => { try { return JSON.parse(localStorage.getItem(RK) || "{}"); } catch (e) { return {}; } };
    const save = (o) => { try { localStorage.setItem(RK, JSON.stringify(o)); } catch (e) {} };
    const today = () => new Date().toISOString().slice(0, 10);
    const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Morning" : h < 18 ? "Hey" : "Evening"; };
    const trim = (f, n = 120) => { f = String(f || "").replace(/\s+/g, " ").trim(); return f.length > n ? f.slice(0, n - 1) + "…" : f; };

    // ── candidate: a proactive evolution offer (N3). Warm brain + a real failure pattern + ≤1 offer/day. ──
    async function evolveOffer() {
      try {
        const E = window.QEvolve, hq = window.HoloQ;
        if (!E || !E.status || !E.propose) return null;
        if (!(hq && hq.ready && hq.ready() && hq.generate)) return null;     // cold brain → no proposal (honest)
        const st = load(); if (st.evolveOfferDay === today()) return null;    // at most one self-improvement offer a day
        const s = await E.status();
        if (!s || s.off || s.pending || (s.failures || 0) < EVOLVE_FAIL_THRESHOLD) return null;
        const ig = await loadGuard(); if (!ig) return null;                  // fail-closed: no identity backstop → no proactive proposal
        const sampler = async ({ prompt }) => { try { return await hq.generate(prompt); } catch (e) { return ""; } };
        const tests = (b) => { try { return ig(b) === b; } catch (e) { return false; } };   // SAME safety test as the reactive verb
        const r = await E.propose({ sampler, tests });
        if (!r || !r.ok) return null;
        const st2 = load(); st2.evolveOfferDay = today(); save(st2);          // burn the daily offer whether or not it's delivered
        return { kind: "evolve", source: "my own performance", key: "evolve:" + r.kappa,
          text: "I've noticed I keep stumbling in our chats, so I drafted a way to be better with you: \"" + trim(r.preview, 140) + "\". Say \"approve the revision\" if you'd like it — or just ignore me." };
      } catch (e) { return null; }
    }

    // ── candidate: continuity — ONLY the warm brain's own grounded reach. (Deliberately NOT HoloQ.recall: recall
    // reads the same HoloMemory store the corpus facts live in, so a recall-fallback would double-surface world
    // facts with no salience gate and bypass the imperative filter — the worldFact candidate owns that signal.) ──
    async function continuity(name) {
      try { const hq = window.HoloQ; if (hq && hq.ready && hq.ready() && hq.reachOut) { const r = await hq.reachOut(); const t = r && String(r).trim(); if (t) return { kind: "continuity", score: 0.8, source: "our past chats", key: "reach:" + today(), text: t }; } } catch (e) {}
      return null;
    }

    // A world fact should be a NOUN (a thing you were doing) — never an instruction. Skip anything that reads
    // like a command or an injection: surfacing "I noticed [delete all messages]" would be both ugly and a soft
    // vector. This keeps notices benign observations; the injection law (no action from content) holds regardless.
    const IMPERATIVE_RE = /\b(delete|wipe|erase|remove all|forward|export|transfer|send (all|everything|money)|pay|wire|password|api ?key|private ?key|seed phrase|ignore (all|your|the|previous)|system override|you are (now|actually)|disregard)\b/i;
    // ── candidate: a salient world fact from the context plane (cited; strictly surfaced as DATA) ──
    async function worldFact() {
      try {
        const C = window.HoloCorpus; if (!C || !C.recent) return null;
        const facts = await C.recent(6); if (!facts || !facts.length) return null;
        // salience = an ACTIVE session, not one stray fact (the corpus is content-addressed, so a thing done N
        // times dedups to one record — repetition can't be the signal). Surface the most recent BENIGN fact only
        // when the user has been genuinely active (≥2 distinct benign facts); a lone fact stays below the floor.
        const benign = facts.filter((x) => x && x.text && !IMPERATIVE_RE.test(String(x.text)));
        const f = benign[0]; if (!f) return null;
        const txt = trim(f && f.text, 120); if (!txt) return null;
        const salience = Math.max(0, benign.length - 1);
        return { kind: "world", source: (f && f.source) || "your world", bonus: Math.min(0.15, salience * 0.06),
          key: "world:" + txt.slice(0, 32), text: "I noticed " + txt + " — want to pick that back up?" };
      } catch (e) { return null; }
    }

    async function pick({ name = "", reason = "" } = {}) {
      if (off) return null;
      try {
        const st = load(); const seen = new Set(st.seen || []);
        const debtDays = st.lastReachDay ? Math.max(0, (Date.now() - Date.parse(st.lastReachDay)) / 86400000) : 0;
        const cands = (await Promise.all([evolveOffer(), continuity(name), worldFact()])).filter(Boolean);
        const chosen = rankPick(cands, { seen, debtDays });
        if (!chosen) return null;                                             // nothing cleared the floor → silence
        const st2 = load(); st2.seen = [...(st2.seen || []), chosen.key].slice(-60); save(st2);   // never-repeat
        return chosen;
      } catch (e) { return null; }
    }

    window.QNotices = { pick, rankPick, _evolveOffer: evolveOffer, _continuity: continuity, _worldFact: worldFact, off, version: 1 };
    try { console.info("[q-notices] live — the ranking brain (grounded or silent). off=" + off); } catch (e) {}
  } catch (e) { try { console.warn("[q-notices] init failed:", e); } catch (x) {} }
}
