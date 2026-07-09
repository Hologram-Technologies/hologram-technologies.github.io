// holo-tmdb.mjs — the metadata provider: TMDb → the ONE Holo Player item shape, κ-cached.
//
// This is Jellyfin's built-in metadata providers + Jellyseerr's discovery, done once and content-addressed.
// It auto-populates Holo Player with every popular movie + series (titles, posters, backdrops, overviews,
// genres, cast, ratings, trailers, and "where to watch") — and because every response goes THROUGH
// holo-media-cache (a κ-object keyed by the request), a warm open is memory-speed and works offline.
//
// Dependency-injected (fetch + cache) so Node witnesses it with a fake TMDb and a Map cache — no network,
// no key. The browser binding (window.HoloTmdb) wires real fetch + the persistent κ-cache.

import { normalizeMovie, normalizeSeries, normalizeEpisode, normalizeWatchProviders, normalizeAny } from "./holo-media-item.mjs";

const API = "https://api.themoviedb.org/3";

// createTmdb({ apiKey, fetch, cache, region, lang }) — fetch/cache injectable. apiKey: v3 key (query) or v4
// bearer token (auto-detected by the dot in a JWT). cache: a holo-media-cache instance (or null = no cache).
export function createTmdb({ apiKey = "", fetch: f, cache = null, region = "US", lang = "en-US" } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-tmdb: a fetch implementation is required");
  const bearer = apiKey.includes("."); // v4 tokens are JWTs

  function url(path, params = {}) {
    const u = new URL(API + path);
    u.searchParams.set("language", lang);
    if (!bearer && apiKey) u.searchParams.set("api_key", apiKey);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
    return u.toString();
  }
  async function raw(path, params) {
    const res = await doFetch(url(path, params), bearer ? { headers: { Authorization: "Bearer " + apiKey } } : undefined);
    if (!res.ok) throw new Error("tmdb " + res.status + " " + path);
    return res.json();
  }
  // every network call goes through the κ-cache: same request → same κ → O(1) warm/offline read.
  async function api(path, params = {}) {
    const key = path + "?" + new URLSearchParams(params).toString() + "|" + lang + "|" + region;
    if (!cache) return raw(path, params);
    const { body } = await cache.through(key, () => raw(path, params));
    return body;
  }

  const list = (payload, opts) => (payload && payload.results ? payload.results : []).map((t) => normalizeAny(t, opts)).filter((x) => x.posterUrl || x.backdrop);

  return {
    // ── discovery rails ──────────────────────────────────────────────────────────────────────────────
    async trending(window = "week") { return list(await api(`/trending/all/${window}`)); },
    async popularMovies(page = 1) { return (await api("/movie/popular", { page })).results.map((t) => normalizeMovie(t)); },
    async popularSeries(page = 1) { return (await api("/tv/popular", { page })).results.map((t) => normalizeSeries(t)); },
    async topRatedMovies(page = 1) { return (await api("/movie/top_rated", { page })).results.map((t) => normalizeMovie(t)); },
    async byGenre(genreId, kind = "movie", page = 1) {
      const p = await api(kind === "tv" ? "/discover/tv" : "/discover/movie", { with_genres: genreId, sort_by: "popularity.desc", page });
      return p.results.map((t) => (kind === "tv" ? normalizeSeries(t) : normalizeMovie(t)));
    },
    async search(q, page = 1) { return list(await api("/search/multi", { query: q, page, include_adult: false })); },

    // ── one title, enriched (videos → trailer, credits → cast, watch/providers → "where to watch") ─────
    async title(id, kind = "movie") {
      const tv = kind === "tv";
      // pull EVERYTHING in one call: trailer, full cast+crew, logo art, keywords, certification, recommendations,
      // similar, imdb id. include_image_language gets the English title-logo PNG. The κ-cache makes repeats free.
      const append = tv
        ? "videos,credits,images,keywords,recommendations,similar,external_ids,content_ratings,watch/providers"
        : "videos,credits,images,keywords,release_dates,recommendations,similar,external_ids,watch/providers";
      const t = await api(`/${tv ? "tv" : "movie"}/${id}`, { append_to_response: append, include_image_language: "en,null" });
      t.providers = normalizeWatchProviders(t["watch/providers"], region);   // normalizers extract the rest
      return tv ? normalizeSeries(t, { region }) : normalizeMovie(t, { region });
    },
    // ── a season's episodes (the Series → Season → Episode browser) ────────────────────────────────────
    async season(seriesId, seasonNumber, series) {
      const s = await api(`/tv/${seriesId}/season/${seasonNumber}`);
      const ctx = series || { tmdbId: seriesId, name: "", topics: [], genres: [], backdrop: null, posterUrl: null, quality: 0.7 };
      return (s.episodes || []).map((ep) => normalizeEpisode(ep, ctx));
    },
    async watchProviders(id, kind = "movie") { return normalizeWatchProviders(await api(`/${kind === "tv" ? "tv" : "movie"}/${id}/watch/providers`), region); },
  };
}

// browser binding — real fetch + the persistent κ-cache + a single optional key in localStorage.
if (typeof window !== "undefined") {
  window.HoloTmdb = {
    createTmdb,
    // live({ apiKey }) — the one the player calls. Key from arg or localStorage "holoplayer.tmdb.key".
    live(opts = {}) {
      const apiKey = opts.apiKey || (() => { try { return localStorage.getItem("holoplayer.tmdb.key") || ""; } catch { return ""; } })();
      const cache = window.HoloMediaCache ? window.HoloMediaCache.live() : null;
      return createTmdb({ apiKey, cache, region: opts.region || "US", lang: opts.lang || "en-US" });
    },
    configured() { try { return !!localStorage.getItem("holoplayer.tmdb.key"); } catch { return false; } },
    setKey(k) { try { localStorage.setItem("holoplayer.tmdb.key", k || ""); } catch {} },
  };
}

export default { createTmdb };
