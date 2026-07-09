// serve-parity.mjs — verify the PUBLISHED browser code (the Q tree that github.io/Q ships) locally, in a
// real browser, with onion working — BEFORE deploying. Serves the Q directory statically on a probe port
// (8474, one of browser-sw's HOST_PORTS) AND mounts /apps/browser/onion → the real Tor-bridge handler. So
// the exact shipped browser-sw.js discovers the onion host on loopback (same origin) and routes .onion
// through it. Open /apps/browser/onion-sw.witness.html to assert the SW paints an onion with egress=onion-host.
//
//   node _spike/onion/serve-parity.mjs        # needs Tor SOCKS on 127.0.0.1:9150 (headless tor / Tor Browser)
//
// Root defaults to <HOLOGRAM>/Q (the published tree). Override with HOLO_PUBLISH_ROOT.

import http from "node:http";
import net from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { onionRequestHandler } from "../../_shared/holo-onion-endpoint.node.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOLOGRAM = normalize(join(HERE, "..", "..", "..", "..", ".."));      // → …/HOLOGRAM
const ROOT = normalize(process.env.HOLO_PUBLISH_ROOT || join(HOLOGRAM, "Q"));
const PORT = parseInt(process.env.HOLO_PORT || "8474", 10);                 // a browser-sw HOST_PORT (loopback probe)
const SOCKS_PORT = parseInt(process.env.HOLO_SOCKS_PORT || "9150", 10);

const onion = onionRequestHandler({ socksHost: "127.0.0.1", socksPort: SOCKS_PORT });
const MIME = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".css": "text/css", ".wasm": "application/wasm", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json" };

const socksAlive = () => new Promise((res) => { const s = net.connect({ host: "127.0.0.1", port: SOCKS_PORT }); const d = (v) => { try { s.destroy(); } catch {} res(v); }; s.once("connect", () => d(true)); s.once("error", () => d(false)); setTimeout(() => d(false), 1500); });

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname === "/apps/browser/onion" || u.pathname === "/onion") return onion(req, res);
    // browser→disk sink: the witness POSTs its per-image diagnostic here so the loop closes without screenshots
    if (u.pathname === "/witness-report" && req.method === "POST") {
      let b = ""; for await (const c of req) b += c;
      try { await writeFile(join(HERE, "witness-report.txt"), b); } catch {}
      res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" }); return res.end("ok");
    }
    if (u.pathname === "/health") { const ok = await socksAlive(); res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }); return res.end(JSON.stringify({ socks: "127.0.0.1:" + SOCKS_PORT, reachable: ok, root: ROOT })); }
    let p = u.pathname === "/" ? "/apps/browser/index.html" : decodeURIComponent(u.pathname);
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("no"); }
    const body = await readFile(file);
    const ext = file.slice(file.lastIndexOf("."));
    // service workers must be served with a JS content-type and be allowed a root scope
    const hdr = { "content-type": MIME[ext] || "application/octet-stream" };
    if (/browser-sw\.js$|ipfs-sw\.js$/.test(file)) hdr["service-worker-allowed"] = "/";
    res.writeHead(200, hdr);
    res.end(body);
  } catch (e) { res.writeHead(e.code === "ENOENT" ? 404 : 500, { "content-type": "text/plain" }); res.end(String(e && e.message || e)); }
}).listen(PORT, async () => {
  const ok = await socksAlive();
  console.log(`\n  Hologram PUBLISHED-parity server (verify before deploy)`);
  console.log(`  root   →  ${ROOT}`);
  console.log(`  witness→  http://127.0.0.1:${PORT}/apps/browser/onion-sw.witness.html`);
  console.log(`  app    →  http://127.0.0.1:${PORT}/apps/browser/index.html`);
  console.log(`  SOCKS  →  127.0.0.1:${SOCKS_PORT}  ${ok ? "✓" : "✗ start Tor first"}`);
  console.log(`  /apps/browser/onion → live Tor-bridge handler\n`);
});
