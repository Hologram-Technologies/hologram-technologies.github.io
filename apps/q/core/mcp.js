// core/mcp.js — a lean, browser-native Model Context Protocol CLIENT. Speaks the open MCP
// spec (JSON-RPC 2.0) over the Streamable HTTP transport (single endpoint, POST per message,
// optional SSE response bodies, Mcp-Session-Id header) with a fallback for plain HTTP+SSE
// servers. No SDK, no build step — the protocol is small and this is all of it that a chat
// client needs: initialize → tools/list → tools/call.
//
// Substrate twist: every connected server and every tool call is content-addressable — the
// caller can seal a PROV-O receipt around call inputs/outputs (see core/tools.js), so tool
// use gets the same verifiability as inference (Law L5).

const PROTOCOL_VERSION = "2025-03-26";
const CLIENT_INFO = { name: "holo-q", version: "2.0.0" };

let _seq = 0;
const nextId = () => ++_seq;

// Parse an SSE stream body and resolve with the JSON-RPC response matching `id`.
async function readSse(res, id) {
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = "", result = null;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data) continue;
      try { const msg = JSON.parse(data); if (msg.id === id) { result = msg; reader.cancel().catch(() => {}); return result; } } catch {}
    }
  }
  return result;
}

export function makeMcpClient({ url, headers = {}, name = "", timeoutMs = 30000 } = {}) {
  let sessionId = null, initialized = null, serverInfo = null, toolCache = null;

  async function rpc(method, params, { notification = false } = {}) {
    const body = notification
      ? { jsonrpc: "2.0", method, ...(params ? { params } : {}) }
      : { jsonrpc: "2.0", id: nextId(), method, ...(params ? { params } : {}) };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST", signal: ctrl.signal,
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(sessionId ? { "mcp-session-id": sessionId } : {}), ...headers },
        body: JSON.stringify(body),
      });
      const sid = res.headers.get("mcp-session-id"); if (sid) sessionId = sid;
      if (notification) return null;
      if (res.status === 202) return null;
      if (!res.ok) throw new Error(`MCP ${res.status} ${res.statusText}`);
      const ctype = res.headers.get("content-type") || "";
      const msg = ctype.includes("text/event-stream") ? await readSse(res, body.id) : await res.json();
      if (!msg) throw new Error("MCP: no response for request " + body.id);
      if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message || JSON.stringify(msg.error)}`);
      return msg.result;
    } finally { clearTimeout(t); }
  }

  async function initialize() {
    if (initialized) return initialized;
    initialized = (async () => {
      const r = await rpc("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
      serverInfo = r && r.serverInfo || { name: name || url };
      await rpc("notifications/initialized", undefined, { notification: true }).catch(() => {});
      return r;
    })();
    return initialized;
  }

  // tools/list (cached; paginated per spec)
  async function listTools(force = false) {
    if (toolCache && !force) return toolCache;
    await initialize();
    const out = []; let cursor;
    do {
      const r = await rpc("tools/list", cursor ? { cursor } : {});
      out.push(...(r.tools || [])); cursor = r.nextCursor;
    } while (cursor);
    toolCache = out;
    return out;
  }

  // tools/call → { content: [{type:"text",text}|{type:"image",...}], isError }
  async function callTool(toolName, args) {
    await initialize();
    const r = await rpc("tools/call", { name: toolName, arguments: args || {} });
    return r;
  }

  return {
    url, name: () => (serverInfo && serverInfo.name) || name || url,
    initialize, listTools, callTool,
    get serverInfo() { return serverInfo; },
  };
}

// Flatten a tools/call result's content into plain text for the model's <tool_response>.
export function contentToText(result) {
  if (!result) return "";
  if (result.isError) return "ERROR: " + (result.content || []).map((c) => c.text || "").join("\n");
  return (result.content || []).map((c) => c.type === "text" ? c.text : c.type === "image" ? "[image]" : c.type === "resource" ? JSON.stringify(c.resource).slice(0, 2000) : "").join("\n");
}

// ── DISCOVERY — the MCP universe, three rings out from the substrate ─────────────────────
//  1. the SUBSTRATE's own roster (/.well-known/mcp.json — same-origin, verifiable)
//  2. user-added servers (κ-pinned config in the boot index)
//  3. the OFFICIAL public MCP registry (registry.modelcontextprotocol.io — the open index
//     of the ecosystem; remote/streamable-http entries are directly connectable from a tab)
export async function discoverSubstrate() {
  try {
    const r = await fetch("/.well-known/mcp.json"); if (!r.ok) return [];
    const j = await r.json();
    const servers = j.servers || j.mcpServers || (Array.isArray(j) ? j : [j]);
    return (Array.isArray(servers) ? servers : Object.entries(servers).map(([k, v]) => ({ name: k, ...v })))
      .map((s) => ({ source: "substrate", name: s.name || "hologram", url: s.url || s.endpoint || null, description: s.description || "", tools: s.tools || null, raw: s }))
      .filter((s) => s.url || s.tools);
  } catch { return []; }
}

export async function searchRegistry(query, { limit = 20 } = {}) {
  // The official registry's public REST API (v0). Remote servers carry `remotes[]` with
  // streamable-http/sse URLs — those are connectable straight from the browser.
  const base = "https://registry.modelcontextprotocol.io/v0/servers";
  const u = base + "?limit=" + limit + (query ? "&search=" + encodeURIComponent(query) : "");
  const r = await fetch(u, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("registry " + r.status);
  const j = await r.json();
  return (j.servers || []).map((s) => {
    const remote = (s.remotes || []).find((x) => /streamable|http/.test(x.type || "")) || (s.remotes || [])[0] || null;
    return { source: "registry", name: s.name, description: s.description || "", version: s.version,
      url: remote ? remote.url : null, transport: remote ? remote.type : (s.packages?.length ? "package (host-run)" : "unknown"), raw: s };
  });
}

export async function discoverAgents() {
  // The substrate's agent doors: NANDA AgentFacts + A2A AgentCards + Skills — one entry point.
  try {
    const r = await fetch("/.well-known/agents.json"); if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
