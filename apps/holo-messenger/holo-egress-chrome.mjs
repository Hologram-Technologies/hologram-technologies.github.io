// HOLO EGRESS — browser-grade egress for the `/web?url=` dumb pipe.
//
// The Node `fetch` egress in holo-web-route.mjs works, but a server-side fetch is
// fingerprintable (Node undici TLS/JA3, not Chrome), cookie-poor (RAM jar, no persistence),
// and cannot execute JS. Sites that demand a real browser degrade: Google /search is
// JS-walled (no-JS search retired; a proof-of-JS interstitial redeems a one-shot sg_ss token),
// Cloudflare "checking your browser" pages never clear, and logins never stick.
//
// This answers the SAME contract from a REAL, dedicated headless Chromium, driven over CDP:
//   egressRender(url)  → navigates a real tab, lets JS run, auto-rejects consent, waits for the
//                        navigation to settle, and returns the RENDERED outerHTML.
// The seam is unchanged: browser-sw.js still mints + re-derives (Law L5) whatever bytes we
// return; this only changes WHO answers the pipe (the header comment in holo-web-route.mjs
// anticipated exactly this — "only *who* answers changes, not the browser").
//
// Persistent profile dir ⇒ durable cookies: the consent-reject below is saved ONCE (SOCS
// cookie) and every later request skips the wall. That same persistence is the T3 foundation
// (one profile per operator ⇒ logins survive). Set HOLO_EGRESS_PROFILE to key it per operator.
//
// Fail-OPEN throughout: if Chrome can't be found/spawned or CDP misbehaves, every entry point
// returns null and the caller falls back to the Node path — this can only ADD reach, never
// regress it.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";

const BASE_PORT = Number(process.env.HOLO_EGRESS_CDP || 9356);   // distinct from host :9333 / look :9334
// One PROFILE ROOT holds one sub-profile per operator. Keying by the operator κ (TEE login)
// makes site logins + cookies BOTH persistent (survive restarts) AND isolated (operator A's
// Google session never bleeds into operator B's). HOLO_EGRESS_PROFILE overrides the root.
const PROFILE_ROOT = process.env.HOLO_EGRESS_PROFILE || join(os.tmpdir(), "holo-egress");
const MAX_TABS = Number(process.env.HOLO_EGRESS_MAX_TABS || 4);

// operator κ → a short, filesystem-safe, stable key. A missing/guest operator shares one
// "anon" context (no identity to bind to — still persistent, just not per-person).
function opKey(operator) {
  if (!operator || typeof operator !== "string") return "anon";
  return "op-" + createHash("sha256").update(operator).digest("hex").slice(0, 16);
}
// A normal Chrome UA (headless Chrome otherwise leaks "HeadlessChrome/…", an instant bot tell).
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.HOLO_CHROME && existsSync(process.env.HOLO_CHROME)) return process.env.HOLO_CHROME;
  const c = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    join(os.homedir(), "AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  return c.find((p) => { try { return existsSync(p); } catch { return false; } }) || null;
}

// ── consent auto-reject, injected at document-start into EVERY document/frame of the egress
// tab (Page.addScriptToEvaluateOnNewDocument). Same intent as browser-sw.js's page guard, but
// here it runs in a REAL browser so the reject POST lands in a persistent cookie store and the
// wall never returns. Self-disarms after 8s. ──
const CONSENT_REJECT = `(function(){
  try{
    var STRONG=/^(reject all|refuse all|deny all|decline all|reject non-essential|alle ablehnen|tout refuser|rechazar todo|rifiuta tutti|отклонить все|alles afwijzen)$/i;
    var WEAK=/^(reject|decline|deny|disagree|only (necessary|essential|required)( cookies)?|necessary (cookies )?only|continue without (accepting|agreeing))$/i;
    var SEL="#onetrust-reject-all-handler,.ot-pc-refuse-all-handler,#CybotCookiebotDialogBodyButtonDecline,.cc-deny,button[aria-label*='Reject all' i]";
    var done=false;
    function scented(el){var n=el,d=0;while(n&&n.getAttribute&&d++<10){var s=((n.id||'')+' '+(n.getAttribute('class')||'')+' '+(n.getAttribute('aria-label')||'')).toLowerCase();if(/cookie|consent|gdpr|privacy|\\bcmp\\b|onetrust|didomi|cookiebot|usercentrics|truste/.test(s))return true;n=n.parentElement;}return false;}
    function pass(){
      if(done)return;
      var b=null;try{b=document.querySelector(SEL);}catch(e){}
      if(!b){var cs=document.querySelectorAll("button,[role=button],input[type=submit],input[type=button],a,div[jsname]");
        for(var i=0;i<cs.length&&i<800;i++){var t=(cs[i].innerText||cs[i].value||cs[i].getAttribute&&cs[i].getAttribute('aria-label')||'').trim().replace(/\\s+/g,' ');
          if(t&&t.length<48&&(STRONG.test(t)||(WEAK.test(t)&&scented(cs[i])))){b=cs[i];break;}}}
      if(b){done=true;try{b.click();}catch(e){}}
    }
    if(document.readyState!=='loading')pass();else document.addEventListener('DOMContentLoaded',pass);
    var iv=setInterval(pass,300);
    try{var mo=new MutationObserver(pass);mo.observe(document.documentElement,{childList:true,subtree:true});}catch(e){}
    setTimeout(function(){clearInterval(iv);try{mo.disconnect();}catch(e){}},8000);
  }catch(e){}
})();`;

