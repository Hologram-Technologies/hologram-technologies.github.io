// holo-image-meta.mjs — dependency-free image metadata from RAW (already-verified) bytes.
//
// Content addressing means the browser already holds the exact, verified bytes of an image (the κ/CID
// re-derived through the gateway). So we can read everything a premium gallery shows — format, true
// pixel dimensions, camera make/model, capture date, exposure, GPS — WITHOUT a server, a thumbnail
// service, or a network hop: pure header parsing over the Uint8Array. No dependencies; Node-witnessable.
//
// Layers:
//   detectFormat(bytes)      → { format, mime, animated? }        magic-byte sniff (PNG/JPEG/GIF/WebP/AVIF/…)
//   dimensions(bytes, fmt?)  → { width, height } | null           header read per format (IHDR/SOF/RIFF/ispe/…)
//   exif(bytes)              → { make, model, dateTime, gps, … }  JPEG APP1 → TIFF IFD walk (best-effort)
//   imageMeta(bytes)         → the whole picture, one call
// Every field is best-effort: a corrupt/absent header yields null/omitted, never a throw.

const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const be16 = (b, o) => ((b[o] << 8) | b[o + 1]) >>> 0;
const le16 = (b, o) => ((b[o + 1] << 8) | b[o]) >>> 0;
const le32 = (b, o) => ((b[o + 3] << 24) | (b[o + 2] << 16) | (b[o + 1] << 8) | b[o]) >>> 0;
const ascii = (b, o, n) => { let s = ""; for (let i = 0; i < n && b[o + i]; i++) s += String.fromCharCode(b[o + i]); return s; };

// ── format detection (magic bytes; supersedes the gateway's 4-format sniff) ───────────────────────
export function detectFormat(bytes) {
  const b = bytes; if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { format: "png", mime: "image/png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { format: "jpeg", mime: "image/jpeg" };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { format: "gif", mime: "image/gif", animated: true };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { format: "webp", mime: "image/webp" };
  if (b[0] === 0x42 && b[1] === 0x4d) return { format: "bmp", mime: "image/bmp" };
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {                 // ISO-BMFF 'ftyp'
    const brand = ascii(b, 8, 4);
    if (brand === "avif" || brand === "avis") return { format: "avif", mime: "image/avif" };
    if (brand.startsWith("hei") || brand === "mif1" || brand === "msf1") return { format: "heic", mime: "image/heic" };
  }
  // SVG (text) — sniff a leading <svg or <?xml … <svg
  const head = ascii(b, 0, 256).trim().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return { format: "svg", mime: "image/svg+xml" };
  return null;
}

// ── true pixel dimensions, per format (header read only — no decode) ──────────────────────────────
export function dimensions(bytes, fmt) {
  const b = bytes; const f = fmt || (detectFormat(b) || {}).format;
  try {
    if (f === "png") {                                             // IHDR: width @16, height @20 (BE u32)
      if (ascii(b, 12, 4) !== "IHDR") return null;
      return { width: be32(b, 16), height: be32(b, 20) };
    }
    if (f === "gif") return { width: le16(b, 6), height: le16(b, 8) };   // logical screen (LE u16)
    if (f === "bmp") { const w = le32(b, 18) | 0, h = le32(b, 22) | 0; return { width: Math.abs(w), height: Math.abs(h) }; }
    if (f === "jpeg") return jpegDims(b);
    if (f === "webp") return webpDims(b);
    if (f === "avif" || f === "heic") return heifDims(b);
  } catch {}
  return null;
}

// JPEG: walk segment markers to the first Start-Of-Frame (SOFn); dims are BE u16 at marker+5/+7.
function jpegDims(b) {
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) { o++; continue; }
    let marker = b[o + 1];
    while (marker === 0xff && o + 1 < b.length) { o++; marker = b[o + 1]; }   // skip fill bytes
    const isSOF = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) return { height: be16(b, o + 5), width: be16(b, o + 7) };
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }  // standalone
    const len = be16(b, o + 2); if (len < 2) break; o += 2 + len;            // segment with length
  }
  return null;
}

