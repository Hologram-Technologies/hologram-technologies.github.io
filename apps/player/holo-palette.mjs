// holo-palette.mjs — per-title color: extract a title's dominant accent from its own artwork so each detail
// page feels bespoke (the Netflix "the page is the color of the poster" cue). The quantization is pure
// (pixels → palette) so Node witnesses it exactly; the browser binding samples the image on a small canvas
// (off a κ-served blob: URL → same-origin, no taint) and memoizes by URL.

// dominant(pixels, opts) → { rgb, hex, accent, accentRgb, scrim }. pixels = RGBA Uint8(Clamped)Array.
// Buckets colors at 5 bits/channel, skips near-black/near-white + transparent, and weights by saturation so a
// vivid minority beats a dull grey majority — the eye's "color of this poster", not its average mud.
export function dominant(pixels, { step = 1 } = {}) {
  const buckets = new Map();
  for (let i = 0; i < pixels.length; i += 4 * step) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
    if (a < 128) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), lum = (max + min) / 2;
    if (lum < 24 || lum > 235) continue;                 // ignore borders / black bars / blown highlights
    const sat = max === 0 ? 0 : (max - min) / max;
    const w = 0.15 + sat * sat * 6;                       // strongly favour colourful pixels (grey ≈ ignored)
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const cur = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    cur.n += w; cur.r += r * w; cur.g += g * w; cur.b += b * w; buckets.set(key, cur);
  }
  let best = null; for (const v of buckets.values()) if (!best || v.n > best.n) best = v;
  if (!best) return { rgb: [91, 140, 255], hex: "#5b8cff", accent: "#5b8cff", accentRgb: [91, 140, 255], scrim: "#0b0d10" };
  const rgb = [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
  const acc = toAccent(rgb);
  return { rgb, hex: hex(rgb), accent: hex(acc), accentRgb: acc, scrim: hex(scale(rgb, 0.18)) };
}

// Make a UI-safe accent: enough saturation + a mid-bright luminance so it reads on a dark page and as text.
function toAccent([r, g, b]) {
  let { h, s, l } = rgb2hsl(r, g, b);
  s = Math.max(s, 0.55); l = Math.min(Math.max(l, 0.5), 0.62);
  return hsl2rgb(h, s, l);
}
const scale = ([r, g, b], f) => [Math.round(r * f), Math.round(g * f), Math.round(b * f)];
const hx = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
const hex = ([r, g, b]) => "#" + hx(r) + hx(g) + hx(b);

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; let h = 0;
  const l = (max + min) / 2, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) { h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return { h, s, l };
}
function hsl2rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export default { dominant };

if (typeof window !== "undefined") {
  const memo = new Map();
  window.HoloPalette = {
    dominant,
    // fromImage(url) → palette | null. Pass a κ-served blob: URL (same-origin → canvas not tainted).
    async fromImage(url) {
      if (!url) return null;
      if (memo.has(url)) return memo.get(url);
      const p = await new Promise((res) => {
        const img = new Image(); img.crossOrigin = "anonymous";
        img.onload = () => { try { const w = 32, h = Math.max(1, Math.round(32 * (img.naturalHeight / img.naturalWidth || 1.5))); const c = document.createElement("canvas"); c.width = w; c.height = h; const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, w, h); res(dominant(ctx.getImageData(0, 0, w, h).data)); } catch { res(null); } };
        img.onerror = () => res(null); img.src = url;
      });
      memo.set(url, p); return p;
    },
  };
}
