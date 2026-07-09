// holo-media-item.mjs — the ONE render-item shape for Holo Player, and the TMDb → item normalizers.
//
// Holo Player has always had a single item shape (holo-jellyfin.js: native κ-store + real Jellyfin).
// This module is the SOURCE OF TRUTH for that shape's superset — it adds, additively:
//   • a series hierarchy   (kind: movie|series|season|episode; seriesId/seasonNumber/episodeNumber/parentId)
//   • a rich metadata block (overview, genres, cast, rating, backdrop, logo, tagline, trailer)
//   • "where to watch"      (providers[] from TMDb watch-providers — the Netflix/Hulu *feel*)
//   • honest availability   (metadata ≠ bytes: a title is browsable without being playable)
// Every field the existing player already reads (name, topics, channel, quality, posterUrl, backdrop,
// blurb, runtimeSec, kappa, playSrc, source, provider, license …) is preserved, so pool()/HoloRank/rails
// consume a TMDb item with ZERO rail-code change. The shape IS the contract.
//
// Pure ESM, no globals, no network — so Node can witness the normalizers exactly. holo-tmdb.mjs wires the
// network + κ-cache on top; this module never fetches.

// TMDb genre id → human name (movie + tv ids unioned). Used to label rails and feed affinity.
export const TMDB_GENRES = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary",
  18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Science Fiction", 10770: "TV Movie", 53: "Thriller",
  10752: "War", 37: "Western", 10759: "Action & Adventure", 10762: "Kids", 10763: "News",
  10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics",
};

// Human genre → the player's existing topic keys (so genre rails + HoloRank affinity light up). Genres
// without a legacy key still flow through as their lowercased name (the player makes genre rails dynamic).
const GENRE_TO_TOPIC = {
  "Science Fiction": "scifi", "Sci-Fi & Fantasy": "scifi", Animation: "animation", Fantasy: "fantasy",
  Comedy: "comedy", Action: "action", "Action & Adventure": "action", Music: "music",
  Documentary: "nature", Family: "comedy", Adventure: "action",
};

// TMDb image CDN — no API key needed for images. Sized per surface so cards are crisp without overfetch.
export const TMDB_IMG = "https://image.tmdb.org/t/p";
export const posterURL = (p, w = "w500") => (p ? `${TMDB_IMG}/${w}${p}` : null);
export const backdropURL = (p, w = "w1280") => (p ? `${TMDB_IMG}/${w}${p}` : null);
// Key-free artwork fallback (Stremio metahub, by IMDb id) — gives every catalog title real, beautiful
// posters/backdrops with NO TMDb key (the same CDN Cinemeta uses). Used only when TMDb ships no image
// (the offline seed): a live TMDb fetch, which has its own poster_path, always wins.
export const METAHUB = "https://images.metahub.space";
export const metahubPoster = (imdb) => (imdb && /^tt\d+$/.test(imdb) ? `${METAHUB}/poster/medium/${imdb}/img` : null);
export const metahubBackdrop = (imdb) => (imdb && /^tt\d+$/.test(imdb) ? `${METAHUB}/background/medium/${imdb}/img` : null);
const yearOf = (d) => (d && /^\d{4}/.test(d) ? +d.slice(0, 4) : null);

const genreNames = (t) => {
  if (Array.isArray(t.genres)) return t.genres.map((g) => g.name).filter(Boolean);
  if (Array.isArray(t.genre_ids)) return t.genre_ids.map((id) => TMDB_GENRES[id]).filter(Boolean);
  return [];
};
// topics = legacy keys (for affinity/genre rails) ∪ lowercased raw genres (for dynamic rails). Deduped.
const topicsOf = (names) => [...new Set(names.flatMap((n) => [GENRE_TO_TOPIC[n], n.toLowerCase()]).filter(Boolean))];

// The honest seam: metadata is not bytes. A freshly-discovered title is browsable, not playable, until a
// source binds (Phase 2). Callers can pass a pre-resolved source; default = browse-only.
export const browseOnly = () => ({ playable: false, source: null, kappa: "", playSrc: "", type: "" });

