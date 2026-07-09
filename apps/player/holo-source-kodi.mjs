// holo-source-kodi.mjs — a Kodi media center as a SourceProvider via its JSON-RPC HTTP API.
// VideoLibrary.GetMovies / .GetTVShows → items; the item's `file` plays via Kodi's vfs URL.
// auth: optional Basic (user:password). injected fetch → Node-witnessable.

export function createKodiProvider({ base, user, password, name, fetch: f, cache } = {}) {
  base = String(base || "").replace(/\/+$/, "");
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-source-kodi: fetch required");
  const label = name || base.replace(/^https?:\/\//, "");
  const authHdr = user ? { Authorization: "Basic " + (typeof btoa !== "undefined" ? btoa(`${user}:${password || ""}`) : Buffer.from(`${user}:${password || ""}`).toString("base64")) } : {};

  async function rpc(method, params) {
    const url = base + "/jsonrpc";
    const go = async () => { const r = await doFetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...authHdr }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); if (!r.ok) throw new Error("kodi " + r.status); return r.json(); };
    if (!cache) return (await go()).result;
    const { body } = await cache.through("kodi|" + method + "|" + JSON.stringify(params || {}), go);
    return body.result;
  }
  const vfs = (file) => `${base}/vfs/${encodeURIComponent(file)}`;
  const normMovie = (m) => ({ id: "kodi:m:" + m.movieid, _file: m.file, kind: "movie", name: m.label || m.title || "Untitled", year: m.year || null, overview: m.plot || "", blurb: m.plot || "", posterUrl: m.thumbnail ? `${base}/image/${encodeURIComponent(m.thumbnail)}` : null, backdrop: m.fanart ? `${base}/image/${encodeURIComponent(m.fanart)}` : null, runtimeSec: m.runtime || 0, rating: typeof m.rating === "number" ? m.rating : null, genres: m.genre || [], topics: (m.genre || []).map((g) => String(g).toLowerCase()), channel: label, quality: 0.75, license: "", source: "tmdb", provider: "kodi", kappa: "", holoKappa: "kodi:m:" + m.movieid, availability: { playable: false, source: null, kappa: "", playSrc: "", type: "" } });
  const normShow = (s) => ({ ...normMovie({ ...s, movieid: "tv" + s.tvshowid }), id: "kodi:s:" + s.tvshowid, kind: "series", _file: null });
  const provider = {
    id: "kodi:" + base, name: label, kind: "kodi", enabled: true, trust: 2,
    async catalogs() { return [{ id: "movies", type: "movie", name: "Movies · " + label }, { id: "shows", type: "series", name: "Shows · " + label }]; },
    async browse(catalogId) {
      if (catalogId === "shows") { const r = await rpc("VideoLibrary.GetTVShows", { properties: ["title", "year", "plot", "thumbnail", "fanart", "genre", "rating"], limits: { end: 48 } }); return ((r && r.tvshows) || []).map(normShow); }
      const r = await rpc("VideoLibrary.GetMovies", { properties: ["title", "year", "plot", "thumbnail", "fanart", "genre", "rating", "runtime", "file"], limits: { end: 48 } });
      return ((r && r.movies) || []).map(normMovie);
    },
    async search(q) { const items = await provider.browse("movies"); return items.filter((x) => x.name.toLowerCase().includes(String(q).toLowerCase())); },
    async resolve(item) { if (!item._file) return []; return [{ playSrc: vfs(item._file), type: "video/mp4", kind: "kodi", httpDirect: true, quality: 1080, provenance: { resolver: label, kind: "kodi", label: "Kodi · " + label } }]; },
  };
  return provider;
}
export default { createKodiProvider };
if (typeof window !== "undefined") window.HoloSourceKodi = { createKodiProvider };
