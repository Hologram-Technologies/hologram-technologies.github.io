// holo-opensubtitles.mjs — subtitles for any title via the open OpenSubtitles (Stremio) addon, KEY-FREE.
// Lists tracks by IMDb id (movie, or series as imdb:S:E), fetches the chosen .srt, and the player hands the
// canonical WebVTT to Holo Video's <track>. No key, no login — the addon proxies and serves plain SRT.
//
// Stremio subtitles protocol: GET {base}/subtitles/{type}/{id}.json → { subtitles:[{ id, url, lang }] }.
// fetch injected → Node-witnessable with a fake addon.

const OS_ADDON = "https://opensubtitles-v3.strem.io";

export function createOpenSubtitles({ base = OS_ADDON, fetch: f } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-opensubtitles: fetch required");
  base = String(base).replace(/\/+$/, "");
  return {
    // list(item) → [{ id, lang, url }] subtitle tracks for the title (by IMDb id; series → imdb:S:E).
    async list(item) {
      const type = (item.kind === "series" || item._stremioType === "series") ? "series" : "movie";
      let id = (/^tt\d+/.test(String(item.imdbId || "")) && item.imdbId) || (/^tt\d+/.test(String(item._stremioId || "")) ? item._stremioId : null);
      if (!id) return [];
      if (type === "series" && item.seasonNumber && !/:\d+:\d+$/.test(String(id))) id = `${id}:${item.seasonNumber}:${item.episodeNumber || 1}`;
      let data; try { data = await (await doFetch(`${base}/subtitles/${type}/${encodeURIComponent(id)}.json`)).json(); } catch { return []; }
      return ((data && data.subtitles) || []).filter((s) => s && s.url).map((s) => ({ id: s.id, lang: String(s.lang || "en"), url: s.url }));
    },
    // fetchVtt(track, toVTT) → a WebVTT string (SRT auto-converted). One fetch; the player caches it on the track.
    async fetchVtt(track, toVTT) {
      const text = await (await doFetch(track.url)).text();
      return /^WEBVTT/.test(String(text).trim()) ? text : toVTT(text);
    },
  };
}

// Keep one track per language, ordered by the viewer's preference (browser language → English → the rest).
export function preferLangs(tracks, browserLang) {
  const lc = (s) => String(s || "").slice(0, 2).toLowerCase();
  const pref = [lc(browserLang || "en"), "en"];
  const byLang = new Map();
  for (const t of tracks) { const l = lc(t.lang); if (l && !byLang.has(l)) byLang.set(l, { ...t, lang: l }); }
  const out = [];
  for (const l of pref) if (byLang.has(l)) { out.push(byLang.get(l)); byLang.delete(l); }
  for (const t of byLang.values()) out.push(t);
  return out;
}

export default { createOpenSubtitles, preferLangs };
if (typeof window !== "undefined") window.HoloOpenSubtitles = { createOpenSubtitles, preferLangs };
