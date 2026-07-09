// holo-source-plex.mjs — a Plex Media Server as a SourceProvider, so a user's Plex library joins the same
// wall as Jellyfin/Stremio/IA/RD under the one interface. Speaks the Plex HTTP API (X-Plex-Token, JSON via
// Accept header). fetch/cache injected → Node-witnessable with a fake server. (Plex direct-play URL =
// {base}{Part.key}?X-Plex-Token=…; thumbs need the token too.)
//
// meta: { base, token, name }  (the user's server URL + their X-Plex-Token).

export function createPlexProvider({ base, token, name, fetch: f, cache } = {}) {
  base = String(base || "").replace(/\/+$/, "");
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-source-plex: fetch required");
  const label = name || base.replace(/^https?:\/\//, "");
  const tok = (u) => u + (u.includes("?") ? "&" : "?") + "X-Plex-Token=" + encodeURIComponent(token);

  async function api(path) {
    const url = base + path;
    const go = async () => { const r = await doFetch(tok(url), { headers: { Accept: "application/json" } }); if (!r.ok) throw new Error("plex " + r.status); return r.json(); };
    if (!cache) return go();
    const { body } = await cache.through("plex|" + url, go);
    return body;
  }
  const META = "https://images.metahub.space";
  const img = (m) => m.thumb ? tok(base + m.thumb) : (m.art ? tok(base + m.art) : null);
  // the library's IMDb id (Plex Guid array with includeGuids=1, or the legacy agent guid) → consistent CDN art.
  const imdbOf = (m) => { const s = ((m.Guid || []).map((x) => x && x.id).join(" ")) + " " + (m.guid || ""); const mt = s.match(/tt\d{6,}/); return mt ? mt[0] : null; };
  const norm = (m) => {
    const imdb = imdbOf(m);
    const part = (m.Media && m.Media[0] && m.Media[0].Part && m.Media[0].Part[0] && m.Media[0].Part[0].key) || null;
    return {
      id: "plex:" + m.ratingKey, _plexKey: m.ratingKey, _part: part,
      // direct-play URL on the item too, so it's instantly "ready" + can cross-bind to a metadata title (your own server).
      playSrc: part ? tok(base + part) : null, type: part ? "video/mp4" : "",
      kind: m.type === "show" ? "series" : "movie", name: m.title || "Untitled", year: m.year || null, overview: m.summary || "", blurb: m.summary || "",
      posterUrl: (imdb ? `${META}/poster/large/${imdb}/img` : null) || img(m), backdrop: (imdb ? `${META}/background/large/${imdb}/img` : null) || (m.art ? tok(base + m.art) : img(m)),
      runtimeSec: m.duration ? Math.round(m.duration / 1000) : 0, imdbId: imdb,
      rating: typeof m.rating === "number" ? m.rating : null, genres: (m.Genre || []).map((g) => g.tag), topics: (m.Genre || []).map((g) => String(g.tag).toLowerCase()),
      channel: label, quality: m.rating ? Math.min(1, m.rating / 10) : 0.75, license: "",
      source: "tmdb", provider: "plex", kappa: "", holoKappa: "plex:" + m.ratingKey, availability: { playable: false, source: null, kappa: "", playSrc: "", type: "" },
    };
  };

  const provider = {
    id: "plex:" + base, name: label, kind: "plex", enabled: true, trust: 2,
    async catalogs() {
      const d = await api("/library/sections");
      const dirs = (d.MediaContainer && d.MediaContainer.Directory) || [];
      return dirs.filter((s) => s.type === "movie" || s.type === "show").map((s) => ({ id: s.key, type: s.type === "show" ? "series" : "movie", name: s.title + " · " + label }));
    },
    async browse(catalogId, opts = {}) {
      const d = await api(`/library/sections/${encodeURIComponent(catalogId)}/all?includeGuids=1${opts.search ? "&title=" + encodeURIComponent(opts.search) : ""}`);
      return ((d.MediaContainer && d.MediaContainer.Metadata) || []).map(norm);
    },
    async search(q) {
      const d = await api(`/search?query=${encodeURIComponent(q)}`);
      return ((d.MediaContainer && d.MediaContainer.Metadata) || []).filter((m) => m.type === "movie" || m.type === "show").map(norm);
    },
    async resolve(item) {
      const part = item._part; if (!part) return [];
      // Direct play — the ORIGINAL file straight from the server: max quality, no transcode, instant start.
      return [{ playSrc: tok(base + part), type: "video/mp4", kind: "plex", httpDirect: true, quality: 2160,
        provenance: { resolver: label, kind: "plex", label: "Plex · " + label + " · Direct" } }];
    },
    // Server-side progress — Plex timeline so resume + on-deck sync on the server (start|progress→playing, pause, stop).
    async report(action, item, posSec, durSec) {
      const key = item._plexKey; if (!key) return;
      const state = action === "stop" ? "stopped" : action === "pause" ? "paused" : "playing";
      const url = tok(`${base}/:/timeline?ratingKey=${encodeURIComponent(key)}&key=${encodeURIComponent("/library/metadata/" + key)}&state=${state}&time=${Math.round((posSec || 0) * 1000)}&duration=${Math.round((durSec || item.runtimeSec || 0) * 1000)}`);
      try { await doFetch(url, { headers: { Accept: "application/json" } }); } catch {}
    },
  };
  return provider;
}

export default { createPlexProvider };
if (typeof window !== "undefined") window.HoloSourcePlex = { createPlexProvider };
