// Robust keep-alive static server for the κ-disk (Node HTTP/1.1).
//
// The Python dev server opened a NEW TCP connection per request (HTTP/1.0); under
// the κ-disk's thousands of small Range reads that churn wedged the browser
// ("Failed to fetch"). Node's HTTP/1.1 keep-alive reuses a handful of persistent
// connections for all of them — the connection efficiency HTTP/2 would give
// (browser h2 needs TLS+trusted cert, impractical here), without the certs.
//
// Serves _site with: HTTP Range, `?base=N` offset windowing (Chromium hangs on
// Range offsets past a few GB → big offset rides in the URL, small Range header),
// CORS (multi-source from other origins), and COOP/COEP (crossOriginIsolated).
//
// Usage: node serve-ka.mjs <port> [host=127.0.0.1]
import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "_site");
const PORT = +(process.argv[2] || 8096);
const HOST = process.argv[3] || "127.0.0.1";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".txt": "text/plain", ".ansi": "text/plain", ".gguf": "application/octet-stream", ".qvf": "application/octet-stream" };
const H = () => ({
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length",
  "Accept-Ranges": "bytes",
  "Cache-Control": "no-store",
});

const server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    let p = decodeURIComponent(u.pathname);
    if (p === "/" || p.endsWith("/")) p += "index.html";
    const filePath = path.join(SITE, path.normalize(p).replace(/^([/\\])+/, ""));
    if (!filePath.startsWith(SITE)) { res.writeHead(403, H()); return res.end(); }
    let st; try { st = statSync(filePath); } catch { res.writeHead(404, H()); return res.end("not found"); }
    if (st.isDirectory()) { res.writeHead(403, H()); return res.end(); }
    const size = st.size, ctype = TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const base = parseInt(u.searchParams.get("base") || "0", 10) || 0;
    const range = req.headers.range;
    const head = Object.assign(H(), { "Content-Type": ctype });
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        const start = base + parseInt(m[1], 10);
        const end = Math.min(base + (m[2] ? parseInt(m[2], 10) : (size - 1 - base)), size - 1);
        if (start > end || start >= size) { res.writeHead(416, Object.assign(H(), { "Content-Range": `bytes */${size}` })); return res.end(); }
        head["Content-Range"] = `bytes ${start}-${end}/${size}`;
        head["Content-Length"] = end - start + 1;
        res.writeHead(206, head);
        if (req.method === "HEAD") return res.end();
        return createReadStream(filePath, { start, end }).pipe(res);
      }
    }
    head["Content-Length"] = size;
    res.writeHead(200, head);
    if (req.method === "HEAD") return res.end();
    createReadStream(filePath).pipe(res);
  } catch (e) { try { res.writeHead(500, H()); res.end(String(e)); } catch {} }
});
server.keepAliveTimeout = 75000;       // hold idle keep-alive connections (reuse, not churn)
server.headersTimeout = 80000;
server.requestTimeout = 0;
server.listen(PORT, HOST, () => console.log(`κ keep-alive server (HTTP/1.1) on http://${HOST}:${PORT}  dir=${SITE}`));
