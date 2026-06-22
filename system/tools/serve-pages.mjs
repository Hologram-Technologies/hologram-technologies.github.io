#!/usr/bin/env node
// serve-pages.mjs — serve the EXACT GitHub Pages layout on localhost so you can open it in a real
// browser: the gateway (index.html) + llms.txt at /, the OS as the os/ subtree, /.well-known
// mirrored. It is a DUMB static host with NO header help — so the κ Service Worker (os/holo-fhs-sw.js)
// does the flat→FHS mapping + cross-origin isolation, exactly as it will on Pages. localhost is a
// secure context, so the SW + SharedArrayBuffer work.
//
//   node tools/serve-pages.mjs [port=8080]                → serve the SOURCE repo layout
//   node tools/serve-pages.mjs --site _site [port=8080]   → serve an ASSEMBLED artifact (the deploy bytes)
//   --prefix /hologram-os                                 → mount under a project sub-path (parity check)
//
// With --site, the dir is served EXACTLY as GitHub Pages would (gateway at /, OS already at /os/, apps
// vendored) — no source remap. This is the static host the cold-machine harness boots against, so a
// witness sees precisely what a new visitor sees (a real 404 on anything not vendored).

import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, resolve as pResolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");        // system/  (here = system/tools)
const REPO = join(ROOT, "..");        // the repo root — the gateway + the root docs live here
const flag = (k) => { const i = process.argv.indexOf(k); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };
const SITE = flag("--site") ? pResolve(flag("--site")) : null;   // serve an assembled _site instead of the source
const PREFIX = (flag("--prefix") || "").replace(/\/+$/, "");      // optional project sub-path (e.g. /hologram-os)
const BASE = SITE || REPO;            // where bytes are read from
const ROOT_FILES = ["index.html", "README.md", "AGENTS.md", "CONSTITUTION.md"];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".jsonld": "application/ld+json", ".wasm": "application/wasm", ".png": "image/png",
  ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".txt": "text/plain", ".webmanifest": "application/manifest+json", ".gz": "application/gzip" };

function resolve(pathname) {
  let p = pathname.replace(/^\/+/, "");
  if (p === "" || p.endsWith("/")) p += "index.html";
  if (p.split("/").includes("..")) return null;                      // no path traversal
  return join(BASE, p);
}

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
  if (PREFIX) { if (pathname === PREFIX) pathname = "/"; else if (pathname.startsWith(PREFIX + "/")) pathname = pathname.slice(PREFIX.length); }
  let abs = resolve(pathname);
  if (abs && existsSync(abs) && statSync(abs).isDirectory()) abs = join(abs, "index.html");
  // SOURCE mode only: the gateway/JSON-LD reference the OS as `os/…` but the source path is `system/os/…`.
  // An assembled --site already has the OS at `os/`, so this remap is skipped there (it would mask a real
  // unvendored-file 404 — exactly the asymmetry the harness must NOT introduce).
  if (!SITE && (!abs || !existsSync(abs)) && /^\/os\//.test(pathname)) abs = join(REPO, "system", pathname.replace(/^\/+/, ""));
  if (!abs || !existsSync(abs) || !statSync(abs).isFile()) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("404: " + pathname); }
  res.writeHead(200, { "content-type": TYPES[extname(abs).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(abs));
});

const port = parseInt(process.argv.find((a, i) => i >= 2 && /^\d+$/.test(a)) || "8080", 10);
server.on("error", (e) => { console.error("serve-pages:", e.code === "EADDRINUSE" ? `port ${port} in use — try: node tools/serve-pages.mjs ${port + 1}` : e.message); process.exit(1); });
server.listen(port, "127.0.0.1", () => console.log(`Hologram OS (${SITE ? "artifact " + SITE : "source layout"}) → http://127.0.0.1:${port}${PREFIX || ""}/`));
