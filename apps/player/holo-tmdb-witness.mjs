#!/usr/bin/env node
// holo-tmdb-witness.mjs — proves the metadata provider auto-populates the player AND is κ-cached:
// TMDb → the one item shape, with a fake TMDb (no network, no key) and a Map κ-cache. The cache is the
// "very, very fast + offline" guarantee: a repeat request is served from κ (no fetch), tampering is refused
// (Law L5), and a warm cache survives the network being gone.
//
// Checks:
//   1 populatesRails    — trending returns normalized items (titles + posters), mixed movie/series.
//   2 seriesEnriched    — title(tv) merges trailer key + cast + "where to watch" providers.
//   3 seasonEpisodes    — season() returns episodes parented to their series + season.
//   4 kappaCacheHit     — a repeated request hits the κ-cache (0 extra fetches, fromCache).
//   5 verifyBeforeTrust — a tampered cache entry fails to re-derive and is refused (not served).
//   6 worksOffline      — with a warm cache, a request whose network is DOWN still serves from κ.
//
// node holo-tmdb-witness.mjs   (from holo-apps/apps/player/)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTmdb } from "./holo-tmdb.mjs";
import { createMediaCache, memKV, address } from "./holo-media-cache.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── fake TMDb (counts calls; routes by path) ─────────────────────────────────────────────────────────────
const TREND = { results: [
  { id: 603, media_type: "movie", title: "The Matrix", release_date: "1999-03-30", genre_ids: [28, 878], vote_average: 8.2, poster_path: "/p.jpg", backdrop_path: "/b.jpg" },
  { id: 1396, media_type: "tv", name: "Breaking Bad", first_air_date: "2008-01-20", genre_ids: [18, 80], vote_average: 8.9, poster_path: "/bb.jpg", backdrop_path: "/bbb.jpg" },
] };
const BB_DETAIL = {
  id: 1396, name: "Breaking Bad", first_air_date: "2008-01-20", overview: "x", genre_ids: [18, 80], vote_average: 8.9,
  number_of_seasons: 5, number_of_episodes: 62, poster_path: "/bb.jpg", backdrop_path: "/bbb.jpg",
  seasons: [{ season_number: 1, name: "Season 1", episode_count: 7, poster_path: "/s1.jpg" }],
  videos: { results: [{ site: "YouTube", type: "Trailer", key: "HhesaQXLuRY" }] },
  credits: { cast: [{ name: "Bryan Cranston" }, { name: "Aaron Paul" }] },
  "watch/providers": { results: { US: { flatrate: [{ provider_name: "Netflix", logo_path: "/n.jpg" }] } } },
};
const INCEPTION_DETAIL = {
  id: 27205, title: "Inception", release_date: "2010-07-16", overview: "A thief who steals secrets through dreams.", genre_ids: [28, 878, 12], vote_average: 8.4, runtime: 148, poster_path: "/p.jpg", backdrop_path: "/b.jpg", tagline: "Your mind is the scene of the crime.",
  videos: { results: [{ site: "YouTube", type: "Trailer", key: "YoHD9XEInc0" }] },
  credits: { cast: [{ name: "Leonardo DiCaprio", character: "Dom Cobb", profile_path: "/leo.jpg" }, { name: "Joseph Gordon-Levitt", character: "Arthur", profile_path: "/jgl.jpg" }], crew: [{ name: "Christopher Nolan", job: "Director" }, { name: "Hans Zimmer", job: "Original Music Composer" }] },
  images: { logos: [{ iso_639_1: "en", file_path: "/inception-logo.png" }] },
  keywords: { keywords: [{ name: "dream" }, { name: "heist" }, { name: "subconscious" }] },
  release_dates: { results: [{ iso_3166_1: "US", release_dates: [{ certification: "PG-13" }] }] },
  recommendations: { results: [{ id: 155, title: "The Dark Knight", poster_path: "/dk.jpg", backdrop_path: "/dkb.jpg", vote_average: 8.5, release_date: "2008-07-16", genre_ids: [18, 28, 80] }] },
  similar: { results: [] },
  external_ids: { imdb_id: "tt1375666" },
};
const SEASON1 = { episodes: [
  { id: 62085, name: "Pilot", season_number: 1, episode_number: 1, overview: "", vote_average: 8.2, runtime: 58, air_date: "2008-01-20", still_path: "/st.jpg" },
  { id: 62086, name: "Cat's in the Bag…", season_number: 1, episode_number: 2, overview: "", vote_average: 8.1, runtime: 48, air_date: "2008-01-27", still_path: "/st2.jpg" },
] };

