#!/usr/bin/env node
// hologram-mcp — the published bin. Launches the Hologram OS MCP server:
//   hologram-mcp            stdio (Claude Desktop, the OpenAI Agents SDK, …)
//   hologram-mcp --http     Streamable HTTP + /.well-known/mcp.json discovery
// Resources are self-verifying UOR objects; tools include verify_object, ask_model, … See README.
import "../lib/mcp/holo-mcp-launch.mjs";
