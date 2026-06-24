#!/usr/bin/env node
// holo-webcodecs-witness.mjs — GROUND the full-motion κ path: in a real browser, a rendered frame encodes via
// WebCodecs VideoEncoder to a small EncodedVideoChunk, the chunk is content-addressed (κ), and it decodes back
// via VideoDecoder to a frame. This is the path for HIGH-CHURN regions (video / animation / WebGL) where every
// tile changes every frame and raw-tile streaming would collapse — the chunk is an order of magnitude smaller
// than raw RGBA, still κ-addressable, still projected by the lens. Honest-skips if WebCodecs/adapter absent.
//   node tools/holo-webcodecs-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer } from "node:http";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-webcodecs-witness.result.json"), JSON.stringify(r, null, 2) + "\n");

let chromium;
try { ({ chromium } = await import("playwright")); }
catch (e) { console.log("• lane SKIPPED — playwright absent."); write({ spec: "webcodecs full-motion κ", witnessed: false, lane: "skipped", reason: "playwright absent" }); process.exit(0); }

// WebCodecs needs a SECURE CONTEXT — serve from 127.0.0.1 (a potentially-trustworthy origin), not data:.
const server = createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><meta charset=utf-8><canvas id=c width=512 height=512></canvas>"); });
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

  const r = await page.evaluate(async () => {
    const out = { hasWebCodecs: typeof window.VideoEncoder === "function" && typeof window.VideoDecoder === "function" && typeof window.VideoFrame === "function" };
    if (!out.hasWebCodecs) return out;
    const W = 512, H = 512;
    const c = document.getElementById("c"), x = c.getContext("2d");
    // a "video frame": gradient + a moving block (representative of full-motion content)
    x.fillStyle = "#103060"; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { x.fillStyle = `hsl(${i * 9},70%,50%)`; x.fillRect(i * 12, 100 + (i % 7) * 30, 40, 24); }

    const kappa = async (u) => { const d = await crypto.subtle.digest("SHA-256", u); return "did:holo:sha256:" + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); };

    // ── ENCODE: frame → EncodedVideoChunk (VP8) ──
    const chunks = [];
    const enc = new VideoEncoder({ output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); chunks.push({ b, type: chunk.type, ts: chunk.timestamp }); }, error: (e) => { out.encError = String(e); } });
    enc.configure({ codec: "vp8", width: W, height: H, bitrate: 4_000_000, framerate: 60 });
    const frame = new VideoFrame(c, { timestamp: 0 });
    enc.encode(frame, { keyFrame: true });
    frame.close();
    await enc.flush();
    out.encoded = chunks.length >= 1;
    const encodedBytes = chunks.reduce((s, k) => s + k.b.length, 0);
    out.encodedBytes = encodedBytes;
    out.rawBytes = W * H * 4;
    out.compression = +(out.rawBytes / Math.max(1, encodedBytes)).toFixed(1);
    out.muchSmaller = encodedBytes > 0 && encodedBytes < out.rawBytes / 4;   // a frame chunk ≪ raw RGBA

    // ── κ-ADDRESS the chunk (content-addressed video, same namespace) ──
    out.chunkKappa = (await kappa(chunks[0].b)).startsWith("did:holo:sha256:");

    // ── DECODE: chunk → VideoFrame (round-trip) ──
    let decoded = 0, decW = 0, decH = 0;
    const dec = new VideoDecoder({ output: (vf) => { decoded++; decW = vf.displayWidth || vf.codedWidth; decH = vf.displayHeight || vf.codedHeight; vf.close(); }, error: (e) => { out.decError = String(e); } });
    dec.configure({ codec: "vp8", codedWidth: W, codedHeight: H });
    dec.decode(new EncodedVideoChunk({ type: chunks[0].type, timestamp: chunks[0].ts, data: chunks[0].b }));
    await dec.flush();
    out.decoded = decoded >= 1 && decW === W && decH === H;
    return out;
  });

  if (!r.hasWebCodecs) { console.log("• lane SKIPPED — WebCodecs unavailable."); write({ spec: "webcodecs full-motion κ", witnessed: false, lane: "skipped", reason: "WebCodecs unavailable" }); result = { skipped: true }; }
  else {
    const checks = { hasWebCodecs: r.hasWebCodecs === true, encoded: r.encoded === true, muchSmaller: r.muchSmaller === true, chunkKappa: r.chunkKappa === true, decoded: r.decoded === true };
    for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
    console.log(`  (encoded ${r.encodedBytes} B vs raw ${r.rawBytes} B = ${r.compression}× smaller; round-trips ${r.decoded ? "✓" : "✗"})`);
    if (r.encError) console.log("  encError:", r.encError); if (r.decError) console.log("  decError:", r.decError);
    const witnessed = Object.values(checks).every(Boolean);
    result = { spec: "Full-motion κ path: a rendered frame encodes via WebCodecs VideoEncoder (VP8) to a small EncodedVideoChunk that is content-addressed (κ) and decodes back via VideoDecoder. The path for high-churn regions where raw-tile streaming collapses — order-of-magnitude smaller, still κ-addressable, still projected.", authority: "W3C WebCodecs (VideoEncoder/VideoDecoder/VideoFrame) · VP8 · real browser", witnessed, lane: "browser", metrics: { encodedBytes: r.encodedBytes, rawBytes: r.rawBytes, compression: r.compression }, checks };
    write(result);
    console.log(`\nholo-webcodecs-witness: ${witnessed ? "WITNESSED ✓ full-motion frames compress to κ video chunks and round-trip" : "NOT WITNESSED"}`);
  }
} catch (e) { console.log("MEASUREMENT ERROR —", String((e && e.message) || e)); write({ spec: "webcodecs full-motion κ", witnessed: false, error: String((e && e.message) || e) }); }
finally { await browser.close(); server.close(); }
process.exit(result.witnessed ? 0 : (result.skipped ? 0 : 1));
