// holo-browser.js — the engine for Holo Browser: Chromium's browser process, mapped onto a
// holospace.
//
// First principles. Chromium is split into a BROWSER process (the UI, navigation, the network
// service, the scheme registry, the profile) that drives sandboxed RENDERER processes (Blink:
// HTML/CSS/JS/layout/paint). A holospace cannot ship Blink — so Holo Browser IS the browser
// process and the surrounding real Chromium (the native CEF host, or whatever engine the OS
// runs in) IS the renderer, reached through a sandboxed <iframe>. We own exactly the half
// Chromium's browser process owns: tabs/WebContents, the NavigationController (session
// history), the omnibox AutocompleteController, the SchemeRegistry, and — the load-bearing
// part — the URLLoaderFactory → ResourceHandler → KappaStore loading seam: every byte the
// renderer is about to see is content-addressed and VERIFIED BY RE-DERIVATION first (Law L5).
// A forged byte is refused. This is the same seam the native CEF build wires with
// CefResourceHandler; here it is a service worker (browser-sw.js) over the same KappaStore.
//
// "Any internet/local page as UOR content-addressable substrate": a holo://<κ>, ipfs://, ENS
// .eth or local κ is served from the κ-store and re-derived; a live http(s) page is fetched
// once through a dumb proxy and MINTED into a κ (blake3 over its bytes) — first sighting mints
// the address, every replay re-derives it. Honest model, stated plainly.
//
// Pure, dependency-free ES module — runs in the page, in the service worker, and in Node (the
// witness + the MCP browser tools all import it). Reuses the substrate, never reinvents it:
//   • holo-ipfs.js  — blake3 / sha256, CID + multiformats, verifyBlock, holoUri, mimeByExt.
//   • holo-dweb.js  — the unified classifier ("one object graph behind one address bar").
//   • holo-eth.js   — keccak256 + namehash (ENS name → contenthash), used by ensResolve.
//
// Authorities mirrored (cited, not restated): Chromium //content (NavigationController,
// WebContents, NavigationEntry, URLLoaderFactory, SiteInstance) + //chrome (Browser, the NTP)
// + //components/omnibox (AutocompleteController/Provider); WHATWG URL + Fetch; the Chrome
// DevTools Protocol shape for the agent surface; Law L5 (verify-by-re-derivation) for loading.

import { blake3, toBytes, toHex, mimeByExt, verifyBlock, parseCID, cidToString, holoUri, cidToDid } from "./holo-ipfs.js";
import { classify as dwebClassify, SECTIONS as DWEB_SECTIONS, APPS as DWEB_APPS, searchDirectory } from "./holo-dweb.js";

export const VERSION = "holo-browser 1.0";

