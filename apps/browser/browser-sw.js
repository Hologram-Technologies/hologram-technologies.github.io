// browser-sw.js — Holo Browser's loading seam, as a service worker. This IS Chromium's
// URLLoaderFactory → URLLoader → ResourceHandler chain (the Network Service), realized over
// the κ-store: every resource the renderer iframe is about to see passes through here and is
// content-addressed + VERIFIED BY RE-DERIVATION before it is served (Law L5). A byte that does
// not re-derive to its address is REFUSED with 502. The native CEF build wires the same seam
// with CefResourceHandler; this is the in-OS twin.
//
// Scope: <base>webview/ (derived from the SW's own registration, base-path aware like
// ipfs-sw.js, so it works at the origin root or under /<repo>/ on static hosting).
//
//   <base>webview/h/<κ>            — a holo://<κ> document: served from the κ-store, re-derived.
//   <base>webview/w/<b64url(url)>  — a live http(s) page: fetched once through the dumb /web
//                                    proxy, MINTED into a κ (blake3 over its bytes), cached,
//                                    re-derived, then served. First sighting mints the address;
//                                    every replay re-derives it.
//   any cross-origin request from a webview iframe — a navigation is re-entered into the
//                                    content-addressed renderer (302 → webview/w/…); a
//                                    subresource is proxied + minted + re-derived on the fly.
//
// IPFS/IPNS are handled by the Holo IPFS gateway (ipfs-sw.js, scope <base>ipfsview/), which the
// page registers alongside this one — the dweb protocol handler is reused, not reimplemented.
//
// Module service worker → it imports the SAME engine the page + witness + MCP tools use.

import { kappaOf, verifyKappa } from "./_shared/holo-browser.js";
import { mimeByExt } from "./_shared/holo-ipfs.js";
import { ruleMatches } from "./_shared/holo-crx.js";
import { contentScriptTags } from "./_shared/holo-ext.js";
import { detectPaywall, unlock as ladderUnlock, archiveSources, ladderHeaders } from "./_shared/holo-ladder.mjs";

const KSTORE = "holo-browser-kappa-v1";              // Cache API: minted/owned blocks, keyed by κ
const VIEW = new URL(self.registration.scope).pathname.replace(/\/?$/, "/");   // <base>webview/
const APP_BASE = VIEW.replace(/webview\/$/, "");     // <base>
const WEB_PROXY = APP_BASE + "web?url=";             // holo-serve's dumb-pipe live-web proxy

// ── LADDER (paywall bypass) mode: "auto" (default — unlock only when a wall is detected), "on"
// (force the reader on every doc), "off" (never). Mirrored to a Cache like the operator κ so a
// terminated-then-restarted SW keeps the setting. The page toggles it via {type:"ladder"}. ──
const LSTORE = "holo-browser-ladder-v1";
let LADDER_MODE = "auto";
let LADDER_LOADED = false;
async function loadLadder() { if (LADDER_LOADED) return LADDER_MODE; LADDER_LOADED = true; try { const c = await caches.open(LSTORE); const r = await c.match("/mode"); if (r) { const v = (await r.text()).trim(); if (v === "on" || v === "off" || v === "auto") LADDER_MODE = v; } } catch {} return LADDER_MODE; }
async function persistLadder(m) { try { const c = await caches.open(LSTORE); await c.put("/mode", new Response(m || "auto")); } catch {} }

// ── installed κ-addressed extensions, projected onto the seam (the page posts seamBundle() on any
// install/enable/disable). browser-sw.js IS Chromium's URLLoaderFactory over the κ-store, so MV3's
// declarativeNetRequest maps STRAIGHT onto it: every request is matched against the enabled compiled
// ruleset before it is fetched/minted, and matching content scripts are inlined into served HTML.
// Only bytes that re-derived to a κ-verified extension (holo-ext.install, Law L5) ever reach here. ─
let EXT = { dnr: [], contentScripts: [] };
// The seam's rules live in-memory, so a terminated-then-restarted SW (they are ephemeral) would forget
// them and silently stop blocking until the page happens to re-push. Persist them to a Cache and reload
// on first use → ad-blocking survives SW restarts AND loads that never re-pushed (Law L3: the store is
// the memory). ESTORE holds one entry; ensureExt() hydrates EXT lazily, once per SW lifetime.
const ESTORE = "holo-browser-ext-v1";
let EXT_LOADED = false;
async function ensureExt() {
  if (EXT_LOADED) return;
  EXT_LOADED = true;
  if (EXT.dnr.length) return;                 // page already pushed this lifetime — that wins
  try { const c = await caches.open(ESTORE); const r = await c.match("/__ext"); if (r) { const j = await r.json(); EXT = { dnr: Array.isArray(j.dnr) ? j.dnr : [], contentScripts: Array.isArray(j.contentScripts) ? j.contentScripts : [] }; } } catch {}
}
async function persistExt() { try { const c = await caches.open(ESTORE); await c.put("/__ext", new Response(JSON.stringify({ dnr: EXT.dnr, contentScripts: EXT.contentScripts }), { headers: { "content-type": "application/json" } })); } catch {} }
const REQTYPE = { document: "main_frame", iframe: "sub_frame", frame: "sub_frame", script: "script", style: "stylesheet", image: "image", imageset: "image", font: "font", media: "media", track: "media", object: "object", embed: "object", worker: "script", "": "xmlhttprequest" };
const resourceTypeOf = (req) => req.mode === "navigate" ? (req.destination === "iframe" || req.destination === "frame" ? "sub_frame" : "main_frame") : (REQTYPE[req.destination] || "xmlhttprequest");
// A public relay hands back the right BYTES but often the wrong content-type — a PDF/JPG/MP4/MP3 labeled
// text/html renders as broken HTML instead of the file. When the URL has an unambiguous media/file
// extension AND the egress typed it generically (html/plain/octet-stream, or nothing), trust the
// extension: the file renders natively (image viewer, PDF viewer, <video>). A real page (.html / no
// extension / a specific type like application/json) keeps its egress type untouched.
function typeForUrl(realUrl, egressCt) {
  let ext = ""; try { ext = mimeByExt(new URL(realUrl).pathname) || ""; } catch { ext = mimeByExt(realUrl) || ""; }
  if (!ext || /^text\/html/i.test(ext)) return egressCt || ext || "application/octet-stream";   // no media hint → keep egress
  if (!egressCt || /^(text\/html|text\/plain|application\/octet-stream|binary\/octet-stream)\b/i.test(egressCt)) return ext;  // egress mislabeled a known file → extension wins
  return egressCt;
}
// match a request URL against the compiled DNR ruleset → the winning action ({type:"allow"} if none).
function dnrAction(url, resourceType) {
  for (const r of EXT.dnr) { try { if (ruleMatches(r, url, resourceType)) return { ...(r.action || { type: "block" }), extId: r.extId, ruleId: r.id }; } catch {} }
  return { type: "allow" };
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// ── ad-κ SURROGATES — "synthesize, don't hole" (SEC-8 bounded). A blocked ad/tracker request must NOT
// return a bare empty body: a blocked SCRIPT that a page expects to define gtag/ga/fbq throws
// ReferenceError and cascades into breaking the real page; a blocked IMAGE shows a broken-image icon;
// a blocked FRAME collapses layout. Return a benign, correctly-typed stand-in instead — the tracker is
// gone, the page stays whole. This is what makes ad-blocking SEAMLESS, not just present. ──
const SURR_GIF = Uint8Array.of(0x47,0x49,0x46,0x38,0x39,0x61,1,0,1,0,0x80,0,0,0,0,0,0,0,0,0,0x21,0xf9,4,1,0,0,0,0,0x2c,0,0,0,0,1,0,1,0,0,2,2,0x44,1,0,0x3b);  // 1×1 transparent GIF
// no-op stand-ins for the analytics/consent globals pages call inline (prevents "X is not defined")
const SURR_JS = "(function(){var n=function(){};try{var w=self;w.ga=w.ga||n;w.gtag=w.gtag||n;w.fbq=w.fbq||n;w.dataLayer=w.dataLayer||[];w._gaq=w._gaq||{push:n};w.__tcfapi=w.__tcfapi||n;w.googletag=w.googletag||{cmd:{push:n},pubads:function(){return{}}};}catch(e){}})();";
function adSurrogate(resourceType, extId) {
  const H = (ct) => ({ "content-type": ct, "x-holo-blocked": String(extId || "1"), "x-holo-surrogate": "1", ...COEPH });
  switch (resourceType) {
    case "script": return new Response(SURR_JS, { status: 200, headers: H("application/javascript; charset=utf-8") });
    case "image":  return new Response(SURR_GIF, { status: 200, headers: H("image/gif") });
    case "stylesheet": return new Response("", { status: 200, headers: H("text/css; charset=utf-8") });
    case "sub_frame": return new Response("<!doctype html><meta charset=utf-8><title></title>", { status: 200, headers: H("text/html; charset=utf-8") });
    case "font": case "media": case "object": return new Response(new Uint8Array(), { status: 200, headers: H("application/octet-stream") });
    default: return new Response("", { status: 200, headers: H("text/plain; charset=utf-8") });   // xhr/fetch/other → empty, benign
  }
}

// ── base64url for the web token (isomorphic; no Buffer in a SW) ──────────────────────
const enc = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const dec = (s) => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); return decodeURIComponent(escape(atob(t.padEnd(Math.ceil(t.length / 4) * 4, "=")))); };

