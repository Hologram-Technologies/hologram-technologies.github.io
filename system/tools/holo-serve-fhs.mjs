#!/usr/bin/env node
// holo-serve-fhs.mjs — the κ-route serving layer that makes the FHS-shaped OS2 BOOT. The apps
// expect the flat os/ URL space (/_shared/, /apps/<id>/, /holo-launch.mjs) + the content route
// /.holo/sha256/<hex>. This server bridges that onto OS2's FHS physical paths (a mount table) and
// resolves /.holo/sha256/<hex> by content (hex→path via os-closure.json, Law L5 names). Prefers OS2;
// falls back to the original os/ ONLY to fill runnable-closure gaps, and COUNTS both so we can report
// how self-contained OS2 is. Cross-origin-isolation headers so SharedArrayBuffer works.
//
//   node tools/holo-serve-fhs.mjs [port=8300]

import http from "node:http";
import net from "node:net";                                  // raw socket for the Tor SOCKS5 onion transport
import { readFileSync, existsSync, statSync, readdirSync, createReadStream, createWriteStream, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";                 // re-derivation at the κ-route's substrate fallback (Law L5)
import { fhsMap } from "../os/lib/holo-fhs-map.mjs";     // the ONE flat→FHS mapping (shared with the Pages SW)
import { identiconSvg } from "../os/usr/lib/holo/holo-identicon.mjs";   // content-derived OG-card visual
import { buildAppRegistry, descriptor, handle as mcpHandle } from "../os/usr/lib/holo/mcp/holo-mcp.mjs";   // per-app MCP surface (dependency-free core)
import { handleApi, collectNdjson, collectSse } from "../os/usr/lib/holo/api/holo-api-core.mjs";   // per-app unified REST API (κ-stream ingress/egress)
import { onionFetch, normalizeTransport, resolveActiveTransport } from "../os/sbin/holo-omni-onion-transport.mjs";   // the two honest Tor transports (gateway · SOCKS5) + local-Tor autodetect
import { ensureTor } from "../os/sbin/holo-tor-host.mjs";   // MANAGED Tor: reuse a running Tor, else κ-verify + launch one (Brave model, no user install)
import { blake3hex as torBlake3 } from "../os/usr/lib/holo/holo-blake3.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const OS2 = join(here, "../os");
export const REPO = join(here, "../..");                              // repo root — holds the gateway index.html + repo-root vendored assets (system/vendor/…) that prod serves statically
export const APPS = process.env.HOLO_APPS_REPO || join(here, "../../../holo-apps");          // the separate apps repo
export const ORIG = process.env.HOLO_OS_DIR || join(here, "../os");

// the pretty-share helpers: an app's display name (from the content-addressed catalog) + its root κ.
let _cat = null;
function appMeta(id) {
  try {
    const lock = JSON.parse(readFileSync(join(APPS, "apps", id, "holospace.lock.json"), "utf8"));
    if (!_cat) { try { _cat = JSON.parse(readFileSync(join(APPS, "apps", "index.jsonld"), "utf8"))["dcat:dataset"] || []; } catch { _cat = []; } }
    const e = _cat.find((a) => String(a["dcat:landingPage"] || "").split("/")[1] === id || String(a["schema:identifier"] || "").toLowerCase().endsWith(id));
    return { name: (e && e["schema:name"]) || ("Holo " + id[0].toUpperCase() + id.slice(1)), summary: (e && e["schema:description"]) || "Running on Hologram — live on your device. Private. No install.", root: lock.root };
  } catch { return null; }
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".jsonld": "application/ld+json", ".map": "application/json", ".wasm": "application/wasm",
  ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".gz": "application/gzip", ".webmanifest": "application/manifest+json", ".txt": "text/plain",
  ".md": "text/markdown", ".ts": "text/plain", ".tsx": "text/plain", ".py": "text/plain", ".yml": "text/plain", ".yaml": "text/plain", ".toml": "text/plain", ".sh": "text/plain", ".rs": "text/plain", ".c": "text/plain", ".h": "text/plain", ".md5": "text/plain" };
const COI = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless", "Cross-Origin-Resource-Policy": "cross-origin" };

// ── dev media backend: the host /caps + /sc/* routes Holo Music expects. SoundCloud has no
//    open/CORS API, so the browser proxies search/resolve/stream through the host's yt-dlp.
//    yt-dlp.exe is dropped in tools/bin (gitignored); this is a DEV convenience ONLY — it is
//    not part of the sealed os/ closure, the Pages Service Worker, or the W3C gate. ─────────
const YTDLP = join(here, "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const HAS_YTDLP = existsSync(YTDLP);
const sendJson = (res, obj, code = 200) => { res.writeHead(code, { ...COI, "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
function ytdlp(args, wantText = false) {
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, args, { windowsHide: true });
    let out = "", err = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0 && !out.trim()) return reject(new Error((err.trim().split("\n").pop() || "yt-dlp exit " + code).slice(0, 300)));
      if (wantText) return resolve(out.trim());
      try { resolve(JSON.parse(out)); } catch { reject(new Error("bad yt-dlp json")); }
    });
  });
}
// /sc/<sub> → search | resolve | track | stream (the contract holo-stations.js consumes)
async function scRoute(sub, params, res, req) {
  if (!HAS_YTDLP) return sendJson(res, { error: "yt-dlp not installed on host" });
  try {
    if (sub === "search") { const n = Math.min(50, parseInt(params.get("n") || "24", 10) || 24); const q = params.get("q") || "";
      return sendJson(res, await ytdlp(["-J", "--flat-playlist", "--no-warnings", `scsearch${n}:${q}`])); }
    if (sub === "vstream") return vstreamRoute(params.get("url") || "", parseInt(params.get("h") || "4320", 10), req, res);   // any-site video → highest quality, same-origin (YouTube etc.)
    const url = params.get("url") || "";
    if (!/^https?:\/\/(?:[\w-]+\.)?(?:soundcloud\.com|snd\.sc)\//i.test(url)) return sendJson(res, { error: "not a SoundCloud url" });
    if (sub === "resolve") return sendJson(res, await ytdlp(["-J", "--flat-playlist", "--no-warnings", url]));
    if (sub === "track") return sendJson(res, await ytdlp(["-J", "--no-warnings", url]));
    if (sub === "stream") {                                  // resolve the HIGHEST-bitrate progressive (http) stream and PIPE it same-origin (so Holo Audio can shape it)
      // prefer the best seekable http(s) progressive, sorted by audio bitrate (then opus over mp3) so we serve
      // the highest quality the track offers; fall back to the reliable 128k mp3, then anything.
      const direct = (await ytdlp(["-f", "bestaudio[protocol^=http]/http_mp3_128/http_mp3_0/bestaudio", "-S", "abr,acodec:opus", "-g", "--no-warnings", url], true)).split("\n")[0].trim();
      if (!/^https?:/.test(direct)) return sendJson(res, { error: "no progressive stream" });
      return pipeUpstream(direct, req, res);
    }
    return sendJson(res, { error: "unknown sc route" });
  } catch (e) { return sendJson(res, { error: String((e && e.message) || e).slice(0, 300) }); }
}

// basic SSRF hygiene: only proxy public http(s) — refuse loopback / private / link-local hosts.
function publicHttpUrl(raw) {
  let u; try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "metadata.google.internal" ||
      /^(127\.|10\.|169\.254\.|192\.168\.|0\.0\.0\.0|::1$|\[::1\])/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null;
  return u;
}
// Pipe a remote audio stream through the host so the browser sees SAME-ORIGIN bytes — the
// precondition for routing it through Holo Audio (Web Audio taints/silences cross-origin media).
// Forwards Range (seeking) and the live body untouched. Dev-only, like the /sc/* routes.
async function pipeUpstream(rawUrl, req, res) {
  const u = publicHttpUrl(rawUrl); if (!u) return sendJson(res, { error: "refused url" }, 400);
  const reqHeaders = { "user-agent": "Mozilla/5.0 (HoloMusic)", accept: "*/*" };
  if (req.headers.range) reqHeaders.range = req.headers.range;
  let up; try { up = await fetch(u, { headers: reqHeaders, redirect: "follow" }); } catch (e) { return sendJson(res, { error: "upstream: " + e.message }, 502); }
  if (!up.ok && up.status !== 206) { try { up.body && up.body.cancel(); } catch {} return sendJson(res, { error: "upstream HTTP " + up.status }, 502); }
  const out = { ...COI, "cache-control": "no-store", "accept-ranges": up.headers.get("accept-ranges") || "bytes" };
  for (const k of ["content-type", "content-length", "content-range"]) { const v = up.headers.get(k); if (v) out[k] = v; }
  if (!out["content-type"]) out["content-type"] = "audio/mpeg";
  res.writeHead(up.status, out);
  if (!up.body) return res.end();
  const node = Readable.fromWeb(up.body);
  req.on("close", () => { try { node.destroy(); } catch {} });
  node.on("error", () => { try { res.end(); } catch {} });
  node.pipe(res);
}

// ── /sc/vstream?url=&h= — pin ANY video (YouTube, Vimeo, …) into the Holo Video player at the highest
// quality the source offers (up to 8K), played same-origin. YouTube serves no muxed progressive above
// 720p, so for higher resolutions we resolve the best video-only + best audio and let ffmpeg COPY-mux
// them (no re-encode → zero quality loss) into a fragmented MP4 streamed live. The muxed result is teed
// to a disk cache keyed by (url,height), so the FIRST play warms it (a few seconds) and EVERY later play
// is instant + fully seekable from local disk. Dev-only, like the other /sc/* routes.
const VCACHE = join(here, "bin", "vcache");
function serveCachedVideo(file, req, res) {
  let st; try { st = statSync(file); } catch { return false; }
  if (!st.size) return false;
  const total = st.size, head = { ...COI, "content-type": "video/mp4", "cache-control": "no-store", "accept-ranges": "bytes" };
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    let start = m[1] ? parseInt(m[1], 10) : 0, end = m[2] ? parseInt(m[2], 10) : total - 1;
    if (isNaN(start)) start = 0; if (isNaN(end) || end >= total) end = total - 1;
    if (start > end || start >= total) { res.writeHead(416, { ...head, "content-range": `bytes */${total}` }); res.end(); return true; }
    head["content-range"] = `bytes ${start}-${end}/${total}`; head["content-length"] = end - start + 1;
    res.writeHead(206, head);
    const rs = createReadStream(file, { start, end }); req.on("close", () => { try { rs.destroy(); } catch {} }); rs.on("error", () => { try { res.end(); } catch {} }); rs.pipe(res);
  } else {
    head["content-length"] = total; res.writeHead(200, head);
    const rs = createReadStream(file); req.on("close", () => { try { rs.destroy(); } catch {} }); rs.on("error", () => { try { res.end(); } catch {} }); rs.pipe(res);
  }
  return true;
}
async function vstreamRoute(rawUrl, hWanted, req, res) {
  const u = publicHttpUrl(rawUrl); if (!u) return sendJson(res, { error: "refused url" }, 400);
  const h = Math.min(4320, Math.max(360, hWanted || 4320));
  const key = createHash("sha1").update(u.href + "|" + h).digest("hex"), file = join(VCACHE, key + ".mp4");
  if (existsSync(file) && serveCachedVideo(file, req, res)) return;          // instant + seekable on repeat plays
  let lines;
  try {
    lines = (await ytdlp(["-f", `bv*[height<=${h}]+ba/b[height<=${h}]/b`,
      "-S", "res,fps,vcodec:vp9,vcodec:av01,vcodec:h264,acodec:opus,acodec:aac",
      "-g", "--no-warnings", u.href], true)).split("\n").map((s) => s.trim()).filter((s) => /^https?:/.test(s));
  } catch (e) { return sendJson(res, { error: String((e && e.message) || e).slice(0, 200) }, 502); }
  if (!lines.length) return sendJson(res, { error: "no playable stream" }, 502);
  if (lines.length === 1) return pipeUpstream(lines[0], req, res);          // a single muxed progressive (≤720p YT) — instant + seekable
  // separate video + audio → ffmpeg copy-mux to a fragmented MP4 streamed live, teed to the disk cache
  try { mkdirSync(VCACHE, { recursive: true }); } catch {}
  const tmp = file + ".part." + process.pid;
  let cache = null; try { cache = createWriteStream(tmp); } catch {}
  let killed = false;
  const dropCache = () => { if (cache) { try { cache.destroy(); } catch {} cache = null; } try { if (existsSync(tmp)) unlinkSync(tmp); } catch {} };
  res.writeHead(200, { ...COI, "content-type": "video/mp4", "cache-control": "no-store" });
  const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", lines[0], "-i", lines[1],
    "-map", "0:v:0", "-map", "1:a:0", "-c", "copy",
    "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"], { windowsHide: true });
  ff.stdout.on("data", (c) => { try { res.write(c); } catch {} if (cache) { try { cache.write(c); } catch {} } });
  ff.stderr.on("data", () => {});
  ff.on("error", () => { dropCache(); try { res.end(); } catch {} });
  ff.on("close", (code) => {
    if (cache) { try { cache.end(); } catch {} }
    if (code === 0 && !killed) { try { renameSync(tmp, file); } catch {} } else dropCache();   // cache only a COMPLETE mux
    try { res.end(); } catch {}
  });
  req.on("close", () => { killed = true; try { ff.kill("SIGKILL"); } catch {} dropCache(); });
}

