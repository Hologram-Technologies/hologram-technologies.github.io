#!/usr/bin/env node
// holo-tube-ingest.mjs — the Holo Tube INGEST ADAPTER (the swappable, off-substrate edge).
//
// Turns a video source into a MediaGraph: an init segment + an ordered list of media segments,
// EACH sealed as a κ-object (sha256, the OS serving axis — byte-identical to what relock-app
// folds into the app closure, so each segment resolves at /.holo/sha256/<hex>). Segment bytes
// are preserved BIT-EXACT — never transcoded on the identity path (Law L2). The MediaGraph is a
// content-addressed DAG; its segment-closure κ pins every byte the stream can ever play (L5).
//
// The substrate is SOURCE-AGNOSTIC. Acquisition is the only non-substrate, out-of-band step:
//
//   node tools/holo-tube-ingest.mjs --demo
//       Generate self-made test clips with ffmpeg (no copyright) → fMP4 → seal a 3-item radio
//       MediaGraph into apps/holo-tube/media/. The runnable, witnessable path.
//
//   node tools/holo-tube-ingest.mjs <url.m3u8>
//       Generic HLS-fMP4 adapter: fetch the playlist + init + media segments from ANY open
//       origin, seal each by κ. (DASH .mpd: same shape — add an MPD reader at resolveManifest.)
//
//   node tools/holo-tube-ingest.mjs --youtube <watch-or-playlist-url>
//       YouTube adapter. Acquisition is the ToS/legal boundary: it requires yt-dlp on PATH to
//       resolve YouTube's segment URLs, and is the USER's call. Once resolved, ingest is identical
//       to any other HLS/DASH source — the substrate doesn't know or care where bytes came from.
//
// After ingest: `node tools/relock-app.local.mjs holo-tube` seals the segments into the closure.

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APP = "C:/Users/pavel/Desktop/HOLOGRAM/holo-apps/apps/holo-tube";
const SHARED = "C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/os/usr/lib/holo";
const MEDIA = join(APP, "media");

const { sha256hex } = await import(pathToFileURL(join(SHARED, "holo-uor.mjs")));
const { mediaGraphClosureKappa } = await import(pathToFileURL(join(SHARED, "holo-media.mjs")));

const SHA = "did:holo:sha256:";
const kappaOf = (bytes) => SHA + sha256hex(bytes);
const rel = (abs) => "media/" + abs.slice(MEDIA.length + 1).split("\\").join("/");

// rmrf — resilient recursive delete. On Windows a freshly-written file can be transiently locked
// (antivirus, an open handle from the dev server streaming the old media) → EBUSY on unlink. Retry,
// and NEVER let temp-dir cleanup abort the ingest (best-effort: a leftover _dl/_work is harmless).
const rmrf = (p, fatal = false) => {
  try { rmSync(p, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }); }
  catch (e) { if (fatal) throw e; console.warn("  (cleanup skipped: " + (e.code || e.message) + " — leftover temp dir is harmless)"); }
};

// yt-dlp: prefer the vendored binary (tools/bin/yt-dlp.exe, the path holo-serve-fhs uses), else PATH.
const YTDLP = existsSync(join(here, "bin", "yt-dlp.exe")) ? join(here, "bin", "yt-dlp.exe") : "yt-dlp";

// codecStringFromInit — read the EXACT RFC 6381 codec string from the fMP4 init segment's avcC box
// (profile · compat · level), so MediaSource.isTypeSupported accepts the rep. Audio on YouTube m4a
// is AAC-LC (mp4a.40.2). No guessing: the bytes declare their own codec.
function codecStringFromInit(initBytes) {
  for (let i = 0; i + 8 < initBytes.length; i++) {
    if (initBytes[i] === 0x61 && initBytes[i + 1] === 0x76 && initBytes[i + 2] === 0x63 && initBytes[i + 3] === 0x43) { // 'avcC'
      const p = initBytes[i + 5], c = initBytes[i + 6], l = initBytes[i + 7]; // configVersion, profile, compat, level
      const hx = (n) => n.toString(16).padStart(2, "0");
      return `video/mp4; codecs="avc1.${hx(p)}${hx(c)}${hx(l)}, mp4a.40.2"`;
    }
  }
  return 'video/mp4; codecs="avc1.640028, mp4a.40.2"'; // fallback: High@4.0
}