// ── cosmetic AD STRIP — the half network blocking can't do. holo-shield's DNR stops the ad BYTES,
// but the reserved ad SLOT (the "Advertisement" box) stays, leaving an empty gap. This REMOVES the
// ad elements (so the layout collapses — not display:none, actual removal) and drops ad scripts,
// run in the real egress Chrome BEFORE outerHTML capture. The bytes we mint into the κ never carry
// the ad markup at all → less to hash, stream, and render, and no empty space reaches the client.
// High-precision selectors (EasyList-generic style; exact class tokens + id/data prefixes, no bare
// "ad" substring that would eat "header/gradient/download"). Also exported as window.__holoStripAds
// for a final synchronous sweep just before capture. Self-disarms after 10s.
const AD_STRIP_FN = `function holoStripAds(doc, stripScripts){
  try{
    var SEL="ins.adsbygoogle,.adsbygoogle,[id^='google_ads_'],[id^='div-gpt-ad'],[id^='ad-'],[id^='ad_'],[id*='-ad-'],[id*='_ad_'],[id$='-ad'],[id$='-ads'],[id*='dfp-ad'],[id^='taboola'],[id^='outbrain'],.ad,.ads,.advert,.advertisement,.advertising,.ad-slot,.ad-slots,.ad-unit,.ad-container,.ad-wrapper,.ad-banner,.ad-placeholder,.adslot,.ad-holder,.google-ad,.dfp-ad,.sponsored-content,[class^='ad-'],[class*=' ad-'],[class$='-ad'],[class$='-ads'],[class*='-ad-'],[class*='_ad_'],[class*='ad-slot'],[class*='AdSlot'],[class*='adBanner'],[data-ad-slot],[data-ad-client],[data-adunit],[data-ad-unit],[data-google-query-id],[data-ad],[aria-label='Advertisement' i],iframe[src*='doubleclick'],iframe[src*='googlesyndication'],iframe[src*='adservice'],iframe[src*='/ads/'],iframe[src*='taboola'],iframe[src*='outbrain'],iframe[src*='amazon-adsystem'],iframe[id*='google_ads'],iframe[title='Advertisement' i],iframe[aria-label*='advert' i],gpt-ad,amp-ad,amp-embed";
    if(!doc.getElementById('holo-ad-hide')){var st=doc.createElement('style');st.id='holo-ad-hide';
      st.textContent=SEL+"{display:none!important;height:0!important;min-height:0!important;} [class*='ad-slot'],[class*='ad-container'],[class*='ad-wrapper'],[class*='adWrapper'],[id^='div-gpt-ad']{min-height:0!important;height:auto!important;}";
      (doc.head||doc.documentElement).appendChild(st);}
    var n=0,els;try{els=doc.querySelectorAll(SEL);}catch(e){els=[];}
    for(var i=0;i<els.length;i++){try{els[i].remove();n++;}catch(e){}}
    // "Advertisement"/"Sponsored" caption labels that sit ABOVE a slot (leaf text nodes)
    try{var lab=doc.querySelectorAll("p,span,div,small,h6,label,figcaption,aside");
      for(var j=0;j<lab.length&&j<4000;j++){var t=(lab[j].textContent||'').trim().toLowerCase();
        if((t==='advertisement'||t==='advertisements'||t==='sponsored'||t==='sponsored content')&&lab[j].children.length===0){try{lab[j].remove();n++;}catch(e){}}}}catch(e){}
    if(stripScripts){try{var sc=doc.querySelectorAll("script[src*='doubleclick'],script[src*='googlesyndication'],script[src*='adsbygoogle'],script[src*='adservice'],script[src*='/ads/'],script[src*='taboola'],script[src*='outbrain'],script[src*='amazon-adsystem'],script[src*='googletagservices'],script[src*='adnxs']");
      for(var k=0;k<sc.length;k++){try{sc[k].remove();}catch(e){}}}catch(e){}}
    return n;
  }catch(e){return 0;}
}`;
const AD_STRIP = `(function(){ ${AD_STRIP_FN}
  try{
    window.__holoStripAds=holoStripAds;
    var run=function(){holoStripAds(document,false);};
    if(document.readyState!=='loading')run();else document.addEventListener('DOMContentLoaded',run);
    var iv=setInterval(run,400);
    try{var mo=new MutationObserver(run);mo.observe(document.documentElement,{childList:true,subtree:true});}catch(e){}
    setTimeout(function(){clearInterval(iv);try{mo.disconnect();}catch(e){}},10000);
  }catch(e){}
})();`;