// /weather?q=<city>  (or ?lat=&lon=) → open-meteo geocode + current conditions, proxied same-origin.
// Privacy by design: the Holo Widgets weather tile sends a USER-TYPED city — never device GPS — and
// the HOST (not the browser) talks to open-meteo, so no third party sees the user's IP+coords pairing.
// open-meteo is keyless. Dev-only companion route, like /sc/* and /web (absent on static Pages, where
// the widget simply degrades to "offline"). Not part of the sealed os/ closure or the W3C gate.
async function weatherRoute(params, res) {
  try {
    const unit = /^f/i.test(params.get("unit") || "") ? "fahrenheit" : "celsius";
    let lat = parseFloat(params.get("lat")), lon = parseFloat(params.get("lon")), place = (params.get("place") || "").trim();
    const q = (params.get("q") || "").trim();
    if ((!isFinite(lat) || !isFinite(lon)) && q) {
      const g = await fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=" + encodeURIComponent(q));
      const gj = await g.json(); const hit = gj && gj.results && gj.results[0];
      if (!hit) return sendJson(res, { error: "place not found" }, 404);
      lat = hit.latitude; lon = hit.longitude; place = place || [hit.name, hit.country_code].filter(Boolean).join(", ");
    }
    if (!isFinite(lat) || !isFinite(lon)) return sendJson(res, { error: "need ?q=<city> or ?lat=&lon=" }, 400);
    const f = await fetch("https://api.open-meteo.com/v1/forecast?current=temperature_2m,weather_code,is_day&temperature_unit=" + unit + "&latitude=" + lat + "&longitude=" + lon);
    const fj = await f.json(); const cur = fj && fj.current;
    if (!cur) return sendJson(res, { error: "no forecast" }, 502);
    return sendJson(res, { ok: true, place: place || (lat.toFixed(2) + "," + lon.toFixed(2)), temp: Math.round(cur.temperature_2m), code: cur.weather_code, day: cur.is_day !== 0, unit: unit === "fahrenheit" ? "F" : "C" });
  } catch (e) { return sendJson(res, { error: String((e && e.message) || e).slice(0, 200) }, 502); }
}

