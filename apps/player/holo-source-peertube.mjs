// holo-source-peertube.mjs — a PeerTube instance as a SourceProvider via its open REST API (no key).
// /api/v1/videos → list; /api/v1/search/videos?search= → search; resolve → HLS playlist or best file URL.

export function createPeertubeProvider({ base, name, fetch: f, cache } = {}) {
  base = String(base || "").replace(/\/+$/, "");
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-source-peertube: fetch required");
  const label = name || base.replace(/^https?:\/\//, "");
  const abs = (p) => (p && /^https?:/.test(p)) ? p : base + (p || "");

  async function api(path) {
    const url = base + path;
    const go = async () => { const r = await doFetch(url); if (!r.ok) throw new Error("peertube " + r.status); return r.json(); };
    if (!cache) return go();
    const { body } = await cache.through("pt|" + url, go);
    return body;
  }
  const norm = (v) => ({
    id: "pt:" + (v.uuid || v.id), _pt: v, kind: "movie", name: v.name || "Untitled",
    year: v.publishedAt ? +String(v.publishedAt).slice(0, 4) : null, overview: v.description || "", blurb: v.description || "",
    posterUrl: abs(v.thumbnailPath), backdrop: abs(v.previewPath || v.thumbnailPath), runtimeSec: v.duration || 0,
    rating: null, genres: v.category && v.category.label ? [v.category.label] : [], topics: [],
    channel: label, quality: 0.7, license: "Open · PeerTube", source: "tmdb", provider: "peertube", kappa: "", holoKappa: "pt:" + (v.uuid || v.id),
    availability: { playable: false, source: null, kappa: "", playSrc: "", type: "" },
  });
  const provider = {
    id: "peertube:" + base, name: label, kind: "peertube", enabled: true, trust: 3,
    async catalogs() { return [{ id: "recent", type: "movie", name: "Recent · " + label }, { id: "trending", type: "movie", name: "Trending · " + label }]; },
    async browse(catalogId, opts = {}) {
      const d = await api(`/api/v1/videos?count=48&sort=${catalogId === "trending" ? "-trending" : "-publishedAt"}&nsfw=false`);
      return ((d && d.data) || []).map(norm);
    },
    async search(q) { const d = await api(`/api/v1/search/videos?search=${encodeURIComponent(q)}&count=48`); return ((d && d.data) || []).map(norm); },
    async resolve(item) {
      // prefer a full video object (browse carries it); else fetch details by uuid.
      let v = item._pt; if (!v) { try { v = await api(`/api/v1/videos/${String(item.id).replace(/^pt:/, "")}`); } catch { return []; } }
      const hls = (v.streamingPlaylists && v.streamingPlaylists[0] && v.streamingPlaylists[0].playlistUrl) || null;
      if (hls) return [{ playSrc: abs(hls), type: "application/x-mpegURL", kind: "peertube", httpDirect: true, quality: 1080, provenance: { resolver: label, kind: "peertube", label: "PeerTube · " + label } }];
      const files = (v.files || []).slice().sort((a, b) => ((b.resolution && b.resolution.id) || 0) - ((a.resolution && a.resolution.id) || 0));
      if (!files.length) return [];
      return [{ playSrc: abs(files[0].fileUrl || files[0].fileDownloadUrl), type: "video/mp4", kind: "peertube", httpDirect: true, quality: (files[0].resolution && files[0].resolution.id) || 720, provenance: { resolver: label, kind: "peertube", label: "PeerTube · " + label } }];
    },
  };
  return provider;
}
export default { createPeertubeProvider };
if (typeof window !== "undefined") window.HoloSourcePeertube = { createPeertubeProvider };