// ── deep-metadata extractors (tolerant: return empty when the append_to_response field is absent) ──────────
export const DEFAULT_REGION = "US";
const headshot = (p) => (p ? posterURL(p, "w185") : null);
// official trailer/teaser key (YouTube) for the ambient hero.
export function trailerOf(t) {
  const v = (t.videos && t.videos.results) || [];
  const f = v.find((x) => x.site === "YouTube" && /Trailer/i.test(x.type)) || v.find((x) => x.site === "YouTube" && /Teaser/i.test(x.type)) || v.find((x) => x.site === "YouTube");
  return f ? f.key : (t.trailerKey || null);
}
function castOf(t) { return ((t.credits && t.credits.cast) || []).slice(0, 12).map((p) => ({ name: p.name, character: p.character || "", profile: headshot(p.profile_path) })); }
function crewOf(t, kind) {
  if (kind === "series") return ((t.created_by) || []).map((p) => p.name);
  return ((t.credits && t.credits.crew) || []).filter((p) => p.job === "Director").map((p) => p.name);
}
function certOf(t, kind, region = DEFAULT_REGION) {
  if (kind === "series") { const r = (t.content_ratings && t.content_ratings.results) || []; const m = r.find((x) => x.iso_3166_1 === region) || r[0]; return (m && m.rating) || ""; }
  const rd = (t.release_dates && t.release_dates.results) || []; const m = rd.find((x) => x.iso_3166_1 === region) || rd[0];
  return m ? ((m.release_dates || []).map((x) => x.certification).find(Boolean) || "") : "";
}
function logoOf(t) {
  const lg = (t.images && t.images.logos) || [];
  if (lg.length) { const en = lg.find((x) => x.iso_639_1 === "en" && /\.png$/i.test(x.file_path)) || lg.find((x) => x.iso_639_1 === "en") || lg[0]; return posterURL(en.file_path, "w300"); }
  return t.logo_path ? posterURL(t.logo_path, "w300") : null;
}
function keywordsOf(t) { const k = (t.keywords && (t.keywords.keywords || t.keywords.results)) || []; return k.slice(0, 10).map((x) => x.name); }
function imdbOf(t) { return (t.external_ids && t.external_ids.imdb_id) || t.imdb_id || null; }
// a lightweight item for "More like this" (no recursive append extraction).
function liteItem(x) {
  const isTv = !!(x.first_air_date) || (x.name && !x.title) || x.media_type === "tv";
  const names = genreNames(x);
  return { id: "tmdb:" + (isTv ? "series" : "movie") + ":" + x.id, tmdbId: x.id, kind: isTv ? "series" : "movie",
    name: x.title || x.name || "Untitled", year: yearOf(x.release_date || x.first_air_date),
    posterUrl: posterURL(x.poster_path), backdrop: backdropURL(x.backdrop_path), rating: typeof x.vote_average === "number" ? x.vote_average : null,
    topics: topicsOf(names), genres: names, channel: "TheMovieDB", quality: x.vote_average ? Math.min(1, x.vote_average / 10) : 0.7,
    source: "tmdb", provider: "tmdb", kappa: "", holoKappa: "tmdb:" + (isTv ? "series" : "movie") + ":" + x.id, availability: browseOnly() };
}
function recsOf(t) {
  const all = [...(((t.recommendations && t.recommendations.results) || [])), ...(((t.similar && t.similar.results) || []))];
  const seen = new Set(), out = [];
  for (const x of all) { const it = liteItem(x); if (seen.has(it.id)) continue; seen.add(it.id); out.push(it); if (out.length >= 12) break; }
  return out;
}

