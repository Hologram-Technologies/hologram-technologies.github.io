// holo-bar.mjs — a chrome bar (bookmarks / rail) is a κ-list. An item is a κ-reference; rendering is
// projection. ONE schema + ONE renderer serve BOTH the bookmarks bar (under the address bar) and the action
// rail (right of it). The bar's identity follows its bytes (Law L1); a tampered list can't pass (Law L5).
//
// canonicalBar / barKappa / verifyBar / buildBarModel are PURE (node-witnessable). renderBar is the DOM.

import { blake3hex } from "./holo-blake3.mjs";

export const BAR_KINDS = ["bookmarks", "rail"];

// §1.2: the ONE canonical content hash is BLAKE3. A bar's κ is minted from its bytes with BLAKE3, in-module
// (blake3hex is pure JS — isomorphic browser + node, sync — so no platform import is needed). The optional
// injected `digest` is kept ONLY as the legacy sha256 reader so bars minted before §1.2 still verify.
const enc = (s) => new TextEncoder().encode(String(s));

// canonicalBar(items) → the deterministic bytes that define the bar's identity. Order matters (a bar IS an
// ordering); per item we keep only identity + display, in a fixed key order, so the same list always hashes
// the same and a reorder mints a different κ.
export function canonicalBar(items = []) {
  const norm = (it) => {
    const o = {
      ref: String((it && it.ref) || ""),
      label: String((it && it.label) || ""),
      icon: String((it && it.icon) || ""),
      words: String((it && it.words) || ""),
      open: String((it && it.open) || ""),
    };
    // kind is appended ONLY when meaningful: absent / "" / "app" keep the original byte layout, so bars
    // (and shared P4 tokens) minted before this field still hash to the SAME κ and still verify (Law L5).
    const kind = String((it && it.kind) || "");
    if (kind && kind !== "app") o.kind = kind;
    return o;
  };
  return JSON.stringify((Array.isArray(items) ? items : []).map(norm));
}

// barKappa(items) → did:holo:blake3:<hex>. The κ is minted from the bar's canonical bytes with BLAKE3
// (§1.2). `digest` is accepted-and-ignored for call-site compatibility; the mint no longer depends on it.
export async function barKappa(items, _digest) {
  return "did:holo:blake3:" + blake3hex(enc(canonicalBar(items)));
}

// verifyBar(items, expectedKappa, digest) → boolean. Fail-closed (Law L5): re-derive and compare; any
// tamper, or any error, returns false. Dual-read: accepts the new BLAKE3 κ OR a legacy sha256 κ (so a bar
// stored/shared before §1.2 still opens); the legacy axis is checked only when a sha256 `digest` is supplied.
export async function verifyBar(items, expectedKappa, digest) {
  try {
    const want = String(expectedKappa || "");
    if ((await barKappa(items)) === want) return true;
    // legacy dual-read: a pre-§1.2 bar addressed as did:holo:sha256:<hex> via the injected sha256 digest.
    if (typeof digest === "function" && /^did:holo:sha256:/.test(want)) {
      return ("did:holo:sha256:" + (await digest(canonicalBar(items)))) === want; // legacy dual-read
    }
    return false;
  } catch { return false; }
}

