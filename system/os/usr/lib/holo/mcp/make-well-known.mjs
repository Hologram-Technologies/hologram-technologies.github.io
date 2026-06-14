#!/usr/bin/env node
// make-well-known.mjs — generate .well-known/mcp.json: the Hologram MCP DISCOVERY document,
// projected from the holospace.json manifests (built-ins + apps). The Pages deploy publishes
// it at a stable URL so any agent can discover the OS's agent surface. The static deploy is
// an ADVERTISEMENT (Pages can't run a live server); `npx hologram-mcp` serves the real
// endpoint. Pure Node — no SDK dependency.

import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildRegistry, scanManifests, resolveAppsDir, descriptor } from "./holo-mcp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appsDir = resolveAppsDir(here);
const registry = buildRegistry(scanManifests(appsDir));

// servers — the per-app MCP endpoints (each holospace IS its own MCP server: /~<id>/mcp, discovery at
// /~<id>/.well-known/mcp.json). An agent discovers the whole universe of agent-accessible apps here,
// then connects to exactly the one it needs. Listed only for apps that actually expose a surface.
const servers = [];
if (existsSync(appsDir)) for (const id of readdirSync(appsDir)) {
  if (id.startsWith("_") || id.startsWith(".")) continue;
  const p = join(appsDir, id, "holospace.json");
  if (!existsSync(p)) continue;
  try { const m = JSON.parse(readFileSync(p, "utf8"));
    if ((m.tools && m.tools.length) || (m.resources && m.resources.length) || (m.prompts && m.prompts.length))
      servers.push({ name: m.name || id, app: id, endpoint: `/~${id}/mcp`, discovery: `/~${id}/.well-known/mcp.json`,
        tools: (m.tools || []).map((t) => t.name) });
  } catch {}
}

const doc = {
  ...descriptor(registry),
  transport: "streamable-http",
  endpoint: "/mcp",
  servers,
  launch: "npx hologram-mcp",
  note: "Static discovery document. The aggregate endpoint is /mcp; every app is ALSO its own MCP server at /~<app>/mcp (see `servers`). Run `npx hologram-mcp` (stdio) or `--http` for a live endpoint; resources are self-verifying UOR objects.",
};
mkdirSync(join(here, ".well-known"), { recursive: true });
writeFileSync(join(here, ".well-known", "mcp.json"), JSON.stringify(doc, null, 2) + "\n");
console.log(`wrote .well-known/mcp.json — ${doc.tools.length} tools, ${doc.resources.length} resources, ${(doc.prompts || []).length} prompts`);
