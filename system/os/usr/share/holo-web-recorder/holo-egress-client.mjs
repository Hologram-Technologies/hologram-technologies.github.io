// holo-egress-client.mjs — the page-side client for the holospaces egress extension. `chrome.runtime` is a
// WINDOW api (not a Service Worker), so egress is PAGE-initiated; browser-sw.js delegates to a page that
// imports this. It speaks the VERIFIED routerFetch protocol — a named port "holospaces-content",
// postMessage {type:"fetch",id,url,headers}, replies head{status,contentType}·chunk{bytes}·end·error (each
// echoing id) — and returns a STREAMING Response-like { ok, status, contentType, body:ReadableStream<Uint8Array> }.
// Zero server, CORS-free, no Direct-Sockets flag needed for http(s) (the extension fetches via host_permissions).

const PORT_NAME = "holospaces-content";

// Detection matches holospaces' connector.js: a CAPABILITY test, not a probe. `chrome.runtime` is only
// injected into a page whose origin is in the extension's `externally_connectable` — so this being true
// already means the extension is reachable from here. The extension ID is supplied by the caller (the
// holospaces constant is empty at rest; Chrome assigns the id at load, or a manifest `key` pins it). An
// optional DOM beacon is honoured if present, but the id is normally passed in.
export function egressAvailable() {
  return typeof chrome !== "undefined" && !!(chrome.runtime && chrome.runtime.connect);
}
export function egressExtensionId() {
  try { return (typeof document !== "undefined" && document.documentElement.getAttribute("data-holospaces-egress")) || null; } catch { return null; }
}

// egressFetch(url, opts) → Promise<{ ok, status, contentType, body }>. Resolves as soon as the head arrives;
// the body streams the chunks as the extension relays them. A real Response-like, so callers can mint while
// streaming (incremental BLAKE3) and tee into the κ-store — first byte → first paint, no buffering.
export function egressFetch(url, { headers = {}, extId = egressExtensionId() } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.connect) {
      return reject(new Error("chrome.runtime unavailable — add this origin to the extension's externally_connectable.matches"));
    }
    if (!extId) return reject(new Error("extension id required — load the holospaces egress extension and copy its id from chrome://extensions"));
    let port; try { port = chrome.runtime.connect(extId, { name: PORT_NAME }); } catch (e) { return reject(e); }
    const id = "e" + Math.random().toString(36).slice(2);
    let ctrl = null, settled = false, head = null;
    const body = new ReadableStream({ start(c) { ctrl = c; }, cancel() { try { port.disconnect(); } catch {} } });
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    const fail = (e) => { try { port.disconnect(); } catch {} if (ctrl) { try { ctrl.error(e); } catch {} } if (!settled) { settled = true; reject(e); } };

    port.onMessage.addListener((m) => {
      if (!m || (m.id != null && m.id !== id)) return;
      if (m.type === "head") { head = { ok: (m.status || 0) >= 200 && (m.status || 0) < 400, status: m.status || 0, contentType: m.contentType || "", body }; settle(head); }
      else if (m.type === "chunk") { const u = m.bytes instanceof Uint8Array ? m.bytes : Uint8Array.from(m.bytes); try { ctrl && ctrl.enqueue(u); } catch {} }
      else if (m.type === "end") { try { ctrl && ctrl.close(); } catch {} try { port.disconnect(); } catch {} settle(head || { ok: true, status: 200, contentType: "", body }); }
      else if (m.type === "error") fail(new Error(m.error || "egress error"));
    });
    port.onDisconnect.addListener(() => { if (!settled) fail(new Error("egress port disconnected (origin not in externally_connectable?)")); });
    port.postMessage({ type: "fetch", id, url, headers });
  });
}

export default { egressExtensionId, egressAvailable, egressFetch, PORT_NAME };