// A rendered block/challenge page is not the site — detect the common ones so the caller falls
// back honestly (Google /sorry reCAPTCHA, Cloudflare "Just a moment", generic "unusual traffic").
function looksBlocked(html, finalUrl) {
  try { if (/\/sorry\/|\/recaptcha\/|__cf_chl|\/cdn-cgi\/challenge/i.test(finalUrl)) return true; } catch {}
  const head = String(html).slice(0, 4000);
  return /our systems have detected unusual traffic|before you continue to google|id="recaptcha|please (show you'?re|verify you are) (a )?human|Just a moment\.\.\.|Attention Required! \| Cloudflare|Checking your browser before/i.test(head);
}

// ── CDP plumbing — ONE headless Chrome PER OPERATOR (own profile + own port) ──────────────────
const _instances = new Map();   // opKey → { proc, port, profile } (a live/adopted browser)
const _starting = new Map();    // opKey → Promise (spawn-in-flight guard, prevents double spawn)

async function cdpVersion(port) {
  try { const c = new AbortController(); const t = setTimeout(() => c.abort(), 1500);
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: c.signal }); clearTimeout(t); return await r.json(); }
  catch { return null; }
}
function portFree(port) {
  return new Promise((res) => {
    // free ⇔ nothing answers the CDP probe; good enough (we only ever bind localhost CDP here).
    cdpVersion(port).then((v) => res(!v));
  });
}
// The port a profile last used, remembered in a sidecar so a dev-server restart RE-ADOPTS the
// still-running egress Chrome (a persistent profile can only be opened by one instance; adopting
// avoids a profile-lock spawn failure).
const portFile = (profile) => join(profile, ".holo-egress-port");
function rememberPort(profile, port) { try { mkdirSync(profile, { recursive: true }); writeFileSync(portFile(profile), String(port)); } catch {} }
function recallPort(profile) { try { return Number(readFileSync(portFile(profile), "utf8")) || 0; } catch { return 0; } }

async function ensureBrowser(operator) {
  const key = opKey(operator);
  const live = _instances.get(key);
  if (live) return live;
  if (_starting.has(key)) return _starting.get(key);
  const p = (async () => {
    const profile = key === "anon" ? join(PROFILE_ROOT, "anon") : join(PROFILE_ROOT, key);

    // 1 · adopt a still-running egress Chrome for THIS profile (sidecar port), if any.
    const prior = recallPort(profile);
    if (prior) { const v = await cdpVersion(prior); if (v) { const inst = { proc: null, port: prior, profile }; _instances.set(key, inst); return inst; } }

    // 2 · else spawn a fresh one on the next free port from the base.
    const bin = findChrome();
    if (!bin) return null;
    let port = 0;
    for (let cand = BASE_PORT; cand < BASE_PORT + 128; cand++) {
      // skip ports already owned by our own instances this session
      if ([..._instances.values()].some((i) => i.port === cand)) continue;
      if (await portFree(cand)) { port = cand; break; }
    }
    if (!port) return null;
    const args = [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
      `--remote-debugging-port=${port}`, "--remote-allow-origins=*",
      `--user-data-dir=${profile}`,
      "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
      "--disable-features=Translate,MediaRouter,OptimizationHints",
      "--disable-extensions", "--window-size=1280,900", "--lang=en-US",
      "about:blank",
    ];
    let proc;
    try { proc = spawn(bin, args, { stdio: "ignore", windowsHide: true }); }
    catch { return null; }
    proc.on("exit", () => { if (_instances.get(key) && _instances.get(key).proc === proc) _instances.delete(key); });
    let v = null;
    for (let i = 0; i < 40; i++) { v = await cdpVersion(port); if (v) break; await sleep(250); }
    if (!v) { try { proc.kill(); } catch {} return null; }
    rememberPort(profile, port);
    const inst = { proc, port, profile };
    await warmup(inst);   // prime the renderer so the FIRST real render doesn't settle-timeout on a cold browser
    _instances.set(key, inst);
    return inst;
  })();
  _starting.set(key, p);
  try { return await p; } finally { _starting.delete(key); }
}

function cdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map(); const listeners = new Set();
  ws.addEventListener("message", (m) => {
    let msg; try { msg = JSON.parse(m.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) { for (const l of listeners) try { l(msg); } catch {} }
  });
  const ready = new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const send = (method, params, timeoutMs = 15000) => new Promise((resolve) => {
    const myId = ++id; pending.set(myId, (m) => resolve(m.result !== undefined ? m.result : m));
    try { ws.send(JSON.stringify({ id: myId, method, params: params || {} })); }
    catch { pending.delete(myId); resolve({}); return; }
    setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); resolve({}); } }, timeoutMs);
  });
  return { ready, send, on: (fn) => listeners.add(fn), close: () => { try { ws.close(); } catch {} } };
}

async function evalInPage(cli, expression, awaitPromise = false, timeoutMs = 8000) {
  const r = await cli.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }, timeoutMs);
  return r && r.result ? r.result.value : undefined;
}

// ── tab pool (cap concurrency; each render gets a fresh target) ──────────────────────────────
let _active = 0; const _wait = [];
async function acquire() { if (_active < MAX_TABS) { _active++; return; } await new Promise((r) => _wait.push(r)); _active++; }
function release() { _active--; const n = _wait.shift(); if (n) n(); }

async function newTab(br) {
  const created = await fetch(`http://127.0.0.1:${br.port}/json/new`, { method: "PUT" }).then((r) => r.json()).catch(() => null);
  const t = created && created.id ? created : await (async () => {
    // older Chrome: PUT unsupported → GET /json/new
    try { return await (await fetch(`http://127.0.0.1:${br.port}/json/new`)).json(); } catch { return null; }
  })();
  if (!t || !t.webSocketDebuggerUrl) return null;
  return t;
}
async function closeTab(br, targetId) { try { await fetch(`http://127.0.0.1:${br.port}/json/close/${targetId}`); } catch {} }

// Prime a freshly-spawned browser: the FIRST navigation brings up the renderer/GPU process and
// is slow; a throwaway about:blank load pays that cost ONCE, so the first real render settles fast.
async function warmup(br) {
  let t = null, cli = null;
  try {
    t = await newTab(br); if (!t) { await sleep(600); return; }
    cli = cdpClient(t.webSocketDebuggerUrl); await cli.ready;
    await cli.send("Page.enable");
    await cli.send("Page.navigate", { url: "about:blank" }, 6000);
    for (let i = 0; i < 12; i++) { const rs = await evalInPage(cli, "document.readyState", false, 2000); if (rs === "complete" || rs === "interactive") break; await sleep(250); }
  } catch { await sleep(600); }
  finally { try { if (cli) cli.close(); } catch {} try { if (t && t.id) await closeTab(br, t.id); } catch {} }
}

/**
 * Render a live document in a real headless Chrome and return its settled outerHTML.
 * @param {string} url
 * @param {{timeoutMs?:number, operator?:string}} opts  operator κ → a per-identity Chrome
 *   (own persistent profile + port), so site logins persist and never cross operators.
 * @returns {Promise<null | {status:number, contentType:string, buffer:Buffer, finalUrl:string}>}
 */
export async function egressRender(url, { timeoutMs = 22000, operator } = {}) {
  let t;
  const parsed = (() => { try { return new URL(url); } catch { return null; } })();
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) return null;
  const br = await ensureBrowser(operator);
  if (!br) return null;
  await acquire();
  try {
    // Up to 3 attempts: a cold/contended Chrome's render can settle-timeout or lose a /json/new
    // race; a warm retry is reliable. `terminal` failures (dead host, blocked page) never retry.
    let out = await _renderOnce(br, url, timeoutMs);
    for (let i = 0; i < 2 && out.retry; i++) { await sleep(400); out = await _renderOnce(br, url, timeoutMs); }
    return out.data || null;
  } finally { release(); }
}

