// Minimal static host for previewing the gateway in a real browser. Serves the repo ROOT, so the
// gateway (index.html + holo-field.mjs + vendor/) and the OS image (system/os/*) both resolve. No
// headers beyond content-type — closest to GitHub Pages. Usage: node system/tools/preview-server.mjs [port]
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");
const PORT = +(process.argv[2] || 8777);
const TYPES = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".json":"application/json", ".jsonld":"application/ld+json", ".wasm":"application/wasm",
  ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml", ".ico":"image/x-icon", ".webp":"image/webp",
  ".woff2":"font/woff2", ".woff":"font/woff", ".ttf":"font/ttf", ".txt":"text/plain; charset=utf-8", ".map":"application/json", ".webmanifest":"application/manifest+json" };

http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]).replace(/^\/+/, "");
  if (p === "" || p.endsWith("/")) p += "index.html";
  let abs = normalize(join(REPO, p));
  if (!abs.startsWith(normalize(REPO))) { res.writeHead(403); return res.end("403"); }
  if (existsSync(abs) && statSync(abs).isDirectory()) abs = join(abs, "index.html");
  if (!existsSync(abs) || !statSync(abs).isFile()) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("404: " + p); }
  res.writeHead(200, { "content-type": TYPES[extname(abs).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(abs));
}).listen(PORT, "127.0.0.1", () => console.log(`Holo gateway preview → http://localhost:${PORT}/`));