// κ → os-relative path — the κ-route's DUAL-AXIS name table. Every object resolves by its OS serving
// key (did:holo:sha256) AND its unified-substrate σ-axis κ (did:holo:blake3, the alsoKnownAs alias) —
// folded over BOTH the OS-wide closure AND every app's lock closure, so any byte in the whole OS or
// any app is fetchable on the shared substrate by either content address, re-derived (Law L5).
const closure = (() => { try { return JSON.parse(readFileSync(join(OS2, "etc/os-closure.json"), "utf8")).closure || {}; } catch { return {}; } })();
const hexToPath = new Map();      // sha256 hex → path
const blakeToPath = new Map();    // blake3 hex → path (the substrate σ-axis)
const indexEntry = (p, v) => {
  if (typeof v === "string") { const hex = v.split(":").pop(); if (hex && !hexToPath.has(hex)) hexToPath.set(hex, p); return; }
  if (!v || typeof v !== "object") return;
  const sha = String(v.kappa || v.did || v["@id"] || "").split(":").pop(); if (sha && !hexToPath.has(sha)) hexToPath.set(sha, p);
  for (const aka of (v.alsoKnownAs || [])) { const b = /^did:holo:blake3:([0-9a-f]{64})$/.exec(String(aka)); if (b && !blakeToPath.has(b[1])) blakeToPath.set(b[1], p); }
};
for (const [p, v] of Object.entries(closure)) indexEntry(p, v);
// fold in every app's lock closure (Hologram Apps), so an app's OWN bytes also resolve by content
try { for (const id of readdirSync(join(APPS, "apps"))) { try {
  const lk = JSON.parse(readFileSync(join(APPS, "apps", id, "holospace.lock.json"), "utf8")).closure || {};
  for (const [p, v] of Object.entries(lk)) indexEntry(p, v);
} catch {} } } catch {}

// Fold in the FULL substrate index (etc/substrate-index.json): EVERY object across the repo set
// (OS2 + Apps), keyed path→{sha256,blake3}. This makes the κ-route authoritative over the WHOLE
// content-addressed universe — any object is dereferenceable by its identity (did:holo:sha256), not
// only the runnable closure. Keys are root-prefixed (os2/… · apps/…) with the absolute repo roots in
// `.roots`, so an object OUTSIDE the served web tree (a doc, a spec) still resolves by κ. Served bytes
// are RE-DERIVED before admission (serveByKappa, Law L5). Dev affordance: in prod the SW serves the
// closure and heals the rest from IPFS/mesh — location is a latency choice, never the identity (Law L1).
const hexToAbs = new Map();       // sha256 hex → absolute file path (full substrate; re-derived on serve)
try {
  const si = JSON.parse(readFileSync(join(OS2, "etc/substrate-index.json"), "utf8"));
  const roots = si.roots || {};
  for (const [key, v] of Object.entries(si.objects || {})) {
    const hex = String((v && (v.sha256 || v.did || v["@id"])) || "").split(":").pop();
    if (!hex || !/^[0-9a-f]{64}$/.test(hex) || hexToAbs.has(hex)) continue;
    const prefix = key.split("/")[0], root = roots[prefix];
    if (root) hexToAbs.set(hex, join(root, key.slice(prefix.length + 1)));
  }
} catch {}

// os-relative path → OS2 FHS physical path. The mapping itself is the ONE shared rule in
// os/lib/holo-fhs-map.mjs — used verbatim by the Pages Service Worker (os/holo-fhs-sw.js), so
// dev (this server) and prod (static Pages + SW) resolve byte-identically. null ⇒ unknown
// top-level (the readRel below then tries the Apps repo / original-os gap fallback).
export function fhsOf(rel) { const p = fhsMap(rel); return p ? join(OS2, p) : null; }

// DEV-ONLY: the dev server is the explicit, deliberate dev action — it (and ONLY it) enables the
// Service Worker's dev-fresh path by flipping the sealed default ALLOW_DEV_FRESH=false→true as it
// serves holo-fhs-sw.js. A dumb static host (prod) serves the file verbatim, so prod keeps full L5
// (re-derive + refuse) even on a localhost origin. The on-disk byte stays false (what reseal-drift
// pins), so this rewrite never desyncs the prod closure — it lives only in the dev response.
const devEnableFresh = (buf) => Buffer.from(String(buf).replace("const ALLOW_DEV_FRESH = false;", "const ALLOW_DEV_FRESH = true; /* dev-server enabled */"));

// resolve an os-relative path to bytes: OS2 first, else original. {buf, src} | null
function readRel(rel, stats) {
  const isApp = rel.startsWith("apps/");
  // apps resolve from the separate Hologram Apps repo (a holospace boots from anywhere by κ)
  if (isApp) { const a = join(APPS, rel); if (existsSync(a) && statSync(a).isFile()) { stats.apps++; return { buf: readFileSync(a), rel }; } }
  const f = fhsOf(rel);
  // HOLO_PROD_SW=1 serves the SW VERBATIM (sealed ALLOW_DEV_FRESH=false) so a localhost harness can
  // witness the PROD code path (cache-first + L5 + heal, DEV=false) — exactly what a dumb static host
  // ships. Without it, dev keeps the live-edit dev-fresh rewrite. The on-disk byte is untouched either way.
  if (f && existsSync(f) && statSync(f).isFile()) { stats.os2++; let buf = readFileSync(f); if (rel === "holo-fhs-sw.js" && !process.env.HOLO_PROD_SW) buf = devEnableFresh(buf); return { buf, rel }; }
  // Law L1 (content, not location): an app resolves ONLY from its own content-addressed image
  // (Hologram Apps + the OS2 vendored holospaces), NEVER by path-borrowing from the legacy os/ —
  // so a retired app is truly gone (404), not silently served from the old monolith. The legacy
  // gap-fallback survives only for OS-spine files OS2 hasn't vendored yet.
  if (!isApp) { const o = join(ORIG, rel); if (existsSync(o) && statSync(o).isFile()) { stats.orig.add(rel); return { buf: readFileSync(o), rel }; } }
  // repo-root static assets that live OUTSIDE the os/ FHS space (e.g. system/vendor/vanta/* — the gateway's
  // vendored WebGL cloud sky; docs/* — the generated Astro site incl. the gateway's docs/download.html door;
  // CONSTITUTION.md — the full-text conscience the gateway + .well-known link at repo root, ADR-033).
  // On GitHub Pages the whole repo is served statically so these resolve directly; this dev server roots assets
  // under os/, so without this fallback they 404. Confined to the prefixes/files the gateway actually references,
  // never a path escape (no "..").
  if (!isApp && /^(?:(?:system\/vendor|docs)\/|CONSTITUTION\.md$)/.test(rel) && !rel.includes("..")) { const r = join(REPO, rel); if (existsSync(r) && statSync(r).isFile()) { stats.os2++; return { buf: readFileSync(r), rel }; } }
  return null;
}

