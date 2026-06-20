// holo-courier.mjs — Q'S VOICE (S3 of the autonomy spine: sense → reason → SPEAK). S2 decided what is worth
// raising (ranked proposals). This is the ONLY thing allowed to turn a proposal into a message in the user's
// inbox — and it is mostly a DISCIPLINE, not a feature. The send seam itself is tiny (hand the note to
// HoloNotify as sender "Q"); the value is the filter in front of it. An ungated Q→inbox is a spam cannon.
//
// THE SEND FILTER — a proposal becomes a message only if ALL hold:
//   • PROVENANCE — it derives from a real S2 proposal (carries the proposal-set κ it came from). Q never
//     invents a message; the body is the proposal's own suggestedAction — a HANDED note, never generated
//     (the witnessed HoloNotify property: Q delivers, it does not author).
//   • IT CHANGES WHAT YOU'D DO — only a RAISED proposal (S2 already gated it past the salience hi-threshold)
//     with a concrete action is eligible; pure status is never sent.
//   • NOT ALREADY SAID — a subject spoken once stays quiet until it is RELEASED (fixed / faded) and later
//     RE-RAISED. Combined with a stable per-subject note id, a recurring concern UPDATES its one note in
//     place — never a growing pile, never a re-nag.
//   • WITHIN THE NOISE BUDGET — at most `budget` messages per delivery; the highest-salience win the budget,
//     the rest are HELD (not dropped) and sent on a later delivery once the budget frees.
// Inherited from S2: NO-NOISE (nothing raised ⇒ nothing sent) and the send is COHERENCE-TRIGGERED, not
// timer-driven — Q speaks because the system's state changed, never because a clock ticked.
//
//   deliver(observation) → { sent[], held[], suppressed[], spoke }   // observation = an S2 observe() result
//
// Pure of any model — the courier never calls an LLM; it routes verifiable, content-derived proposals. The
// notify sink and a clock are dependency-injected (the witness passes a recording sink; the browser passes
// window.HoloNotify). Stateful across deliveries (the spoken set) but deterministic — no randomness.

const round3 = (x) => Math.round(x * 1000) / 1000;

// a short, calm title per concern kind — the body carries the specifics (the personalised, signal part).
const TITLE = { "app.error": "An app hit a snag", "gate.red": "A required check went red", "heal.unresolved": "Recovery needs your pins", "heal.flaky": "A source looks unstable" };
const titleFor = (p) => TITLE[p.kind] || "Q noticed something";
// which concerns ask the user to DECIDE (→ "Needs you", a persistent pill) vs simply inform (→ "From Q",
// a gentle one). Recovery and a red required row need an action; an unstable source is Q keeping watch.
const ACTION_KINDS = new Set(["heal.unresolved", "gate.red"]);
const categoryFor = (p) => (ACTION_KINDS.has(p.kind) ? "action" : "letter");

// makeCourier({ notify, budget, sendFloor }) → { deliver, spoken }.
//   notify    : the inbox sink — anything with a q(opts) method (window.HoloNotify) — handed, never generated.
//   budget    : max messages per delivery (default 3). The noise ceiling; the rest are held, not dropped.
//   sendFloor : an extra salience floor under the S2 hi-gate (default 0 — trust S2's gate). Belt-and-braces.
export function makeCourier({ notify, budget = 3, sendFloor = 0 } = {}) {
  if (!notify || typeof notify.q !== "function") throw new Error("makeCourier needs an inbox sink with a q(opts) method (window.HoloNotify)");
  const spoken = new Map();   // subject → { kappa, salience } — what Q has already said and not yet released

  function deliver(observation = {}) {
    const proposals = (observation.proposals || []).filter((p) => (p.salience || 0) >= sendFloor);
    const derivedFrom = observation.kappa || (observation.object && observation.object.id) || null;
    const current = new Set(proposals.map((p) => p.subject));

    // RELEASE — forget any spoken subject that is no longer raised (fixed / faded), so a genuine RECURRENCE
    // later may speak again. This is what lets "say once" coexist with "tell me if it comes back".
    for (const s of [...spoken.keys()]) if (!current.has(s)) spoken.delete(s);

    const alreadySaid = new Set(spoken.keys());
    const fresh = proposals.filter((p) => !alreadySaid.has(p.subject));   // proposals are pre-ranked desc by S2
    const sent = [], held = [];
    for (const p of fresh) {
      if (sent.length < budget) {
        notify.q({
          id: "holo-q-" + p.subject,                 // stable per-subject id ⇒ updates its one note in place
          sender: "Q",
          title: titleFor(p),
          body: p.suggestedAction,                   // HANDED — the proposal's own words, not generated
          severity: (p.salience || 0) >= 0.66 ? "warn" : "info",
          category: categoryFor(p),                  // "action" (needs you) vs "letter" (Q keeping watch)
          deepLink: { kind: "coherence", value: p.subject },
        });
        spoken.set(p.subject, { kappa: derivedFrom, salience: round3(p.salience || 0) });
        sent.push({ subject: p.subject, derivedFrom, salience: round3(p.salience || 0) });
      } else {
        held.push({ subject: p.subject, salience: round3(p.salience || 0) });   // over budget — held for next delivery
      }
    }
    const suppressed = proposals.filter((p) => alreadySaid.has(p.subject)).map((p) => p.subject);   // deduped this call
    return { sent, held, suppressed, spoke: sent.length > 0, derivedFrom };
  }

  return { deliver, spoken: () => [...spoken.keys()].sort() };
}

// ── browser binding: window.HoloCourier over window.HoloNotify, once the inbox is ready. It does NOT start a
// loop — S3 only sends when handed an observation; the cadence (read the snapshot, observe, deliver) is the
// caller's. Law L2, one canonical wire. Fail-soft if the inbox is absent.
if (typeof window !== "undefined") {
  const wire = () => {
    try {
      if (window.HoloCourier || !window.HoloNotify) return;
      window.HoloCourier = makeCourier({ notify: window.HoloNotify });
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-courier-ready"));
    } catch (e) { /* leave unset; callers fail-soft */ }
  };
  if (window.HoloNotify) wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-observer-ready", wire, { once: true });
}
