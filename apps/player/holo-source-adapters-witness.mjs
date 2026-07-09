#!/usr/bin/env node
// holo-source-adapters-witness.mjs — proves the EXHAUSTIVE sibling-adapter set: every common existing
// library/source implements the same SourceProvider interface (catalogs/browse→one shape/resolve→playable),
// each verified with a fake backend (no network). Together with Jellyfin+Plex+Stremio+IA+RD, this covers
// the realistic universe of "all existing movie/show/video catalogs."
//
// Checks (one per adapter): subsonic · kodi · peertube · m3u · youtube · local · webdav · emby-alias

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSubsonicProvider } from "./holo-source-subsonic.mjs";
import { createKodiProvider } from "./holo-source-kodi.mjs";
import { createPeertubeProvider } from "./holo-source-peertube.mjs";
import { createM3UProvider, parseM3U } from "./holo-source-m3u.mjs";
import { createYouTubeProvider, parseYouTubeFeed } from "./holo-source-youtube.mjs";
import { createLocalProvider } from "./holo-source-local.mjs";
import { createWebDAVProvider } from "./holo-source-webdav.mjs";
import { createEmbyProvider } from "./holo-source-jellyfin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const json = (b) => async () => ({ ok: true, status: 200, json: async () => b });
const text = (s) => async () => ({ ok: true, status: 200, text: async () => s });

