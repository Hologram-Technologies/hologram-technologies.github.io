#!/usr/bin/env node
// holo-mcp-http.mjs — the Hologram MCP server over the Streamable HTTP transport, so any HTTP
// MCP host or agentic runtime can reach it on the open web (not just stdio). Defaults to
// STATEFUL (session) mode: the server is kept alive per client (initialize → mcp-session-id)
// and a GET event stream carries server→client messages — so the FULL surface works over HTTP,
// the same as stdio, including the inverse direction (sampling, elicitation, roots) and
// notifications (progress, logging, subscriptions). A `stateful:false` option gives the simpler
// per-request mode for plain request/response only (no server→client). Resources resolve to
// self-verifying UOR objects. Built on the pinned official SDK. Publishes /.well-known/mcp.json.
//
// Note (clients): POST requires `Accept: application/json, text/event-stream` (the SDK default).
// Run:  node holo-mcp-http.mjs [port=8787]

import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSdkServer } from "./holo-mcp-sdk.mjs";
import { buildRegistry, buildAppRegistry, scanManifests, resolveAppsDir, descriptor } from "./holo-mcp.mjs";
import { loadLiberty } from "./holo-liberty.mjs";

// makeHttpApp({ appsDir|manifests, resolve, toolHandlers, stateful=true }) → an express app
// exposing /mcp (Streamable HTTP) + /.well-known/mcp.json (discovery). Exported so a witness
// can mount it. toolHandlers wires holospace-declared tools (e.g. read_liberty).
export function makeHttpApp({ appsDir, manifests, resolve, toolHandlers, stateful = true } = {}) {
  const app = express();
  app.use(express.json());
  const discovery = (_req, res) => res.json(descriptor(buildRegistry(manifests || scanManifests(appsDir))));

  // PER-APP endpoints, served by the OFFICIAL SDK — every holospace is its own MCP server at
  // /~<app>/mcp with discovery at /~<app>/.well-known/mcp.json. createSdkServer({ appManifest })
  // yields the app-scoped surface (its declared tools + the universal substrate verbs + the
  // standardized holo_describe card). Stateless per-app (request/response); the aggregate /mcp
  // above keeps the full stateful surface. This is the standardized, application-agnostic door.
  const appManifestOf = (id) => { try { return { ...JSON.parse(readFileSync(join(appsDir, String(id).replace(/[^a-z0-9._-]/gi, ""), "holospace.json"), "utf8")), id }; } catch { return null; } };
  const mountPerApp = () => {
    app.get("/~:app/.well-known/mcp.json", (req, res) => { const m = appManifestOf(req.params.app);
      if (!m) return res.status(404).json({ error: "no such holospace: " + req.params.app });
      res.json({ ...descriptor(buildAppRegistry(m)), transport: "streamable-http", endpoint: `/~${m.id}/mcp` }); });
    app.post("/~:app/mcp", async (req, res) => { const m = appManifestOf(req.params.app);
      if (!m) return res.status(404).json({ jsonrpc: "2.0", id: null, error: { code: -32004, message: "no such holospace: " + req.params.app } });
      const { server } = createSdkServer({ appManifest: m, resolve, toolHandlers });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body); });
    app.get("/~:app/mcp", (_req, res) => res.status(405).json({ error: "per-app endpoint is stateless: POST JSON-RPC (no session stream)" }));
    app.delete("/~:app/mcp", (_req, res) => res.status(405).end());
  };

  if (!stateful) {   // per-request: plain request/response only (NO server→client features)
    app.post("/mcp", async (req, res) => {
      const { server } = createSdkServer({ appsDir, manifests, resolve, toolHandlers });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });
    app.get("/mcp", (_req, res) => res.status(405).json({ error: "stateless server: no session stream" }));
    app.delete("/mcp", (_req, res) => res.status(405).end());
    app.get("/.well-known/mcp.json", discovery);
    mountPerApp();
    return app;
  }

  // stateful: a persistent server per session, so server→client requests + notifications work.
  const sessions = {};   // mcp-session-id → transport
  app.post("/mcp", async (req, res) => {
    const sid = req.headers["mcp-session-id"];
    let transport = sid ? sessions[sid] : undefined;
    if (!transport && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => { sessions[id] = transport; },
      });
      transport.onclose = () => { if (transport.sessionId) delete sessions[transport.sessionId]; };
      const { server } = createSdkServer({ appsDir, manifests, resolve, toolHandlers });
      await server.connect(transport);
    } else if (!transport) {
      return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "no valid session — send initialize first" } });
    }
    await transport.handleRequest(req, res, req.body);
  });
  const session = async (req, res) => {   // GET = the server→client event stream; DELETE = close
    const sid = req.headers["mcp-session-id"];
    if (!sid || !sessions[sid]) return res.status(400).end("invalid or missing mcp-session-id");
    await sessions[sid].handleRequest(req, res);
  };
  app.get("/mcp", session);
  app.delete("/mcp", session);
  app.get("/.well-known/mcp.json", discovery);
  mountPerApp();
  return app;
}

// entry — serve on a port; resources resolve from the library.uor.json content-addressed store.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const here = dirname(fileURLToPath(import.meta.url));
  const store = new Map();
  const lib = join(here, "..", "music", "library.uor.json");
  if (existsSync(lib)) { try { const doc = JSON.parse(readFileSync(lib, "utf8"));
    store.set("music/library.uor.json", doc); for (const o of doc["@graph"] || []) if (o.id) store.set(o.id, o); } catch {} }
  const { toolHandlers } = loadLiberty(here, store);   // the easter egg: On Liberty over MCP
  const port = Number(process.argv[2]) || 8787;
  makeHttpApp({ appsDir: resolveAppsDir(here), resolve: (uri) => store.get(uri) || null, toolHandlers })
    .listen(port, () => console.error(`holo-mcp-http on http://localhost:${port}/mcp  ·  discovery: /.well-known/mcp.json`));
}
