// serve.mjs — self-contained LOCAL bring-up for the rung-1 onion path. One command, no RTC, no dev-server
// conflict. Serves the browser app statics + a live test page, and mounts the REAL production /onion handler
// (holo-onion-endpoint.node.mjs → nodeArtiFetch → your SOCKS proxy). Exercises the actual rung-1 code path.
//
//   node _spike/onion/serve.mjs            # SOCKS 127.0.0.1:9150 (Tor Browser / arti default)
//   HOLO_SOCKS_PORT=9050 node _spike/onion/serve.mjs   # standalone `tor` uses 9050
//
// You need a Tor SOCKS proxy listening first (any ONE):
//   • Tor Browser running        → 127.0.0.1:9150   (easiest — just open it)
//   • `arti proxy`               → 127.0.0.1:9150
//   • standalone `tor`           → 127.0.0.1:9050   (set HOLO_SOCKS_PORT=9050)
//
// Then open the printed URL and try a .onion. GET http://localhost:8899/health checks the SOCKS proxy.

import http from "node:http";
import net from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { onionRequestHandler } from "../../_shared/holo-onion-endpoint.node.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BROWSER_ROOT = normalize(join(HERE, "..", ".."));   // holo-apps/apps/browser
const PORT = parseInt(process.env.HOLO_PORT || "8899", 10);
const SOCKS_HOST = process.env.HOLO_SOCKS_HOST || "127.0.0.1";
const SOCKS_PORT = parseInt(process.env.HOLO_SOCKS_PORT || "9150", 10);

const onion = onionRequestHandler({ socksHost: SOCKS_HOST, socksPort: SOCKS_PORT });
const MIME = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".css": "text/css" };

function socksAlive() {
  return new Promise((res) => { const s = net.connect({ host: SOCKS_HOST, port: SOCKS_PORT }); const done = (v) => { try { s.destroy(); } catch {} res(v); }; s.once("connect", () => done(true)); s.once("error", () => done(false)); setTimeout(() => done(false), 1500); });
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    // /onion = standalone demo path; /apps/browser/onion = the path the deployed browser SW probes on loopback
    if (u.pathname === "/onion" || u.pathname === "/apps/browser/onion") return onion(req, res);
    if (u.pathname === "/health") { const ok = await socksAlive(); res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }); return res.end(JSON.stringify({ socks: `${SOCKS_HOST}:${SOCKS_PORT}`, reachable: ok })); }
    let p = u.pathname === "/" ? "/_spike/onion/onion-live.html" : u.pathname;
    const file = normalize(join(BROWSER_ROOT, p));
    if (!file.startsWith(BROWSER_ROOT)) { res.writeHead(403); return res.end("no"); }        // path-traversal guard
    const body = await readFile(file);
    const ext = file.slice(file.lastIndexOf("."));
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    res.end(body);
  } catch (e) { res.writeHead(e.code === "ENOENT" ? 404 : 500, { "content-type": "text/plain" }); res.end(String(e && e.message || e)); }
}).listen(PORT, async () => {
  const ok = await socksAlive();
  console.log(`\n  Hologram onion rung-1 · local bring-up`);
  console.log(`  open   →  http://localhost:${PORT}/`);
  console.log(`  SOCKS  →  ${SOCKS_HOST}:${SOCKS_PORT}  ${ok ? "✓ reachable" : "✗ NOT reachable — start Tor Browser / arti proxy first (see header)"}`);
  console.log(`  /onion →  live production handler (nodeArtiFetch)\n`);
});