// ── κ-store over the Cache API (shared with the page; both are same-origin) ──────────
// κ-store writes are SERIALIZED (one put in flight) and FAIL-SOFT. Chromium throws InvalidAccessError
// "Entry already exists" on CONCURRENT cache.put() to the same Cache — even for different keys — so a page
// whose subresources (images, css) load in parallel would fail en masse if that error bubbled up and refused
// the resource (the real bug behind onion images 0/7). One promise chain caps it at one put() at a time;
// writes are local + fast (only the Tor fetch is the latency floor). κ is the content hash, so a duplicate
// write is byte-identical — skip if present, swallow any error. Never throws, never refuses a render.
let K_WRITE = Promise.resolve();
function kPut(kappa, bytes, meta = {}) {
  const run = K_WRITE.then(async () => {
    try {
      const cache = await caches.open(KSTORE);
      if (await cache.match("/__k/" + kappa)) return;   // already stored — content-addressed, identical bytes
      await cache.put("/__k/" + kappa, new Response(bytes, { headers: { "content-type": meta.contentType || "application/octet-stream", "x-holo-source": meta.source || "" } }));
    } catch (e) { /* κ-store write failed (e.g. Chromium concurrent-put) — benign; render is unaffected */ }
  });
  K_WRITE = run.catch(() => {});
  return run;
}
async function kGet(kappa) { const cache = await caches.open(KSTORE); const r = await cache.match("/__k/" + kappa); return r ? new Uint8Array(await r.arrayBuffer()) : null; }

// ── URL→κ index — the L3 line: the store is the memory, a repeat visit is a cache hit.
// Every GET that mints records url → {kappa, contentType, ts}; a later request for the same URL
// serves the κ-store FIRST (re-derived, Law L5) and touches the wire only on a miss. This is
// what makes the browser work on a 100% serverless mount, and offline, by law not by luck. ──
const USTORE = "holo-browser-url-v1";
let U_WRITE = Promise.resolve();   // serialize url-index writes for the same reason as kPut (Chromium concurrent-put race)
function uPut(realUrl, entry) {
  const run = U_WRITE.then(async () => { try { const cache = await caches.open(USTORE); await cache.put("/__u/" + enc(realUrl), new Response(JSON.stringify(entry), { headers: { "content-type": "application/json" } })); } catch (e) { /* fail-soft: a url-index write miss just costs a re-fetch next visit */ } });
  U_WRITE = run.catch(() => {}); return run;
}
async function uGet(realUrl) { try { const cache = await caches.open(USTORE); const r = await cache.match("/__u/" + enc(realUrl)); return r ? await r.json() : null; } catch { return null; } }
// serve a URL straight from the κ-store if we hold it (verified) — null means "go to the wire".
async function uServe(realUrl, fallbackCt) {
  const u = await uGet(realUrl);
  if (!u || !u.kappa) return null;
  const bytes = await kGet(u.kappa);
  if (!bytes || !verifyKappa(u.kappa, bytes)) return null;   // absent or forged → the wire decides
  return { kappa: u.kappa, bytes, contentType: u.contentType || fallbackCt };
}

