// holo-omni-onion-transport.mjs — the TWO honest ways onion bytes leave the tab, behind ONE config.
//
// A browser tab cannot natively join the Tor network, so reaching a .onion service ALWAYS goes through an
// explicit transport. This module is the whole of that decision — picked by config, NEVER defaulted:
//
//   gateway  — a Tor2web-style HTTP egress. http://<addr>.onion/<path> is mapped to an HTTPS gateway URL
//              and fetched normally. Zero local setup; works in a pure tab. Trade-off: the gateway sees the
//              plaintext request + the user's IP — a TRUSTED hop, weakest privacy, historically deprecated.
//   socks5   — a local Tor SOCKS5 proxy (the user runs Tor / Arti, e.g. 127.0.0.1:9050). We open a SOCKS5
//              CONNECT to the onion host BY DOMAIN NAME (atyp 0x03) so TOR resolves the .onion — we never
//              resolve it ourselves. Real Tor anonymity, trustless circuit. Trade-off: needs a running Tor
//              and a Node-side dial (a sandboxed page cannot open a raw socket), so it lives on the host.
//
// Neither is the default. No transport configured → honest null; the caller surfaces "pick a transport".
// Pure ESM; the gateway path is isomorphic (fetch), the socks5 path is Node (node:net), injected for tests.

export const ONION_TRANSPORTS = ["gateway", "socks5"];
const enc = (s) => new TextEncoder().encode(s);
function concat(...arrs) { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let i = 0; for (const a of arrs) { o.set(a, i); i += a.length; } return o; }

// normalizeTransport(cfg) → { kind, endpoint, label? } | null. The single gate: only a fully-formed,
// known transport survives; everything else (none / unknown / endpoint-less) collapses to null.
export function normalizeTransport(cfg) {
  if (!cfg || typeof cfg !== "object") return null;
  const kind = String(cfg.kind || "").toLowerCase();
  if (!ONION_TRANSPORTS.includes(kind)) return null;
  const endpoint = String(cfg.endpoint || "").trim();
  if (!endpoint) return null;
  return { kind, endpoint, ...(cfg.label ? { label: String(cfg.label) } : {}) };
}

// transportFromEnv(env) → a transport from HOLO_ONION_* (dev host / CI), or null. Default is none.
export function transportFromEnv(env) {
  const e = env || (typeof process !== "undefined" ? process.env : {}) || {};
  const kind = String(e.HOLO_ONION_TRANSPORT || "").toLowerCase();
  if (kind === "gateway") return normalizeTransport({ kind: "gateway", endpoint: e.HOLO_ONION_GATEWAY || "", label: "env" });
  if (kind === "socks5") return normalizeTransport({ kind: "socks5", endpoint: e.HOLO_ONION_SOCKS5 || "", label: "env" });
  return null;
}

