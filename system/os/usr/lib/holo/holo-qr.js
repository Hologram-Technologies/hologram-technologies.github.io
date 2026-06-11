// holo-qr.js — Holo QR: the hologram-native QR layer. GENERATION over node-qrcode (`qrcode`) and
// READING over ZXing (`@zxing/library`) — both vendored content-addressed and κ-pinned (Law L5 vs
// upstream, see _shared/vendor/{qrcode,zxing}/manifest.json), so the OS makes + reads QR codes
// offline with no CDN. Reading prefers the browser-native W3C BarcodeDetector and falls back to
// ZXing, so it works everywhere. Isomorphic: the relative bundle imports resolve in the browser
// (served at /_shared/…) AND in Node (the witness), so the SAME code is proven both places.
//
// Used by "Share this OS on my LAN": render a join URL as a QR, and scan one to join.

import QRCode from "./vendor/qrcode/qrcode@1.5.4/es2022/qrcode.bundle.mjs";
import * as ZX from "./vendor/zxing/@zxing/library@0.21.3/es2022/library.bundle.mjs";

// ── generate (node-qrcode) ─────────────────────────────────────────────────────────
// create(text, opts) → the raw QR symbol; ecc ∈ L|M|Q|H (default M).
export function create(text, { ecc = "M", version } = {}) {
  const qr = QRCode.create(String(text), { errorCorrectionLevel: ecc, ...(version ? { version } : {}) });
  return { size: qr.modules.size, data: qr.modules.data, version: qr.version, ecc };
}

// toMatrix(text, opts) → { size, version, modules: boolean[][] } (true = dark module).
export function toMatrix(text, opts) {
  const { size, data, version, ecc } = create(text, opts);
  const modules = [];
  for (let r = 0; r < size; r++) { const row = []; for (let c = 0; c < size; c++) row.push(!!data[r * size + c]); modules.push(row); }
  return { size, version, ecc, modules };
}

// toSVG(text, opts) → a crisp, themeable SVG string (no canvas; works in a worker / SSR).
export function toSVG(text, { margin = 4, dark = "#0b071e", light = "#ffffff", scale = 8, rounded = 0, opts } = {}) {
  const { size, modules } = toMatrix(text, opts);
  const dim = size + margin * 2, px = dim * scale;
  let path = "";
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) {
    const x = (c + margin) * scale, y = (r + margin) * scale;
    path += rounded ? `M${x + rounded},${y}h${scale - 2 * rounded}a${rounded},${rounded} 0 0 1 ${rounded},${rounded}v${scale - 2 * rounded}a${rounded},${rounded} 0 0 1 -${rounded},${rounded}h-${scale - 2 * rounded}a${rounded},${rounded} 0 0 1 -${rounded},-${rounded}v-${scale - 2 * rounded}a${rounded},${rounded} 0 0 1 ${rounded},-${rounded}z`
      : `M${x},${y}h${scale}v${scale}h-${scale}z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${px}" height="${px}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}

// toCanvas(canvas, text, opts) — draw the QR into a 2D canvas (browser).
export function toCanvas(canvas, text, { margin = 4, dark = "#000000", light = "#ffffff", scale = 8, opts } = {}) {
  const { size, modules } = toMatrix(text, opts);
  const dim = size + margin * 2;
  canvas.width = canvas.height = dim * scale;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = light; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = dark;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
  return canvas;
}

export function toDataURL(text, opts = {}) {
  if (typeof document === "undefined") return "data:image/svg+xml;base64," + btoa(toSVG(text, opts));
  return toCanvas(document.createElement("canvas"), text, opts).toDataURL("image/png");
}

// ── read (W3C BarcodeDetector → ZXing) ──────────────────────────────────────────────
// rgbaToLuminance(rgba, w, h) → 1 byte/px (BT.601), the form ZXing's RGBLuminanceSource wants.
function rgbaToLuminance(rgba, w, h) {
  const lum = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
  return lum;
}

// decodeLuminance(lum, w, h) → text | null. ZXing QR reader over a luminance buffer (no DOM).
export function decodeLuminance(lum, w, h) {
  try {
    const bitmap = new ZX.BinaryBitmap(new ZX.HybridBinarizer(new ZX.RGBLuminanceSource(lum, w, h)));
    return new ZX.QRCodeReader().decode(bitmap).getText();
  } catch { return null; }
}

export function decodeImageData(img) { return decodeLuminance(rgbaToLuminance(img.data, img.width, img.height), img.width, img.height); }

// decode(source) → Promise<text|null>. source: ImageData | canvas | ImageBitmap | <video>/<img>.
// Prefers the W3C BarcodeDetector (hardware-accelerated) and falls back to ZXing.
export async function decode(source) {
  if (typeof BarcodeDetector !== "undefined") {
    try {
      const fmts = await BarcodeDetector.getSupportedFormats?.().catch(() => []);
      if (!fmts || fmts.includes("qr_code")) {
        const det = new BarcodeDetector({ formats: ["qr_code"] });
        const codes = await det.detect(source);
        if (codes && codes.length) return codes[0].rawValue;
      }
    } catch {}
  }
  // ZXing fallback — rasterize the source to ImageData.
  let img = source;
  if (typeof ImageData !== "undefined" && source instanceof ImageData) return decodeImageData(source);
  if (typeof document !== "undefined") {
    const w = source.videoWidth || source.naturalWidth || source.width;
    const h = source.videoHeight || source.naturalHeight || source.height;
    if (!w || !h) return null;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d"); ctx.drawImage(source, 0, 0, w, h);
    img = ctx.getImageData(0, 0, w, h);
    return decodeImageData(img);
  }
  return null;
}

// scanVideo(video, onResult, { interval, signal }) — poll a live <video> (camera) until a QR is read
// or the AbortSignal fires; returns a stop() fn. onResult(text) is called once per distinct code.
export function scanVideo(video, onResult, { interval = 250, signal, once = true } = {}) {
  let stopped = false, last = null;
  const stop = () => { stopped = true; };
  if (signal) signal.addEventListener("abort", stop, { once: true });
  (async function loop() {
    while (!stopped) {
      try { const text = await decode(video); if (text && text !== last) { last = text; onResult(text); if (once) { stop(); break; } } } catch {}
      await new Promise((r) => setTimeout(r, interval));
    }
  })();
  return stop;
}

export const VERSION = "holo-qr 1.0 (node-qrcode 1.5.4 · ZXing 0.21.3, κ-pinned)";

if (typeof window !== "undefined") window.HoloQR = { create, toMatrix, toSVG, toCanvas, toDataURL, decode, decodeImageData, decodeLuminance, scanVideo, VERSION };
