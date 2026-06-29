#!/usr/bin/env node
// holo-osr-projector-witness.mjs — SMOKE proof of the lens SURFACE (holo-osr-projector.html): the page
// defines window.__holoOsrFrame, and a fed manifest (with an injected tile transport) composites onto the
// canvas — the real endpoint the native off-screen producer (holo_osr.cc) drives. Honest-skips if Playwright
// is absent.
//   node tools/holo-osr-projector-witness.mjs
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { createServer } from "node:http";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = join(here, "..", "os", "usr", "lib", "holo");
const write = (r) => writeFileSync(join(here, "holo-osr-projector-witness.result.json"), JSON.stringify(r, null, 2) + "\n");

let chromium;
try { ({ chromium } = await import("playwright")); }
catch (e) { console.log("• lane SKIPPED — playwright absent."); write({ spec: "osr projector surface smoke", witnessed: false, lane: "skipped", reason: "playwright absent" }); process.exit(0); }

const TYPES = { ".mjs": "text/javascript", ".js": "text/javascript", ".html": "text/html" };
const server = createServer((req, res) => {
  const url = req.url.split("?")[0]; const rel = url === "/" ? "holo-osr-projector.html" : url.replace(/^\/+/, "");
  const f = join(libDir, rel); if (!existsSync(f)) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
let result = { witnessed: false };
try {
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__holoOsrReady === true, { timeout: 30000 });

  const r = await page.evaluate(async () => {
    const out = { hasEntry: typeof window.__holoOsrFrame === "function" };
    const TILE = 256, W = 512, H = 512;
    // build two distinct solid tiles + their κ (the browser's own SHA-256 = the κ namespace)
    const { blake3hex } = await import(location.origin + "/holo-blake3.mjs");   // the σ-axis the page verifies on
    const mkTile = (r, g, b) => { const u = new Uint8Array(TILE * TILE * 4); for (let i = 0; i < u.length; i += 4) { u[i] = r; u[i + 1] = g; u[i + 2] = b; u[i + 3] = 255; } return u; };
    const kappa = async (u) => "did:holo:blake3:" + blake3hex(u);   // tiles addressed on the BLAKE3 σ-axis
    const red = mkTile(220, 40, 40), blue = mkTile(40, 80, 200);
    const store = { [(await kappa(red)).split(":").pop()]: red, [(await kappa(blue)).split(":").pop()]: blue };
    window.__holoOsrFetch = async (hex) => { if (!store[hex]) throw new Error("miss"); return store[hex]; };

    // a 4-tile frame: top row red, bottom row blue
    const kr = await kappa(red), kb = await kappa(blue);
    await window.__holoOsrFrame({ w: W, h: H, tile: TILE, seq: 0, tiles: [
      { id: "t0_0", k: kr }, { id: "t1_0", k: kr }, { id: "t0_1", k: kb }, { id: "t1_1", k: kb } ] });

    const ctx = document.getElementById("screen").getContext("2d");
    const at = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
    const topRed = JSON.stringify(at(100, 100)) === JSON.stringify([220, 40, 40]);
    const botBlue = JSON.stringify(at(400, 400)) === JSON.stringify([40, 80, 200]);
    out.composited = topRed && botBlue && window.__holoOsrSeq === 0;

    // INPUT: capture the bridge payload (stub cefQuery), dispatch real DOM events on the canvas, and check the
    // forwarded events map to the off-screen VIEW pixel space (feature-complete interactivity).
    const sent = []; window.cefQuery = (q) => { sent.push(q.request); };
    const cv = document.getElementById("screen"), rect = cv.getBoundingClientRect();
    cv.dispatchEvent(new MouseEvent("mousedown", { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0, bubbles: true }));
    cv.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, clientX: rect.left + 10, clientY: rect.top + 10, bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 65, bubbles: true }));
    const down = window.__holoLastInput;
    out.inputForwarded = sent.length >= 2 && sent[0].startsWith("holo:osrinput:") &&
      JSON.parse(sent[0].slice("holo:osrinput:".length)).t === "down" &&
      sent.some((s) => JSON.parse(s.slice("holo:osrinput:".length)).t === "wheel") &&
      sent.some((s) => JSON.parse(s.slice("holo:osrinput:".length)).t === "keydown");
    // the click maps to ~center of the 512×512 view
    const clickDown = JSON.parse(sent[0].slice("holo:osrinput:".length));
    out.inputMapped = Math.abs(clickDown.x - 256) <= 4 && Math.abs(clickDown.y - 256) <= 4;
    return out;
  });

  const checks = { loadedNoErrors: errors.length === 0, hasEntry: r.hasEntry === true, composited: r.composited === true, inputForwarded: r.inputForwarded === true, inputMapped: r.inputMapped === true };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
  if (errors.length) console.log("  errors:", errors.slice(0, 3));
  const witnessed = Object.values(checks).every(Boolean);
  result = { spec: "The lens surface (holo-osr-projector.html) exposes window.__holoOsrFrame and composites a fed manifest of κ tiles onto the canvas via holo-osr-lens — the endpoint the native off-screen producer drives.", authority: "Chromium (Playwright) real DOM/Canvas/WebCrypto · the served holo-osr-projector.html + holo-osr-lens.mjs", witnessed, lane: "browser", checks };
  write(result);
  console.log(`\nholo-osr-projector-witness: ${witnessed ? "WITNESSED ✓ the projected-tab surface composites a native κ-tile feed" : "NOT WITNESSED"}`);
} catch (e) { console.log("MEASUREMENT ERROR —", String((e && e.message) || e)); write({ spec: "osr projector surface smoke", witnessed: false, error: String((e && e.message) || e) }); }
finally { await browser.close(); server.close(); }
process.exit(result.witnessed ? 0 : 1);
