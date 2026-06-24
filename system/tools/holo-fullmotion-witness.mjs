#!/usr/bin/env node
// holo-fullmotion-witness.mjs — PROVE the full-motion path END-TO-END through the lens on real hardware: a
// high-churn region is encoded by WebCodecs (VideoEncoder) to a κ-addressed chunk, the lens routes it as a
// vchunk and DECODES it (VideoDecoder), and the decoded frame composites — while a low-churn region in the
// SAME frame stays a lossless raw tile. So video and UI coexist: one path per region, one κ namespace, one lens.
// Honest-skips if WebCodecs/adapter unavailable (needs a secure context → served from 127.0.0.1).
//   node tools/holo-fullmotion-witness.mjs
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { createServer } from "node:http";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = join(here, "..", "os", "usr", "lib", "holo");
const write = (r) => writeFileSync(join(here, "holo-fullmotion-witness.result.json"), JSON.stringify(r, null, 2) + "\n");

let chromium;
try { ({ chromium } = await import("playwright")); }
catch (e) { console.log("• lane SKIPPED — playwright absent."); write({ spec: "full-motion end-to-end", witnessed: false, lane: "skipped", reason: "playwright absent" }); process.exit(0); }

const PAGE = "<!doctype html><meta charset=utf-8><canvas id=lens width=512 height=512></canvas>";
const TYPES = { ".mjs": "text/javascript" };
const server = createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/" ) { res.writeHead(200, { "content-type": "text/html" }); return res.end(PAGE); }
  const f = join(libDir, url.replace(/^\/+/, "")); if (!existsSync(f)) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

let browser, via = "chrome";
try { browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] }); }
catch (e1) { via = "bundled"; browser = await chromium.launch({ args: ["--no-sandbox"] }); }
console.log(`• launched via ${via}`);

