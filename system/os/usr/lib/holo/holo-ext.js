// holo-ext.js — the in-OS MV3-subset extension runtime for Holo Browser.
//
// First principles. holo-crx.js gives us the κ-addressed Chrome-extension FORMAT (parse + verify
// a CRX3 by re-derivation, Law L5). This module is the RUNTIME that turns those verified bytes
// into a running extension WITHOUT the native Chromium engine — the honest in-OS subset:
//
//   • declarativeNetRequest — MV3's block/redirect/modify-headers ruleset. Holo Browser's loading
//     seam (browser-sw.js) already intercepts EVERY request (it IS Chromium's URLLoaderFactory
//     over the κ-store), so a DNR ruleset maps directly onto that seam. uBlock Origin Lite,
//     privacy filters → reachable now.
//   • content_scripts — JS/CSS injected into a matching page. The seam rewrites served HTML, so a
//     matching script is inlined at its run_at. Dark-Reader-style extensions → reachable now.
//   • a chrome.* polyfill SUBSET — runtime.id/getURL, i18n.getMessage, storage.local — enough for
//     the above. Honest: injected scripts run in the PAGE world (not an isolated world), and the
//     hard APIs (webRequest/MV2, chrome.debugger, devtools pages, nativeMessaging) are NATIVE-ONLY
//     — analyzeManifest() already labels those "needs-native". This module never pretends otherwise.
//
// The UOR anchor (why this is hologram-native, not a polyfill toy): every extension is installed by
// its κ. install() RE-DERIVES the κ over the exact CRX bytes and verifies the publisher signature
// (Law L5) before a single rule or script is honoured. An update is a NEW κ, never a silent push.
// "Run only bytes that re-derive" — the same law the κ-store enforces for pages, applied to code.
//
// Pure, dependency-free ES module (browser + module worker + Node ≥18). Reuses the substrate:
//   • holo-crx.js — parse/verify/analyze a CRX3, compile + match DNR rules (never re-implemented).
//   • holo-ipfs.js — toBytes/toHex (κ utils), via holo-crx.
//
// Authorities mirrored (cited, not restated): Chrome Extensions match patterns
// (developer.chrome.com/docs/extensions/develop/concepts/match-patterns), declarativeNetRequest
// static rulesets (…/reference/api/declarativeNetRequest), content_scripts + run_at
// (…/reference/manifest/content-scripts), the MV3 manifest, and Law L5 (verify-by-re-derivation).

import { verifyCrx, readCrxFiles, readManifest, analyzeManifest, compileDnrRules, ruleMatches } from "./holo-crx.js";
import { toBytes } from "./holo-ipfs.js";
import { fromUtf8 } from "./holo-zip.js";

export const VERSION = "holo-ext 1.0";

