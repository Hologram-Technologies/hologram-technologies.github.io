// holo-media-route.mjs — recognize a watchable video URL on ANY platform and route it through Holo
// Video (the one WebGPU sink) fed by /sc/vstream (yt-dlp, ~1000 sites). Pure + node-witnessable.
//
// Why: this CEF build decodes VP9/AV1/Opus but NOT H.264/AAC, so a platform's own MSE player shows
// "can't play" (the screenshot). /sc/vstream resolves the same video to VP9/Opus and PROVABLY plays
// it; Holo Video projects it with super-resolution. This module is the decision core the browser app
// uses to turn a recognized watch URL into that same-origin projector route — generalizing the
// YouTube shim ([[holo-youtube]]) to any platform.
//
// Proven facts (do not relearn):
//   - /sc/vstream's key is url=<full page URL> (encoded), NOT a per-platform id (yt-dlp takes the page).
//   - yt-dlp resolves ~1000 sites from the page URL, so for most platforms `canonical` IS the href;
//     only YouTube is normalised to watch?v=<id> to fold its many shapes onto one cache key.
//   - Project via the SAME-ORIGIN holo:// page (../video/index.html?src=holo://os/sc/vstream…); never
//     inject a holo:// <video> into the https platform page (cross-scheme err:4, measured).

import { isYouTubeHost, extractVideoId, canonicalWatchUrl, classifyPlayability } from "./holo-youtube.mjs";

// Per-platform recognizers: (URL) → { id, canonical } | null. Host-anchored so look-alikes
// (attacker-youtube.com, youtube.com.evil.com) never match. Recognizers are deliberately TIGHT
// (clear watch-page shapes only) so we never hijack a non-video page. Extensible: add one entry.
const PLATFORMS = [
  { name: "youtube", match(u) {
      if (!isYouTubeHost(u.hostname)) return null;
      const id = extractVideoId(u.href);
      return id ? { id, canonical: canonicalWatchUrl(id) } : null;
    } },
  { name: "vimeo", match(u) {
      if (!/(^|\.)vimeo\.com$/.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/video\/(\d+)/) || u.pathname.match(/^\/(\d{6,})(?:\/[0-9a-z]+)?\/?$/i);
      return m ? { id: m[1], canonical: "https://vimeo.com/" + m[1] } : null;
    } },
  { name: "twitch", match(u) {
      if (/(^|\.)clips\.twitch\.tv$/.test(u.hostname)) { const s = u.pathname.slice(1).split("/")[0]; return s ? { id: s, canonical: u.href } : null; }
      if (!/(^|\.)twitch\.tv$/.test(u.hostname)) return null;
      let m = u.pathname.match(/^\/videos\/(\d+)/);
      if (m) return { id: m[1], canonical: "https://www.twitch.tv/videos/" + m[1] };
      m = u.pathname.match(/^\/[^/]+\/clip\/([^/?#]+)/);
      return m ? { id: m[1], canonical: u.href } : null;
    } },
  { name: "dailymotion", match(u) {
      if (u.hostname === "dai.ly") { const id = u.pathname.slice(1).split("/")[0]; return id ? { id, canonical: "https://dai.ly/" + id } : null; }
      if (!/(^|\.)dailymotion\.com$/.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/video\/([^/?#_]+)/);
      return m ? { id: m[1], canonical: "https://www.dailymotion.com/video/" + m[1] } : null;
    } },
  { name: "archive", match(u) {
      if (!/(^|\.)archive\.org$/.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/details\/([^/?#]+)/);
      return m ? { id: m[1], canonical: "https://archive.org/details/" + m[1] } : null;
    } },
];

// classifyMedia(href) → { platform, id, canonical, url } | null. Side-effect-free shape classifier:
// an agent (or the browser) can ask "is this a playable watch page, and how?" before acting.
export function classifyMedia(href) {
  let u; try { u = new URL(href); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  for (const p of PLATFORMS) { const r = p.match(u); if (r) return { platform: p.name, id: r.id, canonical: r.canonical, url: href }; }
  return null;
}

// Build the proven /sc/vstream route. The key is url=<encoded full page URL> (NOT v=<id>).
export function buildVstreamSrc(canonicalUrl, h = 1080, base = "holo://os/sc/vstream") {
  return base + "?url=" + encodeURIComponent(canonicalUrl) + "&h=" + h;
}

// The same-origin Holo Video projector route. The video app reads ?src= (and ?type=, ?gpu=, ?sr=,
// ?grade=, ?maxdpr=). Default base is relative to the browser app (../video/index.html); resolved against
// holo://os/apps/browser/index.html → holo://os/apps/video/index.html (same origin).
//
// Defaults: gpu=1 + sr=1 — the full immersive layer (Lanczos super-resolution + ACES grade + holographic FX +
// zero-copy importExternalTexture). sr=1 (Lanczos) can hard-crash the Dawn/D3D12 backend on some GPUs, so the
// video app applies a PER-GPU self-healing gate (holo.sr.* localStorage): a crashy GPU auto-falls back to sr=0
// after exactly one crash, remembered. So sr=1 is the optimistic default and stays safe — see holo-gpu.js / the
// video app initGpu gate. Callers can still force sr:0.
export function holoVideoRoute(canonicalUrl, { h = 1080, base = "../video/index.html", gpu = 1, sr = 1, grade = 0.4 } = {}) {
  const src = buildVstreamSrc(canonicalUrl, h);
  const q = new URLSearchParams({ gpu: String(gpu), sr: String(sr), grade: String(grade), type: "video/webm", src });
  return base + "?" + q.toString();
}

// Top-level decision for the browser. Given an href (+ optional YouTube playabilityStatus when known),
// return { platform, id, canonical, url, route } or null (no-op → page loads normally). Fail-open:
// only YouTube exposes a pre-checkable gate; everything else is "try it" and the projector's own
// onerror degrades to the platform's player (never below it).
export function decideMediaRoute(href, { playable = null, h = 1080, base } = {}) {
  const m = classifyMedia(href);
  if (!m) return null;
  if (m.platform === "youtube" && playable && !classifyPlayability(playable).swap) return null;
  return { ...m, route: holoVideoRoute(m.canonical, base ? { h, base } : { h }) };
}

export const SUPPORTED_PLATFORMS = PLATFORMS.map((p) => p.name);

if (typeof window !== "undefined") window.HoloMediaRoute = { classifyMedia, buildVstreamSrc, holoVideoRoute, decideMediaRoute, SUPPORTED_PLATFORMS };
export default { classifyMedia, buildVstreamSrc, holoVideoRoute, decideMediaRoute, SUPPORTED_PLATFORMS };
