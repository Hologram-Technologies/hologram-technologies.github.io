#!/usr/bin/env node
// serve-pages.mjs — serve the EXACT GitHub Pages layout on localhost so you can open it in a real
// browser: the gateway (index.html) + llms.txt at /, the OS as the os/ subtree, /.well-known
// mirrored. It is a DUMB static host with NO header help — so the κ Service Worker (os/holo-fhs-sw.js)
// does the flat→FHS mapping + cross-origin isolation, exactly as it will on Pages. localhost is a
// secure context, so the SW + SharedArrayBuffer work.
//
//   node tools/serve-pages.mjs [port=8080]   →   open the printed URL

import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");        // system/  (here = system/tools)
const REPO = join(ROOT, "..");        // the repo root — the gateway + the root docs live here
const OS = join(ROOT, "os");          // system/os
const ROOT_FILES = ["index.html", "README.md", "AGENTS.md", "CONSTITUTION.md"];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".jsonld": "application/ld+json", ".wasm": "application/wasm", ".png": "image/png",
  ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".txt": "text/plain", ".webmanifest": "application/manifest+json", ".gz": "application/gzip" };

function resolve(pathname) {
  // Serve the repo LITERALLY — index.html at /, the OS at /system/os/, exactly as the files sit
  // on disk and as GitHub serves them. No remap, so opening the repo with ANY static host behaves
  // identically (the gateway + SW reference real paths). The SW resolves /system/os/* internally.
  let p = pathname.replace(/^\/+/, "");
  if (p === "" || p.endsWith("/")) p += "index.html";
  if (p.split("/").includes("..")) return null;                      // no path traversal
  return join(REPO, p);
}

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
  let abs = resolve(pathname);
  if (abs && existsSync(abs) && statSync(abs).isDirectory()) abs = join(abs, "index.html");
  // the gateway/JSON-LD reference the OS as `os/…`; the real path is `system/os/…`. Resolve both
  // so declarative links also work (boot uses whichever the gateway probes).
  if ((!abs || !existsSync(abs)) && /^\/os\//.test(pathname)) abs = join(REPO, "system", pathname.replace(/^\/+/, ""));
  if (!abs || !existsSync(abs) || !statSync(abs).isFile()) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("404: " + pathname); }
  res.writeHead(200, { "content-type": TYPES[extname(abs).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(abs));
});

const port = parseInt(process.argv[2] || "8080", 10);
server.on("error", (e) => { console.error("serve-pages:", e.code === "EADDRINUSE" ? `port ${port} in use — try: node tools/serve-pages.mjs ${port + 1}` : e.message); process.exit(1); });
server.listen(port, "127.0.0.1", () => console.log(`Hologram OS (GitHub-Pages layout) → http://127.0.0.1:${port}/`));
