// holo-egress-bridge.mjs — the PAGE side of the SW↔page egress delegation. A Service Worker can't reach the
// egress extension (chrome.runtime is a window API), so it delegates to a controlled page running this bridge:
// the SW posts { type:"holo-egress:fetch", url } with a transferred MessagePort; the page runs egressFetch and
// streams the chunks straight back over that port (head → chunk{bytes} → end / error). The SW assembles a
// ReadableStream from those messages (holo-egress-sw.mjs). Zero copy on chunks (the ArrayBuffer is transferred).

import { egressFetch, egressAvailable } from "./holo-egress-client.mjs";

// installEgressBridge() — call once on a page that can reach the egress extension (the operator origin in the
// extension's externally_connectable). Returns true if installed (egress available), false otherwise.
export function installEgressBridge({ sw = (typeof navigator !== "undefined" ? navigator.serviceWorker : null) } = {}) {
  if (!sw || !egressAvailable()) return false;
  sw.addEventListener("message", async (ev) => {
    const d = ev.data; if (!d || d.type !== "holo-egress:fetch") return;
    const port = ev.ports && ev.ports[0]; if (!port) return;
    try {
      const res = await egressFetch(d.url, { headers: d.headers || {} });
      port.postMessage({ type: "head", status: res.status, contentType: res.contentType });
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        const u = value instanceof Uint8Array ? value : new Uint8Array(value);
        try { port.postMessage({ type: "chunk", bytes: u }, [u.buffer]); }   // transfer → zero copy
        catch { port.postMessage({ type: "chunk", bytes: u }); }
      }
      port.postMessage({ type: "end" });
    } catch (e) { try { port.postMessage({ type: "error", error: String((e && e.message) || e) }); } catch {} }
    finally { try { port.close(); } catch {} }
  });
  // tell the controlling SW a page can now egress (so it prefers this over the dev proxy)
  try { sw.controller && sw.controller.postMessage({ type: "holo-egress:available" }); } catch {}
  return true;
}

export default { installEgressBridge };
