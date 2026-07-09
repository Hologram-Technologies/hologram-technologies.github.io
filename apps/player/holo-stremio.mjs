// holo-stremio.mjs — a Stremio addon as a SourceProvider (the massive catalogue), κ-native.
//
// Speaks the open Stremio addon protocol over plain HTTP — no SDK, no server of ours:
//   /manifest.json                         → { name, resources, types, catalogs:[{type,id,name,extra}], idPrefixes }
//   /catalog/{type}/{id}[/{extra}].json    → { metas:[{id,type,name,poster,...}] }   (discovery; extra = search/skip/genre)
//   /meta/{type}/{id}.json                 → { meta:{...} }
//   /stream/{type}/{id}.json               → { streams:[{ url|infoHash|ytId|externalUrl, title, behaviorHints }] }
// ids are IMDb (tt…), series ids are tt…:S:E. Every response goes THROUGH the κ-cache (holo-media-cache) →
// O(1) on repeat, offline, Law-L5. Streams are quality-ranked (4K/HDR HTTP first) and classified so the
// player can play HTTP instantly and route torrents to a debrid resolver honestly.
//
// createAddon({ base, fetch, cache }) — fetch/cache injected (Node-witnessable). Returns a SourceProvider.

import { normalizeMovie, normalizeSeries } from "./holo-media-item.mjs";