// ── gateway adapter ──────────────────────────────────────────────────────────────────────────────
// gatewayUrl(onionUrl, endpoint) — map an onion URL to its gateway URL. Two endpoint styles:
//   template  — contains {host}/{addr}/{path}: substituted literally (full control).
//   suffix    — a bare domain (e.g. "onion.ws"): yields https://<addr>.onion.<suffix>/<path>.
export function gatewayUrl(onionUrl, endpoint) {
  const u = new URL(onionUrl);
  const host = u.hostname;                                  // <addr>.onion
  const addr = host.replace(/\.onion$/i, "");
  const pathq = u.pathname + (u.search || "");
  if (/\{host\}|\{addr\}|\{path\}/.test(endpoint)) {
    return endpoint.replace(/\{host\}/g, host).replace(/\{addr\}/g, addr).replace(/\{path\}/g, pathq.replace(/^\//, ""));
  }
  const suffix = endpoint.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return "https://" + host + "." + suffix + pathq;
}

// fetchViaGateway(onionUrl, transport, fetchImpl) → { ok, status, bytes, contentType, via } | null.
export async function fetchViaGateway(onionUrl, transport, fetchImpl) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return null;
  const via = gatewayUrl(onionUrl, transport.endpoint);
  const r = await f(via, { redirect: "follow", headers: { "user-agent": "HoloBrowser/onion", accept: "text/html,application/xhtml+xml,*/*;q=0.8" } });
  if (!r) return null;
  const bytes = new Uint8Array(await r.arrayBuffer());
  const ct = (r.headers && r.headers.get) ? r.headers.get("content-type") : null;
  return { ok: !!(r.ok || (r.status >= 200 && r.status < 400)), status: r.status, bytes, contentType: ct, via };
}

// ── socks5 adapter ───────────────────────────────────────────────────────────────────────────────
// socks5Greeting() — the no-auth client greeting (VER=5, 1 method, METHOD=0x00).
export function socks5Greeting() { return Uint8Array.of(0x05, 0x01, 0x00); }
// socks5ConnectByDomain(host, port) — a SOCKS5 CONNECT request that names the host BY DOMAIN (atyp 0x03).
// This is load-bearing for onion: we MUST hand Tor the .onion name and let IT resolve the service — never
// resolve the .onion to an address ourselves (it has no DNS / IP; only Tor knows the rendezvous).
export function socks5ConnectByDomain(host, port) {
  const hb = enc(host);
  if (hb.length > 255) throw new Error("host too long for SOCKS5 domain atyp");
  return concat(Uint8Array.of(0x05, 0x01, 0x00, 0x03, hb.length), hb, Uint8Array.of((port >> 8) & 0xff, port & 0xff));
}
// parseSocks5ConnectReply(buf) → { ok, code, headerLen } — VER REP RSV ATYP BND.ADDR BND.PORT. We only
// need REP (0x00 = success) and the total header length so the caller can strip it before the HTTP body.
export function parseSocks5ConnectReply(buf) {
  if (!buf || buf.length < 5 || buf[0] !== 0x05) return { ok: false, code: -1, headerLen: 0 };
  const code = buf[1], atyp = buf[3];
  const addrLen = atyp === 0x01 ? 4 : atyp === 0x04 ? 16 : atyp === 0x03 ? buf[4] + 1 : 0;
  return { ok: code === 0x00, code, headerLen: 4 + addrLen + 2 };
}
// parseHttpResponse(raw) → { ok, status, bytes, contentType } — split a raw HTTP/1.1 response (headers\r\n\r\n
// body). Minimal: enough to hand the body to the κ-minting seam, which re-derives it (L5).
export function parseHttpResponse(raw) {
  const sep = indexOfCRLFCRLF(raw);
  if (sep < 0) return { ok: false, status: 502, bytes: raw, contentType: null };
  const head = new TextDecoder("latin1").decode(raw.subarray(0, sep));
  const status = (head.match(/^HTTP\/\d\.\d\s+(\d{3})/) || [, "502"])[1] | 0;
  const ct = (head.match(/content-type:\s*([^\r\n]+)/i) || [, null])[1];
  return { ok: status >= 200 && status < 400, status, bytes: raw.subarray(sep + 4), contentType: ct };
}
function indexOfCRLFCRLF(b) { for (let i = 0; i + 3 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i; return -1; }

// fetchViaSocks5(onionUrl, transport, { net }) → { ok, status, bytes, contentType, via } | null.
// net is node:net (injected so the witness can drive a fake socket); absent → null (e.g. in a pure SW).
export async function fetchViaSocks5(onionUrl, transport, deps = {}) {
  const net = deps.net; if (!net) return null;
  const u = new URL(onionUrl);
  const host = u.hostname, port = u.port ? +u.port : 80;
  const [pHost, pPort] = transport.endpoint.replace(/^socks5h?:\/\//i, "").split(":");
  return await new Promise((resolve, reject) => {
    const chunks = []; let phase = 0, replyBuf = new Uint8Array(0);
    const sock = net.connect({ host: pHost || "127.0.0.1", port: +pPort || 9050 }, () => sock.write(Buffer.from(socks5Greeting())));
    const httpReq = `GET ${(u.pathname || "/") + (u.search || "")} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: HoloBrowser/onion\r\nAccept: */*\r\nConnection: close\r\n\r\n`;
    sock.on("data", (d) => {
      const b = new Uint8Array(d);
      if (phase === 0) {                                   // greeting reply (VER, METHOD)
        if (b[0] !== 0x05 || b[1] !== 0x00) { sock.destroy(); return reject(new Error("SOCKS5 no-auth refused")); }
        phase = 1; sock.write(Buffer.from(socks5ConnectByDomain(host, port))); return;
      }
      if (phase === 1) {                                   // CONNECT reply
        replyBuf = concat(replyBuf, b);
        const rep = parseSocks5ConnectReply(replyBuf);
        if (replyBuf.length < rep.headerLen && rep.code === 0x00) return;     // wait for full reply header
        if (!rep.ok) { sock.destroy(); return reject(new Error("SOCKS5 CONNECT failed (code " + rep.code + ")")); }
        const leftover = replyBuf.subarray(rep.headerLen); if (leftover.length) chunks.push(leftover);
        phase = 2; sock.write(Buffer.from(enc(httpReq))); return;
      }
      chunks.push(b);                                      // HTTP response bytes
    });
    sock.on("error", reject);
    sock.on("end", () => { try { const out = parseHttpResponse(concat(...chunks)); resolve({ ...out, via: "socks5://" + (pHost || "127.0.0.1") + ":" + (+pPort || 9050) + " → " + host }); } catch (e) { reject(e); } });
    sock.setTimeout(30000, () => { sock.destroy(); reject(new Error("SOCKS5 onion fetch timed out")); });
  });
}

// probeLocalTor({ net }, ports) → a socks5 transport if a local Tor is LISTENING (9050 = Tor daemon/Arti,
// 9150 = Tor Browser), else null. This is what makes onion paste-and-go for anyone running Tor: no config,
// no prompt — exactly how a normal onion-capable browser reaches a hidden service. Node-only (needs a socket).
export function probeLocalTor(deps = {}, ports = [9050, 9150]) {
  const net = deps.net; if (!net) return Promise.resolve(null);
  const tryPort = (port) => new Promise((resolve) => {
    let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
    const s = net.connect({ host: "127.0.0.1", port }, () => { fin({ kind: "socks5", endpoint: "127.0.0.1:" + port, label: "local-tor" }); s.destroy(); });
    s.setTimeout(1200, () => { fin(null); s.destroy(); });
    s.on("error", () => fin(null));
  });
  return (async () => { for (const p of ports) { const t = await tryPort(p); if (t) return t; } return null; })();
}

// resolveActiveTransport({ override, net }) → the transport to USE, in priority order: an explicit override
// (the user's pick), then HOLO_ONION_* env, then an auto-detected local Tor. null only if NONE is available
// → the caller answers an honest 501. This is the seam that makes onion "just work" without a forced prompt.
export async function resolveActiveTransport(deps = {}) {
  const explicit = normalizeTransport(deps.override) || transportFromEnv();
  if (explicit) return explicit;
  return await probeLocalTor(deps);
}

// onionFetch(onionUrl, transport, deps) → the ONE entry the proxy calls. Routes to the configured adapter;
// returns the fetched bytes + the transport actually used (for the egress receipt). null → no usable transport.
export async function onionFetch(onionUrl, transport, deps = {}) {
  const t = normalizeTransport(transport);
  if (!t) return null;
  if (t.kind === "gateway") return await fetchViaGateway(onionUrl, t, deps.fetchImpl);
  if (t.kind === "socks5") return await fetchViaSocks5(onionUrl, t, deps);
  return null;
}

export default { ONION_TRANSPORTS, normalizeTransport, transportFromEnv, probeLocalTor, resolveActiveTransport, gatewayUrl, fetchViaGateway, socks5Greeting, socks5ConnectByDomain, parseSocks5ConnectReply, parseHttpResponse, fetchViaSocks5, onionFetch };
