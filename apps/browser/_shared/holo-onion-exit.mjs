// holo-onion-exit.mjs — S1 rung 1: make the DEVICE-MESH exit peer onion-aware.
//
// Produces a `fetchImpl` for serveAsExitPeer (holo-peer-egress.mjs): a `.onion` URL routes through a REAL
// Tor/Arti client running on THIS device (the desktop host, which has egress); everything else falls
// through to the host's own /web — the exact default the exit peer already uses. So the phone browsing on
// the serverless bundle reaches the onion web through the owner's desktop, over the SAME mesh, dialed by κ.
//
// TRUST is unchanged: bytes are still minted + re-derived against their κ by browser-sw (Law L5); the peer
// is untrusted transport. What onion adds: the first hop for a .onion is a Tor circuit, and because a v3
// .onion IS its ed25519 pubkey (self-authenticating), the Arti client verifies the service END-TO-END —
// no gateway is trusted for authenticity. The privacy signal travels as response headers so the UI can
// show the truth of the route in one calm glance (x-holo-onion, x-holo-onion-verified).
//
// Detection reuses the ONE onion source of truth — holo-dweb.js `onionHost` — so classify() and the exit
// peer can never disagree about what an onion is.

import { onionHost } from "./holo-dweb.js";

const ONION_V3_RE = /^[a-z2-7]{56}\.onion$/i;
const ONION_V2_RE = /^[a-z2-7]{16}\.onion$/i;

export function isOnionUrl(url) {
  const h = onionHost(url);
  return ONION_V3_RE.test(h) || ONION_V2_RE.test(h);
}

// webViaHost(webBase) → the exit peer's normal clearnet path (mirrors serveAsExitPeer's private `viaWeb`),
// so an onion-aware fetchImpl is a COMPLETE fetchImpl: onion → Tor, everything else → the host's /web.
export function webViaHost(webBase = "/apps/browser/web?url=") {
  return async (url, { doc, op } = {}) => {
    const q = encodeURIComponent(url) + (doc ? "&doc=1" : "") + (op ? "&op=" + encodeURIComponent(op) : "");
    const r = await fetch(webBase + q);
    const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
    return { status: r.status, headers, bytes: new Uint8Array(await r.arrayBuffer()) };
  };
}

// onionExitFetch({ onionFetch, webFetch, peerOnly }) → fetchImpl(url,{doc,op}) → { status, headers, bytes }.
//   onionFetch(url,{doc,op}) → { status, headers, bytes, verified }  — the REAL Tor client (nodeArtiFetch
//     in production; a stub in the witness). `verified` = the onion's ed25519 key checked end-to-end.
//   webFetch  — clearnet path; defaults to webViaHost(). Ignored for .onion.
//   peerOnly  — reserved: in PEER_ONLY the ladder already forbids the clearnet gateway; the exit peer never
//               was a gateway, so this only documents intent here.
export function onionExitFetch({ onionFetch, webFetch = webViaHost() } = {}) {
  return async function fetchImpl(url, opts = {}) {
    if (isOnionUrl(url)) {
      if (typeof onionFetch !== "function") {
        // No Tor client on this device — refuse the onion cleanly so the ladder can fall past to arti-wasm.
        return { status: 502, headers: { "x-holo-onion": "unavailable" }, bytes: new Uint8Array() };
      }
      const r = await onionFetch(url, opts);
      const headers = Object.assign({}, r.headers || {});
      headers["x-holo-onion"] = "routed";                        // real onion routing on this device (rung 1)
      headers["x-holo-onion-verified"] = r.verified ? "1" : "0"; // end-to-end key check (self-authentication)
      return { status: r.status | 0, headers, bytes: r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes || []) };
    }
    return webFetch(url, opts);
  };
}

// hostOnionFetch(base) → onionFetch for the BROWSER page half of rung 1. RTC lives in the page; raw sockets
// (SOCKS5 to Arti) live in the host PROCESS. So the page's onion transport is a thin call to a same-origin
// host endpoint (`/onion?url=…`) that runs nodeArtiFetch (holo-onion-arti.node.mjs). If the endpoint is
// absent (no Arti wired on this host), it THROWS — the exit peer replies error and browser-sw's ladder
// falls past this device to the next rung (arti-wasm), exactly as intended.
export function hostOnionFetch(base = "/onion?url=") {
  return async (url, { doc, op } = {}) => {
    const q = encodeURIComponent(url) + (doc ? "&doc=1" : "") + (op ? "&op=" + encodeURIComponent(op) : "");
    let r;
    try { r = await fetch(base + q); } catch (e) { throw new Error("onion endpoint unreachable — no Arti on this host? (" + (e && e.message || e) + ")"); }
    if (r.status === 404 || r.status === 501) throw new Error("onion endpoint not mounted on this host (status " + r.status + ")");
    const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
    return { status: r.status, headers, bytes: new Uint8Array(await r.arrayBuffer()), verified: headers["x-holo-onion-verified"] === "1" };
  };
}

export default { isOnionUrl, webViaHost, onionExitFetch, hostOnionFetch };