// One render attempt. Returns { data } on success, { retry:true } on a transient/cold-start miss,
// or {} on a terminal miss (nav error / blocked / dead) that must NOT be retried.
async function _renderOnce(br, url, timeoutMs) {
  let t = null, cli = null;
  try {
    t = await newTab(br);
    if (!t) return { retry: true };
    cli = cdpClient(t.webSocketDebuggerUrl);
    await cli.ready;
    await cli.send("Page.enable");
    await cli.send("Runtime.enable");
    await cli.send("Network.enable");
    await cli.send("Network.setUserAgentOverride", { userAgent: UA, acceptLanguage: "en-US,en;q=0.9", platform: "Windows" });
    await cli.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cli.send("Page.addScriptToEvaluateOnNewDocument", { source: CONSENT_REJECT });
    await cli.send("Page.addScriptToEvaluateOnNewDocument", { source: AD_STRIP });

    const nav = await cli.send("Page.navigate", { url }, timeoutMs);
    if (nav && nav.errorText) return {};   // ERR_NAME_NOT_RESOLVED etc. → terminal, let Node report honestly

    // Settle: poll until the document is complete, off any consent host, and its URL is stable
    // for ~1s (the consent reject + sg_ss redemption both resolve as real navigations here).
    const deadline = Date.now() + timeoutMs;
    let prev = "", stable = 0, sawComplete = false;
    while (Date.now() < deadline) {
      await sleep(500);
      const raw = await evalInPage(cli, `JSON.stringify({href:location.href,host:location.hostname,rs:document.readyState})`, false, 4000);
      let s; try { s = JSON.parse(raw); } catch { continue; }
      const onConsent = /(^|\.)consent\.|(^|\.)cookiepolicy|consent\.google\./i.test(s.host || "");
      if (s.rs === "complete" && !onConsent) {
        sawComplete = true;
        if (s.href === prev) stable++; else { stable = 0; prev = s.href; }
        if (stable >= 2) break;
      } else { stable = 0; prev = s.href; }
    }
    if (!sawComplete) return { retry: true };   // settle-timeout — usually a cold renderer; retry warm

    // Small extra beat so late-painting results (Google injects <h3>s post-load) are captured.
    await sleep(600);
    // Final ad sweep in the real Chrome BEFORE serialization — remove ad nodes AND ad scripts so
    // the captured bytes (the κ we mint + stream) carry no ad markup and leave no reserved gap.
    try { await evalInPage(cli, `(function(){ ${AD_STRIP_FN} return holoStripAds(document, true); })()`, false, 5000); } catch {}
    const html = await evalInPage(cli, "document.documentElement.outerHTML", false, 8000);
    const finalUrl = await evalInPage(cli, "location.href", false, 3000) || url;
    if (typeof html !== "string" || html.length < 64) return { retry: true };
    // A real Chrome still can't pass an IP-level block / interactive CAPTCHA / CF challenge — a
    // rendered "sorry" page is a dead end (terminal), so let the caller fall back (DuckDuckGo html).
    if (looksBlocked(html, finalUrl)) return {};
    return { data: { status: 200, contentType: "text/html; charset=utf-8", buffer: Buffer.from("<!doctype html>\n" + html), finalUrl } };
  } catch {
    return { retry: true };
  } finally {
    try { if (cli) cli.close(); } catch {}
    try { if (t && t.id) await closeTab(br, t.id); } catch {}
  }
}

// ── authenticated fetch — a subresource / XHR carried by the OPERATOR'S session ──────────────
// egressRender runs the top document as the operator; but the page's subresources and API/XHR
// calls must ALSO carry that operator's cookies or an authenticated page renders logged-out (its
// data XHRs 401). This fetches a URL through the operator's Chrome so its jar applies — the login
// we persist becomes VISIBLE. Uses a per-origin warm tab (navigated first-party to the origin, so
// SameSite cookies count) + an in-page credentialed fetch. GET only (loadNetworkResource/POST-XHR
// stay on the Node pipe). Returns {status, contentType, headers, buffer} or null (→ Node fallback).
async function ftabFor(br, origin) {
  br._ftabs = br._ftabs || new Map();
  const have = br._ftabs.get(origin);
  if (have) { const v = await cdpVersion(br.port); if (v) return have; br._ftabs.delete(origin); }   // browser died → drop
  let t = null, cli = null;
  try {
    t = await newTab(br); if (!t) return null;
    cli = cdpClient(t.webSocketDebuggerUrl); await cli.ready;
    await cli.send("Page.enable"); await cli.send("Runtime.enable");
    await cli.send("Network.setUserAgentOverride", { userAgent: UA, acceptLanguage: "en-US,en;q=0.9", platform: "Windows" });
    // first-party navigation to the origin root so document.cookie context == the target origin.
    await cli.send("Page.navigate", { url: origin + "/" }, 12000);
    for (let i = 0; i < 20; i++) { const rs = await evalInPage(cli, "document.readyState", false, 2000); if (rs === "complete" || rs === "interactive") break; await sleep(250); }
    const tab = { cli, targetId: t.id };
    br._ftabs.set(origin, tab);
    return tab;
  } catch { try { if (cli) cli.close(); } catch {} try { if (t && t.id) await closeTab(br, t.id); } catch {} return null; }
}