// serveByKappa — the κ-route's SUBSTRATE fallback: when a sha256 hex isn't in the runnable closure,
// read the object by its content hash from disk, RE-DERIVE its sha256, and serve ONLY on a match
// (Law L5). This dereferences ANY object in the content-addressed universe by its identity alone
// (Law L1) — a doc, a spec, an app's internal — re-derived, not trusted.
function serveByKappa(hex, route, res, stats) {
  const abs = hexToAbs.get(hex);
  if (abs && existsSync(abs) && statSync(abs).isFile()) {
    const buf = readFileSync(abs);
    if (createHash("sha256").update(buf).digest("hex") === hex) {
      stats.os2++;
      const ext = extname(route).toLowerCase() || extname(abs).toLowerCase();
      res.writeHead(200, { ...COI, "content-type": TYPES[ext] || "application/octet-stream", "cache-control": "no-store", "x-holo-verified": "sha256" });
      return res.end(buf);
    }
  }
  stats.miss.add("κ:" + hex.slice(0, 10)); res.writeHead(404, COI); return res.end("κ not in substrate index");
}

// dev WEB proxy — Holo Browser fetches `<base>web?url=<URL>` to load the LIVE web2 (server-side, so
// no CORS / X-Frame-Options block); it then mints those bytes into a κ and re-derives them (Law L5)
// before rendering. DEV-ONLY (not part of the shipped serverless OS); mirrors Holo Browser's
// documented optional companion proxy ("absent on static GitHub Pages").
// onionProxy(target, res, override) — a .onion target cannot be fetched directly (no DNS / IP; only Tor
// knows the rendezvous). Route it through the configured Tor transport: a per-request override (the shell's
// user selection, b64url JSON {kind,endpoint}) wins, else HOLO_ONION_* env. No transport → honest 501 (never
// a fake render). The transport ACTUALLY used is pinned in x-holo-onion-transport so the page's receipt is
// auditable; x-holo-direct-tor:false is always set — this host does not carry native Tor circuits.
// managedTor() — memoized: reuse a running Tor, else κ-verify + launch one (Brave model, zero user install).
// Refuses to run an unpinned/unverified binary (Law L5). No-op-fast when nothing is pinned → onionProxy then
// answers the honest 501. The host can spawn a process; a pure static deploy cannot (handled by ensureTor).
let _managedTor = null;
function managedTor() {
  if (_managedTor) return _managedTor;
  const cacheDir = join(OS2, "../.holo-tor");
  // consume the pin written by `node tools/holo-tor-fetch.mjs` (κ of the verified Tor binary + its path).
  let pin = null; try { const pf = join(cacheDir, "tor-pin.json"); if (existsSync(pf)) pin = JSON.parse(readFileSync(pf, "utf8")); } catch {}
  _managedTor = ensureTor(pin ? { binPath: pin.bin } : {}, {
    net, spawn, fetchImpl: fetch, env: process.env, platform: process.platform, arch: process.arch,
    ...(pin && pin.kappa ? { kappa: pin.kappa } : {}),
    readFile: async (p) => new Uint8Array(readFileSync(p)), exists: (p) => existsSync(p), cacheDir,
    sha256hex: async (u8) => createHash("sha256").update(u8).digest("hex"), blake3hex: async (u8) => torBlake3(u8),
    onStatus: (s) => console.log("[holo-tor]", JSON.stringify(s)),
  }).catch((e) => ({ ok: false, reason: (e && e.message) || String(e) }));
  return _managedTor;
}

