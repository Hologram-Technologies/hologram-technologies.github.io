// holo-open.mjs — "press play": THE one open path. Every way of opening something — a Continue-watching
// card, a search result, a shared link, an agent/Q intent — routes through ONE seam so the experience is
// identical: tap → it plays. This does not reimplement the omnibar's resolver (omniGo) — it wraps it as a
// SUPERSET that also handles the app-id / space forms omniGo's κ-matcher doesn't (holo://<appid>,
// holo://space/<id>), then delegates every other ref (κ · three-words · CID · onion · web3 · web · media ·
// free text) to omniGo unchanged. Pure classifier (classifyOpen) is node-witnessable; makeOpen is the seam.
//
// classifyOpen is a SHAPE classifier (side-effect-free) so an agent can ask "is this openable, and how?"
// BEFORE opening — distinct from the catalog-aware omni `classify` that resolves a ref to an actual app.

// classifyOpen(ref) → { kind } — the open taxonomy, by shape alone:
//   space   holo://space/<id>            → a holospace/room
//   kappa   did:holo:sha256:<hex> | <64hex> | holo://<hex>   → a content address (an app or object)
//   app     holo://<id>                  → a named app (non-hash holo:// ref, e.g. holo://org.hologram.X)
//   words   a.b.c                        → a three-word κ-name
//   cid     ipfs://… | Qm… | bafy…       → an IPFS object
//   onion   …​.onion                       → a Tor v3 site
//   url     http(s)://…                  → a live web page
//   media   …​.mp4/.mp3/…                  → a streamable media file
//   text    anything else                → free text → search / find
export function classifyOpen(ref) {
  const v = String(ref == null ? "" : ref).trim();
  if (!v) return { kind: "empty" };
  if (/^holo:\/\/space\//i.test(v)) return { kind: "space" };
  if (/^did:holo:sha256:[0-9a-f]{64}$/i.test(v) || /^[0-9a-f]{64}$/i.test(v) || /^holo:\/\/[0-9a-f]{64}$/i.test(v)) return { kind: "kappa" };
  if (/^holo:\/\//i.test(v)) return { kind: "app" };                 // holo://<appid> (non-hash)
  // a bare domain (no scheme) ending in a known TLD → the web. Checked BEFORE three-words so
  // "news.ycombinator.com" is a site, not a κ-name (κ-names are speakable words, never a TLD).
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(v) && /\.(com|org|net|io|app|dev|co|ai|xyz|eth|me|gg|sh|tv|edu|gov|info|biz|news|so|fm)$/i.test(v)) return { kind: "url" };
  if (/^[a-z]+\.[a-z]+\.[a-z]+$/i.test(v)) return { kind: "words" };   // three speakable words (pure letters, no TLD)
  if (/^(ipfs:\/\/)/i.test(v) || /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]+)$/i.test(v) || /\/ipfs\//i.test(v)) return { kind: "cid" };
  if (/\.onion(\b|\/|:)/i.test(v)) return { kind: "onion" };
  if (/\.(mp4|webm|mov|mkv|mp3|wav|flac|ogg|m4a|aac)(\?|#|$)/i.test(v)) return { kind: "media" };   // a media file (even at an http URL) → play it, not browse it (matches omniGo)
  if (/^https?:\/\//i.test(v)) return { kind: "url" };
  return { kind: "text" };
}

// idOf(ref) — the bare id for the app/space forms (strip the holo:// or holo://space/ prefix).
export const idOf = (ref) => String(ref || "").replace(/^holo:\/\/space\//i, "").replace(/^holo:\/\//i, "");

// makeOpen({ space, app, fallback }) → open(ref). space(id)/app(id) handle the named forms; fallback(ref)
// is the full resolver (the shell wires omniGo) for every other shape. ONE call opens anything, the same way.
export function makeOpen({ space = null, app = null, fallback = null } = {}) {
  return async function open(ref) {
    const v = String(ref == null ? "" : ref).trim(); if (!v) return null;
    const { kind } = classifyOpen(v);
    try {
      if (kind === "space" && space) return await space(idOf(v));
      if (kind === "app" && app) return await app(idOf(v));
      if (fallback) return await fallback(v);     // kappa · words · cid · onion · url · media · text
    } catch (e) { /* fail-soft */ }
    return null;
  };
}

if (typeof window !== "undefined") window.HoloOpenLib = { classifyOpen, idOf, makeOpen };
export default { classifyOpen, idOf, makeOpen };
