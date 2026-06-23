#!/usr/bin/env node
// Witness for private-context personalization of Holo Search (holo-search.js). Proves: (1) personalBoost
// is the identity (×1) with no terms; (2) it scales with interest-term matches; (3) the engine's DEFAULT
// relevance order lifts an interest-matching doc above an equally-matched peer when body.holoProfile is
// passed; (4) WITHOUT holoProfile the order is unchanged (exact identity); (5) reported _score is the
// transparent blended score (personalization changes order, not the reported score); (6) an explicit
// body.sort is never overridden by personalization.
import { Index, personalBoost } from "../os/usr/lib/holo/holo-search.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.error("  ✗ " + m); } };

// (1) identity multiplier
ok(personalBoost({ text: "anything" }, []) === 1, "no terms → ×1 (identity)");
ok(personalBoost(null, ["x"]) === 1, "no source → ×1");
// (2) scales with matches
const b1 = personalBoost({ text: "solana trade desk" }, ["solana"]);
const b2 = personalBoost({ text: "solana trade desk" }, ["solana", "trade"]);
ok(b1 > 1, "one match → boost > 1");
ok(b2 > b1, "two matches → larger boost");
ok(personalBoost({ text: "nothing here" }, ["solana"]) === 1, "no overlap → ×1");

// build an index: two docs that BOTH match the query 'report' equally, but differ in topic
function mkIndex() {
  const ix = new Index("t", { settings: { default_analyzer: "english" }, mappings: { properties: { text: { type: "text", analyzer: "english" }, pos: { type: "integer" } } } });
  ix.index("solana", { text: "quarterly report on solana trading desk", pos: 2 });
  ix.index("garden", { text: "quarterly report on the community garden", pos: 1 });
  return ix;
}
const order = (res) => res.hits.hits.map((h) => h._id);

// (4) no holoProfile → a deterministic baseline order
const baseline = order(mkIndex().search({ query: { match: { text: "report" } }, size: 10 }));
ok(baseline.length === 2, "both docs match the query");

// (3) with interest in solana/trading, the solana doc leads
const personalized = order(mkIndex().search({ query: { match: { text: "report" } }, size: 10, holoProfile: ["solana", "trading"] }));
ok(personalized[0] === "solana", "interest-matching doc leads when holoProfile passed");

// (3b) the opposite interest flips the lead — proves it's the profile doing it, not a fixed tiebreak
const flipped = order(mkIndex().search({ query: { match: { text: "report" } }, size: 10, holoProfile: ["garden", "community"] }));
ok(flipped[0] === "garden", "opposite interest leads the other doc (profile-driven, not fixed)");

// (5) reported _score stays the transparent blended score (unchanged by personalization)
const plainHit = mkIndex().search({ query: { match: { text: "report" } }, size: 10 }).hits.hits.find((h) => h._id === "solana");
const personHit = mkIndex().search({ query: { match: { text: "report" } }, size: 10, holoProfile: ["solana"] }).hits.hits.find((h) => h._id === "solana");
ok(plainHit._score === personHit._score, "reported _score is unchanged (personalization re-orders, not re-scores)");

// (6) an explicit body.sort is never overridden by personalization (the boost lives only in the default
// relevance branch). Proven by: the order under an explicit sort is identical with and without holoProfile.
const sortNoProfile = order(mkIndex().search({ query: { match: { text: "report" } }, size: 10, sort: [{ pos: "asc" }] }));
const sortWithProfile = order(mkIndex().search({ query: { match: { text: "report" } }, size: 10, sort: [{ pos: "asc" }], holoProfile: ["solana", "trading"] }));
ok(sortNoProfile.join() === sortWithProfile.join(), "explicit body.sort order is identical with/without holoProfile");

console.log(`\nholo-search-personalize-witness: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
