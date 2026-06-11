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

// dev WEB proxy — Holo Browser fetches `<base>web?url=<URL>` to load the LIVE web2 (server-side, so
// no CORS / X-Frame-Options block); it then mints those bytes into a κ and re-derives them (Law L5)
// before rendering. DEV-ONLY (not part of the shipped serverless OS); mirrors Holo Browser's
// documented optional companion proxy ("absent on static GitHub Pages").
async function webProxy(target, res) {
  if (!target) { res.writeHead(400, COI); return res.end("missing url"); }
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

export function makeHandler(stats = { os2: 0, apps: 0, orig: new Set(), miss: new Set() }) {
  return (req, res) => {
    let route = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
    // dev media backend — capability probe + SoundCloud (yt-dlp) proxy, served same-origin
    if (route === "/caps") return sendJson(res, { fetch: true, ingestAudio: false, ytdlp: HAS_YTDLP, soundcloud: HAS_YTDLP });
    if (route.startsWith("/sc/")) { scRoute(route.slice(4), new URLSearchParams((req.url || "").split("?")[1] || ""), res); return; }
    if (route === "/develop") { developRoute(req, res); return; }   // dev SR→κ-pin backend (Holo Player "Develop to 8K")
    if (route === "/mcp") { mcpProxy(req, res); return; }           // dev MCP forwarder — realizes the roster's declared /mcp endpoint (→ the substrate MCP server on :8787)
    if ((route === "/web" || route.endsWith("/web")) && /[?&]url=/.test(req.url || "")) { webProxy(new URLSearchParams((req.url || "").split("?")[1] || "").get("url"), res); return; }
    const mPair = route.match(/^\/\.pair\/([A-Za-z0-9\-_]{8,64})$/);   // Holo Pair content-blind rendezvous
    if (mPair) { pairMailbox(req, res, mPair[1]); return; }
    // Hologram OS boots into HOLO BROWSER — the universal navigator over the UOR content-addressable
    // substrate (the "spaceship"): every object (an app, a holospace, the live web, a holo://κ, an
    // IPFS CID, the native AI) is reached the same way, fetched/minted/re-derived + verified (Law L5),
    // in one tab model. The spatial desktop (apps/sdk) is just one object you can navigate to; the
    // Platform Manager is folded behind /home.html?manage.
    if (route === "/" || route === "") {
      const qs = (req.url || "").includes("?") ? "?" + (req.url.split("?")[1] || "") : "";
      res.writeHead(302, { ...COI, Location: "/apps/browser/index.html" + qs });
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