export const normalizeBase = (u) => String(u || "").trim().replace(/^stremio:\/\//, "https://").replace(/\/+$/, "").replace(/\/manifest\.json$/i, "");

// parse a quality tier + HDR flag from a stream's title/name/behaviorHints.
export function parseQuality(s) {
  const t = ((s.title || "") + " " + (s.name || "") + " " + JSON.stringify(s.behaviorHints || {})).toLowerCase();
  const q = /2160|4k|uhd/.test(t) ? 2160 : /1440/.test(t) ? 1440 : /1080/.test(t) ? 1080 : /720/.test(t) ? 720 : /480/.test(t) ? 480 : 0;
  return { quality: q, hdr: /\bhdr|dolby ?vision|\bdv\b/.test(t) };
}
// Audio tier from the label: object/lossless (Atmos/TrueHD/DTS-X/DTS-HD/FLAC) > DD+ > DTS > DD/AC3 > AAC.
const AUDIO_TIER = [[/atmos|truehd|dts[ ._-]?x|dts[ ._-]?hd|flac|\bpcm\b/i, 4], [/dd\+|ddp|e[ ._-]?ac[ ._-]?3|eac3/i, 3], [/\bdts\b/i, 3], [/\bdd\b|ac[ ._-]?3|dolby ?digital/i, 2], [/aac|opus|\bmp3\b/i, 1]];
// parseRelease — quality + HDR/Dolby-Vision + audio tier + size(GB, a bitrate proxy) from label/behaviorHints.
export function parseRelease(s) {
  const t = ((s.title || "") + " " + (s.name || "") + " " + JSON.stringify(s.behaviorHints || {})).toLowerCase();
  const { quality, hdr } = parseQuality(s);
  let audio = 0; for (const [re, tier] of AUDIO_TIER) if (re.test(t)) { audio = tier; break; }
  const m = t.match(/([\d.]+)\s*(t|g)i?b/);
  let sizeGB = m ? +m[1] * (m[2] === "t" ? 1024 : 1) : 0;
  const vs = s.behaviorHints && (s.behaviorHints.videoSize || s.behaviorHints.size); if (vs) sizeGB = +vs / 1073741824;
  return { quality, hdr, dv: /dolby ?vision|\bdv\b/.test(t), audio, sizeGB };
}
// scoreRelease — INTRINSIC quality (resolution dominates → HDR/DV → audio → bitrate). Decides probe order;
// "instantly cached" is applied later at the RD race (cached-ness is unknown until we ask the user's RD).
export function scoreRelease(c) {
  const resTier = c.quality >= 2160 ? 4 : c.quality >= 1440 ? 3 : c.quality >= 1080 ? 2 : c.quality >= 720 ? 1 : 0;
  return resTier * 5 + (c.hdr ? 2 : 0) + (c.dv ? 1 : 0) + (c.audio || 0) * 2 + Math.min(3, (c.sizeGB || 0) / 8);
}
// one stream → a classified candidate. httpDirect plays now; infoHash needs debrid; external/yt are special.
function toCandidate(s, prov) {
  const base = { ...parseRelease(s), label: s.title || s.name || "", provenance: prov };
  if (s.url) return { ...base, playSrc: s.url, type: /\.m3u8/.test(s.url) ? "application/x-mpegURL" : /\.mpd/.test(s.url) ? "application/dash+xml" : "", kind: "addon", httpDirect: true };
  if (s.infoHash) return { ...base, infoHash: s.infoHash, fileIdx: s.fileIdx, kind: "addon", needsDebrid: true };
  if (s.ytId) return { ...base, playSrc: "holo://os/sc/vstream?url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + s.ytId) + "&h=1080", type: "video/webm", embedFallback: `https://www.youtube-nocookie.com/embed/${s.ytId}?autoplay=1`, kind: "native", httpDirect: true };
  if (s.externalUrl) return { ...base, externalUrl: s.externalUrl, kind: "external" };
  return null;
}
// rank: playable HTTP first, then debrid, then external; within a tier by intrinsic release score.
function rankCandidates(cands) {
  const tier = (c) => c.httpDirect ? 0 : c.needsDebrid ? 1 : 2;
  return cands.sort((a, b) => tier(a) - tier(b) || scoreRelease(b) - scoreRelease(a));
}

const yearOf = (m) => { const s = m.releaseInfo || m.year || m.released || ""; const y = String(s).match(/\d{4}/); return y ? +y[0] : null; };
// a Stremio meta → the one item shape (TMDb enriches later by imdb/tmdb id).
function normalizeMeta(m, base) {
  const isTv = m.type === "series";
  const raw = { id: /^\d+$/.test(String(m.id)) ? m.id : 0, title: m.name, name: m.name, overview: m.description || "",
    poster_path: null, backdrop_path: null, vote_average: m.imdbRating ? +m.imdbRating : null,
    release_date: isTv ? "" : (m.released || ""), first_air_date: isTv ? (m.released || "") : "", genre_ids: [] };
  const it = isTv ? normalizeSeries(raw) : normalizeMovie(raw);
  it.id = "stremio:" + (m.id || (base + ":" + m.name)); it.name = m.name || "Untitled"; it.year = yearOf(m);
  it.posterUrl = m.poster || null; it.backdrop = m.background || m.poster || null; it.overview = m.description || ""; it.blurb = m.description || "";
  it.genres = m.genres || []; if (Array.isArray(m.genres)) it.topics = m.genres.map((g) => String(g).toLowerCase());
  it.imdbId = /^tt\d+/.test(String(m.id)) ? String(m.id).split(":")[0] : null;
  it._stremioId = m.id; it._stremioType = m.type || (isTv ? "series" : "movie");
  it.source = "tmdb"; it.provider = "stremio";   // wears the TMDb-shaped render path; provider tag = stremio
  return it;
}

export function createAddon({ base, fetch: f, cache } = {}) {
  base = normalizeBase(base);
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-stremio: fetch required");
  let _manifest = null, _name = base.replace(/^https?:\/\//, "");

  async function api(path) {
    const url = base + path;
    const fetcher = async () => { const r = await doFetch(url); if (!r.ok) throw new Error("stremio " + r.status + " " + path); return r.json(); };
    if (!cache) return fetcher();
    const { body } = await cache.through("stremio|" + url, fetcher);
    return body;
  }
  async function manifest() { if (!_manifest) { _manifest = await api("/manifest.json"); _name = _manifest.name || _name; } return _manifest; }
  const extraStr = (extra = {}) => Object.entries(extra).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

  const provider = {
    id: "stremio:" + base, get name() { return _name; }, kind: "addon", enabled: true, trust: 5,
    async catalogs() {
      const m = await manifest();
      const cats = m.catalogs || [];
      // Addons (e.g. Cinemeta) often repeat a display name across movie + series ("Popular" twice). Disambiguate
      // ONLY the colliding names with "Movies"/"Shows", so the wall never shows two identically-titled shelves.
      const seen = {}; for (const c of cats) { const n = c.name || c.id; seen[n] = (seen[n] || 0) + 1; }
      return cats.map((c) => {
        let n = c.name || c.id;
        if (seen[n] > 1) n += c.type === "series" ? " Shows" : c.type === "movie" ? " Movies" : "";
        return { id: c.type + "::" + c.id, type: c.type, name: n + " · " + _name, _extra: c.extra };
      });
    },
    async browse(catalogId, opts = {}) {
      const [type, id] = String(catalogId).split("::");
      const ex = extraStr({ search: opts.search, skip: opts.skip, genre: opts.genre });
      const data = await api(`/catalog/${type}/${encodeURIComponent(id)}${ex ? "/" + ex : ""}.json`);
      // does this addon even offer streams? (Cinemeta is metadata-only → its titles play the trailer.)
      const noStream = _manifest ? !(_manifest.resources || []).some((r) => (r.name || r) === "stream") : false;
      return (data.metas || []).map((m) => { const it = normalizeMeta(m, base); it._noStream = noStream; return it; });
    },
    // official YouTube trailer id for a title (Cinemeta/most catalog addons carry it in meta) — the
    // universal, COEP-safe, instant-HD fallback when there's no owned/file stream.
    async trailer(item) {
      const type = item._stremioType || (item.kind === "series" ? "series" : "movie");
      const id = item._stremioId || item.imdbId; if (!id) return null;
      try { const m = await provider.meta(type, id); return (m.trailerStreams && m.trailerStreams[0] && m.trailerStreams[0].ytId) || (m.trailers && m.trailers[0] && m.trailers[0].source) || null; } catch { return null; }
    },
    async search(q) {
      const m = await manifest();
      const c = (m.catalogs || []).find((x) => (x.extra || []).some((e) => e.name === "search")) || (m.catalogs || [])[0];
      return c ? provider.browse(c.type + "::" + c.id, { search: q }) : [];
    },
    // Stremio ids carry literal colons (tt…:S:E) — encode spaces only, never the separators.
    async meta(type, id) { return (await api(`/meta/${type}/${encodeURI(id)}.json`)).meta; },
    async streams(type, id) { return (await api(`/stream/${type}/${encodeURI(id)}.json`)).streams || []; },
    async resolve(item) {
      const type = item._stremioType || (item.kind === "series" ? "series" : "movie");
      let id = item._stremioId || item.imdbId; if (!id) return [];
      if (type === "series" && item.seasonNumber && !/:\d+:\d+$/.test(String(id))) id = `${id}:${item.seasonNumber}:${item.episodeNumber || 1}`;
      const streams = await provider.streams(type, id);
      return rankCandidates(streams.map((s) => toCandidate(s, { resolver: _name, kind: "addon", label: "Addon · " + _name })).filter(Boolean));
    },
  };
  return provider;
}

export default { createAddon, normalizeBase, parseQuality, parseRelease, scoreRelease };
if (typeof window !== "undefined") window.HoloStremio = { createAddon, normalizeBase, parseRelease, scoreRelease };
