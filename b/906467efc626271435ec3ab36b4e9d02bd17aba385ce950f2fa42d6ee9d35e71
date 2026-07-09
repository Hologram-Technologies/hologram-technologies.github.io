// holo-onion-arti.node.mjs — PRODUCTION onionFetch for the desktop host (Node/Tauri side of rung 1).
//
// Routes a .onion through a locally-running Tor/Arti SOCKS5 proxy using ONLY Node built-ins (net, tls) —
// zero npm deps. socks5h semantics: we hand the .onion to the PROXY as a DOMAIN so Tor resolves +
// rendezvous-connects it; the host never leaks a lookup. Reaching a v3 .onion means Tor authenticated the
// service's ed25519 key (the address IS the key) → verified:true.
//
// SPEED: a page pulls ~15-30 subresources. Opening a fresh Tor stream (SOCKS handshake + new rendezvous
// stream) per resource is the latency killer. So we POOL keep-alive connections per onion origin and reuse
// them, with a small per-origin concurrency cap so we don't flood one circuit. Repeat visits are served
// from the browser's κ-store (zero Tor) — this pool is only about making the FIRST paint fast.
//
// Requires a running Arti/tor SOCKS listener (Arti default 127.0.0.1:9150 · `arti proxy`).

import net from "node:net";
import tls from "node:tls";

const MAX_BODY = 24 * 1024 * 1024;   // SEC-8: bound by RECEIVED bytes
const REQ_TIMEOUT = 30000;           // per-request ceiling
const IDLE_MS = 20000;               // keep an idle pooled socket this long
const MAX_PER_ORIGIN = 6;            // in-flight streams per onion origin (browser-like)

function socks5Connect({ socksHost, socksPort, host, port }) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: socksHost, port: socksPort });
    const fail = (e) => { try { sock.destroy(); } catch {} reject(e instanceof Error ? e : new Error(String(e))); };
    sock.once("error", fail);
    sock.once("connect", () => {
      sock.write(Buffer.from([0x05, 0x01, 0x00]));               // VER5, NO-AUTH
      sock.once("data", (m) => {
        if (m[0] !== 0x05 || m[1] !== 0x00) return fail("socks5: no acceptable auth method");
        const h = Buffer.from(host, "ascii");
        sock.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, h.length]), h, Buffer.from([(port >> 8) & 0xff, port & 0xff])]));
        sock.once("data", (r) => {
          if (r[0] !== 0x05 || r[1] !== 0x00) return fail("socks5: connect refused (rep=" + r[1] + ") — Arti running + onion reachable?");
          sock.removeListener("error", fail);
          resolve(sock);
        });
      });
    });
  });
}

// Read ONE full HTTP/1.1 response off a (possibly keep-alive) socket. Handles content-length, chunked
// transfer-encoding, and close-delimited bodies. Resolves { status, headers, bytes, keepAlive }.
function readResponse(sock) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0), phase = "head", status = 0; const headers = {};
    let mode = null, contentLength = 0, received = 0, keepAlive = true;
    const chunks = []; let chunkRemain = 0, chunkPhase = "size";
    const timer = setTimeout(() => finish(new Error("onion request timeout")), REQ_TIMEOUT);
    const cleanup = () => { clearTimeout(timer); sock.removeListener("data", onData); sock.removeListener("error", onErr); sock.removeListener("end", onEnd); };
    const done = (ka) => { cleanup(); resolve({ status, headers, bytes: Buffer.concat(chunks), keepAlive: ka }); };
    const finish = (e) => { cleanup(); reject(e); };
    const onErr = (e) => finish(e);
    const onEnd = () => { if (mode === "close") done(false); else finish(new Error("connection closed mid-response")); };
    function onData(d) {
      buf = Buffer.concat([buf, d]);
      if (phase === "head") {
        const i = buf.indexOf("\r\n\r\n"); if (i < 0) return;
        const lines = buf.slice(0, i).toString("latin1").split("\r\n");
        status = parseInt(lines[0].split(" ")[1] || "0", 10);
        for (const line of lines.slice(1)) { const k = line.indexOf(":"); if (k > 0) headers[line.slice(0, k).trim().toLowerCase()] = line.slice(k + 1).trim(); }
        keepAlive = (headers["connection"] || "").toLowerCase() !== "close";
        buf = buf.slice(i + 4); phase = "body";
        const te = (headers["transfer-encoding"] || "").toLowerCase();
        if (status === 204 || status === 304) return done(keepAlive);
        if (te.includes("chunked")) mode = "chunked";
        else if (headers["content-length"] != null) { mode = "length"; contentLength = parseInt(headers["content-length"], 10) || 0; if (contentLength === 0) return done(keepAlive); }
        else mode = "close";
      }
      if (phase !== "body") return;
      if (mode === "length") {
        const take = buf.slice(0, contentLength - received); chunks.push(take); received += take.length; buf = buf.slice(take.length);
        if (received > MAX_BODY) return onErr(new Error("over cap"));
        if (received >= contentLength) return done(keepAlive);
      } else if (mode === "chunked") {
        while (buf.length) {
          if (chunkPhase === "size") {
            const j = buf.indexOf("\r\n"); if (j < 0) break;
            const size = parseInt(buf.slice(0, j).toString("latin1").split(";")[0].trim(), 16); buf = buf.slice(j + 2);
            if (!size) { chunkPhase = "trailer"; } else { chunkRemain = size; chunkPhase = "data"; }
          } else if (chunkPhase === "data") {
            const take = buf.slice(0, chunkRemain); chunks.push(take); chunkRemain -= take.length; received += take.length; buf = buf.slice(take.length);
            if (received > MAX_BODY) return onErr(new Error("over cap"));
            if (chunkRemain === 0) { if (buf.length < 2) break; buf = buf.slice(2); chunkPhase = "size"; } else break;
          } else { const j = buf.indexOf("\r\n"); if (j < 0) break; buf = buf.slice(j + 2); return done(keepAlive); }
        }
      } else { chunks.push(buf); received += buf.length; buf = Buffer.alloc(0); if (received > MAX_BODY) return onErr(new Error("over cap")); }
    }
    sock.on("data", onData); sock.once("error", onErr); sock.once("end", onEnd);
  });
}