// segmentMp4 — remux an mp4 to HLS fMP4 (init.mp4 + segNNN.m4s) with -c copy (NO transcode: coded
// H.264/AAC samples are preserved bit-exact; only the container is fragmented). Shared by all sources.
function segmentMp4(mp4, outDir, segDur) {
  const work = join(outDir, "_seg");
  mkdirSync(work, { recursive: true });
  ffmpeg([
    "-y", "-i", mp4, "-c", "copy",
    "-f", "hls", "-hls_time", String(segDur), "-hls_playlist_type", "vod",
    "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4",
    "-hls_segment_filename", "seg%d.m4s", "out.m3u8",
  ], work);
  for (const f of readdirSync(work)) if (/\.(mp4|m4s)$/i.test(f)) copyFileSync(join(work, f), join(outDir, f));
  rmrf(work);
}

// ── seal an HLS fMP4 rendition directory (init.mp4 + segNNN.m4s) into a MediaGraph rep ─────────
function sealRendition(dir, { mime, height, bitrate, segDur }) {
  const files = readdirSync(dir);
  const initName = files.find((f) => /^init\.mp4$/i.test(f)) || files.find((f) => /init.*\.mp4$/i.test(f));
  if (!initName) throw new Error("no init segment (init.mp4) in " + dir);
  const segNames = files
    .filter((f) => /\.m4s$/i.test(f) || /^seg.*\.mp4$/i.test(f))
    .sort((a, b) => (a.match(/\d+/)?.[0] | 0) - (b.match(/\d+/)?.[0] | 0));

  const initBytes = readFileSync(join(dir, initName));
  const rep = {
    mime,
    bitrate: bitrate || null,
    width: height ? Math.round((height * 16) / 9) : null,
    height: height || null,
    initSegment: kappaOf(initBytes),
    initPath: rel(join(dir, initName)),
    segments: segNames.map((n) => {
      const b = readFileSync(join(dir, n));
      return { kappa: kappaOf(b), dur: segDur || null, bytes: b.length, path: rel(join(dir, n)) };
    }),
  };
  return rep;
}

// ── ffmpeg demo: self-made clips → fMP4 → a 3-item radio MediaGraph (no copyright) ─────────────
function ffmpeg(args, cwd) {
  const r = spawnSync("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"], cwd });
  if (r.status !== 0) throw new Error("ffmpeg failed (" + r.status + ")");
}
function haveFfmpeg() { return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0; }

function genDemo() {
  if (!haveFfmpeg()) throw new Error("ffmpeg not found on PATH — install it, or use a <url.m3u8> source");
  rmrf(MEDIA, true);
  mkdirSync(MEDIA, { recursive: true });

  // A single muxed (H.264 high@4.0 + AAC-LC) fMP4 rendition per clip → ONE SourceBuffer, one
  // codec string, gapless across the queue. avc1.640028 = High profile, level 4.0; mp4a.40.2 = AAC-LC.
  const MIME = 'video/mp4; codecs="avc1.640028, mp4a.40.2"';
  const CLIPS = [
    { id: "holo-bars",  label: "Holo Tube — SMPTE bars",   src: "smptebars=size=1280x720:rate=30", tone: 440 },
    { id: "holo-test",  label: "Holo Tube — test pattern", src: "testsrc=size=1280x720:rate=30",   tone: 523 },
    { id: "holo-test2", label: "Holo Tube — gradients",    src: "testsrc2=size=1280x720:rate=30",  tone: 659 },
  ];
  const SECS = 8, SEG = 2;
  const videos = [];

  for (const c of CLIPS) {
    const work = join(MEDIA, "_work", c.id);
    const out = join(MEDIA, c.id);
    mkdirSync(work, { recursive: true });
    mkdirSync(out, { recursive: true });

    // 1 · generate a muxed mp4 from a synthetic source + a sine tone, with an on-screen label.
    const mp4 = join(work, "src.mp4");
    ffmpeg([
      "-y",
      "-f", "lavfi", "-i", `${c.src}:duration=${SECS}`,
      "-f", "lavfi", "-i", `sine=frequency=${c.tone}:duration=${SECS}`,
      "-c:v", "libx264", "-profile:v", "high", "-level", "4.0", "-pix_fmt", "yuv420p",
      "-g", String(SEG * 30), "-keyint_min", String(SEG * 30), "-sc_threshold", "0",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000",
      "-movflags", "+faststart", "-shortest", mp4,
    ]);

    // 2 · segment to HLS fMP4: init.mp4 + segNNN.m4s (bit-exact copy — NO re-encode). Run with
    // cwd=work so the fMP4 init (written relative to CWD by this ffmpeg build) lands in work.
    ffmpeg([
      "-y", "-i", mp4, "-c", "copy",
      "-f", "hls", "-hls_time", String(SEG), "-hls_playlist_type", "vod",
      "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4",
      "-hls_segment_filename", "seg%d.m4s",
      "out.m3u8",
    ], work);

    // 3 · move the init + media segments into the vendored output dir, seal each by κ.
    for (const f of readdirSync(work)) if (/\.(mp4|m4s)$/i.test(f) && f !== "src.mp4") copyFileSync(join(work, f), join(out, f));
    const repr = sealRendition(out, { mime: MIME, height: 720, bitrate: 1500000, segDur: SEG });
    videos.push({ id: c.id, "schema:name": c.label, "schema:duration": `PT${SECS}S`, representations: [repr] });
  }

  // gapless playlist links: each video points at the next; the last ends the queue (finite VOD
  // playlist — a bounded, honest demo; endless radio needs SourceBuffer eviction, out of scope).
  videos.forEach((v, i) => { if (i < videos.length - 1) v.next = videos[i + 1].id; });
  rmrf(join(MEDIA, "_work"));
  return videos;
}

