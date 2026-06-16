// background.js — Hologram Web Recorder (Spike B). The companion-extension κ-resource-handler, the
// zero-native-binary twin of browser-sw.js / the CEF CefResourceHandler. It attaches the real Chrome
// DevTools Protocol to a tab via chrome.debugger, so the PAGE NAVIGATES ITS REAL ORIGIN in the user's real
// profile — cookies, auth, passkeys, OAuth, WebSockets, the site's own service worker ALL WORK NATIVELY.
// The extension only OBSERVES + MINTS + CACHES:
//   • Fetch (Request stage) → on a GET we've already minted, serve it from the κ-store via Fetch.fulfillRequest
//     (O(1), ZERO network) — content-addressed re-access, deduped across every site.
//   • Network (responseReceived/loadingFinished) → read the body AFTER load (does NOT block the render, so
//     misses stream natively) and mint its BLAKE3 κ (the verified incremental hasher, the substrate σ-axis).
// L1 = in-memory hot map (κ→bytes, O(1)); L2 = IndexedDB (durable). Same tiers, same κ, as the OS substrate.

import { createBlake3 } from "./holo-blake3.js";

const L1 = new Map();        // κ (hex) → Uint8Array — the hot tier
const URLK = new Map();      // url → { kappa, ct, status } — the URL→κ memo (immutable-asset O(1) serve)
const pending = new Map();   // Network requestId → { url, ct, status } (between responseReceived & loadingFinished)
let attachedTab = null;

const stats = { seen: 0, minted: 0, hits: 0, dedup: 0, bytesCache: 0, bytesNet: 0, kobjects: 0, cold: [], warm: [] };

