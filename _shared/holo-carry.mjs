// holo-carry.mjs — THE LINK IS THE FILE (Files Teleport T1). For the files people actually fling
// between devices, the share link CARRIES the bytes in its URL FRAGMENT — which never touches the
// wire (the server only serves the static app; everything after # stays in the browser). A carry is
// private by construction, serverless by construction, and — because the link embeds the content's
// sha256 and the receiver RE-DERIVES before saving — verified by construction (Law L5 on the wire:
// a tampered link cannot deliver bytes under the original name/κ).
//
// Sibling, not replacement: holo-teleport.mjs shares a RUNNING thing by κ + signed provenance
// (resolved through the derive tiers). holo-carry moves the BYTES themselves, no resolver needed.
//
// Link form:  <filesAppUrl>#recv=1.<sha256hex>.<base64url(deflate-raw(bytes))>.<name-urlenc>
// (name LAST — it may contain dots; hex + payload are dot-free by construction)
// Tiers (MEASURED, T0 2026-07-09): the self-contained QR encoder (holo-qr-encode) tops out at a
// 2,331-char URL (binary-searched, version-40 byte mode). deflate-raw is native (CompressionStream)
// and crushes the dominant payloads (repeated text 1800→63 B; JSON 2691→302 B).
//   "qr"    total URL ≤ QR_URL_MAX          → scan = receive
//   "link"  payload ≤ LINK_PAYLOAD_MAX chars → send the link whole (copy / native share)
//   null    bigger → HONEST ABSENCE (caller keeps its existing rails; never a silent degrade)

export const QR_URL_MAX = 2300;           // measured 2331; margin for URL-encoding drift
export const LINK_PAYLOAD_MAX = 800000;   // ~600 KB raw after deflate — comfortably under address-bar limits

const b64u = {
  enc(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
  dec(s) { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(s); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; },
};
async function sha256hex(u8) {
  const h = await crypto.subtle.digest("SHA-256", u8);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}
const drain = (stream) => new Response(stream).arrayBuffer();
async function deflate(u8) { return new Uint8Array(await drain(new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw")))); }
async function inflate(u8) { return new Uint8Array(await drain(new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw")))); }

// carryEncode(bytes|Blob|string, {name, base}) → { url, hash, tier, size, hex } | { tier:null, size }
// `base` = the receiving app URL (defaults to the CURRENT page sans hash — the link opens Files anywhere).
export async function carryEncode(input, opts = {}) {
  const u8 = input instanceof Uint8Array ? input : typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(await input.arrayBuffer());
  const payload = b64u.enc(await deflate(u8));
  if (payload.length > LINK_PAYLOAD_MAX) return { tier: null, size: u8.length, payloadChars: payload.length };
  const name = encodeURIComponent(String(opts.name || "file").slice(0, 120));
  const hex = await sha256hex(u8);
  const hash = `#recv=1.${hex}.${payload}.${name}`;
  const base = String(opts.base || (typeof location !== "undefined" ? location.href.split("#")[0] : ""));
  const url = base + hash;
  return { url, hash, tier: url.length <= QR_URL_MAX ? "qr" : "link", size: u8.length, payloadChars: payload.length, hex };
}

// carryDecode(hashOrUrl) → { name, bytes, hex } | { error } — NEVER throws (boot-path safe).
// Re-derives the sha256 of the inflated bytes; mismatch → { error:"verify" } and NO bytes.
export async function carryDecode(hashOrUrl) {
  try {
    const m = String(hashOrUrl || "").match(/#recv=1\.([0-9a-f]{64})\.([A-Za-z0-9_-]+)\.([^#&?]*)/);
    if (!m) return { error: "not-a-carry" };
    const name = decodeURIComponent(m[3]) || "file";
    const bytes = await inflate(b64u.dec(m[2]));
    if (await sha256hex(bytes) !== m[1]) return { error: "verify", name };
    return { name, bytes, hex: m[1] };
  } catch { return { error: "malformed" }; }
}