// ── share a bar as a verified link ──────────────────────────────────────────────────────────────────
// A bar travels as a self-verifying token: base64url(JSON{ v, k, items }) where k is the bar's κ. The
// receiver re-derives κ from the carried items and trusts ONLY on a match (Law L5, fail-closed) — the link
// carries the bytes, the κ proves them, so no global store or server is needed. Works in browser + node.
function b64urlEncode(str) {
  if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return Buffer.from(str, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  if (typeof atob === "function") return decodeURIComponent(escape(atob(t)));
  return Buffer.from(t, "base64").toString("utf8");
}

// barShareToken(items, digest) → a compact, self-verifying link token for the current bar.
export async function barShareToken(items, digest) {
  const k = await barKappa(items, digest);
  return b64urlEncode(JSON.stringify({ v: 1, k, items: Array.isArray(items) ? items : [] }));
}

// verifyBarToken(token, digest) → { ok, items, kappa }. Fail-closed: a tampered token (items != κ) returns
// ok:false and no items — the receiver previews/adopts only what verifies.
export async function verifyBarToken(token, digest) {
  try {
    const obj = JSON.parse(b64urlDecode(token));
    if (!obj || obj.v !== 1 || !Array.isArray(obj.items) || typeof obj.k !== "string") return { ok: false, items: [], kappa: null };
    const ok = await verifyBar(obj.items, obj.k, digest);
    return { ok, items: ok ? obj.items : [], kappa: obj.k };
  } catch (e) { return { ok: false, items: [], kappa: null }; }
}

// buildBarModel(items, { catalog }) → display rows. Each ref is resolved against the app catalog for a
// label / words / icon when the item carries none (the ref is the identity; display is a projection, Law L1).
// A deterministic letter-chip hue is always derivable, so a row NEVER renders blank.
function hashHue(s) { let h = 0; s = String(s); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }
export function buildBarModel(items = [], { catalog = [] } = {}) {
  const byDid = new Map(), byId = new Map();
  for (const a of (catalog || [])) { if (a && a.did) byDid.set(a.did, a); if (a && a.id) byId.set(a.id, a); }
  const rows = [];
  for (const it of (Array.isArray(items) ? items : [])) {
    if (!it || !it.ref) continue;
    const ref = String(it.ref);
    const hit = byDid.get(ref) || byId.get(ref) || byId.get(ref.replace(/^holo:\/\//, "")) || null;
    rows.push({
      ref,
      kind: String(it.kind || "app"),       // app | ext | bar | action — branches OPEN behavior, not render
      label: it.label || (hit && hit.name) || ref,
      words: it.words || (hit && hit.words) || "",
      icon: it.icon || (hit && hit.icon) || "",
      open: it.open || ref,                 // open target; the ref (a κ / app id) by default
      hue: hashHue(ref),
    });
  }
  return rows;
}

// renderBar(model, mountEl, { onOpen, onContext }) → paints the bar; returns the count rendered. An item is
// an icon (served image · emoji glyph · deterministic letter chip) + a label; click → onOpen(row).
const IMG_RE = /\.(svg|png|webp|ico|jpe?g|gif)$/i;
export function renderBar(model = [], mountEl, { onOpen = null, onContext = null } = {}) {
  if (!mountEl) return 0;
  mountEl.textContent = "";
  for (const row of model) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "holo-bar-item";
    b.title = row.label + (row.words ? "  ·  " + row.words : "");
    b.setAttribute("data-ref", row.ref);
    if (row.icon && IMG_RE.test(row.icon)) {
      const img = document.createElement("img");
      img.src = row.icon; img.alt = ""; img.width = 16; img.height = 16; img.className = "bi-img";
      b.appendChild(img);
    } else if (row.icon) {
      const s = document.createElement("span"); s.className = "bi-glyph"; s.textContent = row.icon; b.appendChild(s);
    } else {
      const s = document.createElement("span"); s.className = "bi-chip";
      s.style.setProperty("--bi-hue", String(row.hue));
      s.textContent = (String(row.label || "?").trim().charAt(0) || "?").toUpperCase();
      b.appendChild(s);
    }
    const lbl = document.createElement("span"); lbl.className = "bi-label"; lbl.textContent = row.label;
    b.appendChild(lbl);
    b.addEventListener("click", () => { try { onOpen && onOpen(row); } catch (e) {} });
    if (onContext) b.addEventListener("contextmenu", (e) => { e.preventDefault(); try { onContext(row, e); } catch (x) {} });
    mountEl.appendChild(b);
  }
  return model.length;
}

if (typeof window !== "undefined") window.HoloBar = { BAR_KINDS, canonicalBar, barKappa, verifyBar, barShareToken, verifyBarToken, buildBarModel, renderBar };
export default { BAR_KINDS, canonicalBar, barKappa, verifyBar, barShareToken, verifyBarToken, buildBarModel, renderBar };
