// holo-qr.js — Holo QR: the hologram-native QR layer. GENERATION over the OS's OWN self-contained encoder
// (holo-qr-encode.mjs — pure ES Reed–Solomon, no vendored library, no CDN, no network; module-exact with
// the reference across all 40 versions × 4 ECC levels, see tools/holo-qr-witness.mjs) and READING over the
// browser-native W3C BarcodeDetector. Isomorphic: the same code makes a QR in the browser (served at
// /_shared/…) AND in Node (the witness), so generation is proven both places. Offline and serverless by
// construction — nothing here reaches the network.
//
// Used by Share (render a holospace link / token as a scannable QR) and the LAN/phone pairing flows.

import { encode } from "./holo-qr-encode.mjs";

// ── generate (self-contained encoder) ──────────────────────────────────────────────
// create(text, opts) → the raw QR symbol; ecc ∈ L|M|Q|H (default M). `data` is a flat 0/1 grid (compat).
export function create(text, { ecc = "M", version } = {}) {
  const qr = encode(String(text), { ecc, version });
  const data = new Uint8Array(qr.size * qr.size);
  for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) data[r * qr.size + c] = qr.modules[r][c] ? 1 : 0;
  return { size: qr.size, data, version: qr.version, ecc: qr.ecc };
}

// toMatrix(text, opts) → { size, version, ecc, modules: boolean[][] } (true = dark module).
export function toMatrix(text, opts) { return encode(String(text), opts || {}); }

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

// ── read (W3C BarcodeDetector) ──────────────────────────────────────────────────────
// decode(source) → Promise<text|null>. source: ImageData | canvas | ImageBitmap | <video>/<img>.
// Uses the browser-native, hardware-accelerated BarcodeDetector (supported on Chrome/Edge/Android and,
// behind a flag, others). Returns null where it is unavailable rather than pulling in a vendored reader —
// the OS generates QRs everywhere; reading is a best-effort on capable devices (the phones doing the scan).
export async function decode(source) {
  if (typeof BarcodeDetector === "undefined") return null;
  try {
    const fmts = await BarcodeDetector.getSupportedFormats?.().catch(() => []);
    if (fmts && !fmts.includes("qr_code")) return null;
    const det = new BarcodeDetector({ formats: ["qr_code"] });
    const codes = await det.detect(source);
    if (codes && codes.length) return codes[0].rawValue;
  } catch {}
  return null;
}
// barcodeDetectorAvailable() → whether live scanning is possible on this device.
export async function barcodeDetectorAvailable() {
  if (typeof BarcodeDetector === "undefined") return false;
  try { const f = await BarcodeDetector.getSupportedFormats?.().catch(() => []); return !f || f.includes("qr_code"); } catch { return false; }
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

export const VERSION = "holo-qr 2.0 (self-contained encoder · BarcodeDetector reader · no CDN)";

if (typeof window !== "undefined") window.HoloQR = { create, toMatrix, toSVG, toCanvas, toDataURL, decode, barcodeDetectorAvailable, scanVideo, VERSION };
