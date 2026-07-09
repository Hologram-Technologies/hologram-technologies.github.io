// holo-face.mjs — the OS-wide "living faces" resolver. ONE place that turns an identity
// (a name, an email, a domain, a bridge handle) into the REAL company logo or person photo,
// so every surface — messenger rows, mail inbox, call tiles, the operator disc, the feed —
// shows a recognizable face instead of a monogram, and falls back cleanly when it can't.
//
// Design (Law L3 — the store is the memory; Law L5 — verify what you show):
//   • faceURL(id)  → a synchronous URL for an <img src> (Tier 1). The bytes are fetched
//                    SERVER-SIDE by the local face resolver (never a raw cross-origin call
//                    from the app), so CORS and the operator's contact graph stay contained.
//                    A 404 just leaves the monogram in place — never blank, never an error.
//   • resolveFace(id) → Promise<objectURL|null> (Tier 2). Same bytes, but cached
//                    content-addressed in OPFS (holo-opfs-kappastore) → the second sighting
//                    is 0-network and survives reload/offline. In-flight-deduped + negatively
//                    cached so a logoless domain is asked once, not once per row.
//   • attachFace(img, id, {monogram}) → the one-liner for vanilla-DOM surfaces: paint the
//                    monogram now, swap in the durable face when it arrives, keep the monogram
//                    if it never does.
//
// The resolver endpoint (default: the local email-bridge on :8793) serves:
//   GET /face/domain/<domain>  → the company's real logo (logo CDN → favicon fallback)
//   GET /face/email/<email>    → the person's photo (gravatar)
// A domain is a COMPANY unless it is well-known freemail, in which case the address is a
// PERSON — this single heuristic is what lights up Anthropic/GitHub/Railway as logos while
// a personal gmail resolves to that person's photo.

let RESOLVER = "http://127.0.0.1:8793";                 // where /face/* is served (configurable)
export function configure(opts = {}) { if (opts.resolver) RESOLVER = String(opts.resolver).replace(/\/+$/, ""); }

// Consumer mail domains: an address here is a human, not a brand → resolve the person, not a logo.
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net", "mail.com", "zoho.com",
  "yandex.com", "yandex.ru", "fastmail.com", "hey.com", "qq.com", "163.com",
]);
// Two-part public suffixes where the registrable domain keeps 3 labels (foo.co.uk, not co.uk).
const TWO_PART_TLD = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "com.au", "net.au", "org.au", "co.nz",
  "co.jp", "com.br", "com.mx", "co.in", "co.za", "com.sg", "com.hk",
]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
export function extractEmail(s) { const m = EMAIL_RE.exec(String(s || "")); return m ? m[0].toLowerCase() : null; }
export function registrableDomain(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "").replace(/[.]+$/, "");
  const parts = h.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  const last2 = parts.slice(-2).join(".");
  const keep = TWO_PART_TLD.has(last2) ? 3 : 2;
  return parts.slice(-keep).join(".");
}
export function domainOf(email) { const at = String(email || "").split("@")[1]; return at ? registrableDomain(at) : null; }

// Normalize whatever a surface has into { email, domain, kind, bridge, key }.
// kind: "org" (show a logo) | "person" (show a photo) | null (nothing resolvable).
export function identify(id = {}) {
  const email = id.email || extractEmail(id.address) || extractEmail(id.handle) ||
                extractEmail(id.chat) || extractEmail(id.name) ||
                (id.key && EMAIL_RE.test(id.key) ? String(id.key).toLowerCase() : null);
  let domain = id.domain ? registrableDomain(id.domain) : (email ? domainOf(email) : null);
  if (!domain && id.url) { try { domain = registrableDomain(new URL(id.url).hostname); } catch {} }
  const org = !!domain && !FREEMAIL.has(domain);
  const kind = org ? "org" : (email ? "person" : null);
  return { email, domain, kind, bridge: id.bridge || null, key: id.key || null };
}

// Tier 1 — a synchronous URL for <img src>. Order: a real bridge photo (WhatsApp/Telegram
// contact pictures) wins for messaging contacts; otherwise a company logo by domain, then a
// person photo by email. Returns null when there's no signal → the monogram stands alone.
export function faceURL(id = {}) {
  const f = identify(id);
  if (f.kind === "org")    return `${RESOLVER}/face/domain/${encodeURIComponent(f.domain)}`;
  if (f.bridge && f.key)   return `${f.bridge.replace(/\/+$/, "")}/avatar/${encodeURIComponent(f.key)}`;
  if (f.kind === "person") return `${RESOLVER}/face/email/${encodeURIComponent(f.email)}`;
  return null;
}

async function sha256hex(s) {
  const u8 = new TextEncoder().encode(String(s || "").trim().toLowerCase());
  const h = await crypto.subtle.digest("SHA-256", u8);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Tier-1b — a DIRECT (no-proxy) URL for an <img src>, for surfaces with no local resolver reachable
// (the desktop shell, the feed): a company logo via a favicon service, a person via gravatar. These
// are loaded cross-origin as plain images (CORS-free for display) and cost one opaque domain/hash per
// face. Returns a string (org) or a Promise<string> (person, needs the email hash) or null.
export function directURL(id = {}) {
  const f = identify(id);
  if (f.kind === "org") return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(f.domain)}&sz=128`;
  if (f.kind === "person") return sha256hex(f.email).then((h) => `https://www.gravatar.com/avatar/${h}?s=160&d=404`);   // gravatar accepts SHA-256
  return null;
}

// A stable cache id for a face (so identical brands/people dedupe to one blob).
export function faceKey(id = {}) {
  const f = identify(id);
  if (f.kind === "org") return "org:" + f.domain;
  if (f.bridge && f.key) return "bridge:" + f.bridge + ":" + f.key;
  if (f.kind === "person") return "person:" + f.email;
  return null;
}

