// holo-routing.mjs — CONTENT DISCOVERY for a bare κ (ADR-026 companion to holo-peers.mjs). The IPFS
// adapter races a FIXED set of recursive Trustless Gateways; that resolves most CIDs but pins the OS to
// a handful of operators. This adds the missing step: given a κ (= CIDv1 sha2-256), ask the IPFS
// Delegated Routing V1 HTTP API "who serves these bytes?" and turn the answer into more fetchable
// gateways. It is the one discovery surface the spec MANDATES CORS on, so it works from a browser
// fetch() — every other routing path (the Amino DHT) needs a libp2p node we cannot run in a Service Worker.
//
// Standards: IPFS Delegated Routing V1 (specs.ipfs.tech/routing/http-routing-v1, IPIP-0337) — GET
// /routing/v1/providers/{cid} → provider records {ID, Addrs:[multiaddr], Protocols:[…]}. We keep only
// providers that advertise an HTTPS path-gateway (multiaddr …/tls/http or …/https, or the
// transport-ipfs-gateway-http protocol) and project each to an https:// authority the κ-resolver can hit.
//
// Trust model is unchanged: discovery is a LATENCY hint, never an authority. Whatever a provider returns
// is still re-derived to the κ before admission (Law L5), so a lying indexer or hostile gateway only
// wastes a round-trip. Pure + isomorphic (browser & Node fetch); no top-level effects.

// The public Delegated Routing endpoints (someguy @ IPFS Foundation, then IPNI @ cid.contact). Both
// proxy DHT + IPNI behind one CORS-enabled HTTP GET. Order = preference; results are merged.
export const ROUTING_ENDPOINTS = [
  "https://delegated-ipfs.dev/routing/v1",
  "https://cid.contact/routing/v1",
];

// withTimeout(promise, ms) — race a promise against a deadline; resolves to `fallback` on timeout so a
// slow indexer can never stall the resolver. Uses AbortController when the work accepts a signal.
function deadline(ms) {
  if (typeof AbortController === "undefined") return { signal: undefined, done: () => {} };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, done: () => clearTimeout(t) };
}

// multiaddrToHttps(addr) → "https://host[:port]" | null — project a libp2p multiaddr onto a browser-
// reachable HTTPS authority. We accept only TLS/HTTPS transports (a content-addressed OS served over
// HTTPS cannot fetch plaintext http:// cross-origin), and only named/IP hosts. e.g.
//   /dns4/example.com/tcp/443/tls/http   → https://example.com
//   /dns/example.com/tcp/8443/https      → https://example.com:8443
//   /ip4/1.2.3.4/tcp/443/tls/http        → https://1.2.3.4
function multiaddrToHttps(addr) {
  const p = String(addr).split("/").filter(Boolean);          // ["dns4","example.com","tcp","443","tls","http"]
  let host = null, port = null, tls = false, http = false;
  for (let i = 0; i < p.length; i++) {
    const k = p[i];
    if ((k === "dns" || k === "dns4" || k === "dns6" || k === "dnsaddr" || k === "ip4" || k === "ip6") && p[i + 1]) host = p[++i];
    else if (k === "tcp" && p[i + 1]) port = p[++i];
    else if (k === "tls") tls = true;
    else if (k === "https") { tls = true; http = true; }
    else if (k === "http" || k === "ws" || k === "wss") http = http || k === "http";
  }
  if (!host || !tls) return null;                              // HTTPS only — plaintext is unusable from a secure context
  const authority = port && port !== "443" ? `${host}:${port}` : host;
  return `https://${authority}`;
}

// gatewaysFromProviders(records) → string[] — unique HTTPS gateway bases from provider records. A record
// counts as a gateway if it advertises the path-gateway protocol OR exposes a TLS/HTTPS multiaddr.
export function gatewaysFromProviders(records) {
  const out = new Set();
  for (const r of records || []) {
    const protos = (r && r.Protocols) || [];
    const isGw = protos.some((x) => /gateway-http|transport-ipfs-gateway-http|http/i.test(String(x)));
    for (const a of (r && r.Addrs) || []) {
      const base = multiaddrToHttps(a);
      if (base && (isGw || /\/tls\/http|\/https/i.test(String(a)))) out.add(base);
    }
  }
  return [...out];
}

// routingProviders(cidStr, cfg) → record[] — query the Delegated Routing endpoints for providers of a
// CID and MERGE the results. Best-effort: a failing/empty endpoint contributes nothing, never throws.
// `endpoints` order is preference; `timeoutMs` bounds EACH endpoint independently.
export async function routingProviders(cidStr, { endpoints = ROUTING_ENDPOINTS, fetchImpl, timeoutMs = 4000 } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f || !cidStr) return [];
  const queries = endpoints.map(async (ep) => {
    const { signal, done } = deadline(timeoutMs);
    try {
      const r = await f(`${ep.replace(/\/$/, "")}/providers/${cidStr}`, { headers: { accept: "application/json" }, signal });
      if (!r || !r.ok) return [];
      const text = await r.text();
      // Most endpoints answer JSON {"Providers":[…]}; some stream NDJSON even for application/json. Handle both.
      try { const j = JSON.parse(text); return j.Providers || j.providers || []; }
      catch { return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
    } catch { return []; }
    finally { done(); }
  });
  const settled = await Promise.allSettled(queries);
  return settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
}

// discoverGateways(cidStr, cfg) → string[] — the one call the resolver wants: bare CID → extra HTTPS
// gateways to try. Returns [] when nothing useful is found (the caller falls back to its static set).
export async function discoverGateways(cidStr, cfg = {}) {
  return gatewaysFromProviders(await routingProviders(cidStr, cfg));
}
