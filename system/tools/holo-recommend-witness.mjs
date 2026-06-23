#!/usr/bin/env node
// holo-recommend-witness.mjs — proves the "Because you've been exploring…" recommendations row: κ apps you
// HAVEN'T opened, ranked by your private interests (× holo-rank), excluding recents; only true matches when
// there's a signal, a light popular fallback otherwise. Pure over the catalog. (Not the open-web sbin/holo-discover.)
//
// Checks:
//   1 excludesRecents        — apps already in recents are never recommended.
//   2 matchesInterests       — with interests, an interest-matching app leads.
//   3 onlyMatchesWhenSignal  — with interests, NON-matching apps are dropped (a real recommendation).
//   4 popularFallback        — no interests → a light fallback by holo-rank (never cold/empty).
//   5 honestHeading          — titleFor personalizes when there's a signal, neutral otherwise.
//
// Authority: rests on #holo-recommend (+ #holo-profile + #holo-rank). node tools/holo-recommend-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { recommend, titleFor } from "../os/usr/lib/holo/holo-recommend.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const catalog = [
  { id: "org.holo.tube", name: "Holo Tube", did: "did:holo:sha256:" + "1".repeat(64), keywords: ["video", "watch"], categories: ["Media"] },
  { id: "org.holo.music", name: "Holo Music", did: "did:holo:sha256:" + "2".repeat(64), keywords: ["audio", "music"], categories: ["Media"] },
  { id: "org.holo.wallet", name: "Holo Wallet", did: "did:holo:sha256:" + "3".repeat(64), keywords: ["crypto", "pay"], categories: ["Finance"] },
  { id: "org.holo.notes", name: "Holo Notes", did: "did:holo:sha256:" + "4".repeat(64), keywords: ["write", "docs"], categories: ["Work"] },
];
const rank = { ["3".repeat(64)]: 0.9, ["1".repeat(64)]: 0.3 };

{
  const recs = recommend(catalog, ["holo://org.holo.notes"], { profileTerms: ["video"], rank });
  const titles = recs.map((r) => r.title);
  ok("excludesRecents", !titles.includes("Holo Notes"), JSON.stringify(titles));
  ok("matchesInterests", titles[0] === "Holo Tube", JSON.stringify(titles));
  ok("onlyMatchesWhenSignal", titles.length === 1 && titles[0] === "Holo Tube", JSON.stringify(titles));
}
{
  const recs = recommend(catalog, [], { profileTerms: [], rank });
  ok("popularFallback", recs.length >= 3 && recs[0].title === "Holo Wallet", JSON.stringify(recs.map((r) => r.title)));
}
ok("honestHeading", /exploring video/i.test(titleFor(["video"])) && titleFor([]) === "Discover", JSON.stringify([titleFor(["video"]), titleFor([])]));

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-recommend — the recommendations row: κ apps you haven't opened, ranked by private interests (× holo-rank), excluding recents; only true interest-matches when there's a signal, a light popular fallback otherwise; honest heading. On-device; nothing egresses; renders through the Continue-watching rail.",
  authority: "rests on #holo-recommend + #holo-profile + #holo-rank",
  witnessed,
  covers: witnessed ? ["excludes-recents", "matches-interests", "only-matches-when-signal", "popular-fallback", "honest-heading"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-recommend-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-recommend witness — 'Because you've been exploring…' recommendations, private + ranked\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  a recommendations row: your taste, on-device, never cold" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
