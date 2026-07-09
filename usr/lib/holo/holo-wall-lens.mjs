// holo-wall-lens.mjs — project a wallpaper photo through the OS super-resolution LENS, WebGPU-first.
//
// Same Catmull-Rom upscale + CAS contrast-adaptive sharpen kernel as the rest of Hologram (holo-canvas.mjs on
// WebGPU · holo-canvas-gl.mjs on WebGL2), but specialised for a STILL image: decode the source at its full
// intrinsic resolution, cover-crop to the target canvas's box, and present ONCE at the true device-pixel grid
// (devicePixelRatio, clamped only by the GPU's max texture — up to ~8K), CAS-sharpened. Sharpness comes from the
// projector, not the source.
//
// STILL, NOT A LOOP: a wallpaper doesn't move, so we draw exactly once per (source × size) — no per-frame rAF,
// hence ~0 steady-state GPU and none of the "blank once the idle loop settles" failure mode a Ken-Burns loop has.
//
// WEBGPU-FIRST: in a real browser (Brave/Chrome) navigator.gpu exists, so we take the WebGPU path and make the
// most of the device — the highest-quality projector. No adapter ⇒ WebGL2 (ANGLE). Neither ⇒ the lens is a no-op
// and the caller's CSS background stays (never blank). Purely additive: it owns only the canvas handed to it.
//
// HONEST BOUNDARY: super-res restores perceived crispness on upscale; it does not invent detail beyond the source.
// A truly 8K-sharp wall needs 8K source art — this makes whatever is pinned render as sharp as the panel allows.

import { detectGPU, HoloCanvas } from "./holo-canvas.mjs";
import { detectGL, HoloCanvasGL } from "./holo-canvas-gl.mjs";
import { resolveUrl } from "./holo-wallpaper.mjs";

// mountWallLens(canvas, opts) → controller { engine, ready, setSource(raw), relayout(), destroy() }.
//   opts: { onReady?(engine), onError?(err), sharpen=0.62 }
// The controller is safe to call before the backend has settled; setSource/relayout queue until it's ready.
export function mountWallLens(canvas, { onReady, onError, sharpen = 0.62 } = {}) {
  let comp = null, engine = "none", url = "", busy = false, disposed = false, raf = 0, lastKey = "", pending = false, ro = null;
  const ctl = { engine: "pending", ready: false, setSource, relayout, destroy };

  // Re-project whenever the target's box changes size — including the 0→real transition when the element first
  // lays out (or animates in, e.g. the home island). A still draws once per size, so without this it can get
  // stuck at the tiny fallback size if the first draw raced layout. Coalesced through relayout()'s single rAF.
  try { ro = new ResizeObserver(() => relayout()); ro.observe(canvas); } catch (e) {}

  // Pick the best backend ONCE: WebGPU (holo-canvas.mjs) → WebGL2 (holo-canvas-gl.mjs) → none. detectGPU already
  // retries a few times to win the Dawn adapter race; if it still loses we fall to WebGL2 (identical visual result).
  const backend = (async () => {
    try {
      const g = await detectGPU();
      if (g && g.ok) {
        comp = await new HoloCanvas(canvas, { sharpen, maxDim: g.profile.maxTextureDimension2D }).init(g.adapter);
        engine = "webgpu"; return;
      }
    } catch (e) {}
    try {
      const gl = detectGL();
      if (gl && gl.ok) {
        comp = new HoloCanvasGL(canvas, { sharpen, maxDim: gl.profile.maxTextureDimension2D }).init();
        engine = "webgl2"; return;
      }
    } catch (e) {}
    engine = "none";
  })().then(() => { ctl.engine = engine; if (!disposed && engine !== "none" && (url || pending)) draw(); })
     .catch(() => { engine = "none"; ctl.engine = "none"; });

  function boxSize() {
    let w = 0, h = 0;
    try { const r = canvas.getBoundingClientRect(); w = Math.round(r.width); h = Math.round(r.height); } catch (e) {}
    if (!w) w = window.innerWidth || 16;
    if (!h) h = window.innerHeight || 16;
    return { w: Math.max(16, w), h: Math.max(16, h) };
  }

  async function draw() {
    if (disposed || busy || !comp || !url) return;
    const dpr = (typeof devicePixelRatio === "number" && devicePixelRatio > 0) ? devicePixelRatio : 1;
    const { w: vw, h: vh } = boxSize();
    const ow = Math.round(vw * dpr), oh = Math.round(vh * dpr);
    const key = url + "@" + ow + "x" + oh;
    if (key === lastKey) return;
    busy = true; pending = false;
    try {
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) throw new Error("wallpaper fetch " + res.status);
      const bmp = await createImageBitmap(await res.blob());               // full intrinsic-resolution decode
      // cover-crop the source to the target aspect (preserve aspect, crop the overflow, centre)
      const ar = vw / vh;
      let cw = bmp.width, ch = Math.round(bmp.width / ar);
      if (ch > bmp.height) { ch = bmp.height; cw = Math.round(bmp.height * ar); }
      const cx = Math.max(0, Math.round((bmp.width - cw) / 2)), cy = Math.max(0, Math.round((bmp.height - ch) / 2));
      const mid = document.createElement("canvas");
      mid.width = Math.max(1, cw); mid.height = Math.max(1, ch);
      mid.getContext("2d").drawImage(bmp, cx, cy, cw, ch, 0, 0, cw, ch);
      try { bmp.close && bmp.close(); } catch (e) {}
      if (disposed) return;
      comp.setOutput(ow, oh);              // output = the true device pixel grid (clamped to the GPU's max texture)
      comp.present(mid, "sr");             // Catmull-Rom upscale → CAS sharpen
      lastKey = key;
      if (!ctl.ready) { ctl.ready = true; try { onReady && onReady(engine); } catch (e) {} }
    } catch (e) {
      // fail-soft: leave the caller's CSS background in place; never blank. A remote image that fails CORS or a
      // decode error just means no super-res boost for THAT source — the DOM wallpaper underneath still shows.
      try { onError && onError(e); } catch (e2) {}
    } finally { busy = false; }
  }

  // point the lens at a new wallpaper (raw path/url/data/κ). Queues if the backend hasn't settled yet.
  function setSource(raw) {
    const u = resolveUrl(raw);
    if (u === url) return;
    url = u; lastKey = ""; pending = true;
    if (engine !== "none" && engine !== "pending" && comp) draw();
  }

  // re-project at the current size (call on resize / when the target's box changes). Coalesced to one rAF.
  function relayout() {
    lastKey = ""; pending = true;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { if (!disposed && engine !== "none" && comp) draw(); });
  }

  function destroy() {
    disposed = true; cancelAnimationFrame(raf);
    try { comp && comp.destroy && comp.destroy(); } catch (e) {}
    comp = null;
  }

  return ctl;
}