// subsonic
{
  const sub = createSubsonicProvider({ base: "https://sub", user: "u", password: "p", name: "Navidrome", fetch: json({ "subsonic-response": { videos: { video: [{ id: "v1", title: "Clip", year: 2020, coverArt: "c1" }] } } }) });
  const it = (await sub.browse())[0]; const r = await sub.resolve(it);
  ok("subsonic", it.id === "sub:v1" && it.name === "Clip" && r[0].httpDirect && /\/rest\/stream\.view\?.*id=v1/.test(r[0].playSrc) && /Subsonic/.test(r[0].provenance.label), JSON.stringify(r[0] && r[0].playSrc));
}
// kodi
{
  const kodi = createKodiProvider({ base: "https://kodi", name: "Kodi", fetch: json({ result: { movies: [{ movieid: 7, label: "Heat", year: 1995, file: "/movies/heat.mkv", thumbnail: "image://t", genre: ["Crime"] }] } }) });
  const it = (await kodi.browse("movies"))[0]; const r = await kodi.resolve(it);
  ok("kodi", it.id === "kodi:m:7" && it.kind === "movie" && r[0].httpDirect && /\/vfs\/.*heat\.mkv/.test(r[0].playSrc), JSON.stringify(r[0] && r[0].playSrc));
}
// peertube
{
  const pt = createPeertubeProvider({ base: "https://tube", name: "PeerTube", fetch: json({ data: [{ uuid: "abc", name: "Doc", publishedAt: "2021-05-01", thumbnailPath: "/t.jpg", duration: 600, streamingPlaylists: [{ playlistUrl: "https://tube/hls/abc.m3u8" }] }] }) });
  const it = (await pt.browse("recent"))[0]; const r = await pt.resolve(it);
  ok("peertube", it.id === "pt:abc" && /thumbnailPath|t\.jpg/.test(it.posterUrl) && r[0].type === "application/x-mpegURL" && /abc\.m3u8/.test(r[0].playSrc), JSON.stringify(r[0] && r[0].playSrc));
}
// m3u
{
  const pl = "#EXTM3U\n#EXTINF:-1 tvg-logo=\"l.png\" group-title=\"News\",CNN\nhttps://cdn/cnn.m3u8\n#EXTINF:-1,Movie\nhttps://cdn/movie.mp4\n";
  const m = createM3UProvider({ url: "https://x/list.m3u", name: "IPTV", fetch: text(pl) });
  const cats = await m.catalogs(); const items = await m.browse("News"); const r = await m.resolve((await m.browse("all")).find((x) => /Movie/.test(x.name)) || items[0]);
  ok("m3u", parseM3U(pl).length === 2 && items[0].name === "CNN" && cats.some((c) => /News/.test(c.name)) && r[0].httpDirect, JSON.stringify({ cats: cats.map((c) => c.name), first: items[0] && items[0].name }));
}
// youtube (RSS, keyless)
{
  const xml = `<feed><entry><yt:videoId>VID123</yt:videoId><title>Trailer</title><published>2023-01-02T00:00:00Z</published><media:thumbnail url="https://i.ytimg.com/vi/VID123/hq.jpg"/></entry></feed>`;
  const yt = createYouTubeProvider({ channelId: "UCxyz", name: "Channel", fetch: text(xml) });
  const it = (await yt.browse())[0]; const r = await yt.resolve(it);
  ok("youtube", parseYouTubeFeed(xml).length === 1 && it.id === "yt:VID123" && it.name === "Trailer" && /sc\/vstream/.test(r[0].playSrc) && /youtube-nocookie\.com\/embed\/VID123/.test(r[0].embedFallback), JSON.stringify({ playSrc: r[0] && r[0].playSrc, fb: r[0] && r[0].embedFallback }));
}
// local / OPFS (fake directory handle)
{
  const fakeDir = { async *entries() { yield ["Movie.mp4", { kind: "file", getFile: async () => ({ name: "Movie.mp4", type: "video/mp4" }) }]; yield ["notes.txt", { kind: "file", getFile: async () => ({}) }]; } };
  const loc = createLocalProvider({ getDir: async () => fakeDir, name: "On this device" });
  const items = await loc.browse();
  try { Object.defineProperty(globalThis.URL, "createObjectURL", { value: () => "blob:fake/Movie.mp4", configurable: true }); } catch { globalThis.URL = { createObjectURL: () => "blob:fake/Movie.mp4" }; }
  const r = await loc.resolve(items[0]);
  ok("local", items.length === 1 && items[0].name === "Movie" && r[0].httpDirect && /^blob:/.test(r[0].playSrc), JSON.stringify({ n: items.length, src: r[0] && r[0].playSrc }));
}
// webdav (PROPFIND xml)
{
  const xml = `<d:multistatus><d:response><d:href>/dav/Film.mp4</d:href><d:propstat><d:prop><d:displayname>Film.mp4</d:displayname></d:prop></d:propstat></d:response><d:response><d:href>/dav/readme.txt</d:href></d:response></d:multistatus>`;
  const dav = createWebDAVProvider({ base: "https://cloud/dav", name: "Nextcloud", fetch: text(xml) });
  const items = await dav.browse(); const r = await dav.resolve(items[0]);
  ok("webdav", items.length === 1 && items[0].name === "Film" && r[0].httpDirect && /Film\.mp4/.test(r[0].playSrc), JSON.stringify({ n: items.length, src: r[0] && r[0].playSrc }));
}
// emby alias (Jellyfin-compatible)
{
  const emby = createEmbyProvider({ base: "https://emby", token: "T", userId: "U", name: "Emby", fetch: json({ Items: [{ Id: "e1", Type: "Movie", Name: "Dune", ProductionYear: 2021, ImageTags: { Primary: "t" } }] }) });
  const cats = await emby.catalogs(); const it = (await emby.browse("Movie"))[0]; const r = await emby.resolve({ _jfId: "e1" });
  ok("emby", emby.kind === "emby" && it.id === "jf:e1" && /Videos\/e1\/master\.m3u8/.test(r[0].playSrc), JSON.stringify({ kind: emby.kind, src: r[0] && r[0].playSrc }));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-source-adapters — the exhaustive sibling-adapter set (Subsonic/Navidrome · Kodi · PeerTube · M3U/IPTV · YouTube · local/OPFS · WebDAV/Nextcloud · Emby) each implementing the ONE SourceProvider interface: catalogs→rails, browse→the one item shape, resolve→a playable stream with provenance. With Jellyfin/Plex/Stremio/IA/RD this covers the realistic universe of existing movie/show/video catalogs.",
  authority: "rests on #holo-source-{subsonic,kodi,peertube,m3u,youtube,local,webdav} + emby alias — full-library-interop",
  witnessed,
  covers: witnessed ? ["subsonic", "kodi", "peertube", "m3u", "youtube", "local", "webdav", "emby"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-source-adapters-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-source-adapters witness — every existing library, one interface\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  exhaustive library interop — Subsonic·Kodi·PeerTube·M3U·YouTube·local·WebDAV·Emby" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
