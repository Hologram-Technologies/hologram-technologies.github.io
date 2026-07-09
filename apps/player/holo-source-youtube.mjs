// holo-source-youtube.mjs — a YouTube channel/playlist as a SourceProvider, KEYLESS via the public RSS
// feed (no API key): feeds/videos.xml?channel_id=… (or ?playlist_id=…). resolve → a youtube-nocookie embed
// (the iframe path, COEP-safe). Light XML parse; injected fetch → Node-witnessable.

export function parseYouTubeFeed(xml) {
  const out = [];
  const entries = String(xml || "").split(/<entry>/).slice(1);
  for (const e of entries) {
    const vid = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    if (!vid) continue;
    const title = (e.match(/<title>([^<]*)<\/title>/) || [])[1] || "Untitled";
    const thumb = (e.match(/<media:thumbnail\s+url="([^"]+)"/) || [])[1] || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
    const pub = (e.match(/<published>([^<]+)<\/published>/) || [])[1] || "";
    out.push({ vid, title, thumb, year: pub ? +pub.slice(0, 4) : null });
  }
  return out;
}

export function createYouTubeProvider({ channelId, playlistId, name, fetch: f, cache } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-source-youtube: fetch required");
  const feed = channelId ? `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}` : `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
  const label = name || (channelId ? "YouTube channel" : "YouTube playlist");
  let vids = null;
  async function load() {
    if (vids) return vids;
    const go = async () => { const r = await doFetch(feed); if (!r.ok) throw new Error("yt " + r.status); return r.text(); };
    const xml = cache ? (await cache.through("yt|" + feed, go)).body : await go();
    vids = parseYouTubeFeed(xml);
    return vids;
  }
  const embed = (vid) => `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0&modestbranding=1`;
  // Native κ-stream the engine can decode (VP9/Opus via /sc/vstream), copy-muxed to a seekable WebM, projected
  // through Holo Video (WebGPU super-res). NOT the youtube-nocookie MSE embed (this codec build can't feed it →
  // "sound but no video"). embed kept as embedFallback for DRM/age/login that yt-dlp can't resolve.
  const vstream = (vid, h = 1080) => "holo://os/sc/vstream?url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + vid) + "&h=" + h;
  const norm = (v) => ({
    id: "yt:" + v.vid, _yt: v.vid, kind: "movie", name: v.title, year: v.year, overview: "", blurb: "",
    posterUrl: v.thumb, backdrop: `https://i.ytimg.com/vi/${v.vid}/maxresdefault.jpg`, runtimeSec: 0, rating: null, genres: [], topics: [],
    channel: label, quality: 0.7, license: "", source: "open", provider: "youtube", kappa: "", holoKappa: "yt:" + v.vid,
    src: vstream(v.vid), playSrc: vstream(v.vid), type: "video/webm", embedFallback: embed(v.vid),
    availability: { playable: true, source: "open", kappa: "", playSrc: vstream(v.vid), type: "video/webm" },
  });
  const provider = {
    id: "youtube:" + (channelId || playlistId), name: label, kind: "youtube", enabled: true, trust: 4,
    async catalogs() { return [{ id: "feed", type: "movie", name: label }]; },
    async browse() { return (await load()).map(norm); },
    async search(q) { return (await load()).map(norm).filter((x) => x.name.toLowerCase().includes(String(q).toLowerCase())); },
    async resolve(item) { const vid = item._yt || String(item.id).replace(/^yt:/, ""); return [{ src: vstream(vid), playSrc: vstream(vid), type: "video/webm", kind: "native", quality: 1080, embedFallback: embed(vid), provenance: { resolver: label, kind: "youtube", label: "YouTube · " + label } }]; },
  };
  return provider;
}
export default { createYouTubeProvider, parseYouTubeFeed };
if (typeof window !== "undefined") window.HoloSourceYouTube = { createYouTubeProvider, parseYouTubeFeed };