// ── normalizers — every one returns the canonical shape ──────────────────────────────────────────────────
export function normalizeMovie(t, { availability, region } = {}) {
  const names = genreNames(t);
  const cd = castOf(t);
  const imdb = imdbOf(t);
  return {
    id: "tmdb:movie:" + t.id, tmdbId: t.id, kind: "movie", name: t.title || t.name || "Untitled",
    year: yearOf(t.release_date), releaseDate: t.release_date || "",
    overview: t.overview || "", blurb: t.overview || "", tagline: t.tagline || "",
    genres: names, topics: topicsOf(names),
    cast: cd.length ? cd.map((c) => c.name) : (t.cast || []).slice(0, 8), castDetail: cd, directors: crewOf(t, "movie"),
    rating: typeof t.vote_average === "number" ? t.vote_average : null, certification: certOf(t, "movie", region),
    keywords: keywordsOf(t), recommendations: recsOf(t), imdbId: imdb,
    runtimeSec: t.runtime ? t.runtime * 60 : 0,
    posterUrl: posterURL(t.poster_path) || metahubPoster(imdb), backdrop: backdropURL(t.backdrop_path) || metahubBackdrop(imdb), logoUrl: logoOf(t),
    trailerKey: trailerOf(t),
    providers: t.providers || [],
    channel: "TheMovieDB", quality: t.vote_average ? Math.min(1, t.vote_average / 10) : 0.7, license: "",
    source: "tmdb", provider: "tmdb", kappa: "", holoKappa: "tmdb:movie:" + t.id,
    availability: availability || browseOnly(),
  };
}

export function normalizeSeries(t, { availability, region } = {}) {
  const names = genreNames(t);
  const imdb = imdbOf(t);
  return {
    id: "tmdb:series:" + t.id, tmdbId: t.id, kind: "series", name: t.name || t.title || "Untitled",
    year: yearOf(t.first_air_date), releaseDate: t.first_air_date || "",
    overview: t.overview || "", blurb: t.overview || "", tagline: t.tagline || "",
    genres: names, topics: topicsOf(names),
    cast: (() => { const cd = castOf(t); return cd.length ? cd.map((c) => c.name) : (t.cast || []).slice(0, 8); })(), castDetail: castOf(t), creators: crewOf(t, "series"),
    rating: typeof t.vote_average === "number" ? t.vote_average : null, certification: certOf(t, "series", region),
    keywords: keywordsOf(t), recommendations: recsOf(t), imdbId: imdb, networks: (t.networks || []).map((n) => n.name),
    seasonCount: t.number_of_seasons || (Array.isArray(t.seasons) ? t.seasons.filter((s) => s.season_number > 0).length : 0),
    episodeCount: t.number_of_episodes || 0,
    seasons: Array.isArray(t.seasons)
      ? t.seasons.filter((s) => s.season_number != null).map((s) => ({
          id: "tmdb:season:" + t.id + ":" + s.season_number, seriesId: "tmdb:series:" + t.id, seasonNumber: s.season_number,
          name: s.name || "Season " + s.season_number, episodeCount: s.episode_count || 0,
          posterUrl: posterURL(s.poster_path), overview: s.overview || "",
        }))
      : [],
    runtimeSec: 0,
    posterUrl: posterURL(t.poster_path) || metahubPoster(imdb), backdrop: backdropURL(t.backdrop_path) || metahubBackdrop(imdb), logoUrl: logoOf(t),
    trailerKey: trailerOf(t),
    providers: t.providers || [],
    channel: "TheMovieDB", quality: t.vote_average ? Math.min(1, t.vote_average / 10) : 0.7, license: "",
    source: "tmdb", provider: "tmdb", kappa: "", holoKappa: "tmdb:series:" + t.id,
    availability: availability || browseOnly(),
  };
}

export function normalizeEpisode(ep, series, { availability } = {}) {
  const sid = "tmdb:series:" + (series.tmdbId ?? series.id);
  return {
    id: "tmdb:ep:" + (series.tmdbId ?? series.id) + ":" + ep.season_number + ":" + ep.episode_number,
    tmdbId: ep.id, kind: "episode",
    name: ep.name || `Episode ${ep.episode_number}`,
    seriesId: sid, seriesName: series.name, parentId: "tmdb:season:" + (series.tmdbId ?? series.id) + ":" + ep.season_number,
    seasonNumber: ep.season_number, episodeNumber: ep.episode_number,
    overview: ep.overview || "", blurb: ep.overview || "",
    rating: typeof ep.vote_average === "number" ? ep.vote_average : null,
    runtimeSec: ep.runtime ? ep.runtime * 60 : 0, releaseDate: ep.air_date || "",
    posterUrl: backdropURL(ep.still_path, "w300") || series.posterUrl, backdrop: series.backdrop,
    topics: series.topics || [], genres: series.genres || [],
    channel: "TheMovieDB", quality: series.quality ?? 0.7, license: "",
    source: "tmdb", provider: "tmdb", kappa: "", holoKappa: "tmdb:ep:" + (series.tmdbId ?? series.id) + ":" + ep.season_number + ":" + ep.episode_number,
    availability: availability || browseOnly(),
  };
}

