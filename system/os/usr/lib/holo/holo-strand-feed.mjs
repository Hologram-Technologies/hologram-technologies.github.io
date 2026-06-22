// holo-strand-feed.mjs — the human-readable view of the ONE spine. P0–P4 put resume, ingest provenance,
// consent/delegation/value audit, and validation rules all onto a single hash-linked, signed source
// chain. This turns that chain into the thing a person actually reads: one chronological feed of "what
// happened, in order, provably" — so Q (and any surface) can answer "what did I do / approve / ingest?"
// from the single spine instead of polling a dozen stores. Pure, additive, projection-only.

// one-line, plain-language summaries per entry kind (jargon-free — Law: the surface speaks human).
const SUMMARY = {
  "session.open": (p) => `Opened your session${p.host ? ` on ${p.host}` : ""}`,
  "session.snapshot": (p) => `Saved your workspace`,
  "ingest": (p) => `Brought in ${p.name || "a source"}${p.kind ? ` (${p.kind})` : ""}`,
  "audit": (p) => `${p.level === "value" ? "Approved" : "Authorized"}: ${p.reason || p.act || "an action"}`,
  "ruleset": (p) => `Adopted the rules “${(p.ruleset && p.ruleset.name) || "ruleset"}”`,
  "event": (p) => `Recorded an event`,
};
const summarize = (kind, payload) => { const f = SUMMARY[kind]; try { return f ? f(payload || {}) : kind; } catch { return kind; } };

// activityFeed(strand, { limit, kinds }) → most-recent-first rows, each a plain summary + provenance
// (the entry κ, whether it is operator-signed, its position and time). One read across the whole spine.
export function activityFeed(strand, { limit = 50, kinds = null } = {}) {
  const rows = strand.replay({})
    .filter((e) => (kinds ? kinds.includes(e["holstr:kind"]) : true))
    .map((e) => ({
      seq: e["holstr:seq"],
      kind: e["holstr:kind"],
      at: e["prov:generatedAtTime"] || null,
      summary: summarize(e["holstr:kind"], e["holstr:payload"]),
      signed: !!e["holstr:sig"],
      kappa: e.id,
    }));
  return rows.slice(-limit).reverse();
}

// digest(strand) → a one-sentence headline for Q.briefing ("12 things on your spine — last: Approved …").
export function digest(strand, { n = null } = {}) {
  const feed = activityFeed(strand, { limit: n || 1 });
  const total = strand.length ? strand.length() : strand.replay({}).length;
  if (!total) return "Your history is empty — nothing on the spine yet.";
  const last = feed[0];
  return `${total} thing${total === 1 ? "" : "s"} on your spine — last: ${last.summary}.`;
}

// browser binding: one seam over the live operator strand. Fail-soft; callers degrade if absent.
if (typeof window !== "undefined") {
  window.HoloStrandFeed = { activityFeed, digest };
}
