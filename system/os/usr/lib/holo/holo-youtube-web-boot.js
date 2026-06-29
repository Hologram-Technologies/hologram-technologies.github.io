// holo-youtube-web-boot.js — the DOM shim entry. Self-gates to YouTube; swaps the dead MSE player for a native
// <video> fed by holo://os/sc/vstream (VP9/Opus, engine-decodable). Imported deps are esbuild-inlined into
// src/youtube_bundle.h (kHoloYoutubeBundle); app.cc host-executes the IIFE into every real web page's MAIN WORLD,
// which BYPASSES the page CSP for SCRIPT execution. The MEDIA load still needs CSP_BYPASSING on the holo scheme
// (app.cc) so the <video src=holo://…> is not blocked by YouTube's media-src — see the Phase 1 prompt.
//
// Fail-open everywhere: login/DRM/age/region → leave YouTube's player untouched; a resolve error → restore it.

import { isYouTubeHost, decideSwap } from "./holo-youtube.mjs";

(() => {
  if (!isYouTubeHost(location.hostname)) return; // inert off-YouTube (injected on every page, like the messenger capture)
  const QUALITY = 1080;
  const MARK = "data-holo-swapped";

  const playerHost = () =>
    document.querySelector("#movie_player") || document.querySelector(".html5-video-player");
  const posterUrl = (id) => "https://i.ytimg.com/vi/" + id + "/maxresdefault.jpg";

  function restore(host, ytv) { // fail-open: bring YouTube's own player back
    const v = document.getElementById("holo-yt-video"); if (v) v.remove();
    if (ytv) ytv.style.display = "";
    if (host) host.removeAttribute(MARK);
  }

  function swap() {
    const host = playerHost();
    if (!host || host.getAttribute(MARK) === "1") return;
    let ps = null;
    try { const pr = window.ytInitialPlayerResponse; if (pr && pr.playabilityStatus) ps = pr.playabilityStatus; } catch {}
    const d = decideSwap(location.href, location.hostname, ps, QUALITY);
    if (!d) return; // login / DRM / age / region / not-a-video → leave YouTube's player
    host.setAttribute(MARK, "1");
    const ytv = host.querySelector("video");
    if (ytv) { try { ytv.pause(); } catch {} ytv.muted = true; ytv.style.display = "none"; } // silence YT's track (no double audio)
    const v = document.createElement("video");
    v.id = "holo-yt-video";
    v.controls = true; v.autoplay = true; v.playsInline = true;
    v.poster = posterUrl(d.id); // no flash of broken: κ-cacheable thumb until the WebM head is ready
    v.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:60;background:#000";
    v.addEventListener("error", () => restore(host, ytv)); // resolve failed (DRM/network) → fail-open
    v.src = d.src;
    host.appendChild(v);
    if (v.play) v.play().catch(() => {});
  }

  // SPA navigation: the prior swap belonged to the prior video. Drop our marker and re-swap. ytInitialPlayerResponse
  // and #movie_player can lag the route event, so poll briefly until the swap lands (or the page isn't a video).
  function onRoute() {
    const host = playerHost();
    const old = document.getElementById("holo-yt-video"); if (old) old.remove();
    if (host) host.removeAttribute(MARK);
    let n = 0;
    const t = setInterval(() => {
      swap();
      const h = playerHost();
      if (++n > 20 || (h && h.getAttribute(MARK) === "1")) clearInterval(t);
    }, 300);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onRoute);
  else onRoute();
  window.addEventListener("yt-navigate-finish", onRoute); // YouTube SPA route change
  window.addEventListener("popstate", onRoute);
})();
