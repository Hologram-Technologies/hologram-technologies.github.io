// holo-proj-route.mjs — THE BROWSER PRODUCER for κ-projection (out-of-band; needs Playwright + a real run).
//
// A pure web page cannot capture arbitrary (cross-origin) web DOM → pixels — there is no browser API for it.
// So the producer is a small Node service that drives a REAL headless Chromium (Playwright) and streams its
// rendered frames to the lens over SSE (dependency-free, same transport as together-signal — reachable from any
// browser via EventSource, no `ws` module). The lens (holo-proj-lens.html) tiles each frame, BLAKE3-addresses
// the tiles, and re-projects only the CHANGED ones (novelty-only) with super-res — so the wire is JPEG frames but
// the RENDER is content-addressed κ-objects, verify-before-paint. This is the "screencast" leg the projection
// design settled on (full Chrome + every extension by construction; lossy). Input round-trips over POST → CDP.
//
// SERVERLESS NOTE: this is a SERVER (the pragmatic producer). The serverless-native answer is a P2P exit-peer
// answering the SAME contract (the teleport transport is witnessed in holo-teleport-transport.witness.mjs); only
// WHO produces the frames changes, not the lens. Mounted like holo-sc-route / holo-web-route, before COOP/COEP.
//
// ROUTES:
//   GET  /proj/stream?target=<url>&sid=<id>&w=&h=   → SSE: {seq, data:"data:image/jpeg;base64,…"} per frame
//   POST /proj/input?sid=<id>   body {t:"move|down|up|wheel|key|char", x,y,b,dy,k,text}  → CDP Input.*
//   POST /proj/nav?sid=<id>     body {url}   → navigate the producer page
//
// Playwright is resolved from holo-os/system/node_modules (where it's installed in this repo).

import { fileURLToPath } from "node:url";

const PW_URL = "file:///C:/Users/pavel/Desktop/HOLOGRAM/holo-os/system/node_modules/playwright/index.mjs";
let _pw = null;
async function playwright() {
  if (_pw) return _pw;
  try { _pw = await import(PW_URL); }
  catch (e1) { try { _pw = await import("playwright"); } catch (e2) { throw new Error("Playwright not found — run `npm i playwright` (or `npx playwright install chromium`). " + (e1.message || e1)); } }
  return _pw;
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type" };
const sessions = new Map();   // sid -> { browser, page, client, screencasting, clients:Set<res> }

async function ensureSession(sid, target, w, h) {
  let s = sessions.get(sid);
  if (s && s.page) { if (target) { try { await s.page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 }); } catch {} } return s; }
  const { chromium } = await playwright();
  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: w || 1280, height: h || 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const client = await ctx.newCDPSession(page);
  s = { browser, page, client, screencasting: false, clients: new Set() };
  sessions.set(sid, s);
  // fan a single screencast out to all SSE clients of this sid
  client.on("Page.screencastFrame", async (ev) => {
    const msg = `data: ${JSON.stringify({ seq: ev.metadata && ev.metadata.timestamp || 0, data: "data:image/jpeg;base64," + ev.data })}\n\n`;
    for (const res of s.clients) { try { res.write(msg); } catch {} }
    try { await client.send("Page.screencastFrameAck", { sessionId: ev.sessionId }); } catch {}
  });
  if (target) { try { await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 }); } catch {} }
  return s;
}

async function closeSession(sid) {
  const s = sessions.get(sid); if (!s) return;
  sessions.delete(sid);
  try { await s.client.send("Page.stopScreencast"); } catch {}
  try { await s.browser.close(); } catch {}
}

export async function handleProj(req, res) {
  let u; try { u = new URL(req.url, "http://localhost"); } catch { return false; }
  if (!u.pathname.startsWith("/proj/")) return false;
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return true; }

  // ── health: is the producer available here? (Playwright present) — lets the UI self-hide the Project toggle ──
  if (u.pathname === "/proj/health") {
    let pw = true; try { await playwright(); } catch { pw = false; }
    res.writeHead(200, { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: pw, sessions: sessions.size }));
    return true;
  }

  // ── SSE stream: drive the producer + push frames ──
  if (u.pathname === "/proj/stream") {
    const sid = u.searchParams.get("sid") || "default";
    const target = u.searchParams.get("target") || "https://www.google.com/";
    const w = Number(u.searchParams.get("w")) || 1280, h = Number(u.searchParams.get("h")) || 800;
    res.writeHead(200, { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(": open\n\n");
    let s;
    try { s = await ensureSession(sid, target, w, h); }
    catch (e) { res.write(`data: ${JSON.stringify({ error: String(e.message || e) })}\n\n`); res.end(); return true; }
    s.clients.add(res);
    if (!s.screencasting) {
      s.screencasting = true;
      try { await s.client.send("Page.startScreencast", { format: "jpeg", quality: 62, maxWidth: w, maxHeight: h, everyNthFrame: 1 }); } catch (e) { try { res.write(`data: ${JSON.stringify({ error: "screencast: " + (e.message || e) })}\n\n`); } catch {} }
    }
    const hb = setInterval(() => { try { res.write(": hb\n\n"); } catch {} }, 15000);
    req.on("close", () => { clearInterval(hb); s.clients.delete(res); if (s.clients.size === 0) closeSession(sid); });
    return true;
  }

  // ── input → CDP ──
  if (u.pathname === "/proj/input" && req.method === "POST") {
    const sid = u.searchParams.get("sid") || "default"; const s = sessions.get(sid);
    const body = await readJson(req);
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" }); res.end("{}");
    if (!s || !body) return true;
    try {
      const c = s.client, b = body;
      if (b.t === "move") await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b.x | 0, y: b.y | 0 });
      else if (b.t === "down") await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.x | 0, y: b.y | 0, button: b.b === 2 ? "right" : "left", clickCount: 1 });
      else if (b.t === "up") await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.x | 0, y: b.y | 0, button: b.b === 2 ? "right" : "left", clickCount: 1 });
      else if (b.t === "wheel") await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: b.x | 0, y: b.y | 0, deltaX: 0, deltaY: -(b.dy | 0) });
      else if (b.t === "char" && b.text) await c.send("Input.dispatchKeyEvent", { type: "char", text: String(b.text) });
      else if (b.t === "key") await c.send("Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: b.k | 0 });
    } catch {}
    return true;
  }

  // ── navigate the producer ──
  if (u.pathname === "/proj/nav" && req.method === "POST") {
    const sid = u.searchParams.get("sid") || "default"; const s = sessions.get(sid);
    const body = await readJson(req);
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" }); res.end("{}");
    if (s && s.page && body && body.url) { try { await s.page.goto(String(body.url), { waitUntil: "domcontentloaded", timeout: 30000 }); } catch {} }
    return true;
  }

  res.writeHead(404, CORS); res.end("no such /proj route"); return true;
}

function readJson(req) {
  return new Promise((resolve) => { const chunks = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n > 1 << 20) { req.destroy(); resolve(null); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { resolve(null); } });
    req.on("error", () => resolve(null)); });
}

// clean shutdown
for (const sig of ["SIGINT", "SIGTERM"]) { try { process.on(sig, () => { for (const sid of sessions.keys()) closeSession(sid); }); } catch {} }
void fileURLToPath;
