#!/usr/bin/env node
// holo-media-item-witness.mjs — proves the ONE render-item shape carries the streaming superset:
// a movie, a series (with seasons), and episodes (parented), with genre→topic mapping, "where to watch"
// providers, and the HONEST metadata-≠-bytes availability seam. Pure over the normalizers; no network.
//
// Checks:
//   1 movieShape          — a TMDb movie normalizes to kind:movie with name/year/rating/poster.
//   2 genreToTopic        — Sci-Fi maps to the legacy "scifi" topic AND keeps the raw genre (dynamic rails).
//   3 seriesHierarchy     — a series normalizes to kind:series with a mapped seasons[] and seasonCount.
//   4 episodeParenting    — an episode points at its series + season (seriesId/parentId/numbers).
//   5 providersWhereToWatch — watch-providers extract Netflix (flatrate), region-stamped + deduped.
//   6 honestAvailability  — default is browse-only (playable:false); a bound source flips it true.
//
// node holo-media-item-witness.mjs   (from holo-apps/apps/player/)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeMovie, normalizeSeries, normalizeEpisode, normalizeWatchProviders } from "./holo-media-item.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── fixtures (TMDb-shaped, no network) ───────────────────────────────────────────────────────────────────
const matrix = { id: 603, title: "The Matrix", release_date: "1999-03-30", overview: "A hacker learns the truth.", genre_ids: [28, 878], vote_average: 8.2, runtime: 136, poster_path: "/p.jpg", backdrop_path: "/b.jpg" };
const breakingBad = {
  id: 1396, name: "Breaking Bad", first_air_date: "2008-01-20", overview: "A chemistry teacher turns to crime.",
  genre_ids: [18, 80], vote_average: 8.9, number_of_seasons: 5, number_of_episodes: 62, poster_path: "/bb.jpg", backdrop_path: "/bbb.jpg",
  seasons: [
    { season_number: 0, name: "Specials", episode_count: 8, poster_path: "/s0.jpg" },
    { season_number: 1, name: "Season 1", episode_count: 7, poster_path: "/s1.jpg" },
    { season_number: 2, name: "Season 2", episode_count: 13, poster_path: "/s2.jpg" },
  ],
};
const pilot = { id: 62085, name: "Pilot", season_number: 1, episode_number: 1, overview: "It begins.", vote_average: 8.2, runtime: 58, air_date: "2008-01-20", still_path: "/still.jpg" };
const providers = { results: { US: { flatrate: [{ provider_name: "Netflix", logo_path: "/n.jpg" }], rent: [{ provider_name: "Apple TV", logo_path: "/a.jpg" }, { provider_name: "Netflix", logo_path: "/n.jpg" }] }, GB: { flatrate: [{ provider_name: "Now TV" }] } } };

// 1 + 2
{
  const m = normalizeMovie(matrix);
  ok("movieShape", m.kind === "movie" && m.name === "The Matrix" && m.year === 1999 && m.rating === 8.2 && /w500\/p\.jpg$/.test(m.posterUrl || ""), JSON.stringify({ kind: m.kind, year: m.year, poster: m.posterUrl }));
  ok("genreToTopic", m.topics.includes("scifi") && m.topics.includes("science fiction") && m.topics.includes("action"), JSON.stringify(m.topics));
}
// 3
const series = normalizeSeries(breakingBad);
{
  ok("seriesHierarchy", series.kind === "series" && series.seasonCount === 5 && series.seasons.length === 3 && series.seasons[1].seasonNumber === 1 && series.seasons[1].seriesId === "tmdb:series:1396", JSON.stringify({ kind: series.kind, seasonCount: series.seasonCount, seasons: series.seasons.map((s) => s.seasonNumber) }));
}
// 4
{
  const ep = normalizeEpisode(pilot, series);
  ok("episodeParenting", ep.kind === "episode" && ep.seriesId === "tmdb:series:1396" && ep.parentId === "tmdb:season:1396:1" && ep.seasonNumber === 1 && ep.episodeNumber === 1 && ep.seriesName === "Breaking Bad", JSON.stringify({ seriesId: ep.seriesId, parentId: ep.parentId, s: ep.seasonNumber, e: ep.episodeNumber }));
}
// 5
{
  const p = normalizeWatchProviders(providers, "US");
  const nf = p.find((x) => x.name === "Netflix");
  ok("providersWhereToWatch", nf && nf.type === "flatrate" && nf.region === "US" && p.filter((x) => x.name === "Netflix").length === 1, JSON.stringify(p.map((x) => `${x.name}:${x.type}`)));
}
// 6
{
  const browse = normalizeMovie(matrix);
  const playable = normalizeMovie(matrix, { availability: { playable: true, source: "kappa", kappa: "sha256:abc", playSrc: "video/cmaf/master.m3u8", type: "application/x-mpegURL" } });
  ok("honestAvailability", browse.availability.playable === false && browse.availability.source === null && playable.availability.playable === true && playable.availability.source === "kappa", JSON.stringify({ browse: browse.availability, playable: playable.availability }));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-media-item — the ONE Holo Player render item carries the streaming superset (movie · series → seasons → episodes), genre→topic mapping for affinity + dynamic rails, region-stamped 'where to watch' providers, and the honest metadata-≠-bytes availability seam (browse-only until a source binds).",
  authority: "rests on #holo-media-item (+ #holo-jellyfin shape) — Phase 0 of the streaming/metadata plan",
  witnessed,
  covers: witnessed ? ["movie-shape", "genre-to-topic", "series-hierarchy", "episode-parenting", "providers-where-to-watch", "honest-availability"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-media-item-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-media-item witness — the streaming render-item shape (series + metadata + providers + honest availability)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  one shape: movie/series/episode, where-to-watch, metadata≠bytes" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
