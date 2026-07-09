// make-showcase.mjs — bake feed/showcase.json from curated SoundCloud playlists.
// Provenance / regeneration tool: needs yt-dlp + network. The app reads the baked JSON
// (instant, stable artwork). Cover art = the set's og:image (always available, even when the
// audio is DRM-locked). Tracks = full yt-dlp extraction (streamable sets only); DRM sets are
// kept cover-only with drm:true so the app can showcase the artwork + link out honestly.
// Playback resolves live through the host /sc/stream route, so showcase tracks are
// Holo-Audio-enhanced like any stream. Re-run to refresh:  node make-showcase.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const YTDLP = process.env.YTDLP || "C:/Users/pavel/Desktop/Hologram OS2/system/tools/bin/yt-dlp.exe";
const here = dirname(fileURLToPath(import.meta.url));
const PLAYLISTS = [
  { id: "begin-again", url: "https://on.soundcloud.com/EWMjlkmQraxmPH36Cx", artist: "Ben Böhmer" },
  { id: "interstellar", url: "https://on.soundcloud.com/kmeimpKNai4gTop8Xo", artist: "Hans Zimmer" },
  { id: "f1-album", url: "https://on.soundcloud.com/ctoW1vK98Gg6VU5Vg6", artist: "Hans Zimmer" },
];
const LIMIT = 16;
const bestArt = (e) => { const t = e.thumbnails || []; let b = e.thumbnail || "", w = -1; for (const x of t) if ((x.width || 0) >= w) { w = x.width || 0; b = x.url; } return b || ""; };
const big = (u) => (u || "").replace(/-t\d+x\d+\.jpg/i, "-t1080x1080.jpg");

async function og(url) {
  try { const html = await (await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, redirect: "follow" })).text();
    const m = (p) => { const x = html.match(new RegExp('<meta property="og:' + p + '" content="([^"]+)"')); return x ? x[1] : ""; };
    return { title: m("title"), image: m("image") };
  } catch { return { title: "", image: "" }; }
}

const sets = [];
for (const pl of PLAYLISTS) {
  process.stderr.write("resolving " + pl.id + " …\n");
  const meta = await og(pl.url);
  const cover = big(meta.image);
  let tracks = [], drm = false, count = 0;
  try {
    const raw = execFileSync(YTDLP, ["-J", "--no-warnings", "-I", "1:" + LIMIT, pl.url], { maxBuffer: 96 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const j = JSON.parse(raw);
    const entries = (j.entries || []).filter((e) => e && (e.webpage_url || e.url));
    count = j.playlist_count || entries.length;
    tracks = entries.map((e) => ({ title: e.title || "(track)", artist: (e.artists && e.artists[0]) || e.uploader || pl.artist, art: bestArt(e), dur: Math.round(e.duration || 0), url: e.webpage_url || e.url }));
    process.stderr.write("  ✓ streamable — " + tracks.length + " tracks\n");
  } catch { drm = true; process.stderr.write("  ⛔ DRM-protected — cover only\n"); }
  sets.push({ id: pl.id, title: meta.title || pl.id, artist: pl.artist, url: pl.url, cover, drm, count: count || undefined, tracks });
}
writeFileSync(join(here, "showcase.json"), JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), source: "soundcloud", sets }, null, 2));
process.stderr.write("wrote showcase.json — " + sets.map((s) => s.id + ":" + (s.drm ? "DRM" : s.tracks.length)).join(", ") + "\n");
