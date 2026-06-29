#!/usr/bin/env node
// holo-projector-browser-witness.mjs — the SUFFICIENT (browser) proof of the projection lens: in a real
// Chromium, REAL canvas pixels flow origin-canvas → holo-raster-ingest → holo-projector → lens-canvas and
// land PIXEL-IDENTICAL, using the browser's REAL WebCrypto (crypto.subtle SHA-256) for the κ addresses. The
// Node witnesses prove the accounting; this proves the leg the Node lane cannot — actual ImageData in,
// actual ImageData out, a real <canvas> repainted only where the scene changed.
//
// Honest posture (W1): if Playwright is absent the browser lane is SKIPPED and reported witnessed:false
// (honest red, never a fabricated green).
//   node tools/holo-projector-browser-witness.mjs
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { createServer } from "node:http";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = join(here, "..", "os", "usr", "lib", "holo");
const write = (r) => writeFileSync(join(here, "holo-projector-browser-witness.result.json"), JSON.stringify(r, null, 2) + "\n");

let chromium;
try { ({ chromium } = await import("playwright")); }
catch (e) {
  console.log(`• browser lane SKIPPED — playwright not installed (${e.message.split("\n")[0]}).`);
  write({ spec: "browser proof of the projection lens (real canvas pixels, real WebCrypto)", witnessed: false, lane: "skipped", reason: "playwright absent" });
  process.exit(0);
}

// a minimal static server rooted at the holo lib dir, so the page can `import "./holo-projector.mjs"` and
// the modules' own relative imports (./holo-kappa-stream.mjs, …) resolve naturally. One tiny index.html.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<canvas id="origin" width="512" height="512"></canvas><canvas id="lens" width="512" height="512"></canvas>
</body></html>`;
const TYPES = { ".mjs": "text/javascript", ".js": "text/javascript", ".html": "text/html" };
const server = createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/" || url === "/index.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end(PAGE); }
  const f = join(libDir, url.replace(/^\/+/, ""));
  if (!existsSync(f)) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
let result = { witnessed: false };
try {
  const page = await browser.newPage();
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60000 });

  const r = await page.evaluate(async (BASE) => {
    const out = {};
    const { makeProjector } = await import(BASE + "/holo-projector.mjs");
    const { makeRasterIngest } = await import(BASE + "/holo-raster-ingest.mjs");
    out.modulesLoaded = typeof makeProjector === "function" && typeof makeRasterIngest === "function";
    out.realWebCrypto = !!(window.crypto && window.crypto.subtle);   // the κ addresses use the browser's own SHA-256

    const TILE = 256, W = 512, H = 512;
    const oc = document.getElementById("origin"), octx = oc.getContext("2d", { willReadFrequently: true });
    const lc = document.getElementById("lens"), lctx = lc.getContext("2d", { willReadFrequently: true });
    // draw distinct REAL content per tile (opaque) so the 4 tiles are genuinely different pixels
    const palette = ["#1e6f5c", "#b03a2e", "#2e4053", "#c39bd3"];
    const drawBase = () => { for (let ry = 0; ry < 2; ry++) for (let cx = 0; cx < 2; cx++) { octx.fillStyle = palette[ry * 2 + cx]; octx.fillRect(cx * TILE, ry * TILE, TILE, TILE); octx.fillStyle = "#fff"; octx.fillRect(cx * TILE + 20, ry * TILE + 20, 40 + cx * 30, 40 + ry * 30); } };
    drawBase();

    const ing = makeRasterIngest({ tile: TILE });
    // the lens PAINT: write a tile's RGBA bytes back to the lens canvas at its grid slot (real putImageData)
    const paint = (id, bytes) => {
      const m = /^t(\d+)_(\d+)$/.exec(id); const cx = +m[1], ry = +m[2];
      const img = new ImageData(new Uint8ClampedArray(bytes), TILE, TILE);
      lctx.putImageData(img, cx * TILE, ry * TILE);
    };
    const proj = makeProjector({ transform: ing.transform, paint });

    const grab = () => octx.getImageData(0, 0, W, H).data;        // real RGBA framebuffer
    const canvasesMatch = () => { const a = octx.getImageData(0, 0, W, H).data, b = lctx.getImageData(0, 0, W, H).data; if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

    // ── keyframe: ingest the real framebuffer, project it, lens canvas must equal origin canvas ──
    const k1 = await ing.ingest({ buffer: grab(), width: W, height: H });
    const f1 = await proj.render(k1.regions);
    const r1 = await proj.receive(f1.wire);
    out.keyframePainted = r1.painted === 4 && f1.emitted === 4;
    out.pixelIdenticalKeyframe = canvasesMatch();

    // ── delta: change ONE tile on the origin canvas; only that tile re-extracts, streams, repaints ──
    octx.fillStyle = "#f1c40f"; octx.fillRect(256 + 80, 256 + 80, 90, 90);   // inside tile (1,1)
    const k2 = await ing.ingest({ buffer: grab(), width: W, height: H, dirtyRects: [{ x: 256, y: 256, width: 256, height: 256 }] });
    const f2 = await proj.render(k2.regions);
    const r2 = await proj.receive(f2.wire);
    out.oneTileDelta = k2.changed === 1 && f2.emitted === 1 && f2.wire[0].id === "t1_1" && r2.painted === 1;
    out.pixelIdenticalAfterDelta = canvasesMatch();

    // ── static: re-ingest the unchanged frame ⇒ nothing crosses the wire, nothing repaints ──
    const k3 = await ing.ingest({ buffer: grab(), width: W, height: H });
    const f3 = await proj.render(k3.regions);
    const r3 = await proj.receive(f3.wire);
    out.staticZeroWire = f3.emitted === 0 && r3.painted === 0 && r3.novelBytes === 0;
    return out;
  }, base);

  const checks = {
    modulesLoaded: r.modulesLoaded === true,
    realWebCrypto: r.realWebCrypto === true,
    keyframePainted: r.keyframePainted === true,
    pixelIdenticalKeyframe: r.pixelIdenticalKeyframe === true,
    oneTileDelta: r.oneTileDelta === true,
    pixelIdenticalAfterDelta: r.pixelIdenticalAfterDelta === true,
    staticZeroWire: r.staticZeroWire === true,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
  const witnessed = Object.values(checks).every(Boolean);
  result = {
    spec: "Browser proof of the projection lens: REAL canvas pixels flow origin-canvas → holo-raster-ingest → holo-projector → lens-canvas and land pixel-identical, using the browser's real WebCrypto SHA-256 for κ addresses. A one-tile change re-extracts/streams/repaints exactly one tile; a static frame crosses zero bytes and repaints nothing.",
    authority: "Chromium (Playwright) real DOM/Canvas2D/WebCrypto · the served holo-projector.mjs + holo-raster-ingest.mjs · holospaces Laws L1/L3/L5",
    witnessed, lane: "browser", covers: ["projection-lens", "real-canvas-pixels", "real-webcrypto", "pixel-identical", "one-tile-delta", "static-zero-wire"], checks,
  };
  write(result);
  console.log(`\nholo-projector-browser-witness: ${witnessed ? "WITNESSED ✓ real pixels project pixel-identical through the κ channel" : "NOT WITNESSED"}`);
} catch (e) {
  console.log("MEASUREMENT ERROR —", String((e && e.message) || e));
  write({ spec: "browser proof of the projection lens", witnessed: false, error: String((e && e.message) || e) });
} finally {
  await browser.close();
  server.close();
}
process.exit(result.witnessed ? 0 : 1);
