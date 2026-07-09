// serve.mjs — static host for Holo Q + its compiled κ-objects. Serves this app dir at / (so a κ-object at
// ./models/<name> is reachable at /models/<name>) with CORS + HTTP Range. `npm run serve [port]`.
// A compiled κ-object is just static files (manifest.json + b/<κ>.gz), so ANY static host with CORS works —
// HF, S3/R2, Cloudflare Pages, IPFS, nginx. This is the local/self-host option. See README.
import { createServer } from "node:http";
import { stat, open } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));                                  // this app dir (apps/q)
const SHARED = "C:/Users/pavel/Desktop/Hologram OS2/system/os/usr/lib/holo";          // shared engine modules (dev sibling)
const PORT = +(process.argv[2] || process.env.PORT || 8231);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".wasm": "application/wasm", ".css": "text/css", ".svg": "image/svg+xml", ".gz": "application/gzip", ".png": "image/png", ".gguf": "application/octet-stream" };

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
    const file = normalize(join(p.startsWith("/_shared/") ? SHARED : ROOT, p.startsWith("/_shared/") ? p.slice(8) : p));
    if (!file.startsWith(normalize(p.startsWith("/_shared/") ? SHARED : ROOT))) { res.writeHead(403); return res.end("403"); }
    const st = await stat(file);
    const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
    const head = { "content-type": type, "cache-control": "no-store", "access-control-allow-origin": "*", "accept-ranges": "bytes" };
    const range = req.headers.range && /^bytes=(\d*)-(\d*)/.exec(req.headers.range);
    const fh = await open(file, "r");
    try {
      if (range) {                                                                     // HTTP Range (for big files / the streaming engine)
        let s = range[1] ? +range[1] : 0, e = range[2] ? +range[2] : st.size - 1; if (e >= st.size) e = st.size - 1;
        res.writeHead(206, { ...head, "content-range": `bytes ${s}-${e}/${st.size}`, "content-length": e - s + 1 });
        const buf = Buffer.alloc(e - s + 1); await fh.read(buf, 0, buf.length, s); res.end(buf);
      } else {
        res.writeHead(200, { ...head, "content-length": st.size });
        res.end((await fh.readFile()));
      }
    } finally { await fh.close(); }
  } catch { res.writeHead(404); res.end("404"); }
}).listen(PORT, () => console.log(`Holo Q on http://localhost:${PORT}  ·  κ-objects under /models/<name>`));
