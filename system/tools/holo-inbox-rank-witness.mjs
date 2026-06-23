#!/usr/bin/env node
// Witness for context-aware Inbox ordering (holo-notify rankInbox). Presentation-only reorder of a COPY;
// proves: (1) no profile → exact identity (zero change for profile-less operators); (2) unresolved
// "needs-you" items float to top; (3) notes matching the operator's interest terms lift above irrelevant
// peers; (4) equal-score items keep their original recency order (stable); (5) input is never mutated.
import { rankInbox } from "../os/usr/lib/holo/holo-notify.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.error("  ✗ " + m); } };
const ids = (a) => a.map((r) => r.id).join(",");
const catOf = (r) => (r && r.category) || "update";

// a small inbox, newest-first (as the store holds it)
const base = () => [
  { id: "a", title: "Backup finished", body: "all good", sender: "System", category: "update", read: true },
  { id: "b", title: "Trade filled on Solana", body: "your order", sender: "Q", category: "letter", read: false },
  { id: "c", title: "Approve transfer", body: "needs you", sender: "System", category: "action", read: false },
  { id: "d", title: "Weekly digest", body: "music and photos", sender: "Q", category: "letter", read: true },
];

// (1) identity without context
{
  const v = base();
  const out = rankInbox(v, [], catOf);
  ok(ids(out) === ids(v), "no terms → identity order preserved");
  ok(out !== v, "returns a copy, not the same array ref");
}

// (5) never mutates input
{
  const v = base(); const snapshot = ids(v);
  rankInbox(v, ["trade", "solana"], catOf);
  ok(ids(v) === snapshot, "input array order is not mutated");
}

// (2) action-unread floats to top when context present
{
  const out = rankInbox(base(), ["music"], catOf);
  ok(out[0].id === "c", "unresolved 'action' item floats to top");
}

// (3) relevance lift: with interest in 'solana/trade', the matching letter outranks the irrelevant ones
{
  const out = rankInbox(base(), ["solana", "trade"], catOf);
  const pos = (id) => out.findIndex((r) => r.id === id);
  ok(pos("b") < pos("a"), "interest-matching note 'b' lifts above irrelevant 'a'");
  ok(pos("b") < pos("d"), "interest-matching note 'b' lifts above irrelevant 'd'");
  ok(pos("c") === 0, "action item still leads even with relevance scoring");
}

// (4) stability: equal score keeps original order
{
  const v = [
    { id: "x", title: "alpha", body: "", sender: "Q", category: "letter", read: true },
    { id: "y", title: "beta", body: "", sender: "Q", category: "letter", read: true },
    { id: "z", title: "gamma", body: "", sender: "Q", category: "letter", read: true },
  ];
  const out = rankInbox(v, ["nomatch"], catOf);
  ok(ids(out) === "x,y,z", "equal-score items keep original recency order (stable)");
}

// edge: empty + single
ok(ids(rankInbox([], ["a"], catOf)) === "", "empty list → empty");
ok(ids(rankInbox([{ id: "solo", title: "t" }], ["t"], catOf)) === "solo", "single item → unchanged");

console.log(`\nholo-inbox-rank-witness: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
