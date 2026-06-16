// holo-egress-sw.mjs — the SERVICE-WORKER side of the SW↔page egress delegation. A SW can't reach the
// egress extension (chrome.runtime is a window API), so it asks a controlled PAGE (running
// holo-egress-bridge.mjs) to fetch on its behalf and stream the bytes back. requestPageEgress() returns a
// streaming Response-like { ok, status, contentType, body:ReadableStream<Uint8Array> } — a drop-in for a
// proxy fetch in browser-sw.js (serveWeb/serveSub) or the IPFS gateway, with NO server and CORS-free.
//
// `clients` is injected (the SW global) so this is pure + Node-testable. A client that lacks the bridge never
// replies → it times out and we move on / fall back to the dev proxy. First client that answers wins.

// requestPageEgress(url, { clients, headers, timeoutMs, pickProbeMs }) → Response-like | null
export async function requestPageEgress(url, { clients, headers = {}, timeoutMs = 20000 } = {}) {
  if (!clients || !clients.matchAll) return null;
  const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of wins) {
    const res = await tryClient(client, url, headers, timeoutMs);
    if (res) return res;                 // first page that can egress wins
  }
  return null;                            // no page could egress → caller falls back (dev proxy / gateways)
}

// streamFromPort(port, settle, timeoutMs) — build a ReadableStream from the bridge's head/chunk/end protocol.
// Resolves the Response-like on `head` (so the caller streams immediately); pure, exported for the witness.
export function makeEgressResponse() {
  let ctrl = null;
  const body = new ReadableStream({ start(c) { ctrl = c; } });
  return { body, enqueue: (u) => { try { ctrl && ctrl.enqueue(u); } catch {} }, close: () => { try { ctrl && ctrl.close(); } catch {} }, error: (e) => { try { ctrl && ctrl.error(e); } catch {} } };
}

function tryClient(client, url, headers, timeoutMs) {
  return new Promise((resolve) => {
    let mc; try { mc = new MessageChannel(); } catch { return resolve(null); }
    const sink = makeEgressResponse();
    let settled = false, head = null;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const to = setTimeout(() => { done(null); try { mc.port1.close(); } catch {} }, timeoutMs);
    mc.port1.onmessage = (ev) => {
      const m = ev.data; if (!m) return;
      if (m.type === "head") { clearTimeout(to); head = { ok: m.status >= 200 && m.status < 400, status: m.status || 0, contentType: m.contentType || "", body: sink.body }; done(head); }
      else if (m.type === "chunk") { sink.enqueue(m.bytes instanceof Uint8Array ? m.bytes : new Uint8Array(m.bytes)); }
      else if (m.type === "end") { sink.close(); clearTimeout(to); done(head || { ok: true, status: 200, contentType: "", body: sink.body }); try { mc.port1.close(); } catch {} }
      else if (m.type === "error") { sink.error(new Error(m.error || "egress error")); clearTimeout(to); done(null); try { mc.port1.close(); } catch {} }
    };
    try { client.postMessage({ type: "holo-egress:fetch", url, headers }, [mc.port2]); }
    catch { clearTimeout(to); done(null); }
  });
}

export default { requestPageEgress, makeEgressResponse };
