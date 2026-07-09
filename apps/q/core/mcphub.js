// core/mcphub.js — the MCP connection HUB: manages servers (substrate roster · user-added ·
// registry finds), their lifecycles and tool lists, and exposes the flat enabled-tool set the
// generation loop consumes. Server configs persist in the boot index (substrate-local).
//
// Discovery rings: (1) the substrate's own /.well-known/mcp.json (the OS's 30 verified tools),
// (2) servers the user added by URL, (3) the official public MCP registry. One hub, the
// whole universe reachable from a tab.

import { makeMcpClient, contentToText, discoverSubstrate, searchRegistry, discoverAgents } from "./mcp.js";

export function makeMcpHub({ chatStore, bus }) {
  const servers = new Map();   // id → { id, name, url, headers, enabled, client, tools, status, error }
  let loaded = false;

  const INDEX_KEY = "index:org.hologram.HoloQ";
  async function persist() {
    const idx = await chatStore.getIndex();
    idx.mcpServers = [...servers.values()].map((s) => ({ id: s.id, name: s.name, url: s.url, headers: s.headers || {}, enabled: !!s.enabled, source: s.source || "user" }));
    const b = new TextEncoder().encode(JSON.stringify(idx));
    await (chatStore.store.backend.putRaw ? chatStore.store.backend.putRaw(INDEX_KEY, b) : chatStore.store.backend.put(INDEX_KEY, b));
  }

  async function restore() {
    if (loaded) return; loaded = true;
    const idx = await chatStore.getIndex();
    for (const s of idx.mcpServers || []) if (!servers.has(s.id)) servers.set(s.id, { ...s, client: null, tools: [], status: "saved" });   // never clobber a live entry
    bus.emit("mcp-changed");
  }

  const norm = (url) => { try { return new URL(url, location.origin).href; } catch { return url; } };
  const idOf = (url) => "mcp-" + norm(url).replace(/[^\w]+/g, "-").slice(0, 60);

  async function add({ name, url, headers = {}, source = "user", enabled = true }) {
    const u = norm(url); const id = idOf(u);
    if (!servers.has(id)) servers.set(id, { id, name: name || u, url: u, headers, source, enabled, client: null, tools: [], status: "saved" });
    const s = servers.get(id);
    s.enabled = enabled;   // adding is an explicit intent — (re)enable even if a saved entry existed
    await connect(s.id).catch(() => {});
    await persist();
    bus.emit("mcp-changed");
    return s;
  }

  async function connect(id) {
    const s = servers.get(id); if (!s) return null;
    s.status = "connecting"; s.error = null; bus.emit("mcp-changed");
    try {
      s.client = makeMcpClient({ url: s.url, headers: s.headers, name: s.name });
      await s.client.initialize();
      s.tools = await s.client.listTools();
      s.name = s.client.name() || s.name;
      s.status = "connected";
    } catch (e) {
      s.client = null; s.tools = []; s.status = "error"; s.error = String(e && e.message || e);
    }
    bus.emit("mcp-changed");
    return s;
  }

  async function remove(id) { servers.delete(id); await persist(); bus.emit("mcp-changed"); }
  async function setEnabled(id, on) { const s = servers.get(id); if (s) { s.enabled = !!on; if (on && !s.client) await connect(id); await persist(); bus.emit("mcp-changed"); } }

  // The flat ARMED tool set the loop consumes: [{ def, serverName, call(args)→{text,isError} }].
  // Per-server `toolFilter` (a name allowlist, set from the UI) selects which tools arm; without
  // one, the first DEFAULT_ARM tools arm. A hard ceiling keeps the system block inside the model's
  // context (a local model can't juggle 30 schemas — pick, like LibreChat's per-server selection).
  const DEFAULT_ARM = 4, MAX_ARM = 8;
  // the substrate's own roster is curated to its core verbs by default
  const SUBSTRATE_DEFAULT = ["search_web", "resolve_object", "answer", "verify_object"];
  function enabledTools() {
    const out = [];
    for (const s of servers.values()) {
      if (!s.enabled || s.status !== "connected") continue;
      const names = s.toolFilter && s.toolFilter.length ? s.toolFilter
        : (s.source === "substrate" ? SUBSTRATE_DEFAULT.filter((n) => s.tools.some((t) => t.name === n)) : s.tools.slice(0, DEFAULT_ARM).map((t) => t.name));
      for (const t of s.tools) {
        if (!names.includes(t.name)) continue;
        out.push({
          def: { name: t.name, description: t.description, inputSchema: t.inputSchema },
          serverName: s.name, serverId: s.id,
          call: async (args) => { const r = await s.client.callTool(t.name, args); return { text: contentToText(r), isError: !!(r && r.isError) }; },
        });
      }
    }
    // de-dup by tool name (first server wins) — small models address tools by bare name
    const seen = new Set();
    return out.filter((t) => (seen.has(t.def.name) ? false : (seen.add(t.def.name), true))).slice(0, MAX_ARM);
  }
  async function setToolFilter(id, names) { const s = servers.get(id); if (s) { s.toolFilter = names && names.length ? names : null; bus.emit("mcp-changed"); } }

  // Substrate ring: read the OS roster; candidate endpoints = declared, same-origin /mcp, the
  // conventional localhost MCP port. First reachable wins.
  async function discoverSubstrateServers() {
    const entries = await discoverSubstrate();
    const candidates = new Set();
    for (const e of entries) if (e.url) candidates.add(norm(e.url));
    candidates.add(norm("/mcp"));
    candidates.add("http://127.0.0.1:8787/mcp");
    return { entries, candidates: [...candidates] };
  }

  return {
    restore, add, connect, remove, setEnabled, setToolFilter, enabledTools, persist,
    list: () => [...servers.values()],
    discoverSubstrateServers, searchRegistry, discoverAgents,
  };
}
