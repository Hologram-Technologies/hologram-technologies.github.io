#!/usr/bin/env node
// holo-continue-witness.mjs — proves "Continue watching": the query-less recents ranking + the rail model.
// Pure (the DOM rail is browser-verified). Drives the real holo-omni-index.recents + holo-continue-ui.buildContinueModel.
//
// Checks:
//   1 recentsRanked    — recents() ranks by recency × frequency (no query); most-recent/most-used first.
//   2 kindsFilter      — recents({kinds}) returns only the asked kinds (apps + spaces = streamable titles).
//   3 limitHonored     — limit caps the list.
//   4 modelShapesCards — buildContinueModel keeps order, cleans titles ("Name  ·  κ" → "Name"), maps fields.
//   5 modelFiltersTitles — non-streamable kinds (web/file/cid) are dropped from the rail by default.
//   6 emptyWhenNone    — no recents → empty model (new user sees the clean welcome, like a fresh Netflix).
//
// Authority: rests on #holo-omni-index + #holo-continue-ui. node tools/holo-continue-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { recents } from "../os/sbin/holo-omni-index.mjs";
import { buildContinueModel } from "../os/usr/lib/holo/holo-continue-ui.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const T = 1_700_000_000_000;   // fixed "now"
const H = 3.6e6;
// a recents store (most-recent-first as record() keeps it). t = timestamp, n = visit count.
const entries = [
  { addr: "holo://org.holo.notes", kind: "app", title: "Notes  ·  did:holo:sha256:aaa", kappa: "did:holo:sha256:aaa", n: 5, t: T - 1 * H },
  { addr: "holo://space/research", kind: "holospace", title: "Research", n: 2, t: T - 3 * H },
  { addr: "https://example.com", kind: "web", title: "Example", n: 9, t: T - 2 * H },
  { addr: "holo://org.holo.wallet", kind: "app", title: "Wallet", kappa: "did:holo:sha256:bbb", n: 1, t: T - 50 * H },
  { addr: "did:holo:sha256:fff", kind: "file", title: "report.pdf", n: 3, t: T - 0.5 * H },
];
const store = { get: () => entries.map((e) => ({ ...e })), set: () => {}, now: () => T };

// ── 1 · ranked, no query ─────────────────────────────────────────────────────────────────────────────
{
  const r = recents({ store, now: () => T, limit: 10 });
  const order = r.map((x) => x.title);
  const rawInsertion = entries.map((e) => e.title.split("  ·  ")[0]);
  // ranked (not raw insertion order) + the oldest, least-used item (Wallet: 50h, n=1) sinks to last
  ok("recentsRanked", r.length === 5 && r[r.length - 1].addr === "holo://org.holo.wallet" && JSON.stringify(order) !== JSON.stringify(rawInsertion), JSON.stringify(order));
}
// ── 2 · kinds filter ─────────────────────────────────────────────────────────────────────────────────
{
  const r = recents({ store, now: () => T, kinds: ["app", "holospace"], limit: 10 });
  ok("kindsFilter", r.length === 3 && r.every((x) => x.kind === "app" || x.kind === "holospace"), JSON.stringify(r.map((x) => x.kind)));
}
// ── 3 · limit ────────────────────────────────────────────────────────────────────────────────────────
ok("limitHonored", recents({ store, now: () => T, limit: 2 }).length === 2);

// ── 4+5 · model shapes + filters ─────────────────────────────────────────────────────────────────────
{
  const r = recents({ store, now: () => T, limit: 10 });
  const m = buildContinueModel(r);   // default kinds = app + holospace
  ok("modelShapesCards", m.length >= 2 && m[0].title === "Notes" && m[0].kind === "app" && m[0].kappa === "did:holo:sha256:aaa", JSON.stringify(m));
  ok("modelFiltersTitles", m.every((c) => c.kind === "app" || c.kind === "holospace"), JSON.stringify(m.map((c) => c.kind)));
}
// ── 6 · empty when none ──────────────────────────────────────────────────────────────────────────────
ok("emptyWhenNone", buildContinueModel(recents({ store: { get: () => [], set: () => {}, now: () => T }, now: () => T })).length === 0);

// ── 7 · S5 · ranked to you: a profile-interest nudge lifts a matching title, recency still leads ────────
{
  const r = recents({ store, now: () => T, kinds: ["app", "holospace"], limit: 10 });   // order: Notes(app), Research(holospace), Wallet(app)
  const base = buildContinueModel(r).map((c) => c.title);
  const tuned = buildContinueModel(r, { profileTerms: ["research"] }).map((c) => c.title);
  // without interests: recency order; with "research": Research lifts above where it was, nothing dropped
  const lifted = tuned.indexOf("Research") < base.indexOf("Research");
  ok("rankedToYou", base.length === tuned.length && lifted && tuned.includes("Notes"), JSON.stringify({ base, tuned }));
  // bounded: an interest nobody matches changes nothing (recency preserved)
  const none = buildContinueModel(r, { profileTerms: ["zzznomatch"] }).map((c) => c.title);
  ok("nudgeBounded", JSON.stringify(none) === JSON.stringify(base), JSON.stringify(none));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-continue — 'Continue watching': query-less recents ranked by recency × frequency × authority, filtered to streamable titles (apps + spaces), shaped into a poster-rail model with clean titles; empty when there's nothing recent (a new user sees the clean welcome). Pure over holo-omni-index + holo-continue-ui; the responsive rail DOM is browser-verified.",
  authority: "rests on #holo-omni-index + #holo-continue-ui",
  witnessed,
  covers: witnessed ? ["recents-ranked", "kinds-filter", "limit-honored", "model-shapes-cards", "model-filters-titles", "empty-when-none"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-continue-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-continue witness — your recent apps + spaces as a Continue-watching rail\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  Continue watching: ranked, streamable, clean, empty-safe" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