// ── Tier 2: content-addressed, offline-durable resolution ────────────────────────────────
let _store = null, _storeTried = false;
async function store() {
  if (_store || _storeTried) return _store;
  _storeTried = true;
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
    const { OpfsKappaStore } = await import("./holo-opfs-kappastore.mjs");
    _store = await OpfsKappaStore.open("holo-face");
  } catch { _store = null; }
  return _store;
}

const _mem = new Map();        // faceKey → objectURL   (positive, in-process)
const _inflight = new Map();   // faceKey → Promise      (dedupe concurrent resolves)
const _neg = new Map();        // faceKey → tsMs         (recent 404 — don't refetch)
const NEG_TTL = 24 * 3600e3;
const _idKappa = new Map();    // faceKey → "sha256:hex" (which blob a face resolved to; OPFS survives reload)

function blobUrl(u8, mime) { return URL.createObjectURL(new Blob([u8], { type: mime || "image/*" })); }

// resolveFace(id) → objectURL of the face bytes, or null. Cache-first (OPFS → 0 network,
// works offline), then the resolver, then negative-cached. Never throws.
export async function resolveFace(id = {}) {
  const key = faceKey(id);
  if (!key) return null;
  if (_mem.has(key)) return _mem.get(key);
  const neg = _neg.get(key); if (neg && Date.now() - neg < NEG_TTL) return null;
  if (_inflight.has(key)) return _inflight.get(key);

  const p = (async () => {
    const st = await store();
    // 1) OPFS hit (durable across reload/offline).
    const kap = _idKappa.get(key);
    if (st && kap) { try { const b = await st.get(kap); if (b) { const u = blobUrl(b); _mem.set(key, u); return u; } } catch {} }
    // 2) Resolver (server-side fetch, one per identity thanks to _inflight).
    const url = faceURL(id);
    if (!url) { _neg.set(key, Date.now()); return null; }
    try {
      const r = await fetch(url, { cache: "force-cache" });
      if (!r.ok) { _neg.set(key, Date.now()); return null; }
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength < 64) { _neg.set(key, Date.now()); return null; }   // reject 1×1 tracker/empty
      const mime = r.headers.get("content-type") || "image/*";
      if (st) { try { const k = await st.put("sha256", buf); st.pin(k); _idKappa.set(key, k); } catch {} }
      const u = blobUrl(buf, mime);
      _mem.set(key, u);
      return u;
    } catch { _neg.set(key, Date.now()); return null; }
  })();
  _inflight.set(key, p);
  try { return await p; } finally { _inflight.delete(key); }
}

// A synchronous peek — returns an already-resolved objectURL or null. Lets a render pass use
// the durable face immediately on re-render without awaiting.
export function cachedFace(id = {}) { const k = faceKey(id); return (k && _mem.get(k)) || null; }

// The one-liner for vanilla-DOM surfaces (mail inbox, feed, call tiles): paint `monogram` now, then
// fade the real face in on top when it resolves. Order: the sovereign, offline-durable proxy (κ-store)
// FIRST; if no resolver is reachable, a DIRECT logo/photo URL; if neither loads, the monogram stays.
// So it's sovereign+durable where a resolver runs, and still works anywhere it doesn't. Returns a
// cancel() to drop the async swap if the element is recycled.
export function attachFace(img, id, opts = {}) {
  if (!img) return () => {};
  let live = true;
  const mono = opts.monogram || null;
  if (mono && !img.getAttribute("src")) img.setAttribute("src", mono);
  const revert = () => { img.onerror = null; img.classList.remove("holo-face"); if (mono) img.setAttribute("src", mono); else img.removeAttribute("src"); };
  const setDirect = (u) => { if (!live || !u) return; img.onerror = revert; img.onload = () => img.classList.add("holo-face"); img.setAttribute("src", u); };
  const fallbackDirect = () => { try { Promise.resolve(directURL(id)).then(setDirect).catch(() => {}); } catch {} };
  resolveFace(id).then((url) => {
    if (!live) return;
    if (url) { img.classList.add("holo-face"); img.setAttribute("src", url); }   // proxy hit: κ-durable object URL
    else fallbackDirect();                                                        // no resolver → direct logo/photo
  }).catch(fallbackDirect);
  return () => { live = false; };
}

// A shared monogram (gradient disc + initial), so surfaces that adopt faces also share ONE
// fallback look. Deterministic from the name — matches the messenger's existing disc.
const _mono = new Map();
export function monogram(name, isGroup) {
  const ck = (isGroup ? "g " : "u ") + (name || "?");
  const hit = _mono.get(ck); if (hit) return hit;
  let h = 0; const s = name || "?"; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  h >>>= 0; const hue = h % 360, hue2 = (hue + 38) % 360;
  const initial = (name || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "#";
  const inner = isGroup
    ? '<g fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="3"><circle cx="24" cy="27" r="7"/><circle cx="42" cy="27" r="7"/><path d="M14,46 a10,9 0 0 1 20,0 M30,46 a10,9 0 0 1 20,0"/></g>'
    : `<text x="32" y="42" font-family="system-ui,-apple-system,Segoe UI,Roboto" font-size="28" font-weight="600" fill="#fff" text-anchor="middle">${initial}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},52%,46%)"/><stop offset="1" stop-color="hsl(${hue2},52%,30%)"/></linearGradient></defs><circle cx="32" cy="32" r="32" fill="url(#a)"/>${inner}</svg>`;
  const v = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  if (_mono.size > 6000) _mono.clear();
  _mono.set(ck, v); return v;
}

export default { configure, identify, faceURL, directURL, faceKey, resolveFace, cachedFace, attachFace, monogram, extractEmail, domainOf, registrableDomain };
