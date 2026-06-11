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
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { spawn } from "node:child_process";
import { fhsMap } from "../os/lib/holo-fhs-map.mjs";     // the ONE flat→FHS mapping (shared with the Pages SW)

const here = dirname(fileURLToPath(import.meta.url));
export const OS2 = join(here, "../os");
export const APPS = "C:/Users/pavel/Desktop/Hologram Apps";          // the separate apps repo
export const ORIG = "C:/Users/pavel/Desktop/hologram-os/os";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".jsonld": "application/ld+json", ".map": "application/json", ".wasm": "application/wasm",
  ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".gz": "application/gzip", ".webmanifest": "application/manifest+json", ".txt": "text/plain" };
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
async function scRoute(sub, params, res) {
  if (!HAS_YTDLP) return sendJson(res, { error: "yt-dlp not installed on host" });
  try {
    if (sub === "search") { const n = Math.min(50, parseInt(params.get("n") || "24", 10) || 24); const q = params.get("q") || "";
      return sendJson(res, await ytdlp(["-J", "--flat-playlist", "--no-warnings", `scsearch${n}:${q}`])); }
    const url = params.get("url") || "";
    if (!/^https?:\/\/(?:[\w-]+\.)?(?:soundcloud\.com|snd\.sc)\//i.test(url)) return sendJson(res, { error: "not a SoundCloud url" });
    if (sub === "resolve") return sendJson(res, await ytdlp(["-J", "--flat-playlist", "--no-warnings", url]));
    if (sub === "track") return sendJson(res, await ytdlp(["-J", "--no-warnings", url]));
    if (sub === "stream") {                                  // resolve a progressive (http) mp3 → 302 to the CDN; <audio> plays it directly
      const direct = (await ytdlp(["-f", "http_mp3_128/http_mp3_0/bestaudio[protocol^=http]/bestaudio", "-g", "--no-warnings", url], true)).split("\n")[0].trim();
      if (!/^https?:/.test(direct)) return sendJson(res, { error: "no progressive stream" });
      res.writeHead(302, { ...COI, Location: direct, "cache-control": "no-store" }); return res.end();
    }
    return sendJson(res, { error: "unknown sc route" });
  } catch (e) { return sendJson(res, { error: String((e && e.message) || e).slice(0, 300) }); }
}

// hex → os-relative path, from the OS-wide closure (the κ-route's name table).
const closure = (() => { try { return JSON.parse(readFileSync(join(OS2, "etc/os-closure.json"), "utf8")).closure || {}; } catch { return {}; } })();
const hexToPath = new Map();
for (const [p, v] of Object.entries(closure)) { const k = typeof v === "string" ? v : (v.kappa || v.did || v["@id"] || ""); const hex = String(k).split(":").pop(); if (hex) hexToPath.set(hex, p); }

// os-relative path → OS2 FHS physical path. The mapping itself is the ONE shared rule in
// os/lib/holo-fhs-map.mjs — used verbatim by the Pages Service Worker (os/holo-fhs-sw.js), so
// dev (this server) and prod (static Pages + SW) resolve byte-identically. null ⇒ unknown
// top-level (the readRel below then tries the Apps repo / original-os gap fallback).
export function fhsOf(rel) { const p = fhsMap(rel); return p ? join(OS2, p) : null; }

// resolve an os-relative path to bytes: OS2 first, else original. {buf, src} | null
function readRel(rel, stats) {
  // apps resolve from the separate Hologram Apps repo (a holospace boots from anywhere by κ)
  if (rel.startsWith("apps/")) { const a = join(APPS, rel); if (existsSync(a) && statSync(a).isFile()) { stats.apps++; return { buf: readFileSync(a), rel }; } }
  const f = fhsOf(rel);
  if (f && existsSync(f) && statSync(f).isFile()) { stats.os2++; return { buf: readFileSync(f), rel }; }
  const o = join(ORIG, rel);
  if (existsSync(o) && statSync(o).isFile()) { stats.orig.add(rel); return { buf: readFileSync(o), rel }; }
  return null;
}

export function makeHandler(stats = { os2: 0, apps: 0, orig: new Set(), miss: new Set() }) {
  return (req, res) => {
    let route = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
    // dev media backend — capability probe + SoundCloud (yt-dlp) proxy, served same-origin
    if (route === "/caps") return sendJson(res, { fetch: true, ingestAudio: false, ytdlp: HAS_YTDLP, soundcloud: HAS_YTDLP });
    if (route.startsWith("/sc/")) { scRoute(route.slice(4), new URLSearchParams((req.url || "").split("?")[1] || ""), res); return; }
    // The ONE desktop shell (apps/sdk — the SDK/World windowed canvas) is the single canonical
    // Hologram OS environment: every application opens as a window INSIDE it. In dev the bare root
    // opens it directly; the gateways (index.html · /boot.html) take the full chain (SDDM greeter →
    // this same shell). The Platform Manager is folded behind /home.html?manage.
    if (route === "/" || route === "") {
      const qs = (req.url || "").includes("?") ? "?" + (req.url.split("?")[1] || "") : "";
      res.writeHead(302, { ...COI, Location: "/apps/sdk/index.html" + qs });
      return res.end();
    }
    let rel;
    const m = route.match(/^\/\.holo\/sha256\/([a-f0-9]{64})(?:\.\w+)?$/i);
    if (m) { rel = hexToPath.get(m[1].toLowerCase()); if (!rel) { stats.miss.add("κ:" + m[1].slice(0, 10)); res.writeHead(404, COI); return res.end("κ not in closure index"); } }
    else if (/^\/\.holo\/sha256\/.+/i.test(route)) { const tail = route.replace(/^\/\.holo\/sha256\//i, ""); rel = tail.includes("/") ? tail : "_shared/" + tail; }  // gen-imports left a path/filename in the κ slot → resolve as a normal path
    else { rel = route.replace(/^\/+/, "") || "home.html"; if (rel.endsWith("/")) rel += "index.html"; }
    const got = readRel(rel, stats);
    if (!got) { stats.miss.add(rel); res.writeHead(404, COI); return res.end("not found: " + rel); }
    const ext = extname(m ? rel : route).toLowerCase() || extname(rel).toLowerCase();
    res.writeHead(200, { ...COI, "content-type": TYPES[ext] || "application/octet-stream", "cache-control": "no-store" });
    res.end(got.buf);
  };
}

export function startServer(port = 0) {
  const stats = { os2: 0, apps: 0, orig: new Set(), miss: new Set() };
  const srv = http.createServer(makeHandler(stats));
  return new Promise((resolve) => srv.listen(port, "127.0.0.1", () => resolve({ port: srv.address().port, stats, close: () => srv.close(), server: srv })));
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("holo-serve-fhs.mjs")) {
  const { port } = await startServer(parseInt(process.argv[2] || "8300", 10));
  console.log(`holo-serve-fhs: OS2 booting at  http://127.0.0.1:${port}/   →  the ONE desktop shell (apps/sdk; the gateways take the SDDM greeter → this same shell)`);
  console.log(`  closure index: ${hexToPath.size} κ → paths`);
}