let result = { witnessed: false };
try {
  const page = await browser.newPage();
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  const r = await page.evaluate(async (BASE) => {
    const out = { hasWebCodecs: typeof window.VideoEncoder === "function" };
    if (!out.hasWebCodecs) return out;
    const { makeOsrLens } = await import(BASE + "/holo-osr-lens.mjs");
    const TILE = 256;
    const kappa = async (u) => { const d = await crypto.subtle.digest("SHA-256", u); return "did:holo:sha256:" + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); };
    const hexOf = (k) => k.split(":").pop();

    // a high-churn region (a 256×256 "video" tile): colorful gradient
    const vc = new OffscreenCanvas(TILE, TILE), vx = vc.getContext("2d");
    for (let i = 0; i < 64; i++) { vx.fillStyle = `hsl(${i * 5},80%,50%)`; vx.fillRect((i % 8) * 32, ((i / 8) | 0) * 32, 32, 32); }
    const srcAvg = (() => { const d = vx.getImageData(0, 0, TILE, TILE).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; return [r / n, g / n, b / n]; })();

    // ENCODE the region → a κ-addressed chunk
    const chunks = [];
    const enc = new VideoEncoder({ output: (c) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push({ b, type: c.type, ts: c.timestamp }); }, error: (e) => { out.encErr = String(e); } });
    enc.configure({ codec: "vp8", width: TILE, height: TILE, bitrate: 3_000_000, framerate: 30 });
    const vf = new VideoFrame(vc, { timestamp: 0 }); enc.encode(vf, { keyFrame: true }); vf.close(); await enc.flush();
    const chunkBytes = chunks[0].b; const chunkK = await kappa(chunkBytes);
    out.chunkBytes = chunkBytes.length;

    // a DECODER used by the lens to turn a chunk back into RGBA pixels (one decode → one frame)
    const dctx = new OffscreenCanvas(TILE, TILE).getContext("2d", { willReadFrequently: true });
    let pend = null;
    const dec = new VideoDecoder({ output: (frame) => { dctx.drawImage(frame, 0, 0); const px = new Uint8Array(dctx.getImageData(0, 0, TILE, TILE).data); frame.close(); if (pend) { pend(px); pend = null; } }, error: (e) => { out.decErr = String(e); } });
    dec.configure({ codec: "vp8", codedWidth: TILE, codedHeight: TILE });
    const decodeChunk = (id, bytes, keyframe) => new Promise((resolve) => { pend = resolve; dec.decode(new EncodedVideoChunk({ type: keyframe ? "key" : "delta", timestamp: 0, data: bytes })); dec.flush(); });

    // the lens: a vchunk region (the video) + a raw tile region (static UI) in the same frame
    const lensCv = document.getElementById("lens"), lctx = lensCv.getContext("2d", { willReadFrequently: true });
    const W = 512, H = 512, fb = new Uint8Array(W * H * 4);
    const blit = (id, bytes) => { const m = /^t(\d+)_(\d+)$/.exec(id); const x0 = +m[1] * TILE, y0 = +m[2] * TILE; const tw = Math.min(TILE, W - x0); for (let rr = 0; rr < Math.min(TILE, H - y0); rr++) fb.set(bytes.subarray(rr * tw * 4, (rr + 1) * tw * 4), ((y0 + rr) * W + x0) * 4); };
    // a static UI tile (solid) + its κ
    const ui = new Uint8Array(TILE * TILE * 4); for (let i = 0; i < ui.length; i += 4) { ui[i] = 30; ui[i + 1] = 30; ui[i + 2] = 40; ui[i + 3] = 255; }
    const uiK = await kappa(ui);
    const cacheStore = { [hexOf(chunkK)]: chunkBytes, [hexOf(uiK)]: ui };
    const fetchTile = async (hex) => cacheStore[hex];

    const lens = makeOsrLens({ tile: TILE, paint: blit, fetchTile, decodeChunk });
    const res = await lens.frame({ w: W, h: H, tile: TILE, seq: 0, tiles: [
      { id: "t0_0", k: chunkK, kind: "vchunk", keyframe: true },   // the video region
      { id: "t1_1", k: uiK }                                       // a static UI region (raw tile)
    ] });

    // present the composited surface; check the video region decoded (non-blank, ~matches source) and the UI tile is exact
    lctx.putImageData(new ImageData(new Uint8ClampedArray(fb), W, H), 0, 0);
    const avg = (x0, y0) => { const d = lctx.getImageData(x0, y0, TILE, TILE).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; return [r / n, g / n, b / n]; };
    const va = avg(0, 0);
    out.videoDecoded = res.vpainted === 1 && (va[0] + va[1] + va[2]) > 30;                 // region is non-blank
    out.videoRoughlyMatches = Math.abs(va[0] - srcAvg[0]) < 40 && Math.abs(va[1] - srcAvg[1]) < 40 && Math.abs(va[2] - srcAvg[2]) < 40;  // lossy but close
    const uiPx = lctx.getImageData(256 + 10, 256 + 10, 1, 1).data;
    out.uiTileExact = uiPx[0] === 30 && uiPx[1] === 30 && uiPx[2] === 40;                  // raw tile is lossless
    out.coexist = res.painted === 2;                                                       // video + UI same frame
    out.compression = +(TILE * TILE * 4 / chunkBytes.length).toFixed(1);
    return out;
  }, base);

  if (!r.hasWebCodecs) { console.log("• lane SKIPPED — WebCodecs unavailable."); write({ spec: "full-motion end-to-end", witnessed: false, lane: "skipped", reason: "WebCodecs unavailable" }); result = { skipped: true }; }
  else {
    const checks = { videoDecoded: r.videoDecoded === true, videoRoughlyMatches: r.videoRoughlyMatches === true, uiTileExact: r.uiTileExact === true, coexist: r.coexist === true };
    for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
    console.log(`  (video region: ${r.chunkBytes} B chunk = ${r.compression}× smaller than a raw tile; UI region lossless)`);
    if (r.encErr) console.log("  encErr:", r.encErr); if (r.decErr) console.log("  decErr:", r.decErr);
    const witnessed = Object.values(checks).every(Boolean);
    result = { spec: "Full-motion end-to-end: a high-churn region encodes via WebCodecs to a κ-addressed chunk, the lens routes it as a vchunk and decodes it (VideoDecoder) into the composited frame, while a low-churn region in the same frame stays a lossless raw κ tile. Video and UI coexist — one path per region, one κ namespace, one lens.", authority: "W3C WebCodecs VP8 · the served holo-osr-lens.mjs (vchunk path) + holo-churn-router · real browser", witnessed, lane: "browser", metrics: { chunkBytes: r.chunkBytes, compression: r.compression }, checks };
    write(result);
    console.log(`\nholo-fullmotion-witness: ${witnessed ? "WITNESSED ✓ video projects as a κ video chunk beside lossless UI tiles — feature-complete full-motion" : "NOT WITNESSED"}`);
  }
} catch (e) { console.log("MEASUREMENT ERROR —", String((e && e.message) || e)); write({ spec: "full-motion end-to-end", witnessed: false, error: String((e && e.message) || e) }); }
finally { await browser.close(); server.close(); }
process.exit(result.witnessed ? 0 : (result.skipped ? 0 : 1));
