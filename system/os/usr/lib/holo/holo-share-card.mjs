// holo-share-card.mjs — the ONE canonical unfurl card for a shared κ app (κ-Open Phase 4).
//
// Law L2 (one canonical wire, no drift): BOTH the dev server (tools/holo-serve-fhs.mjs, which injects the
// card dynamically on /~<app>) AND the build baker (tools/gen-apps-catalog.mjs, which writes a STATIC
// /~<app>/index.html for the prod static host) emit byte-identical OG heads from this module. So a shared
// link looks alive in iMessage/X/WhatsApp/Slack BEFORE the click — a beautiful, content-derived κ-identicon
// card — whether it was served by the dev Node server or a dumb GitHub Pages host.
//
// theme-color = the deep-space loader base (#05070f) so the browser chrome matches the immersive open.
// The poster is the κ-identicon (holo-identicon) — derived from the SAME bytes as the address, never a live
// iframe. Pure + dependency-free (Node · SW · browser).

import { identiconSvg } from "./holo-identicon.mjs";

export const OG_SIZE = 320;
export const OG_W = Math.round(OG_SIZE * 1.91);     // the identicon card ratio (≈1.91:1, the OG 1200×630 shape)
export const OG_H = OG_SIZE;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// shareCardMeta({ id, name, summary, origin }) → the OG/twitter/theme-color <meta> block for a shared app.
// `origin` (e.g. "https://host") makes the URLs absolute (strict crawlers); absent ⇒ root-relative (most
// crawlers resolve og:image against the page URL). `id` is the app's SHORT id (the /~<id> path segment).
export function shareCardMeta({ id, name, summary, origin = "" }) {
  const base = origin ? String(origin).replace(/\/+$/, "") : "";
  const img = `${base}/~${id}/og.svg`;
  const url = `${base}/~${id}`;
  return `\n  <meta name="theme-color" content="#05070f">`
    + `\n  <meta name="color-scheme" content="dark">`
    + `\n  <meta property="og:type" content="website">`
    + `\n  <meta property="og:site_name" content="Hologram">`
    + `\n  <meta property="og:url" content="${esc(url)}">`
    + `\n  <meta property="og:title" content="${esc(name)}">`
    + `\n  <meta property="og:description" content="${esc(summary)}">`
    + `\n  <meta property="og:image" content="${esc(img)}">`
    + `\n  <meta property="og:image:width" content="${OG_W}">`
    + `\n  <meta property="og:image:height" content="${OG_H}">`
    + `\n  <meta name="twitter:card" content="summary_large_image">`
    + `\n  <meta name="twitter:title" content="${esc(name)}">`
    + `\n  <meta name="twitter:description" content="${esc(summary)}">`
    + `\n  <meta name="twitter:image" content="${esc(img)}">`
    + `\n  <meta name="holo:app" content="${esc(id)}">`;
}

// shareCardSvg({ kappa, name }) → the content-derived OG image (poster from κ, no iframe).
export function shareCardSvg({ kappa, name }) {
  return identiconSvg(kappa, { size: OG_SIZE, label: name });
}

// shareCardPage({ id, name, summary, kappa, origin }) → a STATIC baked landing page for the prod static
// host. The CRAWLER reads the OG head; a HUMAN is booted straight into the live κ projection (fullscreen
// share-to-run). Mirrors the dev server's dynamic /~<app> response so dev and prod read identically.
export function shareCardPage({ id, name, summary, kappa, origin = "" }) {
  const meta = shareCardMeta({ id, name, summary, origin });
  const ref = /^did:holo:sha256:[0-9a-f]{64}$/.test(String(kappa)) ? kappa : id;   // κ-native when pinned, else id
  const boot = `/holospace.html?app=${encodeURIComponent(ref)}&shared=1`;
  return `<!doctype html>
<html lang="en" data-holo-boot="off">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(name)} · Hologram</title>${meta}
<meta http-equiv="refresh" content="0; url=${esc(boot)}">
<link rel="canonical" href="${esc(boot)}">
<style>html,body{height:100%;margin:0;background:#05070f;color:#eef0fb;
  font:500 1rem/1.5 system-ui,-apple-system,sans-serif}
 .c{position:fixed;inset:0;display:grid;place-content:center;justify-items:center;gap:1rem;text-align:center}
 .c svg{width:120px;height:120px;opacity:.92}</style>
</head>
<body>
<div class="c">${identiconSvg(kappa, { size: 120, card: false })}<div>Opening ${esc(name)}…</div></div>
<!-- Boot into the live κ projection, PRESERVING the URL hash — a shared link carries #k=<cid> (the teleport
     content handle) and &w=<board> in the fragment; dropping it would lose the shared provenance. -->
<script>location.replace(${JSON.stringify(boot)} + (location.hash || ""));</script>
</body>
</html>
`;
}
