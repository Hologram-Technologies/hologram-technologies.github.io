// holo-immersive-backdrop.mjs — project the IMMERSIVE wallpaper through the OS super-resolution LENS.
//
// On the lock screen the wallpaper used to be a plain CSS `background-image` — the browser's own scaler,
// and on an 8K/retina panel a 2560px source reads soft. Here we route the SAME photograph through the
// projection envelope the rest of Hologram already uses for apps / 3D / video (holo-canvas-gl.mjs:
// Catmull-Rom upscale + CAS contrast-adaptive sharpen, WebGL2 via ANGLE — which the native CEF host runs
// with HOLO_WEBGPU=1 hardware acceleration). The photo is decoded at FULL resolution, cover-cropped to the
// viewport aspect, and projected onto a canvas sized to the TRUE device pixel grid (devicePixelRatio,
// clamped only by the GPU's max texture size — up to 8K), then CAS-sharpened. Sharpness comes from the
// projector, not the producer.
//
// HONEST BOUNDARY: a super-res pass restores perceived detail and crispness on upscale; it does not invent
// detail beyond the source. For a TRUE 8K backdrop the source art must be 8K too — this lens makes whatever
// source is pinned render as sharp as the panel allows, with CAS edge-crispening on top.
//
// NEVER-BLANK / FAIL-SOFT: the CSS `.wall` stays as the instant first paint AND the fallback. This canvas
// layers above it and only reveals (opacity 0→1) once a frame has actually drawn. No WebGL2 adapter, a
// decode error, or any throw ⇒ the canvas stays hidden and the existing CSS backdrop is untouched. The
// module is purely additive: it owns nothing on the boot-critical path.

import { detectGL, HoloCanvasGL } from "./holo-canvas-gl.mjs";

