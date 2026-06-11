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

const KSTORE = "holo-browser-kappa-v1";              // Cache API: minted/owned blocks, keyed by κ
const VIEW = new URL(self.registration.scope).pathname.replace(/\/?$/, "/");   // <base>webview/
const APP_BASE = VIEW.replace(/webview\/$/, "");     // <base>
const WEB_PROXY = APP_BASE + "web?url=";             // holo-serve's dumb-pipe live-web proxy

// ── installed κ-addressed extensions, projected onto the seam (the page posts seamBundle() on any
// install/enable/disable). browser-sw.js IS Chromium's URLLoaderFactory over the κ-store, so MV3's
// declarativeNetRequest maps STRAIGHT onto it: every request is matched against the enabled compiled
// ruleset before it is fetched/minted, and matching content scripts are inlined into served HTML.
// Only bytes that re-derived to a κ-verified extension (holo-ext.install, Law L5) ever reach here. ─
let EXT = { dnr: [], contentScripts: [] };
const REQTYPE = { document: "main_frame", iframe: "sub_frame", frame: "sub_frame", script: "script", style: "stylesheet", image: "image", imageset: "image", font: "font", media: "media", track: "media", object: "object", embed: "object", worker: "script", "": "xmlhttprequest" };
const resourceTypeOf = (req) => req.mode === "navigate" ? (req.destination === "iframe" || req.destination === "frame" ? "sub_frame" : "main_frame") : (REQTYPE[req.destination] || "xmlhttprequest");
// match a request URL against the compiled DNR ruleset → the winning action ({type:"allow"} if none).
function dnrAction(url, resourceType) {
  for (const r of EXT.dnr) { try { if (ruleMatches(r, url, resourceType)) return { ...(r.action || { type: "block" }), extId: r.extId, ruleId: r.id }; } catch {} }
  return { type: "allow" };
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// ── base64url for the web token (isomorphic; no Buffer in a SW) ──────────────────────
const enc = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const dec = (s) => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); return decodeURIComponent(escape(atob(t.padEnd(Math.ceil(t.length / 4) * 4, "=")))); };

// ── κ-store over the Cache API (shared with the page; both are same-origin) ──────────
async function kPut(kappa, bytes, meta = {}) {
  const cache = await caches.open(KSTORE);
  await cache.put("/__k/" + kappa, new Response(bytes, { headers: { "content-type": meta.contentType || "application/octet-stream", "x-holo-source": meta.source || "" } }));
}
async function kGet(kappa) { const cache = await caches.open(KSTORE); const r = await cache.match("/__k/" + kappa); return r ? new Uint8Array(await r.arrayBuffer()) : null; }

// tell the page what committed (κ, mint/verify state) so the omnibox HUD reflects the load.
async function broadcast(msg) { for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(msg); }

