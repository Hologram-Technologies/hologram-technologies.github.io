// holo-clear-resolver.mjs — the canonical CLEAR-WEB resolver: any pasted/opened http(s) URL → a κ-addressable
// play item (no DOM, witness-testable). YouTube, Vimeo, and ANY yt-dlp-supported page (Twitch, Dailymotion,
// PeerTube, Internet Archive, ~1000 sites) resolve through holo://os/sc/vstream (VP9/Opus → seekable WebM) and
// project through Holo Video (the WebGPU super-res surface) — NOT a platform MSE embed this codec build can't
// feed. A direct media file plays straight. `embedFallback` covers a resolve failure (DRM/geo/login).

export const YT = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/;
export const VIM = /vimeo\.com\/(?:video\/)?(\d+)/;
export const MED = /\.(mp4|webm|m3u8|mpd|mov|mkv)(\?|#|$)/i;

// The one route: hand any page URL to the native clear resolver. The engine yt-dlp-resolves + copy-muxes it.
export const vstream = (pageUrl, h = 1080) => "holo://os/sc/vstream?url=" + encodeURIComponent(pageUrl) + "&h=" + h;

// Classify any URL into a play item descriptor. Returns null for non-http(s).
export function classifyClearUrl(url, h = 1080) {
  if (!/^https?:\/\//i.test(url)) return null;
  const base = { page: url, source: "open", topics: [], kappa: "", posterUrl: null };
  let m = url.match(YT);
  if (m) {
    const src = vstream("https://www.youtube.com/watch?v=" + m[1], h);
    return { ...base, id: "live:yt:" + m[1], name: "YouTube video", kind: "stream", provider: "youtube",
      src, playSrc: src, type: "video/webm", posterUrl: `https://i.ytimg.com/vi/${m[1]}/maxresdefault.jpg`,
      embedFallback: `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&rel=0` };
  }
  m = url.match(VIM);
  if (m) {
    const src = vstream(url, h);
    return { ...base, id: "live:vim:" + m[1], name: "Vimeo video", kind: "stream", provider: "vimeo",
      src, playSrc: src, type: "video/webm", embedFallback: `https://player.vimeo.com/video/${m[1]}?autoplay=1` };
  }
  if (MED.test(url)) {
    // A direct media file is already the bytes — play it straight (no resolve); type inferred from the extension.
    const ext = url.split(".").pop().split(/[?#]/)[0];
    return { ...base, id: "live:url:" + url, name: url.split("/").pop().split("?")[0] || "Stream",
      kind: "stream", provider: ext, src: url, playSrc: url, type: "", direct: true };
  }
  // Any other http(s) page → the canonical clear resolver (yt-dlp, ~1000 sites). embedFallback = the page itself.
  const src = vstream(url, h);
  const host = url.replace(/^https?:\/\//i, "").split("/")[0];
  return { ...base, id: "live:web:" + url, name: host || "Stream", kind: "stream", provider: "clear-web",
    src, playSrc: src, type: "video/webm", embedFallback: url };
}

export default { classifyClearUrl, vstream, YT, VIM, MED };
if (typeof window !== "undefined") window.HoloClearResolver = { classifyClearUrl, vstream };