// ── generic HLS-fMP4 URL adapter (any open origin) ─────────────────────────────────────────────
async function genFromHls(url) {
  rmrf(MEDIA, true);
  mkdirSync(MEDIA, { recursive: true });
  const out = join(MEDIA, "src");
  mkdirSync(out, { recursive: true });
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  const txt = await (await fetch(url)).text();
  if (!/#EXTM3U/.test(txt)) throw new Error("not an HLS playlist — for DASH .mpd add an MPD reader to resolveManifest");
  const init = (txt.match(/#EXT-X-MAP:URI="([^"]+)"/) || [])[1];
  if (!init) throw new Error("HLS playlist has no fMP4 init (#EXT-X-MAP) — only fMP4 renditions are bit-exact MSE-feedable");
  const segs = txt.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  const pull = async (u, name) => { const b = new Uint8Array(await (await fetch(new URL(u, base))).arrayBuffer()); writeFileSync(join(out, name), b); };
  await pull(init, "init.mp4");
  let i = 0; for (const s of segs) await pull(s, `seg${i++}.m4s`);
  const repr = sealRendition(out, { mime: 'video/mp4; codecs="avc1.640028, mp4a.40.2"', height: null, segDur: null });
  return [{ id: "src", "schema:name": url, representations: [repr] }];
}

// ── YouTube adapter (acquisition = the ToS/legal boundary; the user's call) ─────────────────────
// yt-dlp resolves YouTube's streams; we download the H.264+AAC renditions YouTube already serves,
// remux (-c copy, bit-exact samples) into fMP4 segments, and seal each by κ. A radio/playlist URL
// expands to its first N entries, each a MediaGraph video linked gaplessly.
const yt = (args, text = true) => {
  const r = spawnSync(YTDLP, args, { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0 && !(r.stdout || "").trim()) throw new Error("yt-dlp: " + ((r.stderr || "").trim().split("\n").pop() || "exit " + r.status));
  return text ? (r.stdout || "").trim() : r;
};

async function genFromYouTube(url, n = 4, maxH = 720, segDur = 4) {
  if (spawnSync(YTDLP, ["--version"], { stdio: "ignore" }).status !== 0)
    throw new Error("yt-dlp not found (expected tools/bin/yt-dlp.exe or on PATH)");
  // Clip bound: these can be multi-hour DJ sets. Seal the first CLIP seconds of each entry — a real
  // proof of streaming THIS playlist as κ-objects, not a directive to pull hours of video. 0 = whole.
  const clip = parseInt(process.env.HOLO_TUBE_CLIP || "90", 10);
  rmrf(MEDIA, true);
  mkdirSync(MEDIA, { recursive: true });

  // 1 · expand the playlist/radio to its first N entries (flat — no per-video resolve yet).
  const ids = yt(["--flat-playlist", "--no-warnings", "--print", "%(id)s", "--playlist-end", String(n), url])
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, n);
  if (!ids.length) throw new Error("no playlist entries resolved");
  console.log(`playlist → ${ids.length} entries: ${ids.join(", ")}`);

  const FMT = `bv*[vcodec^=avc1][height<=${maxH}]+ba[acodec^=mp4a]/b[ext=mp4][height<=${maxH}]/b[ext=mp4]`;
  const videos = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const watch = `https://www.youtube.com/watch?v=${id}`;
    const out = join(MEDIA, id);
    mkdirSync(out, { recursive: true });
    const mp4 = join(MEDIA, "_dl", `${id}.mp4`);
    mkdirSync(join(MEDIA, "_dl"), { recursive: true });

    let title = id, dur = null;
    try { const meta = yt(["--no-warnings", "--print", "%(title)s\t%(duration)s", "--playlist-items", "1", watch]).split("\t"); title = meta[0] || id; dur = parseInt(meta[1], 10) || null; } catch (_) {}
    const clipped = clip > 0 ? Math.min(clip, dur || clip) : (dur || null);
    console.log(`[${i + 1}/${ids.length}] ${title} — downloading ${clip > 0 ? "first " + clip + "s" : "full"} (avc1≤${maxH}p + m4a, remux mp4)…`);

    // 2 · download + merge to a single muxed mp4 (yt-dlp drives ffmpeg). --download-sections bounds it.
    const dlArgs = ["-f", FMT, "--no-warnings", "--merge-output-format", "mp4"];
    if (clip > 0) dlArgs.push("--download-sections", `*0-${clip}`);
    yt([...dlArgs, "-o", mp4, watch], false);
    if (!existsSync(mp4)) throw new Error("download produced no mp4 for " + id);

    // 3 · remux → fMP4 segments (bit-exact, no transcode), seal each by κ, read the real codec string.
    segmentMp4(mp4, out, segDur);
    const initBytes = readFileSync(join(out, "init.mp4"));
    const repr = sealRendition(out, { mime: codecStringFromInit(initBytes), height: maxH, segDur });
    videos.push({ id, "schema:name": title, ...(clipped ? { "schema:duration": `PT${clipped}S` } : {}), representations: [repr] });
    console.log(`    sealed ${repr.segments.length} κ-segments  ·  ${repr.mime}`);
  }

  videos.forEach((v, i) => { if (i < videos.length - 1) v.next = videos[i + 1].id; });   // gapless playlist
  rmrf(join(MEDIA, "_dl"));
  return videos;
}

// ── write the MediaGraph ────────────────────────────────────────────────────────────────────
function writeGraph(videos, { kind, name }) {
  const graph = {
    "@context": { holo: "https://hologram.os/ns#", schema: "http://schema.org/" },
    "@type": "holo:MediaGraph",
    kind: kind || (videos.length > 1 ? "playlist" : "video"),
    "schema:name": name || "Holo Tube demo radio",
    live: false,
    videos,
  };
  graph["holo:segmentClosure"] = mediaGraphClosureKappa(graph);   // non-circular root over all segment κs
  const path = join(MEDIA, "demo.mediagraph.json");
  writeFileSync(path, JSON.stringify(graph, null, 2) + "\n");
  const segCount = videos.reduce((n, v) => n + v.representations.reduce((m, r) => m + 1 + r.segments.length, 0), 0);
  console.log(`✓ MediaGraph → media/demo.mediagraph.json`);
  console.log(`  videos: ${videos.length}  ·  κ-segments: ${segCount}  ·  segmentClosure: ${graph["holo:segmentClosure"]}`);
  console.log(`next: node tools/relock-app.local.mjs holo-tube   (seals segments into the closure)`);
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────
const arg = process.argv[2];
try {
  if (!arg) { console.error("usage: node tools/holo-tube-ingest.mjs (--demo | <url.m3u8> | --youtube <url>)"); process.exit(2); }
  if (arg === "--demo") writeGraph(genDemo(), { kind: "playlist", name: "Holo Tube — demo radio (self-made, no copyright)" });
  else if (arg === "--youtube") writeGraph(await genFromYouTube(process.argv[3], parseInt(process.argv[4], 10) || 4), { kind: "playlist", name: "YouTube radio — " + process.argv[3] });
  else writeGraph(await genFromHls(arg), { kind: "playlist", name: arg });
} catch (e) {
  console.error("ingest failed:", e.message || e);
  process.exit(1);
}