async function onionProxy(target, res, override) {
  // priority: explicit per-request override → HOLO_ONION_* env → AUTO-DETECTED local Tor (9050/9150) →
  // MANAGED Tor (we provision a κ-verified one). This is what makes onion paste-and-go with NO user install.
  let overrideCfg = null;
  if (override) { try { overrideCfg = JSON.parse(Buffer.from(override.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); } catch {} }
  let mt = null;
  if (!normalizeTransport(overrideCfg)) { try { mt = await managedTor(); } catch {} }   // ensure a Tor exists (idempotent) before we resolve the transport
  const transport = normalizeTransport(overrideCfg) || await resolveActiveTransport({ override: overrideCfg, net });
  // honest trust state for the receipt/headers: a real Tor circuit (managed/user) vs a gateway; anonymity is
  // best-effort (host proxy → Tor), NEVER Tor-Browser-grade — x-holo-direct-tor stays false (the TAB isn't Tor).
  const onionTrust = transport && transport.kind === "gateway" ? "gateway" : (mt && mt.ok && mt.source) ? mt.source : "user-tor";
  const anonGrade = transport && transport.kind === "gateway" ? "none" : (mt && mt.anonymityGrade) || "best-effort";
  const H = { ...COI, "access-control-allow-origin": "*", "cache-control": "no-store", "x-holo-direct-tor": "false", "x-holo-onion-trust": onionTrust, "x-holo-anonymity-grade": anonGrade };
  if (!transport) {
    res.writeHead(501, { ...H, "content-type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset=utf-8><body style="margin:0;background:#05070d;color:#e8eef9;font:15px system-ui;min-height:100vh;display:grid;place-items:center;text-align:center;padding:30px"><div style="max-width:560px"><div style="font-size:34px">🧅</div><div style="font-weight:650;margin:12px 0 6px">Can't reach Tor</div><div style="color:#7d8aa6;font:12.5px ui-monospace,monospace;word-break:break-all">${String(target).replace(/[<>&]/g, "")}</div><div style="color:#cbd3e6;margin-top:14px;font-size:13px;line-height:1.6">Onion services live only on the Tor network. To browse them, run <b>Tor</b> locally — the omnibar then reaches any <code>.onion</code> automatically (no per-site setup):<br><span style="color:#a78bfa">• Tor Browser → it listens on 127.0.0.1:9150</span><br><span style="color:#a78bfa">• <code>tor</code> daemon / Arti → 127.0.0.1:9050</span><br><span style="color:#7d8aa6">Public onion HTTP gateways are mostly defunct; set one in the omnibar only if you have a working endpoint.</span></div></div></body>`);
  }
  try {
    const out = await onionFetch(target, transport, { fetchImpl: fetch, net });
    if (!out) { res.writeHead(502, { ...H, "content-type": "text/plain" }); return res.end("onion transport returned nothing"); }
    res.writeHead(out.status >= 200 && out.status < 500 ? out.status : 502,
      { ...H, "content-type": out.contentType || "text/html; charset=utf-8", "x-holo-onion-transport": transport.kind + ":" + transport.endpoint });
    res.end(Buffer.from(out.bytes));
  } catch (e) { res.writeHead(502, { ...H, "content-type": "text/plain" }); res.end("onion transport failed: " + ((e && e.message) || e)); }
}

async function webProxy(target, res, onionOverride) {
  if (!target) { res.writeHead(400, COI); return res.end("missing url"); }
  // a .onion host never resolves on the open internet — hand it to the Tor transport, not a direct fetch.
  try { if (/\.onion$/i.test(new URL(/^https?:\/\//i.test(target) ? target : "http://" + target).hostname)) return onionProxy(/^https?:\/\//i.test(target) ? target : "http://" + target, res, onionOverride); } catch {}
  // Un-HTML-encode entities that leak in from rewritten hrefs (a result link like
  // …/l/?uddg=…&amp;rut=… → real "&"). URLs never legitimately contain a literal "&amp;".
  target = String(target).replace(/&amp;/gi, "&").replace(/&#0?38;/g, "&");
  if (!/^https?:\/\//i.test(target)) target = "https://" + String(target).replace(/^\/+/, "");
  // DuckDuckGo wraps each result link in a /l/?uddg=<dest> redirect — unwrap to the real destination
  // so a clicked result loads the page itself, not DDG's JS interstitial (which mints to a blank κ).
  try { const u = new URL(target); if (/(^|\.)duckduckgo\.com$/i.test(u.hostname) && /^\/l\/?$/.test(u.pathname) && u.searchParams.get("uddg")) target = u.searchParams.get("uddg"); } catch (e) {}
  try {
    const r = await fetch(target, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" } });
    // DUMB PIPE: return the raw bytes. Holo Browser's loading-seam SW (browser-sw.js) does all the
    // work on top — it mints the bytes into a κ, injects <base>, rewrites links to webview/w/… and
    // proxies subresources back through here. (An earlier version injected <base>/click-intercept
    // here; that DOUBLE-handled what the SW already does and broke clicked links — keep it dumb.)
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status >= 200 && r.status < 500 ? r.status : 502,
      { ...COI, "content-type": r.headers.get("content-type") || "text/html; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" });
    res.end(buf);
  } catch (e) { res.writeHead(502, { ...COI, "content-type": "text/plain", "access-control-allow-origin": "*" }); res.end("web proxy failed: " + ((e && e.message) || e)); }
}

// dev MCP forwarder — the OS roster (/.well-known/mcp.json) declares the MCP endpoint at /mcp;
// this realizes it on the dev host by forwarding the JSON-RPC bytes to the substrate MCP server
// (os/mcp/holo-mcp-http.mjs, port 8787). Same-origin for the apps (COEP-safe), content-blind,
// DEV-ONLY (not part of the sealed os/ closure — on a hosted deploy the MCP server fronts /mcp itself).
async function mcpProxy(req, res) {
  const H = { ...COI, "access-control-allow-origin": "*", "cache-control": "no-store" };
  if (req.method === "OPTIONS") { res.writeHead(204, { ...H, "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-allow-headers": "content-type,accept,mcp-session-id" }); return res.end(); }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    try {
      const fwdHeaders = { "content-type": req.headers["content-type"] || "application/json", accept: req.headers["accept"] || "application/json, text/event-stream" };
      if (req.headers["mcp-session-id"]) fwdHeaders["mcp-session-id"] = req.headers["mcp-session-id"];
      const r = await fetch("http://127.0.0.1:8787/mcp", { method: req.method, headers: fwdHeaders, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const out = { ...H, "content-type": r.headers.get("content-type") || "application/json" };
      if (r.headers.get("mcp-session-id")) out["mcp-session-id"] = r.headers.get("mcp-session-id");
      res.writeHead(r.status, out);
      if (r.body) { for await (const chunk of r.body) res.write(chunk); }   // stream SSE bodies through
      res.end();
    } catch (e) { res.writeHead(502, { ...H, "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "substrate MCP server unreachable on :8787 — start it with: node os/mcp/holo-mcp-http.mjs" } })); }
  });
}

// PER-APP MCP — every holospace is its own MCP server (its declared tools/resources + the universal
// substrate verbs), reachable at /~<app>/mcp with discovery at /~<app>/.well-known/mcp.json. This is
// what makes any holo-native app INSTANTLY agent-accessible: point an MCP host at one app, get exactly
// that app's surface. "Per-app server" is a registry FILTER over the one in-process engine (shared
// forge κ-store), not N processes — and unlike the aggregate /mcp it needs no separate :8787 process.
const _appManifest = (id) => { try { return JSON.parse(readFileSync(join(APPS, "apps", id, "holospace.json"), "utf8")); } catch { return null; } };
// a per-app resolver over the app's OWN declared resources: index each resource doc (and its @graph
// nodes) by content address so resolve_object / declarative handlers serve self-verifying objects.
function appMcpResolver(id, manifest) {
  const store = new Map();
  const load = (uri) => { const tail = String(uri).split("/").pop();
    for (const c of [join(APPS, uri), join(APPS, "apps", id, tail), join(APPS, "apps", uri)])
      try { if (existsSync(c) && statSync(c).isFile()) return JSON.parse(readFileSync(c, "utf8")); } catch {}
    return null; };
  for (const r of (manifest && manifest.resources) || []) { const doc = load(r.uri);
    if (doc) { store.set(r.uri, doc); for (const o of doc["@graph"] || []) if (o.id) store.set(o.id, o); } }
  return (uri) => store.get(uri) || null;
}
function appMcp(req, res, id) {
  const manifest = _appManifest(id);
  const H = { ...COI, "access-control-allow-origin": "*", "cache-control": "no-store" };
  if (!manifest) { res.writeHead(404, { ...H, "content-type": "application/json" }); return res.end(JSON.stringify({ error: "no such holospace: " + id })); }
  if (req.method === "OPTIONS") { res.writeHead(204, { ...H, "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "content-type,accept" }); return res.end(); }
  const registry = buildAppRegistry({ ...manifest, id });
  const resolve = appMcpResolver(id, manifest);
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { res.writeHead(400, { ...H, "content-type": "application/json" }); return res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })); }
    try { const out = await mcpHandle(body, { registry, resolve });   // the dependency-free JSON-RPC core
      res.writeHead(200, { ...H, "content-type": "application/json" }); res.end(JSON.stringify(out)); }
    catch (e) { res.writeHead(500, { ...H, "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: body && body.id || null, error: { code: -32000, message: (e && e.message) || String(e) } })); }
  });
}
const appMcpWellKnown = (res, id) => {
  const manifest = _appManifest(id);
  const H = { ...COI, "access-control-allow-origin": "*", "cache-control": "no-store", "content-type": "application/json" };
  if (!manifest) { res.writeHead(404, H); return res.end(JSON.stringify({ error: "no such holospace: " + id })); }
  const doc = { ...descriptor(buildAppRegistry({ ...manifest, id })), transport: "streamable-http", endpoint: `/~${id}/mcp`,
    note: "Per-app MCP discovery — this holospace's tools + the universal substrate verbs; resources are self-verifying UOR objects (Law L5)." };
  res.writeHead(200, H); res.end(JSON.stringify(doc, null, 2));
};

// PER-APP UNIFIED REST API — every holospace exposes /~<app>/api/* (ingress + egress of κ-addressed
// object streams) over the SAME registry/resolver as MCP. A dev-persistent ingest store per app lets
// POST /o → GET /o/<κ> round-trip. The price is opt-in (a holospace.json `apiPrice`) → HTTP 402.
const _apiStores = new Map();   // appId → Map(κ → object) (dev ingest store; OPFS/κ-store in the browser tier)
const apiStoreOf = (id) => { let s = _apiStores.get(id); if (!s) { s = new Map(); _apiStores.set(id, s); } return s; };
function appApi(req, res, id, sub) {
  const manifest = _appManifest(id);
  const H = { ...COI, "access-control-allow-origin": "*", "cache-control": "no-store" };
  if (!manifest) { res.writeHead(404, { ...H, "content-type": "application/json" }); return res.end(JSON.stringify({ error: "no such holospace: " + id })); }
  const registry = buildAppRegistry({ ...manifest, id });
  const store = apiStoreOf(id);
  const mcpResolve = appMcpResolver(id, manifest);
  const resolve = async (k) => store.get(k) || mcpResolve(k);
  const price = manifest.apiPrice || null;                          // opt-in monetisation (HTTP 402)
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = raw; if (raw && (headers["content-type"] || "").includes("json")) { try { body = JSON.parse(raw); } catch {} }
    const ctx = { appId: id, registry, resolve, store, price, now: Date.now(),
      stream: (q) => defaultApiStream(registry, resolve) };
    try {
      const out = await handleApi({ method: req.method, path: "/" + sub.replace(/^\/+/, ""), query: Object.fromEntries(new URLSearchParams((req.url || "").split("?")[1] || "")), headers, body }, ctx);
      if (out.iterator) {   // a κ-object stream → SSE if the client asked, else NDJSON
        const wantSse = (headers.accept || "").includes("text/event-stream");
        res.writeHead(out.status, { ...H, ...(out.headers || {}), "content-type": wantSse ? "text/event-stream" : "application/x-ndjson" });
        return res.end(wantSse ? await collectSse(out.iterator) : await collectNdjson(out.iterator));
      }
      res.writeHead(out.status, { ...H, ...(out.headers || {}) }); res.end(out.body || "");
    } catch (e) { res.writeHead(500, { ...H, "content-type": "application/json" }); res.end(JSON.stringify({ error: "api_error", message: (e && e.message) || String(e) })); }
  });
}
async function* defaultApiStream(registry, resolve) { for (const r of registry.resources || []) { const o = await resolve(r.uri); if (o) yield o; } }

// dev PAIR mailbox — a CONTENT-BLIND rendezvous for "scan QR to Access" (Holo Pair). The phone POSTs
// the E2E-encrypted, operator-signed grant under a single-use channel; the desktop GETs it (then it is
// deleted — single-use). The relay never inspects the bytes (they are encrypted + signed; the desktop
// re-derives the operator κ and refuses tampering, Law L5), exactly like holo-wire's content-blind
// relay. DEV-ONLY (mirrors the messenger P2 transport; on a static Pages deploy a hosted relay/mesh
// plays this role). In-memory, 5-min TTL, 64 KB cap.
const PAIR_BOX = new Map();
const PAIR_TTL = 5 * 60 * 1000;
function pairMailbox(req, res, channel) {
  for (const [k, v] of PAIR_BOX) if (Date.now() - v.at > PAIR_TTL) PAIR_BOX.delete(k);
  const H = { ...COI, "access-control-allow-origin": "*", "cache-control": "no-store" };
  if (req.method === "OPTIONS") { res.writeHead(204, { ...H, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" }); return res.end(); }
  if (req.method === "POST" || req.method === "PUT") {
    const chunks = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > 65536) { req.destroy(); return; } chunks.push(c); });
    req.on("end", () => { PAIR_BOX.set(channel, { bytes: Buffer.concat(chunks), at: Date.now() }); res.writeHead(204, H); res.end(); });
    req.on("error", () => { try { res.writeHead(400, H); res.end(); } catch {} });
    return;
  }
  const e = PAIR_BOX.get(channel);
  if (!e) { res.writeHead(204, H); return res.end(); }                 // nothing yet — desktop keeps polling
  PAIR_BOX.delete(channel);                                            // single-use
  res.writeHead(200, { ...H, "content-type": "application/octet-stream" }); res.end(e.bytes);
}

// dev DEVELOP backend — runs the offline super-resolution → κ-pin pipeline (develop-sr.mjs)
// and streams its NDJSON progress. ffmpeg reads the source URL directly (HLS/DASH/MP4/WebM),
// upscales, re-encodes to CMAF, pins every byte, writes a PROV-O receipt, registers the owned
// κ-item. DEV-ONLY (mirrors /ingest); on a static deploy this runs offline as a CLI.
// pinRoute — Share's "Sovereign cloud" backend. The page POSTs a sealed CAR (the whole holospace, opaque
// bytes); we upload it to PUBLIC IPFS via Pinata and return its content id, so a phone anywhere can pull it
// back from any trustless gateway (holo-workspace-sync.openCarByCid) and re-derive every block (L5). The
// IPFS credential lives ONLY here (PINATA_JWT_FILE, default C:/Users/pavel/.pinata.jwt), never in the page.
// Absent token → an honest 503 so the UI falls back to the serverless link / file rather than faking reach.
const PINATA_JWT_FILE = process.env.PINATA_JWT_FILE || "C:/Users/pavel/.pinata.jwt";
let _pinJwt; const pinJwt = () => { if (_pinJwt === undefined) { try { _pinJwt = readFileSync(PINATA_JWT_FILE, "utf8").trim(); } catch { _pinJwt = null; } } return _pinJwt; };
// Pinata's own gateway serves a freshly pinned CID immediately; the public trustless gateways catch up via
// the DHT within minutes. Lead with Pinata so the scan/open resolves instantly, keep the others as the
// censorship-resistant, no-single-host fallback (Law L1: location is a latency choice, not the identity).
const PIN_GATEWAYS = ["https://gateway.pinata.cloud", "https://trustless-gateway.link", "https://ipfs.io", "https://dweb.link", "https://w3s.link"];
function pinRoute(req, res) {
  if (req.method !== "POST") { res.writeHead(405, COI); return res.end("POST only"); }
  const jwt = pinJwt();
  if (!jwt) { res.writeHead(503, { ...COI, "content-type": "application/json", "access-control-allow-origin": "*" }); return res.end(JSON.stringify({ error: "no pin credential configured" })); }
  const chunks = []; let n = 0;
  req.on("data", (c) => { n += c.length; if (n > 64 * 1024 * 1024) req.destroy(); else chunks.push(c); });   // 64MB ceiling for one shared holospace
  req.on("end", async () => {
    const car = Buffer.concat(chunks);
    if (!car.length) { res.writeHead(400, COI); return res.end("empty body"); }
    try {
      const fd = new FormData();
      fd.append("file", new Blob([car], { type: "application/vnd.ipld.car" }), "holospace.car");
      fd.append("network", "public");
      fd.append("name", "holo-share/" + createHash("sha256").update(car).digest("hex").slice(0, 16));
      const r = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: fd, signal: AbortSignal.timeout(120000) });
      const j = await r.json().catch(() => ({}));
      const carCid = j && j.data && j.data.cid;
      if (!carCid) { res.writeHead(502, { ...COI, "content-type": "application/json", "access-control-allow-origin": "*" }); return res.end(JSON.stringify({ error: "pin failed", detail: String(JSON.stringify(j)).slice(0, 200) })); }
      sendJson(res, { carCid, gateways: PIN_GATEWAYS, bytes: car.length });
    } catch (e) { res.writeHead(502, { ...COI, "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify({ error: "pin error", detail: String(e && e.message || e).slice(0, 200) })); }
  });
}

function developRoute(req, res) {
  if (req.method !== "POST") { res.writeHead(405, COI); return res.end("POST only"); }
  const chunks = []; let n = 0;
  req.on("data", (c) => { n += c.length; if (n > 100000) req.destroy(); else chunks.push(c); });
  req.on("end", () => {
    let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch {}
    if (!body.source) { res.writeHead(400, COI); return res.end("missing source"); }
    const height = Math.max(360, Math.min(4320, parseInt(body.height, 10) || 2160));
    const seconds = Math.max(0, Math.min(120, parseInt(body.seconds, 10) || 12));
    const id = (String(body.id || "src").replace(/[^\w-]/g, "").slice(0, 24)) || "src";
    const args = [join(here, "develop-sr.mjs"), "--json", "--source", String(body.source), "--height", String(height),
      "--seconds", String(seconds), "--id", id, "--title", String(body.title || "Untitled").slice(0, 80)];
    if (body.poster) args.push("--poster", String(body.poster));
    if (body.topics) args.push("--topics", String(body.topics));
    res.writeHead(200, { ...COI, "content-type": "application/x-ndjson", "cache-control": "no-store", "access-control-allow-origin": "*" });
    const p = spawn(process.execPath, args, { cwd: here, windowsHide: true });
    let finished = false;
    p.stdout.on("data", (d) => res.write(d));
    p.on("close", (code) => { finished = true; if (code && code !== 0) res.write(JSON.stringify({ stage: "error", msg: "exit " + code }) + "\n"); res.end(); });
    res.on("close", () => { if (!finished) { try { p.kill(); } catch {} } });   // kill only on real client disconnect
  });
}

// dev WATCH-TOGETHER relay — a content-blind room: GET = an SSE downstream, POST = a
// message broadcast to every OTHER peer in the room. Carries playback sync + WebRTC
// signalling for reaction cameras (the relay never inspects the payload). DEV-ONLY
// (mirrors the Holo Pair mailbox; a hosted relay/mesh plays this role on a static deploy).
const ROOMS = new Map();                                   // roomId -> Map(peerId -> res)
function roomRoute(req, res, roomId) {
  const peer = new URLSearchParams((req.url || "").split("?")[1] || "").get("peer") || Math.random().toString(36).slice(2);
  let room = ROOMS.get(roomId); if (!room) { room = new Map(); ROOMS.set(roomId, room); }
  if (req.method === "GET") {
    res.writeHead(200, { ...COI, "content-type": "text/event-stream", "cache-control": "no-store", "connection": "keep-alive", "access-control-allow-origin": "*" });
    res.write(": ok\n\n"); room.set(peer, res);
    const ka = setInterval(() => { try { res.write(": ka\n\n"); } catch {} }, 25000);
    req.on("close", () => {
      clearInterval(ka); room.delete(peer);
      const bye = `data: ${JSON.stringify({ k: "bye", from: peer })}\n\n`;
      for (const r of room.values()) { try { r.write(bye); } catch {} }
      if (!room.size) ROOMS.delete(roomId);
    });
    return;
  }
  if (req.method === "POST") {
    const chunks = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > 200000) req.destroy(); else chunks.push(c); });
    req.on("end", () => {
      res.writeHead(204, { ...COI, "access-control-allow-origin": "*" }); res.end();
      const data = Buffer.concat(chunks).toString();
      for (const [pid, r] of room) { if (pid === peer) continue; try { r.write(`data: ${data}\n\n`); } catch {} }
    });
    return;
  }
  res.writeHead(405, COI); res.end();
}

export function makeHandler(stats = { os2: 0, apps: 0, orig: new Set(), miss: new Set() }) {
  return (req, res) => {
    let route = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
    // CROSS-REPO ALIAS: the GGUF forge (apps/q/forge/*) imports the OS's holo-uor via the sibling-repo
    // layout "/holo-os/system/os/<path>". On this canonical mount the OS lives at root, so strip that
    // prefix → the OS-relative path. Lets Q's .holo WebGPU brain (holo-brain-engine.mjs) load from the shell.
    if (route.startsWith("/holo-os/system/os/")) route = route.slice("/holo-os/system/os".length);
    // dev media backend — capability probe + SoundCloud (yt-dlp) proxy, served same-origin
    if (route === "/caps") return sendJson(res, { fetch: true, ingestAudio: false, ytdlp: HAS_YTDLP, soundcloud: HAS_YTDLP });
    if (route.startsWith("/sc/")) { scRoute(route.slice(4), new URLSearchParams((req.url || "").split("?")[1] || ""), res, req); return; }
    if (route === "/audio-proxy") { pipeUpstream(new URLSearchParams((req.url || "").split("?")[1] || "").get("url") || "", req, res); return; }
    if (route === "/weather") { weatherRoute(new URLSearchParams((req.url || "").split("?")[1] || ""), res); return; }   // dev weather proxy for the Holo Widgets weather tile
    if (route === "/develop") { developRoute(req, res); return; }   // dev SR→κ-pin backend (Holo Player "Develop to 8K")
    if (route === "/api/pin") { pinRoute(req, res); return; }        // dev Share "Sovereign cloud" backend (pin a sealed CAR to public IPFS — Law L1 worldwide reach)
    const mRoom = route.match(/^\/room\/([\w-]{4,64})$/);            // dev Watch-Together room relay (SSE + POST)
    if (mRoom) { roomRoute(req, res, mRoom[1]); return; }
    if (route === "/mcp") { mcpProxy(req, res); return; }           // dev MCP forwarder — realizes the roster's declared /mcp endpoint (→ the substrate MCP server on :8787)
    if ((route === "/web" || route.endsWith("/web")) && /[?&]url=/.test(req.url || "")) { const qs = new URLSearchParams((req.url || "").split("?")[1] || ""); webProxy(qs.get("url"), res, qs.get("onion")); return; }
    const mPair = route.match(/^\/\.pair\/([A-Za-z0-9\-_]{8,64})$/);   // Holo Pair content-blind rendezvous
    if (mPair) { pairMailbox(req, res, mPair[1]); return; }
    const mAppApi = route.match(/^\/~([a-z0-9._-]{1,40})\/api(?:\/(.*))?$/i);            // per-app unified REST API (κ-stream ingress/egress)
    if (mAppApi) { appApi(req, res, mAppApi[1], mAppApi[2] || ""); return; }
    const mAppWk = route.match(/^\/~([a-z0-9._-]{1,40})\/\.well-known\/mcp\.json$/i);   // per-app MCP discovery
    if (mAppWk) { appMcpWellKnown(res, mAppWk[1]); return; }
    const mAppMcp = route.match(/^\/~([a-z0-9._-]{1,40})\/mcp$/i);                       // per-app MCP endpoint (JSON-RPC)
    if (mAppMcp) { appMcp(req, res, mAppMcp[1]); return; }
    // PRETTY SHARE LINK (/~<app>#k=<cid>): a short, attractive Telegram-ready address. The path is a
    // human HINT; the #k= (a CIDv1, client-side) is the TRUTH that re-derives (Law L5). The route
    // serves the share-to-run boot page with a per-app Open Graph card so the chat preview is a
    // beautiful, content-derived κ-identicon — not a raw URL. /~<app>/og.svg is that identicon.
    const mTilde = route.match(/^\/~([a-z0-9._-]{1,40})(\/og\.svg)?$/i);
    if (mTilde) {
      const meta = appMeta(mTilde[1]);
      if (!meta) { res.writeHead(404, COI); return res.end("no such holospace: " + mTilde[1]); }
      if (mTilde[2]) {   // /~<app>/og.svg → the content-derived identicon card
        res.writeHead(200, { ...COI, "content-type": "image/svg+xml; charset=utf-8", "cache-control": "max-age=600" });
        return res.end(identiconSvg(meta.root, { size: 320, label: meta.name }));
      }
      const boot = readRel("holospace.html", stats);
      if (!boot) { res.writeHead(404, COI); return res.end("boot page missing"); }
      const host = req.headers.host || ("127.0.0.1");
      const img = `http://${host}/~${mTilde[1]}/og.svg`;
      const og = `\n  <base href="/">\n  <meta property="og:type" content="website">`
        + `\n  <meta property="og:title" content="${meta.name.replace(/"/g, "&quot;")}">`
        + `\n  <meta property="og:description" content="${meta.summary.replace(/"/g, "&quot;")}">`
        + `\n  <meta property="og:image" content="${img}">`
        + `\n  <meta name="twitter:card" content="summary_large_image">`
        + `\n  <meta name="twitter:image" content="${img}">`
        + `\n  <meta name="holo:app" content="${mTilde[1]}">`;
      const html = boot.buf.toString("utf8").replace(/<head>/i, "<head>" + og);
      res.writeHead(200, { ...COI, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(html);
    }
    // Hologram OS boots into THE ONE canonical holospace shell (os/usr/share/frame/shell.html) — the
    // single desktop that hosts every app from the Hologram Apps repo in its canvas, by content address
    // (Law L5). It is the default AND only shell: the greeter, deep-links and holospace.html all route
    // here. The web, a holo://κ, an IPFS CID and the native AI are all reached from its omnibar.
    if (route === "/" || route === "") {
      // The marketing gateway (repo-root index.html, the "Power up" landing) is the canonical entry: it
      // runs the cinematic boot (splash → SDDM greeter → this shell). Serve it at / when present so the
      // FULL experience works on ONE flat origin; fall back to the frictionless shell redirect if absent.
      const gw = join(here, "../../index.html");
      if (existsSync(gw)) {
        res.writeHead(200, { ...COI, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return res.end(readFileSync(gw));
      }
      const qs = (req.url || "").includes("?") ? "?" + (req.url.split("?")[1] || "") : "";
      res.writeHead(302, { ...COI, Location: "/shell.html" + qs });
      return res.end();
    }
    let rel;
    const m = route.match(/^\/\.holo\/sha256\/([a-f0-9]{64})(?:\.\w+)?$/i);
    const mb = route.match(/^\/\.holo\/blake3\/([a-f0-9]{64})(?:\.\w+)?$/i);   // the unified-substrate σ-axis route
    if (m) { rel = hexToPath.get(m[1].toLowerCase()); if (!rel) return serveByKappa(m[1].toLowerCase(), route, res, stats); }   // closure miss → the full-substrate κ-route, re-derived (Law L5)
    else if (mb) { rel = blakeToPath.get(mb[1].toLowerCase()); if (!rel) { stats.miss.add("blake3:" + mb[1].slice(0, 10)); res.writeHead(404, COI); return res.end("blake3 κ not in substrate index"); } }
    else if (/^\/\.holo\/sha256\/.+/i.test(route)) { const tail = route.replace(/^\/\.holo\/sha256\//i, ""); rel = tail.includes("/") ? tail : "_shared/" + tail; }  // gen-imports left a path/filename in the κ slot → resolve as a normal path
    else { rel = route.replace(/^\/+/, "") || "home.html"; rel = rel.replace(/^(?:system\/)?os\//, ""); if (rel.endsWith("/")) rel += "index.html"; }   // tolerate nested-layout refs (the gateway boot uses a system/os/ or os/ prefix) → resolve them flat
    let got = readRel(rel, stats);
    // a bare directory ref (no extension, e.g. /apps/hub) → resolve its index.html, like any static
    // host. Makes the shareable "open in one tap" URL work without a trailing slash or /index.html.
    if (!got && !extname(rel) && !rel.endsWith("/index.html")) { const idx = rel.replace(/\/$/, "") + "/index.html"; got = readRel(idx, stats); if (got) rel = idx; }
    if (!got) { stats.miss.add(rel); res.writeHead(404, COI); return res.end("not found: " + rel); }
    const ext = extname(m ? rel : route).toLowerCase() || extname(rel).toLowerCase();
    // Vendored model artifacts (weights + ORT wasm) are pinned/content-addressed → safe to CACHE so the
    // browser reuses them (and ORT's compiled-wasm cache) across reloads instead of recompiling every
    // time. That cold recompile is what makes first use feel laggy. Re-vendoring? hard-reload to bust it.
    const heavy = /\.(wasm|onnx|bin)$/.test(rel) || rel.includes("voice/vendor/");
    // Holo Browser's loading-seam SWs claim a DEEPER scope than their script path (browser-sw → /webview/,
    // ipfs-sw → /ipfsview/). Allow it: the script must answer with Service-Worker-Allowed for that scope.
    const swAllow = /(?:^|\/)(browser-sw|ipfs-sw)\.js$/.test(rel) ? { "Service-Worker-Allowed": "/" } : {};
    res.writeHead(200, { ...COI, ...swAllow, "content-type": TYPES[ext] || "application/octet-stream", "cache-control": heavy ? "public, max-age=86400" : "no-store" });
    res.end(got.buf);
  };
}

export function startServer(port = 0) {
  const stats = { os2: 0, apps: 0, orig: new Set(), miss: new Set() };
  const srv = http.createServer(makeHandler(stats));
  // Bind loopback by default (safe: the /web · /mcp · /sc proxy routes stay off the network). Set
  // HOLO_HOST=0.0.0.0 to expose on the LAN for on-device preview (e.g. a phone on the same Wi-Fi).
  const host = process.env.HOLO_HOST || "127.0.0.1";
  return new Promise((resolve) => srv.listen(port, host, () => resolve({ port: srv.address().port, host, stats, close: () => srv.close(), server: srv })));
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("holo-serve-fhs.mjs")) {
  const { port } = await startServer(parseInt(process.argv[2] || process.env.PORT || "8300", 10));
  console.log(`holo-serve-fhs: OS2 booting at  http://127.0.0.1:${port}/   →  the ONE canonical shell (/shell.html, in OS2; the gateways take the SDDM greeter → this same shell)`);
  console.log(`  κ-route index: ${hexToPath.size} sha256 · ${blakeToPath.size} blake3 (substrate σ-axis) → paths · ${hexToAbs.size} full-substrate objects (re-derived)`);
}
