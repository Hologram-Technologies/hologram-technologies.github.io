// holo-rank.js — HoloRank: a transparent, on-device video ranker.
//
// The inversion of a surveillance feed. YouTube's recommender lives on a server,
// optimizes watch-time, and can't tell you why. HoloRank lives in YOUR browser,
// optimizes for genuine interest, and explains every pick — because the score
// re-derives from a profile you own and can inspect, reset, or carry away.
//
// How it works (all interpretable, no model, no network):
//   • a local preference PROFILE accumulates topic / channel / term affinity from
//     your own behaviour (open · watch-through · like · subscribe · search · pin),
//     with exponential recency so old taste fades and recent taste leads;
//   • each candidate gets several interpretable SUB-SCORES (affinity, channel,
//     quality prior, exploration novelty, continue-watching);
//   • those are fused with Reciprocal Rank Fusion (the same robust method as Holo
//     Resolve's federated search, ADR-038) — no single signal dominates;
//   • every result carries a WHY ("Because you watch sci-fi", "Continue watching",
//     "New to discover") so the feed is legible, not magic-by-mystery.
//
// Profile = localStorage today; it is plain JSON, portable, and on the path to a
// κ-object you own (self-sovereign taste). Reset wipes it instantly.

(function () {
  "use strict";
  if (window.HoloRank) return;

  const LS = "holoplayer.holorank.profile.v1";
  const DAY = 864e5;
  const HALF_LIFE = 30 * DAY;            // interest half-life: month-fresh taste leads

  // ── profile ────────────────────────────────────────────────────────────────
  function load() {
    let p; try { p = JSON.parse(localStorage.getItem(LS) || "null"); } catch {}
    if (!p || typeof p !== "object") p = {};
    p.topics ||= {}; p.channels ||= {}; p.terms ||= {};
    p.events ||= 0; p.updated ||= 0;
    return p;
  }
  function save(p, ts) { p.updated = ts || p.updated; try { localStorage.setItem(LS, JSON.stringify(p)); } catch {} }

  // Decay every weight toward zero by how long since the profile last moved, so a
  // burst of one topic months ago doesn't outvote what you watch this week.
  function decay(p, now) {
    const dt = now - (p.updated || now);
    if (dt <= 0) return p;
    const f = Math.pow(0.5, dt / HALF_LIFE);
    for (const m of [p.topics, p.channels, p.terms]) for (const k in m) { m[k] *= f; if (m[k] < 0.01) delete m[k]; }
    return p;
  }
  const bump = (m, k, a) => { if (k) m[k] = (m[k] || 0) + a; };

  // interaction strength — a like says far more than an open
  const W = { open: 0.4, watch: 1.0, complete: 1.6, like: 2.0, subscribe: 2.6, search: 0.6, makeNative: 2.2, skip: -0.5 };

  // ── learn from one interaction ───────────────────────────────────────────────
  function signal(ev, now) {
    now = now || Date.now();
    const p = decay(load(), now);
    const w = W[ev.type] ?? 0.3;
    const it = ev.item;
    if (it) {
      const strength = ev.type === "watch" && ev.pct != null ? w * Math.max(0.15, Math.min(1, ev.pct)) : w;
      (it.topics || []).forEach((t) => bump(p.topics, t, strength));
      bump(p.channels, it.channel, strength * 0.8);
    }
    if (ev.term) String(ev.term).toLowerCase().split(/[\s,]+/).filter((t) => t.length > 2).forEach((t) => bump(p.terms, t, w));
    p.events += 1;
    save(p, now);
    return p;
  }

  // ── helpers ──────────────────────────────────────────────────────────────────
  const unit = (m) => { const mx = Math.max(1e-6, ...Object.values(m)); const o = {}; for (const k in m) o[k] = m[k] / mx; return o; };
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); }
  const affinity = (it, tv) => { const ts = it.topics || []; if (!ts.length) return 0; let s = 0; for (const t of ts) s += tv[t] || 0; return s / Math.sqrt(ts.length); };
  const termMatch = (it, terms) => { const hay = ((it.name || "") + " " + (it.tags || []).join(" ")).toLowerCase(); let s = 0; for (const t in terms) if (hay.includes(t)) s += terms[t]; return s; };
  const orderBy = (cands, f) => [...cands].sort((a, b) => f(b) - f(a));

  // Reciprocal Rank Fusion: combine several orderings robustly (ADR-038).
  function rrf(cands, rankings, k = 60) {
    const score = new Map(cands.map((c) => [c.id, 0]));
    for (const { weight, order } of rankings) order.forEach((c, i) => score.set(c.id, score.get(c.id) + weight / (k + i + 1)));
    return score;
  }

  // ── rank a candidate set ──────────────────────────────────────────────────────
  // opts: { resume(item)->{pos,dur} , focus: topicKey|null , salt: string }
  function rank(cands, opts = {}) {
    if (!cands || !cands.length) return [];
    const now = Date.now();
    const p = decay(load(), now);
    const tv = unit(p.topics), cv = unit(p.channels);
    const cold = (p.events || 0) < 2;                 // no taste yet → quality + discovery lead
    const resume = opts.resume || (() => null);
    const salt = opts.salt || "";

    const M = new Map();
    for (const c of cands) {
      const r = resume(c); const pct = r && r.dur ? r.pos / r.dur : 0;
      M.set(c.id, {
        aff: affinity(c, tv),
        chan: cv[c.channel] || 0,
        term: termMatch(c, p.terms),
        qual: c.quality ?? 0.6,
        explore: (hash(c.id + salt) % 1000) / 1000,                 // stable novelty per session
        cont: r && pct > 0.03 && pct < 0.95 ? 1 : 0,
        watched: r && pct >= 0.95 ? 1 : 0,
        focus: opts.focus ? ((c.topics || []).includes(opts.focus) ? 1 : 0) : 0,
        pct,
      });
    }

    const rankings = [
      { weight: cold ? 0.5 : 2.4, order: orderBy(cands, (c) => M.get(c.id).aff) },
      { weight: cold ? 0.4 : 1.3, order: orderBy(cands, (c) => M.get(c.id).chan) },
      { weight: cold ? 0.3 : 1.1, order: orderBy(cands, (c) => M.get(c.id).term) },
      { weight: 1.5,              order: orderBy(cands, (c) => M.get(c.id).qual) },
      { weight: cold ? 1.4 : 0.8, order: orderBy(cands, (c) => M.get(c.id).explore) },
    ];
    if (opts.focus) rankings.push({ weight: 3.2, order: orderBy(cands, (c) => M.get(c.id).focus) });
    const fused = rrf(cands, rankings);

    const out = cands.map((c) => {
      const m = M.get(c.id);
      let s = fused.get(c.id) + m.cont * 0.06 - m.watched * 0.05;   // float resumes, sink finished
      return { ...c, _rank: s, _why: why(m, p, cold, opts.focus) };
    });
    out.sort((a, b) => b._rank - a._rank);
    return out;
  }

  // The human reason behind a pick — the transparency that makes it trustworthy.
  function why(m, p, cold, focus) {
    if (m.cont) return { tag: "continue", text: "Continue watching", pct: m.pct };
    if (focus && m.focus) return { tag: "topic", text: "Matches " + label(focus) };
    const top = Object.entries(p.topics).sort((a, b) => b[1] - a[1])[0];
    if (!cold && m.aff > 0.45 && top) return { tag: "affinity", text: "Because you watch " + label(top[0]) };
    if (!cold && m.chan > 0.45) return { tag: "channel", text: "From a channel you like" };
    if (m.qual >= 0.92) return { tag: "quality", text: "Acclaimed · Creative Commons" };
    if (cold || m.explore > 0.66) return { tag: "discover", text: "New to discover" };
    return { tag: "foryou", text: "Picked for you" };
  }
  const label = (t) => ({ scifi: "sci-fi", "creative-commons": "Creative Commons", "4k": "4K" }[t] || (t.charAt(0).toUpperCase() + t.slice(1)));

  // ── a glanceable summary of what HoloRank thinks you like (for a "why" panel) ──
  function taste(n = 4) {
    const p = decay(load(), Date.now());
    const top = Object.entries(p.topics).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => label(k));
    return { topics: top, events: p.events || 0, cold: (p.events || 0) < 2 };
  }

  window.HoloRank = {
    rank, signal, taste, label,
    profile: () => decay(load(), Date.now()),
    reset: () => { try { localStorage.removeItem(LS); } catch {} },
    _hash: hash,
  };
})();