let calls = 0;
const routeFor = (u) => {
  const path = new URL(u).pathname;
  if (path === "/3/trending/all/week") return TREND;
  if (path === "/3/tv/1396") return BB_DETAIL;
  if (path === "/3/movie/27205") return INCEPTION_DETAIL;
  if (path === "/3/tv/1396/season/1") return SEASON1;
  throw new Error("no fixture for " + path);
};
const makeFetch = (down = false) => async (u) => {
  if (down) throw new Error("network down");
  calls++;
  const body = routeFor(u);
  return { ok: true, status: 200, json: async () => body };
};

const cache = createMediaCache({ kv: memKV() });
const tmdb = createTmdb({ apiKey: "test", fetch: makeFetch(), cache, region: "US" });

// 1
{
  const rows = await tmdb.trending();
  const titles = rows.map((r) => r.name);
  ok("populatesRails", rows.length === 2 && titles.includes("The Matrix") && titles.includes("Breaking Bad") && rows.every((r) => r.posterUrl), JSON.stringify(titles));
}
// 2
{
  const s = await tmdb.title(1396, "tv");
  ok("seriesEnriched", s.kind === "series" && s.trailerKey === "HhesaQXLuRY" && s.cast.includes("Bryan Cranston") && (s.providers || []).some((p) => p.name === "Netflix"), JSON.stringify({ trailer: s.trailerKey, cast: s.cast, providers: (s.providers || []).map((p) => p.name) }));
}
// 3
{
  const eps = await tmdb.season(1396, 1, { tmdbId: 1396, name: "Breaking Bad", topics: ["drama"], backdrop: "x", quality: 0.89 });
  ok("seasonEpisodes", eps.length === 2 && eps[0].kind === "episode" && eps[0].seriesId === "tmdb:series:1396" && eps[0].parentId === "tmdb:season:1396:1" && eps[1].episodeNumber === 2, JSON.stringify(eps.map((e) => `${e.seasonNumber}x${e.episodeNumber}:${e.name}`)));
}
// 4 — repeat trending: the fetch count must NOT rise (served from the κ-cache), and stats show a hit.
{
  const before = calls;
  await tmdb.trending();
  ok("kappaCacheHit", calls === before && cache.stats().hits >= 1, JSON.stringify({ before, after: calls, stats: cache.stats() }));
}
// 5 — forge a stored object whose body no longer re-derives to its κ; get() must refuse it (Law L5).
{
  const realKappa = await address({ a: 1 });
  const forgedKV = memKV();
  forgedKV.set("req:x", realKappa);
  forgedKV.set("obj:" + realKappa, JSON.stringify({ id: realKappa, body: { a: 999 } }));   // body ≠ κ
  const forged = createMediaCache({ kv: forgedKV });
  const got = await forged.get("x");
  ok("verifyBeforeTrust", got === null && forged.stats().refused >= 1, JSON.stringify({ got, stats: forged.stats() }));
}
// 6b — deep metadata: title() pulls logo art, cast headshots, director, certification, keywords,
// recommendations, and the imdb id, all normalized onto the one item shape.
{
  const m = await tmdb.title(27205, "movie");
  ok("deepMetadata",
    /inception-logo\.png/.test(m.logoUrl || "") &&
    m.castDetail[0].name === "Leonardo DiCaprio" && /leo\.jpg/.test(m.castDetail[0].profile || "") && m.castDetail[0].character === "Dom Cobb" &&
    m.directors.includes("Christopher Nolan") && m.certification === "PG-13" &&
    m.keywords.includes("heist") && m.recommendations[0] && m.recommendations[0].name === "The Dark Knight" &&
    m.imdbId === "tt1375666" && (m.tagline || "").length > 0,
    JSON.stringify({ logo: m.logoUrl, cast: m.castDetail[0], dir: m.directors, cert: m.certification, kw: m.keywords, rec: m.recommendations[0] && m.recommendations[0].name, imdb: m.imdbId }));
}
// 6 — network down, but the κ-cache is warm from check 1 → trending still serves.
{
  const offline = createTmdb({ apiKey: "test", fetch: makeFetch(true), cache, region: "US" });
  let rows = null, threw = false;
  try { rows = await offline.trending(); } catch { threw = true; }
  ok("worksOffline", !threw && rows && rows.length === 2, JSON.stringify({ threw, n: rows && rows.length }));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-tmdb — the metadata provider auto-populates Holo Player (TMDb → the one item shape: trending/popular/search/title/season, series enriched with trailer+cast+where-to-watch) and is κ-cached: repeats are served O(1) from a content-addressed κ (no fetch), tampering is refused (Law L5), and a warm cache works offline.",
  authority: "rests on #holo-tmdb + #holo-media-cache + #holo-media-item — Phase 1 of the streaming/metadata plan",
  witnessed,
  covers: witnessed ? ["populates-rails", "series-enriched", "season-episodes", "kappa-cache-hit", "verify-before-trust", "works-offline", "deep-metadata"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-tmdb-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-tmdb witness — metadata auto-population, κ-cached + offline + Law-L5\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  every title, full metadata, served from κ — fast + offline + verifiable" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
