// holo-identicon.mjs — a deterministic, content-derived VISUAL for a κ. Same bytes that make the
// content address make the picture: a 5×5 left-right-symmetric glyph (the GitHub-identicon idea) whose
// cells and colour come straight from the sha-256 digest. No randomness, no lookup — re-derives exactly
// like the address (so the picture IS the proof, just prettier). Returns a standalone SVG string, sized
// for an Open Graph card. Pure + dependency-free (browser · SW · Node).
//
//   import { identiconSvg } from "/_shared/holo-identicon.mjs";
//   identiconSvg("did:holo:sha256:5838…", { size: 320, label: "Holo Notepad" })

const hexOf = (k) => String(k).split(":").pop().toLowerCase();
const bytesOf = (hex) => { const u = new Uint8Array(32); for (let i = 0; i < 32; i++) u[i] = parseInt(hex.substr(i * 2, 2) || "0", 16); return u; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// identiconSvg(κ, opts) — opts: { size=320, label, card=true }. card=true draws an OG-card backdrop
// + the label + a short κ; card=false draws just the glyph (for a chip/favicon).
export function identiconSvg(kappa, { size = 320, label = "", card = true } = {}) {
  const hex = hexOf(kappa); const b = bytesOf(hex);
  const hue = Math.round((b[0] / 255) * 360), hue2 = (hue + 40 + (b[1] % 80)) % 360;
  const fg = `hsl(${hue} 70% 60%)`, fg2 = `hsl(${hue2} 70% 56%)`;
  // 5×5 grid, decide the 3 left columns (15 cells) from bits, mirror to the right → symmetric glyph.
  const cells = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) { const bit = b[2 + r * 3 + c]; if (bit & 1) cells.push([c, r], [4 - c, r]); }
  const W = card ? Math.round(size * 1.91) : size, H = size;      // 1.91:1 ≈ the OG card ratio (1200×630)
  const G = Math.round(size * 0.62), pad = (size - G) / 2, cell = G / 5;
  const gx = card ? pad : pad, gy = pad;
  const rects = cells.map(([c, r], i) => `<rect x="${(gx + c * cell).toFixed(1)}" y="${(gy + r * cell).toFixed(1)}" width="${(cell + 0.5).toFixed(1)}" height="${(cell + 0.5).toFixed(1)}" rx="${(cell * 0.18).toFixed(1)}" fill="${i % 2 ? fg2 : fg}"/>`).join("");
  const shortK = "sha256:" + hex.slice(0, 10) + "…";
  const text = card ? `
    <text x="${size + pad}" y="${H * 0.42}" font-family="ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif" font-size="${Math.round(size * 0.13)}" font-weight="700" fill="#f4f6fb">${esc(label || "Hologram")}</text>
    <text x="${size + pad}" y="${H * 0.56}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${Math.round(size * 0.066)}" fill="#9aa4bf">Running on Hologram · live on your device</text>
    <text x="${size + pad}" y="${H * 0.72}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="${Math.round(size * 0.058)}" fill="${fg}">${esc(shortK)}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label || "Hologram")} ${esc(shortK)}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0e17"/><stop offset="1" stop-color="#141a2b"/></linearGradient></defs>
  <rect width="${W}" height="${H}" rx="${Math.round(size * 0.08)}" fill="url(#bg)"/>
  <rect x="${(pad - cell * 0.4).toFixed(1)}" y="${(pad - cell * 0.4).toFixed(1)}" width="${(G + cell * 0.8).toFixed(1)}" height="${(G + cell * 0.8).toFixed(1)}" rx="${(cell * 0.5).toFixed(1)}" fill="#ffffff0a" stroke="${fg}" stroke-opacity="0.25"/>
  ${rects}${text}
</svg>`;
}
