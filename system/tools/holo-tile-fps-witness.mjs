#!/usr/bin/env node
// holo-tile-fps-witness.mjs — the SUFFICIENT (browser) proof for the streaming substrate: in real Chromium,
// a holo:FrameManifest mounts a <canvas> byte-exact through the registry, and STREAMING redraws ONLY the
// changed tiles each frame (holo-tile.diff) — so a delta frame draws far inside the 60fps budget (16.67ms),
// leaving high-FPS headroom. The Node tile witness proves the codec; this proves it draws to pixels + the
// per-frame cost ∝ what changed. Honest metric: per-delta-frame DRAW time vs the frame budget (not vsync).
//
// Honest posture (W1 discipline): Playwright absent ⇒ SKIPPED, witnessed:false (honest red, never faked).
//   node tools/holo-tile-fps-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startServer } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-tile-fps-witness.result.json"), JSON.stringify(r, null, 2) + "\n");

let chromium;
try { ({ chromium } = await import("playwright")); }
catch (e) { console.log(`• SKIPPED — playwright absent (${e.message.split("\n")[0]}).`); write({ spec: "browser FPS proof of tiled delta streaming", witnessed: false, lane: "skipped" }); process.exit(0); }

const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
let result = { witnessed: false };
try {
  const page = await (await browser.newContext()).newPage();
  await page.route(`${base}/__tiletest__`, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto(`${base}/__tiletest__`, { waitUntil: "domcontentloaded", timeout: 60000 });

  const r = await page.evaluate(async (BASE) => {
    const out = {};
    const TILE = await import(BASE + "/_shared/holo-tile.mjs");
    const TR = (await import(BASE + "/_shared/holo-render-tile.mjs")).default;
    const HR = (await import(BASE + "/_shared/holo-render.js")).default;
    out.registered = (TR.register(HR), HR.renderers().has("holo:FrameManifest"));

    const W = 128, H = 128, T = 32, M = 60;                        // 4×4 = 16 tiles, 60 delta frames
    const px = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; px[i] = (x * 2) & 255; px[i + 1] = (y * 2) & 255; px[i + 2] = 90; px[i + 3] = 255; }

    // mount frame0 through the renderer; assert the canvas is byte-exact
    const base0 = await TILE.tileFrame(px, { width: W, height: H, tile: T });
    const cache = new Map(base0.tiles.map((t) => [t.index, t.bytes]));
    const div = document.createElement("div"); document.body.appendChild(div);
    const mounted = await TR.mountTiledFrame(div, new TextEncoder().encode(JSON.stringify(base0.manifest)), { getTile: (i) => cache.get(i) });
    const c2d = mounted.canvas.getContext("2d", { willReadFrequently: true });
    const sameAs = (data, ref) => { if (data.length !== ref.length) return false; for (let i = 0; i < ref.length; i++) if (data[i] !== ref[i]) return false; return true; };
    out.frame0Exact = sameAs(c2d.getImageData(0, 0, W, H).data, px);

    // precompute M delta frames (change ONE tile each, cycling) — re-tile + diff to get the changed set
    const steps = []; let prev = base0.manifest; const grids = new Set([prev.cols + "x" + prev.rows]);
    for (let f = 0; f < M; f++) {
      const ti = f % 16, tx = (ti % 4) * T, ty = ((ti / 4) | 0) * T;
      for (let y = ty; y < ty + T; y++) for (let x = tx; x < tx + T; x++) { const i = (y * W + x) * 4; px[i] = (f * 7) & 255; px[i + 1] = (f * 13) & 255; px[i + 2] = (f * 5) & 255; }
      const cur = await TILE.tileFrame(px, { width: W, height: H, tile: T });
      grids.add(cur.manifest.cols + "x" + cur.manifest.rows);
      const changed = TILE.diff(prev, cur.manifest).changed;                    // the shipped diff (prev manifest vs cur manifest)
      steps.push({ manifest: cur.manifest, changed, bytes: new Map(changed.map((i) => [i, cur.tiles.find((t) => t.index === i).bytes])) });
      prev = cur.manifest;
    }
    out.grids = [...grids];
    const finalPx = px.slice();

    // TIMED draw loop: redraw ONLY the changed tiles per frame (the streaming path)
    let redraws = 0; const t0 = performance.now();
    for (const s of steps) { for (const [i, b] of s.bytes) cache.set(i, b); redraws += await TR.drawTiles(c2d, s.manifest, s.changed, (i) => cache.get(i)); }
    const elapsed = performance.now() - t0;

    out.deltaOnly = redraws === M;                                  // exactly one tile redrawn per frame (not 16)
    out.finalExact = sameAs(c2d.getImageData(0, 0, W, H).data, finalPx);
    out.msPerFrame = Math.round((elapsed / M) * 1000) / 1000;
    out.impliedFps = Math.round(1000 / (elapsed / M));
    out.frames = M; out.redraws = redraws;
    return out;
  }, base);

  const checks = {
    registered: r.registered === true,
    frame0Exact: r.frame0Exact === true,
    deltaOnly: r.deltaOnly === true,
    finalExact: r.finalExact === true,
    fpsHeadroom: typeof r.msPerFrame === "number" && r.msPerFrame < 16.67,   // a delta frame fits the 60fps budget
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}${k === "fpsHeadroom" ? `  (${r.msPerFrame} ms/frame · ~${r.impliedFps} fps headroom)` : ""}`);
  const witnessed = Object.values(checks).every(Boolean);
  result = {
    spec: "Browser proof: a holo:FrameManifest mounts a <canvas> byte-exact through the κ-render registry; streaming redraws ONLY changed tiles (holo-tile.diff); a delta frame draws inside the 60fps budget (per-frame draw time ≪ 16.67ms).",
    authority: "Chromium (Playwright) real canvas · served _shared/holo-tile.mjs + holo-render-tile.mjs · holospaces Laws L1·L2·L3",
    witnessed, lane: "browser", metrics: { frames: r.frames, redraws: r.redraws, msPerFrame: r.msPerFrame, impliedFps: r.impliedFps }, checks,
  };
  write(result);
  console.log(`\nholo-tile-fps-witness: ${witnessed ? "WITNESSED ✓" : "NOT WITNESSED"}`);
} catch (e) { console.log("ERROR —", String(e && e.message || e)); write({ spec: "browser FPS proof of tiled delta streaming", witnessed: false, error: String(e && e.message || e) }); }
finally { await browser.close(); await close(); }
process.exit(result.witnessed ? 0 : 1);
