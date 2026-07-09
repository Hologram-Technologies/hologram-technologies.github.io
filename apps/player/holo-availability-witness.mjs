#!/usr/bin/env node
// holo-availability-witness.mjs — proves the honest resolver: a discovered (metadata) title binds to a
// source the user actually has, becoming truly playable; the best source by priority wins; no false binds.
//
// Checks:
//   1 bindsByTitle     — a TMDb title with no source binds to a matching κ-store item (normalized title).
//   2 bindsByTmdbId    — a TMDb id match wins even when titles differ slightly.
//   3 priorityWins     — owned κ beats an open stream when both match.
//   4 yearGuard        — a remake (year far off) does NOT bind to the old file.
//   5 browseWhenNoMatch — an unmatched title stays browse-only (playable:false).
//   6 availabilityShape — availabilityFrom maps owned/native → "kappa" and carries the play handle.
//
// node holo-availability-witness.mjs   (from holo-apps/apps/player/)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildIndex, resolve, availabilityFrom, matchKey } from "./holo-availability.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// sources the user holds
const sources = [
  { id: "sintel-dash", name: "Sintel", source: "open", playSrc: "https://x/sintel.mpd", type: "application/dash+xml", year: 2010 },
  { id: "holo-video", name: "Big Buck Bunny", source: "native", kappa: "sha256:bbb", playSrc: "video/cmaf/master.m3u8", type: "application/x-mpegURL" },
  { id: "owned-tos", name: "Tears of Steel", source: "owned", kappa: "sha256:tos", playSrc: "tos/master.m3u8", type: "application/x-mpegURL", year: 2012 },
  { id: "open-tos", name: "Tears of Steel", source: "open", playSrc: "https://x/tos.m3u8", type: "application/x-mpegURL", year: 2012 },
  { id: "jelly-bb", name: "Breaking Bad", source: "jellyfin", tmdbId: 1396, playSrc: "https://jf/Videos/abc/master.m3u8", type: "application/x-mpegURL" },
];
const index = buildIndex(sources);

// 1 — "Sintel" (TMDb) binds to the open catalog Sintel
{
  const m = resolve({ id: "tmdb:movie:45745", tmdbId: 45745, name: "Sintel", year: 2010 }, index);
  ok("bindsByTitle", m && m.id === "sintel-dash", JSON.stringify(m && m.id));
}
// 2 — TMDb id 1396 binds the linked-server Breaking Bad even with a different display name
{
  const m = resolve({ id: "tmdb:series:1396", tmdbId: 1396, name: "Breaking Bad (2008)", kind: "series" }, index);
  ok("bindsByTmdbId", m && m.id === "jelly-bb", JSON.stringify(m && m.id));
}
// 3 — owned κ beats the open stream for the same title
{
  const m = resolve({ id: "tmdb:movie:133701", tmdbId: 133701, name: "Tears of Steel", year: 2012 }, index);
  ok("priorityWins", m && m.id === "owned-tos" && m.source === "owned", JSON.stringify(m && [m.id, m.source]));
}
// 4 — a 2024 "Sintel" remake must NOT bind to the 2010 file (year guard)
{
  const m = resolve({ id: "tmdb:movie:99999", tmdbId: 99999, name: "Sintel", year: 2024 }, index);
  ok("yearGuard", m === null, JSON.stringify(m && m.id));
}
// 5 — an unheld title stays browse-only
{
  const m = resolve({ id: "tmdb:movie:27205", tmdbId: 27205, name: "Inception", year: 2010 }, index);
  ok("browseWhenNoMatch", m === null && availabilityFrom(m).playable === false, JSON.stringify(m));
}
// 6 — availability shape
{
  const a = availabilityFrom(sources[1]);   // native Big Buck Bunny
  ok("availabilityShape", a.playable === true && a.source === "kappa" && a.kappa === "sha256:bbb" && a.playSrc === "video/cmaf/master.m3u8" && matchKey("The Matrix") === "matrix", JSON.stringify(a));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-availability — the honest bytes-vs-metadata resolver: a discovered TMDb title binds to a source the user actually holds (by TMDb id, else normalized title with a year guard), best source by priority (owned κ > κ-store > server > open) wins, and an unheld title stays browse-only. Turns 'request' into 'play' without faking bytes.",
  authority: "rests on #holo-availability — Phase 2 of the streaming/metadata plan",
  witnessed,
  covers: witnessed ? ["binds-by-title", "binds-by-tmdb-id", "priority-wins", "year-guard", "browse-when-no-match", "availability-shape"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-availability-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-availability witness — bind a discovered title to a source you hold (or stay honestly browse-only)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  request → play, without faking bytes" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
