#!/usr/bin/env node
// holo-rewind-ui-witness.mjs — proves the rewind surface's PURE logic (the DOM is browser-verified
// separately): plain-time labels and newest-first timeline shaping that turn a per-app chain's versions
// into "rewind, not version control" — no κ, no version numbers shown.
//
// Checks:
//   1 relTimeBuckets   — relTime maps deltas to plain phrases (just now / minutes / hours / yesterday / …).
//   2 newestFirst      — describeVersions lists versions newest-first (the scrub order).
//   3 marksReverts     — a version produced by a revert is tagged (honest "restored" lineage).
//   4 mapsToChain      — the rows' n indices match the underlying workspace versions (preview/revert target).
//
// Authority: rests on #holo-workspace (versions/revert) + #holo-rewind-ui. node tools/holo-rewind-ui-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { relTime, describeVersions } from "../os/usr/lib/holo/holo-rewind-ui.mjs";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { makeWorkspace } from "../os/usr/lib/holo/holo-workspace.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── 1 · relTime buckets ──────────────────────────────────────────────────────────────────────────────
const NOW = Date.parse("2026-06-23T12:00:00.000Z");
const at = (sec) => new Date(NOW - sec * 1000).toISOString();
ok("relTimeBuckets",
  relTime(at(1), NOW) === "just now" &&
  relTime(at(40), NOW) === "40 seconds ago" &&
  relTime(at(120), NOW) === "2 minutes ago" &&
  relTime(at(3600), NOW) === "an hour ago" &&
  relTime(at(86400), NOW) === "yesterday" &&
  relTime(at(86400 * 3), NOW) === "3 days ago",
  JSON.stringify([relTime(at(1), NOW), relTime(at(40), NOW), relTime(at(120), NOW), relTime(at(3600), NOW), relTime(at(86400), NOW)]));

// ── build a real per-app chain (3 edits + 1 revert) and shape it ─────────────────────────────────────
let tick = 0; const now = () => `2026-06-23T11:59:${String(50 + tick++).padStart(2, "0")}.000Z`;
let store = [];
const strand = makeStrand({ backend: { load: async () => store, save: async (e) => { store = e; } }, now });
const ws = makeWorkspace({ appKappa: "did:holo:sha256:" + "a".repeat(64), strand, now });
await ws.save({ doc: "one" });
await ws.save({ doc: "two" });
await ws.save({ doc: "three" });
await ws.revert(0);                          // restore the first point → a 4th version, tagged as a revert
const versions = await ws.versions();
const rows = describeVersions(versions, Date.parse(now()));

// ── 2 · newest-first ─────────────────────────────────────────────────────────────────────────────────
ok("newestFirst", rows.length === 4 && rows[0].n === 3 && rows[rows.length - 1].n === 0, JSON.stringify(rows.map((r) => r.n)));
// ── 3 · the revert row is marked ─────────────────────────────────────────────────────────────────────
ok("marksReverts", rows[0].isRevert === true && rows.slice(1).every((r) => r.isRevert === false), JSON.stringify(rows.map((r) => r.isRevert)));
// ── 4 · row indices address the real chain (preview targets) ─────────────────────────────────────────
{
  const prev0 = await ws.preview(rows[rows.length - 1].n);   // n=0 → first state
  ok("mapsToChain", prev0 && prev0.doc === "one", JSON.stringify(prev0));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-rewind-ui — the per-app time-travel surface speaks plain time (relTime) and a newest-first timeline (describeVersions) over the real holo-workspace chain: reverts are marked honestly and each row's index addresses the chain for preview/revert. 'Rewind, not version control' — no κ, no version numbers shown. DOM browser-verified separately.",
  authority: "rests on #holo-workspace (versions/preview/revert) + #holo-rewind-ui",
  witnessed,
  covers: witnessed ? ["rel-time-buckets", "newest-first", "marks-reverts", "maps-to-chain"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-rewind-ui-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-rewind-ui witness — rewind in plain time over the real per-app chain\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  a window's history reads as plain time you can scrub" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
