// serve-roots-demo.mjs — a tiny static server for the LIVE κ-Roots browser check. Serves the real OS tree
// (os/) so the production modules' real-tree imports resolve verbatim, with "/" → the live verification page.
// Localhost is a WebCrypto secure context, so holo-identity.enroll() mints real keys in the browser.
//   node tools/serve-roots-demo.mjs [port]
import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "os");
const PORT = +(process.argv[2] || 8385);
const HOST = "127.0.0.1";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".jsonld": "application/ld+json", ".wasm": "application/wasm", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain" };
const H = () => ({ "Access-Control-Allow-Origin": "*", "Cross-Origin-Opener-Policy": "same-origin", "Cache-Control": "no-store" });

const server = http.createServer((req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/" || p === "") p = "/usr/share/frame/holo-roots-live.html";
    const filePath = path.join(OS, path.normalize(p).replace(/^([/\\])+/, ""));
    if (!filePath.startsWith(OS)) { res.writeHead(403, H()); return res.end(); }
    let st; try { st = statSync(filePath); } catch { res.writeHead(404, H()); return res.end("not found: " + p); }
    if (st.isDirectory()) { res.writeHead(403, H()); return res.end(); }
    res.writeHead(200, Object.assign(H(), { "Content-Type": TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream", "Content-Length": st.size }));
    if (req.method === "HEAD") return res.end();
    createReadStream(filePath).pipe(res);
  } catch (e) { try { res.writeHead(500, H()); res.end(String(e)); } catch {} }
});
server.listen(PORT, HOST, () => console.log(`κ-Roots live demo on http://${HOST}:${PORT}/  (os=${OS})`));