(function () {
  if (window.__holoImmersiveBackdrop) return;
  window.__holoImmersiveBackdrop = true;

  const root = document.documentElement;
  const KEY = "holo.theme.v1";

  // Resolve the pinned wallpaper to a URL — state.wallpaper (κ or path) first, else the live --holo-wallpaper
  // the boot resolver already set. Same κ→/.holo/<algo>/<hex> rule as holo-theme.js / the bootstrap.
  function wallUrl(w) {
    if (!w) return "";
    const m = String(w).match(/^(sha256|blake3|sha512):([0-9a-f]+)$/i);
    return m ? "/.holo/" + m[1].toLowerCase() + "/" + m[2] : String(w);
  }
  function currentWallpaper() {
    let w = "";
    try { w = (JSON.parse(localStorage.getItem(KEY) || "{}") || {}).wallpaper || ""; } catch (e) {}
    if (w) return wallUrl(w);
    // fall back to the computed custom property (set pre-paint by holo-appearance-boot.js)
    try {
      const cv = getComputedStyle(root).getPropertyValue("--holo-wallpaper").trim();
      const m = cv.match(/url\(\s*["']?([^"')]+)["']?\s*\)/);
      if (m) return m[1];
    } catch (e) {}
    return "";
  }
  const isImmersive = () => root.getAttribute("data-holo-immersive") === "on";

  // The "Fluid" live backdrop — the vendored WebGL-Fluid-Simulation run headless + interactive in an
  // isolated iframe (its own canvas/globals, no labels). Selected by the sentinel wallpaper "live:fluid".
  const FLUID_SRC = "/usr/share/frame/fluid/vendor/index.html";
  function rawWall() { try { return (JSON.parse(localStorage.getItem(KEY) || "{}") || {}).wallpaper || ""; } catch (e) { return ""; } }
  const isFluid = () => /^live:fluid\b/.test(rawWall());

  const gl = detectGL();          // { ok, engine, profile, tier } — no-op if no WebGL2
  let canvas = null, comp = null, lastKey = "", busy = false, rafResize = 0, fluidEl = null;

  function showFluid() {
    if (canvas) canvas.classList.remove("on");                 // never both at once
    if (fluidEl) { fluidEl.classList.add("on"); return; }
    fluidEl = document.createElement("iframe");
    fluidEl.className = "sr-fluid";
    fluidEl.setAttribute("title", "Fluid backdrop");
    fluidEl.setAttribute("tabindex", "-1");
    fluidEl.setAttribute("aria-hidden", "true");
    fluidEl.src = FLUID_SRC;
    const wall = document.querySelector(".wall");
    if (wall && wall.parentNode) wall.parentNode.insertBefore(fluidEl, wall.nextSibling);
    else (document.body || root).appendChild(fluidEl);
    requestAnimationFrame(() => { if (fluidEl) fluidEl.classList.add("on"); });
  }
  function hideFluid() { if (fluidEl) { fluidEl.remove(); fluidEl = null; } }   // tear down → stop its rAF loop

  function ensureCanvas() {
    if (canvas) return canvas;
    canvas = document.createElement("canvas");
    canvas.className = "sr-wall";
    canvas.setAttribute("aria-hidden", "true");
    // sit directly above the CSS .wall (z-index 0); the frost vignette (z-index 1) still paints over it.
    const wall = document.querySelector(".wall");
    if (wall && wall.parentNode) wall.parentNode.insertBefore(canvas, wall.nextSibling);
    else (document.body || root).appendChild(canvas);
    return canvas;
  }

  // Decode the wallpaper at full resolution, cover-crop to the viewport aspect, project through the lens.
  async function project() {
    if (busy || !gl.ok || !isImmersive()) return;
    const url = currentWallpaper();
    const dpr = (typeof devicePixelRatio === "number" && devicePixelRatio > 0) ? devicePixelRatio : 1;
    const vw = window.innerWidth || 16, vh = window.innerHeight || 16;
    const key = url + "@" + Math.round(vw * dpr) + "x" + Math.round(vh * dpr);
    if (!url || key === lastKey) return;
    busy = true;
    try {
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) throw new Error("wallpaper fetch " + res.status);
      const bmp = await createImageBitmap(await res.blob());     // intrinsic full-resolution decode

      // cover-crop the source to the viewport aspect (preserve aspect, crop the overflow, centre)
      const ar = vw / vh;
      let cw = bmp.width, ch = Math.round(bmp.width / ar);
      if (ch > bmp.height) { ch = bmp.height; cw = Math.round(bmp.height * ar); }
      const cx = Math.max(0, Math.round((bmp.width - cw) / 2)), cy = Math.max(0, Math.round((bmp.height - ch) / 2));
      const mid = document.createElement("canvas");
      mid.width = cw; mid.height = ch;
      mid.getContext("2d").drawImage(bmp, cx, cy, cw, ch, 0, 0, cw, ch);
      try { bmp.close && bmp.close(); } catch (e) {}

      ensureCanvas();
      if (!comp) comp = new HoloCanvasGL(canvas, { sharpen: (gl.tier && gl.tier.sharpen) || 0.6, maxDim: gl.profile.maxTextureDimension2D || 8192 }).init();
      // output = the true device pixel grid (clampOut caps to the GPU's max texture size — up to 8K)
      comp.setOutput(Math.round(vw * dpr), Math.round(vh * dpr));
      comp.present(mid, "sr");                                    // Catmull-Rom upscale → CAS sharpen
      lastKey = key;
      canvas.classList.add("on");                                // reveal once a frame has actually drawn
    } catch (e) {
      // fail-soft: leave the CSS .wall backdrop in place; never blank.
      if (canvas) canvas.classList.remove("on");
    } finally {
      busy = false;
    }
  }

  // Route the backdrop: off (dark/light) → solid; immersive+fluid → live sim; immersive+photo → super-res lens.
  function apply() {
    if (!isImmersive()) { if (canvas) canvas.classList.remove("on"); hideFluid(); root.removeAttribute("data-holo-live"); lastKey = ""; return; }
    if (isFluid()) { root.setAttribute("data-holo-live", "fluid"); showFluid(); return; }   // live fluid backdrop (own iframe)
    root.removeAttribute("data-holo-live"); hideFluid(); project();                          // super-res photo backdrop
  }

  function start() {
    apply();                                                     // fluid path works even without WebGL2 in THIS doc
    root.addEventListener("holo-theme-change", () => { lastKey = ""; apply(); });
    window.addEventListener("resize", () => {
      cancelAnimationFrame(rafResize);
      rafResize = requestAnimationFrame(() => { lastKey = ""; apply(); });
    });
  }

  if (document.body) start();
  else addEventListener("DOMContentLoaded", start, { once: true });
})();