// ── egress ladder — WHO answers the web?url= contract is a deployment detail (the SEC-7
// endgame is a content-blind P2P exit-peer; these are the roads that exist today):
//   1 · the local /web route (dev server / desktop host): cookies, POST, headless-Chrome docs.
//       Authoritative IFF the answer carries x-holo-web:1 — a static host (GitHub Pages) answers
//       this path with its own 404 page, which must never be mistaken for the upstream.
//   2 · a straight CORS fetch — CORS-open origins (CDNs, APIs, IPFS gateways) need no middleman.
//   3 · public CORS relays — untrusted TRANSPORT for the serverless mount; L5 mints over the
//       bytes that arrive and the seal is labeled "relay", honest and visible.
// Every tier's product is minted + re-derived identically; only who carried the bytes differs. ──
let PROXY_DOWN_UNTIL = 0;                            // a dead tier-1 is remembered for 60s, then re-probed
let PROXY_SEEN_ALIVE = false;                        // has a real /web proxy (headless Chrome, renders google) answered THIS session?
const RELAYS = [
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
];
// ── tier 1.5: your own device as the exit peer. A running Hologram host (desktop / dev serve)
// answers the SAME web?url= contract on loopback — a trustworthy context even from an https
// static origin, CORS-open + marker-stamped, and the bytes never touch a third party: the
// first SEC-7 exit peer is the user's own machine. Probed lazily (only once the local proxy
// is known dead), remembered 5 min. Doc/operator ride the QUERY (headers would preflight).
const HOST_PORTS = [8474, 8472, 8493, 8596];
let HOSTS = null, HOSTS_AT = 0;
// ── tier 1.6: your device MESH — a Hologram host on ANOTHER device (your desktop at home) answers
// the same web?url= contract over an authenticated holo-together-rtc data channel (holo-peer-egress).
// RTC lives in the PAGE, so the SW proxies each peer fetch to a controlled client and awaits the
// framed reply. PEER_READY is posted by the page once its link is up (mirrors setop/setext). This is
// the cross-network SEC-7 exit peer: on cellular, your phone still exits through your own machine. ──
let PEER_READY = false, PEER_ONLY = false;   // PEER_ONLY: exit ONLY through your own device mesh (privacy max; no relay ever)
const peerPending = new Map();
function peerFetchViaPage(url, opts) {
  return new Promise((resolve, reject) => {
    const id = "pf" + Math.random().toString(36).slice(2, 10);
    const timer = setTimeout(() => { peerPending.delete(id); reject(new Error("peer page timeout")); }, 15000);
    peerPending.set(id, { resolve, reject, timer });
    broadcast({ type: "peer-fetch", id, url, doc: !!opts.doc, op: opts.op || "" });
  });
}
async function probeHosts() {
  if (HOSTS && Date.now() - HOSTS_AT < 300_000) return HOSTS;
  HOSTS_AT = Date.now();
  const found = [];
  await Promise.all(HOST_PORTS.map(async (p) => {
    try {
      const r = await fetch("http://127.0.0.1:" + p + "/apps/browser/web?url=" + encodeURIComponent("data:probe"), { signal: AbortSignal.timeout(900) });
      if (r.headers.get("x-holo-web")) found.push("http://127.0.0.1:" + p + "/apps/browser/web?url=");
    } catch {}
  }));
  return (HOSTS = found);
}
// ── onion tier — a .onion resolves through NO clearnet carrier: not a browser fetch (can't resolve it),
// not a CORS relay, not the /web proxy. It rides only carriers that speak Tor: your device MESH (a desktop
// running Hologram + Arti — the private flagship, bytes touch no third party) and a same-machine loopback
// host that mounts /onion. No public gateway (the reliable ones are gone, and a gateway would see your
// traffic). PEER_ONLY ⇒ mesh only. The lone-device zero-setup path is arti-wasm (in-tab Tor) — a future rung.
// The SW's existing <base>+rewrite handles the whole onion resource graph for free: every css/img/link is a
// .onion subresource → routed right back through here. One contract, one more transport.
function isOnionUrl(u) { try { return /\.onion$/i.test(new URL(u).hostname); } catch { return false; } }
let ONION_HOSTS = null, ONION_AT = 0;
async function probeOnionHosts() {
  if (ONION_HOSTS && Date.now() - ONION_AT < 300_000) return ONION_HOSTS;
  ONION_AT = Date.now(); const found = [];
  await Promise.all(HOST_PORTS.map(async (p) => {
    try { const r = await fetch("http://127.0.0.1:" + p + "/apps/browser/onion?url=" + encodeURIComponent("data:probe"), { signal: AbortSignal.timeout(900) });
      if (r.headers.get("x-holo-onion")) found.push("http://127.0.0.1:" + p + "/apps/browser/onion?url="); } catch {}
  }));
  return (ONION_HOSTS = found);
}
async function egressOnion(realUrl, init) {
  const isDoc = !!(init && init.headers && init.headers["x-holo-doc"] === "1");
  const op = (init && init.headers && init.headers["x-holo-operator"]) || "";
  const dinit = { ...init }; if (dinit.headers) { const h = { ...dinit.headers }; delete h["x-holo-doc"]; delete h["x-holo-operator"]; delete h["x-holo-ua"]; delete h["x-holo-referer"]; delete h["x-holo-xff"]; dinit.headers = h; }
  const tiers = [];
  if (PEER_READY) tiers.push(["host-peer", () => peerFetchViaPage(realUrl, { doc: isDoc, op })]);   // your device mesh — private
  if (!PEER_ONLY) {
    const hostQ = encodeURIComponent(realUrl) + (isDoc ? "&doc=1" : "") + (op ? "&op=" + encodeURIComponent(op) : "");
    for (const h of await probeOnionHosts()) tiers.push(["onion-host", () => fetch(h + hostQ, dinit)]);
  }
  let upstream = null;
  for (const [via, go] of tiers) {
    let r; try { r = await go(); } catch { continue; }
    const routed = r.headers.get("x-holo-onion") === "routed";
    if (!routed) continue;                              // a carrier that didn't actually reach Tor — fall past
    if (r.ok) return { r, via };
    if (!upstream) upstream = { r, via };
  }
  return upstream || { r: null, via: "none" };
}
async function egressFetch(realUrl, init) {
  if (isOnionUrl(realUrl)) return egressOnion(realUrl, init);   // onion never touches the clearnet ladder
  const tiers = [];
  const isDoc = !!(init && init.headers && init.headers["x-holo-doc"] === "1");
  const op = (init && init.headers && init.headers["x-holo-operator"]) || "";
  // PEER_ONLY (privacy max): your own device mesh is the ONLY carrier — no proxy, no direct, no relay ever.
  if (PEER_ONLY) {
    if (PEER_READY) tiers.push(["host-peer", () => peerFetchViaPage(realUrl, { doc: isDoc, op })]);
    let up = null;
    for (const [via, go] of tiers) { let r; try { r = await go(); } catch { continue; } if (via === "host-peer" && !r.headers.get("x-holo-web")) continue; if (r.ok) return { r, via }; if (!up) up = { r, via }; }
    return up || { r: null, via: "none" };
  }
  // Every wire tier is TIME-BOXED: one slow carrier can never hang the navigation — it aborts and
  // falls through to the next tier (and finally the honest interstitial) fast. Bounded, low latency.
  const tfetch = (url, i, ms) => fetch(url, { ...i, signal: AbortSignal.timeout(ms) });
  if (Date.now() >= PROXY_DOWN_UNTIL) tiers.push(["proxy", () => tfetch(WEB_PROXY + encodeURIComponent(realUrl), init, 3500)]);
  // seam-private headers would force a CORS preflight neither a host nor a third party answers — strip beyond tier 1
  const dinit = { ...init };
  if (dinit.headers) { const h = { ...dinit.headers }; delete h["x-holo-doc"]; delete h["x-holo-operator"]; delete h["x-holo-ua"]; delete h["x-holo-referer"]; delete h["x-holo-xff"]; dinit.headers = h; }
  if (Date.now() < PROXY_DOWN_UNTIL) {
    const hostQ = encodeURIComponent(realUrl) + (isDoc ? "&doc=1" : "") + (op ? "&op=" + encodeURIComponent(op) : "");
    for (const h of await probeHosts()) tiers.push(["host", () => tfetch(h + hostQ, dinit, 4000)]);
    // your device-mesh peer (another of YOUR machines) — above direct/relay, below same-LAN loopback
    if (PEER_READY) tiers.push(["host-peer", () => peerFetchViaPage(realUrl, { doc: isDoc, op })]);
  }
  tiers.push(["direct", () => tfetch(realUrl, dinit, 6000)]);
  // RELAYS RACED IN PARALLEL — the fastest CORS relay to answer OK wins (not slowest-sequential-sum).
  // The whole relay tier is bounded to the per-relay timeout; if all fail it throws → honest interstitial.
  tiers.push(["relay", () => Promise.any(RELAYS.map((relay) => tfetch(relay(realUrl), dinit, 8000).then((r) => { if (!r.ok) throw 0; return r; })))]);
  let upstream = null;                               // the best non-ok answer seen, reported honestly if no tier lands
  for (const [via, go] of tiers) {
    let r; try { r = await go(); } catch { if (via === "proxy") PROXY_DOWN_UNTIL = Date.now() + 60_000; continue; }
    if (via === "proxy" && !r.headers.get("x-holo-web")) { PROXY_DOWN_UNTIL = Date.now() + 60_000; continue; }   // a static host's 404, not the proxy
    if (via === "proxy" && r.headers.get("x-holo-web")) PROXY_SEEN_ALIVE = true;   // a real /web (renders google natively) is present this session
    if (via === "host" && !r.headers.get("x-holo-web")) continue;   // some other localhost server — never trust it as a Hologram host
    if (via === "host-peer" && !r.headers.get("x-holo-web")) continue;   // the peer must have carried a real /web answer (its forwarded marker), else fall past
    if (r.ok) return { r, via };
    if (via === "proxy") return { r, via };          // the proxy relays the upstream's real status — authoritative
    if (!upstream) upstream = { r, via };
  }
  return upstream || { r: null, via: "none" };
}

// tell the page what committed (κ, mint/verify state) so the omnibox HUD reflects the load.
async function broadcast(msg) { for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(msg); }

// ── LADDER rung 2 — the crawler-captured copy. When a page's own bytes don't carry the article
// (rung 1 couldn't recover a body), the archive already fetched it AS a crawler and CORS-serves it
// through our relay tier. Wayback needs its availability API resolved to a snapshot first; `id_`
// gives the RAW original (no Wayback toolbar/URL-rewriting) so our own rewrite handles it cleanly.
// Returns { text, via } of the first source that yields real HTML, or null. No new egress carriers. ──
// a challenge/CAPTCHA/error shell is NOT the article — archive.today walls automated fetches this way.
const ARCHIVE_JUNK = /one more step|security check|complete the (?:captcha|security)|cf-browser-verification|attention required|checking your browser|enable javascript and cookies|request could not be satisfied|\berror 40\d\b|too many requests/i;
async function ladderArchive(realUrl) {
  // Archive hosts are CORS-open (ACAO:*) so a DIRECT fetch works from the browser and skips the
  // relay's short budget — archived docs are large, so give them a generous timeout; relay is a backstop.
  const tfetch = (u, ms) => fetch(u, { redirect: "follow", signal: AbortSignal.timeout(ms) });
  const getArchive = async (u, ms) => {
    try { const r = await tfetch(u, ms); if (r.ok) return r; } catch {}
    for (const relay of RELAYS) { try { const r = await tfetch(relay(u), ms); if (r.ok) return r; } catch {} }
    return null;
  };
  for (const src of archiveSources(realUrl)) {
    try {
      let snap = src.url;
      if (src.via === "wayback") {
        const r = await getArchive(src.api, 12000);
        if (!r) continue;
        const j = await r.json().catch(() => null);
        const closest = j && j.archived_snapshots && j.archived_snapshots.closest;
        if (!closest || !closest.available || !closest.url) continue;
        snap = closest.url.replace(/^http:/, "https:").replace(/\/web\/(\d+)\//, "/web/$1id_/");   // raw original
      }
      const r = await getArchive(snap, 22000);
      if (!r) continue;
      const text = await r.text();
      if (text && text.length > 2000 && /<html|<article|<body/i.test(text) && !ARCHIVE_JUNK.test(text.slice(0, 3500))) return { text, via: "archive:" + src.via };
    } catch {}
  }
  return null;
}

// ── HTML rewrite — the renderer's two seams ─────────────────────────────────────────
// 1) inject <base href=realUrl> so RELATIVE SUBRESOURCES (css/js/img/font) resolve to their
//    real absolute URLs; the SW intercepts those (a controlled client's subresource requests
//    fire the fetch event for ANY origin) and mints each.
// 2) rewrite NAVIGATIONS (<a href>, GET <form action>) to in-scope self-origin /webview/w/…
//    URLs. A service worker only intercepts navigations to IN-SCOPE targets, so a link to the
//    real cross-origin URL would escape (ERR_NAME_NOT_RESOLVED); routing clicks back through
//    the scope keeps every page content-addressed. (JS-driven navigation is a known caveat.)
// We do NOT neutralize scripts — the iframe is sandboxed by the page; this is a browser.
// ── onion same-origin wrapping — a browser BLOCKS a .onion URL at the network layer (RFC 7686), before the
// SW can intercept it. So for an onion page we must never EMIT a .onion URL: every subresource + the url()s
// inside its CSS are rewritten to a same-origin /webview/sub/<enc> wrapper the SW serves through the Tor
// bridge. The browser only ever sees 127.0.0.1 / the deployed origin → CSS, fonts, images all load, and it
// works in ANY browser (Brave, Chrome, mobile) with no Tor mode. Navigations still use the w/ wrapper. ──
const onionSubWrap = (u, realUrl) => { try { const abs = new URL(u, realUrl).href; return isOnionUrl(abs) ? self.location.origin + VIEW + "sub/" + enc(abs) : abs; } catch { return u; } };
const rewriteOnionCss = (css, realUrl) => String(css)
  .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => /^(data:|blob:|#)/i.test(u.trim()) ? m : `url(${q}${onionSubWrap(u, realUrl)}${q})`)
  .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import ${q}${onionSubWrap(u, realUrl)}${q}`);
function rewriteHtml(text, realUrl, kappa) {
  const SELF = self.location.origin;
  const onion = isOnionUrl(realUrl);
  const wrap = (href) => { try { const abs = new URL(href, realUrl).href; return /^https?:/i.test(abs) ? SELF + VIEW + "w/" + enc(abs) : href; } catch { return href; } };
  if (onion) text = text.replace(/<base\b[^>]*>/gi, "");   // a surviving <base> would send the browser off to a blocked .onion
  // <a ... href="X"> → in-scope wrapper (skip in-page anchors + non-navigational schemes)
  text = text.replace(/(<a\b[^>]*?\shref\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, href) => (/^(#|javascript:|mailto:|tel:|data:|blob:)/i.test(href.trim()) ? m : pre + q + wrap(href) + q));
  text = text.replace(/(<form\b[^>]*?\saction\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, act) => pre + q + wrap(act) + q);
  if (onion) {
    const sub = (u) => onionSubWrap(u, realUrl);
    text = text.replace(/(<(?:link|script|img|source|track|input|embed)\b[^>]*?\s(?:src|href)\s*=\s*)(["'])(.*?)\2/gi,
      (m, pre, q, u) => /^(#|javascript:|mailto:|tel:|data:|blob:)/i.test(u.trim()) ? m : pre + q + sub(u) + q);
    text = text.replace(/(\ssrcset\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, val) =>
      pre + q + val.split(",").map((p) => { const s = p.trim(); if (!s) return p; const sp = s.indexOf(" "); const uu = sp < 0 ? s : s.slice(0, sp); const d = sp < 0 ? "" : s.slice(sp); return sub(uu) + d; }).join(", ") + q);
    text = text.replace(/(\sposter\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, u) => pre + q + sub(u) + q);
    text = text.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, a, b) => `<style${a}>${rewriteOnionCss(b, realUrl)}</style>`);
    text = text.replace(/(\sstyle\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, v) => pre + q + rewriteOnionCss(v, realUrl) + q);
  }
  const inj = injectContentScripts(realUrl);          // matching MV3 content scripts (DNR's sibling)
  const stamp = (onion ? "" : `<base href="${realUrl.replace(/"/g, "&quot;")}">`)   // onion: every subresource is already an absolute same-origin sub/ wrapper
    + `<meta name="holo-source" content="${realUrl.replace(/"/g, "&quot;")}">`
    + `<meta name="holo-kappa" content="${kappa}">`
    + inj.head;                                        // document_start scripts + content-script css
  const tail = (inj.tail || "") + GUARD_TAG;           // the page-world guard rides every live page
  text = /<\/body>/i.test(text) ? text.replace(/<\/body>/i, tail + "</body>") : text + tail;
  if (/<head[^>]*>/i.test(text)) return text.replace(/<head[^>]*>/i, (h) => h + stamp);
  if (/<html[^>]*>/i.test(text)) return text.replace(/<html[^>]*>/i, (h) => h + "<head>" + stamp + "</head>");
  return stamp + text;
}