export function nodeArtiFetch({ socksHost = "127.0.0.1", socksPort = 9150 } = {}) {
  const pool = new Map();       // originKey → [{ sock, idleTimer }]
  const inflight = new Map();   // originKey → count
  const waiters = new Map();    // originKey → [resolve]
  const keyOf = (u) => (u.protocol === "https:" ? "https" : "http") + "://" + u.hostname + ":" + (u.port || (u.protocol === "https:" ? 443 : 80));
  const dec = (key) => { const n = Math.max(0, (inflight.get(key) || 1) - 1); inflight.set(key, n); const w = waiters.get(key); if (w && w.length) w.shift()(); };

  async function acquire(u, forceFresh = false) {
    const key = keyOf(u);
    const idle = pool.get(key);
    // forceFresh (a retry) skips the pool: a reused keep-alive socket whose Tor circuit died silently still
    // looks writable, so a stale socket is exactly what a retry must avoid — go straight to a new circuit.
    while (!forceFresh && idle && idle.length) { const e = idle.pop(); clearTimeout(e.idleTimer); if (e.sock.writable && !e.sock.destroyed) return e.sock; try { e.sock.destroy(); } catch {} }
    if ((inflight.get(key) || 0) >= MAX_PER_ORIGIN) await new Promise((res) => { const w = waiters.get(key) || []; w.push(res); waiters.set(key, w); });
    inflight.set(key, (inflight.get(key) || 0) + 1);
    try {
      const https = u.protocol === "https:";
      const port = u.port ? parseInt(u.port, 10) : (https ? 443 : 80);
      let sock = await socks5Connect({ socksHost, socksPort, host: u.hostname, port });
      if (https) sock = tls.connect({ socket: sock, servername: u.hostname, rejectUnauthorized: false });   // onion self-auths via rendezvous
      sock.setMaxListeners(0);
      return sock;
    } catch (e) { dec(key); throw e; }
  }
  function release(u, sock, keepAlive) {
    const key = keyOf(u); dec(key);
    if (keepAlive && sock && sock.writable && !sock.destroyed) {
      const idle = pool.get(key) || [];
      const idleTimer = setTimeout(() => { const arr = pool.get(key); if (arr) { const i = arr.findIndex((x) => x.sock === sock); if (i >= 0) arr.splice(i, 1); } try { sock.destroy(); } catch {} }, IDLE_MS);
      idle.push({ sock, idleTimer }); pool.set(key, idle);
    } else if (sock) { try { sock.destroy(); } catch {} }
  }

  return async function onionFetch(url) {
    const u = new URL(/^https?:\/\//i.test(url) ? url : "http://" + url);
    const path = (u.pathname + u.search) || "/";
    // Retry so an IDLE/rebuilt Tor circuit is transparent: after Tor drops circuits (long idle), the first
    // stream fails or a stale pooled socket dies — attempt 2+ forces a fresh circuit with a short backoff so
    // Tor has time to rebuild. GETs are idempotent, so retry is safe. This kills the "first request → 502".
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let sock = null, keep = false;
      try {
        sock = await acquire(u, attempt > 0);
        const onTimeout = () => { try { sock.destroy(new Error("onion request timeout")); } catch {} };
        sock.setTimeout(REQ_TIMEOUT, onTimeout);
        sock.write(`GET ${path} HTTP/1.1\r\nHost: ${u.hostname}\r\nUser-Agent: Hologram/onion\r\nAccept: */*\r\nAccept-Encoding: identity\r\nConnection: keep-alive\r\n\r\n`);
        const res = await readResponse(sock);
        keep = res.keepAlive; sock.setTimeout(0);
        return { status: res.status, headers: res.headers, bytes: new Uint8Array(res.bytes), verified: true };
      } catch (e) {
        lastErr = e;
        if (sock) { const key = keyOf(u); try { sock.destroy(); } catch {} dec(key); sock = null; }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 350 + attempt * 600));   // let Tor rebuild
      } finally { if (sock) release(u, sock, keep); }
    }
    throw lastErr;
  };
}

export default { nodeArtiFetch };
