#!/usr/bin/env node
// holo-mcp-sdk.mjs — the CANONICAL Hologram MCP server, built strictly on the OFFICIAL
// Model Context Protocol TypeScript SDK (@modelcontextprotocol/sdk, pinned by
// holo-mcp-sdk.pin.json, Law L5), consumed unmodified. This is the feature-complete,
// spec-conformant path: the SDK owns the protocol; Hologram owns the bridge into the UOR
// content-addressable substrate — every resource is a SELF-VERIFYING UOR object and a
// built-in verify_object tool lets an agent re-derive any did.
//
// Two tiers (like the engine's UI tiers): this is the Node, full-SDK server; holo-mcp.mjs
// is the dependency-free core for the browser/edge. Both share the same registry + bridge.
//
// Run:  node holo-mcp-sdk.mjs            (an MCP host launches it; speaks JSON-RPC over stdio)

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListResourcesRequestSchema, ReadResourceRequestSchema, ListToolsRequestSchema, CallToolRequestSchema,
  ListPromptsRequestSchema, GetPromptRequestSchema, CompleteRequestSchema, SubscribeRequestSchema,
  UnsubscribeRequestSchema, SetLevelRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildRegistry, scanManifests, getPrompt, paginate, SAMPLE_URI, sampleObject } from "./holo-mcp.mjs";
import { verify, jcs } from "../holo-object.mjs";

