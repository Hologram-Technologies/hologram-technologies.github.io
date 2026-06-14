// holo-mcp-browser.js — the SERVERLESS, in-page MCP transport. A live holospace, loaded from a dumb
// static host with NO origin server, IS its own MCP server: this wires the node-free engine
// (holo-mcp-core.mjs) to browser-native transports so an agent reaches the app's standardized core
// (holo_describe + verify/resolve + build·run·share via window.HoloApp) with zero server (Law L1/L4).
//
// Two browser-native transports, both carrying spec JSON-RPC 2.0 (MCP permits custom transports):
//   · MessagePort  — the canonical one. An embedder (or in-browser agent) opens a MessageChannel and
//                    sends the port; every message is one MCP request, every reply one MCP response.
//   · window message — a portless fallback: post { type:"holo-mcp/rpc", id, request } to the window
//                    (or an iframe's contentWindow) and receive { type:"holo-mcp/rpc-result", id, result }.
//
// build·run·share are live because window.HoloApp (the forge, holo-app.mjs) is injected as ctx.app.

import { makeServer, descriptor } from "./holo-mcp-core.mjs";

const CONNECT = "holo-mcp/connect";   // { type, name? } + e.ports[0] = a MessagePort to serve
const RPC = "holo-mcp/rpc";           // { type, id, request } portless request
const RPC_RESULT = "holo-mcp/rpc-result";

// makeBrowserServer(opts) → { registry, handle } over the node-free core, with the in-page forge
// (window.HoloApp) injected so build·run·share execute serverlessly. opts: { appManifest | manifests,
// resolve, toolHandlers }. resolve may be async (e.g. read from the κ-store / CacheStorage).
export function makeBrowserServer(opts = {}) {
  const app = opts.app || (typeof globalThis !== "undefined" ? (globalThis.HoloApp || globalThis.HoloForge) : null);
  return makeServer({ ...opts, app });
}

// serveOverPort(port, server) — bind a MessagePort: each inbound message is one MCP JSON-RPC request;
// the response is posted back. Returns a stop() that closes the port.
export function serveOverPort(port, server) {
  const onmessage = async (e) => {
    try { port.postMessage(await server.handle(e.data)); }
    catch (err) { port.postMessage({ jsonrpc: "2.0", id: (e.data && e.data.id) ?? null, error: { code: -32603, message: (err && err.message) || String(err) } }); }
  };
  port.addEventListener ? port.addEventListener("message", onmessage) : (port.onmessage = onmessage);
  if (port.start) port.start();
  return () => { try { port.close(); } catch {} };
}

// bootHoloMcp(opts) — start the in-page server and expose it. Sets globalThis.HoloMCP = { server,
// handle, descriptor, setApp(manifest) } and listens on the window for the CONNECT handshake (an
// embedder hands a MessagePort) and for portless RPC messages. Idempotent. opts as makeBrowserServer.
export function bootHoloMcp(opts = {}) {
  if (typeof globalThis === "undefined") return null;
  const state = { server: makeBrowserServer(opts), opts };
  const api = {
    get registry() { return state.server.registry; },
    handle: (req) => state.server.handle(req),
    descriptor: () => descriptor(state.server.registry),
    // re-point the in-page server at the currently-mounted app (the shell calls this on navigation)
    setApp: (appManifest) => { state.opts = { ...state.opts, appManifest }; state.server = makeBrowserServer(state.opts); return api; },
    serveOverPort: (port) => serveOverPort(port, state.server),
  };
  globalThis.HoloMCP = api;

  const target = (typeof self !== "undefined" && self.addEventListener) ? self : (typeof window !== "undefined" ? window : null);
  if (target && !target.__holoMcpWired) {
    target.__holoMcpWired = true;
    target.addEventListener("message", async (e) => {
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === CONNECT && e.ports && e.ports[0]) { serveOverPort(e.ports[0], state.server); return; }   // hand-shake: serve the supplied port
      if (d.type === RPC && d.request) {                                                                       // portless request/response
        let result, error;
        try { const r = await state.server.handle(d.request); result = r.result; error = r.error; } catch (err) { error = { code: -32603, message: (err && err.message) || String(err) }; }
        const src = e.source || target;
        try { src.postMessage({ type: RPC_RESULT, id: d.id, result, error }, "*"); } catch { try { src.postMessage({ type: RPC_RESULT, id: d.id, result, error }); } catch {} }
      }
    });
  }
  if (typeof document !== "undefined" && document.documentElement) document.documentElement.dispatchEvent(new Event("holo-mcp-ready"));
  return api;
}

// connectHoloMcp(targetWindow) — the CLIENT side of the MessagePort handshake (for an embedder/agent):
// opens a MessageChannel, hands one port to the holospace, returns a tiny client { call(method, params) }.
export function connectHoloMcp(targetWindow, { name } = {}) {
  const ch = new MessageChannel();
  let nextId = 1; const pending = new Map();
  ch.port1.onmessage = (e) => { const m = e.data; const p = pending.get(m && m.id); if (p) { pending.delete(m.id); p(m); } };
  ch.port1.start && ch.port1.start();
  targetWindow.postMessage({ type: CONNECT, name }, "*", [ch.port2]);
  return {
    call: (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, (m) => resolve(m.error ? Promise.reject(new Error(m.error.message)) : m.result)); ch.port1.postMessage({ jsonrpc: "2.0", id, method, params }); }),
    close: () => { try { ch.port1.close(); } catch {} },
  };
}
