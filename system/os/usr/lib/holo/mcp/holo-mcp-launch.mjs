#!/usr/bin/env node
// hologram-mcp — one-command launch of the Hologram MCP server (the `bin` for npx).
//   npx hologram-mcp                 # stdio (for Claude Desktop, the OpenAI Agents SDK, …)
//   npx hologram-mcp --http [port]   # Streamable HTTP + /.well-known/mcp.json discovery
// Resources resolve to self-verifying UOR objects from the κ-store; tools/prompts come from
// the apps/<id>/holospace.json manifests. Built on the pinned official SDK.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSdkServer } from "./holo-mcp-sdk.mjs";
import { makeHttpApp } from "./holo-mcp-http.mjs";
import { loadLiberty } from "./holo-liberty.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const store = new Map();
const lib = join(here, "..", "music", "library.uor.json");
if (existsSync(lib)) { try { const doc = JSON.parse(readFileSync(lib, "utf8"));
  store.set("music/library.uor.json", doc); for (const o of doc["@graph"] || []) if (o.id) store.set(o.id, o); } catch {} }
// the easter egg: load On Liberty into the same store + expose its read_liberty tool.
const { toolHandlers } = loadLiberty(here, store);
const resolve = (uri) => store.get(uri) || null;
const appsDir = join(here, "..", "apps");

const i = process.argv.indexOf("--http");
if (i >= 0) {
  const port = Number(process.argv[i + 1]) || 8787;
  makeHttpApp({ appsDir, resolve, toolHandlers }).listen(port, () =>
    console.error(`hologram-mcp (http) → http://localhost:${port}/mcp · discovery /.well-known/mcp.json`));
} else {
  const { server } = createSdkServer({ appsDir, resolve, toolHandlers });
  await server.connect(new StdioServerTransport());      // stdout is the MCP channel; logs go to stderr
  console.error("hologram-mcp (stdio) ready");
}
