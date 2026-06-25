// holo-ad4m-mcp.mjs — AD4M FOR AGENTS: the meta-ontology as tools an AI agent can call, with NO new server.
// AD4M ships a live MCP server so agents can read/write the agent-centric web; here that is a FACE, not a
// process. The same { describe, listTools, prepare, invoke } surface the Q stream-agent registers is bound
// to a live makeAd4m + Perspective (+ optional Neighbourhood), and the SAME tool table is projected as MCP
// tool descriptors (name / description / JSON inputSchema) for @modelcontextprotocol/sdk. The agent reaches
// the substrate through the tool router the host already runs — in-substrate / in-host, never a daemon.
//
// Every tool result is itself substrate-shaped: expression_create returns a verifiable κ; perspective_query
// returns Links that each name a κ. A human (Face-ID) and a delegated agent travel the EXACT same path —
// sovereignty is symmetric. Node-witnessable by binding real instances; fail-soft on a missing binding.

const TOOLS = [
  { name: "agent_me", risk: "low", gated: false, desc: "who am I — my sovereign agent identity (DID)",
    schema: { type: "object", properties: {}, required: [] } },
  { name: "expression_create", risk: "low", gated: false, desc: "create an Expression (a self-verifying value) in a Language",
    schema: { type: "object", properties: { language: { type: "string" }, data: {} }, required: ["language", "data"] } },
  { name: "expression_get", risk: "low", gated: false, desc: "resolve an Expression by its url and re-verify it",
    schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "perspective_add_link", risk: "low", gated: false, desc: "add a Link (subject-predicate-object) to my Perspective",
    schema: { type: "object", properties: { source: { type: "string" }, predicate: { type: "string" }, target: { type: "string" } }, required: ["source", "predicate", "target"] } },
  { name: "perspective_query", risk: "low", gated: false, desc: "query my Perspective's Links by source / predicate / target",
    schema: { type: "object", properties: { source: { type: "string" }, predicate: { type: "string" }, target: { type: "string" } }, required: [] } },
  { name: "neighbourhood_publish", risk: "low", gated: false, desc: "publish my Perspective to a shared Neighbourhood",
    schema: { type: "object", properties: {}, required: [] } },
  { name: "neighbourhood_join", risk: "low", gated: false, desc: "join a shared Neighbourhood and pull others' contributions",
    schema: { type: "object", properties: {}, required: [] } },
];

// makeAd4mAgent({ ad4m, perspective, neighbourhood }) → the tool surface bound to live instances.
//   ad4m         : a makeAd4m(...) instance (the Agent + Expressions + Languages). Required.
//   perspective  : ad4m.perspective(...) — the Links graph the agent reads/writes. Required.
//   neighbourhood: a makeNeighbourhood(...) handle for the *_publish/_join tools. Optional.
export function makeAd4mAgent({ ad4m, perspective, neighbourhood = null } = {}) {
  if (!ad4m || !perspective) throw new Error("the AD4M agent face needs { ad4m, perspective }");

  function describe() { return { title: "AD4M", id: "ad4m" }; }
  function listTools() { return TOOLS.map((t) => ({ name: t.name, risk: t.risk, gated: t.gated, desc: t.desc })); }
  function prepare(name, args = {}) { const t = TOOLS.find((x) => x.name === name); return t ? { ok: true, tool: name, args, summary: t.desc } : { ok: false, reason: "unknown tool" }; }

  // mcpTools() — the SAME table as MCP tool descriptors. register(server) wires them onto an MCP server
  // instance (server.registerTool / server.tool) without this module importing or owning the SDK.
  function mcpTools() { return TOOLS.map((t) => ({ name: t.name, description: t.desc, inputSchema: t.schema })); }
  function register(server) {
    for (const t of TOOLS) {
      const handler = async (args) => ({ content: [{ type: "text", text: JSON.stringify(await invoke(t.name, args || {})) }] });
      if (typeof server.registerTool === "function") server.registerTool(t.name, { description: t.desc, inputSchema: t.schema }, handler);
      else if (typeof server.tool === "function") server.tool(t.name, t.desc, t.schema, handler);
    }
    return mcpTools().map((t) => t.name);
  }

  async function invoke(name, args = {}) {
    try {
      if (name === "agent_me") { const me = ad4m.me(); return me ? { ok: true, did: me } : { ok: false, reason: "no agent unlocked" }; }
      if (name === "expression_create") {
        if (!args.language || args.data === undefined) return { ok: false, reason: "need { language, data }" };
        const { url, expr } = ad4m.createExpression(args.language, args.data);
        return { ok: true, url, expr };                              // expr is a verifiable κ (Law L5)
      }
      if (name === "expression_get") {
        const e = ad4m.getExpression(String(args.url || ""));
        return e ? { ok: true, expr: e } : { ok: false, reason: "not found or failed verify" };
      }
      if (name === "perspective_add_link") {
        if (!args.source || !args.predicate || !args.target) return { ok: false, reason: "need { source, predicate, target }" };
        const link = await perspective.addLink({ source: args.source, predicate: args.predicate, target: args.target });
        return { ok: true, link };
      }
      if (name === "perspective_query") {
        const q = {}; for (const k of ["source", "predicate", "target"]) if (args[k]) q[k] = args[k];
        return { ok: true, links: perspective.links(q) };
      }
      if (name === "neighbourhood_publish") {
        if (!neighbourhood) return { ok: false, reason: "no neighbourhood bound" };
        neighbourhood.publish(); return { ok: true, published: perspective.head() };
      }
      if (name === "neighbourhood_join") {
        if (!neighbourhood) return { ok: false, reason: "no neighbourhood bound" };
        neighbourhood.join(); return { ok: true, members: neighbourhood.members() };
      }
    } catch (e) { return { ok: false, reason: (e && e.message) || "tool error" }; }
    return { ok: false, reason: "unknown tool: " + name };
  }

  return { describe, listTools, prepare, invoke, mcpTools, register };
}

// browser binding: bind the face to the live operator's AD4M + Perspective and register it with the unified
// agent registry (the SAME router Q's tools use), so "create an expression", "link these", "join the space"
// route through here. window.HoloAd4mAgent. Fail-soft if the substrate seams aren't up yet.
if (typeof window !== "undefined") {
  window.HoloAd4mAgent = { makeAd4mAgent };
}

export default { makeAd4mAgent };
