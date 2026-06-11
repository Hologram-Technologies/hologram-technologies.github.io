#!/usr/bin/env node
// make-well-known.mjs — generate .well-known/mcp.json: the Hologram MCP DISCOVERY document,
// projected from the holospace.json manifests (built-ins + apps). The Pages deploy publishes
// it at a stable URL so any agent can discover the OS's agent surface. The static deploy is
// an ADVERTISEMENT (Pages can't run a live server); `npx hologram-mcp` serves the real
// endpoint. Pure Node — no SDK dependency.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildRegistry, scanManifests, descriptor } from "./holo-mcp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const registry = buildRegistry(scanManifests(join(here, "..", "apps")));
const doc = {
  ...descriptor(registry),
  transport: "streamable-http",
  endpoint: "/mcp",
  launch: "npx hologram-mcp",
  note: "Static discovery document. Run `npx hologram-mcp` (stdio) or `--http` for a live MCP endpoint; resources are self-verifying UOR objects.",
};
mkdirSync(join(here, ".well-known"), { recursive: true });
writeFileSync(join(here, ".well-known", "mcp.json"), JSON.stringify(doc, null, 2) + "\n");
console.log(`wrote .well-known/mcp.json — ${doc.tools.length} tools, ${doc.resources.length} resources, ${(doc.prompts || []).length} prompts`);
