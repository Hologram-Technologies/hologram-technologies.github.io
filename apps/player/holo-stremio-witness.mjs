#!/usr/bin/env node
// holo-stremio-witness.mjs — proves the Stremio addon adapter speaks the protocol, normalizes to the one
// shape, quality-ranks streams (4K-HTTP first, torrents flagged for debrid), binds series ids, and is κ-cached.
//
// Checks:
//   1 manifestCatalogs  — catalogs() reflects the addon manifest.
//   2 browseNormalizes  — a catalog meta normalizes to the shape (imdbId from tt…, kind, _stremioId).
//   3 searchExtra       — search(q) hits the addon's search-extra catalog.
//   4 streamQualityRank — resolve() ranks 4K-HTTP first, then 720p-HTTP, then a torrent (needsDebrid).
//   5 seriesStreamId    — a series episode resolves via the tt…:S:E id.
//   6 kappaCacheHit     — a repeated request is served from κ (0 extra fetches).
//
// node holo-stremio-witness.mjs   (from holo-apps/apps/player/)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createAddon } from "./holo-stremio.mjs";
import { createMediaCache, memKV } from "./holo-media-cache.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const MANIFEST = { name: "Test Addon", version: "1.0.0", resources: ["catalog", "meta", "stream"], types: ["movie", "series"], idPrefixes: ["tt"], catalogs: [{ type: "movie", id: "top", name: "Top", extra: [{ name: "search" }, { name: "skip" }] }] };
const CAT_TOP = { metas: [{ id: "tt1375666", type: "movie", name: "Inception", poster: "https://img/p.jpg", background: "https://img/b.jpg", releaseInfo: "2010", description: "Dreams within dreams.", genres: ["Action", "Sci-Fi"] }] };
const CAT_SEARCH = { metas: [{ id: "tt1160419", type: "movie", name: "Dune", poster: "https://img/d.jpg", releaseInfo: "2021" }] };
const STREAM_MOVIE = { streams: [
  { url: "https://cdn/movie-4k.mkv", title: "4K HDR HEVC", behaviorHints: {} },
  { infoHash: "abc123", title: "1080p BluRay", fileIdx: 0 },
  { url: "https://cdn/movie-720.mp4", title: "720p WEB" },
] };
const STREAM_EP = { streams: [{ url: "https://cdn/bb-s1e1.mp4", title: "1080p" }] };

let calls = 0;
const routeFor = (url) => {
  const p = url.replace(/^https?:\/\/[^/]+/, "");
  if (/\/manifest\.json$/.test(p)) return MANIFEST;
  if (/\/catalog\/movie\/top\/search=/.test(p)) return CAT_SEARCH;
  if (/\/catalog\/movie\/top\.json$/.test(p)) return CAT_TOP;
  if (/\/stream\/movie\/tt1375666\.json$/.test(p)) return STREAM_MOVIE;
  if (/\/stream\/series\/tt0903747:1:1\.json$/.test(p)) return STREAM_EP;
  throw new Error("no fixture for " + p);
};
const fetchFix = async (url) => { calls++; return { ok: true, status: 200, json: async () => routeFor(url) }; };

const cache = createMediaCache({ kv: memKV() });
const addon = createAddon({ base: "https://addon.example/manifest.json", fetch: fetchFix, cache });

// 1
{
  const cats = await addon.catalogs();
  ok("manifestCatalogs", cats.length === 1 && cats[0].id === "movie::top" && /Top/.test(cats[0].name) && addon.name === "Test Addon", JSON.stringify(cats));
}
// 2
{
  const items = await addon.browse("movie::top", {});
  const it = items[0];
  ok("browseNormalizes", it && it.name === "Inception" && it.imdbId === "tt1375666" && it.kind === "movie" && it._stremioId === "tt1375666" && it.posterUrl === "https://img/p.jpg" && it.year === 2010, JSON.stringify({ name: it && it.name, imdb: it && it.imdbId, sid: it && it._stremioId }));
}
// 3
{
  const items = await addon.search("dune");
  ok("searchExtra", items.length === 1 && items[0].name === "Dune" && items[0].imdbId === "tt1160419", JSON.stringify(items.map((x) => x.name)));
}
// 4
{
  const cands = await addon.resolve({ _stremioId: "tt1375666", _stremioType: "movie", kind: "movie" });
  ok("streamQualityRank",
    cands.length === 3 && cands[0].httpDirect && cands[0].quality === 2160 && cands[0].hdr === true &&
    cands[1].httpDirect && cands[1].quality === 720 && cands[2].needsDebrid === true && cands[2].infoHash === "abc123",
    JSON.stringify(cands.map((c) => ({ q: c.quality, http: !!c.httpDirect, debrid: !!c.needsDebrid }))));
}
// 5
{
  const cands = await addon.resolve({ _stremioId: "tt0903747", _stremioType: "series", kind: "series", seasonNumber: 1, episodeNumber: 1 });
  ok("seriesStreamId", cands.length === 1 && cands[0].playSrc === "https://cdn/bb-s1e1.mp4", JSON.stringify(cands.map((c) => c.playSrc)));
}
// 6
{
  const before = calls;
  await addon.catalogs(); await addon.browse("movie::top", {});
  ok("kappaCacheHit", calls === before && cache.stats().hits >= 1, JSON.stringify({ before, after: calls, stats: cache.stats() }));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-stremio — a Stremio addon as a κ-native SourceProvider: speaks manifest/catalog/meta/stream, normalizes metas to the one shape (imdb ids), quality-ranks streams (4K-HTTP first, torrents flagged for debrid), binds series tt…:S:E ids, and serves every response from a content-addressed κ-cache (instant repeats, offline).",
  authority: "rests on #holo-stremio (+ #holo-media-cache) — Step 2 of the universal-catalog action plan",
  witnessed,
  covers: witnessed ? ["manifest-catalogs", "browse-normalizes", "search-extra", "stream-quality-rank", "series-stream-id", "kappa-cache-hit"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-stremio-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-stremio witness — Stremio addon as a κ-native source (protocol · quality-rank · cached)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  any Stremio catalogue, normalized + quality-ranked + κ-cached" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
