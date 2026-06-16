// holo-media.mjs — the omnibar's MEDIA lane. Turn a media address into a playable, κ-anchored source for the
// streaming player. Two honest cases:
//   • DIRECT media (a .mp4/.webm/.mp3/… at a κ-route, an IPFS path, or a plain URL) → playable NOW, seekable by
//     the κ-store's existing HTTP Range/206 support (no MediaSource needed — a native <video>/<audio> element
//     issues range requests itself). κ-routes (/.holo/…, ipfs://…) are re-derived on the wire (Law L5).
//   • PLATFORM media (YouTube · Vimeo · Twitch · SoundCloud · Spotify) → needs stream EXTRACTION. There is no
//     in-tab yt-dlp yet, so by default we DON'T fake a stream — we report playable:false + fallback:"browser"
//     (open the real page, which plays natively). The `extractor` hook is the seam where a future κ-sealed
//     extractor (a Forge transform / governed-egress endpoint) plugs in; when present and it returns a src,
//     the same player path lights up. Honesty over a fake green (Law L5).
// Pure ESM, no DOM — Node-witnessable. The shell imports classifyMedia/resolveMediaSource/mediaMime.

const MEDIA_EXT = {
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", ogv: "video/ogg",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/opus",
};
const PLATFORM = [
  { re: /(?:youtube\.com\/(?:watch\?|shorts\/|embed\/|live\/)|youtu\.be\/)/i, name: "YouTube" },
  { re: /vimeo\.com\/\d/i, name: "Vimeo" },
  { re: /(?:twitch\.tv\/(?:videos\/|\w))/i, name: "Twitch" },
  { re: /soundcloud\.com\/[\w-]+\/[\w-]/i, name: "SoundCloud" },
  { re: /open\.spotify\.com\/(?:track|album|playlist|episode)\//i, name: "Spotify" },
];

// mediaMime(name) → "video/mp4" | "audio/mpeg" | … | null, from the extension.
export function mediaMime(name) {
  const e = (String(name || "").split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1];
  return e ? (MEDIA_EXT[e.toLowerCase()] || null) : null;
}

// classifyMedia(input) → { isMedia, kind: "file"|"platform"|"none", mime?, media?, platform?, label }.
//   "file" requires a media extension AND a URL/path shape (a bare "movie.mp4" is a search term / local
//   filename, handled by the local-files lane → which re-enters here with the κ-route once located).
export function classifyMedia(input) {
  const s = String(input || "").trim();
  if (!s) return { isMedia: false, kind: "none" };
  for (const p of PLATFORM) if (p.re.test(s)) return { isMedia: true, kind: "platform", platform: p.name, label: p.name + " · media" };
  const mime = mediaMime(s);
  const looksAddr = /^(https?:|ipfs:|blob:|\/|\.\/)/i.test(s) || /^did:holo:/i.test(s) || s.includes("/");
  if (mime && looksAddr) {
    const media = mime.startsWith("audio") ? "audio" : "video";
    return { isMedia: true, kind: "file", mime, media, label: media + " · " + mime.split("/")[1] };
  }
  return { isMedia: false, kind: "none" };
}

import { getDefaultExtractor } from "./holo-media-extract.mjs";   // the yt-dlp seam: a governed, opt-in extraction tier (default null → honest browser fallback)

const isVerifiedRoute = (s) => /^did:holo:/i.test(s) || /^\/\.holo\//.test(s) || /^ipfs:/i.test(s) || /^\/ipfs\//.test(s);

// resolveMediaSource(input, opts) → a uniform player envelope:
//   { playable, kind, src?, mime?, media?, title?, verified?, platform?, reason?, fallback? }
// opts: { title, mime, extractor }  — extractor(input) → { src, mime?, media?, title?, verified? } | null
//   is the yt-dlp seam (async). Absent → platform stays honestly unplayable with a browser fallback.
export async function resolveMediaSource(input, { title, mime, extractor } = {}) {
  const c = classifyMedia(input);
  if (c.kind === "file") {
    return { playable: true, kind: "file", src: input, mime: mime || c.mime, media: c.media, title: title || null, verified: isVerifiedRoute(input) };
  }
  if (c.kind === "platform") {
    const ex = (typeof extractor === "function") ? extractor : getDefaultExtractor();   // per-call hook, else the opt-in default tier
    if (typeof ex === "function") {
      try { const x = await ex(input); if (x && x.src) return { playable: true, kind: "platform", platform: c.platform, src: x.src, mime: x.mime || "video/mp4", media: x.media || "video", title: x.title || title || c.platform, verified: !!x.verified, via: x.via, receipt: x.receipt }; } catch { /* extractor failed → fall through to the honest fallback */ }
    }
    return { playable: false, kind: "platform", platform: c.platform, reason: "in-tab stream extraction isn't available (yt-dlp can't run in a tab) — open a trusted extractor in settings, or play the page faithfully", fallback: "browser", title: title || c.platform };
  }
  return { playable: false, kind: "none", reason: "not a recognised media address" };
}

export default { mediaMime, classifyMedia, resolveMediaSource };