// ── page-world guard, injected into every rewritten live-web document ────────────────
// (a) navigation keeper: a form action or <a href> that page JS (re)writes AFTER the static
//     rewrite above would navigate the sandboxed iframe straight to the cross-origin site,
//     where X-Frame-Options kills the render. Re-wrap at use time (submit/click, capture
//     phase) so those navigations re-enter the κ seam too.
// (b) cookie-consent auto-reject: the /web proxy is a stateless dumb pipe (no cookies either
//     way), so consent walls would re-appear on EVERY page. Hide the known CMP shells and
//     click one explicit "reject"-style control (only inside consent-scented containers).
// Injected as (fn)(VIEW) via toString() — page world, fail-open, self-disarms after 20s.
function pageGuard(VIEW) {
  try {
    var enc = function (s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
    var wrap = function (h) { try { if (!h) return null; var a = new URL(h, document.baseURI); if ((a.protocol === "http:" || a.protocol === "https:") && a.origin !== location.origin) return location.origin + VIEW + "w/" + enc(a.href); } catch (e) {} return null; };
    addEventListener("submit", function (e) { try { var f = e.target; if (!f || !f.getAttribute) return; var w = wrap(f.getAttribute("action") || ""); if (w) f.setAttribute("action", w); } catch (_) {} }, true);
    addEventListener("click", function (e) { try { var a = e.target && e.target.closest ? e.target.closest("a[href]") : null; if (!a) return; var w = wrap(a.getAttribute("href") || ""); if (w) a.setAttribute("href", w); } catch (_) {} }, true);
    // consent auto-reject — cosmetic hide for the big CMPs, then one reject click, then stand down.
    var st = document.createElement("style");
    st.textContent = "#onetrust-consent-sdk,#onetrust-banner-sdk,#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay,.qc-cmp2-container,.fc-consent-root,#didomi-host,.didomi-popup-backdrop,[id^=sp_message_container],#cmpbox,#cmpbox2,#usercentrics-root,.truste_box_overlay,.truste_overlay,.cc-window.cc-banner{display:none !important}";
    (document.head || document.documentElement).appendChild(st);
    var RX = /^(reject all|reject|decline( all)?|refuse( all)?|deny( all)?|disagree|only (necessary|essential|required)( cookies)?|(use|accept) (only )?(necessary|essential|required)( cookies)?|necessary (cookies )?only|continue without (accepting|agreeing|consent)|alle ablehnen|ablehnen|tout refuser|rechazar todo|rifiuta tutti|отклонить все|alles afwijzen|weigeren)$/i;
    var SEL = "#onetrust-reject-all-handler,.ot-pc-refuse-all-handler,#CybotCookiebotDialogBodyButtonDecline,.cc-deny";
    var scented = function (el) { var n = el, d = 0; while (n && n.getAttribute && d++ < 8) { var s = ((n.id || "") + " " + (n.getAttribute("class") || "") + " " + (n.getAttribute("aria-label") || "")).toLowerCase(); if (/cookie|consent|gdpr|privacy|\bcmp\b|onetrust|didomi|cookiebot|usercentrics|truste|sp_message/.test(s)) return true; n = n.parentElement; } return false; };
    var done = false;
    var tryReject = function (root) {
      if (done) return;
      var b = null; try { b = root.querySelector(SEL); } catch (_) {}
      if (!b) {
        // an unambiguous "reject all"-class phrase needs no consent-scented ancestor (Google's
        // consent interstitial carries no tell-tale ids); weaker words (decline, deny) do.
        var STRONG = /^(reject all|refuse all|deny all|decline all|alle ablehnen|tout refuser|rechazar todo|rifiuta tutti|отклонить все|alles afwijzen)$/i;
        var cs = root.querySelectorAll("button,[role=button],input[type=submit],input[type=button],a");
        for (var i = 0; i < cs.length && i < 500; i++) {
          var t = (cs[i].innerText || cs[i].value || cs[i].getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
          if (t && t.length < 60 && (STRONG.test(t) || (RX.test(t) && scented(cs[i])))) { b = cs[i]; break; }
        }
      }
      if (b) { done = true; try { b.click(); } catch (_) {} }
    };
    var pass = function () { tryReject(document); var fs = document.querySelectorAll("iframe"); for (var i = 0; i < fs.length; i++) { try { if (fs[i].contentDocument) tryReject(fs[i].contentDocument); } catch (_) {} } };
    if (document.readyState !== "loading") pass(); else addEventListener("DOMContentLoaded", pass);
    var last = 0;
    var mo = new MutationObserver(function () { var n = Date.now(); if (done || n - last < 300) return; last = n; pass(); });
    try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (_) {}
    setTimeout(function () { try { mo.disconnect(); } catch (_) {} }, 20000);
  } catch (e) {}
}
const GUARD_TAG = `<script data-holo="guard">(${pageGuard.toString()})(${JSON.stringify(VIEW)})</script>`;

// ── content_scripts — inline the enabled scripts that match this page (run_at honoured) ──────────
// document_start → injected at <head> open; document_end/idle → before </body>. A minimal page-world
// chrome.* shim (holo-ext) is prepended so a content script finds chrome.storage/runtime. HONEST
// subset: page world, NOT an isolated world; the hard APIs are native-only (analyzeManifest flags
// them). The native CEF build runs these in a real isolated world via the extension subsystem.
// The rendering logic lives in holo-ext.contentScriptTags() (shared + witnessed), not duplicated here.
const injectContentScripts = (realUrl) => contentScriptTags(EXT.contentScripts, realUrl);
// splice an { head, tail } injection into an HTML string (head at <head> open, tail before </body>).
function injectIntoHtml(text, inj) {
  if (inj.tail) text = /<\/body>/i.test(text) ? text.replace(/<\/body>/i, inj.tail + "</body>") : text + inj.tail;
  if (!inj.head) return text;
  if (/<head[^>]*>/i.test(text)) return text.replace(/<head[^>]*>/i, (h) => h + inj.head);
  if (/<html[^>]*>/i.test(text)) return text.replace(/<html[^>]*>/i, (h) => h + "<head>" + inj.head + "</head>");
  return inj.head + text;
}
// a blocked main_frame (DNR matched the navigation itself) → an honest interstitial, not a dead tab.
function blockedPage(realUrl, act) {
  const safe = String(realUrl).replace(/[<&"]/g, (c) => ({ "<": "&lt;", "&": "&amp;", '"': "&quot;" }[c]));
  const html = `<!doctype html><meta charset=utf-8><title>Blocked by extension</title><style>body{font:15px/1.6 system-ui;background:#0a0e14;color:#e8eef5;margin:0;display:grid;place-items:center;height:100vh}.b{max-width:520px;padding:2rem;text-align:center}h1{color:#ea4335;font-size:1.2rem}code{background:#11151c;padding:.15rem .4rem;border-radius:6px;color:#fbbc04;word-break:break-all}</style><div class=b><h1>Blocked by a κ-verified extension</h1><p>A declarativeNetRequest rule (extension <code>${act.extId || "?"}</code>, rule ${act.ruleId ?? "?"}) blocked this request.</p><p><code>${safe}</code></p></div>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-holo-blocked": String(act.extId || "1"), ...COEPH } });
}

// holo-serve makes the page cross-origin-isolated (COOP same-origin + COEP credentialless), so
// every document/subresource the renderer iframe loads must carry compatible COEP/CORP or it is
// blocked (chrome-error). The SW serves same-origin from the κ-store, so it stamps them itself.
const COEPH = { "cross-origin-embedder-policy": "credentialless", "cross-origin-opener-policy": "same-origin", "cross-origin-resource-policy": "cross-origin" };
const refused = (why) => new Response("Holo Browser refused this resource (Law L5):\n" + why, { status: 502, headers: { "content-type": "text/plain", ...COEPH } });
const KHDR = (kappa, ct, extra = {}) => ({ "content-type": ct, "x-holo-cid": kappa, "x-holo-verified": "L5", "cache-control": "no-store", ...COEPH, ...extra });

// ── S1 — NO DEAD PAGES. On the serverless mount the only carrier is often a public relay, and some
// origins (Google chief among them) answer it with EMPTY bytes or a JS-wall shell. Never mint that into
// a blank white frame: give the user a REAL destination instead.
// (a) Google is a search engine → route ANY google page to HOLO SEARCH: the browser's OWN engine, a
//     SAME-ORIGIN page that always paints (your κ-graph + the app universe + a web-escape) and never
//     rides a public relay that might be down. The user asked to search; they get a real search box +
//     results instantly, on-device, not a third-party HTML page a relay can fail to deliver.
function holoSearchURL(q) { return APP_BASE + "holo-search.html?q=" + encodeURIComponent(q || ""); }
function googleAlt(realUrl) {
  try {
    const gu = new URL(realUrl);
    if (!/(^|\.)google\.[a-z.]{2,6}$/.test(gu.hostname)) return null;
    if (gu.pathname === "/search" || gu.pathname === "/") return holoSearchURL(gu.searchParams.get("q") || "");
  } catch {}
  return null;
}
const inScope = (u) => new URL(VIEW + "w/" + enc(u), self.location.origin).href;
// Holo Search / other same-origin app pages are served DIRECTLY (they are ours) — never wrapped into
// /webview/w/ (which would send them back through the egress ladder as if they were external sites).
const appAbs = (p) => new URL(p, self.location.origin).href;
// a document response is a DEAD PAINT if it has (almost) no bytes or is a proof-of-JS wall with no content.
function emptyOrWalled(bytes, text) {
  if (!bytes || bytes.length < 256) return true;
  if (text == null) return false;
  const head = text.slice(0, 4000);
  if (/id="?recaptcha|our systems have detected unusual traffic|enablejs|please click here if you are not redirected/i.test(head)) return true;
  // a shell with no visible body text (scripts only) — strip tags on the first 20k, see if anything remains
  if (bytes.length < 60000 && text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, "").length < 24) return true;
  return false;
}
// (b) any other page that yields a dead paint → an HONEST, useful interstitial (not a blank frame):
// the URL, the tier that tried, and one-tap actions (retry · search this · carry via your device).
// The interstitial must name the FIX, not just the problem: when no device-mesh peer is armed, its
// primary escape is "Use my own device", which messages the browser page (same-origin parent) to
// open the pairing flow. It also broadcasts dead-paint so the page can nudge once per session.
function interstitialPage(realUrl, info = {}) {
  broadcast({ type: "dead-paint", url: realUrl, via: info.via || "none", peer: PEER_READY });   // fire-and-forget — the page decides whether to nudge
  const safe = String(realUrl).replace(/[<&"]/g, (c) => ({ "<": "&lt;", "&": "&amp;", '"': "&quot;" }[c]));
  // "Search this instead" → HOLO SEARCH (same-origin, always paints; it carries its OWN web-escape).
  // Never a third-party HTML page here: a relay that just failed this URL would fail that one too.
  const searchHref = appAbs(holoSearchURL(realUrl.replace(/^https?:\/\//, "")));
  const via = info.via ? String(info.via).replace(/[<&"]/g, "") : "the network";
  // an armed peer that STILL dead-painted is a different story than an unpaired mount — say the true one.
  const fix = PEER_READY
    ? `<p>Your device mesh is connected, but this site still answered empty — it may be down or refusing automated fetches.</p>`
    : `<p>Your own computer can carry this request instead — pair a Hologram host once and pages load through <b>your</b> device, not a public relay.</p>`;
  const peerBtn = PEER_READY ? "" : `<a class="btn p" id=peer href="#">Use my own device</a>`;
  const html = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${safe}</title><style>:root{color-scheme:dark}body{font:15px/1.6 system-ui;background:#0b141a;color:#e8eef5;margin:0;min-height:100vh;display:grid;place-items:center}.c{max-width:560px;padding:2.2rem;text-align:center}h1{font-size:1.1rem;font-weight:600;margin:.2rem 0 .5rem}p{opacity:.75;margin:.5rem 0}code{background:#11151c;padding:.15rem .45rem;border-radius:6px;color:#9db7ff;word-break:break-all}.row{display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap;margin-top:1.3rem}a.btn{display:inline-block;padding:.6rem 1.1rem;border-radius:10px;background:#1b2330;color:#e8eef5;text-decoration:none;border:1px solid #2a3546;font-weight:500}a.btn.p{background:linear-gradient(135deg,#7b68ee,#3b6ee0);border:none}.k{opacity:.4;font-size:.82rem;margin-top:1.4rem}</style>
<div class=c><div style="font-size:2rem">🌐</div><h1>This page didn't send anything to show</h1>
<p>Hologram reached it through <b>${via}</b>, but the site returned an empty or script-walled response — common on the serverless web without your own device carrying the request.</p>
${fix}<p><code>${safe}</code></p>
<div class=row>${peerBtn}<a class="btn${PEER_READY ? " p" : ""}" href="${inScope(realUrl)}">Retry</a><a class=btn href="${searchHref}">Search this instead</a></div>
<p class=k>Content-addressed · verified before paint · nothing left your device but the request.</p></div>
<script>var b=document.getElementById('peer');if(b)b.onclick=function(e){e.preventDefault();parent.postMessage({type:'holo-peer-setup',url:document.querySelector('code').textContent},'*')}</script>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-holo-egress": info.via || "none", "x-holo-interstitial": "1", ...COEPH } });
}

// ── serve a holo://<κ> document from the κ-store, re-derived (Law L5) ────────────────
async function serveKappa(kappa, path) {
  const bytes = await kGet(kappa);
  if (!bytes) { await broadcast({ type: "committed", view: VIEW + "h/" + kappa, kappa, verified: false, refused: true, scheme: "holo" }); return refused("κ not in the store (open it from a source that owns the bytes): " + kappa); }
  if (!verifyKappa(kappa, bytes)) { await broadcast({ type: "committed", view: VIEW + "h/" + kappa, kappa, verified: false, refused: true, scheme: "holo" }); return refused("κ re-derivation failed — forged byte: " + kappa); }
  const ct = mimeByExt(path || "") || "text/html; charset=utf-8";
  // The κ verifies the SOURCE (re-derivation above, Law L5). A content-script extension may then
  // transform the rendered VIEW — a labeled, opt-in change, NOT a change to what re-derives: the
  // served κ (x-holo-cid) is still the original source. Only HTML, only if a matching script exists.
  let body = bytes, transformed = null;
  if (/text\/html/i.test(ct)) {
    const inj = injectContentScripts("holo://" + kappa);
    if (inj.head || inj.tail) {
      body = new TextEncoder().encode(injectIntoHtml(new TextDecoder().decode(bytes), inj));
      transformed = [...new Set([...(inj.head + inj.tail).matchAll(/data-holo-ext="([^"]+)"/g)].map((m) => m[1]))];   // the extensions that actually injected
    }
  }
  await broadcast({ type: "committed", view: VIEW + "h/" + kappa, kappa, minted: false, verified: true, scheme: "holo", contentType: ct, transformed });
  return new Response(body, { status: 200, headers: KHDR(kappa, ct, transformed ? { "x-holo-view-transform": "content-scripts" } : {}) });
}

// pass a non-GET (a rewritten <form method=post> — consent saves, searches) through with its
// body; the /web proxy forwards POST upstream. GET/HEAD stay plain proxy fetches.
// isDoc tags the MAIN-FRAME navigation with x-holo-doc so the egress renders it in a real Chrome.
// x-holo-operator rides EVERY request (doc AND subresource): the top document runs as the operator,
// and the route also fetches that page's SAME-ORIGIN subresources/XHR through the operator's Chrome
// so an authenticated page renders its logged-in content (its data XHRs would otherwise 401). The
// route decides which subresources are authenticated (same origin as a page the operator rendered);
// public cross-origin assets fall to the cheap byte pipe. (The ladder strips these headers beyond
// tier 1 — they'd force a CORS preflight — and re-encodes doc/op in the host-tier query instead.)
// The signed-in operator κ (page posts it via {type:"setop"}); keys the per-identity egress Chrome.
// A SW is TERMINATED and restarted by the browser at will, which would zero an in-memory var and
// silently log the operator out until the page next re-pushes — so it is MIRRORED into the Cache
// and re-read on demand. The page relay is the source of truth; the cache is the crash-survivor.
let EGRESS_OPERATOR = "";
const OPSTORE = "holo-browser-op-v1";
async function persistOp(op) { try { const c = await caches.open(OPSTORE); await c.put("/op", new Response(op || "")); } catch {} }
async function loadOp() { if (EGRESS_OPERATOR) return EGRESS_OPERATOR; try { const c = await caches.open(OPSTORE); const r = await c.match("/op"); if (r) EGRESS_OPERATOR = (await r.text()) || ""; } catch {} return EGRESS_OPERATOR; }
async function proxyInit(req, isDoc, realUrl) {
  const init = { redirect: "follow" };
  const headers = {};
  const op = await loadOp();
  if (op) headers["x-holo-operator"] = op;
  if (isDoc) headers["x-holo-doc"] = "1";
  // LADDER rung 3 — Googlebot UA + Referer for a HEADER-HONORING egress (paired /web Chrome or mesh
  // peer). Namespaced x-holo-* so the ladder strips them beyond tier 1 (they'd force a CORS preflight
  // no relay answers); the host maps them onto the real request. Dropped entirely on a bare mount.
  if (isDoc && realUrl && (await loadLadder()) !== "off") { const lh = ladderHeaders(realUrl); for (const k in lh) headers[k] = lh[k]; }
  if (req && req.method && req.method !== "GET" && req.method !== "HEAD") {
    init.method = req.method;
    try { init.body = await req.arrayBuffer(); } catch {}
    const ct = req.headers && req.headers.get("content-type"); if (ct) headers["content-type"] = ct;
  }
  if (Object.keys(headers).length) init.headers = headers;
  return init;
}

// ── κ-verified stale-while-revalidate for documents (the S2 line: a repeat visit paints from
// the store INSTANTLY — L3 — and the wire runs in the background so the NEXT visit paints fresh).
// Window-bounded: beyond SWR_TTL_MS the wire leads again (a day-old front page must not paint
// stale-first). Dead paints (empty/JS-walled shells) never enter the url→κ memory at all. ──────
const SWR_TTL_MS = 10 * 60_000;
async function revalidate(realUrl, req) {
  const { r } = await egressFetch(realUrl, await proxyInit(req, true, realUrl));
  if (!r || !r.ok || r.status !== 200) return;
  const bytes = new Uint8Array(await r.arrayBuffer());
  const ctype = typeForUrl(realUrl, r.headers.get("content-type")) || "text/html; charset=utf-8";
  if (/text\/html/i.test(ctype) && emptyOrWalled(bytes, new TextDecoder().decode(bytes))) return;   // never remember a dead paint
  const kappa = kappaOf(bytes);
  await kPut(kappa, bytes, { contentType: ctype, source: realUrl });
  await uPut(realUrl, { kappa, contentType: ctype, ts: Date.now() });
}

// ── LADDER orchestration — mode → detect → rung 1 (in-place unlock) → rung 2 (archive, only if the
// body couldn't be recovered locally). Returns the served view text + how it got there. `remint`
// means rung 2 replaced the whole document (archive bytes), so the SW re-mints κ over the new bytes
// (they must re-derive); an in-place unlock is a labeled VIEW transform of the same source κ, exactly
// like rewriteHtml + content-scripts. Off ⇒ passthrough. Auto ⇒ only when a wall is detected. ──
async function applyLadder(text, realUrl) {
  const mode = await loadLadder();
  if (mode === "off") return { text, via: "", remint: false, locked: false };
  const det = detectPaywall(text, realUrl);
  if (!det.locked && mode !== "on") return { text, via: "", remint: false, locked: false };
  const u = ladderUnlock(text, realUrl, { det, force: mode === "on" });
  let outText = u.html, via = u.applied.join("+"), remint = false;
  if (u.locked && !u.recovered) {                        // rung 1 left it walled → climb to the crawler copy
    const arch = await ladderArchive(realUrl);
    if (arch) { const u2 = ladderUnlock(arch.text, realUrl, { force: true }); outText = u2.html; via = arch.via + "+" + u2.applied.join("+"); remint = true; }
  }
  return { text: outText, via, remint, locked: u.locked, recovered: u.recovered || remint, why: det.why };
}

// rung-1-only unlock (no wire, no re-mint) — for cached/stale repaints where an archive hop would
// defeat the point of the instant path. A walled page IS stored (it is not empty), so repeats need it.
async function ladderView(text, realUrl) {
  const mode = await loadLadder(); if (mode === "off") return text;
  const det = detectPaywall(text, realUrl); if (!det.locked && mode !== "on") return text;
  return ladderUnlock(text, realUrl, { det, force: mode === "on" }).html;
}

// ── LADDER rung-2 as a DEAD-END rescue — the serverless killer case: a public relay is BLOCKED by the
// publisher (datacenter IP) and hands back an empty/JS-walled shell, so there is no in-band text to
// unlock. The crawler already captured the article, and archive.org is relay-friendly. Before we show
// the honest interstitial, try the archived copy; if it yields real HTML, unlock + mint + serve it.
// Returns a Response or null. Only when the ladder is not "off". Bounded by egressFetch's tier timeouts.
async function serveViaArchive(realUrl) {
  if ((await loadLadder()) === "off") return null;
  const arch = await ladderArchive(realUrl);
  if (!arch || !arch.text) return null;
  const u = ladderUnlock(arch.text, realUrl, { force: true });
  const nb = new TextEncoder().encode(u.html);
  const kappa = kappaOf(nb);
  await kPut(kappa, nb, { contentType: "text/html; charset=utf-8", source: realUrl });
  await uPut(realUrl, { kappa, contentType: "text/html; charset=utf-8", ts: Date.now() });
  const via = arch.via + (u.applied && u.applied.length ? "+" + u.applied.join("+") : "");
  const CT = "text/html; charset=utf-8";
  await broadcast({ type: "ladder", view: VIEW + "w/" + enc(realUrl), url: realUrl, via, recovered: true, why: ["empty-shell→archive"] });
  await broadcast({ type: "committed", view: VIEW + "w/" + enc(realUrl), kappa, minted: true, verified: true, egress: via, scheme: new URL(realUrl).protocol.replace(":", ""), contentType: CT, source: realUrl });
  const body = new TextEncoder().encode(rewriteHtml(u.html, realUrl, kappa));
  return new Response(body, { status: 200, headers: KHDR(kappa, CT, { "x-holo-egress": via, "x-holo-ladder": via }) });
}

// ── serve a live http(s) page: κ-store first (SWR window) → proxy → mint κ → cache → re-derive → serve ─
async function serveWeb(realUrl, req, event) {
  // NOTE on Google search: /search is JS-walled (no-JS search was retired). Google first
  // answers with an interstitial whose JS proves execution and re-navigates with a one-shot
  // sg_ss token. That JS RUNS in our renderer, the relative location update stays on the
  // same-origin wrapper URL, and the query-merge in the fetch handler maps it back onto the
  // real URL — so the redemption flows through the seam naturally. Do not strip sg_ss/sei.
  await ensureExt();                                   // hydrate the seam from the store if a restarted SW forgot it
  const act = dnrAction(realUrl, "main_frame");        // an enabled extension may block/redirect the page itself
  if (act.type === "block") { await broadcast({ type: "ext-blocked", url: realUrl, extId: act.extId, ruleId: act.ruleId, resourceType: "main_frame" }); return blockedPage(realUrl, act); }
  if (act.type === "redirect" && act.redirect && act.redirect.url) return Response.redirect(new URL(VIEW + "w/" + enc(act.redirect.url), self.location.origin).href, 302);
  const isGet = !req || !req.method || req.method === "GET" || req.method === "HEAD";
  const isDoc = true;   // serveWeb only handles /w/ navigations — always a top document (subresources go to serveSub)
  // Serverless mount (tier-1 known dead): google /search through a relay answers a resultless
  // JS-wall shell with none of the interstitial tell-tales — route the query straight to
  // DuckDuckGo's html edition. When the local proxy is alive its cookie-jar + headless-Chrome
  // doc rendering keeps google first-class, so this path never fires there.
  // Unless a real /web proxy (headless Chrome, which renders google natively) has answered this session,
  // route ANY google page (home OR /search) straight to a working search: google hands a relay/direct
  // fetch an empty or JS-walled shell that would paint blank. This is the serverless default — the moment
  // a capable proxy is seen, google renders natively instead.
  if (!PROXY_SEEN_ALIVE) {
    const alt = googleAlt(realUrl);
    if (alt) return Response.redirect(appAbs(alt), 302);
  }
  // L3 FIRST for the document too: a repeat GET inside the SWR window paints from the κ-store
  // (re-derived, Law L5) with ZERO wire wait; the egress refetch rides event.waitUntil in the
  // background so the next visit paints the fresh mint. A held dead paint is skipped (wire decides).
  if (isGet) {
    const u = await uGet(realUrl);
    if (u && u.kappa && Date.now() - (u.ts || 0) < SWR_TTL_MS) {
      const bytes = await kGet(u.kappa);
      if (bytes && verifyKappa(u.kappa, bytes)) {
        const ct = u.contentType || "text/html; charset=utf-8";
        const text = /text\/html/i.test(ct) ? new TextDecoder().decode(bytes) : null;
        if (!(text != null && emptyOrWalled(bytes, text))) {
          const body = text != null ? new TextEncoder().encode(rewriteHtml(await ladderView(text, realUrl), realUrl, u.kappa)) : bytes;
          if (event && event.waitUntil) event.waitUntil(revalidate(realUrl, req).catch(() => {}));
          await broadcast({ type: "committed", view: VIEW + "w/" + enc(realUrl), kappa: u.kappa, minted: false, verified: true, egress: "kappa-store", swr: true, scheme: new URL(realUrl).protocol.replace(":", ""), contentType: ct, source: realUrl });
          return new Response(body, { status: 200, headers: KHDR(u.kappa, ct, { "x-holo-egress": "kappa-store", "x-holo-swr": "revalidating" }) });
        }
      }
    }
  }
  const { r, via } = await egressFetch(realUrl, await proxyInit(req, true, realUrl));   // isDoc → egress may render this top document in a real Chrome
  if (!r || !r.ok) {
    // No tier could serve it. Google (home OR /search) → a working search in-seam; never leave the
    // user resultless. googleAlt carries the query if there is one.
    const alt = googleAlt(realUrl);
    if (alt) return Response.redirect(appAbs(alt), 302);
    // L3 fallback: the last-known κ snapshot of this URL — a repeat visit paints with ZERO
    // egress (offline, relay outage, serverless mount with no road out). Re-derived, labeled stale.
    if (isGet) {
      const hit = await uServe(realUrl, "text/html; charset=utf-8");
      if (hit) {
        let body = hit.bytes;
        if (/text\/html/i.test(hit.contentType)) body = new TextEncoder().encode(rewriteHtml(await ladderView(new TextDecoder().decode(hit.bytes), realUrl), realUrl, hit.kappa));
        await broadcast({ type: "committed", view: VIEW + "w/" + enc(realUrl), kappa: hit.kappa, minted: false, verified: true, stale: true, egress: "kappa-store", scheme: new URL(realUrl).protocol.replace(":", ""), contentType: hit.contentType, source: realUrl });
        return new Response(body, { status: 200, headers: KHDR(hit.kappa, hit.contentType, { "x-holo-stale": "1", "x-holo-egress": "kappa-store" }) });
      }
    }
    // LADDER rung-2 rescue: no tier reached it (or relay-blocked) → try the archived copy before giving up.
    if (isDoc) { const a = await serveViaArchive(realUrl); if (a) return a; }
    // S1 — no dead frame: an honest, actionable interstitial instead of blank/plain-text error.
    // (COEPH inside interstitialPage — a doc without CORP is ERR_BLOCKED_BY_RESPONSE, i.e. still blank.)
    if (isDoc) return interstitialPage(realUrl, { via: r ? via : "none" });
    if (!r) return refused("no egress road reached " + realUrl + " (local proxy absent, origin CORS-closed, relays unreachable) and no κ snapshot is held for it");
    return new Response("Holo Browser: upstream " + r.status + " for " + realUrl, { status: r.status === 0 ? 502 : r.status, headers: { "content-type": "text/plain", ...COEPH } });
  }
  let bytes = new Uint8Array(await r.arrayBuffer());
  let kappa = kappaOf(bytes);                                    // the mint IS the re-derivation
  const ctype = typeForUrl(realUrl, r.headers.get("content-type")) || "text/html; charset=utf-8";
  await kPut(kappa, bytes, { contentType: ctype, source: realUrl });
  if (!verifyKappa(kappa, bytes)) return refused("mint re-derivation failed for " + realUrl);
  let body = bytes, ladHdr = {};
  if (/text\/html/i.test(ctype)) {
    const text = new TextDecoder().decode(bytes);
    // S1 — NO DEAD PAINT. A main-frame document that came back empty or as a proof-of-JS wall would
    // mint into a blank white frame. Never serve that: google → a working search; anything else → an
    // honest, actionable interstitial. (Subresources are exempt — an empty script/img is not a dead tab.)
    // NOTE: this check runs BEFORE uPut so a walled shell never becomes the URL's remembered face
    // (the SWR fast path above would otherwise re-paint it on every repeat).
    if (isDoc && emptyOrWalled(bytes, text)) {
      const alt = googleAlt(realUrl);
      if (alt) return Response.redirect(appAbs(alt), 302);
      // relay handed back an empty/JS-walled shell (publisher blocks the relay IP) → the crawler copy
      // is the serverless rescue: try the archive before the interstitial. Only if the ladder is on.
      const a = await serveViaArchive(realUrl); if (a) return a;
      await broadcast({ type: "committed", view: VIEW + "w/" + enc(realUrl), kappa, minted: true, verified: true, egress: via, blank: true, scheme: new URL(realUrl).protocol.replace(":", ""), contentType: ctype, source: realUrl });
      return interstitialPage(realUrl, { via });
    }
    // LADDER — auto-detect a wall and unlock in place (0 egress); climb to the archive only if the
    // body couldn't be recovered locally. rung-1 is a labeled VIEW transform (κ still = source bytes);
    // rung-2 (archive) replaces the document, so re-mint κ over the served bytes → it re-derives (L5).
    const lad = await applyLadder(text, realUrl);
    let docText = lad.text;
    if (lad.remint) { const nb = new TextEncoder().encode(docText); kappa = kappaOf(nb); await kPut(kappa, nb, { contentType: ctype, source: realUrl }); }
    ladHdr = lad.via ? { "x-holo-ladder": lad.via } : {};
    if (lad.via) await broadcast({ type: "ladder", view: VIEW + "w/" + enc(realUrl), url: realUrl, via: lad.via, recovered: !!lad.recovered, why: lad.why || [] });
    body = new TextEncoder().encode(rewriteHtml(docText, realUrl, kappa));
  }
  if (isGet && r.status === 200) await uPut(realUrl, { kappa, contentType: ctype, ts: Date.now() });   // the L3 edge: url → κ (healthy paints only)
  await broadcast({ type: "committed", view: VIEW + "w/" + enc(realUrl), kappa, minted: true, verified: true, egress: via, scheme: new URL(realUrl).protocol.replace(":", ""), contentType: ctype, source: realUrl });
  return new Response(body, { status: 200, headers: KHDR(kappa, ctype, { "x-holo-egress": via, ...ladHdr }) });
}

// ── serve a subresource of a live page: κ-store FIRST (L3), then the egress ladder ────
async function serveSub(realUrl, req) {
  const isGet = !req || !req.method || req.method === "GET" || req.method === "HEAD";
  const isRange = !!(req && req.headers && req.headers.get("range"));   // a partial slice must never become the URL's identity
  // L3: a repeat subresource is a κ-store hit — zero wire bytes, by law not by optimization.
  // (SEC-3 dedup rides along: one stored copy of a shared lib serves every site that names it.)
  if (isGet && !isRange) {
    const hit = await uServe(realUrl, mimeByExt(realUrl) || "application/octet-stream");
    if (hit) return new Response(hit.bytes, { status: 200, headers: KHDR(hit.kappa, hit.contentType, { "x-holo-egress": "kappa-store" }) });
  }
  const { r, via } = await egressFetch(realUrl, await proxyInit(req));
  if (!r) return refused("subresource egress failed for " + realUrl);
  if (!r.ok) return new Response("", { status: r.status, headers: { "content-type": "text/plain", ...COEPH } });
  const raw = new Uint8Array(await r.arrayBuffer());
  const ct = typeForUrl(realUrl, r.headers.get("content-type")) || "application/octet-stream";
  // onion CSS carries its own onion-relative url()/@import — rewrite them to same-origin sub/ wrappers too,
  // or fonts + background images (also .onion) would be blocked by the browser. κ is minted over what we serve.
  const bytes = (isOnionUrl(realUrl) && /text\/css/i.test(ct)) ? new TextEncoder().encode(rewriteOnionCss(new TextDecoder().decode(raw), realUrl)) : raw;
  const kappa = kappaOf(bytes);
  await kPut(kappa, bytes, { source: realUrl });
  if (isGet && !isRange && r.status === 200) await uPut(realUrl, { kappa, contentType: ct, ts: Date.now() });
  return new Response(bytes, { status: 200, headers: KHDR(kappa, ct, { "x-holo-egress": via }) });
}

// content-addressed asset route: /.holo/<algo>/<κ>[.ext] — the OS host serves it natively, a mounted
// static host has no such route. Serve from the local κ-store first, then the bundle's same-origin
// b/<κ> store; MIME comes from the REQUESTED extension (strict MIME checking refuses octet-stream
// module scripts and stylesheets, and b/ objects are extensionless).
const KROUTE = /\/\.holo\/(?:sha256|blake3)\/([0-9a-f]{64})(?:\.([a-z0-9]+))?$/i;
async function serveDotHolo(kappa, ext) {
  const mime = mimeByExt("x." + ext) || "application/octet-stream";
  const own = await kGet(kappa);
  if (own) return new Response(own, { status: 200, headers: { "content-type": mime, ...COEPH } });
  const r = await fetch(APP_BASE.replace(/apps\/browser\/$/, "") + "b/" + kappa);
  if (!r.ok) return r;
  return new Response(r.body, { status: 200, headers: { "content-type": mime, ...COEPH } });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // 0 · same-origin κ-route → κ-store / b/ (see serveDotHolo above)
  if (url.origin === self.location.origin) {
    const km = url.pathname.match(KROUTE);
    if (km) { event.respondWith(serveDotHolo(km[1].toLowerCase(), km[2] || "").catch(() => fetch(event.request))); return; }
  }
  // 1 · navigations + documents inside our renderer scope
  if (url.origin === self.location.origin && url.pathname.startsWith(VIEW)) {
    const rest = url.pathname.slice(VIEW.length);
    let m;
    if ((m = rest.match(/^h\/([0-9a-fA-F]{64})(\/.*)?$/))) { event.respondWith(serveKappa(m[1].toLowerCase(), (m[2] || "").replace(/^\//, "")).catch((e) => refused(String(e)))); return; }
    // onion subresource wrapper: /webview/sub/<enc(onion url)> → serve it through the Tor bridge, same-origin.
    if ((m = rest.match(/^sub\/(.+)$/))) { let real; try { real = dec(m[1]); } catch { return; } event.respondWith(serveSub(real, event.request).catch(() => new Response("", { status: 502, headers: COEPH }))); return; }
    if ((m = rest.match(/^w\/(.+)$/))) {
      let real; try { real = dec(m[1]); } catch { return; }
      // A GET <form> submit against a rewritten action lands its fields on the WRAPPER's query —
      // the b64 token encodes only the action URL, and the submit replaces the wrapper's search.
      // Carry them onto the real URL or the query never reaches the site (Google → no results).
      if (url.search) { try { const ru = new URL(real); ru.search = url.search; real = ru.href; } catch {} }
      event.respondWith(serveWeb(real, event.request, event).catch((e) => refused(String(e)))); return;
    }
    return;   // unknown webview path → default
  }
  // 2 · requests the renderer iframe makes to the real web (because of the injected <base>).
  // This SW only ever controls the /webview/ iframes, so EVERY cross-origin http(s) request it
  // sees is webview traffic — no fragile referrer/clientId gate needed (navigations carry an
  // empty clientId + a stripped referrer, which is exactly what broke the gated version).
  if (url.protocol === "http:" || url.protocol === "https:") event.respondWith(handleExternal(event, url));
});
async function handleExternal(event, url) {
  if (url.origin === self.location.origin) return fetch(event.request);   // same-origin, not /webview/ → pass through
  // a top-level navigation to another site → re-enter the content-addressed renderer (serveWeb
  // applies main_frame DNR there, where the real URL is known).
  if (event.request.mode === "navigate" || event.request.destination === "document")
    return Response.redirect(new URL(VIEW + "w/" + enc(url.href), self.location.origin).href, 302);
  // a subresource (css/js/img/font/…) → declarativeNetRequest FIRST (block/redirect), then proxy +
  // mint + re-derive on the fly. This is where uBlock-Origin-Lite-style filtering actually bites.
  await ensureExt();                                   // a restarted SW reloads the ad/tracker ruleset from the store
  const rt = resourceTypeOf(event.request);
  const act = dnrAction(url.href, rt);
  if (act.type === "block") { broadcast({ type: "ext-blocked", url: url.href, extId: act.extId, ruleId: act.ruleId, resourceType: rt }); return adSurrogate(rt, act.extId); }   // synthesize a benign stand-in — never a page-breaking hole
  if (act.type === "redirect" && act.redirect && act.redirect.url) return Response.redirect(act.redirect.url, 302);
  return serveSub(url.href, event.request).catch(() => new Response("", { status: 502, headers: COEPH }));
}

self.addEventListener("message", (e) => {
  const m = e.data || {};
  // the page owns/mints a holo://κ document and hands the bytes to the loader's store.
  if (m.type === "kput" && m.kappa && m.bytes) { kPut(m.kappa, m.bytes, m.meta || {}).then(() => { if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true }); }); }
  // the page projects its enabled κ-verified extensions onto the seam (compiled DNR + content scripts).
  if (m.type === "setext") { EXT = { dnr: Array.isArray(m.dnr) ? m.dnr : [], contentScripts: Array.isArray(m.contentScripts) ? m.contentScripts : [] }; EXT_LOADED = true; persistExt(); if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true, dnr: EXT.dnr.length, contentScripts: EXT.contentScripts.length }); }
  // the page tells the seam WHO is signed in (operator κ from the TEE presence) → the egress
  // gives each identity its own persistent Chrome. A SW can't read localStorage, so the page pushes it.
  if (m.type === "setop") { EGRESS_OPERATOR = typeof m.operator === "string" ? m.operator : ""; persistOp(EGRESS_OPERATOR); if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true }); }
  // the omnibox toggles the paywall LADDER: "auto" (default), "on" (force reader), "off". Persisted.
  if (m.type === "ladder") { const v = m.mode; if (v === "on" || v === "off" || v === "auto") { LADDER_MODE = v; LADDER_LOADED = true; persistLadder(v); } if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true, mode: LADDER_MODE }); }
  // the page's device-mesh peer link came up/down → enable/disable the host-peer egress tier.
  if (m.type === "peer-ready") { PEER_READY = !!m.ready; if (typeof m.only === "boolean") PEER_ONLY = m.only; if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true, peer: PEER_READY, only: PEER_ONLY }); }
  // the page answers a proxied peer fetch: a synthesized Response for egressFetch (bytes structured-cloned).
  if (m.type === "peer-fetch-res" && m.id) {
    const p = peerPending.get(m.id);
    if (p) { clearTimeout(p.timer); peerPending.delete(m.id);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(new Response(m.bytes || new Uint8Array(), { status: m.status || 200, headers: m.headers || {} })); }
  }
  if (m.type === "ping" && e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true, view: VIEW });
});
