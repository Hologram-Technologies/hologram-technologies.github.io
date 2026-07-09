// holo-source-jellyfin.mjs — a linked Jellyfin/Emby server as a SourceProvider, so its WHOLE library shows
// up as browsable rails (Movies · Shows) and plays — federated + deduped with Stremio/IA/RD under the one
// interface. Speaks the documented Jellyfin REST API (the same holo-jellyfin.js uses); fetch/cache injected
// so Node witnesses it with a fake server. (Emby is API-compatible; Plex would be a sibling adapter.)
//
// meta: { base, token, userId, name }  (obtained once via AuthenticateByName; we hold the token, not the pw).

export function createJellyfinProvider({ base, token, userId, name, fetch: f, cache } = {}) {
  base = String(base || "").replace(/\/+$/, "");
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-source-jellyfin: fetch required");
  const authHeader = `MediaBrowser Client="Holo Player", Device="Hologram OS", DeviceId="holo-player", Version="1.0.0", Token="${token}"`;
  const label = name || base.replace(/^https?:\/\//, "");

  async function api(path) {
    const url = base + path;
    const go = async () => { const r = await doFetch(url, { headers: { "X-Emby-Authorization": authHeader } }); if (!r.ok) throw new Error("jellyfin " + r.status); return r.json(); };
    if (!cache) return go();
    const { body } = await cache.through("jf|" + url, go);
    return body;
  }
  const META = "https://images.metahub.space";
  const primary = (it) => (it.ImageTags && it.ImageTags.Primary) ? `${base}/Items/${it.Id}/Images/Primary?tag=${it.ImageTags.Primary}&api_key=${token}` : null;
  const backdrop = (it) => (it.BackdropImageTags && it.BackdropImageTags[0]) ? `${base}/Items/${it.Id}/Images/Backdrop?tag=${it.BackdropImageTags[0]}&api_key=${token}` : primary(it);
  const norm = (it) => {
    // Consistent, sharp, CDN-fast poster/backdrop via the library's IMDb id (matches the rest of the wall);
    // fall back to the server's own art when the id is unknown.
    const imdb = (it.ProviderIds && (it.ProviderIds.Imdb || it.ProviderIds.IMDB)) || null;
    return {
      id: "jf:" + it.Id, _jfId: it.Id, kind: it.Type === "Series" ? "series" : "movie", name: it.Name || "Untitled",
      year: it.ProductionYear || null, overview: it.Overview || "", blurb: it.Overview || "",
      posterUrl: (imdb ? `${META}/poster/large/${imdb}/img` : null) || primary(it),
      backdrop: (imdb ? `${META}/background/large/${imdb}/img` : null) || backdrop(it),
      runtimeSec: (it.RunTimeTicks || 0) / 1e7, imdbId: imdb,
      rating: typeof it.CommunityRating === "number" ? it.CommunityRating : null, genres: it.Genres || [], topics: (it.Genres || []).map((g) => String(g).toLowerCase()),
      channel: label, quality: it.CommunityRating ? Math.min(1, it.CommunityRating / 10) : 0.75, license: "",
      source: "tmdb", provider: "jellyfin", kappa: "", holoKappa: "jf:" + it.Id, availability: { playable: false, source: null, kappa: "", playSrc: "", type: "" },
    };
  };

  const provider = {
    id: "jellyfin:" + base, name: label, kind: "jellyfin", enabled: true, trust: 2,
    async catalogs() {
      return [
        { id: "Movie", type: "movie", name: "Movies · " + label },
        { id: "Series", type: "series", name: "Shows · " + label },
      ];
    },
    async browse(catalogId, opts = {}) {
      const type = catalogId === "Series" ? "Series" : "Movie";
      const q = `IncludeItemTypes=${type}&Recursive=true&Limit=48&Fields=Overview,ProductionYear,Genres,ProviderIds&ImageTypeLimit=1`
        + (opts.search ? `&SearchTerm=${encodeURIComponent(opts.search)}&SortBy=SortName` : "&SortBy=DateCreated,SortName&SortOrder=Descending");
      const d = await api(`/Users/${userId}/Items?${q}&api_key=${token}`);
      return (d.Items || []).map(norm);
    },
    async search(q) { return provider.browse("Movie", { search: q }); },
    async resolve(item) {
      const id = item._jfId || String(item.id).replace(/^jf:/, "");
      const direct = `${base}/Videos/${id}/stream?static=true&mediaSourceId=${id}&api_key=${token}`;
      // HLS fallback tuned for QUALITY: allow HEVC (HDR) + surround/Atmos passthrough + a high bitrate ceiling,
      // so even when the server must transcode the result is 4K/HDR/multichannel rather than a downscaled 1080p.
      const hls = `${base}/Videos/${id}/master.m3u8?api_key=${token}&MediaSourceId=${id}&VideoCodec=h264,hevc&AudioCodec=aac,ac3,eac3,truehd&MaxStreamingBitrate=160000000&TranscodingMaxAudioChannels=8&RequireAvc=false`;
      const prov = (l) => ({ resolver: label, kind: "jellyfin", label: l });
      return [
        // Direct play — the ORIGINAL file, untouched: max quality, NO server transcode, instant start. Holo Video
        // plays most containers; if its decoder can't, the player auto-falls back to the server HLS (embedFallback).
        { playSrc: direct, type: "video/mp4", kind: "jellyfin", httpDirect: true, quality: 2160, embedFallback: hls, provenance: prov("Server · " + label + " · Direct") },
        // Server HLS transcode — universal compatibility fallback (adaptive bitrate, any codec).
        { playSrc: hls, type: "application/x-mpegURL", kind: "jellyfin", httpDirect: true, quality: 1080, provenance: prov("Server · " + label + " · HLS") },
      ];
    },
    // Server-side progress — report playback so resume + watched sync on the server itself (start | progress | pause | stop).
    async report(action, item, posSec) {
      const id = item._jfId || String(item.id).replace(/^jf:/, "");
      const path = action === "start" ? "/Sessions/Playing" : action === "stop" ? "/Sessions/Playing/Stopped" : "/Sessions/Playing/Progress";
      const body = { ItemId: id, PositionTicks: Math.round((posSec || 0) * 1e7), IsPaused: action === "pause", PlayMethod: "DirectPlay", CanSeek: true };
      try { await doFetch(base + path, { method: "POST", headers: { "X-Emby-Authorization": authHeader, "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch {}
    },
  };
  return provider;
}

// Emby is API-compatible with Jellyfin → the same adapter, relabelled.
export function createEmbyProvider(opts = {}) { const p = createJellyfinProvider(opts); p.id = "emby:" + String(opts.base || "").replace(/\/+$/, ""); p.kind = "emby"; return p; }

export default { createJellyfinProvider, createEmbyProvider };
if (typeof window !== "undefined") window.HoloSourceJellyfin = { createJellyfinProvider, createEmbyProvider };