// WebP: RIFF → VP8 (lossy, 14-bit), VP8L (lossless, bit-packed), or VP8X (extended, 24-bit +1).
function webpDims(b) {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") { const w = le16(b, 26) & 0x3fff, h = le16(b, 28) & 0x3fff; return { width: w, height: h }; }
  if (chunk === "VP8L") {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") { const w = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, h = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1; return { width: w, height: h }; }
  return null;
}

// AVIF/HEIF: find the 'ispe' box (image spatial extents); dims are BE u32 right after its 4-byte version/flags.
function heifDims(b) {
  for (let i = 0; i + 12 < b.length && i < b.length - 4; i++) {
    if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65) {   // 'ispe'
      const o = i + 4 + 4;                                          // skip version/flags
      const w = be32(b, o), h = be32(b, o + 4);
      if (w > 0 && h > 0 && w < 100000 && h < 100000) return { width: w, height: h };
    }
  }
  return null;
}

// ── EXIF (JPEG APP1 → TIFF/IFD). Best-effort; returns {} when absent. ─────────────────────────────
const T_MAKE = 0x010f, T_MODEL = 0x0110, T_ORIENT = 0x0112, T_SOFTWARE = 0x0131, T_DATETIME = 0x0132,
  T_EXIFIFD = 0x8769, T_GPSIFD = 0x8825,
  E_DATEORIG = 0x9003, E_FNUMBER = 0x829d, E_EXPTIME = 0x829a, E_ISO = 0x8827, E_FOCAL = 0x920a,
  E_LENS = 0xa434, E_PIXX = 0xa002, E_PIXY = 0xa003,
  G_LATREF = 0x0001, G_LAT = 0x0002, G_LONREF = 0x0003, G_LON = 0x0004, G_ALT = 0x0006;