// createSdkServer({ manifests | appsDir, resolve, toolHandlers }) → a real SDK Server whose
// resources/tools are generated from holospace.json manifests and backed by the UOR substrate.
export function createSdkServer({ manifests, appsDir, resolve, toolHandlers } = {}) {
  const registry = buildRegistry(manifests || scanManifests(appsDir));
  const resolveR = (uri) => uri === SAMPLE_URI ? sampleObject() : (resolve ? resolve(uri) : null);   // built-in sample
  const server = new Server({ name: registry.server.name, version: registry.server.version },
    { capabilities: { resources: { subscribe: true }, tools: {}, prompts: {}, completions: {}, logging: {} } });

  server.setRequestHandler(ListResourcesRequestSchema, async (req) => {
    const { page, nextCursor } = paginate(registry.resources.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType })), req.params?.cursor);
    return { resources: page, ...(nextCursor ? { nextCursor } : {}) };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const o = resolveR(req.params.uri);
    if (!o) throw new Error("resource not found: " + req.params.uri);
    return { contents: [{ uri: req.params.uri, mimeType: "application/ld+json", text: jcs(o) }] };  // self-verifying: the client can re-derive its did
  });

  server.setRequestHandler(ListToolsRequestSchema, async (req) => {
    const { page, nextCursor } = paginate(registry.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), req.params?.cursor);
    return { tools: page, ...(nextCursor ? { nextCursor } : {}) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const { name, arguments: args = {} } = req.params;
    try { await server.sendLoggingMessage({ level: "info", logger: "hologram-mcp", data: `tools/call ${name}` }); } catch { /* logging not negotiated */ }
    if (name === "verify_batch") {     // progress + cancellation: verify many objects, one step at a time
      if (!Array.isArray(args.objects)) return { content: [{ type: "text", text: "verify_batch requires an 'objects' array" }], isError: true };
      const objs = args.objects;
      const token = req.params?._meta?.progressToken;
      const results = [];
      for (let i = 0; i < objs.length; i++) {
        if (extra?.signal?.aborted) break;                                  // honor client cancellation
        results.push({ id: objs[i]?.id, verified: verify(objs[i]) });
        if (token != null && extra?.sendNotification)                        // report progress
          await extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: i + 1, total: objs.length } });
      }
      return { content: [{ type: "text", text: JSON.stringify(results) }] };
    }
    if (name === "verify_object") {
      if (!args.object || typeof args.object !== "object") return { content: [{ type: "text", text: "verify_object requires an 'object' argument (a UOR object)" }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify({ verified: verify(args.object), did: args.object?.id }) }] };
    }
    if (name === "resolve_object") { const o = resolveR(args.uri);
      return o ? { content: [{ type: "text", text: jcs(o) }] } : { content: [{ type: "text", text: "not found: " + args.uri }], isError: true }; }
    if (name === "ask_model") {   // INVERSE direction: the holospace asks the agent's model (MCP sampling)
      try {
        const r = await server.createMessage({ messages: [{ role: "user", content: { type: "text", text: String(args.prompt || "") } }], maxTokens: args.maxTokens || 512 });
        return { content: [{ type: "text", text: r.content?.text ?? JSON.stringify(r) }] };
      } catch (e) { return { content: [{ type: "text", text: "sampling unavailable (the client has no sampling capability): " + e.message }], isError: true }; }
    }
    if (name === "ask_user") {       // elicitation: the holospace asks the human via the agent host
      try { const r = await server.elicitInput({ message: String(args.message || "Input?"),
        requestedSchema: args.schema || { type: "object", properties: { value: { type: "string" } }, required: ["value"] } });
        return { content: [{ type: "text", text: JSON.stringify(r) }] };
      } catch (e) { return { content: [{ type: "text", text: "elicitation unavailable (no elicitation capability): " + e.message }], isError: true }; }
    }
    if (name === "list_roots") {     // roots: the file:// roots the agent host granted
      try { const r = await server.listRoots(); return { content: [{ type: "text", text: JSON.stringify(r.roots) }] }; }
      catch (e) { return { content: [{ type: "text", text: "roots unavailable (no roots capability): " + e.message }], isError: true }; }
    }
    if (toolHandlers && toolHandlers[name]) return { content: [{ type: "text", text: String(await toolHandlers[name](args)) }] };
    if (registry.tools.some((t) => t.name === name)) return { content: [{ type: "text", text: `tool '${name}' is declared by a holospace; wire its handler` }], isError: true };
    throw new Error(`unknown tool: ${name}`);   // genuinely unknown → proper JSON-RPC error
  });

  server.setRequestHandler(ListPromptsRequestSchema, async (req) => {
    const { page, nextCursor } = paginate(registry.prompts.map(({ name, description, arguments: a }) => ({ name, description, arguments: a })), req.params?.cursor);
    return { prompts: page, ...(nextCursor ? { nextCursor } : {}) };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const p = getPrompt(registry, req.params.name, req.params.arguments);
    if (!p) throw new Error("prompt not found: " + req.params.name);
    return p;
  });

  // logging — the client sets a minimum level; the server emits notifications/message (above).
  let logLevel = "info";
  server.setRequestHandler(SetLevelRequestSchema, async (req) => { logLevel = req.params.level; return {}; });

  // completions — suggest resource URIs for a prompt/resource argument as the agent types.
  server.setRequestHandler(CompleteRequestSchema, async (req) => {
    const val = req.params?.argument?.value || "";
    const values = registry.resources.map((r) => r.uri).filter((u) => u.startsWith(val)).slice(0, 20);
    return { completion: { values, total: values.length, hasMore: false } };
  });

  // resource subscriptions — a mutable holospace resource (a DID whose state advances to a
  // new κ) notifies its subscribers. notifyResourceUpdated is called by whatever mutates it.
  const subscriptions = new Set();
  server.setRequestHandler(SubscribeRequestSchema, async (req) => { subscriptions.add(req.params.uri); return {}; });
  server.setRequestHandler(UnsubscribeRequestSchema, async (req) => { subscriptions.delete(req.params.uri); return {}; });
  const notifyResourceUpdated = (uri) => subscriptions.has(uri)
    ? server.notification({ method: "notifications/resources/updated", params: { uri } }) : Promise.resolve();

  return { server, registry, notifyResourceUpdated };
}

// stdio entry — resources resolve from the library.uor.json content-addressed store.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const here = dirname(fileURLToPath(import.meta.url));
  const store = new Map();
  const lib = join(here, "..", "music", "library.uor.json");
  if (existsSync(lib)) { try { const doc = JSON.parse(readFileSync(lib, "utf8"));
    store.set("music/library.uor.json", doc); for (const o of doc["@graph"] || []) if (o.id) store.set(o.id, o); } catch {} }
  const { server } = createSdkServer({ appsDir: join(here, "..", "apps"), resolve: (uri) => store.get(uri) || null });
  await server.connect(new StdioServerTransport());
}