// ── HTML rewrite — the renderer's two seams ─────────────────────────────────────────
// 1) inject <base href=realUrl> so RELATIVE SUBRESOURCES (css/js/img/font) resolve to their
//    real absolute URLs; the SW intercepts those (a controlled client's subresource requests
//    fire the fetch event for ANY origin) and mints each.
// 2) rewrite NAVIGATIONS (<a href>, GET <form action>) to in-scope self-origin /webview/w/…
//    URLs. A service worker only intercepts navigations to IN-SCOPE targets, so a link to the
//    real cross-origin URL would escape (ERR_NAME_NOT_RESOLVED); routing clicks back through
//    the scope keeps every page content-addressed. (JS-driven navigation is a known caveat.)
// We do NOT neutralize scripts — the iframe is sandboxed by the page; this is a browser.
function rewriteHtml(text, realUrl, kappa) {
  const SELF = self.location.origin;
  const wrap = (href) => { try { const abs = new URL(href, realUrl).href; return /^https?:/i.test(abs) ? SELF + VIEW + "w/" + enc(abs) : href; } catch { return href; } };
  // <a ... href="X"> → in-scope wrapper (skip in-page anchors + non-navigational schemes)
  text = text.replace(/(<a\b[^>]*?\shref\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, href) => (/^(#|javascript:|mailto:|tel:|data:|blob:)/i.test(href.trim()) ? m : pre + q + wrap(href) + q));
  text = text.replace(/(<form\b[^>]*?\saction\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, act) => pre + q + wrap(act) + q);
  const inj = injectContentScripts(realUrl);          // matching MV3 content scripts (DNR's sibling)
  const stamp = `<base href="${realUrl.replace(/"/g, "&quot;")}">`
    + `<meta name="holo-source" content="${realUrl.replace(/"/g, "&quot;")}">`
    + `<meta name="holo-kappa" content="${kappa}">`
    + inj.head;                                        // document_start scripts + content-script css
  if (inj.tail) text = /<\/body>/i.test(text) ? text.replace(/<\/body>/i, inj.tail + "</body>") : text + inj.tail;
  if (/<head[^>]*>/i.test(text)) return text.replace(/<head[^>]*>/i, (h) => h + stamp);
  if (/<html[^>]*>/i.test(text)) return text.replace(/<html[^>]*>/i, (h) => h + "<head>" + stamp + "</head>");
  return stamp + text;
}

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

// ── serve a live http(s) page: proxy → mint κ → cache → re-derive → serve ────────────
async function serveWeb(realUrl) {
  const act = dnrAction(realUrl, "main_frame");        // an enabled extension may block/redirect the page itself
  if (act.type === "block") { await broadcast({ type: "ext-blocked", url: realUrl, extId: act.extId, ruleId: act.ruleId, resourceType: "main_frame" }); return blockedPage(realUrl, act); }
  if (act.type === "redirect" && act.redirect && act.redirect.url) return Response.redirect(new URL(VIEW + "w/" + enc(act.redirect.url), self.location.origin).href, 302);
  let r;
  try { r = await fetch(WEB_PROXY + encodeURIComponent(realUrl), { redirect: "follow" }); }
  catch (e) { return refused("proxy fetch failed: " + (e.message || e)); }
  if (!r.ok) return new Response("Holo Browser: upstream " + r.status + " for " + realUrl, { status: r.status === 0 ? 502 : r.status, headers: { "content-type": "text/plain" } });
  let bytes = new Uint8Array(await r.arrayBuffer());
  const kappa = kappaOf(bytes);                                  // the mint IS the re-derivation
  const ctype = (r.headers.get("content-type") || mimeByExt(realUrl) || "text/html; charset=utf-8");
  await kPut(kappa, bytes, { contentType: ctype, source: realUrl });
  if (!verifyKappa(kappa, bytes)) return refused("mint re-derivation failed for " + realUrl);
  let body = bytes;
  if (/text\/html/i.test(ctype)) body = new TextEncoder().encode(rewriteHtml(new TextDecoder().decode(bytes), realUrl, kappa));
  await broadcast({ type: "committed", view: VIEW + "w/" + enc(realUrl), kappa, minted: true, verified: true, scheme: new URL(realUrl).protocol.replace(":", ""), contentType: ctype, source: realUrl });
  return new Response(body, { status: 200, headers: KHDR(kappa, ctype) });
}

// ── proxy a subresource of a live page: mint κ + re-derive, serve same-origin ─────────
async function serveSub(realUrl) {
  let r;
  try { r = await fetch(WEB_PROXY + encodeURIComponent(realUrl), { redirect: "follow" }); }
  catch (e) { return refused("subresource proxy failed: " + (e.message || e)); }
  if (!r.ok) return new Response("", { status: r.status, headers: { "content-type": "text/plain" } });
  const bytes = new Uint8Array(await r.arrayBuffer());
  const kappa = kappaOf(bytes);
  await kPut(kappa, bytes, { source: realUrl });
  const ct = r.headers.get("content-type") || mimeByExt(realUrl) || "application/octet-stream";
  return new Response(bytes, { status: 200, headers: KHDR(kappa, ct) });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // 1 · navigations + documents inside our renderer scope
  if (url.origin === self.location.origin && url.pathname.startsWith(VIEW)) {
    const rest = url.pathname.slice(VIEW.length);
    let m;
    if ((m = rest.match(/^h\/([0-9a-fA-F]{64})(\/.*)?$/))) { event.respondWith(serveKappa(m[1].toLowerCase(), (m[2] || "").replace(/^\//, "")).catch((e) => refused(String(e)))); return; }
    if ((m = rest.match(/^w\/(.+)$/))) { let real; try { real = dec(m[1]); } catch { return; } event.respondWith(serveWeb(real).catch((e) => refused(String(e)))); return; }
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
  const rt = resourceTypeOf(event.request);
  const act = dnrAction(url.href, rt);
  if (act.type === "block") { broadcast({ type: "ext-blocked", url: url.href, extId: act.extId, ruleId: act.ruleId, resourceType: rt }); return new Response(new Uint8Array(), { status: 200, headers: { "content-type": "text/plain", "x-holo-blocked": String(act.extId || "1"), ...COEPH } }); }
  if (act.type === "redirect" && act.redirect && act.redirect.url) return Response.redirect(act.redirect.url, 302);
  return serveSub(url.href).catch(() => new Response("", { status: 502, headers: COEPH }));
}

self.addEventListener("message", (e) => {
  const m = e.data || {};
  // the page owns/mints a holo://κ document and hands the bytes to the loader's store.
  if (m.type === "kput" && m.kappa && m.bytes) { kPut(m.kappa, m.bytes, m.meta || {}).then(() => { if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true }); }); }
  // the page projects its enabled κ-verified extensions onto the seam (compiled DNR + content scripts).
  if (m.type === "setext") { EXT = { dnr: Array.isArray(m.dnr) ? m.dnr : [], contentScripts: Array.isArray(m.contentScripts) ? m.contentScripts : [] }; if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true, dnr: EXT.dnr.length, contentScripts: EXT.contentScripts.length }); }
  if (m.type === "ping" && e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true, view: VIEW });
});
