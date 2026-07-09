// holo-jellyfin.js — Holo Player's data layer: ONE item shape, two sources.
//
// Adherence to the Jellyfin SPEC without its .NET server: the native library
// (player/library.json) is already emitted in Jellyfin's BaseItemDto shape by
// scan-library.mjs, and this module ALSO speaks Jellyfin's documented REST API
// (AuthenticateByName · /Items · /Videos/{id}/master.m3u8 · /Items/{id}/Images/Primary)
// so Holo Player doubles as a real Jellyfin client. Both sources normalize to the same
// render item; the native one is content-addressed (a κ that re-derives, Law L5), the
// remote one is location-addressed (a server URL) — honestly labelled.

(function () {
  "use strict";
  if (window.HoloJellyfin) return;

  // The X-Emby-Authorization header every Jellyfin request carries (client identity).
  const authHeader = (token) =>
    `MediaBrowser Client="Holo Player", Device="Hologram OS", DeviceId="holo-player", Version="1.0.0"` +
    (token ? `, Token="${token}"` : "");
  const headers = (token) => ({ "Content-Type": "application/json", "X-Emby-Authorization": authHeader(token) });

  const normNative = (it) => ({
    id: it.Id, name: it.Name, year: it.ProductionYear || null, overview: it.Overview || "",
    runtimeSec: (it.RunTimeTicks || 0) / 1e7,
    posterUrl: it.PosterPath || null,
    playSrc: it.HoloSources.hls, dashSrc: it.HoloSources.dash, playType: "application/x-mpegURL",
    kappa: it.HoloSources.masterKappa,     // verify: the master playlist re-derives to this (Law L5)
    holoKappa: it.HoloKappa,               // library identity + resume key
    source: "native",
  });

  const normServer = (it, base, token) => ({
    id: it.Id, name: it.Name, year: it.ProductionYear || null, overview: it.Overview || "",
    runtimeSec: (it.RunTimeTicks || 0) / 1e7,
    posterUrl: it.ImageTags && it.ImageTags.Primary
      ? `${base}/Items/${it.Id}/Images/Primary?tag=${it.ImageTags.Primary}&api_key=${token}` : null,
    // Jellyfin's transcode/direct HLS endpoint — Holo Video plays it like any HLS.
    playSrc: `${base}/Videos/${it.Id}/master.m3u8?api_key=${token}&MediaSourceId=${it.Id}`,
    dashSrc: `${base}/Videos/${it.Id}/manifest.mpd?api_key=${token}&MediaSourceId=${it.Id}`,
    playType: "application/x-mpegURL",
    kappa: "", holoKappa: "jf:" + it.Id, source: "jellyfin",
  });

  window.HoloJellyfin = {
    // The native κ-store library (default, content-addressed, serverless).
    async native(url = "player/library.json") {
      const lib = await (await fetch(url, { cache: "no-store" })).json();
      return { name: lib.ServerName || "Holo Player", source: "native", items: (lib.Items || []).map(normNative) };
    },
    // A real Jellyfin server via its REST API (optional). Returns the same item shape.
    async server(base, username, password) {
      base = String(base).replace(/\/+$/, "");
      const a = await (await fetch(base + "/Users/AuthenticateByName", {
        method: "POST", headers: headers(), body: JSON.stringify({ Username: username, Pw: password || "" }),
      })).json();
      const token = a.AccessToken, userId = a.User.Id;
      const q = "IncludeItemTypes=Movie,Episode,Video&Recursive=true&SortBy=SortName&Fields=Overview,ProductionYear,MediaSources";
      const data = await (await fetch(`${base}/Users/${userId}/Items?${q}&api_key=${token}`, { headers: headers(token) })).json();
      return { name: a.ServerName || base, source: "jellyfin", token, userId, items: (data.Items || []).map((it) => normServer(it, base, token)) };
    },
    // Tell a Jellyfin server where playback got to (Jellyfin resume; no-op natively).
    async reportProgress(base, token, itemId, positionTicks) {
      try { await fetch(`${base}/Sessions/Playing/Progress`, { method: "POST", headers: headers(token),
        body: JSON.stringify({ ItemId: itemId, PositionTicks: positionTicks }) }); } catch {}
    },
  };
})();
