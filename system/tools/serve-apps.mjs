// serve-apps.mjs — tiny static server for the Hologram Apps repo (preview/verify only).
// Root = Hologram Apps; "/" redirects to the atlas96 holospace so its relative fetches resolve.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const ROOT = "C:/Users/pavel/Desktop/Hologram Apps";
const PORT = 8792;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".jsonld": "application/ld+json", ".svg": "image/svg+xml",
  ".css": "text/css", ".c": "text/plain", ".h": "text/plain", ".ts": "text/plain",
  ".lean": "text/plain", ".md": "text/plain", ".txt": "text/plain" };

http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/" ) { res.writeHead(302, { location: "/apps/atlas96/index.html" }); return res.end(); }
  if (p.endsWith("/")) p += "index.html";
  try {
    const data = await readFile(join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end("404 " + p); }
}).listen(PORT, () => console.log(`serving Hologram Apps on http://localhost:${PORT}`));