export function exif(bytes) {
  const b = bytes; const fmt = (detectFormat(b) || {}).format;
  if (fmt !== "jpeg") return {};                                   // (PNG/WebP XMP is a possible follow-on)
  // locate APP1 "Exif\0\0"
  let o = 2, tiff = -1;
  while (o + 4 < b.length) {
    if (b[o] !== 0xff) { o++; continue; }
    const marker = b[o + 1];
    if (marker === 0xe1) {
      const len = be16(b, o + 2);
      if (ascii(b, o + 4, 4) === "Exif") { tiff = o + 10; break; }
      o += 2 + len; continue;
    }
    if (marker === 0xda || marker === 0xd9) break;                 // start of scan / end → no EXIF
    if (marker >= 0xd0 && marker <= 0xd7) { o += 2; continue; }
    const len = be16(b, o + 2); if (len < 2) break; o += 2 + len;
  }
  if (tiff < 0 || tiff + 8 > b.length) return {};
  const little = b[tiff] === 0x49;                                 // 'II' little / 'MM' big
  const u16 = (p) => little ? le16(b, p) : be16(b, p);
  const u32 = (p) => little ? le32(b, p) : be32(b, p);
  const rational = (p) => { const n = u32(p), d = u32(p + 4); return d ? n / d : 0; };

  function readIFD(ifdOff, want) {
    const out = {}; if (ifdOff + 2 > b.length) return out;
    const n = u16(tiff + ifdOff);
    for (let i = 0; i < n; i++) {
      const e = tiff + ifdOff + 2 + i * 12; if (e + 12 > b.length) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
      const bytesLen = (sizes[type] || 1) * count;
      const valOff = bytesLen <= 4 ? e + 8 : tiff + u32(e + 8);
      if (!want || want.has(tag)) {
        if (type === 2) out[tag] = ascii(b, valOff, count).replace(/\0+$/, "").trim();     // ASCII
        else if (type === 3) out[tag] = u16(valOff);                                       // SHORT
        else if (type === 4) out[tag] = u32(valOff);                                       // LONG
        else if (type === 5 || type === 10) {                                              // (S)RATIONAL (possibly ×count)
          if (count === 1) out[tag] = rational(valOff);
          else { const arr = []; for (let k = 0; k < count && valOff + k * 8 + 8 <= b.length; k++) arr.push(rational(valOff + k * 8)); out[tag] = arr; }
        }
      }
    }
    return out;
  }

  const want0 = new Set([T_MAKE, T_MODEL, T_ORIENT, T_SOFTWARE, T_DATETIME, T_EXIFIFD, T_GPSIFD]);
  const ifd0 = readIFD(u32(tiff + 4) , want0);
  const meta = {};
  if (ifd0[T_MAKE]) meta.make = ifd0[T_MAKE];
  if (ifd0[T_MODEL]) meta.model = ifd0[T_MODEL];
  if (ifd0[T_ORIENT]) meta.orientation = ifd0[T_ORIENT];
  if (ifd0[T_SOFTWARE]) meta.software = ifd0[T_SOFTWARE];
  if (ifd0[T_DATETIME]) meta.dateTime = ifd0[T_DATETIME];

  if (ifd0[T_EXIFIFD]) {
    const ex = readIFD(ifd0[T_EXIFIFD], new Set([E_DATEORIG, E_FNUMBER, E_EXPTIME, E_ISO, E_FOCAL, E_LENS, E_PIXX, E_PIXY]));
    if (ex[E_DATEORIG]) meta.dateTaken = ex[E_DATEORIG];
    if (ex[E_FNUMBER]) meta.fNumber = round1(ex[E_FNUMBER]);
    if (ex[E_EXPTIME]) meta.exposure = exposureStr(ex[E_EXPTIME]);
    if (ex[E_ISO]) meta.iso = ex[E_ISO];
    if (ex[E_FOCAL]) meta.focalLength = round1(ex[E_FOCAL]);
    if (ex[E_LENS]) meta.lens = ex[E_LENS];
    if (ex[E_PIXX] && ex[E_PIXY]) meta.pixel = { width: ex[E_PIXX], height: ex[E_PIXY] };
  }
  if (ifd0[T_GPSIFD]) {
    const g = readIFD(ifd0[T_GPSIFD], new Set([G_LATREF, G_LAT, G_LONREF, G_LON, G_ALT]));
    const lat = dms(g[G_LAT], g[G_LATREF]), lon = dms(g[G_LON], g[G_LONREF]);
    if (lat != null && lon != null) meta.gps = { lat, lon, ...(g[G_ALT] != null ? { alt: round1(+g[G_ALT] || 0) } : {}) };
  }
  return meta;
}

const round1 = (n) => Math.round(n * 10) / 10;
function exposureStr(s) { if (!s) return null; if (s >= 1) return round1(s) + "s"; const d = Math.round(1 / s); return "1/" + d + "s"; }
function dms(arr, ref) {
  if (!Array.isArray(arr) || arr.length < 3) return null;
  let dec = (+arr[0] || 0) + (+arr[1] || 0) / 60 + (+arr[2] || 0) / 3600;
  if (ref === "S" || ref === "W") dec = -dec;
  return Math.round(dec * 1e6) / 1e6;
}

// ── the one call a card makes ─────────────────────────────────────────────────────────────────────
export function imageMeta(bytes) {
  const fmt = detectFormat(bytes);
  if (!fmt) return null;
  const dims = dimensions(bytes, fmt.format);
  const ex = exif(bytes);
  const out = { format: fmt.format, mime: fmt.mime, bytes: bytes.length };
  if (dims) { out.width = dims.width; out.height = dims.height; out.megapixels = Math.round((dims.width * dims.height) / 1e5) / 10; out.aspect = dims.height ? round1(dims.width / dims.height) : null; }
  if (ex && Object.keys(ex).length) out.exif = ex;
  return out;
}

// human-friendly bytes (for captions)
export function humanBytes(n) { n = +n || 0; if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(1) + " KB"; if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB"; return (n / 1073741824).toFixed(2) + " GB"; }

export const VERSION = "holo-image-meta 1.0";
export default { detectFormat, dimensions, exif, imageMeta, humanBytes, VERSION };
