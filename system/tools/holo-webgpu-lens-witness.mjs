#!/usr/bin/env node
// holo-webgpu-lens-witness.mjs — the SUFFICIENT (browser) proof of the GPU projection surface: in a real
// Chromium with a real WebGPU device, REAL canvas pixels flow origin-canvas → holo-raster-ingest →
// holo-projector → holo-webgpu-lens (queue.writeTexture per κ tile) and the composed GPU texture reads back
// PIXEL-IDENTICAL to the origin. This is the lens on the metal — WebGPU → Vulkan/Metal/D3D12 — and the same
// module is the portable surface for a plain tab or a native projector.
//
// Honest posture (W1): if Playwright is absent OR no WebGPU adapter is available in this headless environment
// (common in CI), the lane is SKIPPED and reported witnessed:false — never a fabricated green.
//   node tools/holo-webgpu-lens-witness.mjs
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { createServer } from "node:http";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = join(here, "..", "os", "usr", "lib", "holo");
const write = (r) => writeFileSync(join(here, "holo-webgpu-lens-witness.result.json"), JSON.stringify(r, null, 2) + "\n");

let chromium;
try { ({ chromium } = await import("playwright")); }
catch (e) {
  console.log(`• lane SKIPPED — playwright not installed (${e.message.split("\n")[0]}).`);
  write({ spec: "browser proof of the WebGPU projection lens", witnessed: false, lane: "skipped", reason: "playwright absent" });
  process.exit(0);
}

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

// best-effort software WebGPU in headless Chromium (Dawn over SwiftShader/Vulkan); honest-skip if it won't init
const gpuArgs = [
  "--enable-unsafe-webgpu", "--enable-unsafe-swiftshader", "--use-webgpu-adapter=swiftshader",
  "--enable-features=Vulkan", "--enable-webgpu-developer-features", "--ignore-gpu-blocklist", "--no-sandbox",
];
// Prefer the system Chrome (a real D3D12 WebGPU adapter on Windows); fall back to Playwright's bundled
// Chromium (whose headless software WebGPU path is often unavailable → honest skip).
let browser, launchVia = "chrome";
try { browser = await chromium.launch({ channel: "chrome", args: gpuArgs }); }
catch (e1) { launchVia = "bundled"; browser = await chromium.launch({ args: gpuArgs }); }
console.log(`• launched via ${launchVia}`);
let result = { witnessed: false };
try {
  const page = await browser.newPage();
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60000 });

  const r = await page.evaluate(async (BASE) => {
    const out = {};
    if (!navigator.gpu) return { skip: "no navigator.gpu" };
    let adapter = await navigator.gpu.requestAdapter().catch(() => null);
    if (!adapter) adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true }).catch(() => null);
    if (!adapter) return { skip: "no WebGPU adapter (headless software path unavailable)" };
    const device = await adapter.requestDevice().catch(() => null);
    if (!device) return { skip: "no WebGPU device" };
    out.gpuDevice = true;

    const { makeProjector } = await import(BASE + "/holo-projector.mjs");
    const { makeRasterIngest } = await import(BASE + "/holo-raster-ingest.mjs");
    const { makeWebGpuLens } = await import(BASE + "/holo-webgpu-lens.mjs");
    out.modulesLoaded = [makeProjector, makeRasterIngest, makeWebGpuLens].every((f) => typeof f === "function");

    const TILE = 256, W = 512, H = 512;
    const oc = document.getElementById("origin"), octx = oc.getContext("2d", { willReadFrequently: true });
    const palette = ["#1e6f5c", "#b03a2e", "#2e4053", "#c39bd3"];
    for (let ry = 0; ry < 2; ry++) for (let cx = 0; cx < 2; cx++) { octx.fillStyle = palette[ry * 2 + cx]; octx.fillRect(cx * TILE, ry * TILE, TILE, TILE); octx.fillStyle = "#fff"; octx.fillRect(cx * TILE + 20, ry * TILE + 20, 60, 60); }
    const grab = () => new Uint8Array(octx.getImageData(0, 0, W, H).data);

    const lensCanvas = document.getElementById("lens");
    const ctx = lensCanvas.getContext("webgpu");
    const lens = makeWebGpuLens({ device, context: ctx, width: W, height: H, tile: TILE, format: "rgba8unorm" });

    const ing = makeRasterIngest({ tile: TILE });
    const proj = makeProjector({ transform: ing.transform, paint: (id, bytes) => lens.paint(id, bytes) });
    const match = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

    // ── keyframe: ingest real pixels, project to the GPU texture, read it back pixel-identical ──
    const origin1 = grab();
    const f1 = await proj.render((await ing.ingest({ buffer: origin1, width: W, height: H })).regions);
    const r1 = await proj.receive(f1.wire);
    lens.present();
    out.keyframePainted = r1.painted === 4;
    out.pixelIdenticalKeyframe = match(await lens.readback(), origin1);

    // ── delta: change one tile; only that tile is written to the GPU; readback still matches ──
    octx.fillStyle = "#f1c40f"; octx.fillRect(256 + 80, 256 + 80, 90, 90);
    const origin2 = grab();
    const f2 = await proj.render((await ing.ingest({ buffer: origin2, width: W, height: H, dirtyRects: [{ x: 256, y: 256, width: 256, height: 256 }] })).regions);
    const r2 = await proj.receive(f2.wire);
    lens.present();
    out.oneTileDelta = f2.emitted === 1 && f2.wire[0].id === "t1_1" && r2.painted === 1;
    out.pixelIdenticalAfterDelta = match(await lens.readback(), origin2);
    return out;
  }, base);

  if (r && r.skip) {
    console.log(`• lane SKIPPED — ${r.skip}.`);
    write({ spec: "browser proof of the WebGPU projection lens", witnessed: false, lane: "skipped", reason: r.skip });
    result = { witnessed: false, skipped: true };
  } else {
    const checks = {
      gpuDevice: r.gpuDevice === true,
      modulesLoaded: r.modulesLoaded === true,
      keyframePainted: r.keyframePainted === true,
      pixelIdenticalKeyframe: r.pixelIdenticalKeyframe === true,
      oneTileDelta: r.oneTileDelta === true,
      pixelIdenticalAfterDelta: r.pixelIdenticalAfterDelta === true,
    };
    for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
    const witnessed = Object.values(checks).every(Boolean);
    result = {
      spec: "Browser proof of the GPU projection surface: real canvas pixels flow origin → holo-raster-ingest → holo-projector → holo-webgpu-lens (queue.writeTexture per κ tile, copyTextureToTexture present); the composed GPU texture reads back pixel-identical to the origin. A one-tile change writes only that tile to the GPU.",
      authority: "Chromium (Playwright) real WebGPU device · the served holo-webgpu-lens.mjs + projector + raster-ingest · WebGPU → Vulkan/Metal/D3D12",
      witnessed, lane: "browser", covers: ["webgpu-lens", "gpu-texture-blit", "pixel-identical", "one-tile-delta", "real-gpu-device"], checks,
    };
    write(result);
    console.log(`\nholo-webgpu-lens-witness: ${witnessed ? "WITNESSED ✓ real pixels project pixel-identical onto a GPU texture" : "NOT WITNESSED"}`);
  }
} catch (e) {
  console.log("MEASUREMENT ERROR —", String((e && e.message) || e));
  write({ spec: "browser proof of the WebGPU projection lens", witnessed: false, error: String((e && e.message) || e) });
} finally {
  await browser.close();
  server.close();
}
process.exit(result.witnessed ? 0 : (result.skipped ? 0 : 1));