// ── L2: IndexedDB κ-store ───────────────────────────────────────────────────────────
let _db = null;
function db() {
  return _db || (_db = new Promise((res, rej) => { const r = indexedDB.open("holo-web-kstore", 1); r.onupgradeneeded = () => r.result.createObjectStore("k"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
}
async function l2get(k) { const d = await db(); return new Promise((res) => { const t = d.transaction("k").objectStore("k").get(k); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); }); }
async function l2put(k, bytes) { const d = await db(); return new Promise((res) => { const t = d.transaction("k", "readwrite").objectStore("k").put(bytes, k); t.onsuccess = () => res(); t.onerror = () => res(); }); }
async function l2has(k) { const d = await db(); return new Promise((res) => { const t = d.transaction("k").objectStore("k").getKey(k); t.onsuccess = () => res(t.result != null); t.onerror = () => res(false); }); }

async function kGet(k) { const hot = L1.get(k); if (hot) return hot; const b = await l2get(k); if (b) { const u = new Uint8Array(b); L1.set(k, u); return u; } return null; }
async function kPut(k, u) { L1.set(k, u); await l2put(k, u); }

// ── base64 ↔ bytes (the CDP body wire format) ────────────────────────────────────────
const b64ToBytes = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const bytesToB64 = (u) => { let s = "", CH = 0x8000; for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH)); return btoa(s); };
const blakeHex = (u) => { const h = createBlake3(); h.update(u); return h.hex(); };
const median = (a) => a.length ? +(a.slice().sort((x, y) => x - y)[a.length >> 1]).toFixed(2) : 0;
const cacheable = (m, s, ct) => m === "GET" && s === 200 && !/^(text\/event-stream)/i.test(ct || "");   // not SSE

// ── attach / detach ──────────────────────────────────────────────────────────────────
async function attach(tabId) {
  if (attachedTab != null) await detach();
  await chrome.debugger.attach({ tabId }, "1.3");
  attachedTab = tabId;
  await chrome.debugger.sendCommand({ tabId }, "Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  await chrome.debugger.sendCommand({ tabId }, "Network.enable", {});
}
async function detach() { if (attachedTab != null) { const t = attachedTab; attachedTab = null; try { await chrome.debugger.detach({ tabId: t }); } catch {} } }
chrome.debugger.onDetach.addListener((src) => { if (src.tabId === attachedTab) attachedTab = null; });
chrome.tabs.onRemoved.addListener((id) => { if (id === attachedTab) attachedTab = null; });

// ── the CDP event seam ─────────────────────────────────────────────────────────────
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (source.tabId !== attachedTab) return;

  if (method === "Fetch.requestPaused") {
    const { requestId, request, responseStatusCode } = params;
    try {
      // Request stage (no responseStatusCode): a GET we've minted → serve from the κ-store, O(1), no network.
      if (responseStatusCode == null && request.method === "GET") {
        stats.seen++;
        const seen = URLK.get(request.url);
        if (seen) {
          const t0 = performance.now();
          const bytes = await kGet(seen.kappa);
          if (bytes) {
            await chrome.debugger.sendCommand(source, "Fetch.fulfillRequest", {
              requestId, responseCode: seen.status || 200,
              responseHeaders: [
                { name: "content-type", value: seen.ct || "application/octet-stream" },
                { name: "x-holo-cache", value: "L1" }, { name: "x-holo-cid", value: seen.kappa.slice(0, 16) },
                { name: "access-control-allow-origin", value: "*" },
              ],
              body: bytesToB64(bytes),
            });
            stats.hits++; stats.bytesCache += bytes.length; stats.warm.push(performance.now() - t0); push();
            return;
          }
        }
      }
      await chrome.debugger.sendCommand(source, "Fetch.continueRequest", { requestId });   // miss → native (streams)
    } catch { try { await chrome.debugger.sendCommand(source, "Fetch.continueRequest", { requestId }); } catch {} }
  }

  else if (method === "Network.responseReceived") {
    const r = params.response;
    pending.set(params.requestId, { url: r.url, ct: (r.headers && (r.headers["content-type"] || r.headers["Content-Type"])) || r.mimeType, status: r.status });
  }

  else if (method === "Network.loadingFinished") {
    const meta = pending.get(params.requestId); pending.delete(params.requestId);
    if (!meta || URLK.has(meta.url) || !cacheable("GET", meta.status, meta.ct)) return;   // mint cacheable GETs once
    try {
      const t0 = performance.now();
      const body = await chrome.debugger.sendCommand({ tabId: attachedTab }, "Network.getResponseBody", { requestId: params.requestId });
      if (!body) return;
      const bytes = body.base64Encoded ? b64ToBytes(body.body) : new TextEncoder().encode(body.body);
      const kappa = blakeHex(bytes);                          // the mint — verified incremental BLAKE3 (σ-axis)
      if (L1.has(kappa) || await l2has(kappa)) stats.dedup++; // byte-identical to something already minted → ONE κ
      await kPut(kappa, bytes);
      URLK.set(meta.url, { kappa, ct: meta.ct, status: meta.status });
      stats.minted++; stats.bytesNet += bytes.length; stats.kobjects = L1.size; stats.cold.push(performance.now() - t0); push();
    } catch { /* body unavailable (streamed/evicted) — skip; the page already rendered it */ }
  }
});

// ── popup messaging ────────────────────────────────────────────────────────────────
function snapshot() {
  return { attachedTab, seen: stats.seen, minted: stats.minted, hits: stats.hits, dedup: stats.dedup,
    kobjects: L1.size, bytesCache: stats.bytesCache, bytesNet: stats.bytesNet,
    coldMs: median(stats.cold), warmMs: median(stats.warm) };
}
function push() { try { chrome.runtime.sendMessage({ type: "holo-stats", stats: snapshot() }); } catch {} }
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  (async () => {
    if (msg.type === "attach") { try { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); await attach(tab.id); reply({ ok: true, url: tab.url, stats: snapshot() }); } catch (e) { reply({ ok: false, error: String(e.message || e) }); } }
    else if (msg.type === "detach") { await detach(); reply({ ok: true, stats: snapshot() }); }
    else if (msg.type === "getStats") { let url = null; try { if (attachedTab != null) url = (await chrome.tabs.get(attachedTab)).url; } catch {} reply({ ok: true, attachedUrl: url, stats: snapshot() }); }
  })();
  return true;   // async reply
});
