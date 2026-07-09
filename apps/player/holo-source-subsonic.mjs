// holo-source-subsonic.mjs — a Subsonic/Navidrome/Airsonic server as a SourceProvider (its video library).
// Subsonic REST (f=json): getVideos → videos; stream?id= → direct stream; getCoverArt?id= → art.
// auth: token (t=md5(password+salt), s=salt) or plain p; injected fetch → Node-witnessable.

export function createSubsonicProvider({ base, user, token, salt, password, name, fetch: f, cache } = {}) {
  base = String(base || "").replace(/\/+$/, "");
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-source-subsonic: fetch required");
  const label = name || base.replace(/^https?:\/\//, "");
  const common = `u=${encodeURIComponent(user || "")}&${token ? `t=${token}&s=${salt}` : `p=${encodeURIComponent(password || "")}`}&v=1.16.1&c=HoloPlayer&f=json`;
  const ep = (view, params = "") => `${base}/rest/${view}.view?${common}${params ? "&" + params : ""}`;

  async function api(view, params) {
    const url = ep(view, params);
    const go = async () => { const r = await doFetch(url); if (!r.ok) throw new Error("subsonic " + r.status); return r.json(); };
    if (!cache) return go();
    const { body } = await cache.through("sub|" + url, go);
    return body;
  }
  const norm = (v) => ({
    id: "sub:" + v.id, _subId: v.id, kind: "movie", name: v.title || v.name || "Untitled", year: v.year || null,
    overview: "", blurb: "", posterUrl: v.coverArt ? ep("getCoverArt", "id=" + encodeURIComponent(v.coverArt)) : null,
    backdrop: v.coverArt ? ep("getCoverArt", "id=" + encodeURIComponent(v.coverArt)) : null,
    runtimeSec: v.duration || 0, rating: null, genres: v.genre ? [v.genre] : [], topics: v.genre ? [String(v.genre).toLowerCase()] : [],
    channel: label, quality: 0.7, license: "", source: "tmdb", provider: "subsonic", kappa: "", holoKappa: "sub:" + v.id,
    availability: { playable: false, source: null, kappa: "", playSrc: "", type: "" },
  });
  const provider = {
    id: "subsonic:" + base, name: label, kind: "subsonic", enabled: true, trust: 2,
    async catalogs() { return [{ id: "videos", type: "movie", name: "Videos · " + label }]; },
    async browse() { const d = await api("getVideos"); const vids = (d["subsonic-response"] && d["subsonic-response"].videos && d["subsonic-response"].videos.video) || []; return vids.map(norm); },
    async search(q) { const items = await provider.browse(); return items.filter((x) => x.name.toLowerCase().includes(String(q).toLowerCase())); },
    async resolve(item) { const id = item._subId || String(item.id).replace(/^sub:/, ""); return [{ playSrc: ep("stream", "id=" + encodeURIComponent(id)), type: "video/mp4", kind: "subsonic", httpDirect: true, quality: 720, provenance: { resolver: label, kind: "subsonic", label: "Subsonic · " + label } }]; },
  };
  return provider;
}
export default { createSubsonicProvider };
if (typeof window !== "undefined") window.HoloSourceSubsonic = { createSubsonicProvider };