// TMDb /watch/providers → a flat, region-stamped list. Honest: provider availability is region- AND
// time-variant, so the caller stamps the fetch time; we stamp the region here.
export function normalizeWatchProviders(payload, region = "US") {
  const r = payload && payload.results && payload.results[region];
  if (!r) return [];
  const out = [];
  for (const type of ["flatrate", "free", "ads", "rent", "buy"]) {
    for (const p of r[type] || []) out.push({ name: p.provider_name, type, region, logo: posterURL(p.logo_path, "w92"), link: r.link || "" });
  }
  // de-dup by provider name keeping the best (flatrate/free) tier
  const seen = new Map();
  for (const p of out) if (!seen.has(p.name)) seen.set(p.name, p);
  return [...seen.values()];
}

// generic dispatch for a /trending or /search/multi mixed list
export function normalizeAny(t, opts) {
  const mt = t.media_type || (t.title ? "movie" : t.name && t.first_air_date !== undefined ? "tv" : t.title ? "movie" : "tv");
  if (mt === "tv" || t.first_air_date != null || t.number_of_seasons != null) return normalizeSeries(t, opts);
  return normalizeMovie(t, opts);
}

// "Where to watch" → a "go watch it there" link. TMDb gives platform NAMES + ONE aggregate JustWatch link per
// title (no per-provider deep-links), so we open each platform's SEARCH for the title — the honest take-me-there.
// Unknown platform → the title's JustWatch link, else a web search. Makes the where-to-watch chips ACTIONABLE.
const WATCH_URLS = {
  "netflix": (q) => "https://www.netflix.com/search?q=" + q,
  "disney plus": (q) => "https://www.disneyplus.com/search?q=" + q,
  "hulu": (q) => "https://www.hulu.com/search?q=" + q,
  "amazon prime video": (q) => "https://www.amazon.com/s?k=" + q + "&i=instant-video",
  "amazon video": (q) => "https://www.amazon.com/s?k=" + q + "&i=instant-video",
  "max": (q) => "https://play.max.com/search?q=" + q,
  "hbo max": (q) => "https://play.max.com/search?q=" + q,
  "apple tv": (q) => "https://tv.apple.com/search?term=" + q,
  "apple tv plus": (q) => "https://tv.apple.com/search?term=" + q,
  "youtube": (q) => "https://www.youtube.com/results?search_query=" + q,
  "peacock": (q) => "https://www.peacocktv.com/search?q=" + q,
  "paramount plus": (q) => "https://www.paramountplus.com/search/?query=" + q,
  "paramount+": (q) => "https://www.paramountplus.com/search/?query=" + q,
  "crunchyroll": (q) => "https://www.crunchyroll.com/search?q=" + q,
};
export function watchLink(providerName, item, fallbackLink) {
  const q = encodeURIComponent((item && item.name) || "");
  const key = String(providerName || "").toLowerCase().replace(/\s+with\s+ads$/, "").trim();
  const fn = WATCH_URLS[key];
  if (fn) return fn(q);
  if (fallbackLink) return fallbackLink;                                  // TMDb's aggregate JustWatch link for the title
  return "https://www.google.com/search?q=" + q + "%20watch%20online";    // last resort
}

export default { normalizeMovie, normalizeSeries, normalizeEpisode, normalizeWatchProviders, normalizeAny, browseOnly, posterURL, backdropURL, watchLink, TMDB_GENRES, TMDB_IMG };
