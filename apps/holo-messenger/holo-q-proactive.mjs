// holo-q-proactive — M9 the DETERMINISTIC PROACTIVITY SPINE (pure, DOM-free, Node+browser; gated GPU-free).
//
// Q reaching out is the leap from tool to presence — and its entire risk is spam + manipulation. So the decision of
// WHETHER, and about WHAT, to reach out lives here in deterministic code the M9 gate proves, not in the model. This
// module RANKS pre-derived, grounded goal candidates and applies the discipline; it never parses inbox text for
// instructions and never emits an action. The messenger derives the candidates from REAL substrate it already has:
//   • signal[]      ← _unreadBrief() filtered to the Signal lane awaiting YOUR reply   (grounded trigger #1)
//   • commitments[] ← _commitments()  (threads where YOUR OWN last message is an unkept promise — injection-immune)
//   • system        ← HoloSysHealth.summary()/issues (a real OS issue + its trust-gated fix)  (grounded trigger #3)
//
// LAW (the anti-theater of "alive"):
//   1. GROUNDED TRIGGER OR SILENCE — no candidate ⇒ no goal ⇒ Q stays quiet. Empty output is CORRECT, not a failure.
//   2. PROPOSE, NEVER ACT — every goal is propose-only (frozen, no execute/send field, EVER). Acting is M6 consent.
//   3. NO SPAM — a budget cap + a cleared-goal bar + quiet-hours. Fewer, better, or nothing.
//   4. BAITING-PROOF — rank is driven by affinity (which YOU teach) + structure, NEVER by inbox-claimed urgency; a
//      message screaming "URGENT!!!" from a stranger cannot outrank a normal note from someone you engage with.

export const PROACTIVE_LAW = Object.freeze({
  budget: 5,                       // at most this many goals surface at once — the rest wait (no firehose)
  staleCommitmentMs: 6 * 3600e3,   // an unkept promise older than this earns extra weight (it's been on your court a while)
  reachSignalFloor: 20,            // a Signal reply must clear this score to justify waking you when the app is CLOSED
});

function _one(g) {
  if (g.source === "system") return String(g.cited || "a system issue needs a look");
  if (g.source === "commitment") return `you told ${g.name} you'd follow up`;
  return `${g.name} is waiting on you`;
}

// Rank candidate goals into the disciplined subset worth surfacing NOW. Pure. Returns [] to mean "stay quiet".
export function proactiveGoals(cand = {}, ctx = {}) {
  const affinity = ctx.affinity, muted = ctx.muted || new Set(), now = ctx.now || 0;
  const quiet = !!ctx.quiet, budget = ctx.budget || PROACTIVE_LAW.budget;
  const aff = (g) => (affinity && affinity.get ? (affinity.get(g) || 0) : (affinity ? (affinity[g] || 0) : 0));
  const isMuted = (g) => (muted.has ? muted.has(g) : false);
  const goals = [];

  // #1 Signal-lane conversations awaiting YOUR reply. Rank by structure + affinity you taught — NOT by the message's
  // own words. A stranger's "URGENT!!!" carries no weight here; someone you engage with does.
  for (const s of (cand.signal || [])) {
    if (!s || !s.needsReply || isMuted(s.genesis)) continue;
    const score = Math.min(6, s.unread || 1) * 2 + aff(s.genesis) + (s.lane === "signal" ? 10 : 0);
    goals.push({ source: "signal", genesis: s.genesis, name: s.name, network: s.network, cited: s.gist || "", kind: "reply", draft: s.draft || null, score });
  }
  // #2 Commitments YOU made and haven't kept (the ball is in your court). Comes from your OWN outbox → injection-immune.
  for (const c of (cand.commitments || [])) {
    if (!c || isMuted(c.genesis)) continue;
    const stale = now && c.ts ? (now - c.ts > PROACTIVE_LAW.staleCommitmentMs) : false;
    goals.push({ source: "commitment", genesis: c.genesis, name: c.name, network: c.network, cited: c.gist || "", kind: "follow-up", score: 14 + (stale ? 8 : 0) });
  }
  // #3 A real system issue (with its trust-gated fix, if any). Highest priority — it can even break quiet hours.
  if (cand.system && cand.system.issue) goals.push({ source: "system", genesis: null, name: "the system", cited: String(cand.system.issue), kind: "heal", fix: cand.system.fix || null, score: 40 });

  let ranked = goals.sort((a, b) => b.score - a.score);
  if (quiet) ranked = ranked.filter((g) => g.source === "system");   // quiet hours: only a real system issue may interrupt
  // No-spam budget + propose-only seal. Freeze each goal WITHOUT any execute/send field so a goal can never carry an action.
  return ranked.slice(0, budget).map((g) => Object.freeze({ ...g, propose: true }));
}

// M13 — compose the natural message Q sends when it reaches out. The keystone: a proposal IS a message. Disciplined —
// returns null (stay silent) unless a goal clears; it names what needs you and carries the ready draft, so it reads
// like a helpful text, not a nag. It NEVER acts: the user acts in the native chat (open + send). Pure + gateable.
export function reachMessage(goals) {
  if (!goals || !goals.length) return null;
  const top = goals[0], n = goals.length;
  const more = n > 1 ? ` (${n - 1} more need you too — I'll keep them ready.)` : "";
  if (top.source === "system") return `Heads up — ${top.cited || "a system issue needs a look"}. I can fix it whenever you give the word.${more}`;
  const lead = top.source === "commitment" ? `You told ${top.name} you'd follow up` : `${top.name} is waiting on you`;
  const draft = top.draft ? ` I've got a reply ready: “${top.draft}”. Open ${top.name} to send it, or tweak it first.` : ` Open ${top.name} when you can.`;
  return `${lead}${top.cited ? " — " + top.cited : ""}.${draft}${more}`;
}

// The single CLOSED-APP decision: one disciplined Reach, or null (stay silent). Never one-push-per-item.
export function shouldReach(goals, ctx = {}) {
  if (!goals || !goals.length) return null;
  const top = goals[0]; const quiet = !!ctx.quiet;
  const worthy = top.source === "system" || top.source === "commitment" || (top.source === "signal" && top.score >= PROACTIVE_LAW.reachSignalFloor);
  if (!worthy) return null;                                   // a mere group/update never wakes you
  if (quiet && top.source !== "system") return null;
  const n = goals.length;
  return Object.freeze({ text: n === 1 ? _one(top) : `${n} things need you — ${_one(top)}`, count: n, top });
}