// ── κ — the content address (blake3 hex, the substrate's native fast axis) ───────────
// This matches the native holo:// scheme (browser-native/holo-b3.c emits blake3 hex), so a κ
// minted here addresses the same bytes the CEF build's KappaStore serves.
export const kappaOf = (bytes) => toHex(blake3(toBytes(bytes)));
export const verifyKappa = (kappa, bytes) => kappaOf(bytes) === String(kappa).toLowerCase();
export const holoUrl = (kappa, path = "") => "holo://" + kappa + (path ? "/" + String(path).replace(/^\//, "") : "");
export const kappaToDid = (kappa) => "did:holo:blake3:" + kappa;

// ── SchemeRegistry — url::SchemeRegistry / ContentClient::AddAdditionalSchemes ───────
// `secure` schemes are treated as trustworthy origins (powerful features, no mixed-content
// warning); `local`/`standard` mirror Chromium's scheme flags. holo + kappa are registered
// standard + secure exactly as the ADR specifies for the native build.
export const SCHEMES = {
  holo:   { standard: true, secure: true, local: false, contentAddressed: true, label: "content-addressed" },
  kappa:  { standard: true, secure: true, local: false, contentAddressed: true, label: "content-addressed" },
  ipfs:   { standard: true, secure: true, local: false, contentAddressed: true, label: "content-addressed" },
  ipns:   { standard: true, secure: true, local: false, contentAddressed: true, label: "name → content-addressed" },
  ens:    { standard: true, secure: true, local: false, contentAddressed: true, label: "name → content-addressed" },
  https:  { standard: true, secure: true, local: false, contentAddressed: false, label: "live web (mint κ on fetch)" },
  http:   { standard: true, secure: false, local: false, contentAddressed: false, label: "live web (mint κ on fetch)" },
  file:   { standard: true, secure: false, local: true,  contentAddressed: false, label: "local" },
  chrome: { standard: true, secure: true, local: true,  contentAddressed: false, label: "browser UI" },   // chrome:// internal pages (NTP, settings)
};
export const isContentAddressed = (scheme) => !!(SCHEMES[scheme] && SCHEMES[scheme].contentAddressed);
export const isSecureScheme = (scheme) => !!(SCHEMES[scheme] && SCHEMES[scheme].secure);

// The default search engine for non-URL omnibox text. Content-addressed itself: a search
// resolves into the federated dweb directory first (offline), then optionally a web engine.
export const DEFAULT_SEARCH = { name: "Holo Search", url: "https://duckduckgo.com/?q=%s" };
const KAPPA_RE = /^[0-9a-f]{64}$/i;

// ── classifyInput — the AutocompleteProvider's classifier (omnibox → a destination) ─
// Wraps holo-dweb.classify (which already spans ipfs/ipns/dnslink/ens/web/app) and extends it
// with the browser-process schemes the dweb front page doesn't model: holo://κ, kappa:, bare
// κ hex, chrome://, file:, and "bare domain → https". Returns a NavigationTarget.
export function classifyInput(raw, { search = DEFAULT_SEARCH } = {}) {
  let s = String(raw == null ? "" : raw).trim();
  if (!s) return { kind: "empty", scheme: null, url: "", display: "" };
  // content-addressed first — these are the substrate's own schemes.
  let m;
  if ((m = s.match(/^holo:\/\/(?:k\/)?([0-9a-fA-F]{64})(\/.*)?$/i))) return mk("holo", "holo", holoUrl(m[1].toLowerCase(), (m[2] || "").replace(/^\//, "")), s, { kappa: m[1].toLowerCase(), path: (m[2] || "").replace(/^\//, "") });
  if ((m = s.match(/^kappa:(?:\/\/)?([0-9a-fA-F]{64})(\/.*)?$/i))) return mk("holo", "kappa", holoUrl(m[1].toLowerCase(), (m[2] || "").replace(/^\//, "")), s, { kappa: m[1].toLowerCase(), path: (m[2] || "").replace(/^\//, "") });
  if (KAPPA_RE.test(s.split("/")[0])) { const [k, ...rest] = s.split("/"); return mk("holo", "holo", holoUrl(k.toLowerCase(), rest.join("/")), s, { kappa: k.toLowerCase(), path: rest.join("/") }); }
  if (/^chrome:\/\//i.test(s)) return mk("chrome", "chrome", s.toLowerCase(), s, { page: s.replace(/^chrome:\/\//i, "").replace(/\/.*$/, "") });
  if (/^holo:\/\//i.test(s)) return mk("internal", "holo", s, s, {});                  // holo://<appId> alias (NTP fleet)
  if (/^file:\/\//i.test(s)) return mk("file", "file", s, s, {});
  // hand the rest to the federated dweb classifier (ipfs/ipns/dnslink/ens/web/search).
  const d = dwebClassify(s);
  if (d.kind === "ipfs") return mk("ipfs", "ipfs", normIpfs(d.target, "ipfs"), s, {});
  if (d.kind === "ipns") return mk("ipns", "ipns", normIpfs(d.target, "ipns"), s, {});
  if (d.kind === "ens")  return mk("ens", "ens", d.target, s, { name: d.target.split("/")[0] });
  if (d.kind === "web")  { const u = new URL(s); return mk("web", u.protocol.replace(":", ""), u.href, s, { origin: u.origin }); }
  // the onion web — normalize to a real URL so go() routes it through the SW's onion tier (webview/w/).
  // Onion services self-authenticate (the address IS the ed25519 key), so http is the norm — no TLS needed.
  if (d.kind === "onion") { const u = new URL(/^https?:\/\//i.test(s) ? s : "http://" + s); return mk("onion", u.protocol.replace(":", ""), u.href, s, { origin: u.origin, legacy: !!d.legacy }); }
  if (d.kind === "did")  return mk("did", "holo", s, s, {});
  if (d.kind === "demo") return mk("demo", "holo", "@demo", s, {});
  // A bare domain (holo-dweb flags it "dnslink" as a content-addressed CANDIDATE). For a
  // general browser the default is the live web (https) — but we keep the DNSLink hint so the
  // loader can offer the content-addressed mirror. "example.com", "vitalik.eth/blog" → navigate.
  if (d.kind === "dnslink") { const url = "https://" + s; const u = new URL(url); return mk("web", "https", u.href, s, { origin: u.origin, dnslink: d.target.split("/")[0] }); }
  return mk("search", "https", search.url.replace("%s", encodeURIComponent(s)), s, { query: s });
}
function mk(kind, scheme, url, display, extra) { return { kind, scheme, url, display, ...extra }; }
function normIpfs(t, kind) { let s = String(t).replace(/^\/?(ipfs|ipns)\//i, "").replace(/^(ipfs|ipns):\/\//i, ""); return kind + "://" + s; }

// ── AutocompleteController — components/omnibox. Ranks history + the dweb directory + a
// search fallback into omnibox suggestions for the current input. ───────────────────
export function autocomplete(input, { history = [], bookmarks = [], limit = 8, search = DEFAULT_SEARCH } = {}) {
  const q = String(input || "").trim();
  const out = [];
  if (!q) return out;
  const cls = classifyInput(q, { search });
  // 1 · the verbatim/navigate row (what Enter does), like Chrome's "what you typed".
  if (cls.kind !== "search" && cls.kind !== "empty") out.push({ type: cls.kind === "web" ? "url" : cls.kind, title: cls.display, target: cls.url, scheme: cls.scheme, secure: isSecureScheme(cls.scheme), contentAddressed: isContentAddressed(cls.scheme) });
  // 2 · history + bookmarks prefix/substring matches (HistoryProvider / BookmarkProvider).
  const ql = q.toLowerCase();
  for (const h of [...bookmarks.map((b) => ({ ...b, type: "bookmark" })), ...history.map((h) => ({ ...h, type: "history" }))]) {
    const hay = ((h.title || "") + " " + (h.url || "")).toLowerCase();
    if (hay.includes(ql) && !out.some((o) => o.target === h.url)) out.push({ type: h.type, title: h.title || h.url, target: h.url, scheme: classifyInput(h.url).scheme });
    if (out.length >= limit) break;
  }
  // 3 · the federated dweb directory (SearchProvider over a content-addressed corpus).
  for (const e of searchDirectory(q).slice(0, limit)) {
    const t = classifyInput(e.target || e.name);
    if (!out.some((o) => o.target === t.url)) out.push({ type: "directory", title: e.name + " — " + (e.desc || ""), target: t.url, scheme: t.scheme, contentAddressed: isContentAddressed(t.scheme) });
    if (out.length >= limit) break;
  }
  // 4 · the search fallback (SearchProvider default).
  if (cls.kind === "search" || cls.kind === "empty") out.push({ type: "search", title: `${search.name}: ${q}`, target: search.url.replace("%s", encodeURIComponent(q)), scheme: "https" });
  return out.slice(0, limit);
}

// ── KappaStore — content::ResourceLoader's backing store, content-addressed. The pure Map
// version; the page/SW wrap persistence (Cache API / OPFS). put(bytes)→κ; get(κ); verify. ─
export class KappaStore {
  constructor() { this.map = new Map(); }
  put(bytes, meta = {}) { const b = toBytes(bytes); const k = kappaOf(b); if (!this.map.has(k)) this.map.set(k, { bytes: b, meta }); return k; }
  get(kappa) { const e = this.map.get(String(kappa).toLowerCase()); return e ? e.bytes : null; }
  meta(kappa) { const e = this.map.get(String(kappa).toLowerCase()); return e ? e.meta : null; }
  has(kappa) { return this.map.has(String(kappa).toLowerCase()); }
  // Law L5: a stored block is trusted ONLY if it still re-derives to its address.
  verify(kappa) { const b = this.get(kappa); return b != null && verifyKappa(kappa, b); }
  get size() { return this.map.size; }
}

// ── the loading seam — URLLoaderFactory → URLLoader → ResourceHandler → KappaStore ──
// resolveLoad(target, opts) returns { ok, bytes, kappa, contentType, scheme, minted, verified,
// finalUrl, refused? }. The ONE place a byte becomes trusted: every path ends in a re-
// derivation check, and a mismatch is refused (Law L5). Network is injected (fetchImpl) so the
// same function runs in the page, the SW, and Node.
export async function resolveLoad(input, { store, fetchImpl, proxyBase = "", ipfsGet, name } = {}) {
  const cls = typeof input === "object" && input.scheme ? input : classifyInput(input);
  const fetcher = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  // content-addressed: serve from the κ-store, re-derive against the address.
  if (cls.scheme === "holo" || cls.scheme === "kappa") {
    const kappa = cls.kappa; if (!kappa) return { ok: false, refused: true, reason: "no κ in holo:// url" };
    let bytes = store && store.get ? store.get(kappa) : null;
    if (!bytes) return { ok: false, refused: false, reason: "κ not in store: " + kappa, kappa };
    if (!verifyKappa(kappa, bytes)) return { ok: false, refused: true, reason: "Law L5: κ re-derivation failed (forged byte refused): " + kappa, kappa };
    return { ok: true, bytes, kappa, scheme: "holo", verified: true, minted: false, contentType: guessType(cls.path || name), finalUrl: cls.url };
  }
  // ipfs/ipns: block retrieval is injected (ipfsGet); each block re-derived against its CID.
  if (cls.scheme === "ipfs") {
    if (!ipfsGet) return { ok: false, reason: "ipfs retrieval not wired (pass ipfsGet)" };
    const cidStr = cls.url.replace(/^ipfs:\/\//, "").split("/")[0];
    const cid = parseCID(cidStr); const bytes = await ipfsGet(cidToString(cid));
    if (!(await verifyBlock(cid, bytes))) return { ok: false, refused: true, reason: "Law L5: IPFS block refused: " + cidStr };
    return { ok: true, bytes, kappa: cidToString(cid), scheme: "ipfs", verified: true, contentType: guessType(name), finalUrl: cls.url };
  }
  // live web: fetch once through the dumb proxy, MINT a κ (blake3), store it, re-derive.
  if (cls.scheme === "http" || cls.scheme === "https") {
    if (!fetcher) return { ok: false, reason: "no fetch available" };
    const url = proxyBase ? proxyBase + encodeURIComponent(cls.url) : cls.url;
    const r = await fetcher(url, { redirect: "follow" });
    if (!r.ok) return { ok: false, reason: "HTTP " + r.status, status: r.status };
    const bytes = new Uint8Array(await r.arrayBuffer());
    const kappa = store && store.put ? store.put(bytes, { source: cls.url }) : kappaOf(bytes);
    const verified = verifyKappa(kappa, bytes);   // the mint is itself the re-derivation
    return { ok: true, bytes, kappa, scheme: cls.scheme, minted: true, verified, contentType: r.headers.get ? (r.headers.get("content-type") || guessType(cls.url)) : guessType(cls.url), finalUrl: r.url || cls.url };
  }
  return { ok: false, reason: "scheme not directly loadable here: " + cls.scheme, scheme: cls.scheme };
}
const guessType = (name) => mimeByExt(name || "") || "text/html; charset=utf-8";

// ── NavigationEntry / NavigationController — content::NavigationController (session history) ─
export class NavigationController {
  constructor() { this.entries = []; this.index = -1; this.pending = null; }
  get current() { return this.index >= 0 ? this.entries[this.index] : null; }
  get canGoBack() { return this.index > 0; }
  get canGoForward() { return this.index >= 0 && this.index < this.entries.length - 1; }
  // navigate() commits a new entry, truncating any forward history (Chromium's behaviour).
  navigate(url, { title = "", transition = "typed" } = {}) {
    const entry = { url, title: title || url, kappa: null, scheme: classifyInput(url).scheme, ts: Date.now(), transition };
    this.entries = this.entries.slice(0, this.index + 1); this.entries.push(entry); this.index = this.entries.length - 1;
    return entry;
  }
  goBack() { if (this.canGoBack) this.index--; return this.current; }
  goForward() { if (this.canGoForward) this.index++; return this.current; }
  goToIndex(i) { if (i >= 0 && i < this.entries.length) this.index = i; return this.current; }
  reload() { return this.current; }
  updateCurrent(patch) { if (this.current) Object.assign(this.current, patch); return this.current; }
}

// ── WebContents — content::WebContents (one tab's renderer + its navigation state) ──
let _tabSeq = 0;
export class WebContents {
  constructor({ url = "chrome://newtab" } = {}) {
    this.id = "tab-" + (++_tabSeq); this.nav = new NavigationController();
    this.title = "New Tab"; this.favicon = null; this.loading = false; this.crashed = false;
    this.securityState = "neutral";   // neutral | secure | warning | dangerous (Chrome's omnibox security chip)
    this.lastKappa = null; this.lastMinted = false;
    if (url) this.nav.navigate(url, { title: "New Tab" });
  }
  get url() { return this.nav.current ? this.nav.current.url : "chrome://newtab"; }
  // Apply a committed load result to the tab's state (what content::WebContents does on commit).
  commit(target, result) {
    this.loading = false; this.lastKappa = result && result.kappa || null; this.lastMinted = !!(result && result.minted);
    const ca = isContentAddressed(target.scheme);
    if (result && result.refused) this.securityState = "dangerous";
    else if (result && result.verified && ca) this.securityState = "secure";
    else if (target.scheme === "https") this.securityState = "secure";
    else if (target.scheme === "http") this.securityState = "warning";
    else this.securityState = "neutral";
    this.nav.updateCurrent({ kappa: this.lastKappa, title: this.title });
    return this;
  }
}

// ── Browser / BrowserList — chrome::Browser: owns the tab strip ─────────────────────
export class Browser {
  constructor() { this.tabs = []; this.active = -1; this.history = []; this.bookmarks = []; }
  newTab(url = "chrome://newtab", { activate = true } = {}) { const wc = new WebContents({ url }); this.tabs.push(wc); if (activate) this.active = this.tabs.length - 1; return wc; }
  get activeTab() { return this.active >= 0 ? this.tabs[this.active] : null; }
  selectTab(i) { if (i >= 0 && i < this.tabs.length) this.active = i; return this.activeTab; }
  selectTabById(id) { const i = this.tabs.findIndex((t) => t.id === id); if (i >= 0) this.active = i; return this.activeTab; }
  closeTab(i) {
    if (i < 0 || i >= this.tabs.length) return this.activeTab;
    this.tabs.splice(i, 1);
    if (this.tabs.length === 0) { this.active = -1; return null; }
    if (this.active >= this.tabs.length) this.active = this.tabs.length - 1; else if (i < this.active) this.active--;
    return this.activeTab;
  }
  recordVisit(url, title, kappa) { this.history.unshift({ url, title: title || url, kappa, ts: Date.now() }); if (this.history.length > 500) this.history.length = 500; }
  toggleBookmark(url, title) { const i = this.bookmarks.findIndex((b) => b.url === url); if (i >= 0) { this.bookmarks.splice(i, 1); return false; } this.bookmarks.push({ url, title: title || url, ts: Date.now() }); return true; }
  isBookmarked(url) { return this.bookmarks.some((b) => b.url === url); }
}

// ── NewTabPage — chrome::NewTabPageUI: the model the NTP renders (OS fleet + dweb + history) ─
export function newTabModel({ history = [], bookmarks = [] } = {}) {
  return {
    fleet: DWEB_APPS.map((a) => ({ id: a.id, name: a.name, target: "holo://" + a.id, loader: a.loader, accent: a.accent, desc: a.desc })),
    directory: DWEB_SECTIONS.map((s) => ({ title: s.title, note: s.note, entries: s.entries.map((e) => ({ name: e.name, desc: e.desc, kind: e.kind, target: classifyInput(e.target).url || e.target })) })),
    bookmarks, recent: history.slice(0, 12),
  };
}

// ── agent surface — the CDP analog. A structured, content-addressed snapshot of a page that
// both humans (the UI) and AI agents (window.HoloBrowser / the MCP tools) read. ─────────
const stripTags = (html) => String(html)
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, " ").trim();
export const extractTitle = (html) => { const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m ? stripTags(m[1]) : ""; };
export const extractText = (html, max = 20000) => { const t = stripTags(html); return t.length > max ? t.slice(0, max) + "…" : t; };
export function extractLinks(html, baseUrl = "") {
  const out = []; const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html)) && out.length < 500) {
    let href = m[1]; if (/^(javascript:|#|mailto:|tel:)/i.test(href)) continue;
    try { if (baseUrl) href = new URL(href, baseUrl).href; } catch {}
    out.push({ href, text: stripTags(m[2]).slice(0, 120) });
  }
  return out;
}
// agentSnapshot — for the page it's filled from the live DOM; for Node (MCP/witness) it is
// derived from the loaded bytes. Either way it carries the κ so the agent can re-derive (L5).
export function snapshotFromBytes(bytes, { url = "", kappa = null, minted = false, contentType = "text/html" } = {}) {
  const isHtml = /html/i.test(contentType);
  const html = isHtml ? new TextDecoder().decode(toBytes(bytes)) : "";
  return {
    url, kappa, did: kappa ? kappaToDid(kappa) : null, minted,
    title: isHtml ? extractTitle(html) : (url.split("/").pop() || url),
    contentType, bytes: toBytes(bytes).length,
    text: isHtml ? extractText(html) : "", links: isHtml ? extractLinks(html, url) : [],
    verified: kappa ? verifyKappa(kappa, bytes) : null,
  };
}

// ── ENS — name.eth → contenthash (EIP-137 namehash + the resolver's contenthash(bytes32)).
// keccak/namehash come from holo-eth; the eth_call + contenthash decode are injected so the
// engine stays network-free. Returns an ipfs:// / ipns:// target or null. ──────────────
export async function ensResolve(name, { rpc, decodeContenthash } = {}) {
  if (!rpc || !decodeContenthash) return null;
  const eth = await import("./holo-eth.js");
  const node = eth.namehash(name);
  // ENS registry → resolver(node) → contenthash(node). (selectors via holo-eth.)
  const REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
  const resolverAddr = "0x" + (await rpc.call(REGISTRY, eth.encodeCall("resolver(bytes32)", [node]))).slice(-40);
  if (/^0x0+$/.test(resolverAddr)) return null;
  const ch = await rpc.call(resolverAddr, eth.encodeCall("contenthash(bytes32)", [node]));
  const decoded = decodeContenthash(eth.decodeString ? eth.decodeString(ch) : ch);
  if (!decoded || !decoded.cid) return null;
  return decoded.protocol + "://" + decoded.cid;
}

// ── selfTest — KAT-style. Proves the load-bearing invariants the witness asserts. ──────
export function selfTest() {
  const checks = []; const ok = (c, m) => { checks.push({ ok: !!c, msg: m }); return !!c; };
  // SchemeRegistry: holo/kappa/ipfs are content-addressed + secure; http is neither secure.
  ok(isContentAddressed("holo") && isSecureScheme("holo"), "holo:// registered standard + secure + content-addressed");
  ok(isContentAddressed("ipfs") && !isContentAddressed("https"), "ipfs content-addressed; https is not");
  ok(!isSecureScheme("http") && isSecureScheme("https"), "scheme security flags match Chromium");
  // classifyInput routes every supported scheme.
  const K = "a".repeat(64);
  ok(classifyInput("holo://" + K).scheme === "holo" && classifyInput("holo://" + K).kappa === K, "classify holo://κ");
  ok(classifyInput("holo://k/" + K).kappa === K, "classify the native holo://k/κ form");
  ok(classifyInput(K).scheme === "holo", "classify a bare κ hex → holo");
  ok(classifyInput("ipfs://bafyxyz").scheme === "ipfs", "classify ipfs://");
  ok(classifyInput("vitalik.eth").scheme === "ens", "classify name.eth → ENS");
  ok(classifyInput("https://example.com").scheme === "https", "classify an https URL");
  ok(classifyInput("example.com").scheme === "https" && classifyInput("example.com").kind === "web", "classify a bare domain → https navigate");
  ok(classifyInput("hello world").kind === "search", "classify free text → search");
  { const oc = classifyInput("2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion");
    ok(oc.kind === "onion" && oc.url === "http://2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/", "classify a bare v3 .onion → onion + http URL (not search)");
    ok(classifyInput("http://2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/x").kind === "onion", "classify a full http://…onion/path → onion"); }
  ok(classifyInput("chrome://newtab").scheme === "chrome", "classify chrome:// internal page");
  // κ mint + Law L5 re-derivation / tamper-refusal.
  const store = new KappaStore();
  const bytes = toBytes("<!doctype html><title>t</title><h1>hello</h1>");
  const k = store.put(bytes);
  ok(verifyKappa(k, bytes), "kappaOf re-derives (verify accepts the true bytes)");
  const bad = bytes.slice(); bad[bad.length - 1] ^= 1;
  ok(!verifyKappa(k, bad), "verify REFUSES a tampered byte (Law L5)");
  ok(store.verify(k), "KappaStore.verify accepts the stored block");
  // NavigationController back/forward invariants.
  const nav = new NavigationController();
  nav.navigate("holo://" + K); nav.navigate("https://a.test"); nav.navigate("https://b.test");
  ok(nav.canGoBack && !nav.canGoForward && nav.current.url === "https://b.test", "nav: three entries, at the tip");
  nav.goBack(); ok(nav.current.url === "https://a.test" && nav.canGoForward, "nav: back works, forward enabled");
  nav.navigate("https://c.test"); ok(!nav.canGoForward && nav.entries.length === 3, "nav: navigating truncates forward history (Chromium)");
  // Browser tab strip.
  const b = new Browser(); b.newTab("https://x.test"); b.newTab("https://y.test");
  ok(b.tabs.length === 2 && b.activeTab.url === "https://y.test", "Browser: opened two tabs, second active");
  b.closeTab(1); ok(b.tabs.length === 1 && b.activeTab.url === "https://x.test", "Browser: closeTab re-activates a neighbour");
  // agent snapshot from bytes (the MCP/Node path).
  const snap = snapshotFromBytes(toBytes('<!doctype html><title>Doc</title><a href="/p">link</a><p>Body text here</p>'), { url: "https://e.test/", kappa: k });
  ok(snap.title === "Doc" && /Body text here/.test(snap.text) && snap.links[0].href === "https://e.test/p", "agentSnapshot extracts title/text/links + did");
  // NTP model spans the OS fleet + the dweb directory.
  const ntp = newTabModel(); ok(ntp.fleet.length >= 3 && ntp.directory.length >= 1, "NTP model carries the OS fleet + dweb directory");
  return { ok: checks.every((c) => c.ok), checks };
}