export async function egressFetch(url, { operator, timeoutMs = 15000 } = {}) {
  const parsed = (() => { try { return new URL(url); } catch { return null; } })();
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) return null;
  const br = await ensureBrowser(operator);
  if (!br) return null;
  await acquire();
  try {
    const tab = await ftabFor(br, parsed.origin);
    if (!tab) return null;
    // in-page, first-party, credentialed fetch → the operator's cookies ride along.
    const expr = `(async () => { try {
      const r = await fetch(${JSON.stringify(url)}, { credentials: "include", redirect: "follow" });
      const ab = await r.arrayBuffer(); let b = ""; const u8 = new Uint8Array(ab);
      for (let i = 0; i < u8.length; i += 0x8000) b += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return JSON.stringify({ ok: true, status: r.status, ct: r.headers.get("content-type") || "", b64: btoa(b) });
    } catch (e) { return JSON.stringify({ ok: false, err: String(e && e.message || e) }); } })()`;
    const raw = await evalInPage(tab.cli, expr, true, timeoutMs);
    let j; try { j = JSON.parse(raw); } catch { return null; }
    if (!j || !j.ok) return null;
    return { status: j.status || 200, contentType: j.ct || "application/octet-stream", headers: { "content-type": j.ct || "" }, buffer: Buffer.from(j.b64 || "", "base64") };
  } catch { return null; }
  finally { release(); }
}

// Resolve (spawning if needed) an operator's egress and report where it lives — used by the
// witness to prove isolation. Returns null if Chrome is unavailable.
export async function egressInstance(operator) {
  const br = await ensureBrowser(operator);
  return br ? { key: opKey(operator), port: br.port, profile: br.profile } : null;
}

// Gracefully close an egress Chrome — Browser.close flushes cookies/session state to the
// persistent profile before exit, so the NEXT open re-adopts them (the persistence guarantee).
async function _shutdownInst(inst) {
  // drop cached per-origin fetch tabs (their WebSockets) before closing the browser.
  try { if (inst._ftabs) { for (const tab of inst._ftabs.values()) { try { tab.cli.close(); } catch {} } inst._ftabs.clear(); } } catch {}
  // Ask Chrome to close cleanly — a clean exit is what FLUSHES persistent cookies to the
  // profile's Cookies DB. Do NOT kill first (that loses the flush and, with it, the login).
  try {
    const v = await cdpVersion(inst.port);
    if (v && v.webSocketDebuggerUrl) { const cli = cdpClient(v.webSocketDebuggerUrl); await cli.ready; cli.send("Browser.close", {}, 2000); cli.close(); }
  } catch {}
  if (inst.proc) {
    // wait for the real exit (flush done); hard-kill only as a last resort after 6s.
    await new Promise((res) => { let done = false; const fin = () => { if (!done) { done = true; res(); } };
      inst.proc.once("exit", fin); setTimeout(() => { try { inst.proc.kill(); } catch {} fin(); }, 6000); });
  } else {
    // adopted instance (no child handle) — poll until the CDP endpoint is gone.
    for (let i = 0; i < 24; i++) { if (!(await cdpVersion(inst.port))) break; await sleep(300); }
  }
}
export async function egressShutdown(operator) {
  const key = opKey(operator);
  const inst = _instances.get(key);
  if (!inst) return false;
  _instances.delete(key);
  await _shutdownInst(inst);
  return true;
}
export async function egressShutdownAll() {
  for (const key of [..._instances.keys()]) { const inst = _instances.get(key); _instances.delete(key); await _shutdownInst(inst); }
}

export function egressConfig() { return { basePort: BASE_PORT, profileRoot: PROFILE_ROOT, chrome: findChrome() }; }