// ── Chrome match patterns — <scheme>://<host><path>, plus the <all_urls> sentinel ────
// Grammar (cited above): scheme ∈ {*,http,https,file,ftp,ws,wss}; host = "*" | "*.suffix" | exact;
// path is a glob where "*" matches any run. "*" scheme means http|https only (Chrome's rule).
// HOLO EXTENSION: <all_urls> also spans the content-addressed schemes (holo/ipfs/ipns/kappa) — in
// Hologram these ARE the web, so an "all pages" content script (Dark-Reader-style) reaches a
// holo://κ page too. The κ still verifies the SOURCE (Law L5); the script transforms only the VIEW.
const ALL_URLS = /^(https?|file|ftp|wss?|holo|ipfs|ipns|kappa):$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function matchPattern(pattern, url) {
  let u; try { u = new URL(url); } catch { return false; }
  if (pattern === "<all_urls>") return ALL_URLS.test(u.protocol);
  const m = /^(\*|https?|file|ftp|wss?):\/\/(\*|(?:\*\.)?[^/*]*)(\/.*)$/.exec(pattern);
  if (!m) return false;
  const [, scheme, host, path] = m;
  if (scheme === "*") { if (!/^https?:$/.test(u.protocol)) return false; }
  else if (u.protocol !== scheme + ":") return false;
  if (host !== "*") {
    if (host.startsWith("*.")) { const base = host.slice(2); if (!(u.hostname === base || u.hostname.endsWith("." + base))) return false; }
    else if (u.hostname !== host) return false;
  }
  const re = "^" + path.split("*").map(escapeRe).join(".*") + "$";
  try { return new RegExp(re).test(u.pathname + u.search); } catch { return false; }
}
export const matchesAny = (patterns, url) => (patterns || []).some((p) => matchPattern(p, url));

// ── ExtensionManager — the chrome::ExtensionRegistry + ExtensionService analog, content-addressed.
// Holds installed extensions (each keyed by κ), enables/disables them, and projects the enabled set
// onto the loading seam: a compiled DNR ruleset and the content-script set for a URL. ──────────────
export class ExtensionManager {
  constructor() { this.exts = new Map(); }   // extensionId → record

  // install — the ONE place untrusted CRX bytes become a trusted, running extension. Law L5:
  // re-derive the κ + verify the publisher signature FIRST; refuse anything that does not.
  async install(crxBytes, { expectedKappa = null, enable = true, source = null } = {}) {
    const bytes = toBytes(crxBytes);
    const v = await verifyCrx(bytes, expectedKappa);
    if (!v.ok) throw new Error("install refused (Law L5): " + (v.reason || (v.kappaMatches === false ? "κ re-derivation failed" : v.signatureOk === false ? "publisher signature invalid" : "verification failed")));
    const files = await readCrxFiles(bytes);
    const manifest = await readManifest(files);
    const analysis = analyzeManifest(manifest);
    const rec = {
      id: v.extensionId || ("kappa:" + v.kappa.slice(0, 16)), kappa: v.kappa, did: v.did,
      name: manifest.name, version: manifest.version, manifest, analysis, files,
      enabled: !!enable, signatureOk: v.signatureOk, source, installedAt: null,
    };
    this.exts.set(rec.id, rec);
    return rec;
  }
  get(id) { return this.exts.get(id) || null; }
  list() { return [...this.exts.values()]; }
  enabledList() { return this.list().filter((e) => e.enabled); }
  setEnabled(id, on) { const r = this.exts.get(id); if (r) r.enabled = !!on; return r || null; }
  remove(id) { return this.exts.delete(id); }
  // a files-free view for the UI / persistence (the κ re-fetches the rest, Law L5).
  summary(rec) { return { id: rec.id, kappa: rec.kappa, did: rec.did, name: rec.name, version: rec.version, enabled: rec.enabled, verdict: rec.analysis.verdict, reason: rec.analysis.reason, featureSupport: rec.analysis.featureSupport, source: rec.source, signatureOk: rec.signatureOk }; }
  summaries() { return this.list().map((r) => this.summary(r)); }

  // ── declarativeNetRequest — read each enabled static ruleset out of the CRX, compile + merge ──
  compiledDnr() {
    const all = [];
    for (const e of this.enabledList()) {
      const dnr = e.manifest.declarative_net_request;
      if (!dnr || !Array.isArray(dnr.rule_resources)) continue;
      for (const rr of dnr.rule_resources) {
        if (rr && rr.enabled === false) continue;
        const f = rr && rr.path ? e.files.get(rr.path) : null;
        if (!f) continue;
        let rules; try { rules = JSON.parse(fromUtf8(f)); } catch { continue; }
        if (!Array.isArray(rules)) continue;
        for (const c of compileDnrRules(rules)) all.push({ ...c, extId: e.id });
      }
    }
    return all.sort((a, b) => b.priority - a.priority);
  }
  // resolve a request against the compiled ruleset → the winning action ({type:"allow"} if none).
  // Chrome's precedence: higher priority wins; `allow`/`allowAllRequests` beat `block` at equal-or-
  // higher priority. We keep it faithful-but-simple: first matching rule in priority order.
  matchRequest(url, resourceType, compiled = null) {
    const rules = compiled || this.compiledDnr();
    for (const r of rules) if (ruleMatches(r, url, resourceType)) return { ...(r.action || { type: "block" }), ruleId: r.id, extId: r.extId, priority: r.priority };
    return { type: "allow" };
  }

  // ── content_scripts — which enabled scripts inject into `url` (optionally at a given run_at) ──
  contentScriptsFor(url, runAt = null) {
    const out = [];
    for (const e of this.enabledList()) {
      for (const cs of (e.manifest.content_scripts || [])) {
        const at = cs.run_at || "document_idle";
        if (runAt && at !== runAt) continue;
        if (!matchesAny(cs.matches, url)) continue;
        if (cs.exclude_matches && matchesAny(cs.exclude_matches, url)) continue;
        const js = (cs.js || []).map((p) => e.files.get(p)).filter(Boolean).map(fromUtf8);
        const css = (cs.css || []).map((p) => e.files.get(p)).filter(Boolean).map(fromUtf8);
        if (js.length || css.length) out.push({ extId: e.id, runAt: at, world: cs.world || "ISOLATED", js, css });
      }
    }
    return out;
  }

  // ── the seam bundle — a SERIALIZABLE projection the page postMessages to browser-sw.js. No
  // Uint8Arrays: compiled DNR rules + content-script TEXT, ready for the seam to enforce + inject. ─
  seamBundle() {
    return {
      dnr: this.compiledDnr(),
      contentScripts: this.enabledList().flatMap((e) =>
        (e.manifest.content_scripts || []).map((cs) => ({
          extId: e.id, matches: cs.matches || [], excludeMatches: cs.exclude_matches || [],
          runAt: cs.run_at || "document_idle",
          js: (cs.js || []).map((p) => e.files.get(p)).filter(Boolean).map(fromUtf8),
          css: (cs.css || []).map((p) => e.files.get(p)).filter(Boolean).map(fromUtf8),
        })).filter((c) => c.js.length || c.css.length)),
    };
  }
}

// ── the chrome.* polyfill SUBSET — a prelude prepended to an injected content script so it finds a
// minimal `chrome`/`browser` in the page world. Honest scope: NOT an isolated world, NOT the full
// API. Just enough for DNR/content-script extensions: runtime id/getURL, i18n stub, storage.local
// over localStorage (namespaced by extension id). Returns a JS source string. ──────────────────────
export function chromeShimSource(extId, { origin = "holo://ext/" + extId + "/" } = {}) {
  const id = JSON.stringify(extId), base = JSON.stringify(origin);
  return `(function(){if(typeof window==="undefined")return;var ID=${id},BASE=${base};` +
    `function store(area){var K="holo.ext."+ID+"."+area;function read(){try{return JSON.parse(localStorage.getItem(K))||{}}catch(e){return{}}}` +
    `function write(o){try{localStorage.setItem(K,JSON.stringify(o))}catch(e){}}` +
    `return{get:function(keys,cb){var o=read(),r={};if(keys==null)r=o;else if(typeof keys==="string")r[keys]=o[keys];` +
    `else if(Array.isArray(keys))keys.forEach(function(k){r[k]=o[k]});else Object.keys(keys).forEach(function(k){r[k]=k in o?o[k]:keys[k]});` +
    `if(cb){cb(r);return}return Promise.resolve(r)},` +
    `set:function(items,cb){var o=read();Object.keys(items||{}).forEach(function(k){o[k]=items[k]});write(o);if(cb){cb();return}return Promise.resolve()},` +
    `remove:function(keys,cb){var o=read();(Array.isArray(keys)?keys:[keys]).forEach(function(k){delete o[k]});write(o);if(cb){cb();return}return Promise.resolve()}}}` +
    `var api={runtime:{id:ID,getURL:function(p){return BASE+String(p||"").replace(/^\\//,"")},getManifest:function(){return{}},` +
    `onMessage:{addListener:function(){},removeListener:function(){}},sendMessage:function(){return Promise.resolve()}},` +
    `i18n:{getMessage:function(k){return""},getUILanguage:function(){return navigator.language||"en"}},` +
    `storage:{local:store("local"),sync:store("sync")}};` +
    `if(!window.chrome)window.chrome=api;else{for(var k in api)if(!window.chrome[k])window.chrome[k]=api[k]}` +
    `if(!window.browser)window.browser=window.chrome;})();\n`;
}

// ── render the matching content scripts as injectable HTML (the loading seam calls this) ─────────
// Returns { head, tail }: document_start scripts + all css → injected at <head> open; document_end/
// idle scripts → injected before </body>. Each script is prefixed with the page-world chrome.* shim.
// This is the EXACT projection browser-sw.js splices into served HTML — exported (not duplicated in
// the SW) so content-script injection is a deterministic, witnessed claim, not SW-internal logic.
export function contentScriptTags(contentScripts, url) {
  let head = "", tail = "";
  const esc = (s, tag) => String(s).replace(new RegExp("</" + tag, "gi"), "<\\/" + tag);
  for (const cs of contentScripts || []) {
    try {
      if (!matchesAny(cs.matches, url)) continue;
      if (matchesAny(cs.excludeMatches || cs.exclude_matches, url)) continue;
    } catch { continue; }
    const css = (cs.css || []).map((c) => `<style data-holo-ext="${cs.extId}">${esc(c, "style")}</style>`).join("");
    const js = (cs.js || []).map((j) => `<script data-holo-ext="${cs.extId}">${chromeShimSource(cs.extId)}${esc(j, "script")}</script>`).join("");
    if ((cs.runAt || cs.run_at) === "document_start") head += css + js; else { head += css; tail += js; }
  }
  return { head, tail };
}

// ── selfTest — KATs + a build→install→enforce round-trip. Proves the invariants the witness asserts.
export async function selfTest() {
  const checks = []; const ok = (c, m) => { checks.push({ ok: !!c, msg: m }); return !!c; };
  // match-pattern KATs (the content-script gate).
  ok(matchPattern("*://*/*", "https://x.test/a") && matchPattern("*://*/*", "http://y.test/"), "match *://*/* matches http+https");
  ok(!matchPattern("*://*/*", "file:///etc/passwd"), "match *://*/* does NOT match file://");
  ok(matchPattern("https://*.example.com/*", "https://a.example.com/p") && matchPattern("https://*.example.com/*", "https://example.com/"), "match *.example.com covers host + subdomains");
  ok(!matchPattern("https://*.example.com/*", "https://evil.com/"), "match *.example.com rejects an unrelated host");
  ok(matchPattern("https://example.com/foo*", "https://example.com/foobar") && !matchPattern("https://example.com/foo*", "https://example.com/bar"), "match path glob honours the prefix");
  ok(matchPattern("<all_urls>", "http://x/") && matchPattern("<all_urls>", "https://x/") && matchPattern("<all_urls>", "holo://" + "a".repeat(64)) && matchPattern("<all_urls>", "ipfs://bafy") && !matchPattern("<all_urls>", "chrome://x/"), "match <all_urls> spans the web + content-addressed schemes (holo/ipfs), not chrome://");

  if (globalThis.crypto?.subtle) {
    const { buildCrx3 } = await import("./holo-crx.js");
    const manifest = {
      manifest_version: 3, name: "Holo Test Adblock", version: "1.2",
      permissions: ["declarativeNetRequest", "storage"], host_permissions: ["<all_urls>"],
      action: { default_title: "Holo" },
      declarative_net_request: { rule_resources: [{ id: "ruleset_1", enabled: true, path: "rules.json" }] },
      content_scripts: [{ matches: ["*://*/*"], js: ["cs.js"], css: ["cs.css"], run_at: "document_idle" }],
    };
    const rules = [{ id: 1, priority: 1, action: { type: "block" }, condition: { urlFilter: "||ads.example.com^", resourceTypes: ["script", "image", "sub_frame"] } }];
    const { crx, kappa, extensionId } = await buildCrx3({
      "manifest.json": JSON.stringify(manifest), "rules.json": JSON.stringify(rules),
      "cs.js": "document.documentElement.setAttribute('data-holo-ext','active')", "cs.css": "html{filter:none}",
    });

    const mgr = new ExtensionManager();
    const rec = await mgr.install(crx, { expectedKappa: kappa });
    ok(rec.kappa === kappa && rec.id === extensionId, "install: κ re-derives + extension id derives from the publisher key (Law L5)");
    ok(rec.signatureOk === true && rec.analysis.verdict === "runs-in-tab", "install: publisher signature valid + analyzeManifest says runs-in-tab");

    const compiled = mgr.compiledDnr();
    ok(compiled.length === 1 && compiled[0].extId === extensionId, "compiledDnr: the enabled ruleset is read out of the CRX + attributed to the extension");
    ok(mgr.matchRequest("https://ads.example.com/track.js", "script").type === "block", "matchRequest: a tracker script is BLOCKED by the DNR rule");
    ok(mgr.matchRequest("https://site.test/app.js", "script").type === "allow", "matchRequest: an unrelated script is allowed");
    ok(mgr.matchRequest("https://ads.example.com/track.js", "stylesheet").type === "allow", "matchRequest: resourceTypes constraint is honoured (css not blocked)");

    const cs = mgr.contentScriptsFor("https://any.test/page", "document_idle");
    ok(cs.length === 1 && /data-holo-ext/.test(cs[0].js[0]) && cs[0].css[0].includes("filter"), "contentScriptsFor: the matching script + css are returned as text");
    ok(mgr.contentScriptsFor("https://any.test/page", "document_start").length === 0, "contentScriptsFor: run_at filter excludes a document_idle script");

    const bundle = mgr.seamBundle();
    ok(bundle.dnr.length === 1 && bundle.contentScripts.length === 1 && typeof bundle.contentScripts[0].js[0] === "string", "seamBundle: a serializable projection for the SW seam (compiled rules + script text)");

    // contentScriptTags — the exact HTML the loading seam injects (matching page → script+css, miss → empty).
    const tags = contentScriptTags(bundle.contentScripts, "https://any.test/p");
    ok(/<script data-holo-ext=/.test(tags.tail) && /data-holo-ext/.test(tags.tail) && /<style data-holo-ext=/.test(tags.head) && /window\.chrome/.test(tags.tail), "contentScriptTags: a matching page gets the content script (with chrome shim) in tail + css in head");
    const tagsMiss = contentScriptTags(bundle.contentScripts, "ftp://x.test/");
    ok(tagsMiss.head === "" && tagsMiss.tail === "", "contentScriptTags: a non-matching URL injects nothing");
    const startTags = contentScriptTags([{ extId: "e", matches: ["*://*/*"], runAt: "document_start", js: ["x=1"], css: [] }], "https://s.test/");
    ok(/<script data-holo-ext/.test(startTags.head) && startTags.tail === "", "contentScriptTags: document_start scripts inject into head, not tail");
    const holoTags = contentScriptTags([{ extId: "e", matches: ["<all_urls>"], runAt: "document_idle", js: ["/*cs*/"], css: [] }], "holo://" + "a".repeat(64));
    ok(/<script data-holo-ext/.test(holoTags.tail), "contentScriptTags: an <all_urls> content script injects into a holo://κ page (κ verifies the source, the script transforms the view)");

    mgr.setEnabled(extensionId, false);
    ok(mgr.compiledDnr().length === 0 && mgr.contentScriptsFor("https://any.test/", "document_idle").length === 0, "disable: a disabled extension contributes no rules and injects nothing");
    mgr.setEnabled(extensionId, true);

    // Law L5 tamper-refusal: flip a byte → install must REFUSE (κ and/or signature fail).
    const tampered = crx.slice(); tampered[tampered.length - 6] ^= 1;
    let refused = false; try { await new ExtensionManager().install(tampered, { expectedKappa: kappa }); } catch { refused = true; }
    ok(refused, "install REFUSES a tampered CRX (Law L5 — bytes that don't re-derive don't run)");

    // chrome shim prelude is syntactically valid JS and namespaces by id.
    const shim = chromeShimSource(extensionId);
    ok(/window\.chrome/.test(shim) && shim.includes(extensionId), "chromeShimSource emits a page-world chrome.* subset namespaced by the extension id");
    ok((() => { try { new Function(shim); return true; } catch { return false; } })(), "chromeShimSource is syntactically valid JS");
  }
  return { ok: checks.every((c) => c.ok), checks };
}
