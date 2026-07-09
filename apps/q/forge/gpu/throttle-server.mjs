// Throttling static server with HTTP Range + CORS, for reproducible cold-load TTFT
// measurement. Caps throughput to `?bps=<bytes/sec>` by pacing the response, so the
// browser sees a 50/500/1000 Mbps link regardless of localhost speed.
//   node throttle-server.mjs <root-dir> <port>
//   fetch: http://localhost:<port>/.models/x.holo  with header Range, query ?bps=6250000 (=50Mbps)
import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import { resolve, normalize } from "node:path";

const ROOT = resolve(process.argv[2] || ".");
const PORT = +(process.argv[3] || 8795);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Range", "Access-Control-Expose-Headers": "Content-Range,Accept-Ranges,Content-Length", "Accept-Ranges": "bytes" };

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
  const url = new URL(req.url, "http://x");
  const bps = +(url.searchParams.get("bps") || 0);              // 0 = unlimited
  const path = normalize(resolve(ROOT + decodeURIComponent(url.pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403, CORS); res.end(); return; }
  let st; try { st = statSync(path); } catch { res.writeHead(404, CORS); res.end("not found"); return; }
  const total = st.size;
  let start = 0, end = total - 1, code = 200;
  const range = req.headers.range;
  if (range) { const m = /bytes=(\d+)-(\d*)/.exec(range); if (m) { start = +m[1]; end = m[2] ? +m[2] : total - 1; code = 206; } }
  const len = end - start + 1;
  res.writeHead(code, { ...CORS, "Content-Type": "application/octet-stream", "Content-Length": len, ...(code === 206 ? { "Content-Range": `bytes ${start}-${end}/${total}` } : {}) });
  if (!bps) { createReadStream(path, { start, end }).pipe(res); return; }
  // pace by wall-clock: chunk sized so each sleep is ~50ms (above the setTimeout floor,
  // so high bps isn't over-throttled). Track a deadline so total time = len/bps.
  const CHUNK = Math.max(65536, Math.floor(bps * 0.05));
  const stream = createReadStream(path, { start, end, highWaterMark: CHUNK });
  const t0 = Date.now(); let sent = 0;
  for await (const buf of stream) {
    if (!res.write(buf)) await new Promise((r) => res.once("drain", r));
    sent += buf.length;
    const target = (sent / bps) * 1000, now = Date.now() - t0;       // when this much SHOULD have been sent
    if (target > now) await sleep(target - now);
  }
  res.end();
}).listen(PORT, () => console.log(`throttle server :${PORT} serving ${ROOT}  (add ?bps=<bytes/s>; 50Mbps=6250000, 500Mbps=62500000)`));
